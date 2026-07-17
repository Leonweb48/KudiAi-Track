/**
 * Profit Engine — single derivation source for all income/profit/cash figures.
 *
 * Inputs  (ledger object):
 *   transactions   — store.transactions (all-time; engine filters by range)
 *   invoices       — invoiceHook.invoices (with invoice_payments sub-array)
 *   products       — inventory.products (for COGS lookup)
 *   asoClients     — store.asoClients (for Ajo liability fallback)
 *   ajoEntries?    — optional [{ id, type, amount, date }] from an Ajo ledger table
 *                    type: "contribution" | "payout" (contributions/payouts only;
 *                    fees should appear as regular transactions)
 *
 * Inputs  (range):
 *   from, to — Date objects (inclusive on both ends)
 *
 * Outputs:
 *   cash:        { in, out, net, byStream }
 *   profit:      { revenue, cogs, grossProfit, expenses, netProfit, unmeasured }
 *   liabilities: { ajoHeld, ajoReleased }
 *
 * Every monetary figure: { amount: number, txIds: string[] }
 * — decomposable to contributing transaction/entry IDs for audit.
 *
 * SCHEMA DIFF EVIDENCE — no new stored counters:
 *   All figures derive from transactions, products, invoice_payments, aso_clients.
 *   The migration 20260717100000_products_auto_stub.sql adds source + needs_costing
 *   to products — classification flags, not cached aggregates. Every figure here
 *   can be fully re-derived by replaying these rules over the raw ledger.
 *
 * DERIVATION RULES:
 *   R1  Revenue = "in" transactions where category ∈ REVENUE_CATS (excludes debt
 *       repayments). Credit sales counted at recording time (accrual for credit);
 *       repayments are Cash-only. Invoice payments counted at payment receipt (cash-basis).
 *   R2  Service income = category ∈ SERVICE_CATS (Ajo fees). Zero COGS by definition —
 *       they count as measured revenue (gross profit contribution = full amount).
 *   R3  COGS = cost_price × quantity for "in" transactions where item_name matches a
 *       costed product (!needs_costing && cost_price > 0). Past stubs or missing
 *       product → tracked as unmeasured (revenue known, margin unknown).
 *   R4  Gross profit = measuredRevenue − COGS (excludes unmeasured items intentionally).
 *   R5  Expenses = "out" transactions excluding stock purchases and bill pass-throughs.
 *   R6  Cash view = all actual money movements regardless of P&L treatment:
 *       cash.in includes debt repayments + invoice payments.
 *       cash.out includes stock + bill payments + expenses.
 *       No double-count: credit sales in revenue once; repayments in cash only.
 */

// ── Category constants ────────────────────────────────────────────────────────
// R1: categories that constitute business revenue at recording time
const REVENUE_CATS = new Set([
  "sale", "credit sale",
  "registration_fee", "withdrawal_fee", "commission",   // Ajo service income
]);
// R2: zero-COGS service categories (sub-set of REVENUE_CATS)
const SERVICE_CATS = new Set(["registration_fee", "withdrawal_fee", "commission"]);
// R5: inventory investment — cash-out but not a P&L expense
const STOCK_CATS   = new Set(["stock"]);

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseTxDate(t) {
  const s = t.transaction_date || t.created_at || "";
  return s.includes("T") ? new Date(s) : new Date(s + "T00:00:00");
}

function inRange(dateInput, from, to) {
  const d = dateInput instanceof Date ? dateInput : parseTxDate({ transaction_date: dateInput, created_at: dateInput });
  return d >= from && d <= to;
}

function isBillPayment(t) {
  return (t.bill_status != null && t.bill_status !== "") || t.payment_type === "bill_payment";
}

function pool(items) {
  return {
    amount: items.reduce((s, x) => s + (x.amount || 0), 0),
    txIds:  items.map(x => x.id),
  };
}

