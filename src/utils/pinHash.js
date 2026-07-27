const H_KEY  = u => `kt_pin_h_${u}`;
const S_KEY  = u => `kt_pin_s_${u}`;
const LK_KEY = u => `kt_pin_lock_${u}`;

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 30 * 60 * 1000;

function u8ToHex(u8)  { return Array.from(u8).map(b => b.toString(16).padStart(2, "0")).join(""); }
function hexToU8(hex) { return new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16))); }
function randomHex(n) { return u8ToHex(crypto.getRandomValues(new Uint8Array(n))); }

async function pbkdf2Hash(pin, saltHex) {
  const enc    = new TextEncoder();
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits   = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToU8(saltHex), iterations: 200_000 },
    keyMat, 256
  );
  return u8ToHex(new Uint8Array(bits));
}

export async function setLocalPinHash(userId, pin) {
  const salt = randomHex(16);
  const hash = await pbkdf2Hash(pin, salt);
  try {
    localStorage.setItem(H_KEY(userId), hash);
    localStorage.setItem(S_KEY(userId), salt);
  } catch { /* storage full */ }
}

export async function verifyLocalPin(userId, pin) {
  const hash = localStorage.getItem(H_KEY(userId));
  const salt = localStorage.getItem(S_KEY(userId));
  if (!hash || !salt) return { noLocalPin: true };

  const lock = getLockState(userId);
  if (lock.until && Date.now() < lock.until) {
    return { locked: true, lockedUntil: new Date(lock.until).toISOString() };
  }

  const candidate = await pbkdf2Hash(pin, salt);
  if (candidate === hash) {
    clearFailedAttempts(userId);
    return { success: true };
  }
  return recordFailedAttempt(userId);
}

function getLockState(userId) {
  try {
    const raw = localStorage.getItem(LK_KEY(userId));
    return raw ? JSON.parse(raw) : { attempts: 0, until: null };
  } catch { return { attempts: 0, until: null }; }
}

export function recordFailedAttempt(userId) {
  const state    = getLockState(userId);
  const attempts = (state.attempts || 0) + 1;
  const until    = attempts >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null;
  try { localStorage.setItem(LK_KEY(userId), JSON.stringify({ attempts, until })); } catch { }
  if (until) return { locked: true, lockedUntil: new Date(until).toISOString() };
  return { success: false, attemptsLeft: MAX_ATTEMPTS - attempts };
}

export function clearFailedAttempts(userId) {
  try { localStorage.setItem(LK_KEY(userId), JSON.stringify({ attempts: 0, until: null })); } catch { }
}

export function clearLocalPinState(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(H_KEY(userId));
    localStorage.removeItem(S_KEY(userId));
    localStorage.removeItem(LK_KEY(userId));
  } catch { }
}
