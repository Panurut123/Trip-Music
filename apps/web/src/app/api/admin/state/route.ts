import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin";
import { demoItems, demoState } from "@/lib/demo";
import { mapQueueRow, mapStateRow } from "@/lib/data";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  if (!await hasAdminSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.DEMO_MODE === "true" || process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    return NextResponse.json({ queue: demoItems, state: demoState, profiles: [], seats: [] });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const roomId = process.env.DEFAULT_ROOM_ID;
  if (!supabaseUrl || !serviceKey || !roomId) return NextResponse.json({ queue: [], state: null, profiles: [], seats: [] });

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const [q, s, p, controls] = await Promise.all([
    supabase.from("queue_items").select("*").eq("room_id", roomId).order("sort_order"),
    supabase.from("system_state").select("*").eq("room_id", roomId).maybeSingle(),
    supabase.from("profiles").select("id,nickname,seat_no,device_id,last_seen,blocked,auth_user_id").eq("room_id", roomId).order("seat_no"),
    supabase.from("seat_controls").select("seat_no,login_enabled").eq("room_id", roomId).order("seat_no"),
  ]);

  const rawProfiles = p.data ?? [];
  const seatCounts = new Map<number, number>();
  rawProfiles.forEach(pr => seatCounts.set(pr.seat_no, (seatCounts.get(pr.seat_no) || 0) + 1));
  const controlMap = new Map<number, boolean>((controls.data ?? []).map(row => [Number(row.seat_no), Boolean(row.login_enabled)]));
  const profileBySeat = new Map<number, (typeof rawProfiles)[number]>();
  rawProfiles.forEach(row => { if (!profileBySeat.has(Number(row.seat_no))) profileBySeat.set(Number(row.seat_no), row); });

  const seats = Array.from({ length: 40 }, (_, index) => {
    const seatNo = index + 1;
    const profile = profileBySeat.get(seatNo);
    return {
      seatNo,
      nickname: profile?.nickname ?? null,
      registered: Boolean(profile),
      blocked: Boolean(profile?.blocked),
      loginEnabled: controlMap.has(seatNo) ? controlMap.get(seatNo) : true,
      duplicate: (seatCounts.get(seatNo) || 0) > 1,
      lastSeen: profile?.last_seen ?? null,
    };
  });

  const profiles = rawProfiles.map(pr => ({
    nickname: pr.nickname,
    seatNo: pr.seat_no,
    blocked: pr.blocked,
    lastSeen: pr.last_seen,
    duplicate: (seatCounts.get(pr.seat_no) || 0) > 1,
    loginEnabled: controlMap.has(Number(pr.seat_no)) ? controlMap.get(Number(pr.seat_no)) : true,
  }));

  return NextResponse.json({
    queue: (q.data ?? []).map(row => mapQueueRow(row as Record<string, unknown>)),
    state: s.data ? mapStateRow(s.data as Record<string, unknown>) : null,
    profiles,
    seats,
  });
}
