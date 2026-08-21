alter table public.player_commands drop constraint if exists player_commands_command_check;
alter table public.player_commands add constraint player_commands_command_check
  check (command in ('pause','resume','skip','stop','start_trip','end_trip','requests_enable','requests_disable'));

create or replace function public.enqueue_track(p_room_id uuid, p_source_url text, p_requested_mode public.requested_mode default 'audio')
returns public.queue_items language plpgsql security definer set search_path = public as $$
declare profile public.profiles; result public.queue_items; pending_count integer; normalized text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not coalesce((select requests_enabled from public.system_state where room_id = p_room_id), false) then raise exception 'requests disabled'; end if;
  select * into profile from public.profiles where auth_user_id = auth.uid() and room_id = p_room_id for update;
  if profile.id is null then raise exception 'profile required'; end if;
  if profile.blocked then raise exception 'profile blocked'; end if;
  if not (p_source_url ~* '^https?://') or char_length(p_source_url) > 500 then raise exception 'invalid source url'; end if;
  if not (p_source_url !~* '(localhost|127\.|192\.168\.|10\.|169\.254\.)') then raise exception 'private source url'; end if;
  select count(*) into pending_count from public.queue_items where requested_by_profile_id = profile.id and status in ('waiting','preparing','ready','playing');
  if pending_count >= (select max_pending_per_user from public.rooms where id = p_room_id) then raise exception 'pending limit reached'; end if;
  normalized := lower(regexp_replace(split_part(p_source_url, '#', 1), '/+$', ''));
  if exists (select 1 from public.queue_items where room_id = p_room_id and normalized_source_key = normalized and status in ('waiting','preparing','ready','playing')) then raise exception 'duplicate active request'; end if;
  if p_requested_mode = 'video' and not (select exists(select 1 from public.system_state where room_id = p_room_id and video_enabled)) then raise exception 'video disabled'; end if;
  insert into public.queue_items(room_id, requested_by_profile_id, source_url, normalized_source_key, requested_mode, anonymous_requester)
  values (p_room_id, profile.id, p_source_url, normalized, p_requested_mode, true) returning * into result;
  insert into public.audit_logs(room_id, actor_type, actor_profile_id, action, queue_item_id)
  values (p_room_id, 'student', profile.id, 'song_requested', result.id);
  return result;
end;
$$;
