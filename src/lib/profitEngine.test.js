import { compute, computeCapital, countUnnamedSales } from "./profitEngine";

const RANGE = {
  from: new Date("2026-07-01T00:00:00"),
  to:   new Date("2026-07-31T23:59:59"),
};

// ── Test 1: No-double-count invariant — credit sale + two repayments ─────────
// Rule: credit sale = revenue once. Each debt repayment = cash only, never revenue.
test("credit sale counts as revenue once; repayments are cash-only", () => {
  const ledger = {
    transactions: [
      { id: "t1", type: "in", category: "credit sale",   amount: 20000, transaction_date: "2026-07-10" },
      { id: "t2", type: "in", category: "debt repayment", amount: 10000, transaction_date: "2026-07-11" },
      { id: "t3", type: "in", category: "debt repayment", amount: 10000, transaction_date: "2026-07-12" },
    ],
  };
  const r = compute(ledger, RANGE);

  expect(r.profit.revenue.amount).toBe(20000);        // credit sale only; repayments excluded
  expect(r.cash.in.amount).toBe(40000);               // all three type=in
  // Unnamed credit sale → margin unknown → goes to unmeasured, not gross profit
  expect(r.profit.unmeasured.revenue).toBe(20000);
  expect(r.profit.grossProfit.amount).toBe(0);        // no costed items
  expect(r.cash.byStream.creditRepayments.amount).toBe(20000); // repayments in cash stream
});

// ── Test 2: Invoice payment (cash-basis) ──────────────────────────────────────
// Rule: invoice revenue counted at payment date, in kobo ÷ 100.
// No transaction record — invoices are a separate system.
test("invoice payment is revenue and cash at payment time", () => {
  const ledger = {
    invoices: [{
      id: "inv1",
      status: "paid",
      invoice_payments: [{ id: "p1", amount_kobo: 5000000, payment_date: "2026-07-15" }],
    }],
  };
  const r = compute(ledger, RANGE);

  expect(r.profit.revenue.amount).toBe(50000);
  expect(r.cash.in.amount).toBe(50000);
});

// ── Test 3: Ajo fee income vs Ajo liability ───────────────────────────────────
// Rule: registration_fee + withdrawal_fee = service income (zero COGS).
// Contributions = liability held in trust (never income).
// Payouts = liability released.
test("Ajo fee income is ₦300; contribution is liability not income", () => {
  const ledger = {
    transactions: [
      { id: "t1", type: "in", category: "registration_fee", amount: 200, transaction_date: "2026-07-10" },
      { id: "t2", type: "in", category: "withdrawal_fee",   amount: 100, transaction_date: "2026-07-10" },
    ],
    ajoEntries: [
      { id: "a1", type: "contribution", amount: 500, date: "2026-07-10" },
      { id: "a2", type: "payout",       amount: 500, date: "2026-07-10" },
    ],
  };
  const r = compute(ledger, RANGE);

  expect(r.profit.revenue.amount).toBe(300);           // fee income only
  expect(r.profit.cogs.amount).toBe(0);                // service = zero COGS
  expect(r.profit.grossProfit.amount).toBe(300);       // full service margin
  expect(r.liabilities.ajoHeld.amount).toBe(500);      // contribution in trust
  expect(r.liabilities.ajoReleased.amount).toBe(500);  // payout released
});

// ── Test 4: COGS — costed item + uncosted stub ────────────────────────────────
// Rule: COGS = cost_price × quantity for costed products only.
// Stub sales (needs_costing=true) → revenue tracked, margin unknown → unmeasured.
test("costed item gives COGS and gross profit; stub goes to unmeasured", () => {
  const ledger = {
    products: [
      { id: "p1", product_name: "Widget", cost_price: 700, selling_price: 1000, needs_costing: false },
      { id: "p2", product_name: "Gadget", cost_price: null, selling_price: 2000, needs_costing: true },
    ],
    transactions: [
      { id: "t1", type: "in", category: "sale", amount: 3000, item_name: "Widget", quantity: 3, transaction_date: "2026-07-10" },
      { id: "t2", type: "in", category: "sale", amount: 2000, item_name: "Gadget", quantity: 1, transaction_date: "2026-07-10" },
    ],
  };
  const r = compute(ledger, RANGE);

  expect(r.profit.revenue.amount).toBe(5000);          // total revenue both items
  expect(r.profit.cogs.amount).toBe(2100);             // 700 × 3
  expect(r.profit.grossProfit.amount).toBe(900);       // measuredRev(3000) − COGS(2100)
  expect(r.profit.unmeasured.count).toBe(1);
  expect(r.profit.unmeasured.revenue).toBe(2000);
});

