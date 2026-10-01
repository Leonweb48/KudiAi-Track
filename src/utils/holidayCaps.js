// Holiday logo caps — the schedule the admin portal manages (public.holiday_caps; readable with the public key: live,
// enabled caps only, display columns only). The logo switches each cap on and off at its exact start/end time and keeps
// the last schedule on the device, so a cap still shows straight away on the next open (or offline).
import { supabase } from "./supabase";
import { HOLIDAY_CAP_PRESETS } from "./holidayCapPresets";

// owner, staff, manager, ajo_client, coop_admin, coop_member — and "public": the login / sign-up screens
export const CAP_PORTALS = ["owner", "staff", "manager", "ajo_client", "coop_admin", "coop_member", "public"];

const CACHE_KEY = "kt_holiday_caps";
const FRESH_MS = 5 * 60 * 1000;
const MAX_TIMER_MS = 2 ** 31 - 1;   // setTimeout's ceiling (~24.8 days)

/** A row from the table → { id, title, preset, start, end, portals }, or null if it can't be shown. */
export function normalizeCap(row) {
  if (!row || !HOLIDAY_CAP_PRESETS[row.preset]) return null;
  const start = Date.parse(row.starts_at ?? row.start), end = Date.parse(row.ends_at ?? row.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const portals = Array.isArray(row.portals) ? row.portals.filter((p) => CAP_PORTALS.includes(p)) : [];
  if (!portals.length) return null;
  return { id: String(row.id ?? ""), title: String(row.title ?? ""), preset: row.preset, start, end, portals };
}

/** The cap to show on `portal` at `now`: of the caps live there, the one that started last. null when none. */
export function activeCap(caps, portal, now = Date.now()) {
  let best = null;
  for (const c of caps || []) {
    if (!c || !c.portals.includes(portal) || now < c.start || now >= c.end) continue;
    if (!best || c.start > best.start) best = c;
  }
  return best;
}

/** Milliseconds until the next start or end on `portal` (when the logo has to change), or null when nothing is coming. */
export function msUntilNextChange(caps, portal, now = Date.now()) {
  let next = Infinity;
  for (const c of caps || []) {
    if (!c || !c.portals.includes(portal)) continue;
    if (c.start > now) next = Math.min(next, c.start);
    if (c.end > now) next = Math.min(next, c.end);
  }
  return next === Infinity ? null : Math.min(next - now, MAX_TIMER_MS);
}

export function cachedCaps() {
  try { return (JSON.parse(localStorage.getItem(CACHE_KEY) || "[]") || []).map(normalizeCap).filter(Boolean); }
  catch { return []; }
}

let memo = null;       // { at, caps }
let inflight = null;   // one request shared by every logo on the screen
/** The schedule (live and upcoming caps). Fetched at most every 5 minutes; on any failure, the last one saved here. */
export function loadCaps({ force = false } = {}) {
  if (!force && memo && Date.now() - memo.at < FRESH_MS) return Promise.resolve(memo.caps);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from("holiday_caps")
        .select("id,title,preset,starts_at,ends_at,portals")
        .gt("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(30);
      if (error) throw error;
      const rows = (data || []).map(normalizeCap).filter(Boolean);
      memo = { at: Date.now(), caps: rows };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(rows.map((c) => ({
          id: c.id, title: c.title, preset: c.preset, starts_at: new Date(c.start).toISOString(), ends_at: new Date(c.end).toISOString(), portals: c.portals,
        }))));
      } catch { /* storage full / blocked — the in-memory copy still works */ }
      return rows;
    } catch {
      return memo?.caps ?? cachedCaps();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// for tests
export function _resetHolidayCapCache() { memo = null; inflight = null; }
