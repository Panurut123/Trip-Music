"use client";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { demoCover } from "@/lib/demo";
import type { QueueItem, SystemState } from "@trip-music/shared";

type ProfileRow = {
  nickname: string;
  seatNo: number;
  duplicate?: boolean;
  blocked?: boolean;
};

export default function AdminPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [systemState, setSystemState] = useState<SystemState | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/admin/state");
      if (!response.ok) { location.href = "/admin/login"; return; }
      const data = await response.json();
      const queue: QueueItem[] = data.queue ?? [];
      setItems(queue);
      setSystemState(data.state ?? null);
      if (data.state?.currentQueueItemId) {
        const found = queue.find((item) => item.id === data.state.currentQueueItemId);
        setCurrent(found ?? null);
      } else {
        const playing = queue.find((item) => item.status === "playing");
        setCurrent(playing ?? null);
      }
      setProfiles(data.profiles ?? []);
    };
    void load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, []);

  async function command(value: string) {
    await fetch("/api/admin/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: value }),
    });
  }

  const bufferMinutes = Math.ceil((systemState?.preparedBufferSeconds ?? 0) / 60);
  const duplicates = profiles.filter(p => p.duplicate);

  return (
    <main className="admin-page">
      {duplicates.length > 0 && (
        <div className="admin-alert">
          ⚠️ มีการใช้งานซ้ำซ้อน: {duplicates.map(d => `${d.nickname} (${String(d.seatNo).padStart(2, "0")})`).join(", ")}
        </div>
      )}
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <Brand compact />
          <button
            className="side-button"
            onClick={() => command(systemState?.requestsEnabled ? "requests_disable" : "requests_enable")}
          >
            ◉ {systemState?.requestsEnabled ? "หยุดรับเพลงชั่วคราว" : "เปิดรับเพลง"}
          </button>
          <h3 className="eyebrow">♙ SYSTEM HEALTH</h3>
          <div className="health-list">
            <div className="health-row">
              <span>▣ Local Buffer</span>
              <strong>{bufferMinutes} นาที</strong>
            </div>
            <div className="health-row">
              <span>☷ Queue Count</span>
              <strong>{items.length}</strong>
            </div>
            <div className="health-row">
              <span>⌁ Network</span>
              <strong>{systemState?.internetOnline ? "Online" : "Offline"}</strong>
            </div>
          </div>
        </aside>

        <section className="admin-main">
          <div className="admin-stats">
            <div className="stat-card">
              <strong>{bufferMinutes} นาที</strong>LOCAL BUFFER
            </div>
            <div className="stat-card">
              <strong>{items.length} เพลง</strong>คิวทั้งหมด
            </div>
            <div className="stat-card">
              <strong>{items.filter(item => item.status === "ready").length} เพลง</strong>พร้อมเล่น
            </div>
          </div>

          <section className="admin-now">
            {current ? (
              <>
                <div
                  className="cover"
                  style={{
                    backgroundImage: current.thumbnailUrl || current.coverUrlOriginal
                      ? `url(${current.thumbnailUrl || current.coverUrlOriginal})`
                      : demoCover(current.id),
                  }}
                />
                <div>
                  <span className="status-pill">
                    {current.playbackType === "embed" ? "YOUTUBE • ONLINE" : "▶ NOW PLAYING"}
                  </span>
                  <div className="admin-track-title">{current.title}</div>
                  <div className="track-artist">{current.artist}</div>
                  <p className="subline">
                    ♙ Requested by <b style={{ color: "var(--green)" }}>{current.requesterNickname ?? "Passenger"}</b>{" "}
                    {current.seatNo ? `(ID: ${current.seatNo})` : ""}
                  </p>
                  <div className="progress"><span /></div>
                  <div className="admin-actions">
                    <button className="round-button" onClick={() => command("pause")}>Ⅱ</button>
                    <button className="round-button" onClick={() => command("resume")}>▶</button>
                    <button className="round-button" onClick={() => command("skip")}>▶|</button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <span className="status-pill">IDLE</span>
                <div className="admin-track-title">ยังไม่มีเพลง</div>
                <div className="track-artist">Waiting for requests…</div>
                <div className="admin-actions" style={{ marginTop: 20 }}>
                  <button className="round-button" onClick={() => command("start_trip")}>▶</button>
                </div>
              </div>
            )}
          </section>

          <div className="admin-columns">
            <section className="admin-panel">
              <h2>▣ Admin Queue</h2>
              {items.length === 0 ? (
                <div className="status-text" style={{ padding: "20px 0" }}>ยังไม่มีเพลงในคิว</div>
              ) : (
                items.map((item, index) => (
                  <div className="admin-queue-row" key={item.id}>
                    <b>{index + 1}</b>
                    <div>
                      <b>{item.title}</b>
                      <div className="track-artist">{item.artist}</div>
                      {item.mediaError && <div className="status-text">{item.mediaError}</div>}
                    </div>
                    <span className="status-text">
                      {item.playbackType === "embed"
                        ? "YOUTUBE • ONLINE"
                        : item.mediaStatus === "unsupported"
                        ? "UNSUPPORTED"
                        : item.status.toUpperCase()}
                    </span>
                  </div>
                ))
              )}
            </section>

            <section className="admin-panel">
              <h2>♙ Active Users <span className="subline">Connected: {profiles.length}</span></h2>
              {profiles.length === 0 ? (
                <div className="status-text" style={{ padding: "20px 0" }}>ยังไม่มีผู้ใช้งาน</div>
              ) : (
                profiles.map(user => (
                  <div className={`user-card ${user.duplicate ? "warning" : ""}`} key={`${user.seatNo}-${user.nickname}`}>
                    <div>
                      <b>{user.nickname} {String(user.seatNo).padStart(2, "0")}</b>
                      <div className="track-artist">ID: {user.seatNo}{user.duplicate ? " (Duplicate)" : ""}</div>
                    </div>
                    <div>
                      <button className="tiny-button">Block</button>{" "}
                      <button className="tiny-button danger">Kick</button>
                    </div>
                  </div>
                ))
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