// ── Test 5: Stock purchase is cash-out but not a P&L expense ─────────────────
// Rule: category="stock" = inventory investment — appears in cash.out + byStream.stockInvestment
// but is excluded from P&L expenses (it converts cash to inventory asset).
test("stock purchase excluded from P&L expenses; included in cash.out", () => {
  const ledger = {
    transactions: [
      { id: "e1", type: "out", category: "stock",   amount: 40000, transaction_date: "2026-07-10" },
      { id: "e2", type: "out", category: "expense",  amount: 5000,  transaction_date: "2026-07-10" },
    ],
  };
  const r = compute(ledger, RANGE);

  expect(r.profit.expenses.amount).toBe(5000);                      // stock excluded
  expect(r.cash.out.amount).toBe(45000);                            // all cash-outs
  expect(r.cash.byStream.stockInvestment.amount).toBe(40000);
  expect(r.cash.byStream.expenses.amount).toBe(5000);
});

// ── Test 6: Mixed 20-transaction fixture (reconciliation) ─────────────────────
// Hand-computed expected values below.
//
// RECONCILIATION vs old Finance naïve computation (all-in minus all-out):
//   Old Finance: moneyIn = 11150, moneyOut = 16100, net = −4950
//   Engine:      revenue =  9150, expenses =  8100, netProfit = −6250
//   Difference (−1300) explained:
//     Revenue removes debt repayments (−2000): unmeasured stub revenue (2300) excluded
//     from gross profit; COGS (5000) deducted; stock removed from expenses (+8000).
//     Net: −2000 − 2300 − 5000 + 8000 = −1300 ✓

const MIX_PRODS = [
  { id: "p1", product_name: "Rice",         cost_price: 400, selling_price: 600,  needs_costing: false },
  { id: "p2", product_name: "Sugar",        cost_price: 450, selling_price: 750,  needs_costing: false },
  { id: "p3", product_name: "Salt",         cost_price: 80,  selling_price: 100,  needs_costing: false },
  { id: "p4", product_name: "Flour",        cost_price: 400, selling_price: 500,  needs_costing: false },
  { id: "p5", product_name: "Unknown Item", cost_price: null, selling_price: 600, needs_costing: true  },
];

const MIX_TXS = [
  // Costed sales (measuredRev)
  { id: "s1",  type: "in",  category: "sale",         amount: 1000, item_name: "Rice",         quantity: 2, transaction_date: "2026-07-01" },
  { id: "s2",  type: "in",  category: "sale",         amount: 1500, item_name: "Sugar",        quantity: 3, transaction_date: "2026-07-02" },
  { id: "s3",  type: "in",  category: "sale",         amount: 500,  item_name: "Salt",         quantity: 5, transaction_date: "2026-07-03" },
  { id: "s4",  type: "in",  category: "credit sale",  amount: 2000, item_name: "Flour",        quantity: 4, transaction_date: "2026-07-04" },
  // Debt repayments (cash only — not revenue)
  { id: "s5",  type: "in",  category: "debt repayment", amount: 1000, transaction_date: "2026-07-05" },
  { id: "s6",  type: "in",  category: "debt repayment", amount: 1000, transaction_date: "2026-07-06" },
  // Unnamed sales (unmeasured)
  { id: "s7",  type: "in",  category: "sale",         amount: 800,  item_name: "",             quantity: 1, transaction_date: "2026-07-07" },
  // Ajo service income (zero COGS — measured)
  { id: "s8",  type: "in",  category: "registration_fee", amount: 500, transaction_date: "2026-07-08" },
  // More costed sales
  { id: "s9",  type: "in",  category: "sale",         amount: 600,  item_name: "Rice",         quantity: 1, transaction_date: "2026-07-09" },
  { id: "s10", type: "in",  category: "sale",         amount: 750,  item_name: "Sugar",        quantity: 1, transaction_date: "2026-07-10" },
  // Another unnamed
  { id: "s11", type: "in",  category: "sale",         amount: 300,  item_name: "",             quantity: 1, transaction_date: "2026-07-10" },
  // Stub sale (uncosted product → unmeasured)
  { id: "s12", type: "in",  category: "sale",         amount: 1200, item_name: "Unknown Item", quantity: 2, transaction_date: "2026-07-11" },
  // P&L expenses
  { id: "e1",  type: "out", category: "expense",  amount: 2000, transaction_date: "2026-07-01" },
  { id: "e2",  type: "out", category: "expense",  amount: 1500, transaction_date: "2026-07-02" },
  { id: "e3",  type: "out", category: "salary",   amount: 3000, transaction_date: "2026-07-03" },
  // Stock purchases (cash-out, NOT P&L expense)
  { id: "e4",  type: "out", category: "stock",    amount: 5000, transaction_date: "2026-07-04" },
  { id: "e5",  type: "out", category: "stock",    amount: 3000, transaction_date: "2026-07-05" },
  // Other expenses
  { id: "e6",  type: "out", category: "other",    amount: 500,  transaction_date: "2026-07-06" },
  { id: "e7",  type: "out", category: "other",    amount: 300,  transaction_date: "2026-07-07" },
  { id: "e8",  type: "out", category: "expense",  amount: 800,  transaction_date: "2026-07-11" },
];

