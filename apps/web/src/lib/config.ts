export const webConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  developerName: process.env.DEVELOPER_NAME || "Trip Music",
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
  defaultRoomId: process.env.DEFAULT_ROOM_ID ?? "",
};
