alter table public.queue_items
  add column if not exists source_provider text,
  add column if not exists metadata_status text not null default 'pending' check (metadata_status in ('pending','resolving','ready','failed')),
  add column if not exists metadata_error text,
  add column if not exists metadata_resolved_at timestamptz,
  add column if not exists media_status text not null default 'pending' check (media_status in ('pending','preparing','ready','unsupported','failed')),
  add column if not exists media_error text,
  add column if not exists playback_type text not null default 'local' check (playback_type in ('local','embed')),
  add column if not exists embed_provider text check (embed_provider in ('youtube','spotify')),
  add column if not exists embed_id text;

update public.queue_items
set metadata_status = case when title is not null and title <> 'New request' then 'ready' else 'pending' end,
    media_status = case when local_media_key is not null then 'ready' else 'pending' end
where metadata_status = 'pending' and media_status = 'pending';

create index if not exists queue_items_metadata_status_idx on public.queue_items (room_id, metadata_status);