// Hand-computed expected values:
// revenue     = s1+s2+s3+s4+s7+s8+s9+s10+s11+s12 = 1000+1500+500+2000+800+500+600+750+300+1200 = 9150
// COGS        = Rice(400×2)+Sugar(450×3)+Salt(80×5)+Flour(400×4)+Rice(400×1)+Sugar(450×1)
//             = 800+1350+400+1600+400+450 = 5000
// measuredRev = s1+s2+s3+s4+s8+s9+s10 = 1000+1500+500+2000+500+600+750 = 6850
// grossProfit = 6850 − 5000 = 1850
// unmeasured  = s7(800) + s11(300) + s12(1200) → count=3, revenue=2300
// expenses    = e1+e2+e3+e6+e7+e8 = 2000+1500+3000+500+300+800 = 8100
// netProfit   = 1850 − 8100 = −6250
// cash.in     = s1..s12 = 1000+1500+500+2000+1000+1000+800+500+600+750+300+1200 = 11150
// cash.out    = e1..e8 = 2000+1500+3000+5000+3000+500+300+800 = 16100
// cash.net    = 11150 − 16100 = −4950
// stockInvestment = e4+e5 = 8000
// creditRepayments = s5+s6 = 2000

test("mixed 20-transaction fixture: full reconciliation", () => {
  const ledger = { transactions: MIX_TXS, products: MIX_PRODS };
  const r = compute(ledger, RANGE);

  expect(r.profit.revenue.amount).toBe(9150);
  expect(r.profit.cogs.amount).toBe(5000);
  expect(r.profit.grossProfit.amount).toBe(1850);
  expect(r.profit.unmeasured.count).toBe(3);
  expect(r.profit.unmeasured.revenue).toBe(2300);
  expect(r.profit.expenses.amount).toBe(8100);
  expect(r.profit.netProfit.amount).toBe(-6250);
  expect(r.cash.in.amount).toBe(11150);
  expect(r.cash.out.amount).toBe(16100);
  expect(r.cash.net.amount).toBe(-4950);
  expect(r.cash.byStream.stockInvestment.amount).toBe(8000);
  expect(r.cash.byStream.creditRepayments.amount).toBe(2000);
});

// ── A tests: computeCapital ───────────────────────────────────────────────────

// A1: null when working_capital_amount is unset
test("A1: computeCapital returns null when amount_kobo not set", () => {
  expect(computeCapital({}, null)).toBeNull();
  expect(computeCapital({}, {})).toBeNull();
  expect(computeCapital({}, { amount_kobo: 0 })).toBeNull();
});

// A2: healthy status — cumulative profit ≥ 0 (no erosion)
// Uses registration_fee (service income — always measured, zero COGS)
test("A2: healthy status when net profit is positive", () => {
  const ledger = {
    transactions: [
      { id: "t1", type: "in",  category: "registration_fee", amount: 50000, transaction_date: "2026-01-10" },
      { id: "t2", type: "out", category: "expense",           amount: 10000, transaction_date: "2026-01-11" },
    ],
  };
  const result = computeCapital(ledger, { amount_kobo: 100000 * 100 }); // ₦100,000 capital
  // netProfit = 40000; position = 100000 + 40000 = 140000; cushion = 40000 ≥ 0
  expect(result.status).toBe("healthy");
  expect(result.cushion.amount).toBeCloseTo(40000);
  expect(result.position.amount).toBeCloseTo(140000);
  expect(result.capital.amount).toBe(100000);
  expect(result.shortfall).toBe(0);
});

