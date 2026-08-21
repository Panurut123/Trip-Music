import Link from "next/link";
import { webConfig } from "@/lib/config";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand ${compact ? "brand-compact" : ""}`} href="/queue" aria-label="Trip Music">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M18.7 3.4C12.6 3.7 7.5 6.4 5.2 11.2c-1.6 3.4-.8 6.7 1.4 8.8.6-3.9 2.9-7.5 7.1-10.5-3.2 3.4-5.1 6.9-5.6 10.4 4.3.2 7.9-2.2 9.5-6.1 1.5-3.5 1.4-7.2 1.1-10.4Z"/></svg>
      </span>
      <span>Trip Music</span>
    </Link>
  );
}

export function Credit() {
  return <p className="credit">DESIGNED &amp; DEVELOPED BY {webConfig.developerName.toUpperCase()} • 2026</p>;
}
