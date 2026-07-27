const PREFIX    = "kt_oc_";
const TS_SUFFIX = "_ts";

function cacheKey(userId, key) { return `${PREFIX}${userId}_${key}`; }

export function setCache(userId, key, data) {
  const k = cacheKey(userId, key);
  try {
    localStorage.setItem(k,             JSON.stringify(data));
    localStorage.setItem(k + TS_SUFFIX, String(Date.now()));
  } catch { /* storage full — silently skip */ }
}

export function getCache(userId, key) {
  const k = cacheKey(userId, key);
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const ts = parseInt(localStorage.getItem(k + TS_SUFFIX) || "0", 10);
    return { data: JSON.parse(raw), ts };
  } catch { return null; }
}

// Clears all offline data for a given user (call on logout).
export function clearUserCache(userId) {
  if (!userId) return;
  const ocPfx    = `${PREFIX}${userId}_`;
  const storePfx = `kt_store_${userId}`;
  const invPfx   = `kt_inv_${userId}`;
  const lockTs   = `kt_lock_timeout_${userId}`;
  Object.keys(localStorage)
    .filter(k =>
      k.startsWith(ocPfx) ||
      k.startsWith(storePfx) ||
      k.startsWith(invPfx) ||
      k === lockTs
    )
    .forEach(k => localStorage.removeItem(k));
}

export function formatSyncTime(ts) {
  if (!ts) return null;
  const d   = new Date(ts);
  const now = new Date();
  const t   = d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return t;
  const yd  = new Date(now); yd.setDate(now.getDate() - 1);
  if (d.toDateString() === yd.toDateString()) return `yesterday ${t}`;
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short" }) + " " + t;
}
