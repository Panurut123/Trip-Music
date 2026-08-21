"use client";

import { useEffect, useMemo, useState } from "react";
import { Credit } from "@/components/Brand";
import { webConfig } from "@/lib/config";
import { generateUUID } from "@/lib/data";
import { getOrCreateDeviceId, getRememberedProfile, saveProfile, type StoredTripProfile } from "@/lib/profile-storage";
import { resolveRoomId } from "@/lib/room";
import { formatSeatLabel, groupNumberToSeat, seatToGroup, type SeatGroup } from "@/lib/seat";
import { getSupabase } from "@/lib/supabase";

type SeatStatus = { exists: boolean; nickname: string | null; blocked?: boolean; login_enabled?: boolean };
type Stage = "select" | "verify" | "register";

function rawError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const value = err as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code].filter(v => typeof v === "string").join(" · ");
  }
  return String(err ?? "");
}

function friendlyError(err: unknown): string {
  const raw = rawError(err);
  if (raw.includes("invalid_pin")) return "PIN ไม่ถูกต้อง ลองใหม่อีกครั้ง";
  if (raw.includes("login_disabled")) return "เลขที่นี้ถูกปิดใช้งานชั่วคราว";
  if (raw.includes("seat_taken")) return "เลขที่นี้ถูกลงทะเบียนจากอีกเครื่องแล้ว กรุณาลองใหม่";
  if (raw.includes("authentication")) return "เซสชันหมดอายุ กรุณาลองเข้าสู่ระบบอีกครั้ง";
  return "เข้าสู่ระบบไม่ได้ ลองอีกครั้งหรือติดต่อผู้ดูแล";
}

