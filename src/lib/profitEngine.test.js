import { compute, countUnnamedSales } from "./profitEngine";

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
