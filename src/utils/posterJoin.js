// Business posters — the "scan to join" hand-off (no React). kudiai.app/join/<code> remembers which business the person
// scanned, then opens wallet sign-up; the sign-up form's business picker starts on that business (SignupParts.jsx).

export const PENDING_JOIN_KEY = "kuditrack_join_business";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.amayatechnologies.kuditrack";
const KEEP_MS = 7 * 86400000;

/** "k7rm-2qxa" → "K7RM2QXA"; anything that can't be a poster code → "". Same alphabet as owner_poster_code(). */
export function normalizePosterCode(raw) {
  const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-HJKMNP-Z2-9]{8}$/.test(c) ? c : "";
}

/** /pay/<code> or /join/<code> → { kind, code }, else null. */
export function parsePosterPath(pathname) {
  const m = /^\/(pay|join)\/([^/]+)\/?$/i.exec(String(pathname || ""));
  if (!m) return null;
  const code = normalizePosterCode(m[2]);
  return code ? { kind: m[1].toLowerCase(), code } : null;
}

function store() {
  try { return window.localStorage; } catch { return null; }
}

export function setPendingJoin(businessId, businessName) {
  if (!businessId) return;
  try { store()?.setItem(PENDING_JOIN_KEY, JSON.stringify({ id: businessId, name: businessName || "", at: Date.now() })); } catch { /* private mode */ }
}

/** The business picked from a poster in the last 7 days: { id, name } or null. */
export function getPendingJoin() {
  try {
    const v = JSON.parse(store()?.getItem(PENDING_JOIN_KEY) || "null");
    if (!v?.id || Date.now() - (v.at || 0) > KEEP_MS) return null;
    return { id: v.id, name: v.name || "" };
  } catch { return null; }
}
