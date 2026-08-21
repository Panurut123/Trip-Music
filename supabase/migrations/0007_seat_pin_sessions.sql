-- Migration 0007: final seat identity flow.
-- Existing seat: enter only the existing 4-digit PIN; nickname is restored automatically.
-- New seat: set nickname + PIN once. PINs are stored as pgcrypto hashes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE public.queue_items ADD COLUMN IF NOT EXISTS requester_nickname text;
ALTER TABLE public.queue_items ADD COLUMN IF NOT EXISTS seat_no integer;

-- Upgrade any legacy plaintext PINs created by migration 0005.
UPDATE public.profiles
SET pin_hash = crypt(pin, gen_salt('bf'))
WHERE pin_hash IS NULL AND pin ~ '^\d{4}$';
UPDATE public.profiles SET pin = NULL WHERE pin_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.seat_status(p_room_id uuid, p_seat_no integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
BEGIN
  IF p_seat_no < 1 OR p_seat_no > 38 THEN RAISE EXCEPTION 'invalid seat'; END IF;
  SELECT * INTO v_profile FROM public.profiles
  WHERE room_id = p_room_id AND seat_no = p_seat_no
  ORDER BY updated_at DESC LIMIT 1;
  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object('exists', false, 'nickname', NULL);
  END IF;
  RETURN jsonb_build_object('exists', true, 'nickname', v_profile.nickname);
END;
$$;

DROP FUNCTION IF EXISTS public.claim_seat(uuid, integer, text, text, text);
CREATE FUNCTION public.claim_seat(
  p_room_id uuid,
  p_seat_no integer,
  p_device_id text,
  p_pin text,
  p_nickname text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles;
  v_previous public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF p_seat_no < 1 OR p_seat_no > 38 THEN RAISE EXCEPTION 'invalid seat'; END IF;
  IF p_device_id IS NULL OR char_length(p_device_id) NOT BETWEEN 8 AND 100 THEN RAISE EXCEPTION 'invalid device'; END IF;
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'invalid_pin'; END IF;

  -- Serialize first-time claims for the same room/seat without requiring a risky unique-index migration tonight.
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
      -- Legacy test rows may not have a PIN yet; the first successful post-migration claim sets it.
      v_profile.pin_hash := crypt(p_pin, gen_salt('bf'));
    END IF;

    -- One anonymous auth identity should represent only one seat in this room.
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
  RETURN jsonb_build_object('id', v_profile.id, 'seat_no', v_profile.seat_no, 'nickname', v_profile.nickname, 'blocked', v_profile.blocked);
END;
$$;

-- Reinstall enqueue_track without the old "auto-create Passenger" bypass.
CREATE OR REPLACE FUNCTION public.enqueue_track(
    p_room_id uuid,
    p_source_url text,
    p_requested_mode public.requested_mode default 'audio',
    p_device_id text default null
)
RETURNS public.queue_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile public.profiles;
    result public.queue_items;
    pending_count integer;
    normalized text;
BEGIN
    IF NOT coalesce((SELECT requests_enabled FROM public.system_state WHERE room_id = p_room_id), false) THEN RAISE EXCEPTION 'requests disabled'; END IF;

    IF auth.uid() IS NOT NULL THEN
      SELECT * INTO v_profile FROM public.profiles
      WHERE auth_user_id = auth.uid() AND room_id = p_room_id
      ORDER BY last_seen DESC LIMIT 1;
    END IF;
    IF v_profile.id IS NULL AND p_device_id IS NOT NULL THEN
      SELECT * INTO v_profile FROM public.profiles
      WHERE device_id = p_device_id AND room_id = p_room_id
      ORDER BY last_seen DESC LIMIT 1;
    END IF;

    IF v_profile.id IS NULL THEN RAISE EXCEPTION 'profile required'; END IF;
    IF v_profile.blocked THEN RAISE EXCEPTION 'profile blocked'; END IF;
    IF NOT (p_source_url ~* '^https?://') OR char_length(p_source_url) > 500 THEN RAISE EXCEPTION 'invalid source url'; END IF;
    IF p_source_url ~* '(^|[/.:])(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' THEN RAISE EXCEPTION 'private source url'; END IF;

    SELECT count(*) INTO pending_count FROM public.queue_items
    WHERE requested_by_profile_id = v_profile.id AND status IN ('waiting','preparing','ready','playing');
    IF pending_count >= coalesce((SELECT max_pending_per_user FROM public.rooms WHERE id = p_room_id), 2) THEN RAISE EXCEPTION 'pending limit reached'; END IF;

    normalized := lower(regexp_replace(split_part(p_source_url, '#', 1), '/+$', ''));
    IF EXISTS (SELECT 1 FROM public.queue_items WHERE room_id = p_room_id AND normalized_source_key = normalized AND status IN ('waiting','preparing','ready','playing')) THEN
      RAISE EXCEPTION 'duplicate active request';
    END IF;
    IF p_requested_mode = 'video' AND NOT coalesce((SELECT video_enabled FROM public.system_state WHERE room_id = p_room_id), false) THEN RAISE EXCEPTION 'video disabled'; END IF;

    INSERT INTO public.queue_items(room_id, requested_by_profile_id, source_url, normalized_source_key, requested_mode, anonymous_requester, requester_nickname, seat_no)
    VALUES (p_room_id, v_profile.id, p_source_url, normalized, p_requested_mode, false, v_profile.nickname, v_profile.seat_no)
    RETURNING * INTO result;

    INSERT INTO public.audit_logs(room_id, actor_type, actor_profile_id, action, queue_item_id)
    VALUES (p_room_id, 'student', v_profile.id, 'song_requested', result.id);
    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seat_status(uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_seat(uuid, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_track(uuid, text, public.requested_mode, text) TO authenticated;