export default function LoginPage() {
  const [group, setGroup] = useState<SeatGroup>("A");
  const [number, setNumber] = useState(7);
  const [stage, setStage] = useState<Stage>("select");
  const [seatStatus, setSeatStatus] = useState<SeatStatus | null>(null);
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [remembered, setRemembered] = useState<StoredTripProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const seat = useMemo(() => groupNumberToSeat(group, number), [group, number]);
  const selectedLabel = formatSeatLabel(seat);

  useEffect(() => {
    if (webConfig.demoMode) return;
    const switching = new URLSearchParams(window.location.search).get("switch") === "1";
    if (switching) return;
    const saved = getRememberedProfile();
    if (!saved) return;
    setRemembered(saved);
    const info = seatToGroup(saved.seatNo);
    setGroup(info.group);
    setNumber(info.number);
  }, []);

  async function ensureAuth() {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase unavailable");
    const session = await supabase.auth.getSession();
    if (session.data.session?.user) return supabase;
    const auth = await supabase.auth.signInAnonymously();
    if (auth.error || !auth.data.user) throw auth.error ?? new Error("authentication failed");
    return supabase;
  }

  function resetIdentity(nextGroup = group, nextNumber = number) {
    setGroup(nextGroup);
    setNumber(nextNumber);
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
      const status = (data ?? { exists: false, nickname: null, login_enabled: true }) as SeatStatus;
      setSeatStatus(status);
      if (status.login_enabled === false) {
        setError("เลขที่นี้ถูกปิดใช้งานชั่วคราว");
        return;
      }
      if (status.exists) {
        setNickname(status.nickname ?? "");
        setStage("verify");
      } else {
        setStage("register");
      }
      setPin("");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function claim(profile: { seatNo: number; pin: string; nickname?: string | null }, shouldRemember: boolean) {
    if (!/^\d{4}$/.test(profile.pin)) throw new Error("invalid_pin");
    const nextNickname = profile.nickname?.trim() || null;
    if (stage === "register" && (!nextNickname || nextNickname.length > 20)) throw new Error("nickname required");

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
      const raw = rawError(err);
      const info = seatToGroup(remembered.seatNo);
      setGroup(info.group);
      setNumber(info.number);
      setRemembered(null);
      if (raw.includes("invalid_pin")) {
        setSeatStatus({ exists: true, nickname: remembered.nickname, login_enabled: true });
        setNickname(remembered.nickname);
        setStage("verify");
        setError("PIN ที่จำไว้ใช้ไม่ได้แล้ว กรุณาใส่ PIN อีกครั้ง");
      } else {
        setError(friendlyError(err));
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
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-ambient ambient-a" aria-hidden="true" />
      <div className="login-ambient ambient-b" aria-hidden="true" />
      <section className="login-card">
        <header className="login-head">
          <div className="login-logo-wrap">
            <span className="login-logo-mark" aria-hidden="true">♪</span>
            <div>
              <div className="login-brand">Trip Music</div>
              <div className="login-kicker">6/18 FIELD TRIP • 2026</div>
            </div>
          </div>
          <h1>เลือกที่นั่งของคุณ</h1>
          <p>ครั้งแรกตั้งชื่อเล่นกับ PIN 4 หลัก แล้วใช้ PIN เดิมกลับเข้ามาได้จากทุกเครื่อง</p>
          <div className="login-steps" aria-label="ขั้นตอนการเข้าสู่ระบบ">
            <span className={stage === "select" ? "active" : "done"}><b>1</b> ห้อง</span>
            <i />
            <span className={stage === "select" ? "active" : "done"}><b>2</b> เลขที่</span>
            <i />
            <span className={stage !== "select" ? "active" : ""}><b>3</b> PIN</span>
          </div>
        </header>

        {remembered && (
          <div className="saved-profile glass welcome-back-card">
            <div className="saved-avatar" aria-hidden="true">{remembered.nickname.slice(0, 1).toUpperCase()}</div>
            <div>
              <span className="saved-profile-kicker">ยินดีต้อนรับกลับ</span>
              <strong>{remembered.nickname}</strong>
              <small>{formatSeatLabel(remembered.seatNo)}</small>
            </div>
            <button type="button" className="primary-button compact" onClick={continueRemembered} disabled={busy}>เข้าเลย <span>→</span></button>
            <button type="button" className="text-button" onClick={() => setRemembered(null)}>ไม่ใช่ฉัน</button>
          </div>
        )}

        <section className="login-selection glass">
          <div className="selection-label"><span>STEP 01</span><strong>เลือกห้อง</strong></div>
          <div className="group-switch" role="tablist" aria-label="เลือกห้อง">
            <button type="button" className={group === "A" ? "active" : ""} onClick={() => resetIdentity("A", Math.min(number, 20))}>
              <small>GROUP A</small><span>ห้อง ก</span><em>01–20</em>
            </button>
            <button type="button" className={group === "B" ? "active" : ""} onClick={() => resetIdentity("B", Math.min(number, 20))}>
              <small>GROUP B</small><span>ห้อง ข</span><em>01–20</em>
            </button>
          </div>

          <div className="number-panel">
            <div className="number-panel-head">
              <div><small>STEP 02</small><span>เลือกเลขที่ • {group === "A" ? "ห้อง ก" : "ห้อง ข"}</span></div>
              <strong>{selectedLabel}</strong>
            </div>
            <div className="number-grid group-number-grid">
              {Array.from({ length: 20 }, (_, i) => i + 1).map(n => (
                <button type="button" key={n} className={`number-button ${number === n ? "selected" : ""}`} onClick={() => resetIdentity(group, n)} aria-pressed={number === n}>
                  {String(n).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
        </section>

        {stage === "select" ? (
          <div className="login-form continue-step">
            {error && <div className="error-message" role="alert"><span>!</span><div>{error}</div></div>}
            <button type="button" className="primary-button login-continue" onClick={inspectSeat} disabled={busy}>
              <span>{busy ? "กำลังตรวจสอบ…" : `ต่อด้วย ${selectedLabel}`}</span><b aria-hidden="true">→</b>
            </button>
            <p className="login-note">ระบบจะตรวจว่าเลขที่นี้ลงทะเบียนไว้แล้วหรือยัง</p>
          </div>
        ) : (
          <form className="login-form identity-step glass" onSubmit={submit}>
            <div className="identity-summary">
              <div className="identity-seat"><span>{selectedLabel}</span><small>{group === "A" ? "ห้อง ก" : "ห้อง ข"}</small></div>
              <div className="identity-copy">
                <small>{stage === "verify" ? "WELCOME BACK" : "FIRST TIME"}</small>
                <strong>{stage === "verify" ? (seatStatus?.nickname || "สมาชิก Trip Music") : "ลงทะเบียนครั้งแรก"}</strong>
              </div>
              <button type="button" className="text-button" onClick={() => resetIdentity(group, number)}>เปลี่ยน</button>
            </div>

            {stage === "register" && (
              <div className="field-group">
                <label htmlFor="nickname">ชื่อเล่น</label>
                <div className="field-wrap"><span aria-hidden="true">☺</span><input id="nickname" className="text-input" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="เช่น Beam" maxLength={20} autoComplete="nickname" /></div>
                <small>ชื่อนี้จะแสดงข้างเพลงที่คุณขอ</small>
              </div>
            )}

            <div className="field-group">
              <label htmlFor="pin">{stage === "verify" ? "ใส่ PIN 4 หลัก" : "ตั้ง PIN 4 หลัก"}</label>
              <div className="field-wrap pin-wrap"><span aria-hidden="true">•</span><input id="pin" className="text-input pin-input" type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" maxLength={4} autoComplete="current-password" autoFocus /></div>
              <small>{stage === "verify" ? "ใช้ PIN ที่ตั้งไว้ครั้งแรก" : "จำง่าย ๆ 4 ตัว ใช้กลับเข้ามาจากเครื่องอื่นได้"}</small>
            </div>

            <label className="remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span className="custom-check" aria-hidden="true">✓</span><span><b>จำฉันไว้ในเครื่องนี้</b><small>ครั้งหน้ากดเข้าได้เร็วขึ้น</small></span></label>
            {error && <div className="error-message" role="alert"><span>!</span><div>{error}</div></div>}
            <button className="primary-button" disabled={busy || pin.length !== 4 || (stage === "register" && !nickname.trim())}>
              <span>{busy ? "กำลังเข้าสู่ระบบ…" : stage === "verify" ? "เข้า Trip Music" : "ลงทะเบียนและเข้า"}</span><b aria-hidden="true">→</b>
            </button>
          </form>
        )}
        <Credit />
      </section>
    </main>
  );
}
