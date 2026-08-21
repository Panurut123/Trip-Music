-- Migration 0006: Enable video by default and make enqueue_track flexible

UPDATE public.system_state 
SET video_enabled = true, requests_enabled = true;

ALTER TABLE public.system_state ALTER COLUMN video_enabled SET DEFAULT true;
ALTER TABLE public.system_state ALTER COLUMN requests_enabled SET DEFAULT true;

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
    v_mode public.requested_mode := p_requested_mode;
BEGIN
    -- 1. Find profile by auth_user_id or device_id
    IF auth.uid() IS NOT NULL THEN
        SELECT * INTO v_profile FROM public.profiles 
        WHERE auth_user_id = auth.uid() AND room_id = p_room_id 
        ORDER BY last_seen_at DESC LIMIT 1;
    END IF;

    IF v_profile.id IS NULL AND p_device_id IS NOT NULL THEN
        SELECT * INTO v_profile FROM public.profiles 
        WHERE device_id = p_device_id AND room_id = p_room_id 
        ORDER BY last_seen_at DESC LIMIT 1;
    END IF;

    IF v_profile.id IS NULL THEN
        -- Auto create anonymous student profile if missing
        INSERT INTO public.profiles (room_id, auth_user_id, seat_no, nickname, device_id, last_seen_at)
        VALUES (p_room_id, COALESCE(auth.uid(), gen_random_uuid()), 7, 'Passenger', COALESCE(p_device_id, gen_random_uuid()::text), now())
        RETURNING * INTO v_profile;
    END IF;

    IF v_profile.blocked THEN 
        RAISE EXCEPTION 'profile blocked'; 
    END IF;

    IF NOT (p_source_url ~* '^https?://') OR char_length(p_source_url) > 500 THEN 
        RAISE EXCEPTION 'invalid source url'; 
    END IF;

    -- 2. Check pending limit
    SELECT count(*) INTO pending_count FROM public.queue_items 
    WHERE requested_by_profile_id = v_profile.id AND status IN ('waiting','preparing','ready','playing');
    
    IF pending_count >= COALESCE((SELECT max_pending_per_user FROM public.rooms WHERE id = p_room_id), 2) THEN 
        RAISE EXCEPTION 'pending limit reached'; 
    END IF;

    -- 3. Normalized key & duplicate check
    normalized := lower(regexp_replace(split_part(p_source_url, '#', 1), '/+$', ''));
    IF EXISTS (
        SELECT 1 FROM public.queue_items 
        WHERE room_id = p_room_id AND normalized_source_key = normalized AND status IN ('waiting','preparing','ready','playing')
    ) THEN 
        RAISE EXCEPTION 'duplicate active request'; 
    END IF;

    -- 4. Insert queue item
    INSERT INTO public.queue_items(
        room_id, requested_by_profile_id, source_url, normalized_source_key, requested_mode, anonymous_requester, requester_nickname, seat_no
    )
    VALUES (
        p_room_id, v_profile.id, p_source_url, normalized, v_mode, false, v_profile.nickname, v_profile.seat_no
    ) 
    RETURNING * INTO result;

    INSERT INTO public.audit_logs(room_id, actor_type, actor_profile_id, action, queue_item_id)
    VALUES (p_room_id, 'student', v_profile.id, 'song_requested', result.id);

    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_track(uuid, text, public.requested_mode, text) TO authenticated, anon;
