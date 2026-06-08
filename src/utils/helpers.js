export const fmt = (n) =>
  `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

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
