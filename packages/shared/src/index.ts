import { z } from "zod";

export const RequestedMode = { AUDIO: "audio", VIDEO: "video" } as const;
export type RequestedMode = (typeof RequestedMode)[keyof typeof RequestedMode];
export const QueueStatus = { WAITING: "waiting", PREPARING: "preparing", READY: "ready", PLAYING: "playing", PLAYED: "played", FAILED: "failed", SKIPPED: "skipped" } as const;
export type QueueStatus = (typeof QueueStatus)[keyof typeof QueueStatus];
export const MetadataStatus = { PENDING: "pending", RESOLVING: "resolving", READY: "ready", FAILED: "failed" } as const;
export type MetadataStatus = (typeof MetadataStatus)[keyof typeof MetadataStatus];
export const MediaStatus = { PENDING: "pending", PREPARING: "preparing", READY: "ready", UNSUPPORTED: "unsupported", FAILED: "failed" } as const;
export type MediaStatus = (typeof MediaStatus)[keyof typeof MediaStatus];
export type SourceProvider = "mock" | "youtube" | "spotify" | "direct" | "unknown";
export const PlaybackStatus = { IDLE: "idle", PLAYING: "playing", PAUSED: "paused", STOPPED: "stopped" } as const;
export type PlaybackStatus = (typeof PlaybackStatus)[keyof typeof PlaybackStatus];
export const PlayerCommand = { PAUSE: "pause", RESUME: "resume", SKIP: "skip", STOP: "stop", START_TRIP: "start_trip", END_TRIP: "end_trip", REQUESTS_ENABLE: "requests_enable", REQUESTS_DISABLE: "requests_disable" } as const;
export type PlayerCommand = (typeof PlayerCommand)[keyof typeof PlayerCommand];

export type TrackMetadata = {
  title: string;
  artist: string;
  durationSeconds: number;
  thumbnailUrl?: string | null;
  coverUrlOriginal?: string | null;
  sourceUrl: string;
  sourceKey: string;
  sourceProvider?: SourceProvider;
};

export type PreparedMedia = {
  playbackType: "local" | "embed";
  mediaKey?: string;
  mediaType?: "audio" | "video";
  embedProvider?: "youtube" | "spotify";
  embedId?: string;
};

