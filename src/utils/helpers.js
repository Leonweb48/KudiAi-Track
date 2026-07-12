export const fmt = (n) =>
  `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

export const LEDGER_LABELS = {
  contribution:              "Contribution",
  withdrawal:                "Withdrawal",
  withdrawal_fee:            "Withdrawal Fee",
  registration_fee:          "Registration Fee",
  commission:                "Commission",
  esusu_payout:              "Esusu Payout",
  reversal_contribution:     "Reversal · Contribution",
  reversal_withdrawal:       "Reversal · Withdrawal",
  reversal_withdrawal_fee:   "Reversal · Withdrawal Fee",
  reversal_registration_fee: "Reversal · Registration Fee",
};

export const ledgerTypeLabel = (type) => {
  if (!type) return "Transaction";
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
