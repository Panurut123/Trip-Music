-- Migration 0005: Add PIN support to profiles

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin text;

CREATE OR REPLACE FUNCTION ensure_profile(
    p_room_id uuid,
    p_seat_no integer,
    p_nickname text,
    p_device_id text,
    p_pin text DEFAULT NULL
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_profile profiles;
BEGIN
    SELECT * INTO v_profile FROM profiles WHERE room_id = p_room_id AND seat_no = p_seat_no;
    IF FOUND THEN
        IF v_profile.pin IS NOT NULL AND p_pin IS NOT NULL AND v_profile.pin <> p_pin THEN
            RAISE EXCEPTION 'invalid_pin';
        END IF;
        UPDATE profiles
        SET nickname = COALESCE(NULLIF(p_nickname, ''), nickname),
            device_id = p_device_id,
            pin = COALESCE(pin, p_pin),
            last_seen_at = now(),
            updated_at = now()
        WHERE id = v_profile.id
        RETURNING * INTO v_profile;
    ELSE
        INSERT INTO profiles(room_id, auth_user_id, seat_no, nickname, device_id, pin, last_seen_at)
        VALUES (p_room_id, COALESCE(auth.uid(), gen_random_uuid()), p_seat_no, p_nickname, p_device_id, p_pin, now())
        RETURNING * INTO v_profile;
    END IF;
    RETURN v_profile;
END;
$$;
