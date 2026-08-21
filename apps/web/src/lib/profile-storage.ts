export type StoredTripProfile = {
  seatNo: number;
  nickname: string;
  pin: string;
  deviceId: string;
};

const PROFILE_KEY = "trip-music-profile";
const DEVICE_KEY = "trip-music-device";

function parseProfile(raw: string | null): StoredTripProfile | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredTripProfile>;
    if (!Number.isInteger(value.seatNo) || Number(value.seatNo) < 1 || Number(value.seatNo) > 40) return null;
    if (typeof value.nickname !== "string" || !value.nickname.trim()) return null;
    if (typeof value.pin !== "string" || !/^\d{4}$/.test(value.pin)) return null;
    if (typeof value.deviceId !== "string" || value.deviceId.length < 8) return null;
    return { seatNo: Number(value.seatNo), nickname: value.nickname.trim(), pin: value.pin, deviceId: value.deviceId };
  } catch {
    return null;
  }
}

export function getStoredProfile(): StoredTripProfile | null {
  if (typeof window === "undefined") return null;
  return parseProfile(sessionStorage.getItem(PROFILE_KEY)) ?? parseProfile(localStorage.getItem(PROFILE_KEY));
}

export function getRememberedProfile(): StoredTripProfile | null {
  if (typeof window === "undefined") return null;
  return parseProfile(localStorage.getItem(PROFILE_KEY));
}

export function saveProfile(profile: StoredTripProfile, remember: boolean) {
  if (typeof window === "undefined") return;
  const encoded = JSON.stringify(profile);
  sessionStorage.setItem(PROFILE_KEY, encoded);
  if (remember) localStorage.setItem(PROFILE_KEY, encoded);
  else localStorage.removeItem(PROFILE_KEY);
  localStorage.setItem(DEVICE_KEY, profile.deviceId);
}

export function clearProfile({ forgetDevice = false }: { forgetDevice?: boolean } = {}) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(PROFILE_KEY);
  if (forgetDevice) localStorage.removeItem(DEVICE_KEY);
}

export function getOrCreateDeviceId(generate: () => string): string {
  if (typeof window === "undefined") return generate();
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing && existing.length >= 8) return existing;
  const created = generate();
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}
