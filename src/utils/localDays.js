// Whole days from dateStr to today, both as LOCAL calendar dates. A bare "YYYY-MM-DD" must be read as local midnight:
// new Date("2026-10-11") is UTC midnight (01:00 in Nigeria), which made an Ajo client's first day show "Expected -1"
// and left a payment due yesterday not overdue until the day after.
export function daysDiff(dateStr, now = new Date()) {
  if (!dateStr) return 0;
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(dateStr);
  if (!m) d.setHours(0, 0, 0, 0);
  return Math.round((t - d) / 86400000);
}
