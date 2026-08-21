"use client";
import { useEffect, useMemo, useState } from "react";
import { demoCover, demoItems, demoState } from "@/lib/demo";
import { StudentNav } from "@/components/StudentNav";
import { calculateEta, type QueueItem, type SystemState } from "@trip-music/shared";
import { getSupabase } from "@/lib/supabase";
import { mapQueueRow, mapStateRow } from "@/lib/data";
import { clearProfile, getStoredProfile, type StoredTripProfile } from "@/lib/profile-storage";
import { webConfig } from "@/lib/config";
import { resolveRoomId } from "@/lib/room";
import { formatSeatLabel } from "@/lib/seat";

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>(webConfig.demoMode ? demoItems : []);
  const [state, setState] = useState<SystemState | null>(webConfig.demoMode ? demoState : null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [requestedMode, setRequestedMode] = useState<"audio" | "video">("audio");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState<StoredTripProfile | null>(null);

  const isYouTubeInput = /(?:youtube\.com|youtu\.be)/i.test(sourceUrl);
  const directAudioInput = /\.(?:mp3|m4a|wav)(?:[?#]|$)/i.test(sourceUrl) && !isYouTubeInput;
  const directVideoInput = /\.(?:mp4|webm)(?:[?#]|$)/i.test(sourceUrl) && !isYouTubeInput;
  const effectiveMode: "audio" | "video" = directAudioInput ? "audio" : directVideoInput ? "video" : requestedMode;
  const activeItems = items.filter(i => ["waiting", "preparing", "ready", "playing"].includes(i.status));
  const current = items.find(i => i.id === state?.currentQueueItemId) ?? items.find(i => i.status === "playing") ?? null;
  const pending = activeItems.filter(i => i.id !== current?.id && ["waiting", "preparing", "ready"].includes(i.status));
  const recentlyPlayed = useMemo(() => {
    return items
      .filter(i => ["played", "skipped"].includes(i.status))
      .sort((a, b) => (b.finishedAt ? Date.parse(b.finishedAt) : 0) - (a.finishedAt ? Date.parse(a.finishedAt) : 0));
  }, [items]);
  const latestFailed = useMemo(() => items
    .filter(i => i.status === "failed" && Boolean(profile) && i.seatNo === profile?.seatNo)
    .sort((a, b) => Date.parse(b.finishedAt ?? b.requestedAt) - Date.parse(a.finishedAt ?? a.requestedAt))[0] ?? null, [items, profile]);
  const eta = useMemo(() => calculateEta(activeItems, state?.playbackPositionSeconds ?? 0), [activeItems, state?.playbackPositionSeconds]);


  const tabletBase = typeof window !== "undefined" ? `http://${window.location.hostname}:3000` : "http://localhost:3000";

  useEffect(() => {
    if (webConfig.demoMode) return;
    let cancelled = false;

    const storedProfile = getStoredProfile();
    setProfile(storedProfile);
    if (!storedProfile && !webConfig.demoMode && typeof window !== "undefined") {
      window.location.href = "/login";
      return;
    }

    const initAuth = async () => {
      const supabase = getSupabase();
      if (!supabase || webConfig.demoMode) return;
      try {
        const sessionRes = await supabase.auth.getSession();
        if (!sessionRes.data.session) {
          await supabase.auth.signInAnonymously();
        }
        if (storedProfile) {
          const roomId = await resolveRoomId(supabase);
          const { error: claimError } = await supabase.rpc("claim_seat", {
            p_room_id: roomId,
            p_seat_no: storedProfile.seatNo,
            p_nickname: null,
            p_device_id: storedProfile.deviceId,
            p_pin: storedProfile.pin,
          });
          if (claimError) {
            clearProfile();
            window.location.href = "/login";
            return;
          }
        }
      } catch {}
    };

    void initAuth();

    const verifySeatAccess = async () => {
      if (!storedProfile) return;
      const supabase = getSupabase();
      if (!supabase) return;
      try {
        const roomId = await resolveRoomId(supabase);
        const { data } = await supabase.rpc("seat_status", { p_room_id: roomId, p_seat_no: storedProfile.seatNo });
        if (data?.login_enabled === false) {
          clearProfile();
          window.location.href = "/login";
        }
      } catch {}
    };
    void verifySeatAccess();
    const accessInterval = setInterval(() => { void verifySeatAccess(); }, 10_000);

    const loadFromTablet = async () => {
      try {
        const [qRes, sRes] = await Promise.all([
          fetch(`${tabletBase}/api/queue`),
          fetch(`${tabletBase}/api/state`),
        ]);
        if (qRes.ok && !cancelled) {
          const qData = await qRes.json();
          if (Array.isArray(qData)) setItems(qData);
        }
        if (sRes.ok && !cancelled) {
          const sData = await sRes.json();
          if (sData) setState(sData);
        }
      } catch {}
    };

    const loadFromSupabase = async () => {
      const supabase = getSupabase();
      if (!supabase) { await loadFromTablet(); return; }
      const roomId = await resolveRoomId(supabase);
      try {
        const [q, s] = await Promise.all([
          supabase.from("queue_items").select("*").eq("room_id", roomId).order("sort_order"),
          supabase.from("system_state").select("*").eq("room_id", roomId).maybeSingle(),
        ]);
        if (cancelled) return;
        if (q.data) setItems(q.data.map(row => mapQueueRow(row as Record<string, unknown>)));
        else await loadFromTablet();
        if (s.data) setState(mapStateRow(s.data as Record<string, unknown>));
      } catch {
        await loadFromTablet();
      }
    };

    void loadFromSupabase();
    const pollInterval = setInterval(() => { void loadFromSupabase(); }, 2500);

    const supabase = getSupabase();
    let channel: any = null;
    if (supabase) {
      channel = supabase.channel("trip-music-queue")
        .on("postgres_changes", { event: "*", schema: "public", table: "queue_items" }, () => void loadFromSupabase())
        .on("postgres_changes", { event: "*", schema: "public", table: "system_state" }, () => void loadFromSupabase())
        .subscribe();
    }
    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      clearInterval(accessInterval);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, []);

  async function addRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceUrl.trim()) return;
    setSubmitting(true);
    setMessage("");
    const activeProfile = getStoredProfile();
    if (!activeProfile) { setSubmitting(false); window.location.href = "/login"; return; }
    const deviceId = activeProfile.deviceId;

    try {
      let enqueued = false;
      const supabase = getSupabase();
      if (!webConfig.demoMode && supabase) {
        try {
          const roomId = await resolveRoomId(supabase);
          const { data, error } = await supabase.rpc("enqueue_track", {
            p_room_id: roomId,
            p_source_url: sourceUrl.trim(),
            p_requested_mode: effectiveMode,
            p_device_id: deviceId,
          });
          if (!error && data) {
            setItems(v => [...v, mapQueueRow(data as unknown as Record<string, unknown>)]);
            enqueued = true;
          } else if (error) {
            const errStr = String(error.message || "");
            if (errStr.includes("pending limit") || errStr.includes("duplicate") || errStr.includes("blocked") || errStr.includes("requests disabled") || errStr.includes("profile required") || errStr.includes("authentication")) {
              throw error;
            }
          }
        } catch (supaErr) {
          const errStr = String((supaErr as any)?.message || "");
          if (errStr.includes("pending limit") || errStr.includes("duplicate") || errStr.includes("blocked") || errStr.includes("requests disabled") || errStr.includes("profile required") || errStr.includes("authentication")) {
            throw supaErr;
          }
        }
      }

      if (!enqueued && !webConfig.demoMode && webConfig.allowTabletQueueFallback) {
        const res = await fetch(`${tabletBase}/api/queue/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: sourceUrl.trim(),
            requestedMode: effectiveMode,
            requesterNickname: activeProfile.nickname,
            seatNo: activeProfile.seatNo,
          }),
        });
        if (res.ok) {
          const item = await res.json();
          setItems(v => [...v.filter(x => x.id !== item.id), item]);
          enqueued = true;
        }
      }

      if (!enqueued && !webConfig.demoMode) {
        throw new Error("queue unavailable");
      }

      if (enqueued) {
        const isYt = /youtube\.com|youtu\.be/.test(sourceUrl);
        setMessage(isYt ? `เพิ่มเพลงเข้าคิวแล้ว • กำลังเตรียม ${effectiveMode === "audio" ? "MP3" : "MP4"} บนเครื่องเล่น` : "เพิ่มเพลงเข้าคิวแล้ว");
        setSourceUrl("");
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String((error as any).message) : "";
      if (raw.includes("pending limit")) {
        setMessage("คุณมีเพลงรออยู่ในคิวครบ 2 เพลงแล้ว");
      } else if (raw.includes("duplicate")) {
        setMessage("เพลงนี้มีคนขออยู่ในคิวแล้ว");
      } else if (raw.includes("requests disabled")) {
        setMessage("ขณะนี้ปิดรับคำขอเพลงชั่วคราว");
      } else if (raw.includes("login_disabled")) {
        clearProfile();
        setMessage("เลขที่นี้ถูกปิดใช้งานชั่วคราว");
        setTimeout(() => { window.location.href = "/login"; }, 700);
      } else if (raw.includes("blocked")) {
        setMessage("บัญชีนี้ถูกระงับการขอเพลง");
      } else if (raw.includes("profile required") || raw.includes("authentication")) {
        clearProfile();
        setMessage("เซสชันหมดอายุ กำลังพากลับไปหน้าเข้าใช้งาน…");
        setTimeout(() => { window.location.href = "/login"; }, 600);
      } else {
        setMessage("ไม่สามารถส่งเพลงได้ ตรวจสอบลิงก์อีกครั้ง");
      }
    } finally {
      setSubmitting(false);
    }
  }




  const display = (item: QueueItem | null) => {
    if (!item) return "";
    if (item.metadataStatus === "pending" || item.metadataStatus === "resolving") return "กำลังอ่านข้อมูลเพลง...";
    if (item.metadataStatus === "failed") return "อ่านข้อมูลเพลงไม่ได้";
    return item.title;
  };

  return (
    <div className="mobile-page student-app">
      <StudentNav active="queue" />
      <main className="mobile-content queue-screen" id="queue">
        <section className="student-hero">
          <div>
            <p className="eyebrow">6/18 FIELD TRIP • 2026</p>
            <h1 className="page-title">คิวเพลง</h1>
            <p className="subline">
              <strong>{activeItems.length}</strong> เพลงในคิว <span aria-hidden="true">•</span> รอประมาณ <strong>{activeItems.length ? Math.max(1, Math.round(eta / 60)) : 0}</strong> นาที
            </p>
          </div>
          {profile && <div className="profile-chip"><span>YOU</span><b>{profile.nickname}</b><small>{formatSeatLabel(profile.seatNo)}</small></div>}
        </section>

        <section className="queue-main-grid">
          <div className="queue-primary-column">
            <div className="section-heading">
              <div><span className="eq-icon" aria-hidden="true"><i/><i/><i/><i/></span><h2>NOW PLAYING</h2></div>
              <span className={`live-state ${current ? "on" : ""}`}>{current ? "LIVE" : state?.tripStarted ? "WAITING" : "READY"}</span>
            </div>

            {current ? (
              <article className="now-card glass premium-now-card">
                <div className="now-art-wrap">
                  <div className="cover" style={{ backgroundImage: current.thumbnailUrl || current.coverUrlOriginal ? `url(${current.thumbnailUrl || current.coverUrlOriginal})` : demoCover(current.id) }} />
                  <span className="playing-bars" aria-hidden="true"><i/><i/><i/><i/></span>
                </div>
                <div className="now-copy">
                  <div className="track-title">{display(current)}</div>
                  <div className="track-artist">{current.artist}</div>
                  <div className="now-meta-row">
                    <span className="source-badge">{current.playbackType === "embed" ? "YOUTUBE • ONLINE" : current.preparedMediaType === "video" ? "LOCAL • VIDEO" : "LOCAL • AUDIO"}</span>
                    <span>ขอโดย {current.requesterNickname ?? "Passenger"}{current.seatNo ? ` • ${formatSeatLabel(current.seatNo)}` : ""}</span>
                  </div>
                </div>
                <div className="now-progress-track" aria-hidden="true"><span /></div>
              </article>
            ) : (
              <div className="glass queue-waiting-card premium-empty">
                <span className="empty-orb">♫</span>
                <div>
                  <strong>{state?.tripStarted ? (pending.length ? "กำลังเตรียมเพลงถัดไป…" : "คิวว่างแล้ว") : "พร้อมออกเดินทาง"}</strong>
                  <span>{state?.tripStarted ? (pending.length ? "เพลงพร้อมเมื่อไร ระบบจะเล่นต่อให้อัตโนมัติ" : "รอเพลงใหม่จากเพื่อน ๆ") : "ขอเพลงแรกแล้วเริ่มทริปได้เลย"}</span>
                </div>
              </div>
            )}

            <section className="request-panel glass request-composer" id="request">
              <div className="composer-head">
                <div><p className="eyebrow">REQUEST A TRACK</p><h2>อยากฟังเพลงอะไร?</h2></div>
                <span className="request-limit">สูงสุด 2 เพลงรอ/คน</span>
              </div>

              <div className="mode-toggle premium-mode-toggle">
                <button type="button" className={`mode-toggle-btn ${requestedMode === "audio" ? "active" : ""}`} onClick={() => setRequestedMode("audio")}>
                  <span className="mode-icon">♫</span><span><b>Audio</b><small>{isYouTubeInput ? "เตรียมเป็น MP3" : "เสียง"}</small></span>
                </button>
                <button type="button" className={`mode-toggle-btn ${requestedMode === "video" ? "active" : ""}`} onClick={() => setRequestedMode("video")}>
                  <span className="mode-icon">▸</span><span><b>Video</b><small>{isYouTubeInput ? "เตรียมเป็น MP4" : "วิดีโอ"}</small></span>
                </button>
              </div>

              {isYouTubeInput ? (
                <div className="source-detected youtube"><b>YOUTUBE • LOCAL CACHE</b><span>Trip Music จะเตรียม {requestedMode === "audio" ? "MP3" : "MP4"} ลง Tab แล้วเล่นจากเครื่องโดยตรง</span></div>
              ) : directAudioInput ? (
                <div className="source-detected"><b>LOCAL AUDIO</b><span>พบลิงก์ไฟล์เสียงโดยตรง</span></div>
              ) : directVideoInput ? (
                <div className="source-detected"><b>LOCAL VIDEO</b><span>พบลิงก์ไฟล์วิดีโอโดยตรง</span></div>
              ) : null}

              <form onSubmit={addRequest} className="request-form">
                <div className="url-input-wrap">
                  <span className="url-icon" aria-hidden="true">↗</span>
                  <input className="text-input" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="วางลิงก์ YouTube หรือ Direct Media" maxLength={500} inputMode="url" />
                </div>
                <button className="secondary-button request-submit" disabled={submitting || !sourceUrl.trim()}>{submitting ? "กำลังส่ง…" : "ขอเพลง"}<span aria-hidden="true">→</span></button>
              </form>
              {message && <p className="request-message" role="status">{message}</p>}
              {latestFailed && (
                <div className="request-failure" role="status">
                  <div className="failure-icon">!</div>
                  <div><b>เพลงล่าสุดเตรียมไม่สำเร็จ</b><span>{/unembeddable|embedding|youtube_error_(101|150)/i.test(`${latestFailed.metadataError ?? ""} ${latestFailed.mediaError ?? ""}`)
                    ? "ระบบข้ามเพลงนี้แล้ว ลองส่งลิงก์อื่นได้ทันที"
                    : /youtube_error_100/i.test(latestFailed.mediaError ?? "")
                    ? "วิดีโอนี้ไม่พร้อมใช้งานแล้ว ขอเพลงอื่นได้ทันที"
                    : "เพลงนี้ไม่กินโควตาคิวของคุณ คุณขอใหม่ได้ทันที"}</span></div>
                </div>
              )}
            </section>
          </div>

          <aside className="queue-secondary-column">
            <div className="section-heading compact-heading"><div><span className="queue-lines" aria-hidden="true">≡</span><h2>UP NEXT</h2></div><span>{pending.length}</span></div>
            {pending.length > 0 ? (
              <div className="queue-list premium-queue-list">
                {pending.map((item, i) => {
                  const mine = Boolean(profile && item.seatNo === profile.seatNo);
                  return (
                    <article className={`queue-row ${mine ? "mine" : ""}`} key={item.id}>
                      <div className="queue-number">{String(i + 1).padStart(2, "0")}</div>
                      <div className="cover sm" style={{ backgroundImage: item.thumbnailUrl || item.coverUrlOriginal ? `url(${item.thumbnailUrl || item.coverUrlOriginal})` : demoCover(item.id) }} />
                      <div className="queue-meta">
                        <div className="track-title">{display(item)}</div>
                        <div className="track-artist">{item.metadataStatus === "failed" ? "" : item.artist}</div>
                        <div className="queue-foot">{mine ? "★ เพลงของคุณ" : `ขอโดย ${item.requesterNickname ?? "Passenger"}`}</div>
                      </div>
                      <div className="queue-row-end">
                        <span className="mode-badge">{item.playbackType === "embed" ? "YT" : item.requestedMode === "video" ? "VIDEO" : "AUDIO"}</span>
                        <span className="duration">{item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}` : "--:--"}</span>
                        <span className={`prep-state ${item.status}`}>{item.status === "ready" ? "READY" : item.status === "preparing" ? "PREPARING" : item.status === "waiting" ? "WAITING" : item.status.toUpperCase()}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mini-empty glass"><span>✓</span><b>คิวถัดไปว่าง</b><small>เพลงใหม่จะขึ้นตรงนี้</small></div>
            )}
          </aside>
        </section>

        {recentlyPlayed.length > 0 && (
          <section className="recent-section">
            <div className="section-heading compact-heading"><div><span className="history-symbol">↺</span><h2>RECENTLY PLAYED</h2></div><a href="/history">ดูทั้งหมด →</a></div>
            <div className="recent-scroller">
              {recentlyPlayed.slice(0, 6).map(item => (
                <article className="recent-card" key={item.id}>
                  <div className="cover" style={{ backgroundImage: item.thumbnailUrl || item.coverUrlOriginal ? `url(${item.thumbnailUrl || item.coverUrlOriginal})` : demoCover(item.id) }} />
                  <div className="track-title">{display(item)}</div>
                  <div className="track-artist">{item.artist}</div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