// A3: amber status — loss within 10% of declared capital
// netProfit = 1000 - 9000 = -8000; threshold = 10000; amber ✓
test("A3: amber status when loss is within 10% of capital", () => {
  const ledger = {
    transactions: [
      { id: "t1", type: "in",  category: "registration_fee", amount: 1000, transaction_date: "2026-01-10" },
      { id: "t2", type: "out", category: "expense",           amount: 9000, transaction_date: "2026-01-11" },
    ],
  };
  // capital = ₦100,000; netProfit = -8000; threshold = 10,000; |cushion| = 8000 ≤ 10000
  const result = computeCapital(ledger, { amount_kobo: 100000 * 100 });
  expect(result.status).toBe("amber");
  expect(result.cushion.amount).toBeCloseTo(-8000);
  expect(result.shortfall).toBeCloseTo(8000);
});

// A4: red status — loss exceeds 10% threshold
// netProfit = 5000 - 20000 = -15000; threshold = 10000; red ✓
test("A4: red status when loss exceeds 10% of capital", () => {
  const ledger = {
    transactions: [
      { id: "t1", type: "in",  category: "registration_fee", amount:  5000, transaction_date: "2026-01-10" },
      { id: "t2", type: "out", category: "expense",           amount: 20000, transaction_date: "2026-01-11" },
    ],
  };
  // capital = ₦100,000; netProfit = -15000; threshold = 10,000; |cushion| = 15000 > 10000
  const result = computeCapital(ledger, { amount_kobo: 100000 * 100 });
  expect(result.status).toBe("red");
  expect(result.shortfall).toBeCloseTo(15000);
});

// A5: as_of_date filters transactions — only activity on or after that date counts
test("A5: as_of_date excludes transactions before the cut-off date", () => {
  const ledger = {
    transactions: [
      // Before as_of — should NOT count
      { id: "old1", type: "out", category: "expense",          amount: 99000, transaction_date: "2025-12-31" },
      // After as_of — should count (service income = always measured)
      { id: "new1", type: "in",  category: "registration_fee", amount: 5000,  transaction_date: "2026-03-01" },
    ],
  };
  // With ₦100k capital and as_of_date 2026-01-01, only the ₦5000 service income counts.
  // netProfit = 5000; status = healthy
  const result = computeCapital(ledger, {
    amount_kobo:  100000 * 100,
    as_of_date:   "2026-01-01",
  });
  expect(result.status).toBe("healthy");
  expect(result.cushion.amount).toBeCloseTo(5000);
});

// ── B tests: credit interest ──────────────────────────────────────────────────

// B1: principal-first allocation — full repayment of principal required before
//     any interest is recognized.
test("B1: interest NOT recognized until full principal repaid (principal-first)", () => {
  const credits = [{
    id: "c1", total_amount: 1000, interest_amount: 100, status: "active",
  }];
  // Payment 1: ₦600 — covers ₦600 of principal (₦400 principal remaining)
  // Payment 2: ₦400 — pays remaining ₦400 principal → principal fully repaid
  //   but no leftover amount for interest yet (₦600 + ₦400 = ₦1000 = total_amount exactly)
  const debtPayments = [
    { id: "dp1", credit_id: "c1", amount: 600, created_at: "2026-07-01T10:00:00" },
    { id: "dp2", credit_id: "c1", amount: 400, created_at: "2026-07-02T10:00:00" },
  ];
  const ledger = { credits, debtPayments };
  const r = compute(ledger, RANGE);
  // No interest recognized — both payments absorbed entirely into principal
  expect(r.profit.revenue.amount).toBe(0);
  expect(r.cash.byStream.interestEarned.amount).toBe(0);
});

