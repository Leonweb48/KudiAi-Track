// West Africa Time (WAT) formatting for receipts and statements.
//
// Mirrors api/_lib/wat.js (which the emails use) so a receipt and the email for
// the same transaction always show the same instant, the same way.
//
// WAT is UTC+1 all year (Nigeria has no daylight saving), so this adds a fixed
// hour and reads the UTC fields. It deliberately does NOT use the device's own
// timezone (a phone can be set to anything) or Intl timezone data (missing in
// some Android WebViews): the same stored timestamp always renders the same way
// and is always labelled.
//
//   formatWAT("2026-09-18T20:14:32Z")  ->  "18 Sep 2026, 09:14:32 PM WAT"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

function toWAT(input) {
  const t = input instanceof Date ? input : new Date(input == null || input === "" ? Date.now() : input);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + 3600000);
}

function clock(w, seconds) {
  let h = w.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${pad(w.getUTCMinutes())}${seconds ? ":" + pad(w.getUTCSeconds()) : ""} ${ap}`;
}

/** "18 Sep 2026, 09:14:32 PM WAT" (seconds optional) */
export function formatWAT(input, { seconds = true } = {}) {
  const w = toWAT(input);
  if (!w) return "—";
  return `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}, ${clock(w, seconds)} WAT`;
}

/** "Sep 26th, 8:23:00 AM" — the compact stamp on a history row (WAT, seconds, no year; the receipt has the full one) */
export function formatWATStamp(input) {
  const ordinal = (d) => d + (d % 100 >= 11 && d % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[d % 10] || "th"));
  // A date-only value (a row still in the offline queue has no server time yet) carries no clock — show the day, never an invented time
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input));
  if (dateOnly) return `${MONTHS[Number(dateOnly[2]) - 1]} ${ordinal(Number(dateOnly[3]))}`;
  const w = toWAT(input);
  if (!w) return "—";
  const d = w.getUTCDate();
  const th = ordinal(d).slice(String(d).length);
  let h = w.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${MONTHS[w.getUTCMonth()]} ${d}${th}, ${h}:${pad(w.getUTCMinutes())}:${pad(w.getUTCSeconds())} ${ap}`;
}

/** "18 Sep 2026" */
export function formatWATDate(input) {
  const w = toWAT(input);
  return w ? `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}` : "—";
}

/** "09:14:32 PM WAT" */
export function formatWATTime(input, { seconds = true } = {}) {
  const w = toWAT(input);
  return w ? `${clock(w, seconds)} WAT` : "—";
}

/** "20260918-2114" — for filenames */
export function watStamp(input) {
  const w = toWAT(input);
  if (!w) return "";
  return `${w.getUTCFullYear()}${pad(w.getUTCMonth() + 1)}${pad(w.getUTCDate())}-${pad(w.getUTCHours())}${pad(w.getUTCMinutes())}`;
}

/** "2026-09" — the WAT calendar month a timestamp falls in (statement grouping) */
export function watMonthKey(input) {
  const w = toWAT(input);
  return w ? `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}` : "";
}

const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-09" -> "September 2026" */
export function monthKeyLabel(key) {
  const [y, m] = String(key || "").split("-");
  const i = Number(m) - 1;
  return LONG_MONTHS[i] ? `${LONG_MONTHS[i]} ${y}` : String(key || "");
}
