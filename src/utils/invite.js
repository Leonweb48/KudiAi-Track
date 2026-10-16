// Invite & Earn — pure helpers shared by the owner and client portals (no React, no network).
// The money rules live on the server (supabase/migrations/20270340000000_invite_and_earn.sql); this file only shapes
// what the screens show.

export const PENDING_INVITE_KEY = "kuditrack_pending_invite";
const PROMO_SEEN_KEY = "kuditrack_invite_promo_seen";

/** "kd-ab 12cd" → "KDAB12CD"; anything that can't be a code → "". */
export function normalizeInviteCode(raw) {
  const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length >= 4 && c.length <= 16 ? c : "";
}

export function inviteLink(code) {
  return `https://kudiai.app/?invite=${encodeURIComponent(code)}&signup=1`;
}

function store() {
  try { return window.localStorage; } catch { return null; }
}

export function setPendingInvite(code) {
  const c = normalizeInviteCode(code);
  if (!c) return;
  try { store()?.setItem(PENDING_INVITE_KEY, JSON.stringify({ code: c, at: Date.now() })); } catch { /* private mode */ }
}

/** A code picked up from an invite link or typed at sign-up — forgotten after 30 days. */
export function getPendingInvite() {
  try {
    const v = JSON.parse(store()?.getItem(PENDING_INVITE_KEY) || "null");
    if (!v?.code || Date.now() - (v.at || 0) > 30 * 86400000) return "";
    return normalizeInviteCode(v.code);
  } catch { return ""; }
}

export function clearPendingInvite() {
  try { store()?.removeItem(PENDING_INVITE_KEY); } catch { /* ignore */ }
}

/** Remember ?invite=CODE from the address bar (call once at start-up) and tidy the URL. */
export function captureInviteFromUrl(loc = typeof window !== "undefined" ? window.location : null) {
  if (!loc) return "";
  const params = new URLSearchParams(loc.search || "");
  const code = normalizeInviteCode(params.get("invite"));
  if (!code) return "";
  setPendingInvite(code);
  try {
    params.delete("invite");
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", loc.pathname + (qs ? `?${qs}` : "") + (loc.hash || ""));
  } catch { /* fine to leave it */ }
  return code;
}

export function naira(kobo) {
  const n = Math.round(Number(kobo || 0) / 100);
  return `₦${n.toLocaleString("en-NG")}`;
}

/** Remaining time until `endsAt` → { d, h, m, s, done, text: "6d 23:59:03" }. */
export function countdown(endsAt, now = Date.now()) {
  const ms = Math.max(0, new Date(endsAt).getTime() - now);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (x) => String(x).padStart(2, "0");
  return { d, h, m, s: sec, done: ms === 0, text: `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` };
}

/** Tier slots for the current campaign: [{ tier, amountKobo, filled, name, paid, isNext }]. */
export function tierSlots(tiersKobo = [], slots = []) {
  const byTier = new Map((slots || []).map((s) => [Number(s.tier), s]));
  let nextMarked = false;
  return (tiersKobo || []).map((amt, i) => {
    const s = byTier.get(i + 1);
    const isNext = !s && !nextMarked;
    if (isNext) nextMarked = true;
    return { tier: i + 1, amountKobo: Number(amt), filled: !!s, name: s?.name || "", paid: !!s?.paid, isNext };
  });
}

export function maxRewardKobo(tiersKobo = []) {
  return (tiersKobo || []).reduce((a, b) => a + Number(b || 0), 0);
}

/** Where one invited friend is: joined → wallet → spend → done (or expired / rejected). pct = spend progress 0..100. */
export function inviteStage(inv, minSpendKobo) {
  const spent = Number(inv?.spent_kobo || 0), min = Number(minSpendKobo || 1);
  const pct = Math.max(0, Math.min(100, Math.round((spent / min) * 100)));
  const st = inv?.status;
  if (st === "rewarded" || st === "qualified") return { stage: "done", pct: 100, paid: !!inv?.paid };
  if (st === "expired") return { stage: "expired", pct };
  if (st === "rejected") return { stage: "rejected", pct };
  if (!inv?.wallet_open) return { stage: "joined", pct: 0 };
  return { stage: "spend", pct };
}

/** The first-name initial for an avatar bubble. */
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "★";
}

/** The marketing popup shows at most once every `days` on this device. */
export function promoDue(days = 7, now = Date.now()) {
  try { const at = Number(store()?.getItem(PROMO_SEEN_KEY) || 0); return !at || now - at > days * 86400000; } catch { return false; }
}
export function markPromoSeen(now = Date.now()) {
  try { store()?.setItem(PROMO_SEEN_KEY, String(now)); } catch { /* ignore */ }
}

/** Program settings straight from platform_config (no network call needed for banners / the popup). */
export function inviteConfigFromPlatform(cfg) {
  if (!cfg || cfg.referral_enabled !== "true") return null;
  const tiers = String(cfg.referral_tiers_kobo || "50000,70000,100000").split(",").map((x) => Number(x.trim())).filter((n) => n > 0);
  return {
    tiers,
    maxKobo: maxRewardKobo(tiers),
    friendBonusKobo: Number(cfg.referral_friend_bonus_kobo || 20000),
    minSpendKobo: Number(cfg.referral_min_spend_kobo || 200000),
    windowDays: Number(cfg.referral_window_days || 7),
  };
}
