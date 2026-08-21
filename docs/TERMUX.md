# Galaxy Tab S9 / Termux runbook

1. Install Termux from a trusted source, open it, and run:

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git
termux-wake-lock
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

