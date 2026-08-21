import crypto from "node:crypto";
import { cookies } from "next/headers";

export function adminToken(){ return crypto.createHmac("sha256",process.env.ADMIN_SESSION_SECRET||"trip-music-local-secret").update("admin").digest("hex"); }
export async function hasAdminSession(){ const cookie=(await cookies()).get("trip_music_admin")?.value; return cookie===adminToken(); }
