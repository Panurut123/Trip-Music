# Trip Music

Trip Music is a demo-first, production-shaped collaborative music request system for class 6/18's single field-trip bus. It keeps the cloud control plane in Supabase and keeps media bytes on the Galaxy Tab S9, so cached playback can continue when the bus internet is unreliable.

## Architecture

```text
STUDENT PHONES
      │
      ▼
 VERCEL WEB
      │
      ▼
  SUPABASE  ◄── internet ──►  GALAXY TAB S9
                             Worker + cache + server
                                      │ local Wi-Fi
                                      ▼
                                BUS DISPLAY
```

Media bytes never pass through Vercel or Supabase Storage. Supabase stores metadata, queue state, commands, and heartbeat data. The tablet owns local media and serves the bus display over LAN.

## Repository layout

- `apps/web` — Next.js student, queue, history, and admin screens.
- `apps/tablet` — Express local server, worker, cache, SSE updates, range media routes, diagnostics, and plain HTML player.
- `packages/shared` — shared enums, Zod input schemas, queue rules, ETA, URL validation, and tests.
- `supabase/migrations` — database schema, RLS, anonymous profile RPC, and atomic enqueue RPC.
- `config/trip.json` — optional trip metadata. Leave destination/stops null when unknown.

## Supabase setup

The local web environment is already configured with the supplied project URL and publishable key, but it starts in `DEMO_MODE=true`. Do not commit `.env.local`, service-role keys, or database passwords.

1. Install the Supabase CLI using the official instructions.
2. Authenticate and link the project:

```bash
supabase login
supabase init
supabase link --project-ref ezbxnbllppyejgxfrwbb
supabase db push
```

3. In Supabase Auth, enable Anonymous Sign-Ins.
4. Copy the seeded `rooms.id` for `6/18` into `DEFAULT_ROOM_ID` in both the web and tablet environment files.
5. For production tablet sync, set `SUPABASE_SERVICE_ROLE_KEY` only in the tablet's private `.env`; never put it in `apps/web` or browser code.

The current environment does not have the Supabase CLI installed, so migration application is documented but not executed automatically. The SQL migration is ready at `supabase/migrations/0001_trip_music.sql`.

## Windows development

From the repository root:

```powershell
npm install
npm run dev:tablet
# in another terminal
npm run dev:web
```

- Web: `http://localhost:3001/login`
- Tablet diagnostics: `http://localhost:3000/diagnostics`
- Local bus player: `http://localhost:3000/player`
- Local control: `http://localhost:3000/control`

The default demo mode creates three synthetic, copyright-safe tone tracks in `apps/tablet/data/media`. Click `TEST AUDIO` on diagnostics, then `OPEN PLAYER`, then `START TRIP`. Use `SKIP` or let the audio element finish to verify auto-next.

To exercise the cloud path after applying the migration, set `DEMO_MODE=false`, set `DEFAULT_ROOM_ID`, and provide the service-role key only to the tablet. Student browsers use the publishable key and anonymous auth.

## Vercel

Create a Vercel project with the repository root as the project directory. Set the web environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_DEMO_MODE=false
DEFAULT_ROOM_ID
DEVELOPER_NAME
DEMO_MODE=false
ADMIN_PIN
ADMIN_SESSION_SECRET
```

The web app never processes or proxies media files. The public student entry point is `/login`; admin entry is `/admin/login`.

## Galaxy Tab S9 / Termux

See `docs/TERMUX.md`. In short:

```bash
pkg update
pkg install nodejs-lts git
git clone <your-private-repository-url>
cd trip-music
npm install
cp apps/tablet/.env.example apps/tablet/.env  # if using a separate file
npm run build
bash scripts/start-tablet.sh
```

Connect the bus display and open the LAN URL printed by startup, for example `http://192.168.x.x:3000/diagnostics`. Do not hardcode the IP; it can change between hotspots.

On the Tab, enable Termux wake lock, turn Power Saving off for the trip, and set Termux battery use to Unrestricted. Keep the tablet plugged in and test playback after switching away from Termux.

## Reliability behavior

- Audio is the default and synthetic demo media is always local.
- The tablet worker prepares only until the buffer target or maximum prepared track count is reached.
- It uses Supabase polling as a recovery path in addition to the local state and SSE path.
- The player consumes `/media/:mediaKey` locally and supports HTTP Range Requests.
- A failed video preparation falls back to audio when the provider supports it.
- Missing cover art never blocks playback; the UI uses a gradient fallback.
- Queue identity shown to passengers is nickname/seat metadata only; admin diagnostics can inspect more detail.

## Tests and verification

```bash
npm run test
npm run typecheck
npm run build
```

The shared tests cover ETA, earliest playable selection, buffer preparation limits, and rejection of private/non-HTTP URLs. The manual acceptance flow is:

1. Open diagnostics and test tone.
2. Open player and start the trip.
3. Confirm the current track, local cover fallback, and queue render.
4. Skip twice or let the synthetic tracks end; confirm auto-next.
5. Stop internet access after the three demo tracks are cached; local player URLs still work because media is served from the tablet.
6. Reconnect and confirm the worker heartbeat remains healthy.

## Before tomorrow

- Apply the SQL migration and enable Supabase Anonymous Auth.
- Set `DEFAULT_ROOM_ID`, `DEVELOPER_NAME`, and production `DEMO_MODE=false`.
- Keep the Supabase service-role key only in the tablet's private environment.
- Install dependencies and run the diagnostics test on the actual Tab and bus display.
- Confirm the printed LAN player URL from the same Wi-Fi/hotspot the display will use.
- Rotate the database password that was shared during setup.

## Known limitations

The MVP intentionally ships with MockProvider and a permitted DirectMediaProvider interface rather than a DRM or platform-protection bypass. Source-specific providers must be added only when lawful and allowlisted. GPS/weather and remote admin command persistence are scaffolded for the tablet, while the demo path remains fully local and deterministic.
