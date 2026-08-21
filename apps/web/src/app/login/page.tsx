"use client";

import { useEffect, useState } from "react";
import { Credit } from "@/components/Brand";
import { generateUUID } from "@/lib/data";
import { getOrCreateDeviceId, getRememberedProfile, saveProfile, type StoredTripProfile } from "@/lib/profile-storage";
import { getSupabase } from "@/lib/supabase";
import { webConfig } from "@/lib/config";
import { resolveRoomId } from "@/lib/room";

type SeatStatus = { exists: boolean; nickname: string | null };
type Stage = "select" | "verify" | "register";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const value = err as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    if (parts.length) return parts.join(" · ");
    try { return JSON.stringify(err); } catch { return ""; }
  }
  return String(err ?? "");
}

function friendlyLoginError(err: unknown): string {
  const raw = getErrorMessage(err);
  if (/crypt|gen_salt|pgcrypto|function .* does not exist/i.test(raw))
    return "ระบบ PIN ใน Supabase ยังไม่พร้อม — กรุณารัน migration 0008_fix_pin_pgcrypto.sql";
  if (/claim_seat|seat_status|schema cache|function/i.test(raw))
    return "ฐานข้อมูลระบบ PIN ยังไม่อัปเดตครบ — กรุณารัน migration ล่าสุดใน Supabase";
  return raw || "เชื่อมต่อไม่ได้ ลองอีกครั้งนะ";
}

