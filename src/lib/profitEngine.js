/**
 * Profit Engine — single derivation source for all income/profit/cash/capital figures.
 *
 * Inputs  (ledger object):
 *   transactions   — store.transactions (all-time; engine filters by range)
 *   invoices       — invoiceHook.invoices (with invoice_payments sub-array)
 *   products       — inventory.products (for COGS lookup)
 *   asoClients     — store.asoClients (for Ajo liability fallback)
 *   ajoEntries?    — optional [{ id, type, amount, date }] from an Ajo ledger table
 *                    type: "contribution" | "payout"
 *   debtPayments?  — optional store.debtPayments (for interest-earned recognition)
 *   credits?       — optional store.credits (for interest allocation)
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
 *   All figures derive from transactions, products, invoice_payments, aso_clients,
 *   debt_payments, credits. Migration 20260717100000 adds source + needs_costing to
 *   products — classification flags, not cached aggregates.
 *   Migration 20260717400000 adds interest_type/value/amount to credits — immutable
 *   at creation; never cached aggregates. Every figure is fully re-derivable by
 *   replaying these rules over the raw ledger.
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
 *   R7  Interest earned = interest portion of debt repayments, recognized at collection.
 *       Repayments are allocated principal-first; interest portion enters profit.revenue
 *       (zero COGS, fully measured) once the full principal is recovered.
 *       Interest is already in cash.in via the repayment transaction — it is NOT
 *       added to cash.in again. No compounding, no time-based accrual.
 *       Bills invariant: credits and bills are structurally separate tables.
 *       No bill path can carry interest_amount by construction.
 */

