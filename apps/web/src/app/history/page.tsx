"use client";
import { useEffect, useMemo, useState } from "react";
import { StudentNav } from "@/components/StudentNav";
import { demoCover, demoItems } from "@/lib/demo";
import { webConfig } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { mapQueueRow } from "@/lib/data";
import type { QueueItem } from "@trip-music/shared";
import { formatSeatLabel } from "@/lib/seat";

function formatDuration(sec?: number | null) {
  if (!sec) return "--:--";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<QueueItem[]>(webConfig.demoMode ? demoItems.slice(0, 3) : []);

  useEffect(() => {
    const supabase = getSupabase();
    if (webConfig.demoMode || !supabase) return;
    let roomId = webConfig.defaultRoomId;
    let cancelled = false;

    const load = async () => {
      if (!roomId) {
        const rooms = await supabase.from("rooms").select("id").eq("name", "6/18").eq("active", true).limit(1).single();
        roomId = rooms.data?.id ?? "";
      }
      if (!roomId) return;
      const { data } = await supabase
        .from("queue_items")
        .select("*")
        .eq("room_id", roomId)
        .in("status", ["played", "skipped"])
        .order("finished_at", { ascending: false });
      if (cancelled) return;
      setHistory((data ?? []).map(row => mapQueueRow(row as Record<string, unknown>)));
    };

    void load();
    const channel = supabase.channel("trip-music-history")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_items" }, () => void load())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(channel); };
  }, []);

  const totalMinutes = useMemo(() => Math.round(history.reduce((sum, item) => sum + (item.durationSeconds || 0), 0) / 60), [history]);

  return (
    <div className="mobile-page student-app">
      <StudentNav active="history" />
      <main className="mobile-content history-screen">
        <section className="student-hero history-hero">
          <div>
            <p className="eyebrow">6/18 FIELD TRIP • 2026</p>
            <h1 className="page-title">ประวัติการเล่น</h1>
            <p className="subline">เพลงที่ผ่านจอ Trip Music ไปแล้วในทริปนี้</p>
          </div>
          <div className="history-summary">
            <div><strong>{history.length}</strong><span>เพลง</span></div>
            <div><strong>{totalMinutes}</strong><span>นาที</span></div>
          </div>
        </section>

        {history.length === 0 ? (
          <div className="glass history-empty premium-empty">
            <span className="empty-orb">↺</span>
            <div><strong>ยังไม่มีประวัติการเล่นเพลง</strong><span>เพลงที่เล่นจบแล้วจะเรียงอยู่ตรงนี้</span></div>
          </div>
        ) : (
          <section className="history-list glass">
            <div className="history-list-head"><span>PLAYED</span><small>ล่าสุดก่อน</small></div>
            {history.map((item, index) => (
              <article className="history-row premium-history-row" key={item.id}>
                <span className="history-index">{String(index + 1).padStart(2, "0")}</span>
                <div
                  className="cover sm"
                  style={{ backgroundImage: item.thumbnailUrl || item.coverUrlOriginal ? `url(${item.thumbnailUrl || item.coverUrlOriginal})` : demoCover(item.id) }}
                />
                <div className="queue-meta">
                  <div className="track-title">{item.title}</div>
                  <div className="track-artist">{item.artist}</div>
                  <div className="queue-foot">ขอโดย {item.requesterNickname ?? "Passenger"}{item.seatNo ? ` • ${formatSeatLabel(item.seatNo)}` : ""}</div>
                </div>
                <div className="history-end">
                  <span className="mode-badge">{item.playbackType === "embed" ? "YT" : item.requestedMode === "video" ? "VIDEO" : "AUDIO"}</span>
                  <span className="duration">{formatDuration(item.durationSeconds)}</span>
                  <small>{item.status === "skipped" ? "SKIPPED" : "PLAYED"}</small>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
