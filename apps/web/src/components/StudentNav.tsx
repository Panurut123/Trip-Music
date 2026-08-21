import Link from "next/link";
import { Brand } from "./Brand";

export function StudentNav({ active }: { active: "home" | "queue" | "history" }) {
  return <>
    <header className="student-topbar">
      <Brand />
      <div className="top-actions"><Link href="/login?switch=1" aria-label="เปลี่ยนผู้ใช้" title="เปลี่ยนผู้ใช้">◉</Link></div>
    </header>
    <nav className="bottom-nav" aria-label="Student navigation">
      <Link className={active === "home" ? "active" : ""} href="/queue#request"><span>＋</span><small>Request</small></Link>
      <Link className={active === "queue" ? "active" : ""} href="/queue#queue"><span>≡♫</span><small>Queue</small></Link>
      <Link className={active === "history" ? "active" : ""} href="/history"><span>◷</span><small>History</small></Link>
    </nav>
  </>;
}
