import { describe, expect, it } from "vitest";
import {
  calculateEta,
  calculatePreparedBuffer,
  isPlayable,
  selectNextPlayable,
  shouldPrepare,
  validateSourceUrl,
  QueueStatus,
  canEnqueue,
  publicRequesterLabel,
  recoverStalePreparing,
  parseIsoDuration,
  type QueueItem,
} from "./index.js";


const base: QueueItem = {
  id: "base",
  roomId: "r",
  requestedMode: "audio",
  anonymousRequester: true,
  title: "x",
  artist: "y",
  durationSeconds: 120,
  sourceUrl: "https://example.com/x.mp3",
  sourceKey: "direct:x",
  sourceProvider: "direct",
  metadataStatus: "ready",
  mediaStatus: "pending",
  requestedAt: "2026-01-01T00:00:00Z",
  sortOrder: 1,
  status: QueueStatus.WAITING,
};

describe("Trip Music shared rules", () => {
  it("calculates ETA from current and pending tracks", () => {
    expect(calculateEta([{ status: QueueStatus.PLAYING, durationSeconds: 180 }, { status: QueueStatus.READY, durationSeconds: 120 }], 30)).toBe(270);
  });

  it("selects the earliest playable ready item", () => {
    const result = selectNextPlayable([
      { ...base, id: "later", sortOrder: 2, status: QueueStatus.READY, localMediaKey: "b" },
      { ...base, id: "first", sortOrder: 1, status: QueueStatus.READY, localMediaKey: "a" },
      { ...base, id: "waiting", sortOrder: 0, status: QueueStatus.WAITING },
    ]);
    expect(result?.id).toBe("first");
  });

  it("correctly identifies playable items (local, embed, missing)", () => {
    // READY local MP3 -> playable
    expect(isPlayable({ status: QueueStatus.READY, playbackType: "local", localMediaKey: "song.mp3" })).toBe(true);

    // READY YouTube embed -> playable
    expect(isPlayable({ status: QueueStatus.READY, playbackType: "embed", embedProvider: "youtube", embedId: "abc12345678" })).toBe(true);

    // READY YouTube embed when offline -> not playable
    expect(isPlayable({ status: QueueStatus.READY, playbackType: "embed", embedProvider: "youtube", embedId: "abc12345678" }, { internetOnline: false })).toBe(false);

    // READY item with neither -> not playable
    expect(isPlayable({ status: QueueStatus.READY, playbackType: "embed" })).toBe(false);
    expect(isPlayable({ status: QueueStatus.READY, playbackType: "local", localMediaKey: null })).toBe(false);
    expect(isPlayable({ status: QueueStatus.READY })).toBe(false);

    // Non-ready items -> not playable
    expect(isPlayable({ status: QueueStatus.WAITING, playbackType: "local", localMediaKey: "song.mp3" })).toBe(false);
    expect(isPlayable({ status: QueueStatus.PREPARING, playbackType: "embed", embedProvider: "youtube", embedId: "abc12345678" })).toBe(false);
  });

  it("does not count YouTube embed duration in offline prepared buffer", () => {
    const items = [
      { status: QueueStatus.PLAYING, durationSeconds: 240, playbackType: "local" as const, localMediaKey: "a.mp3" },
      { status: QueueStatus.READY, durationSeconds: 180, playbackType: "embed" as const, embedProvider: "youtube" as const, embedId: "yt1" },
      { status: QueueStatus.READY, durationSeconds: 200, playbackType: "local" as const, localMediaKey: "b.mp3" },
      { status: QueueStatus.READY, durationSeconds: 300, playbackType: "embed" as const, embedProvider: "youtube" as const, embedId: "yt2" },
    ];
    // Playing: 240 - 40 = 200, YouTube embeds: 0, Local Ready: 200 -> Total 400
    expect(calculatePreparedBuffer(items, 40)).toBe(400);
  });

  it("prefers local cached item over YouTube embed when offline", () => {
    const ytItem: QueueItem = {
      ...base,
      id: "yt-1",
      sortOrder: 1,
      status: QueueStatus.READY,
      playbackType: "embed",
      embedProvider: "youtube",
      embedId: "yt123",
      sourceProvider: "youtube",
    };
    const localItem: QueueItem = {
      ...base,
      id: "local-2",
      sortOrder: 2,
      status: QueueStatus.READY,
      playbackType: "local",
      localMediaKey: "track2.mp3",
      sourceProvider: "direct",
    };

    // When online, FIFO picks #1 YouTube
    expect(selectNextPlayable([ytItem, localItem], { internetOnline: true })?.id).toBe("yt-1");

    // When offline, picks #2 Local MP3
    expect(selectNextPlayable([ytItem, localItem], { internetOnline: false })?.id).toBe("local-2");
  });

  it("stops preparation at track or buffer target", () => {
    expect(shouldPrepare([{ status: QueueStatus.READY, durationSeconds: 100, playbackType: "local", localMediaKey: "a.mp3" }], 300, 12)).toBe(true);
    expect(shouldPrepare([{ status: QueueStatus.READY, durationSeconds: 400, playbackType: "local", localMediaKey: "a.mp3" }], 300, 12)).toBe(false);
  });

  it("counts only remaining playing duration in prepared buffer", () => {
    expect(calculatePreparedBuffer([
      { status: QueueStatus.PLAYING, durationSeconds: 240, playbackType: "local", localMediaKey: "a.mp3" },
      { status: QueueStatus.READY, durationSeconds: 180, playbackType: "local", localMediaKey: "b.mp3" },
      { status: QueueStatus.READY, durationSeconds: 200, playbackType: "local", localMediaKey: "c.mp3" },
    ], 220)).toBe(400);
  });

  it("rejects private and non-http sources", () => {
    expect(validateSourceUrl("file:///tmp/song.mp3").ok).toBe(false);
    expect(validateSourceUrl("http://192.168.1.10/song.mp3").ok).toBe(false);
  });

  it("enforces the default two-pending request limit", () => {
    expect(canEnqueue(1)).toBe(true);
    expect(canEnqueue(2)).toBe(false);
    expect(canEnqueue(2, 3)).toBe(true);
  });

  it("hides anonymous requester identity in public output", () => {
    expect(publicRequesterLabel({ anonymousRequester: true, requesterNickname: "Beam" })).toBe("Passenger");
  });

  it("recovers stale preparing work", () => {
    const old = new Date(Date.now() - 300_000).toISOString();
    expect(recoverStalePreparing([{ ...base, status: QueueStatus.PREPARING, preparingAt: old }])[0].status).toBe(QueueStatus.WAITING);
  });

  it("correctly parses ISO-8601 duration strings into seconds", () => {
    expect(parseIsoDuration("PT19S")).toBe(19);
    expect(parseIsoDuration("PT0M19S")).toBe(19);
    expect(parseIsoDuration("PT3M34S")).toBe(214);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT1M")).toBe(60);
    expect(parseIsoDuration("PT2H")).toBe(7200);
    expect(parseIsoDuration("P1DT2H")).toBe(93600);
    expect(parseIsoDuration("PT0S")).toBe(0);
    expect(parseIsoDuration("")).toBe(0);
    expect(parseIsoDuration(null)).toBe(0);
    expect(parseIsoDuration(undefined)).toBe(0);
    expect(parseIsoDuration("invalid-duration")).toBe(0);
  });
});


