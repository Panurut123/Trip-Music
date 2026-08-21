import type { SupabaseClient } from "@supabase/supabase-js";
import { webConfig } from "./config";

let cachedRoomId = webConfig.defaultRoomId;

export async function resolveRoomId(supabase: SupabaseClient): Promise<string> {
  if (cachedRoomId) return cachedRoomId;
  const { data, error } = await supabase.from("rooms").select("id").eq("name", "6/18").eq("active", true).limit(1).maybeSingle();
  if (error || !data?.id) throw new Error("ไม่พบห้อง 6/18 ใน Supabase");
  cachedRoomId = String(data.id);
  return cachedRoomId;
}
