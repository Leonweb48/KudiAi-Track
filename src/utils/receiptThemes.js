// Festive receipt themes (2026-10-27) — during a holiday the user can share a receipt dressed for it (OPay-style): the
// festive card in FestiveReceipt.jsx, picked from a strip under the receipt. The admin portal switches each theme on
// (public.receipt_themes — every theme starts OFF) and may set its greeting; artwork and colours live here.
// The id list must match the table's CHECK and the admin portal's copy.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export const RECEIPT_THEMES = {
  christmas: { art: "/receipt-themes/christmas.webp", bg: ["#1E7D49", "#0B4A2A"], accent: "#F4C752" },
  new_year:  { art: "/receipt-themes/new_year.webp",  bg: ["#22357E", "#0A1234"], accent: "#F5C451" },
  eid:       { art: "/receipt-themes/eid.webp",       bg: ["#13705C", "#073A30"], accent: "#F2D27A" },
  easter:    { art: "/receipt-themes/easter.webp",    bg: ["#6E47AD", "#34205C"], accent: "#FFD27F" },
  nigeria:   { art: "/receipt-themes/nigeria.webp",   bg: ["#0A8A4F", "#03502C"], accent: "#FFFFFF" },
  valentine: { art: "/receipt-themes/valentine.webp", bg: ["#C2185B", "#6A0A31"], accent: "#FFD1E0" },
};

const CACHE_KEY = "kt_receipt_themes";
const FRESH_MS = 5 * 60 * 1000;

/** A table row → { id, start, end, message, sort }, or null when the app has no such theme or the window is broken. */
export function normalizeTheme(row) {
  if (!row || !RECEIPT_THEMES[row.id]) return null;
  const start = row.starts_at ? Date.parse(row.starts_at) : null;
  const end = row.ends_at ? Date.parse(row.ends_at) : null;
  if ((row.starts_at && !Number.isFinite(start)) || (row.ends_at && !Number.isFinite(end))) return null;
  const message = String(row.message || "").trim().slice(0, 80);
  return { id: row.id, start, end, message, sort: Number(row.sort) || 0 };
}

/** The themes live at `now`, in the admin's order. */
export function liveThemes(themes, now = Date.now()) {
  return (themes || [])
    .filter((t) => t && (t.start == null || t.start <= now) && (t.end == null || t.end > now))
    .sort((a, b) => a.sort - b.sort);
}

function cached() {
  try { return (JSON.parse(localStorage.getItem(CACHE_KEY) || "[]") || []).map(normalizeTheme).filter(Boolean); }
  catch { return []; }
}

let memo = null;       // { at, themes }
let inflight = null;
/** The switched-on themes (the table only lets the public key read live rows). At most every 5 minutes; on failure the last copy. */
export function loadReceiptThemes({ force = false } = {}) {
  if (!force && memo && Date.now() - memo.at < FRESH_MS) return Promise.resolve(memo.themes);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.from("receipt_themes").select("id,starts_at,ends_at,message,sort").limit(20);
      if (error) throw error;
      const rows = (data || []).map(normalizeTheme).filter(Boolean);
      memo = { at: Date.now(), themes: rows };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(rows.map((t) => ({
          id: t.id, sort: t.sort, message: t.message || null,
          starts_at: t.start == null ? null : new Date(t.start).toISOString(), ends_at: t.end == null ? null : new Date(t.end).toISOString(),
        }))));
      } catch { /* storage blocked — the in-memory copy still works */ }
      return rows;
    } catch {
      return memo?.themes ?? cached();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The festive themes a receipt may use right now ([] when the admin has none switched on). */
export function useReceiptThemes() {
  const [themes, setThemes] = useState(() => liveThemes(memo?.themes ?? cached()));
  useEffect(() => {
    let live = true;
    loadReceiptThemes().then((rows) => { if (live) setThemes(liveThemes(rows)); });
    return () => { live = false; };
  }, []);
  return themes;
}

// for tests
export function _resetReceiptThemeCache() { memo = null; inflight = null; }
