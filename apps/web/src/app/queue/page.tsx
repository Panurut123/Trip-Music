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

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>(webConfig.demoMode ? demoItems : []);
  const [state, setState] = useState<SystemState | null>(webConfig.demoMode ? demoState : null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [requestedMode, setRequestedMode] = useState<"audio" | "video">("audio");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState<StoredTripProfile | null>(null);

  const current = items.find(i => i.id === state?.currentQueueItemId) ?? items.find(i => i.status === "playing") ?? null;
  const pending = items.filter(i => ["waiting", "preparing", "ready"].includes(i.status));
  const recentlyPlayed = useMemo(() => {
    return items
      .filter(i => ["played", "skipped"].includes(i.status))
      .sort((a, b) => (b.finishedAt ? Date.parse(b.finishedAt) : 0) - (a.finishedAt ? Date.parse(a.finishedAt) : 0));
  }, [items]);
  const eta = useMemo(() => calculateEta(items, state?.playbackPositionSeconds ?? 0), [items, state?.playbackPositionSeconds]);


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
            p_requested_mode: requestedMode,
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
            requestedMode,
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
        setMessage(isYt ? "เพิ่มเพลงเข้าคิวแล้ว (YouTube • Online)" : "เพิ่มเพลงเข้าคิวแล้ว");
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
    <div className="mobile-page">
      <StudentNav active="queue" />
      <main className="mobile-content">
        <p className="eyebrow">6/18 FIELD TRIP • 2026</p>
        <h1 className="page-title">คิวเพลง</h1>
        <p className="subline">
          {items.length} เพลงในคิว <span aria-hidden="true">•</span> เวลารอประมาณ {items.length ? Math.max(1, Math.round(eta / 60)) : 0} นาที
        </p>

        {items.length === 0 ? (
          <div className="glass" style={{ textAlign: "center", padding: "40px 20px", marginTop: 24, borderRadius: 24 }}>
            <p style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>ยังไม่มีเพลงในคิว</p>
            <p style={{ color: "var(--muted)", margin: 0 }}>ส่งเพลงแรกของทริปได้เลย 🎵</p>
          </div>
        ) : (
          <>
            <h2 className="section-label">▮ NOW PLAYING</h2>
            {current ? (
              <article className="now-card glass">
                <div className="cover" style={{ backgroundImage: current.thumbnailUrl || current.coverUrlOriginal ? `url(${current.thumbnailUrl || current.coverUrlOriginal})` : demoCover(current.id) }} />
                <div>
                  <div className="track-title">{display(current)}</div>
                  <div className="track-artist">{current.artist}</div>
                  <small className="queue-foot">
                    {current.playbackType === "embed" ? "YOUTUBE • ONLINE" : current.requestedMode.toUpperCase()} • Requested by {current.requesterNickname ?? "Passenger"}
                  </small>
                </div>
              </article>
            ) : (
              <div className="glass" style={{ padding: "20px", borderRadius: 20, color: "var(--muted)" }}>
                พร้อมออกเดินทาง • รอเริ่มเล่นเพลง
              </div>
            )}

            {pending.length > 0 && (
              <>
                <h2 className="section-label">UP NEXT</h2>
                <div className="queue-list">
                  {pending.map((item, i) => (
                    <article className={`queue-row ${profile && item.seatNo === profile.seatNo ? "mine" : ""}`} key={item.id}>
                      <div className="queue-number">#{i + 1}</div>
                      <div className="cover sm" style={{ backgroundImage: item.thumbnailUrl || item.coverUrlOriginal ? `url(${item.thumbnailUrl || item.coverUrlOriginal})` : demoCover(item.id) }} />
                      <div className="queue-meta">
                        <div className="track-title">{display(item)}</div>
                        <div className="track-artist">{item.metadataStatus === "failed" ? "" : item.artist}</div>
                        <div className="queue-foot">{profile && item.seatNo === profile.seatNo ? "☆ เพลงของคุณ" : `Requested by ${item.requesterNickname ?? "Passenger"}`}</div>
                      </div>
                      <span className="mode-badge">⚡ {item.playbackType === "embed" ? "YOUTUBE" : item.requestedMode.toUpperCase()}</span>
                      <span className="duration">{item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}` : "--:--"}</span>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <section className="request-panel glass">
          <p className="eyebrow">REQUEST A TRACK</p>
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-toggle-btn ${requestedMode === "audio" ? "active" : ""}`}
              onClick={() => setRequestedMode("audio")}
            >
              🎵 ฟังเพลง (Audio)
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${requestedMode === "video" ? "active" : ""}`}
              onClick={() => setRequestedMode("video")}
            >
              🎬 ดูคลิปเต็มจอ (Video)
            </button>
          </div>
          <form onSubmit={addRequest}>
            <input className="text-input" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="วางลิงก์ YouTube หรือ Direct Media" maxLength={500} />
            <button className="secondary-button" disabled={submitting}>{submitting ? "กำลังส่ง…" : "ขอเพลง"}</button>
          </form>
          {message && <p className="queue-foot" role="status">{message}</p>}
        </section>


        {recentlyPlayed.length > 0 && (
          <>
            <h2 className="section-label">RECENTLY PLAYED</h2>
            <div className="recent-grid">
              {recentlyPlayed.slice(0, 3).map(item => (
                <div key={item.id}>
                  <div className="cover" style={{ backgroundImage: item.thumbnailUrl || item.coverUrlOriginal ? `url(${item.thumbnailUrl || item.coverUrlOriginal})` : demoCover(item.id) }} />
                  <div className="track-title">{display(item)}</div>
                  <div className="track-artist">{item.artist}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

