-- Migration 0005: legacy PIN column + PIN-aware profile claim compatibility.
-- Migration 0007 upgrades stored PINs to pgcrypto hashes and adds the final seat login flow.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin text;

CREATE OR REPLACE FUNCTION public.ensure_profile(
    p_room_id uuid,
    p_seat_no integer,
    p_nickname text,
    p_device_id text,
    p_pin text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile public.profiles;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
    IF p_seat_no < 1 OR p_seat_no > 50 THEN RAISE EXCEPTION 'invalid seat'; END IF;
    IF p_nickname IS NULL OR char_length(trim(p_nickname)) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid nickname'; END IF;
    IF p_pin IS NOT NULL AND p_pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'invalid_pin'; END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE room_id = p_room_id AND seat_no = p_seat_no
    ORDER BY updated_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_profile.pin IS NOT NULL AND (p_pin IS NULL OR v_profile.pin <> p_pin) THEN
            RAISE EXCEPTION 'invalid_pin';
        END IF;
        UPDATE public.profiles
        SET nickname = COALESCE(NULLIF(trim(p_nickname), ''), nickname),
            device_id = p_device_id,
            pin = COALESCE(pin, p_pin),
            auth_user_id = auth.uid(),
            last_seen = now(),
            updated_at = now()
        WHERE id = v_profile.id
        RETURNING * INTO v_profile;
    ELSE
        INSERT INTO public.profiles(room_id, auth_user_id, seat_no, nickname, device_id, pin, last_seen)
        VALUES (p_room_id, auth.uid(), p_seat_no, trim(p_nickname), p_device_id, p_pin, now())
        RETURNING * INTO v_profile;
    END IF;
    RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile(uuid, integer, text, text, text) TO authenticated;
