"use client";
import { useEffect, useState } from "react";
import { Credit } from "@/components/Brand";
import { generateUUID } from "@/lib/data";
import { getSupabase } from "@/lib/supabase";
import { webConfig } from "@/lib/config";

export default function LoginPage() {
  const [section, setSection] = useState<"ก" | "ข">("ก");
  const [seatInRoom, setSeatInRoom] = useState(7);
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
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
        if (p.nickname) setNickname(p.nickname);
        if (p.pin) setPin(p.pin);
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
    if (!/^\d{4}$/.test(pin.trim())) {
      setError("กรุณาใส่รหัส PIN ตัวเลข 4 หลัก (เช่น 1234)");
      return;
    }
    setBusy(true);
    try {
      const deviceId = localStorage.getItem("trip-music-device") ?? generateUUID();
      localStorage.setItem("trip-music-device", deviceId);

      const supabase = getSupabase();
      if (supabase && !webConfig.demoMode) {
        let authUid: string | null = null;
        try {
          const sessionRes = await supabase.auth.getSession();
          if (sessionRes.data.session?.user?.id) {
            authUid = sessionRes.data.session.user.id;
          } else {
            const anonRes = await supabase.auth.signInAnonymously();
            if (!anonRes.error && anonRes.data.user) {
              authUid = anonRes.data.user.id;
            }
          }
        } catch {}

        if (!authUid) {
          try {
            const email = `seat_${actualSeatNo}_${deviceId.slice(0, 8)}@trip.local`;
            const password = `trip_device_${deviceId.slice(0, 12)}!`;
            const signInRes = await supabase.auth.signInWithPassword({ email, password });
            if (!signInRes.error && signInRes.data.user) {
              authUid = signInRes.data.user.id;
            } else {
              const signUpRes = await supabase.auth.signUp({ email, password });
              if (!signUpRes.error && signUpRes.data.user) {
                authUid = signUpRes.data.user.id;
              }
            }
          } catch {}
        }

        const roomId = webConfig.defaultRoomId || "b0f0fdc2-303c-4b05-a46b-5a8f1ec513cb";
        const { error: profileError } = await supabase.rpc("ensure_profile", {
          p_room_id: roomId,
          p_seat_no: actualSeatNo,
          p_nickname: `${nickname.trim()}`,
          p_device_id: deviceId,
          p_pin: pin.trim(),
        });
        if (profileError) {
          if (String(profileError.message).includes("invalid_pin")) {
            setError("รหัส PIN 4 หลักไม่ถูกต้อง (เลขที่นี้ถูกตั้งรหัสไว้แล้ว)");
            setBusy(false);
            return;
          }
        }
      }

      if (remember) {
        localStorage.setItem("trip-music-profile", JSON.stringify({ section, seatInRoom, seatNo: actualSeatNo, nickname: nickname.trim(), pin: pin.trim(), deviceId }));
      } else {
        localStorage.removeItem("trip-music-profile");
      }
      window.location.href = "/queue";
    } catch (err) {
      console.error("[login] error:", err);
      localStorage.setItem("trip-music-profile", JSON.stringify({ section, seatInRoom, seatNo: actualSeatNo, nickname: nickname.trim(), pin: pin.trim(), deviceId: generateUUID() }));
      window.location.href = "/queue";
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

          <label htmlFor="pin" style={{ marginTop: 14 }}>🔒 &nbsp; รหัส PIN 4 หลัก (สำหรับเข้าซ้ำ / ป้องกันผู้อื่นแย่งเลขที่)</label>
          <input
            id="pin"
            className="text-input"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="รหัส PIN 4 ตัว (เช่น 1234)"
            maxLength={4}
            autoComplete="current-password"
          />

          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            จำฉันไว้ในเครื่องนี้
          </label>
          {error && <div className="error-message" role="alert">{error}</div>}
          <button className="primary-button" disabled={busy}>
            {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ Trip Music  →"}
          </button>
          <p className="login-note">ⓘ PIN 4 หลักใช้ป้องกันไม่ให้ผู้อื่นกดเลือกเลขที่ของคุณซ้ำ</p>
        </form>
        <Credit />
      </section>
    </main>
  );
}


