import { formatNGN } from './formatNGN';
export { formatNGN };
export const fmt = (amount) => formatNGN(amount);

export const LEDGER_LABELS = {
  contribution:              "Contribution",
  withdrawal:                "Withdrawal",
  withdrawal_fee:            "Withdrawal Fee",
  registration_fee:          "Registration Fee",
  commission:                "Commission",
  esusu_payout:              "Esusu Payout",
  esusu_pot_sweep:           "Esusu Pot Sweep",
  reversal_contribution:     "Reversal · Contribution",
  reversal_withdrawal:       "Reversal · Withdrawal",
  reversal_withdrawal_fee:   "Reversal · Withdrawal Fee",
  reversal_registration_fee: "Reversal · Registration Fee",
};

export const ledgerTypeLabel = (typeOrRow) => {
  if (!typeOrRow) return "Transaction";
  if (typeof typeOrRow === "object") {
    const { type, cycle_id, notes } = typeOrRow;
    // first_period cycle fee: commission row linked to a cycle
    if (type === "commission" && cycle_id) return "Cycle fee — first deposit";
    return ledgerTypeLabel(type);
  }
  const type = typeOrRow;
  if (LEDGER_LABELS[type]) return LEDGER_LABELS[type];
  if (type.startsWith("reversal_")) {
    const base = LEDGER_LABELS[type.slice(9)];
    return `Reversal${base ? ` · ${base}` : ""}`;
  }
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-NG", { dateStyle: "medium" });
};

export const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
};

export const today = () => new Date().toISOString().split("T")[0];

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

export const filterByPeriod = (transactions, period) => {
  const now = new Date();
  return transactions.filter((t) => {
    const d = new Date(t.transaction_date);
    if (period === "today") return t.transaction_date === today();
    if (period === "week")  return now - d <= 7 * 86400000;
    return now - d <= 30 * 86400000;
  });
};

// Calendar-relative period filter used across Sales, Bills, Credit, Ajo, Invoices, Coop.
// getDateStr(item) must return an ISO string or YYYY-MM-DD; sliced to 10 chars for comparison.
export function applyPeriodFilter(items, period, dateFrom, dateTo, getDateStr) {
  if (!period || period === "all") return items;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  let from, to;
  if (period === "today") {
    from = to = todayStr;
  } else if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay()); // Sunday of current week
    from = d.toISOString().slice(0, 10);
    to = todayStr;
  } else if (period === "month") {
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    to = todayStr;
  } else if (period === "custom") {
    from = dateFrom || null;
    to = dateTo || todayStr;
  } else {
    return items;
  }
  return items.filter(item => {
    const raw = getDateStr(item);
    if (!raw) return false;
    const d = String(raw).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}
