// Statement periods in WAT (UTC+1 all year): the period chips (PeriodFilter) as a time range, and how a period is
// written on a statement. Shared by the client Statements screen and the wallet statement.

const WAT_MS = 3600000;
export const watToday = () => new Date(Date.now() + WAT_MS).toISOString().slice(0, 10);
const addDay = (ymd, n = 1) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const startOfDay = (ymd) => `${ymd}T00:00:00+01:00`;

/** The period chips as a WAT time range [from, to) — "all" starts at 2000-01-01. */
export function statementRange(period, dateFrom, dateTo, today = watToday()) {
  let from = "2000-01-01", to = today;
  if (period === "today") from = today;
  else if (period === "week") {
    const d = new Date(`${today}T00:00:00Z`);
    from = new Date(d.getTime() - d.getUTCDay() * 86400000).toISOString().slice(0, 10);   // Sunday, as the chips do elsewhere
  } else if (period === "month") from = `${today.slice(0, 7)}-01`;
  else if (period === "custom") { from = dateFrom || "2000-01-01"; to = dateTo || today; }
  return { from: startOfDay(from), to: startOfDay(addDay(to)) };
}

/**
 * The dates a statement covers, inclusive: { fromDate, toDate } as YYYY-MM-DD (WAT). An open start ("all") becomes the
 * first transaction's day, so the statement says what it really covers.
 */
export function statementDates(range, firstAt) {
  const watDay = (iso) => new Date(Date.parse(iso) + WAT_MS).toISOString().slice(0, 10);
  let fromDate = watDay(range.from);
  if (fromDate <= "2000-01-01" && firstAt) fromDate = watDay(firstAt);
  const toDate = addDay(watDay(range.to), -1);
  return { fromDate: fromDate <= "2000-01-01" ? toDate : fromDate, toDate };
}

/** Months that can be downloaded, newest first: from the month they joined to this month (at most 24). */
export function statementMonths(since, today = watToday()) {
  const cur = today.slice(0, 7);
  const start = since && /^\d{4}-\d{2}/.test(String(since)) ? String(since).slice(0, 7) : cur;
  const out = [];
  let [y, m] = cur.split("-").map(Number);
  while (out.length < 24) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key <= start) break;
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}
