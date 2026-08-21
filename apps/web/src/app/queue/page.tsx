"use client";
import { useEffect, useMemo, useState } from "react";
import { demoCover, demoItems, demoState } from "@/lib/demo";
import { StudentNav } from "@/components/StudentNav";
import { calculateEta, type QueueItem, type SystemState } from "@trip-music/shared";
import { getSupabase } from "@/lib/supabase";
import { mapQueueRow, mapStateRow } from "@/lib/data";
import { webConfig } from "@/lib/config";

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>(webConfig.demoMode ? demoItems : []);
  const [state, setState] = useState<SystemState | null>(webConfig.demoMode ? demoState : null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const current = items.find(i => i.id === state?.currentQueueItemId) ?? items.find(i => i.status === "playing") ?? null;
  const pending = items.filter(i => ["waiting", "preparing", "ready"].includes(i.status));
  const recentlyPlayed = items.filter(i => ["played", "skipped"].includes(i.status));
  const eta = useMemo(() => calculateEta(items, state?.playbackPositionSeconds ?? 0), [items, state?.playbackPositionSeconds]);

  useEffect(() => {
    if (webConfig.demoMode) return;
    let cancelled = false;

    const loadFromTablet = async () => {
      try {
        const [qRes, sRes] = await Promise.all([
          fetch("http://localhost:3000/api/queue"),
          fetch("http://localhost:3000/api/state"),
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
      let roomId = webConfig.defaultRoomId;
      try {
        if (!roomId) {
          const rooms = await supabase.from("rooms").select("id").eq("name", "6/18").eq("active", true).limit(1).single();
          roomId = rooms.data?.id ?? "";
        }
        if (!roomId) { await loadFromTablet(); return; }
        const q = await supabase.from("queue_items").select("*").eq("room_id", roomId).order("sort_order");
        const s = await supabase.from("system_state").select("*").eq("room_id", roomId).maybeSingle();
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
    try {
      let enqueued = false;
      const supabase = getSupabase();
      if (!webConfig.demoMode && supabase) {
        try {
          let roomId = webConfig.defaultRoomId;
          if (!roomId) {
            const rooms = await supabase.from("rooms").select("id").eq("name", "6/18").single();
            roomId = rooms.data?.id ?? "";
          }
          if (roomId) {
            const { data, error } = await supabase.rpc("enqueue_track", { p_room_id: roomId, p_source_url: sourceUrl.trim(), p_requested_mode: "audio" });
            if (!error && data) {
              setItems(v => [...v, mapQueueRow(data as unknown as Record<string, unknown>)]);
              enqueued = true;
            }
          }
        } catch {}
      }

      if (!enqueued && !webConfig.demoMode) {
        const res = await fetch("http://localhost:3000/api/queue/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceUrl: sourceUrl.trim(), requesterNickname: "You", seatNo: 7 }),
        });
        if (res.ok) {
          const item = await res.json();
          setItems(v => [...v.filter(x => x.id !== item.id), item]);
          enqueued = true;
        }
      }

      if (enqueued) {
        const isYt = /youtube\.com|youtu\.be/.test(sourceUrl);
        setMessage(isYt ? "เพิ่มเพลงเข้าคิวแล้ว (YouTube • Online)" : "เพิ่มเพลงเข้าคิวแล้ว");
      } else if (webConfig.demoMode) {
        await new Promise(r => setTimeout(r, 450));
        const n = items.length + 1;
        setItems(v => [...v, { ...demoItems[1], id: `local-${n}`, title: "New request", artist: "Waiting for the bus mix", sortOrder: n, status: "waiting", sourceUrl, requestedAt: new Date().toISOString(), requesterNickname: "You", seatNo: 7, localMediaKey: null }]);
        setMessage("เพิ่มเพลงเข้าคิวแล้ว");
      }
      setSourceUrl("");
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      setMessage(raw.includes("pending") ? "คุณมีเพลงรออยู่แล้ว 2 เพลง" : raw.includes("duplicate") ? "เพลงนี้อยู่ในคิวแล้ว" : "ลิงก์นี้ไม่ถูกต้อง");
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
                    <article className={`queue-row ${item.requesterNickname === "You" ? "mine" : ""}`} key={item.id}>
                      <div className="queue-number">#{i + 1}</div>
                      <div className="cover sm" style={{ backgroundImage: item.thumbnailUrl || item.coverUrlOriginal ? `url(${item.thumbnailUrl || item.coverUrlOriginal})` : demoCover(item.id) }} />
                      <div className="queue-meta">
                        <div className="track-title">{display(item)}</div>
                        <div className="track-artist">{item.metadataStatus === "failed" ? "" : item.artist}</div>
                        <div className="queue-foot">{item.requesterNickname === "You" ? "☆ เพลงของคุณ" : `Requested by ${item.requesterNickname ?? "Passenger"}`}</div>
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

