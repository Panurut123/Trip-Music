import { describe, expect, it, vi } from "vitest";
import { createPlayerController, fallbackCover } from "../public/player-controller.js";

function media() {
  return {
    paused: true,
    src: "",
    currentTime: 0,
    readyState: 1,
    pause: vi.fn(function() { this.paused = true; }),
    play: vi.fn(function() { this.paused = false; return Promise.resolve(); }),
    load: vi.fn(),
    removeAttribute: vi.fn(function(name) { if (name === "src") this.src = ""; }),
    addEventListener: vi.fn(),
  };
}

function ytMock() {
  return {
    videoId: null,
    position: 0,
    playing: false,
    paused: false,
    loadVideo: vi.fn(function(id, pos) { this.videoId = id; this.position = pos; this.playing = true; this.paused = false; }),
    cueVideo: vi.fn(function(id, pos) { this.videoId = id; this.position = pos; this.playing = false; this.paused = true; }),
    playVideo: vi.fn(function() { this.playing = true; this.paused = false; }),
    pauseVideo: vi.fn(function() { this.playing = false; this.paused = true; }),
    stopVideo: vi.fn(function() { this.playing = false; this.paused = false; this.videoId = null; }),
    getCurrentTime: vi.fn(function() { return this.position; }),
  };
}

const root = () => ({ classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() } });
const item = (type = "audio", key = "a.mp3") => ({ id: key, localMediaKey: key, localCoverKey: "a.jpg", preparedMediaType: type, playbackType: "local" });
const ytItem = (id = "yt-1", embedId = "abc12345678") => ({
  id,
  sourceUrl: `https://youtu.be/${embedId}`,
  sourceProvider: "youtube",
  playbackType: "embed",
  embedProvider: "youtube",
  embedId,
  thumbnailUrl: `https://i.ytimg.com/vi/${embedId}/hqdefault.jpg`,
  preparedMediaType: "video",
});

describe("bus display player controller", () => {
  it("keeps only one media element active while switching audio to video", async () => {
    const audio = media(), video = media(), controller = createPlayerController({ audio, video, cover: { style: {} }, root: root(), imageFactory: () => ({}) });
    await controller.syncPlayer({ state: { currentQueueItemId: "a.mp3", playbackStatus: "playing", playbackPositionSeconds: 0 }, queue: [item()] });
    expect(audio.src).toBe("/media/a.mp3");
    expect(audio.play).toHaveBeenCalled();
    await controller.syncPlayer({ state: { currentQueueItemId: "v.mp4", playbackStatus: "playing", playbackPositionSeconds: 0 }, queue: [item("video", "v.mp4")] });
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(video.src).toBe("/media/v.mp4");
    expect(video.play).toHaveBeenCalled();
  });

  it("activates YouTube player for embed tracks and stops audio/video", async () => {
    const audio = media(), video = media(), youtube = ytMock();
    const rootEl = root();
    const controller = createPlayerController({ audio, video, youtube, cover: { style: {} }, root: rootEl, imageFactory: () => ({}) });

    // Start with local audio
    await controller.syncPlayer({ state: { currentQueueItemId: "a.mp3", playbackStatus: "playing", playbackPositionSeconds: 0 }, queue: [item()] });
    expect(audio.src).toBe("/media/a.mp3");

    // Transition audio -> YouTube
    await controller.syncPlayer({ state: { currentQueueItemId: "yt-1", playbackStatus: "playing", playbackPositionSeconds: 15 }, queue: [ytItem("yt-1", "vidA")] });
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(youtube.loadVideo).toHaveBeenCalledWith("vidA", 15);
    expect(youtube.playVideo).toHaveBeenCalled();
    expect(rootEl.classList.toggle).toHaveBeenCalledWith("youtube-mode", true);

    // YouTube pause
    await controller.syncPlayer({ state: { currentQueueItemId: "yt-1", playbackStatus: "paused", playbackPositionSeconds: 20 }, queue: [ytItem("yt-1", "vidA")] });
    expect(youtube.pauseVideo).toHaveBeenCalled();

    // YouTube resume
    await controller.syncPlayer({ state: { currentQueueItemId: "yt-1", playbackStatus: "playing", playbackPositionSeconds: 20 }, queue: [ytItem("yt-1", "vidA")] });
    expect(youtube.playVideo).toHaveBeenCalledTimes(2);

    // Transition YouTube -> YouTube (Track B)
    await controller.syncPlayer({ state: { currentQueueItemId: "yt-2", playbackStatus: "playing", playbackPositionSeconds: 0 }, queue: [ytItem("yt-2", "vidB")] });
    expect(youtube.loadVideo).toHaveBeenCalledWith("vidB", 0);

    // Transition YouTube -> local audio (Track C)
    await controller.syncPlayer({ state: { currentQueueItemId: "c.mp3", playbackStatus: "playing", playbackPositionSeconds: 0 }, queue: [item("audio", "c.mp3")] });
    expect(youtube.stopVideo).toHaveBeenCalled();
    expect(audio.src).toBe("/media/c.mp3");
  });

  it("actually pauses and resumes the active element from server state", async () => {
    const audio = media(), controller = createPlayerController({ audio, video: media(), cover: { style: {} }, root: root(), imageFactory: () => ({}) });
    const queue = [item()];
    await controller.syncPlayer({ state: { currentQueueItemId: "a.mp3", playbackStatus: "playing" }, queue });
    await controller.syncPlayer({ state: { currentQueueItemId: "a.mp3", playbackStatus: "paused" }, queue });
    expect(audio.pause).toHaveBeenCalled();
    await controller.syncPlayer({ state: { currentQueueItemId: "a.mp3", playbackStatus: "playing" }, queue });
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("loads local cover and retains gradient fallback on failure", async () => {
    const cover = { style: {} }, images = [];
    const controller = createPlayerController({ audio: media(), video: media(), cover, root: root(), imageFactory: () => { const image = {}; images.push(image); return image; } });
    await controller.syncPlayer({ state: { currentQueueItemId: "a.mp3", playbackStatus: "paused" }, queue: [item()] });
    expect(cover.style.backgroundImage).toBe(fallbackCover("a.mp3"));
    images[0].onload();
    expect(cover.style.backgroundImage).toContain("/covers/a.jpg");
    images[0].onerror();
    expect(cover.style.backgroundImage).toBe(fallbackCover("a.mp3"));
  });

  it("reconnect snapshot clears stale audio and restores active video", async () => {
    const audio = media(), video = media();
    audio.src = "/media/stale.mp3";
    const controller = createPlayerController({ audio, video, cover: { style: {} }, root: root(), imageFactory: () => ({}) });
    await controller.syncPlayer({ state: { currentQueueItemId: "v.mp4", playbackStatus: "playing", playbackPositionSeconds: 12 }, queue: [item("video", "v.mp4")] });
    expect(audio.src).toBe("");
    expect(video.src).toBe("/media/v.mp4");
    expect(video.currentTime).toBe(12);
  });
});

