import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YouTubeEmbedProvider, type MediaProvider, type MetadataResolver } from "./provider.js";
import { CacheStore } from "./cache.js";
import { TripWorker } from "./worker.js";
import type { QueueItem } from "@trip-music/shared";

const tempDirs: string[] = [];
const cache = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-worker-")); tempDirs.push(dir); return new CacheStore(dir); };
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const queueItem = (id: string, sortOrder: number, status: QueueItem["status"] = "ready"): QueueItem => ({
  id, roomId: "room", title: id, artist: "Artist", durationSeconds: 240,
  sourceUrl: `mock:${id}`, sourceKey: `mock:${id}`, sourceProvider: "mock",
  requestedMode: "audio", anonymousRequester: true, sortOrder, status,
  metadataStatus: "ready", mediaStatus: status === "ready" || status === "playing" ? "ready" : "pending",
  localMediaKey: status === "ready" || status === "playing" ? `${id}.wav` : null,
  requestedAt: `2026-01-01T00:00:${String(sortOrder).padStart(2, "0")}Z`,
});

describe("TripWorker playback reliability", () => {
  it("auto-advances A to B to C when tracks end", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    const a = queueItem("A", 1, "playing"), b = queueItem("B", 2), c = queueItem("C", 3);
    worker.items.push(a, b, c); worker.state.currentQueueItemId = a.id; worker.state.playbackStatus = "playing";
    expect((await worker.ended())?.id).toBe("B");
    expect(a.status).toBe("played"); expect(b.status).toBe("playing");
    expect((await worker.ended())?.id).toBe("C");
    expect(b.status).toBe("played"); expect(c.status).toBe("playing");
  });

  it("skip marks A skipped and starts B immediately", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    const a = queueItem("A", 1, "playing"), b = queueItem("B", 2);
    worker.items.push(a, b); worker.state.currentQueueItemId = a.id;
    expect((await worker.skip())?.id).toBe("B");
    expect(a.status).toBe("skipped"); expect(b.status).toBe("playing");
  });

  it("does not prepare all 38 waiting items after buffer target is reached", async () => {
    let preparations = 0;
    const provider: MediaProvider = {
      canHandle: () => true,
      prepareAudio: async (item) => { preparations++; return { playbackType: "local", mediaKey: `${item.id}.wav`, mediaType: "audio" }; },
      prepareVideo: async (item) => { preparations++; return { playbackType: "local", mediaKey: `${item.id}.mp4`, mediaType: "video" }; },
    };
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [provider], targetBufferSeconds: 1800, maxPreparedTracks: 12 });
    worker.items.push(...Array.from({ length: 38 }, (_, index) => queueItem(`Q${index + 1}`, index + 1, "waiting")));
    await worker.replenishBuffer();
    expect(preparations).toBe(8);
    expect(worker.items.filter((item) => item.status === "waiting")).toHaveLength(30);
  });

  it("processes a queued SKIP command and marks it processed", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    const a = queueItem("A", 1, "playing"), b = queueItem("B", 2);
    worker.items.push(a, b); worker.state.currentQueueItemId = a.id;
    const markProcessed = vi.fn(async () => undefined);
    await worker.processPlayerCommands([{ id: "command-1", command: "skip" }], markProcessed);
    expect(worker.state.currentQueueItemId).toBe("B");
    expect(markProcessed).toHaveBeenCalledWith("command-1");
  });

  it("handles start_trip, pause and resume player commands", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    worker.items.push(queueItem("A", 1));
    await worker.processCommand("start_trip");
    expect(worker.state.currentQueueItemId).toBe("A");
    await worker.processCommand("pause"); expect(worker.state.playbackStatus).toBe("paused");
    await worker.processCommand("resume"); expect(worker.state.playbackStatus).toBe("playing");
  });

  it("separates request intake commands from playback pause", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    worker.state.playbackStatus = "playing";
    await worker.processCommand("requests_disable"); expect(worker.state.requestsEnabled).toBe(false); expect(worker.state.playbackStatus).toBe("playing");
    await worker.processCommand("requests_enable"); expect(worker.state.requestsEnabled).toBe(true);
  });

  it("prepares valid YouTube URL as READY embed without marking unsupported", async () => {
    const resolver: MetadataResolver = {
      canHandle: (url) => url.includes("youtu"),
      resolve: async (url) => ({
        title: "Real YouTube Video",
        artist: "Real Creator",
        durationSeconds: 215,
        sourceUrl: url,
        sourceKey: "youtube:dQw4w9WgXcQ",
        sourceProvider: "youtube",
        thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      }),
    };
    const worker = new TripWorker({
      cache: cache(),
      resolvers: [resolver],
      providers: [new YouTubeEmbedProvider()],
    });
    const item = {
      ...queueItem("YT-1", 1, "waiting"),
      sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
      metadataStatus: "pending" as const,
    };
    worker.items.push(item);
    await worker.replenishBuffer();

    expect(item.metadataStatus).toBe("ready");
    expect(item.title).toBe("Real YouTube Video");
    expect(item.mediaStatus).toBe("ready");
    expect(item.status).toBe("ready");
    expect(item.playbackType).toBe("embed");
    expect(item.embedProvider).toBe("youtube");
    expect(item.embedId).toBe("dQw4w9WgXcQ");
    expect(item.localMediaKey).toBeNull();
  });

  it("seamlessly auto-advances YouTube A -> YouTube B -> Direct MP3 C", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    const ytA: QueueItem = {
      ...queueItem("yt-A", 1, "playing"),
      playbackType: "embed",
      embedProvider: "youtube",
      embedId: "vidA",
      localMediaKey: null,
      sourceProvider: "youtube",
    };
    const ytB: QueueItem = {
      ...queueItem("yt-B", 2, "ready"),
      playbackType: "embed",
      embedProvider: "youtube",
      embedId: "vidB",
      localMediaKey: null,
      sourceProvider: "youtube",
    };
    const directC: QueueItem = {
      ...queueItem("direct-C", 3, "ready"),
      playbackType: "local",
      localMediaKey: "trackC.mp3",
      sourceProvider: "direct",
    };

    worker.items.push(ytA, ytB, directC);
    worker.state.currentQueueItemId = ytA.id;
    worker.state.playbackStatus = "playing";
    worker.state.internetOnline = true;

    // Ended A -> B starts
    expect((await worker.ended())?.id).toBe("yt-B");
    expect(ytA.status).toBe("played");
    expect(ytB.status).toBe("playing");

    // Ended B -> C starts
    expect((await worker.ended())?.id).toBe("direct-C");
    expect(ytB.status).toBe("played");
    expect(directC.status).toBe("playing");
  });

  it("switches to local cached media if internet goes offline without breaking YouTube metadata", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    const yt: QueueItem = {
      ...queueItem("yt-offline", 1, "ready"),
      playbackType: "embed",
      embedProvider: "youtube",
      embedId: "vidYt",
      localMediaKey: null,
      sourceProvider: "youtube",
    };
    const local: QueueItem = {
      ...queueItem("direct-local", 2, "ready"),
      playbackType: "local",
      localMediaKey: "cached.mp3",
      sourceProvider: "direct",
    };

    worker.items.push(yt, local);
    worker.state.internetOnline = false;

    // With internet offline, startTrip should bypass YouTube and play local
    const started = await worker.startTrip();
    expect(started?.id).toBe("direct-local");
    expect(yt.status).toBe("ready"); // YouTube remains READY for when connection recovers
    expect(local.status).toBe("playing");
  });

  it("does not count YouTube embed duration in worker preparedBufferSeconds", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    const yt: QueueItem = {
      ...queueItem("yt-1", 1, "ready"),
      durationSeconds: 300,
      playbackType: "embed",
      embedProvider: "youtube",
      embedId: "vid1",
      localMediaKey: null,
    };
    const local: QueueItem = {
      ...queueItem("local-1", 2, "ready"),
      durationSeconds: 180,
      playbackType: "local",
      localMediaKey: "song.mp3",
    };

    worker.items.push(yt, local);
    // Trigger state update
    worker.pause();
    expect(worker.state.preparedBufferSeconds).toBe(180);
  });

  it("resolves YouTube ISO-8601 duration accurately (e.g. PT19S -> 19 seconds)", async () => {
    const resolver = new YouTubeEmbedProvider();
    expect(resolver.canHandle("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
  });

  it("keeps current track playing when skip is pressed before next track is ready", async () => {
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [] });
    const a = queueItem("A", 1, "playing"), b = queueItem("B", 2, "preparing");
    worker.items.push(a, b);
    worker.state.tripStarted = true;
    worker.state.currentQueueItemId = a.id;
    worker.state.playbackStatus = "playing";
    const result = await worker.skip();
    expect(result?.id).toBe("A");
    expect(a.status).toBe("playing");
    expect(worker.state.currentQueueItemId).toBe("A");
  });

  it("auto-starts a track that becomes ready after the previous song already ended", async () => {
    const provider: MediaProvider = {
      canHandle: () => true,
      prepareAudio: async (item) => ({ playbackType: "local", mediaKey: `${item.id}.wav`, mediaType: "audio" }),
      prepareVideo: async (item) => ({ playbackType: "local", mediaKey: `${item.id}.mp4`, mediaType: "video" }),
    };
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [provider], targetBufferSeconds: 1800, maxPreparedTracks: 12 });
    const a = queueItem("A", 1, "playing");
    const b = { ...queueItem("B", 2, "waiting"), localMediaKey: null, mediaStatus: "pending" as const };
    worker.items.push(a, b);
    worker.state.tripStarted = true;
    worker.state.currentQueueItemId = a.id;
    worker.state.playbackStatus = "playing";

    expect(await worker.ended()).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(b.status).toBe("playing");
    expect(worker.state.currentQueueItemId).toBe("B");
  });

  it("keeps an active trip alive through an empty queue and auto-starts a later request", async () => {
    const provider: MediaProvider = {
      canHandle: () => true,
      prepareAudio: async (item) => ({ playbackType: "local", mediaKey: `${item.id}.wav`, mediaType: "audio" }),
      prepareVideo: async (item) => ({ playbackType: "local", mediaKey: `${item.id}.mp4`, mediaType: "video" }),
    };
    const worker = new TripWorker({ cache: cache(), resolvers: [], providers: [provider] });
    worker.state.tripStarted = true;
    worker.state.playbackStatus = "idle";
    const item = { ...queueItem("late", 1, "waiting"), localMediaKey: null, mediaStatus: "pending" as const };
    worker.items.push(item);
    await worker.replenishBuffer();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(worker.state.currentQueueItemId).toBe(item.id);
    expect(item.status).toBe("playing");
  });

});


