import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { CacheStore } from "./cache.js";
import { createServer } from "./server.js";
import { TripWorker } from "./worker.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("bus display session & server endpoints", () => {
  it("rejects anonymous controls but lets the player session control playback without ADMIN_PIN", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-server-")); dirs.push(dir);
    const app = createServer(new TripWorker({ cache: new CacheStore(dir), resolvers: [], providers: [] }), { displayToken: "test-display-token" });
    await request(app).post("/api/player/start").expect(401);
    const agent = request.agent(app); const page = await agent.get("/player").expect(200);
    expect(page.headers["set-cookie"]?.[0]).toContain("trip_display=");
    await agent.post("/api/player/start").expect(200);
  });

  it("serves zero fake songs and empty state when DEMO_MODE=false with empty queue", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-server-")); dirs.push(dir);
    const worker = new TripWorker({ cache: new CacheStore(dir), resolvers: [], providers: [] });
    const app = createServer(worker);

    const queueRes = await request(app).get("/api/queue").expect(200);
    expect(queueRes.body).toEqual([]);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.currentQueueItemId).toBeNull();
    expect(stateRes.body.playbackStatus).toBe("idle");
    expect(stateRes.body.preparedBufferSeconds).toBe(0);
    expect(stateRes.body.cachedTrackCount).toBe(0);
  });

  it("supports remote pause, resume, progress, and skip for active embed items", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-server-")); dirs.push(dir);
    const worker = new TripWorker({ cache: new CacheStore(dir), resolvers: [], providers: [] });
    worker.items.push({
      id: "yt-1",
      roomId: "room",
      title: "Real YouTube Video",
      artist: "Creator",
      durationSeconds: 200,
      sourceUrl: "https://youtu.be/abc12345678",
      sourceKey: "youtube:abc12345678",
      sourceProvider: "youtube",
      playbackType: "embed",
      embedProvider: "youtube",
      embedId: "abc12345678",
      requestedMode: "audio",
      anonymousRequester: false,
      sortOrder: 1,
      status: "ready",
      metadataStatus: "ready",
      mediaStatus: "ready",
      requestedAt: "2026-01-01T00:00:00Z",
    });

    const app = createServer(worker, { displayToken: "test-token" });
    worker.state.internetOnline = true;
    const agent = request.agent(app);
    await agent.get("/player").expect(200);

    // Start trip
    await agent.post("/api/player/start").expect(200);
    expect(worker.state.currentQueueItemId).toBe("yt-1");
    expect(worker.state.playbackStatus).toBe("playing");

    // Pause
    await agent.post("/api/player/pause").expect(200);
    expect(worker.state.playbackStatus).toBe("paused");

    // Resume
    await agent.post("/api/player/resume").expect(200);
    expect(worker.state.playbackStatus).toBe("playing");

    // Progress
    await agent.post("/api/player/progress").send({ positionSeconds: 45 }).expect(200);
    expect(worker.state.playbackPositionSeconds).toBe(45);

    // Skip
    await agent.post("/api/player/skip").expect(200);
    expect(worker.state.currentQueueItemId).toBeNull();
    expect(worker.state.playbackStatus).toBe("idle");
  });

  it("validates URLs on /api/queue/request and guards /api/reset with display session", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-server-")); dirs.push(dir);
    const worker = new TripWorker({ cache: new CacheStore(dir), resolvers: [], providers: [] });
    const app = createServer(worker, { displayToken: "test-token" });

    // Invalid or dangerous URLs should be rejected with 400
    await request(app).post("/api/queue/request").send({ sourceUrl: "javascript:alert(1)" }).expect(400);
    await request(app).post("/api/queue/request").send({ sourceUrl: "http://169.254.169.254/latest/meta-data" }).expect(400);

    // Valid YouTube URL is accepted
    await request(app).post("/api/queue/request").send({ sourceUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw" }).expect(200);

    // Anonymous reset should be rejected with 401
    await request(app).post("/api/reset").expect(401);

    // Display session reset is allowed
    const agent = request.agent(app);
    await agent.get("/player").expect(200);
    await agent.post("/api/reset").expect(200);
  });
});



