import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasAdminSession } from "@/lib/admin";

export async function POST(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = await request.json().catch(() => ({}));
  const seatNo = Number(input.seatNo);
  const action = String(input.action ?? "");
  if (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > 40) return NextResponse.json({ error: "invalid seat" }, { status: 400 });
  if (!new Set(["login_enable", "login_disable", "requests_block", "requests_unblock"]).has(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const roomId = process.env.DEFAULT_ROOM_ID;
  if (!url || !key || !roomId) return NextResponse.json({ error: "server config missing" }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  if (action === "login_enable" || action === "login_disable") {
    const { error } = await supabase.from("seat_controls").upsert({ room_id: roomId, seat_no: seatNo, login_enabled: action === "login_enable", updated_at: new Date().toISOString() }, { onConflict: "room_id,seat_no" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from("profiles").update({ blocked: action === "requests_block" }).eq("room_id", roomId).eq("seat_no", seatNo);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, seatNo, action });
}
