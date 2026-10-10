// A "credit sale" is revenue (counted once, when it is recorded — shared/profitEngine R1) AND money the customer
// still owes. The owing part lives in the credits table, which drives "Credit outstanding", overdue alerts and
// WhatsApp reminders. Before 2026-10 a credit sale only wrote the transaction, so the debt never appeared there.
// This turns a saved credit-sale transaction into the matching credit record. Repayments then go through the normal
// record_credit_repayment flow (a "debt repayment" transaction counts as cash only), so nothing is counted twice.

/** Due date as YYYY-MM-DD (local date) from the sale form's choice: "tomorrow" | "1week" | "custom". */
export function isoDueDate(label, customDate, now = new Date()) {
  if (!label) return null;
  if (label === "custom") return /^\d{4}-\d{2}-\d{2}$/.test(customDate || "") ? customDate : null;
  const d = new Date(now);
  if (label === "tomorrow") d.setDate(d.getDate() + 1);
  else if (label === "1week") d.setDate(d.getDate() + 7);
  else return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Credit record input (for useStore.addCredit) for a credit-sale transaction, or null when the transaction is not a
 * credit sale that someone owes money on.
 * @param t        the transaction as passed to addTransaction (type, category, amount, customer_name, due_date, …)
 * @param saved    the saved transaction row (for its receipt reference), optional
 */
export function creditFromSale(t, saved = null) {
  if (!t || t.type !== "in" || t.category !== "credit sale") return null;
  const customer = String(t.customer_name || "").trim();
  const amount = parseFloat(t.amount) || 0;
  if (!customer || amount <= 0) return null;

  const items = Array.isArray(t.line_items) && t.line_items.length
    ? t.line_items.map((l) => ({
        product_name: l.name || l.item_name || "",
        quantity:     l.qty ?? l.quantity ?? 1,
        unit_price:   l.unitPrice ?? l.unit_price ?? null,
        cost_price:   l.costPrice ?? l.enteredCostPrice ?? l.cost_price ?? null,
      }))
    : t.item_name
      ? [{ product_name: t.item_name, quantity: t.quantity || 1, unit_price: t.unit_price ?? (amount / (t.quantity || 1)), cost_price: t.cost_price ?? null }]
      : null;

  const what = items ? items.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.product_name}` : i.product_name)).join(", ") : "goods";
  const ref = saved?.receipt_ref ? ` (${saved.receipt_ref})` : "";
  return {
    customer_name: customer,
    total_amount:  amount,
    due_date:      t.due_date || null,
    notes:         `Credit sale: ${what}${ref}`,
    items,
  };
}