export default function LoginPage() {
  const [seat, setSeat] = useState(7);
  const [stage, setStage] = useState<Stage>("select");
  const [seatStatus, setSeatStatus] = useState<SeatStatus | null>(null);
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [remembered, setRemembered] = useState<StoredTripProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const switching = new URLSearchParams(window.location.search).get("switch") === "1";
    if (!switching) {
      const saved = getRememberedProfile();
      if (saved) {
        setRemembered(saved);
        setSeat(saved.seatNo);
      }
    }
  }, []);

  async function ensureAuth() {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase ยังไม่ได้ตั้งค่า");
    const session = await supabase.auth.getSession();
    if (session.data.session?.user) return supabase;
    const auth = await supabase.auth.signInAnonymously();
    if (auth.error || !auth.data.user) throw new Error("เปิด Anonymous Sign-ins ใน Supabase ก่อน");
    return supabase;
  }

  function chooseSeat(nextSeat: number) {
    setSeat(nextSeat);
    setStage("select");
    setSeatStatus(null);
    setNickname("");
    setPin("");
    setError("");
  }

  async function inspectSeat() {
    setBusy(true);
    setError("");
    try {
      const supabase = await ensureAuth();
      const { data, error: rpcError } = await supabase.rpc("seat_status", {
        p_room_id: await resolveRoomId(supabase),
        p_seat_no: seat,
      });
      if (rpcError) throw rpcError;
      const status = (data ?? { exists: false, nickname: null }) as SeatStatus;
      setSeatStatus(status);
      if (status.exists) {
        setNickname(status.nickname ?? "");
        setStage("verify");
      } else {
        setStage("register");
      }
      setPin("");
    } catch (err) {
      setError(friendlyLoginError(err));
    } finally {
      setBusy(false);
    }
  }

  async function claim(profile: { seatNo: number; pin: string; nickname?: string | null }, shouldRemember: boolean) {
    if (!/^\d{4}$/.test(profile.pin)) throw new Error("กรุณาใส่ PIN ตัวเลข 4 หลัก");
    const nextNickname = profile.nickname?.trim() || null;
    if (stage === "register" && (!nextNickname || nextNickname.length > 20)) throw new Error("กรุณาใส่ชื่อเล่น 1–20 ตัวอักษร");

    const deviceId = getOrCreateDeviceId(generateUUID);
    const supabase = await ensureAuth();
    const { data, error: rpcError } = await supabase.rpc("claim_seat", {
      p_room_id: await resolveRoomId(supabase),
      p_seat_no: profile.seatNo,
      p_device_id: deviceId,
      p_pin: profile.pin,
      p_nickname: nextNickname,
    });
    if (rpcError) throw rpcError;

    const row = data as { nickname?: string; seat_no?: number } | null;
    const stored: StoredTripProfile = {
      seatNo: Number(row?.seat_no ?? profile.seatNo),
      nickname: String(row?.nickname ?? nextNickname ?? seatStatus?.nickname ?? remembered?.nickname ?? "Passenger"),
      pin: profile.pin,
      deviceId,
    };
    saveProfile(stored, shouldRemember);
    window.location.href = "/queue";
  }

  async function continueRemembered() {
    if (!remembered) return;
    setBusy(true);
    setError("");
    try {
      await claim({ seatNo: remembered.seatNo, pin: remembered.pin, nickname: remembered.nickname }, true);
    } catch (err) {
      const raw = getErrorMessage(err);
      if (raw.includes("invalid_pin")) {
        setSeat(remembered.seatNo);
        setSeatStatus({ exists: true, nickname: remembered.nickname });
        setNickname(remembered.nickname);
        setStage("verify");
        setPin("");
        setRemembered(null);
        setError("PIN ที่จำไว้ใช้ไม่ได้แล้ว กรุณาใส่ PIN อีกครั้ง");
      } else {
        setError(raw || "เชื่อมต่อไม่ได้ ลองอีกครั้งนะ");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await claim({ seatNo: seat, pin, nickname: stage === "register" ? nickname : seatStatus?.nickname }, remember);
    } catch (err) {
      const raw = getErrorMessage(err);
      if (raw.includes("invalid_pin")) setError("PIN ไม่ถูกต้อง ลองใหม่อีกครั้ง");
      else if (raw.includes("seat_taken")) setError("เลขที่นี้ถูกลงทะเบียนพร้อมกันจากอีกเครื่อง กรุณาลองใหม่");
      else if (raw.includes("blocked")) setError("เลขที่นี้ถูกระงับการขอเพลง");
      else setError(friendlyLoginError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-head">
          <h1>ยินดีต้อนรับสู่ <span>Trip Music</span></h1>
          <p>เลือกเลขที่ของคุณ แล้วใช้ PIN เดิมเพื่อกลับเข้ามาได้จากทุกเครื่อง</p>
        </div>

        {remembered && (
          <div className="saved-profile glass">
            <div>
              <span className="saved-profile-kicker">จำคุณได้จากเครื่องนี้</span>
              <strong>{remembered.nickname}</strong>
              <small>เลขที่ {String(remembered.seatNo).padStart(2, "0")}</small>
            </div>
            <button type="button" className="primary-button compact" onClick={continueRemembered} disabled={busy}>
              ใช่ เข้าเลย →
            </button>
            <button type="button" className="text-button" onClick={() => setRemembered(null)}>ไม่ใช่ฉัน</button>
          </div>
        )}

        <div className="number-panel glass">
          <div className="number-panel-head">
            <span>เลือกเลขที่</span>
            <strong>{String(seat).padStart(2, "0")}</strong>
          </div>
          <div className="number-grid">
            {Array.from({ length: 38 }, (_, i) => i + 1).map((n) => (
              <button
                type="button"
                key={n}
                className={`number-button ${seat === n ? "selected" : ""}`}
                onClick={() => chooseSeat(n)}
                aria-pressed={seat === n}
              >
                {String(n).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>

        {stage === "select" ? (
          <div className="login-form">
            <button type="button" className="primary-button" onClick={inspectSeat} disabled={busy}>
              {busy ? "กำลังตรวจสอบ…" : `ต่อด้วยเลขที่ ${String(seat).padStart(2, "0")} →`}
            </button>
            <p className="login-note">ถ้าเลขที่นี้เคยลงทะเบียนแล้ว ระบบจะถามแค่ PIN — ไม่ต้องกรอกชื่อใหม่</p>
            {error && <div className="error-message" role="alert">{error}</div>}
          </div>
        ) : (
          <form className="login-form identity-step" onSubmit={submit}>
            <div className="identity-summary">
              <span>เลขที่ {String(seat).padStart(2, "0")}</span>
              <strong>{stage === "verify" ? (seatStatus?.nickname || "สมาชิก Trip Music") : "ลงทะเบียนครั้งแรก"}</strong>
              <button type="button" className="text-button" onClick={() => chooseSeat(seat)}>เปลี่ยนเลขที่</button>
            </div>

            {stage === "register" && (
              <>
                <label htmlFor="nickname">ชื่อเล่น</label>
                <input
                  id="nickname"
                  className="text-input"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="ชื่อเล่นของคุณ (เช่น Beam)"
                  maxLength={20}
                  autoComplete="nickname"
                />
              </>
            )}

            <label htmlFor="pin">{stage === "verify" ? "ใส่ PIN 4 หลักของคุณ" : "ตั้ง PIN 4 หลัก"}</label>
            <input
              id="pin"
              className="text-input pin-input"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              maxLength={4}
              autoComplete="current-password"
              autoFocus
            />

            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              จำฉันไว้ในเครื่องนี้
            </label>
            {error && <div className="error-message" role="alert">{error}</div>}
            <button className="primary-button" disabled={busy || pin.length !== 4}>
              {busy ? "กำลังเข้าสู่ระบบ…" : stage === "verify" ? "เข้า Trip Music →" : "สร้างโปรไฟล์และเข้า →"}
            </button>
            <p className="login-note">
              {stage === "verify" ? "เปลี่ยนเครื่องก็ใช้เลขที่ + PIN เดิมได้ ชื่อเล่นจะกลับมาอัตโนมัติ" : "ครั้งต่อไปใช้เลขที่ + PIN นี้ได้เลย ไม่ต้องใส่ชื่อใหม่"}
            </p>
          </form>
        )}
        <Credit />
      </section>
    </main>
  );
}
