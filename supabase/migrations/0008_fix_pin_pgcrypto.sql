-- Migration 0008: fix claim_seat on hosted Supabase where pgcrypto lives in the `extensions` schema.
-- Migration 0007 used `SET search_path = public`, which hides crypt()/gen_salt() on hosted Supabase.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.claim_seat(
  p_room_id uuid,
  p_seat_no integer,
  p_device_id text,
  p_pin text,
  p_nickname text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_profile public.profiles;
  v_previous public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF p_seat_no < 1 OR p_seat_no > 38 THEN RAISE EXCEPTION 'invalid seat'; END IF;
  IF p_device_id IS NULL OR char_length(p_device_id) NOT BETWEEN 8 AND 100 THEN RAISE EXCEPTION 'invalid device'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_room_id::text || ':' || p_seat_no::text));

  SELECT * INTO v_profile FROM public.profiles
  WHERE room_id = p_room_id AND seat_no = p_seat_no
  ORDER BY updated_at DESC LIMIT 1
  FOR UPDATE;

  IF v_profile.id IS NOT NULL THEN
    IF v_profile.pin_hash IS NOT NULL THEN
      IF crypt(p_pin, v_profile.pin_hash) <> v_profile.pin_hash THEN RAISE EXCEPTION 'invalid_pin'; END IF;
    ELSIF v_profile.pin IS NOT NULL THEN
      IF v_profile.pin <> p_pin THEN RAISE EXCEPTION 'invalid_pin'; END IF;
      v_profile.pin_hash := crypt(p_pin, gen_salt('bf'));
    ELSE
      v_profile.pin_hash := crypt(p_pin, gen_salt('bf'));
    END IF;

    SELECT * INTO v_previous FROM public.profiles
    WHERE auth_user_id = auth.uid() AND room_id = p_room_id AND id <> v_profile.id
    ORDER BY updated_at DESC LIMIT 1;
    IF v_previous.id IS NOT NULL THEN
      DELETE FROM public.profiles WHERE id = v_previous.id;
    END IF;

    UPDATE public.profiles
    SET auth_user_id = auth.uid(),
        device_id = p_device_id,
        pin_hash = v_profile.pin_hash,
        pin = NULL,
        last_seen = now(),
        updated_at = now()
    WHERE id = v_profile.id
    RETURNING * INTO v_profile;
  ELSE
    IF p_nickname IS NULL OR char_length(trim(p_nickname)) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'nickname required'; END IF;

    SELECT * INTO v_previous FROM public.profiles
    WHERE auth_user_id = auth.uid() AND room_id = p_room_id
    ORDER BY updated_at DESC LIMIT 1;
    IF v_previous.id IS NOT NULL THEN DELETE FROM public.profiles WHERE id = v_previous.id; END IF;

    INSERT INTO public.profiles(auth_user_id, room_id, seat_no, nickname, device_id, pin_hash, last_seen)
    VALUES (auth.uid(), p_room_id, p_seat_no, trim(p_nickname), p_device_id, crypt(p_pin, gen_salt('bf')), now())
    RETURNING * INTO v_profile;
  END IF;

  INSERT INTO public.audit_logs(room_id, actor_type, actor_profile_id, action, metadata)
  VALUES (p_room_id, 'student', v_profile.id, 'student_joined', jsonb_build_object('seat_no', v_profile.seat_no, 'device_id', p_device_id));

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'seat_no', v_profile.seat_no,
    'nickname', v_profile.nickname,
    'blocked', v_profile.blocked
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_seat(uuid, integer, text, text, text) TO authenticated;
