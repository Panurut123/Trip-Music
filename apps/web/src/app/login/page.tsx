"use client";
import { useEffect, useState } from "react";
import { Credit } from "@/components/Brand";
import { getSupabase } from "@/lib/supabase";
import { webConfig } from "@/lib/config";

export default function LoginPage() {
  const [section, setSection] = useState<"ก" | "ข">("ก");
  const [seatInRoom, setSeatInRoom] = useState(7);
  const [nickname, setNickname] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const actualSeatNo = section === "ก" ? seatInRoom : 20 + seatInRoom;

  useEffect(() => {
    const saved = localStorage.getItem("trip-music-profile");
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (p.seatNo) {
          if (p.seatNo > 20) {
            setSection("ข");
            setSeatInRoom(p.seatNo - 20);
          } else {
            setSection("ก");
            setSeatInRoom(p.seatNo);
          }
        }
        if (p.section) setSection(p.section);
        setNickname(p.nickname ?? "");
      } catch {}
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!nickname.trim() || nickname.trim().length > 20) {
      setError("กรุณาใส่ชื่อเล่น 1–20 ตัวอักษร");
      return;
    }
    setBusy(true);
    try {
      const deviceId = localStorage.getItem("trip-music-device") ?? crypto.randomUUID();
      localStorage.setItem("trip-music-device", deviceId);
      const supabase = getSupabase();
      if (supabase && !webConfig.demoMode) {
        const auth = await supabase.auth.signInAnonymously();
        if (auth.error) throw auth.error;
        if (webConfig.defaultRoomId) {
          const { error: profileError } = await supabase.rpc("ensure_profile", {
            p_room_id: webConfig.defaultRoomId,
            p_seat_no: actualSeatNo,
            p_nickname: `${nickname.trim()}`,
            p_device_id: deviceId,
          });
          if (profileError) throw profileError;
        }
      }
      if (remember) {
        localStorage.setItem("trip-music-profile", JSON.stringify({ section, seatInRoom, seatNo: actualSeatNo, nickname: nickname.trim(), deviceId }));
      } else {
        localStorage.removeItem("trip-music-profile");
      }
      window.location.href = "/queue";
    } catch {
      setError("เชื่อมต่อไม่ได้ ลองอีกครั้งนะ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-head">
          <h1>ยินดีต้อนรับสู่ <span>Trip Music</span></h1>
          <p>เลือกรหัสของคุณเพื่อเข้าร่วมคิวเพลงบนรถ</p>
        </div>

        <div className="number-panel glass">
          <div className="section-switch">
            <button
              type="button"
              className={`section-tab-btn ${section === "ก" ? "active" : ""}`}
              onClick={() => setSection("ก")}
            >
              ห้อง ก (1–20)
            </button>
            <button
              type="button"
              className={`section-tab-btn ${section === "ข" ? "active" : ""}`}
              onClick={() => setSection("ข")}
            >
              ห้อง ข (1–20)
            </button>
          </div>

          <div className="number-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <button
                type="button"
                key={n}
                className={`number-button ${seatInRoom === n ? "selected" : ""}`}
                onClick={() => setSeatInRoom(n)}
                aria-pressed={seatInRoom === n}
              >
                {String(n).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label htmlFor="nickname">♙ &nbsp; ห้อง {section} • เลขที่ {String(seatInRoom).padStart(2, "0")}</label>
          <input
            id="nickname"
            className="text-input"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="ชื่อเล่นของคุณ (e.g., Beam)"
            maxLength={20}
            autoComplete="nickname"
          />
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            จำฉันไว้ในเครื่องนี้
          </label>
          {error && <div className="error-message" role="alert">{error}</div>}
          <button className="primary-button" disabled={busy}>
            {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ Trip Music  →"}
          </button>
          <p className="login-note">ⓘ ชื่อของคุณใช้สำหรับแสดงว่าใครเป็นผู้ขอเพลงเท่านั้น</p>
        </form>
        <Credit />
      </section>
    </main>
  );
}

