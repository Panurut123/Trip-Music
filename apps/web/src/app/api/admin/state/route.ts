import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin";
import { demoItems, demoState } from "@/lib/demo";
import { mapQueueRow, mapStateRow } from "@/lib/data";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  if (!await hasAdminSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.DEMO_MODE === "true" || process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    return NextResponse.json({
      queue: demoItems,
      state: demoState,
      profiles: [
        { nickname: "Nong", seatNo: 7, duplicate: true },
        { nickname: "Boy", seatNo: 12 },
        { nickname: "Ken", seatNo: 25 },
        { nickname: "Sam", seatNo: 31 },
      ],
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const roomId = process.env.DEFAULT_ROOM_ID;
  if (!supabaseUrl || !serviceKey || !roomId) {
    return NextResponse.json({ queue: [], state: null, profiles: [] });
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const [q, s, p] = await Promise.all([
    supabase.from("queue_items").select("*").eq("room_id", roomId).order("sort_order"),
    supabase.from("system_state").select("*").eq("room_id", roomId).maybeSingle(),
    supabase.from("profiles").select("nickname,seat_no,device_id,last_seen,blocked").eq("room_id", roomId).order("seat_no"),
  ]);

  const rawProfiles = p.data ?? [];
  const seatCounts = new Map<number, number>();
  rawProfiles.forEach(pr => seatCounts.set(pr.seat_no, (seatCounts.get(pr.seat_no) || 0) + 1));
  const profiles = rawProfiles.map(pr => ({
    ...pr,
    duplicate: (seatCounts.get(pr.seat_no) || 0) > 1,
  }));

  return NextResponse.json({
    queue: (q.data ?? []).map(row => mapQueueRow(row as Record<string, unknown>)),
    state: s.data ? mapStateRow(s.data as Record<string, unknown>) : null,
    profiles,
  });
}

