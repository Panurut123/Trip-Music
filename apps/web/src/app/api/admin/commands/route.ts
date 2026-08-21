import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasAdminSession } from "@/lib/admin";

const commands = new Set(["pause", "resume", "skip", "stop", "start_trip", "end_trip", "requests_enable", "requests_disable"]);
export async function POST(request: Request) {
  const input = await request.json().catch(() => ({ command: "" }));
  if (!commands.has(input.command)) return NextResponse.json({ error: "invalid command" }, { status: 400 });
  if (!await hasAdminSession()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.DEMO_MODE !== "true") {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { error } = await supabase.from("player_commands").insert({ room_id: process.env.DEFAULT_ROOM_ID, command: input.command, payload: input.payload ?? {} });
    if (error) return NextResponse.json({ error: "command failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, command: input.command, demo: process.env.DEMO_MODE === "true" });
}
