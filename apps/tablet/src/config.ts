import path from "node:path";

const bool = (value: string | undefined, fallback = false) => value === undefined ? fallback : value.toLowerCase() === "true";
export const isLocalMediaTestEnabled = () => process.env.NODE_ENV !== "production" && bool(process.env.ALLOW_LOCAL_MEDIA_TEST, false);
export const tabletConfig = {
  port: Number(process.env.TABLET_PORT ?? process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: path.resolve(process.env.TABLET_DATA_DIR ?? "./data"),
  roomId: process.env.DEFAULT_ROOM_ID ?? "00000000-0000-0000-0000-000000000618",
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  demoMode: bool(process.env.DEMO_MODE, false),
  targetBufferSeconds: Number(process.env.TARGET_BUFFER_SECONDS ?? 1800),
  maxPreparedTracks: Number(process.env.MAX_PREPARED_TRACKS ?? 12),
  enableVideo: bool(process.env.ENABLE_VIDEO, true),
  performanceMode: (process.env.PERFORMANCE_MODE === "lite" ? "lite" : "balanced") as "lite" | "balanced",
  adminPin: process.env.TABLET_ADMIN_PIN ?? process.env.ADMIN_PIN ?? "",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? "",
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
  maxAudioBytes: Number(process.env.MAX_AUDIO_BYTES ?? 100 * 1024 * 1024),
  maxVideoBytes: Number(process.env.MAX_VIDEO_BYTES ?? 500 * 1024 * 1024),
  maxCoverBytes: Number(process.env.MAX_COVER_BYTES ?? 5 * 1024 * 1024),
  downloadTimeoutMs: Number(process.env.DOWNLOAD_TIMEOUT_MS ?? 30_000),
  unknownDurationEstimateSeconds: Number(process.env.UNKNOWN_DURATION_ESTIMATE_SECONDS ?? 240),
  allowLocalMediaTest: isLocalMediaTestEnabled(),
};