// B2: interest recognized at collection after principal fully repaid
test("B2: interest recognized in-period once principal is fully recovered", () => {
  const credits = [{
    id: "c1", total_amount: 1000, interest_amount: 100, status: "active",
  }];
  // Payment 1: ₦1000 — covers full principal
  // Payment 2: ₦100  — pure interest; recognized in-period
  const debtPayments = [
    { id: "dp1", credit_id: "c1", amount: 1000, created_at: "2026-07-01T10:00:00" },
    { id: "dp2", credit_id: "c1", amount:  100, created_at: "2026-07-02T10:00:00" },
  ];
  const ledger = { credits, debtPayments };
  const r = compute(ledger, RANGE);
  expect(r.profit.revenue.amount).toBeCloseTo(100);
  expect(r.cash.byStream.interestEarned.amount).toBeCloseTo(100);
});

// B3: interest is NOT added to cash.in (repayment transaction carries it; no double-count)
test("B3: interest earned not double-counted in cash.in", () => {
  // The repayment transactions are in the transactions array — already in cash.in.
  // Interest items are profit-only; they must not inflate cash.in further.
  const credits = [{
    id: "c1", total_amount: 500, interest_amount: 50, status: "active",
  }];
  const debtPayments = [
    { id: "dp1", credit_id: "c1", amount: 500, created_at: "2026-07-01T10:00:00" },
    { id: "dp2", credit_id: "c1", amount:  50, created_at: "2026-07-02T10:00:00" },
  ];
  // Mirror repayments as actual transaction records (cash.in)
  const transactions = [
    { id: "dp1", type: "in", category: "debt repayment", amount: 500, transaction_date: "2026-07-01" },
    { id: "dp2", type: "in", category: "debt repayment", amount:  50, transaction_date: "2026-07-02" },
  ];
  const ledger = { transactions, credits, debtPayments };
  const r = compute(ledger, RANGE);
  // cash.in = ₦550 (from transactions); interest adds ₦50 to PROFIT only
  expect(r.cash.in.amount).toBeCloseTo(550);
  expect(r.profit.revenue.amount).toBeCloseTo(50);  // interest in profit
  expect(r.cash.byStream.interestEarned.amount).toBeCloseTo(50);
});

// B4: credits with null interest_amount are ignored
test("B4: credit with null interest_amount produces zero interest revenue", () => {
  const credits = [
    { id: "c1", total_amount: 1000, interest_amount: null, status: "active" },
    { id: "c2", total_amount: 500,  interest_amount: 0,    status: "active" },
  ];
  const debtPayments = [
    { id: "dp1", credit_id: "c1", amount: 1500, created_at: "2026-07-01T10:00:00" },
    { id: "dp2", credit_id: "c2", amount:  800, created_at: "2026-07-01T10:00:00" },
  ];
  const ledger = { credits, debtPayments };
  const r = compute(ledger, RANGE);
  expect(r.profit.revenue.amount).toBe(0);
  expect(r.cash.byStream.interestEarned.amount).toBe(0);
});

// B5: out-of-range interest payment is excluded even if principal already repaid
test("B5: interest payment outside range boundary excluded from period revenue", () => {
  const credits = [{
    id: "c1", total_amount: 1000, interest_amount: 200, status: "active",
  }];
  const debtPayments = [
    // Principal paid before range starts (June)
    { id: "dp1", credit_id: "c1", amount: 1000, created_at: "2026-06-15T10:00:00" },
    // Interest payment also outside range (August)
    { id: "dp2", credit_id: "c1", amount:  200, created_at: "2026-08-01T10:00:00" },
  ];
  const ledger = { credits, debtPayments };
  const r = compute(ledger, RANGE); // RANGE = July
  expect(r.profit.revenue.amount).toBe(0);
  expect(r.cash.byStream.interestEarned.amount).toBe(0);
});

// ── C tests: invoice COGS — catalog-linked line items ───────────────────────

// C1: Invoice with all catalog-costed items — full COGS deducted
// Invoice total ₦10,000; one item: Widget ×10 @ ₦1,000; cost ₦700 each.
// Full payment → measuredRev = ₦10,000; COGS = ₦7,000; grossProfit = ₦3,000.
test("C1: invoice fully from costed catalog → COGS deducted, measured revenue", () => {
  const products = [
    { id: "p1", product_name: "Widget", cost_price: 700, selling_price: 1000, needs_costing: false },
  ];
  const invoices = [{
    id: "inv1",
    status: "paid",
    total_kobo: 1000000, // ₦10,000
    invoice_items: [
      { id: "ii1", parent_item_id: null, product_id: "p1", quantity: "10", line_total_kobo: 1000000 },
    ],
    invoice_payments: [
      { id: "p1", amount_kobo: 1000000, payment_date: "2026-07-15" },
    ],
  }];
  const r = compute({ invoices, products }, RANGE);

  expect(r.profit.revenue.amount).toBeCloseTo(10000);
  expect(r.profit.cogs.amount).toBeCloseTo(7000);       // 700 × 10
  expect(r.profit.grossProfit.amount).toBeCloseTo(3000); // 10000 − 7000
  expect(r.profit.unmeasured.count).toBe(0);
  expect(r.cash.in.amount).toBeCloseTo(10000);
});