// ── Category constants ────────────────────────────────────────────────────────
const REVENUE_CATS = new Set([
  "sale", "credit sale",
  "registration_fee", "withdrawal_fee", "commission",
]);
const SERVICE_CATS = new Set(["registration_fee", "withdrawal_fee", "commission"]);
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
    debtPayments = [],
    credits      = [],
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

  // ── COGS (R3) ─────────────────────────────────────────────────────────────
  const productByName = new Map(
    products.map(p => [p.product_name.toLowerCase().trim(), p])
  );

  let cogsAmount  = 0;
  const cogsTxIds = [];
  let measuredRev = 0;
  const unmeasItems = [];

  for (const t of revTxs) {
    if (SERVICE_CATS.has(t.category)) {
      measuredRev += t.amount;
      continue;
    }
    const name = (t.item_name || "").toLowerCase().trim();
    if (!name) {
      unmeasItems.push({ id: t.id, amount: t.amount });
      continue;
    }
    const prod = productByName.get(name);
    if (prod && !prod.needs_costing && (prod.cost_price || 0) > 0) {
      measuredRev += t.amount;
      cogsAmount  += prod.cost_price * (t.quantity || 1);
      cogsTxIds.push(t.id);
    } else {
      unmeasItems.push({ id: t.id, amount: t.amount });
    }
  }

  measuredRev += invPmtItems.reduce((s, x) => s + x.amount, 0);

  const cogs       = { amount: cogsAmount, txIds: cogsTxIds };
  const unmeasured = {
    count:   unmeasItems.length,
    revenue: unmeasItems.reduce((s, x) => s + x.amount, 0),
    txIds:   unmeasItems.map(x => x.id),
  };
  const grossProfit = { amount: measuredRev - cogsAmount, txIds: [] };

  // ── Expenses (R5) ─────────────────────────────────────────────────────────
  const expTxs  = txsOut.filter(t => !STOCK_CATS.has(t.category) && !isBillPayment(t));
  const expenses = pool(expTxs.map(t => ({ id: t.id, amount: t.amount })));

  // ── Interest earned (R7) ──────────────────────────────────────────────────
  // Principal-first allocation across all repayments for each interest-bearing credit.
  // Interest portion is recognized in profit.revenue only when collected (in-range).
  // The repayment transaction already captures the full cash flow in cash.in —
  // interestItems are NOT added to cashIn (would double-count).
  //
  // Bills invariant: credits.interest_amount is NULL for all records created before
  // migration 20260717400000. The bills system uses transactions.bill_status and
  // payment_type='bill_payment' — it has no connection to the credits table.
  // No bill path can carry interest by construction.
  const interestItems = [];
  const interestMeta  = new Map(); // id -> { label, amount, date } for drill-down resolution
  const creditsWithInterest = credits.filter(c => (c.interest_amount || 0) > 0 && c.status !== "voided");

  for (const credit of creditsWithInterest) {
    const creditPmts = debtPayments
      .filter(p => p.credit_id === credit.id)
      .sort((a, b) => new Date(a.created_at || a.payment_date || 0) - new Date(b.created_at || b.payment_date || 0));

    let principalRemaining = credit.total_amount;
    let interestRemaining  = credit.interest_amount;

    for (const pmt of creditPmts) {
      const amt             = pmt.amount || 0;
      const principalPortion = Math.min(amt, principalRemaining);
      principalRemaining    -= principalPortion;
      const interestPortion  = Math.min(amt - principalPortion, interestRemaining);
      interestRemaining     -= interestPortion;

      if (interestPortion > 0) {
        const ds = pmt.created_at || pmt.payment_date;
        const d  = ds ? (ds.includes("T") ? new Date(ds) : new Date(ds + "T00:00:00")) : null;
        if (d && inRange(d, from, to)) {
          const id = `int-${pmt.id}`;
          interestItems.push({ id, amount: interestPortion });
          interestMeta.set(id, {
            label:  `Interest — ${credit.customer_name || "Customer"}`,
            amount: interestPortion,
            date:   ds ? ds.slice(0, 10) : "",
          });
        }
      }
    }
  }

  const interestEarned = { ...pool(interestItems), meta: interestMeta };
  // Interest: zero COGS, fully measured — contributes to gross profit
  measuredRev += interestEarned.amount;
  // Recalculate grossProfit with interest included
  grossProfit.amount = measuredRev - cogsAmount;

  // ── Revenue total (R1 + R2 + R7) ─────────────────────────────────────────
  const revItems = [
    ...revTxs.map(t => ({ id: t.id, amount: t.amount })),
    ...invPmtItems,
    ...interestItems,
  ];
  const revenue = pool(revItems);

  // ── Net profit ────────────────────────────────────────────────────────────
  const netProfit = { amount: grossProfit.amount - expenses.amount, txIds: [] };

  // ── Cash view (R6) ────────────────────────────────────────────────────────
  const cashInItems = [
    ...txsIn.map(t => ({ id: t.id, amount: t.amount })),
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
    interestEarned,
    expenses:         pool(expTxs.map(t => ({ id: t.id, amount: t.amount }))),
    stockInvestment:  pool(txsOut.filter(t => STOCK_CATS.has(t.category)).map(t => ({ id: t.id, amount: t.amount }))),
    billPayments:     pool(txsOut.filter(t => isBillPayment(t)).map(t => ({ id: t.id, amount: t.amount }))),
  };

  // ── Ajo liabilities ───────────────────────────────────────────────────────
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
 * Compute working capital position.
 * Returns null when working_capital_amount is unset (feature hidden).
 *
 * capitalPosition = declared_capital + cumulativeNetProfit(from as_of_date)
 *
 * Owner drawings: no "owner_draw" or equivalent disbursement category exists in
 * the current transaction schema. Drawings are omitted from the formula;
 * position tracks P&L health against declared capital only.
 *
 * Three states:
 *   healthy — cushion ≥ 0 (profit has not eroded capital)
 *   amber   — cushion < 0 but loss ≤ 10% of capital (default threshold)
 *   red     — cushion < −threshold (meaningful capital erosion, shortfall figure shown)
 */
export function computeCapital(ledger, capitalSettings) {
  if (!capitalSettings?.amount_kobo) return null;

  const capitalNaira = capitalSettings.amount_kobo / 100;
  const asOf = capitalSettings.as_of_date
    ? new Date(capitalSettings.as_of_date + "T00:00:00")
    : new Date("2000-01-01T00:00:00");
  const to = new Date();
  to.setHours(23, 59, 59, 999);

  const engine = compute(ledger, { from: asOf, to });
  const cumulativeNetProfit = engine.profit.netProfit.amount;
  const position = capitalNaira + cumulativeNetProfit;
  const cushion  = cumulativeNetProfit; // position − capital

  const threshold = capitalNaira * 0.10;
  let status;
  if (cushion >= 0) {
    status = "healthy";
  } else if (Math.abs(cushion) <= threshold) {
    status = "amber";
  } else {
    status = "red";
  }

  return {
    capital:  { amount: capitalNaira, id: "capital"  },
    position: { amount: position,     id: "position" },
    cushion:  { amount: cushion,      id: "cushion"  },
    status,
    shortfall: cushion < 0 ? Math.abs(cushion) : 0,
  };
}

/**
 * Count unnamed sales in a date range — used by the weekly nudge in useStore.js.
 */
export function countUnnamedSales(transactions, from, to) {
  return transactions.filter(t =>
    t.type === "in" &&
    REVENUE_CATS.has(t.category) &&
    (!t.item_name || !t.item_name.trim()) &&
    inRange(parseTxDate(t), from, to)
  ).length;
}
