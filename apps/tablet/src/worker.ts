import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  QueueStatus,
  calculatePreparedBuffer,
  recoverStalePreparing,
  selectNextPlayable,
  shouldPrepare,
  type PlayerCommand,
  type QueueItem,
  type SystemState,
} from "@trip-music/shared";
import { CacheStore } from "./cache.js";
import { tabletConfig } from "./config.js";
import {
  DirectMediaProvider,
  MockProvider,
  SpotifyMetadataResolver,
  YouTubeEmbedProvider,
  YouTubeMetadataResolver,
  cacheCover,
  type MediaProvider,
  type MetadataResolver,
} from "./provider.js";

const now = () => new Date().toISOString();
const unsupportedMessage = "พบข้อมูลเพลงแล้ว แต่ยังไม่มี Media Provider สำหรับแหล่งนี้";

type WorkerOptions = {
  cache?: CacheStore;
  resolvers?: MetadataResolver[];
  providers?: MediaProvider[];
  targetBufferSeconds?: number;
  maxPreparedTracks?: number;
};

const demoItems = (): QueueItem[] => [{
  id: "demo-1", roomId: tabletConfig.roomId, title: "Neon Stratosphere", artist: "Cosmic Voyager",
  durationSeconds: 205, sourceUrl: "mock:demo-1", sourceKey: "mock:demo-1", sourceProvider: "mock",
  requestedMode: "audio", anonymousRequester: false, requesterNickname: "Beam", seatNo: 7, sortOrder: 1,
  status: "ready", metadataStatus: "ready", mediaStatus: "ready", localMediaKey: "demo-1.wav", requestedAt: now(),
}];

export class TripWorker {
  readonly cache: CacheStore;
  readonly resolvers: MetadataResolver[];
  readonly providers: MediaProvider[];
  readonly items: QueueItem[] = [];
  readonly targetBufferSeconds: number;
  readonly maxPreparedTracks: number;
  private listeners = new Set<(state: SystemState) => void>();
  private supabase: SupabaseClient | null = null;
  private pollTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private preparationPromise: Promise<void> | null = null;

  state: SystemState = {
    roomId: tabletConfig.roomId, requestsEnabled: true, tripStarted: false, currentQueueItemId: null,
    playbackStatus: "idle", playbackStartedAt: null, playbackPositionSeconds: 0, preparedBufferSeconds: 0,
    cachedTrackCount: 0, internetOnline: true, performanceMode: tabletConfig.performanceMode,
    videoEnabled: tabletConfig.enableVideo, updatedAt: now(),
  };

  constructor(options: WorkerOptions = {}) {
    this.cache = options.cache ?? new CacheStore(tabletConfig.dataDir);
    const mock = new MockProvider();
    const youtube = new YouTubeEmbedProvider();
    const direct = new DirectMediaProvider();
    this.resolvers = options.resolvers ?? [mock, new YouTubeMetadataResolver(), new SpotifyMetadataResolver(), direct];
    this.providers = options.providers ?? [mock, youtube, direct];
    this.targetBufferSeconds = options.targetBufferSeconds ?? tabletConfig.targetBufferSeconds;
    this.maxPreparedTracks = options.maxPreparedTracks ?? tabletConfig.maxPreparedTracks;
  }

  async checkInternet(): Promise<boolean> {
    try {
      const res = await fetch("https://www.youtube.com/generate_204", { method: "HEAD", signal: AbortSignal.timeout(2500) });
      return res.ok || res.status === 204;
    } catch {
      return false;
    }
  }

