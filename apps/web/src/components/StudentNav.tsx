import Link from "next/link";
import { Brand } from "./Brand";

function Icon({ name }: { name: "request" | "queue" | "history" | "user" }) {
  if (name === "request") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>;
  if (name === "queue") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M4 11h10M4 16h7M18 5v10.5a2.5 2.5 0 1 1-2-2.45V7.2L21 6v7.5a2.5 2.5 0 1 1-2-2.45"/></svg>;
  if (name === "history") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8A8 8 0 1 1 4 14M4.5 8V3.5M4.5 8H9M12 7.5V12l3 2"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.8-3.8 3.2-6 7-6s6.2 2.2 7 6"/></svg>;
}

export function StudentNav({ active }: { active: "home" | "queue" | "history" }) {
  return <>
    <header className="student-topbar">
      <Brand />
      <div className="top-actions">
        <span className="connection-dot" aria-label="ระบบออนไลน์" title="ระบบออนไลน์" />
        <Link className="top-icon-button" href="/login?switch=1" aria-label="เปลี่ยนผู้ใช้" title="เปลี่ยนผู้ใช้"><Icon name="user" /></Link>
      </div>
    </header>
    <nav className="bottom-nav" aria-label="Student navigation">
      <Link className={active === "home" ? "active" : ""} href="/queue#request"><span className="nav-icon"><Icon name="request" /></span><small>Request</small></Link>
      <Link className={active === "queue" ? "active" : ""} href="/queue#queue"><span className="nav-icon"><Icon name="queue" /></span><small>Queue</small></Link>
      <Link className={active === "history" ? "active" : ""} href="/history"><span className="nav-icon"><Icon name="history" /></span><small>History</small></Link>
    </nav>
  </>;
}
