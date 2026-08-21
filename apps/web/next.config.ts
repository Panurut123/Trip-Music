import type { NextConfig } from "next";

const nextConfig: NextConfig = { transpilePackages: ["@trip-music/shared"], agentRules: false };
export default nextConfig;