// C2: Invoice with all manual items (no product_id) → all payment unmeasured
test("C2: invoice with all manual items → payment goes to unmeasured", () => {
  const invoices = [{
    id: "inv1",
    status: "sent",
    total_kobo: 500000, // ₦5,000
    invoice_items: [
      { id: "ii1", parent_item_id: null, product_id: null, quantity: "1", line_total_kobo: 500000 },
    ],
    invoice_payments: [
      { id: "p1", amount_kobo: 500000, payment_date: "2026-07-10" },
    ],
  }];
  const r = compute({ invoices }, RANGE);

  expect(r.profit.revenue.amount).toBeCloseTo(5000);       // still revenue
  expect(r.profit.cogs.amount).toBe(0);
  expect(r.profit.grossProfit.amount).toBe(0);             // excluded from gross (unmeasured)
  expect(r.profit.unmeasured.revenue).toBeCloseTo(5000);
  expect(r.cash.in.amount).toBeCloseTo(5000);
});

// C3: Invoice mixed — 60% catalog-costed, 40% manual
// Invoice ₦10,000: Widget ×6 @ ₦1,000 (₦6,000 costed), service ₦4,000 (manual)
// Payment ₦10,000 → measured = ₦6,000, COGS = ₦4,200 (700×6), unmeasured = ₦4,000
test("C3: mixed invoice — costed items get COGS, manual items go to unmeasured", () => {
  const products = [
    { id: "p1", product_name: "Widget", cost_price: 700, selling_price: 1000, needs_costing: false },
  ];
  const invoices = [{
    id: "inv1",
    status: "paid",
    total_kobo: 1000000, // ₦10,000
    invoice_items: [
      { id: "ii1", parent_item_id: null, product_id: "p1", quantity: "6", line_total_kobo: 600000 }, // ₦6,000 costed
      { id: "ii2", parent_item_id: null, product_id: null, quantity: "1", line_total_kobo: 400000 }, // ₦4,000 manual
    ],
    invoice_payments: [
      { id: "p1", amount_kobo: 1000000, payment_date: "2026-07-15" },
    ],
  }];
  const r = compute({ invoices, products }, RANGE);

  expect(r.profit.revenue.amount).toBeCloseTo(10000);
  // Costed fraction = 6000/10000 = 0.6; measured = 10000 × 0.6 = 6000
  expect(r.profit.cogs.amount).toBeCloseTo(4200);        // 700 × 6
  expect(r.profit.grossProfit.amount).toBeCloseTo(1800); // 6000 − 4200
  expect(r.profit.unmeasured.revenue).toBeCloseTo(4000); // manual portion
  expect(r.cash.in.amount).toBeCloseTo(10000);
});

// C4: Partial payment — COGS recognized proportionally
// Invoice ₦10,000 all costed; COGS = ₦7,000. Payment = ₦5,000 (50%).
// COGS recognized = 7000 × (5000/10000) = ₦3,500; measuredRev = ₦5,000.
test("C4: partial payment recognizes proportional COGS", () => {
  const products = [
    { id: "p1", product_name: "Widget", cost_price: 700, selling_price: 1000, needs_costing: false },
  ];
  const invoices = [{
    id: "inv1",
    status: "partially_paid",
    total_kobo: 1000000,
    invoice_items: [
      { id: "ii1", parent_item_id: null, product_id: "p1", quantity: "10", line_total_kobo: 1000000 },
    ],
    invoice_payments: [
      { id: "p1", amount_kobo: 500000, payment_date: "2026-07-15" }, // 50%
    ],
  }];
  const r = compute({ invoices, products }, RANGE);

  expect(r.profit.revenue.amount).toBeCloseTo(5000);
  expect(r.profit.cogs.amount).toBeCloseTo(3500);        // 7000 × 0.5
  expect(r.profit.grossProfit.amount).toBeCloseTo(1500); // 5000 − 3500
  expect(r.profit.unmeasured.count).toBe(0);
});

