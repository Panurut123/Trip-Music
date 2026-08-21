import Link from "next/link";
import { webConfig } from "@/lib/config";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className={`brand ${compact ? "brand-compact" : ""}`} href="/queue"><span className="brand-mark">◖</span><span>Trip Music</span></Link>;
}

export function Credit() { return <p className="credit">DESIGNED &amp; DEVELOPED BY {webConfig.developerName.toUpperCase()} • 2026</p>; }
