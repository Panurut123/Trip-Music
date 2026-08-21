"use client";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { demoCover } from "@/lib/demo";
import { formatSeatLabel } from "@/lib/seat";
import type { QueueItem, SystemState } from "@trip-music/shared";

type SeatRow = {
  seatNo: number;
  nickname: string | null;
  registered: boolean;
  blocked: boolean;
  loginEnabled: boolean;
  duplicate?: boolean;
  lastSeen?: string | null;
};

type AdminTab = "now" | "queue" | "students" | "system";

function youtubeFailureDetail(item: QueueItem) {
  const raw = `${item.metadataError ?? ""} ${item.mediaError ?? ""}`;
  if (/youtube_unembeddable|youtube_error_(101|150)/i.test(raw)) return "UNPLAYABLE • YOUTUBE 101/150 — เจ้าของวิดีโอปิดการฝัง";
  if (/youtube_error_100|youtube_unavailable/i.test(raw)) return "UNPLAYABLE • YOUTUBE 100 — วิดีโอไม่พร้อมใช้งาน";
  if (/youtube_error_153/i.test(raw)) return "UNPLAYABLE • YOUTUBE 153 — client/referrer ถูกปฏิเสธ";
  if (/youtube_error_5/i.test(raw)) return "UNPLAYABLE • YOUTUBE 5 — HTML5 playback error";
  return item.mediaStatus === "failed" || item.status === "failed" ? "FAILED" : item.status.toUpperCase();
}