// ── Main compute ──────────────────────────────────────────────────────────────
export function compute(ledger, range) {
  const {
    transactions = [],
    invoices     = [],
    products     = [],
    asoClients   = [],
    ajoEntries   = [],
  } = ledger;
  const { from, to } = range;

  // ── Filter transactions to range ──────────────────────────────────────────
  const txs    = transactions.filter(t => inRange(parseTxDate(t), from, to));
  const txsIn  = txs.filter(t => t.type === "in");
  const txsOut = txs.filter(t => t.type === "out");

  // ── Invoice payments (cash-basis, no overlap with transactions) ───────────
  const invPmtItems = invoices.flatMap(inv =>
    (inv.invoice_payments || [])
      .filter(p => {
        const d = p.payment_date || p.created_at || "";
        return inRange(d.includes("T") ? new Date(d) : new Date(d + "T00:00:00"), from, to);
      })
      .map(p => ({ id: `inv-${p.id}`, amount: (p.amount_kobo || 0) / 100 }))
  );

  // ── Revenue (R1 + R2) ─────────────────────────────────────────────────────
  const revTxs  = txsIn.filter(t => REVENUE_CATS.has(t.category) && !isBillPayment(t));
  const revItems = [
    ...revTxs.map(t => ({ id: t.id, amount: t.amount })),
    ...invPmtItems,
  ];
  const revenue = pool(revItems);

  // ── COGS (R3) ─────────────────────────────────────────────────────────────
  // Build product lookup keyed by normalised name — matches AddTxnModal's collision check
  const productByName = new Map(
    products.map(p => [p.product_name.toLowerCase().trim(), p])
  );

  let cogsAmount  = 0;
  const cogsTxIds = [];
  let measuredRev = 0;
  const unmeasItems = [];

  for (const t of revTxs) {
    // Service income: zero COGS by definition → measured, full margin
    if (SERVICE_CATS.has(t.category)) {
      measuredRev += t.amount;
      continue;
    }
    const name = (t.item_name || "").toLowerCase().trim();
    if (!name) {
      // Unnamed sale — margin unknown, tracked separately
      unmeasItems.push({ id: t.id, amount: t.amount });
      continue;
    }
    const prod = productByName.get(name);
    if (prod && !prod.needs_costing && (prod.cost_price || 0) > 0) {
      // R3: costed product — COGS applies; cost is set and finalised
      measuredRev += t.amount;
      cogsAmount  += prod.cost_price * (t.quantity || 1);
      cogsTxIds.push(t.id);
    } else {
      // Auto-stub (needs_costing=true) or no product match → unmeasured margin
      unmeasItems.push({ id: t.id, amount: t.amount });
    }
  }

  // Invoice payments have zero COGS (service/B2B income)
  measuredRev += invPmtItems.reduce((s, x) => s + x.amount, 0);

  const cogs        = { amount: cogsAmount, txIds: cogsTxIds };
  const unmeasured  = {
    count:   unmeasItems.length,
    revenue: unmeasItems.reduce((s, x) => s + x.amount, 0),
    txIds:   unmeasItems.map(x => x.id),
  };
  // R4: gross profit = measuredRevenue − COGS (conservative: excludes unmeasured items)
  const grossProfit = { amount: measuredRev - cogsAmount, txIds: [] };

  // ── Expenses (R5) ─────────────────────────────────────────────────────────
  const expTxs  = txsOut.filter(t => !STOCK_CATS.has(t.category) && !isBillPayment(t));
  const expenses = pool(expTxs.map(t => ({ id: t.id, amount: t.amount })));

  // ── Net profit ────────────────────────────────────────────────────────────
  const netProfit = { amount: grossProfit.amount - expenses.amount, txIds: [] };

  // ── Cash view (R6) ────────────────────────────────────────────────────────
  const cashInItems  = [
    ...txsIn.map(t => ({ id: t.id, amount: t.amount })),  // includes debt repayments
    ...invPmtItems,
  ];
  const cashIn  = pool(cashInItems);
  const cashOut = pool(txsOut.map(t => ({ id: t.id, amount: t.amount })));

  // ── Cash by stream ────────────────────────────────────────────────────────
  const byStream = {
    sales:            pool(txsIn.filter(t => t.category === "sale" && !isBillPayment(t)).map(t => ({ id: t.id, amount: t.amount }))),
    creditSales:      pool(txsIn.filter(t => t.category === "credit sale").map(t => ({ id: t.id, amount: t.amount }))),
    creditRepayments: pool(txsIn.filter(t => t.category === "debt repayment").map(t => ({ id: t.id, amount: t.amount }))),
    invoicePayments:  pool(invPmtItems),
    ajoFeeIncome:     pool(txsIn.filter(t => SERVICE_CATS.has(t.category)).map(t => ({ id: t.id, amount: t.amount }))),
    expenses:         pool(expTxs.map(t => ({ id: t.id, amount: t.amount }))),
    stockInvestment:  pool(txsOut.filter(t => STOCK_CATS.has(t.category)).map(t => ({ id: t.id, amount: t.amount }))),
    billPayments:     pool(txsOut.filter(t => isBillPayment(t)).map(t => ({ id: t.id, amount: t.amount }))),
  };

  // ── Ajo liabilities ───────────────────────────────────────────────────────
  // ajoEntries carry contribution/payout movements from the Ajo ledger.
  // Contributions are money held in trust (liability, never income).
  // Payouts are releases of that trust.
  // Fallback: if no ajoEntries, sum current_balance from aso_clients.
  const ajoContrib = ajoEntries.filter(e => e.type === "contribution" && inRange(e.date, from, to));
  const ajoPayout  = ajoEntries.filter(e => e.type === "payout"       && inRange(e.date, from, to));
  const ajoHeldAmt = ajoContrib.length
    ? ajoContrib.reduce((s, e) => s + e.amount, 0)
    : asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);

  const liabilities = {
    ajoHeld:     { amount: ajoHeldAmt, txIds: ajoContrib.map(e => e.id) },
    ajoReleased: { amount: ajoPayout.reduce((s, e) => s + e.amount, 0), txIds: ajoPayout.map(e => e.id) },
  };

  return {
    cash:        { in: cashIn, out: cashOut, net: { amount: cashIn.amount - cashOut.amount }, byStream },
    profit:      { revenue, cogs, grossProfit, expenses, netProfit, unmeasured },
    liabilities,
  };
}

/**
 * Count unnamed sales in a date range — used by the weekly nudge in useStore.js.
 * "Unnamed" = type="in", REVENUE_CATS, item_name blank/null.
 */
export function countUnnamedSales(transactions, from, to) {
  return transactions.filter(t =>
    t.type === "in" &&
    REVENUE_CATS.has(t.category) &&
    (!t.item_name || !t.item_name.trim()) &&
    inRange(parseTxDate(t), from, to)
  ).length;
}
