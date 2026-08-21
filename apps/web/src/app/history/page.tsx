"use client";
import { useEffect, useState } from "react";
import { StudentNav } from "@/components/StudentNav";
import { demoCover, demoItems } from "@/lib/demo";
import { webConfig } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { mapQueueRow } from "@/lib/data";
import type { QueueItem } from "@trip-music/shared";

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

  return (
    <div className="mobile-page">
      <StudentNav active="history" />
      <main className="mobile-content">
        <p className="eyebrow">YOUR LISTENING LOG</p>
        <h1 className="page-title">ประวัติการเล่น</h1>
        <p className="subline">เพลงที่เล่นไปแล้วบนทริปนี้</p>

        {history.length === 0 ? (
          <div className="glass" style={{ textAlign: "center", padding: "40px 20px", marginTop: 28, borderRadius: 24 }}>
            <p style={{ fontSize: 18, fontWeight: 800, margin: "0 0 8px" }}>ยังไม่มีประวัติการเล่นเพลง</p>
            <p style={{ color: "var(--muted)", margin: 0 }}>เพลงที่เล่นจบแล้วจะปรากฏที่นี่</p>
          </div>
        ) : (
          <div className="glass" style={{ marginTop: 28, padding: "4px 18px", borderRadius: 24 }}>
            {history.map((item) => (
              <div className="history-row" key={item.id}>
                <div
                  className="cover sm"
                  style={{
                    backgroundImage: item.thumbnailUrl || item.coverUrlOriginal
                      ? `url(${item.thumbnailUrl || item.coverUrlOriginal})`
                      : demoCover(item.id),
                  }}
                />
                <div className="queue-meta">
                  <div className="track-title">{item.title}</div>
                  <div className="track-artist">{item.artist}</div>
                  <div className="queue-foot">
                    {item.playbackType === "embed" ? "YouTube" : item.requestedMode.toUpperCase()} • Requested by {item.requesterNickname ?? "Passenger"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

