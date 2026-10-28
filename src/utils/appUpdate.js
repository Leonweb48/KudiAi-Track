// App update gate (2026-10-28). The admin portal sets public.app_update_policy (Settings → App Updates):
//   min_build    — an Android app whose build (Play versionCode, e.g. 192) is below it is blocked by "Update required"
//   latest_build — below it, a dismissible "A new version is available" bar
// Only the Android app checks; the website always runs the latest code. If the policy can't be read (offline, first
// launch), the last copy seen is used, and with none the app is never blocked.
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { supabase } from "./supabase";

export const PLAY_PACKAGE = "com.amayatechnologies.kuditrack";
export const PLAY_WEB_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
const CACHE_KEY = "kt_update_policy";
const DISMISS_KEY = "kt_update_dismissed";
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;   // "Later" hides the bar for 3 days (per new build)

const safeStorage = () => { try { return window.localStorage; } catch { return null; } };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };

/** A table row → { min, latest, message }, or null when there's nothing usable. */
export function normalizePolicy(row) {
  if (!row || typeof row !== "object") return null;
  return { min: int(row.min_build), latest: int(row.latest_build), message: String(row.message || "").trim().slice(0, 160) };
}

/** "required" | "available" | "ok" for an installed build. A build we can't read is never blocked. */
export function updateVerdict(build, policy) {
  const b = int(build);
  if (!policy || !b) return "ok";
  if (policy.min && b < policy.min) return "required";
  if (policy.latest && b < policy.latest) return "available";
  return "ok";
}

/** Was the "new version" bar for this build dismissed less than 3 days ago? */
export function snoozed(latest, now = Date.now(), store = safeStorage()) {
  try {
    const d = JSON.parse(store?.getItem(DISMISS_KEY) || "null");
    return !!d && d.latest === latest && now - d.at < SNOOZE_MS;
  } catch { return false; }
}
export function snooze(latest, now = Date.now(), store = safeStorage()) {
  try { store?.setItem(DISMISS_KEY, JSON.stringify({ latest, at: now })); } catch { /* ignore */ }
}

export function gateApplies() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/** The installed build number (Play versionCode), or 0 when it can't be read. */
export async function installedBuild() {
  try { return int((await CapApp.getInfo()).build); } catch { return 0; }
}

export function cachedPolicy() {
  try { return normalizePolicy(JSON.parse(safeStorage()?.getItem(CACHE_KEY) || "null")); } catch { return null; }
}

/** The policy from the server (kept for offline launches); falls back to the last copy. */
export async function loadPolicy() {
  try {
    const { data, error } = await supabase.from("app_update_policy").select("min_build, latest_build, message").eq("id", 1).maybeSingle();
    if (error || !data) return cachedPolicy();
    try { safeStorage()?.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
    return normalizePolicy(data);
  } catch {
    return cachedPolicy();
  }
}

/** Opens KudiAI Track in the Play Store app (Capacitor hands market:// links to Android), else Play on the web. */
export function openPlayStore() {
  try { window.location.href = `market://details?id=${PLAY_PACKAGE}`; }
  catch { try { window.open(PLAY_WEB_URL, "_blank", "noopener"); } catch { /* ignore */ } }
}
