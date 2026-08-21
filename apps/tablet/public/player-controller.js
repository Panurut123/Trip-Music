export function fallbackCover(seed) {
  const value = String(seed ?? "trip");
  return `linear-gradient(135deg,hsl(${(value.length * 53) % 360} 70% 28%),#10131a 55%,hsl(${(value.length * 91) % 360} 80% 48%))`;
}

export function createPlayerController({
  audio,
  video,
  youtube,
  cover,
  root = document.body,
  imageFactory = () => new Image(),
}) {
  let activeType = null;
  let activeKey = null;

  function stopAndClear(element) {
    if (!element) return;
    try {
      element.pause();
      element.removeAttribute("src");
      element.load();
    } catch {}
  }

  function syncCover(item) {
    if (!cover) return;
    const fallback = fallbackCover(item?.id);
    cover.style.backgroundImage = fallback;
    const coverSource = item?.localCoverKey
      ? `/covers/${encodeURIComponent(item.localCoverKey)}`
      : item?.thumbnailUrl || item?.coverUrlOriginal || null;

    if (!coverSource) return;
    const image = imageFactory();
    image.onload = () => {
      cover.style.backgroundImage = `url("${coverSource}")`;
    };
    image.onerror = () => {
      cover.style.backgroundImage = fallback;
    };
    image.src = coverSource;
  }

  async function syncPlayer(snapshot) {
    const state = snapshot?.state ?? {};
    const queue = snapshot?.queue ?? [];
    const current = queue.find((item) => item.id === state.currentQueueItemId) ?? null;
    syncCover(current);

    const isPlaybackActive = ["playing", "paused"].includes(state.playbackStatus);
    const isEmbed = current?.playbackType === "embed" && current?.embedProvider === "youtube" && Boolean(current?.embedId);
    const isLocal = Boolean(current?.localMediaKey);

    if (!current || (!isEmbed && !isLocal) || !isPlaybackActive) {
      if (audio) audio.pause();
      if (video) video.pause();
      if (youtube && typeof youtube.stopVideo === "function") youtube.stopVideo();

      if (!current) {
        stopAndClear(audio);
        stopAndClear(video);
        if (youtube && typeof youtube.stopVideo === "function") youtube.stopVideo();
        activeType = null;
        activeKey = null;
        root.classList.remove("video-mode");
        root.classList.remove("youtube-mode");
      }
      return null;
    }

    let type = "audio";
    let key = "";

    if (isEmbed) {
      type = "youtube";
      key = `youtube:${current.embedId}`;
    } else if (current.preparedMediaType === "video") {
      type = "video";
      key = `video:${current.localMediaKey}`;
    } else {
      type = "audio";
      key = `audio:${current.localMediaKey}`;
    }

    // Stop inactive players when switching type or on initial sync
    if (activeType !== type) {
      if (type !== "audio") stopAndClear(audio);
      if (type !== "video") stopAndClear(video);
      if (type !== "youtube" && youtube && typeof youtube.stopVideo === "function") youtube.stopVideo();
    }


    root.classList.toggle("video-mode", type === "video" || type === "youtube");
    root.classList.toggle("youtube-mode", type === "youtube");

    if (type === "youtube") {
      if (youtube) {
        const position = Number(state.playbackPositionSeconds ?? 0);
        if (activeKey !== key) {
          if (state.playbackStatus === "playing") {
            if (typeof youtube.loadVideo === "function") {
              youtube.loadVideo(current.embedId, position);
            } else if (typeof youtube.loadVideoById === "function") {
              youtube.loadVideoById({ videoId: current.embedId, startSeconds: position });
            }
            if (typeof youtube.playVideo === "function") youtube.playVideo();
          } else {
            if (typeof youtube.cueVideo === "function") {
              youtube.cueVideo(current.embedId, position);
            } else if (typeof youtube.cueVideoById === "function") {
              youtube.cueVideoById({ videoId: current.embedId, startSeconds: position });
            }
          }
          activeKey = key;
          activeType = type;
        } else {
          if (state.playbackStatus === "paused" && typeof youtube.pauseVideo === "function") {
            youtube.pauseVideo();
          } else if (state.playbackStatus === "playing" && typeof youtube.playVideo === "function") {
            youtube.playVideo();
          }
        }
      }
      return youtube;
    }

    const active = type === "video" ? video : audio;
    if (!active) return null;

    if (activeKey !== key) {
      active.pause();
      active.src = `/media/${encodeURIComponent(current.localMediaKey)}`;
      active.load();
      const position = Number(state.playbackPositionSeconds ?? 0);
      if (position > 0) {
        const seek = () => { try { active.currentTime = position; } catch {} };
        if (active.readyState >= 1) seek();
        else active.addEventListener("loadedmetadata", seek, { once: true });
      }
      activeKey = key;
      activeType = type;
    }

    if (state.playbackStatus === "paused") {
      active.pause();
    } else if (active.paused) {
      await active.play().catch(() => undefined);
    }
    return active;
  }

  function stop() {
    stopAndClear(audio);
    stopAndClear(video);
    if (youtube && typeof youtube.stopVideo === "function") youtube.stopVideo();
    activeType = null;
    activeKey = null;
    root.classList.remove("video-mode");
    root.classList.remove("youtube-mode");
  }

  return {
    syncPlayer,
    syncCover,
    stop,
    getActiveType: () => activeType,
    getActiveKey: () => activeKey,
  };
}

