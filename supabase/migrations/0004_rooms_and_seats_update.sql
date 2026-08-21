alter table public.profiles drop constraint if exists profiles_seat_no_check;
alter table public.profiles add constraint profiles_seat_no_check check (seat_no between 1 and 50);

create or replace function public.ensure_profile(p_room_id uuid, p_seat_no integer, p_nickname text, p_device_id text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_seat_no < 1 or p_seat_no > 50 then raise exception 'invalid seat'; end if;
  if p_nickname is null or char_length(trim(p_nickname)) not between 1 and 20 then raise exception 'invalid nickname'; end if;
  insert into public.profiles(auth_user_id, room_id, seat_no, nickname, device_id)
  values (auth.uid(), p_room_id, p_seat_no, trim(p_nickname), p_device_id)
  on conflict (auth_user_id, room_id) do update set seat_no = excluded.seat_no, nickname = excluded.nickname, device_id = excluded.device_id, last_seen = now(), updated_at = now()
  returning * into result;
  insert into public.audit_logs(room_id, actor_type, actor_profile_id, action, metadata)
  values (result.room_id, 'student', result.id, 'student_joined', jsonb_build_object('seat_no', result.seat_no));
  return result;
end;
$$;