  async start() {
    this.state.workerLastSeen = now();
    this.state.internetOnline = await this.checkInternet();
    if (tabletConfig.demoMode) {
      this.items.push(...demoItems());
      this.cache.seedDemo(this.items);
    } else if (tabletConfig.supabaseUrl && tabletConfig.supabaseServiceRoleKey) {
      this.supabase = createClient(tabletConfig.supabaseUrl, tabletConfig.supabaseServiceRoleKey, { auth: { persistSession: false } });
      this.supabase.channel("trip-worker")
        .on("postgres_changes", { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${tabletConfig.roomId}` }, () => void this.reconcile())
        .on("postgres_changes", { event: "*", schema: "public", table: "player_commands", filter: `room_id=eq.${tabletConfig.roomId}` }, () => void this.reconcile())
        .subscribe();
      await this.reconcile();
    }
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 10_000);
    this.pollTimer = setInterval(() => void this.reconcile(), 15_000);
    this.touch();
  }

  hasSupabase(): boolean {
    return Boolean(this.supabase);
  }

  onChange(listener: (state: SystemState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private touch() {
    this.state.cachedTrackCount = this.cache.count();
    this.state.preparedBufferSeconds = calculatePreparedBuffer(this.items, this.state.playbackPositionSeconds);
    this.state.updatedAt = now();
    this.listeners.forEach((listener) => listener(this.state));
    if (this.supabase) void this.supabase.from("system_state").upsert({
      room_id: this.state.roomId, requests_enabled: this.state.requestsEnabled, trip_started: this.state.tripStarted,
      current_queue_item_id: this.state.currentQueueItemId, playback_status: this.state.playbackStatus,
      playback_started_at: this.state.playbackStartedAt, playback_position_seconds: this.state.playbackPositionSeconds,
      worker_last_seen: this.state.workerLastSeen, player_last_seen: this.state.playerLastSeen,
      prepared_buffer_seconds: this.state.preparedBufferSeconds, cached_track_count: this.state.cachedTrackCount,
      internet_online: this.state.internetOnline, performance_mode: this.state.performanceMode,
      video_enabled: this.state.videoEnabled, updated_at: this.state.updatedAt,
    });
  }

  private async heartbeat() {
    this.state.workerLastSeen = now();
    this.state.internetOnline = await this.checkInternet();
    this.touch();
  }


  mapRow(row: Record<string, any>): QueueItem {
    const profile = row.profiles ?? row.profile ?? {};
    return {
      id: String(row.id), roomId: String(row.room_id), title: String(row.title ?? "New request"),
      artist: String(row.artist ?? "Unknown"), durationSeconds: Number(row.duration_seconds ?? 0),
      sourceUrl: String(row.source_url ?? ""), sourceKey: String(row.normalized_source_key ?? row.source_url ?? ""),
      normalizedSourceKey: row.normalized_source_key ?? null, sourceProvider: row.source_provider ?? "unknown",
      coverUrlOriginal: row.cover_url_original ?? null, thumbnailUrl: row.cover_url_original ?? null,
      requestedMode: row.requested_mode === "video" ? "video" : "audio", anonymousRequester: Boolean(row.anonymous_requester),
      sortOrder: Number(row.sort_order ?? 0), status: row.status ?? "waiting", metadataStatus: row.metadata_status ?? "pending",
      metadataError: row.metadata_error ?? null, metadataResolvedAt: row.metadata_resolved_at ?? null,
      mediaStatus: row.media_status ?? "pending", mediaError: row.media_error ?? null,
      localMediaKey: row.local_media_key ?? null, localCoverKey: row.local_cover_key ?? null,
      preparedMediaType: row.prepared_media_type ?? null, playbackType: row.playback_type ?? "local",
      embedProvider: row.embed_provider ?? null, embedId: row.embed_id ?? null, errorMessage: row.error_message ?? null,
      requestedAt: String(row.requested_at), preparingAt: row.preparing_at ?? null, readyAt: row.ready_at ?? null,
      startedAt: row.started_at ?? null, finishedAt: row.finished_at ?? null,
      requestedByProfileId: row.requested_by_profile_id ?? null,
      requesterNickname: row.requester_nickname ?? profile.nickname ?? null, seatNo: row.seat_no ?? profile.seat_no ?? null,
    };
  }

  async reconcile() {
    if (!this.supabase) { await this.replenishBuffer(); this.touch(); return; }
    try {
      const { data, error } = await this.supabase.from("queue_items")
        .select("*, profiles:requested_by_profile_id(nickname,seat_no)")
        .eq("room_id", tabletConfig.roomId).in("status", ["waiting", "preparing", "ready", "playing"]).order("sort_order");
      if (error) throw error;
      this.items.splice(0, this.items.length, ...recoverStalePreparing((data ?? []).map((row) => this.mapRow(row))));
      for (const item of this.items) {
        if (item.playbackType === "embed") {
          if ((item.status === "ready" || item.status === "playing") && (!item.embedProvider || !item.embedId)) {
            item.status = "waiting"; item.mediaStatus = "pending";
          }
        } else {
          if ((item.status === "ready" || item.status === "playing") && (!item.localMediaKey || !this.cache.hasMedia(item.localMediaKey))) {
            item.status = "waiting"; item.mediaStatus = "pending"; item.localMediaKey = null;
          }
        }
      }
      const { data: commands, error: commandError } = await this.supabase.from("player_commands")
        .select("id,command").eq("room_id", tabletConfig.roomId).is("processed_at", null).order("created_at");
      if (commandError) throw commandError;
      const { data: persistedState, error: stateError } = await this.supabase.from("system_state")
        .select("requests_enabled").eq("room_id", tabletConfig.roomId).maybeSingle();
      if (stateError) throw stateError;
      if (persistedState) this.state.requestsEnabled = Boolean(persistedState.requests_enabled);
      await this.processPlayerCommands(commands ?? [], async (id) => {
        await this.supabase!.from("player_commands").update({ processed_at: now() }).eq("id", id);
      });
      this.state.internetOnline = true;
      await this.replenishBuffer();
    } catch (error) {
      this.state.internetOnline = false;
      console.error("[worker]", error);
    }
    this.touch();
  }

  private async persist(item: QueueItem) {
    if (!this.supabase) return;
    await this.supabase.from("queue_items").update({
      title: item.title, artist: item.artist, duration_seconds: item.durationSeconds, source_url: item.sourceUrl,
      normalized_source_key: item.normalizedSourceKey, source_provider: item.sourceProvider,
      cover_url_original: item.coverUrlOriginal, local_cover_key: item.localCoverKey,
      metadata_status: item.metadataStatus, metadata_error: item.metadataError, metadata_resolved_at: item.metadataResolvedAt,
      media_status: item.mediaStatus, media_error: item.mediaError, status: item.status,
      local_media_key: item.localMediaKey, prepared_media_type: item.preparedMediaType,
      playback_type: item.playbackType ?? "local", embed_provider: item.embedProvider, embed_id: item.embedId,
      preparing_at: item.preparingAt, ready_at: item.readyAt, started_at: item.startedAt,
      finished_at: item.finishedAt, error_message: item.errorMessage,
    }).eq("id", item.id);
  }

  replenishBuffer(): Promise<void> {
    if (!this.preparationPromise) {
      this.preparationPromise = this.prepareWaiting().finally(() => { this.preparationPromise = null; this.touch(); });
    }
    return this.preparationPromise;
  }

  private async prepareWaiting() {
    for (const item of [...this.items].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (!shouldPrepare(this.items, this.targetBufferSeconds, this.maxPreparedTracks, this.state.playbackPositionSeconds)) break;
      if (item.status !== "waiting" || item.mediaStatus === "unsupported") continue;
      item.status = "preparing"; item.preparingAt = now();
      try {
        if (item.metadataStatus !== "ready") {
          item.metadataStatus = "resolving"; item.metadataError = null;
          await this.persist(item);
          const resolver = this.resolvers.find((candidate) => candidate.canHandle(item.sourceUrl));
          if (!resolver) throw new Error("No metadata resolver for this URL");
          const metadata = await resolver.resolve(item.sourceUrl);
          Object.assign(item, {
            title: metadata.title, artist: metadata.artist, durationSeconds: metadata.durationSeconds,
            coverUrlOriginal: metadata.thumbnailUrl ?? metadata.coverUrlOriginal ?? null,
            thumbnailUrl: metadata.thumbnailUrl, sourceUrl: metadata.sourceUrl, sourceKey: metadata.sourceKey,
            normalizedSourceKey: metadata.sourceKey, sourceProvider: metadata.sourceProvider ?? "unknown",
            metadataStatus: "ready", metadataError: null, metadataResolvedAt: now(),
          });
          await this.persist(item);
          const coverKey = await cacheCover(item, this.cache);
          if (coverKey) { item.localCoverKey = coverKey; await this.persist(item); }
        }
        const provider = this.providers.find((candidate) => candidate.canHandle(item.sourceUrl));
        if (!provider) {
          item.mediaStatus = "unsupported"; item.mediaError = unsupportedMessage;
          item.status = "waiting"; item.errorMessage = null;
          await this.persist(item);
          continue;
        }
        item.mediaStatus = "preparing"; item.mediaError = null;
        await this.persist(item);
        const media = item.requestedMode === "video" && tabletConfig.enableVideo
          ? await provider.prepareVideo(item, this.cache)
          : await provider.prepareAudio(item, this.cache);
        if (media.playbackType === "local") {
          if (!media.mediaKey || !media.mediaType) throw new Error("Provider did not prepare local media");
          item.localMediaKey = media.mediaKey;
          item.preparedMediaType = media.mediaType;
          item.playbackType = "local";
          item.embedProvider = null;
          item.embedId = null;
          this.cache.put(item, media.mediaKey, media.mediaType, item.localCoverKey ?? undefined);
        } else if (media.playbackType === "embed") {
          if (!media.embedProvider || !media.embedId) throw new Error("Provider did not prepare embed media");
          item.playbackType = "embed";
          item.embedProvider = media.embedProvider;
          item.embedId = media.embedId;
          item.preparedMediaType = media.mediaType ?? "video";
          item.localMediaKey = null;
        } else {
          throw new Error("Unknown playback type");
        }
        item.mediaStatus = "ready";
        item.status = "ready";
        item.readyAt = now();
        item.errorMessage = null;
        await this.persist(item);

        if (this.state.tripStarted && (!this.state.currentQueueItemId || this.state.playbackStatus === "idle")) {
          await this.startItem(item);
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : "Preparation failed";
        if (item.metadataStatus === "resolving") {
          item.metadataStatus = "failed"; item.metadataError = message; item.mediaStatus = "pending";
        } else {
          item.mediaStatus = "failed"; item.mediaError = message;
        }
        item.status = "failed"; item.errorMessage = message;
        await this.persist(item);
      }
    }
  }

  current() { return this.items.find((item) => item.id === this.state.currentQueueItemId) ?? null; }

  async startTrip() {
    this.state.tripStarted = true;
    let next = selectNextPlayable(this.items, { internetOnline: this.state.internetOnline });
    if (!next) {
      await this.replenishBuffer();
      next = selectNextPlayable(this.items, { internetOnline: this.state.internetOnline });
    }
    if (next) {
      await this.startItem(next);
    }
    this.touch();
    return next ?? null;
  }

  private async startItem(item: QueueItem) {
    item.status = QueueStatus.PLAYING; item.startedAt = now(); item.finishedAt = null;
    this.state.currentQueueItemId = item.id; this.state.playbackStatus = "playing";
    this.state.playbackPositionSeconds = 0; this.state.playbackStartedAt = item.startedAt;
    await this.persist(item);
  }

  async advance(reason: "ended" | "skipped") {
    const current = this.current();
    if (current) {
      current.status = reason === "ended" ? QueueStatus.PLAYED : QueueStatus.SKIPPED;
      current.finishedAt = now();
      await this.persist(current);
    }
    this.state.currentQueueItemId = null;
    this.state.playbackPositionSeconds = 0;
    this.state.playbackStartedAt = null;

    let next = selectNextPlayable(this.items, { internetOnline: this.state.internetOnline });
    if (!next) {
      await this.replenishBuffer();
      next = selectNextPlayable(this.items, { internetOnline: this.state.internetOnline });
    }

    if (next) {
      await this.startItem(next);
    } else {
      this.state.playbackStatus = "idle";
    }
    this.touch();
    void this.replenishBuffer();
    return next ?? null;
  }

  pause() { if (this.state.currentQueueItemId) this.state.playbackStatus = "paused"; this.touch(); }
  async resume() {
    if (this.state.currentQueueItemId) {
      this.state.playbackStatus = "playing";
      this.touch();
    } else {
      await this.startTrip();
    }
  }

  updatePlaybackPosition(seconds: number) {
    if (Number.isFinite(seconds) && seconds >= 0) {
      this.state.playbackPositionSeconds = seconds;
      this.state.playerLastSeen = now();
      this.touch();
    }
  }
  skip() { return this.advance("skipped"); }
  ended() { return this.advance("ended"); }

  async processCommand(command: PlayerCommand | string) {
    if (command === "pause") this.pause();
    else if (command === "resume") this.resume();
    else if (command === "skip") await this.skip();
    else if (command === "start_trip") await this.startTrip();
    else if (command === "end_trip") { this.state.tripStarted = false; this.state.playbackStatus = "stopped"; this.touch(); }
    else if (command === "stop") { this.state.playbackStatus = "stopped"; this.touch(); }
    else if (command === "requests_enable") { this.state.requestsEnabled = true; this.touch(); }
    else if (command === "requests_disable") { this.state.requestsEnabled = false; this.touch(); }
  }

  async processPlayerCommands(commands: Array<{ id: string; command: string }>, markProcessed: (id: string) => Promise<void>) {
    for (const command of commands) { await this.processCommand(command.command); await markProcessed(command.id); }
  }

  async enqueueRequest(payload: { sourceUrl: string; requestedMode?: "audio" | "video"; requesterNickname?: string; seatNo?: number }) {
    const n = this.items.length + 1;
    const item: QueueItem = {
      id: `req-${Date.now()}-${n}`,
      roomId: tabletConfig.roomId,
      title: "New request",
      artist: "Resolving metadata...",
      durationSeconds: 0,
      sourceUrl: payload.sourceUrl,
      sourceKey: payload.sourceUrl,
      normalizedSourceKey: null,
      sourceProvider: "unknown",
      coverUrlOriginal: null,
      thumbnailUrl: null,
      metadataStatus: "pending",
      metadataError: null,
      metadataResolvedAt: null,
      mediaStatus: "pending",
      mediaError: null,
      requestedMode: payload.requestedMode === "video" ? "video" : "audio",
      anonymousRequester: false,
      sortOrder: n,
      status: "waiting",
      localMediaKey: null,
      localCoverKey: null,
      preparedMediaType: null,
      playbackType: "local",
      embedProvider: null,
      embedId: null,
      errorMessage: null,
      requestedAt: now(),
      readyAt: null,
      startedAt: null,
      finishedAt: null,
      requestedByProfileId: null,
      requesterNickname: payload.requesterNickname ?? "Student",
      seatNo: payload.seatNo ?? 1,
    };
    this.items.push(item);
    this.touch();
    void this.replenishBuffer();
    return item;
  }

  async reset() {
    this.items.length = 0;
    this.state.currentQueueItemId = null;
    this.state.playbackStatus = "idle";
    this.state.playbackPositionSeconds = 0;
    this.state.tripStarted = false;
    this.touch();
    if (this.supabase) {
      try {
        await this.supabase.from("queue_items").delete().eq("room_id", this.state.roomId);
      } catch (e) {
        console.warn("[worker] reset supabase queue error:", e);
      }
    }
  }


  getQueue() { return [...this.items].sort((a, b) => a.sortOrder - b.sortOrder); }

  async shutdown() { if (this.pollTimer) clearInterval(this.pollTimer); if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); }
}

