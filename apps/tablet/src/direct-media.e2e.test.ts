import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { QueueItem } from "@trip-music/shared";
import { CacheStore } from "./cache.js";
import { startLocalMediaFixture, assertLocalMediaFixtureAllowed } from "./media-fixture.js";
import { DirectMediaProvider, type MetadataResolver } from "./provider.js";
import { TripWorker } from "./worker.js";

const dirs: string[] = [], originalAllow = process.env.ALLOW_LOCAL_MEDIA_TEST;
afterEach(() => { process.env.ALLOW_LOCAL_MEDIA_TEST = originalAllow; dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })); });
const waiting = (id: string, url: string, order: number): QueueItem => ({ id, roomId: "room", title: "New request", artist: "Unknown", durationSeconds: 0, sourceUrl: url, sourceKey: url, sourceProvider: "unknown", requestedMode: "audio", anonymousRequester: true, sortOrder: order, status: "waiting", metadataStatus: "pending", mediaStatus: "pending", requestedAt: new Date(2026, 0, 1, 0, 0, order).toISOString() });

describe("development Direct MP3 fixture E2E", () => {
  it("cannot be enabled in production", () => { expect(() => assertLocalMediaFixtureAllowed({ NODE_ENV: "production", ALLOW_LOCAL_MEDIA_TEST: "true" })).toThrow(); });
  it("prepares and caches A/B/C with covers, auto-next, pause/resume, skip, and no partial files", async () => {
    process.env.ALLOW_LOCAL_MEDIA_TEST = "true";
    const fixture = await startLocalMediaFixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-e2e-")); dirs.push(dir);
    try {
      const direct = new DirectMediaProvider({ allowLocalMediaTest: true });
      const resolver: MetadataResolver = { canHandle: (url) => direct.canHandle(url), resolve: async (url) => { const metadata = await direct.resolve(url); const id = path.basename(new URL(url).pathname, ".mp3"); return { ...metadata, title: `Track ${id.toUpperCase()}`, coverUrlOriginal: `${fixture.baseUrl}/covers/${id}.jpg`, thumbnailUrl: `${fixture.baseUrl}/covers/${id}.jpg` }; } };
      const worker = new TripWorker({ cache: new CacheStore(dir), resolvers: [resolver], providers: [direct], targetBufferSeconds: 1800, maxPreparedTracks: 12 });
      worker.items.push(...fixture.trackUrls.map((url, index) => waiting(String.fromCharCode(65 + index), url, index + 1)));
      await worker.replenishBuffer();
      expect(worker.items.map((item) => item.status)).toEqual(["ready", "ready", "ready"]);
      expect(worker.items.every((item) => item.localMediaKey?.endsWith(".mp3") && worker.cache.hasMedia(item.localMediaKey))).toBe(true);
      expect(worker.items.every((item) => item.localCoverKey?.endsWith(".jpg") && worker.cache.hasCover(item.localCoverKey))).toBe(true);
      expect(fs.readdirSync(worker.cache.mediaDir).some((file) => file.endsWith(".part"))).toBe(false);
      expect((await worker.startTrip())?.id).toBe("A"); worker.pause(); expect(worker.state.playbackStatus).toBe("paused"); worker.resume(); expect(worker.state.playbackStatus).toBe("playing");
      expect((await worker.ended())?.id).toBe("B"); expect((await worker.ended())?.id).toBe("C"); expect(await worker.ended()).toBeNull();
      for (const item of worker.items) { item.status = "ready"; item.finishedAt = null; }
      worker.state.currentQueueItemId = null; expect((await worker.startTrip())?.id).toBe("A"); expect((await worker.skip())?.id).toBe("B");
    } finally { await fixture.close(); }
  }, 30_000);
});