export type QueueItem = TrackMetadata & {
  id: string;
  roomId: string;
  requestedByProfileId?: string | null;
  requesterNickname?: string | null;
  seatNo?: number | null;
  requestedMode: RequestedMode;
  anonymousRequester: boolean;
  sortOrder: number;
  status: QueueStatus;
  metadataStatus: MetadataStatus;
  metadataError?: string | null;
  metadataResolvedAt?: string | null;
  mediaStatus: MediaStatus;
  mediaError?: string | null;
  normalizedSourceKey?: string | null;
  sourceProvider: SourceProvider;
  localMediaKey?: string | null;
  localCoverKey?: string | null;
  preparedMediaType?: "audio" | "video" | null;
  playbackType?: "local" | "embed";
  embedProvider?: "youtube" | "spotify" | null;
  embedId?: string | null;
  errorMessage?: string | null;
  requestedAt: string;
  preparingAt?: string | null;
  readyAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type SystemState = { roomId: string; requestsEnabled: boolean; tripStarted: boolean; currentQueueItemId?: string | null; playbackStatus: PlaybackStatus; playbackStartedAt?: string | null; playbackPositionSeconds: number; workerLastSeen?: string | null; playerLastSeen?: string | null; preparedBufferSeconds: number; cachedTrackCount: number; internetOnline: boolean; performanceMode: "balanced" | "lite"; videoEnabled: boolean; updatedAt: string; };

export const enqueueSchema = z.object({ sourceUrl: z.string().trim().url().max(500), requestedMode: z.enum([RequestedMode.AUDIO, RequestedMode.VIDEO]).default(RequestedMode.AUDIO), profileId: z.string().uuid().optional() });
export const profileSchema = z.object({ seatNo: z.number().int().min(1).max(38), nickname: z.string().trim().min(1).max(20).regex(/^[\p{L}\p{N} _.'-]+$/u), deviceId: z.string().min(8).max(100) });

export function parseIsoDuration(v: string | null | undefined): number {
  if (!v || typeof v !== "string") return 0;
  const s = v.trim().toUpperCase();
  const regex = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
  const m = regex.exec(s);
  if (!m) return 0;
  const days = Number(m[1] || 0);
  const hours = Number(m[2] || 0);
  const minutes = Number(m[3] || 0);
  const seconds = Math.round(Number(m[4] || 0));
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function normalizeSourceUrl(raw: string): string { const url = new URL(raw.trim()); url.hash = ""; url.hostname = url.hostname.toLowerCase(); if (url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1); return url.toString(); }
function isPrivateHost(host: string) { return host === "localhost" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === "0.0.0.0"; }
export function validateSourceUrl(raw: string, options: { allowLocalhost?: boolean; allowMock?: boolean } = {}): { ok: true; normalized: string } | { ok: false; reason: string } {
  try {
    if (raw.length > 500) return { ok: false, reason: "URL is too long" };
    if ((options.allowMock || options.allowLocalhost) && raw.trim().startsWith("mock:")) return { ok: true, normalized: raw.trim() };
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) return { ok: false, reason: "Only HTTP(S) URLs are supported" };
    if (url.username || url.password) return { ok: false, reason: "Credentials in URLs are not allowed" };
    if (!options.allowLocalhost && isPrivateHost(url.hostname.toLowerCase())) return { ok: false, reason: "Private network destinations are not allowed" };
    return { ok: true, normalized: normalizeSourceUrl(raw) };
  } catch { return { ok: false, reason: "Invalid URL" }; }
}


export function isPlayable(
  item: Pick<QueueItem, "status" | "playbackType" | "localMediaKey" | "embedProvider" | "embedId">,
  options: { internetOnline?: boolean } = {}
): boolean {
  if (item.status !== QueueStatus.READY) return false;
  const isEmbed = item.playbackType === "embed" || (!item.playbackType && Boolean(item.embedProvider && item.embedId));
  if (isEmbed) {
    if (options.internetOnline === false) return false;
    return Boolean(item.embedProvider && item.embedId);
  }
  return Boolean(item.localMediaKey);
}

export function calculateEta(items: Array<Pick<QueueItem, "status" | "durationSeconds">>, currentPositionSeconds = 0): number { const active: QueueStatus[] = [QueueStatus.PLAYING, QueueStatus.WAITING, QueueStatus.PREPARING, QueueStatus.READY]; return items.filter(i => active.includes(i.status)).reduce((sum, i, n) => sum + Math.max(0, i.durationSeconds - (n === 0 && i.status === QueueStatus.PLAYING ? currentPositionSeconds : 0)), 0); }

export function selectNextPlayable(
  items: QueueItem[],
  options: { internetOnline?: boolean } = {}
): QueueItem | undefined {
  return [...items]
    .filter(i => isPlayable(i, options))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.requestedAt.localeCompare(b.requestedAt))[0];
}

export function calculatePreparedBuffer(
  items: Array<Pick<QueueItem, "status" | "durationSeconds" | "playbackType" | "localMediaKey">>,
  playbackPositionSeconds = 0
): number {
  return items.reduce((seconds, item) => {
    const isLocal = item.playbackType === "local" || (!item.playbackType && Boolean(item.localMediaKey));
    if (!isLocal || !item.localMediaKey) return seconds;
    if (item.status === QueueStatus.READY) return seconds + Math.max(0, item.durationSeconds);
    if (item.status === QueueStatus.PLAYING) return seconds + Math.max(0, item.durationSeconds - playbackPositionSeconds);
    return seconds;
  }, 0);
}

export function shouldPrepare(
  items: Array<Pick<QueueItem, "status" | "durationSeconds" | "playbackType" | "localMediaKey">>,
  targetBufferSeconds: number,
  maxTracks: number,
  playbackPositionSeconds = 0,
  options: { maxLocalCachedTracks?: number; maxLookahead?: number } = {}
): boolean {
  const lookaheadLimit = options.maxLookahead ?? maxTracks;
  const readyOrPlayingTracks = items.filter(i => i.status === QueueStatus.READY || i.status === QueueStatus.PLAYING);
  const localBufferSeconds = calculatePreparedBuffer(items, playbackPositionSeconds);

  if (readyOrPlayingTracks.length >= lookaheadLimit) return false;
  return readyOrPlayingTracks.length < maxTracks && localBufferSeconds < targetBufferSeconds;
}


export function canEnqueue(pendingCount: number, maxPending = 2): boolean { return pendingCount < maxPending; }
export function publicRequesterLabel(item: Pick<QueueItem, "anonymousRequester" | "requesterNickname">): string { return item.anonymousRequester ? "Passenger" : (item.requesterNickname || "Passenger"); }
export function recoverStalePreparing<T extends { status: QueueStatus; preparingAt?: string | null }>(items: T[], staleAfterMs = 120_000, at = Date.now()): T[] { return items.map(item => item.status === QueueStatus.PREPARING && item.preparingAt && at - Date.parse(item.preparingAt) > staleAfterMs ? { ...item, status: QueueStatus.WAITING, preparingAt: null } : item); }

