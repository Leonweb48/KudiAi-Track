// West Africa Time (WAT) formatting for emails and receipts.
//
// WAT is UTC+1 all year (Nigeria has no daylight saving), so this adds a fixed
// hour and reads the UTC fields. It deliberately does NOT use the runtime's own
// timezone (a Supabase/Vercel server runs in UTC, a phone in whatever it is set
// to) or Intl timezone data (unavailable in some Android WebViews) — the same
// instant always renders the same way, and is always labelled.
//
//   formatWAT("2026-09-18T20:14:32Z")  ->  "18 Sep 2026, 09:14:32 PM WAT"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

function toWAT(input) {
  const t = input instanceof Date ? input : new Date(input == null || input === "" ? Date.now() : input);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + 3600000);
}

/** "18 Sep 2026, 09:14:32 PM WAT" (seconds optional) */
export function formatWAT(input, { seconds = true } = {}) {
  const w = toWAT(input);
  if (!w) return "—";
  let h = w.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}, ${pad(h)}:${pad(w.getUTCMinutes())}${seconds ? ":" + pad(w.getUTCSeconds()) : ""} ${ap} WAT`;
}

/** "18 Sep 2026" */
export function formatWATDate(input) {
  const w = toWAT(input);
  return w ? `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}` : "—";
}

/** "09:14:32 PM WAT" */
export function formatWATTime(input, { seconds = true } = {}) {
  const w = toWAT(input);
  if (!w) return "—";
  let h = w.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${pad(w.getUTCMinutes())}${seconds ? ":" + pad(w.getUTCSeconds()) : ""} ${ap} WAT`;
}
