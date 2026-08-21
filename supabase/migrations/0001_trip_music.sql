create extension if not exists pgcrypto;

create type public.requested_mode as enum ('audio', 'video');
create type public.queue_status as enum ('waiting', 'preparing', 'ready', 'playing', 'played', 'failed', 'skipped');
create type public.playback_status as enum ('idle', 'playing', 'paused', 'stopped');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade integer not null check (grade between 1 and 12),
  room_number integer not null check (room_number > 0),
  active boolean not null default true,
  max_pending_per_user integer not null default 2 check (max_pending_per_user between 1 and 10),
  created_at timestamptz not null default now(),
  unique (name)
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  seat_no integer not null check (seat_no between 1 and 38),
  nickname text not null check (char_length(nickname) between 1 and 20),
  device_id text not null check (char_length(device_id) between 8 and 100),
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (auth_user_id, room_id),
  unique (room_id, auth_user_id, device_id)
);

create table public.queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete restrict,
  requested_by_profile_id uuid references public.profiles(id) on delete set null,
  source_url text not null,
  normalized_source_key text not null,
  requested_mode public.requested_mode not null default 'audio',
  anonymous_requester boolean not null default true,
  sort_order bigint generated always as identity,
  status public.queue_status not null default 'waiting',
  title text not null default 'Untitled track',
  artist text not null default 'Unknown artist',
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  cover_url_original text,
  local_media_key text,
  local_cover_key text,
  prepared_media_type text check (prepared_media_type in ('audio', 'video')),
  error_message text,
  requested_at timestamptz not null default now(),
  preparing_at timestamptz,
  ready_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);

create table public.system_state (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  requests_enabled boolean not null default true,
  trip_started boolean not null default false,
  current_queue_item_id uuid references public.queue_items(id) on delete set null,
  playback_status public.playback_status not null default 'idle',
  playback_started_at timestamptz,
  playback_position_seconds numeric(10,2) not null default 0,
  worker_last_seen timestamptz,
  player_last_seen timestamptz,
  prepared_buffer_seconds integer not null default 0,
  cached_track_count integer not null default 0,
  internet_online boolean not null default false,
  performance_mode text not null default 'balanced' check (performance_mode in ('balanced', 'lite')),
  video_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.player_commands (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  command text not null check (command in ('pause', 'resume', 'skip', 'stop', 'start_trip', 'end_trip')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_type text not null check (actor_type in ('student', 'admin', 'worker', 'system')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  queue_item_id uuid references public.queue_items(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index queue_items_room_order_idx on public.queue_items(room_id, sort_order);
create index queue_items_room_status_idx on public.queue_items(room_id, status);
create index profiles_room_seat_idx on public.profiles(room_id, seat_no);
create index player_commands_pending_idx on public.player_commands(room_id, processed_at, created_at);

insert into public.rooms (name, grade, room_number)
values ('6/18', 6, 18)
on conflict (name) do nothing;

insert into public.system_state (room_id)
select id from public.rooms where name = '6/18'
on conflict (room_id) do nothing;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute procedure public.touch_updated_at();

create or replace function public.current_profile(p_room_id uuid default null)
returns public.profiles language sql stable security definer set search_path = public as $$
  select p from public.profiles p where p.auth_user_id = auth.uid() and (p_room_id is null or p.room_id = p_room_id) order by p.updated_at desc limit 1;
$$;

create or replace function public.ensure_profile(p_room_id uuid, p_seat_no integer, p_nickname text, p_device_id text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_seat_no < 1 or p_seat_no > 38 then raise exception 'invalid seat'; end if;
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

create or replace function public.enqueue_track(p_room_id uuid, p_source_url text, p_requested_mode public.requested_mode default 'audio')
returns public.queue_items language plpgsql security definer set search_path = public as $$
declare profile public.profiles; result public.queue_items; pending_count integer; normalized text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into profile from public.profiles where auth_user_id = auth.uid() and room_id = p_room_id for update;
  if profile.id is null then raise exception 'profile required'; end if;
  if profile.blocked then raise exception 'profile blocked'; end if;
  if not (p_source_url ~* '^https?://') or char_length(p_source_url) > 500 then raise exception 'invalid source url'; end if;
  if not (p_source_url !~* '(localhost|127\\.|192\\.168\\.|10\\.|169\\.254\\.)') then raise exception 'private source url'; end if;
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

alter table public.rooms enable row level security;
alter table public.profiles enable row level security;
alter table public.queue_items enable row level security;
alter table public.system_state enable row level security;
alter table public.player_commands enable row level security;
alter table public.audit_logs enable row level security;

create policy rooms_read_active on public.rooms for select to anon, authenticated using (active = true);
create policy profiles_read_self on public.profiles for select to authenticated using (auth_user_id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy queue_read_room on public.queue_items for select to authenticated using (room_id in (select room_id from public.profiles where auth_user_id = auth.uid()));
create policy system_read_room on public.system_state for select to authenticated using (room_id in (select room_id from public.profiles where auth_user_id = auth.uid()));

revoke all on public.audit_logs from anon, authenticated;
revoke all on public.player_commands from anon, authenticated;
revoke insert, update, delete on public.queue_items from anon, authenticated;
grant execute on function public.ensure_profile(uuid, integer, text, text) to authenticated;
grant execute on function public.enqueue_track(uuid, text, public.requested_mode) to authenticated;

alter publication supabase_realtime add table public.queue_items;
alter publication supabase_realtime add table public.system_state;
