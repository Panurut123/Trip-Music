export const webConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  developerName: process.env.DEVELOPER_NAME || "Trip Music",
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
  defaultRoomId: process.env.NEXT_PUBLIC_DEFAULT_ROOM_ID || process.env.DEFAULT_ROOM_ID || "b0f0fdc2-303c-4b05-a46b-5a8f1ec513cb",
};

