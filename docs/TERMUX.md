# Galaxy Tab S9 / Termux runbook

1. Install Termux from a trusted source, open it, and run:

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git
termux-wake-lock

# Required for local YouTube MP3/MP4 preparation
bash scripts/setup-termux-media.sh
```

2. Copy the private repository to the tablet. Avoid putting secrets in screenshots or shared folders.

```bash
git clone <private-repository-url>
cd trip-music
npm install
npm run build
```

3. Create `apps/tablet/.env` with the tablet-only values:

```text
TABLET_PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-private-service-role-key
DEFAULT_ROOM_ID=your-6-18-room-uuid
DEMO_MODE=false
TARGET_BUFFER_SECONDS=1800
MAX_PREPARED_TRACKS=12
MAX_PENDING_PER_USER=2
ENABLE_VIDEO=true
PERFORMANCE_MODE=balanced
YOUTUBE_LOCAL_DOWNLOAD=true
YOUTUBE_EMBED_FALLBACK=true
MEDIA_PREPARE_TIMEOUT_MS=300000
CACHE_MAX_BYTES=8589934592
CACHE_RETENTION_MINUTES=30
CACHE_CLEANUP_INTERVAL_MS=300000
```

4. Start the local server:

```bash
bash scripts/start-tablet.sh
```

Startup prints all non-loopback IPv4 addresses. On another device on the same network, open:

```text
http://TABLET_IP:3000/diagnostics
http://TABLET_IP:3000/player
```

Diagnostics has a synthetic test tone. Test seeking before connecting real media. `/player?lite=1` can be used as a future compatibility switch; the current player is already deliberately light and does not use WebGL or a large client runtime.

## Samsung settings

- Keep the Tab charging during the trip.
- Settings → Battery → Background usage limits → Termux → Unrestricted.
- Turn Power Saving off.
- Allow Termux notifications and background activity.
- Use `termux-wake-lock` before starting and `termux-wake-unlock` after stopping.
- Switch away from Termux and verify the local player continues before relying on it.

## Supervisor option

PM2 is optional. If installed:

```bash
npm install --global pm2
pm2 start npm --name trip-music-tablet -- run start --workspace @trip-music/tablet
pm2 status
pm2 logs trip-music-tablet
pm2 restart trip-music-tablet
pm2 stop trip-music-tablet
```


## Local media cache

YouTube requests can be prepared on the Tab as local MP3 (Audio mode) or local MP4 (Video mode). Prepared files live under `apps/tablet/data/media` and are served to the bus display through `/media/...` with HTTP Range support.

The cache automatically protects the current/queued tracks, removes completed tracks after `CACHE_RETENTION_MINUTES`, and evicts the oldest completed items if the cache exceeds `CACHE_MAX_BYTES`. Stale partial downloads are also cleaned up. `/diagnostics` shows cache size and has **DELETE PLAYED CACHE** for a manual purge that never deletes active/queued media.

Keep `yt-dlp` current before the trip:

```bash
python -m pip install -U "yt-dlp[default]"
```