export default function AdminPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [systemState, setSystemState] = useState<SystemState | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [tab, setTab] = useState<AdminTab>("now");
  const [busySeat, setBusySeat] = useState<number | null>(null);

  const load = async () => {
    const response = await fetch("/api/admin/state", { cache: "no-store" });
    if (!response.ok) { location.href = "/admin/login"; return; }
    const data = await response.json();
    const queue: QueueItem[] = data.queue ?? [];
    setItems(queue);
    setSystemState(data.state ?? null);
    const id = data.state?.currentQueueItemId;
    setCurrent(id ? queue.find(item => item.id === id) ?? null : queue.find(item => item.status === "playing") ?? null);
    setSeats(data.seats ?? []);
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3500);
    return () => clearInterval(timer);
  }, []);

  async function command(value: string) {
    await fetch("/api/admin/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: value }) });
    setTimeout(() => void load(), 250);
  }

  async function seatAction(seatNo: number, action: string) {
    setBusySeat(seatNo);
    try {
      const res = await fetch("/api/admin/seats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seatNo, action }) });
      if (!res.ok) throw new Error("seat action failed");
      await load();
    } finally {
      setBusySeat(null);
    }
  }

  const bufferMinutes = Math.ceil((systemState?.preparedBufferSeconds ?? 0) / 60);
  const activeQueue = useMemo(() => items.filter(i => ["waiting", "preparing", "ready", "playing"].includes(i.status)), [items]);
  const nextReady = activeQueue.find(i => i.status === "ready");
  const queueView = useMemo(() => items.filter(i => ["waiting", "preparing", "ready", "playing", "failed"].includes(i.status)).slice(-30), [items]);

  return (
    <main className="admin-page admin-v2">
      <header className="admin-header">
        <Brand compact />
        <div className="admin-header-status"><span className={systemState?.internetOnline ? "dot ok" : "dot"} />{systemState?.internetOnline ? "ONLINE" : "OFFLINE"}</div>
      </header>

      <nav className="admin-tabs">
        {(["now", "queue", "students", "system"] as AdminTab[]).map(key => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {key === "now" ? "NOW PLAYING" : key === "queue" ? "QUEUE" : key === "students" ? "STUDENTS" : "SYSTEM"}
          </button>
        ))}
      </nav>

      <section className="admin-dashboard">
        <div className="admin-quickbar">
          <div><strong>{bufferMinutes}</strong><span>LOCAL BUFFER / MIN</span></div>
          <div><strong>{activeQueue.length}</strong><span>ACTIVE QUEUE</span></div>
          <div><strong>{activeQueue.filter(i => i.status === "ready").length}</strong><span>READY</span></div>
          <button className={systemState?.requestsEnabled ? "danger-soft" : "success-soft"} onClick={() => command(systemState?.requestsEnabled ? "requests_disable" : "requests_enable")}>{systemState?.requestsEnabled ? "หยุดรับเพลง" : "เปิดรับเพลง"}</button>
        </div>

        {tab === "now" && (
          <section className="admin-now-v2">
            {current ? (
              <>
                <div className="admin-art" style={{ backgroundImage: current.thumbnailUrl || current.coverUrlOriginal ? `url(${current.thumbnailUrl || current.coverUrlOriginal})` : demoCover(current.id) }} />
                <div className="admin-now-copy">
                  <span className="status-pill">{current.playbackType === "embed" ? "YOUTUBE • ONLINE" : current.preparedMediaType === "video" ? "LOCAL • VIDEO" : "LOCAL • AUDIO"}</span>
                  <h1>{current.title}</h1>
                  <p>{current.artist}</p>
                  <div className="admin-requester">Requested by <b>{current.requesterNickname ?? "Passenger"}</b> • {formatSeatLabel(current.seatNo)}</div>
                  <div className="admin-actions-v2">
                    <button onClick={() => command(systemState?.playbackStatus === "paused" ? "resume" : "pause")}>{systemState?.playbackStatus === "paused" ? "▶ RESUME" : "Ⅱ PAUSE"}</button>
                    <button className={!nextReady ? "disabled" : ""} disabled={!nextReady} onClick={() => command("skip")}>▶| SKIP</button>
                    <button className="danger-soft" onClick={() => command("stop")}>■ STOP</button>
                  </div>
                  {!nextReady && current && <small className="admin-hint">ยังไม่มีเพลงถัดไปที่พร้อมเล่น — Skip จะเปิดเมื่อมีเพลง READY</small>}
                </div>
              </>
            ) : (
              <div className="admin-empty"><span>TRIP MUSIC</span><h1>{systemState?.tripStarted ? "คิวว่างแล้ว" : "ยังไม่ได้เริ่มทริป"}</h1><p>{systemState?.tripStarted ? "รอเพลงใหม่จากเพื่อน ๆ" : "กด Start เมื่อพร้อมออกเดินทาง"}</p>{!systemState?.tripStarted && <button className="success-soft" onClick={() => command("start_trip")}>▶ START TRIP</button>}</div>
            )}
          </section>
        )}

        {tab === "queue" && (
          <section className="admin-panel-v2">
            <div className="panel-title"><h2>คิวเพลง</h2><span>{activeQueue.length} active</span></div>
            <div className="admin-queue-v2">
              {queueView.length === 0 ? <div className="admin-empty compact"><h2>ยังไม่มีเพลงในคิว</h2></div> : queueView.map((item, index) => (
                <article key={item.id} className={`admin-track-row ${item.status === "failed" ? "failed" : ""}`}>
                  <div className="queue-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="admin-track-thumb" style={{ backgroundImage: item.thumbnailUrl || item.coverUrlOriginal ? `url(${item.thumbnailUrl || item.coverUrlOriginal})` : demoCover(item.id) }} />
                  <div className="admin-track-copy"><strong>{item.title}</strong><span>{item.artist} • {item.requesterNickname ?? "Passenger"} • {formatSeatLabel(item.seatNo)}</span>{item.mediaError && <small>{item.mediaError}</small>}</div>
                  <div className="admin-track-state">{youtubeFailureDetail(item)}</div>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "students" && (
          <section className="admin-panel-v2">
            <div className="panel-title"><div><h2>นักเรียน</h2><p>ปิด Login = เข้าไม่ได้แม้รู้ PIN • Block = เข้าได้แต่ขอเพลงไม่ได้</p></div></div>
            {(["A", "B"] as const).map(group => (
              <div className="seat-group-admin" key={group}>
                <h3>ห้อง {group === "A" ? "ก" : "ข"}</h3>
                <div className="seat-admin-grid">
                  {seats.filter(s => group === "A" ? s.seatNo <= 20 : s.seatNo > 20).map(seat => (
                    <article className={`seat-admin-card ${!seat.loginEnabled ? "disabled" : ""} ${seat.blocked ? "blocked" : ""}`} key={seat.seatNo}>
                      <div className="seat-admin-head"><strong>{formatSeatLabel(seat.seatNo)}</strong><span>{seat.registered ? seat.nickname : "ยังไม่ลงทะเบียน"}</span></div>
                      <div className="seat-flags">{!seat.loginEnabled && <b>LOGIN OFF</b>}{seat.blocked && <b>REQUESTS BLOCKED</b>}{seat.duplicate && <b>DUPLICATE</b>}</div>
                      <div className="seat-admin-actions">
                        <button disabled={busySeat === seat.seatNo} onClick={() => seatAction(seat.seatNo, seat.loginEnabled ? "login_disable" : "login_enable")}>{seat.loginEnabled ? "Disable Login" : "Enable Login"}</button>
                        {seat.registered && <button disabled={busySeat === seat.seatNo} onClick={() => seatAction(seat.seatNo, seat.blocked ? "requests_unblock" : "requests_block")}>{seat.blocked ? "Unblock Requests" : "Block Requests"}</button>}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {tab === "system" && (
          <section className="admin-panel-v2 system-grid-v2">
            <div><span>WORKER</span><strong>{systemState?.workerLastSeen ? "ONLINE" : "—"}</strong></div>
            <div><span>INTERNET</span><strong>{systemState?.internetOnline ? "ONLINE" : "OFFLINE"}</strong></div>
            <div><span>PLAYER</span><strong>{systemState?.playbackStatus?.toUpperCase() ?? "IDLE"}</strong></div>
            <div><span>CACHED LOCAL</span><strong>{systemState?.cachedTrackCount ?? 0}</strong></div>
            <div><span>OFFLINE BUFFER</span><strong>{bufferMinutes} MIN</strong></div>
            <div><span>REQUESTS</span><strong>{systemState?.requestsEnabled ? "OPEN" : "PAUSED"}</strong></div>
          </section>
        )}
      </section>
    </main>
  );
}
