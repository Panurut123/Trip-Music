import type { QueueItem, SystemState } from "@trip-music/shared";

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {}
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function mapQueueRow(row: Record<string, unknown>): QueueItem {
  return {
    id: String(row.id), roomId: String(row.room_id), title: String(row.title ?? "New request"), artist: String(row.artist ?? "Unknown"), durationSeconds: Number(row.duration_seconds ?? 0), sourceUrl: String(row.source_url ?? ""), sourceKey: String(row.normalized_source_key ?? row.source_url ?? ""), normalizedSourceKey: row.normalized_source_key as string | null, sourceProvider: (row.source_provider as QueueItem["sourceProvider"]) ?? "unknown", coverUrlOriginal: row.cover_url_original as string | null, thumbnailUrl: row.cover_url_original as string | null, metadataStatus: (row.metadata_status as QueueItem["metadataStatus"]) ?? "pending", metadataError: row.metadata_error as string | null, metadataResolvedAt: row.metadata_resolved_at as string | null, mediaStatus: (row.media_status as QueueItem["mediaStatus"]) ?? "pending", mediaError: row.media_error as string | null, requestedMode: (row.requested_mode === "video" ? "video" : "audio"), anonymousRequester: Boolean(row.anonymous_requester), sortOrder: Number(row.sort_order ?? 0), status: (row.status as QueueItem["status"]) ?? "waiting", localMediaKey: row.local_media_key as string | null, localCoverKey: row.local_cover_key as string | null, preparedMediaType: row.prepared_media_type as QueueItem["preparedMediaType"], playbackType: (row.playback_type as QueueItem["playbackType"]) ?? "local", embedProvider: (row.embed_provider as QueueItem["embedProvider"]) ?? null, embedId: (row.embed_id as string) ?? null, errorMessage: row.error_message as string | null, requestedAt: String(row.requested_at), readyAt: row.ready_at as string | null, startedAt: row.started_at as string | null, finishedAt: row.finished_at as string | null, requestedByProfileId: row.requested_by_profile_id as string | null, requesterNickname: row.requester_nickname as string | null, seatNo: row.seat_no as number | null,
  };
}


export function mapStateRow(row: Record<string, unknown>): SystemState {
  return { roomId: String(row.room_id), requestsEnabled: Boolean(row.requests_enabled), tripStarted: Boolean(row.trip_started), currentQueueItemId: row.current_queue_item_id as string | null, playbackStatus: (row.playback_status as SystemState["playbackStatus"]) ?? "idle", playbackStartedAt: row.playback_started_at as string | null, playbackPositionSeconds: Number(row.playback_position_seconds ?? 0), workerLastSeen: row.worker_last_seen as string | null, playerLastSeen: row.player_last_seen as string | null, preparedBufferSeconds: Number(row.prepared_buffer_seconds ?? 0), cachedTrackCount: Number(row.cached_track_count ?? 0), internetOnline: Boolean(row.internet_online), performanceMode: (row.performance_mode === "lite" ? "lite" : "balanced"), videoEnabled: Boolean(row.video_enabled), updatedAt: String(row.updated_at) };
}