// C5: Invoice with uncosted catalog item (needs_costing=true) → unmeasured
test("C5: catalog item with needs_costing=true goes to unmeasured", () => {
  const products = [
    { id: "p1", product_name: "Mystery", cost_price: null, selling_price: 500, needs_costing: true },
  ];
  const invoices = [{
    id: "inv1",
    status: "paid",
    total_kobo: 500000,
    invoice_items: [
      { id: "ii1", parent_item_id: null, product_id: "p1", quantity: "1", line_total_kobo: 500000 },
    ],
    invoice_payments: [
      { id: "p1", amount_kobo: 500000, payment_date: "2026-07-10" },
    ],
  }];
  const r = compute({ invoices, products }, RANGE);

  expect(r.profit.revenue.amount).toBeCloseTo(5000);
  expect(r.profit.cogs.amount).toBe(0);
  expect(r.profit.unmeasured.revenue).toBeCloseTo(5000);
});

// C6: Manual invoice item with cost_price_kobo → costed, not unmeasured
// Invoice ₦8,000: "Web Design" ₦5,000 (cost ₦2,000), "Domain" ₦3,000 (no cost).
// Payment ₦8,000 → costedFrac = 5/8; measured = ₦5,000; COGS = ₦2,000; unmeas = ₦3,000.
test("C6: manual item with cost_price_kobo is measured; item without goes to unmeasured", () => {
  const invoices = [{
    id: "inv1",
    status: "paid",
    total_kobo: 800000,
    invoice_items: [
      { id: "ii1", parent_item_id: null, product_id: null, quantity: "1", line_total_kobo: 500000, cost_price_kobo: 200000 },
      { id: "ii2", parent_item_id: null, product_id: null, quantity: "1", line_total_kobo: 300000, cost_price_kobo: null },
    ],
    invoice_payments: [
      { id: "p1", amount_kobo: 800000, payment_date: "2026-07-15" },
    ],
  }];
  const r = compute({ invoices }, RANGE);

  expect(r.profit.revenue.amount).toBeCloseTo(8000);
  expect(r.profit.cogs.amount).toBeCloseTo(2000);         // cost ₦2,000 × 1 qty
  expect(r.profit.grossProfit.amount).toBeCloseTo(3000);  // ₦5,000 − ₦2,000
  expect(r.profit.unmeasured.revenue).toBeCloseTo(3000);  // domain portion
  expect(r.cash.in.amount).toBeCloseTo(8000);
});

test("C7: failed bill transactions excluded from cash-out and byStream.billPayments", () => {
  const transactions = [
    { id: "t1", type: "out", amount: 1000, bill_status: "failed",  payment_type: "bill_payment", category: "expense", transaction_date: "2026-07-10" },
    { id: "t2", type: "out", amount: 2000, bill_status: "success", payment_type: "bill_payment", category: "expense", transaction_date: "2026-07-10" },
  ];
  const r = compute({ transactions }, RANGE);

  // Only the successful bill should appear in cash out
  expect(r.cash.out.amount).toBeCloseTo(2000);
  // byStream.billPayments excludes the failed one
  expect(r.cash.byStream.billPayments.amount).toBeCloseTo(2000);
  // P&L is unaffected (bills are never in revenue/expenses)
  expect(r.profit.expenses.amount).toBeCloseTo(0);
});

// ── countUnnamedSales helper ─────────────────────────────────────────────────
test("countUnnamedSales counts only blank item_name revenue transactions", () => {
  const txs = [
    { id: "a", type: "in",  category: "sale",          item_name: "",      transaction_date: "2026-07-10" },
    { id: "b", type: "in",  category: "credit sale",   item_name: null,    transaction_date: "2026-07-10" },
    { id: "c", type: "in",  category: "sale",          item_name: "Rice",  transaction_date: "2026-07-10" },
    { id: "d", type: "in",  category: "debt repayment", item_name: "",     transaction_date: "2026-07-10" },
    { id: "e", type: "out", category: "expense",        item_name: "",     transaction_date: "2026-07-10" },
  ];
  expect(countUnnamedSales(txs, RANGE.from, RANGE.to)).toBe(2); // a + b only
});
