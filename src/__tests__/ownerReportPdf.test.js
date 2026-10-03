/* global globalThis */
// Owner reports (2026-10-02): profit per sale (profitEngine.saleCost via Reports.buildSalesProfit), profit on the credit,
// Ajo, bills and stock reports, the receipt-style letterhead + verify footer of the report PDF, and the verify page's
// report view.
import "../testUtils/textEncoder";   // first: jsPDF needs TextEncoder when it loads
/* eslint-disable import/first */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { saleCost, productMaps, compute } from "../lib/profitEngine";
import {
  buildSalesProfit, creditProfit, buildCreditData, buildAsoLedger, billProfit, buildBillsData, buildStockData,
  buildGeneralData, reportSummary, buildNativeReportPDF,
} from "../screens/Reports";
import { createReportPdf } from "../utils/generateReportPdf";
import { buildSalesReportCSV, buildCreditReportCSV, buildAsoReportCSV, buildBillsReportCSV, buildStockReportCSV, buildGeneralReportCSV } from "../utils/exportCSV";
import VerifyReceipt from "../screens/VerifyReceipt";
/* eslint-enable import/first */

let mockRpc;
jest.mock("../utils/supabase", () => ({ supabase: { rpc: (fn, args) => mockRpc(fn, args), from: () => ({}) } }));
jest.mock("../components/BarcodeScanner", () => () => null);
jest.mock("react-router-dom", () => ({ useNavigate: () => () => {} }), { virtual: true });   // ESM-only v7; mocked like the other screen tests
jest.mock("../hooks/useCampaigns", () => ({ useCampaigns: () => ({ slotMap: {}, loading: false, recordEvent: () => {} }) }));
// a tiny real PNG so the QR image goes into the PDF (jsdom has no canvas for the qrcode library)
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let mockSavedDoc = null;
jest.mock("../utils/pdfSave", () => ({ savePdf: async (doc) => { mockSavedDoc = doc; } }));

const products = [
  { id: "p-rice", product_name: "Rice 5kg", cost_price: 6000, needs_costing: false },
  { id: "p-oil",  product_name: "Oil 1L",   cost_price: 1500, needs_costing: false },
];
const sale = (o) => ({ id: o.id, type: "in", category: "sale", transaction_date: "2026-10-02", amount: o.amount, ...o });
// jsPDF writes text as "(...) Tj" — pull the strings out of the uncompressed PDF. Text with a character outside Latin-1
// (every amount: "₦") is written as UTF-16 byte pairs, so decode those.
const utf16 = (s) => {
  if (!s.includes("\u0000")) return s;
  const b = s.replace(/\\(.)/g, "$1");
  let out = "";
  for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode(b.charCodeAt(i) * 256 + b.charCodeAt(i + 1));
  return out;
};
const tjTexts = (src) => src.match(/\((?:[^()\\]|\\.)*\)\s*Tj/g)?.map((m) => utf16(m.replace(/\)\s*Tj$/, "").slice(1))) || [];
const texts = (doc) => tjTexts(doc.output());
/** The text drawn on one page (1-based). */
const pageTexts = (doc, n) => tjTexts(doc.internal.pages[n].join("\n"));

describe("profit per sale", () => {
  const maps = productMaps(products);
  it("the cost price saved at the sale wins over the product's current cost", () => {
    const c = saleCost(sale({ id: "a", item_name: "Rice 5kg", amount: 8000, quantity: 1, cost_price: 5000 }), maps);
    expect(c.measured - c.cogs).toBe(3000);   // saved cost 5,000 — not today's 6,000
  });
  it("cart sale: each line's saved cost", () => {
    const c = saleCost(sale({ id: "b", amount: 11000, line_items: [
      { name: "Rice 5kg", qty: 1, lineTotal: 8000, costPrice: 5500 }, { name: "Oil 1L", qty: 2, lineTotal: 3000, costPrice: 1200 },
    ] }), maps);
    expect(c.measured).toBe(11000);
    expect(c.cogs).toBe(5500 + 2400);
  });
  it("old sale with no saved cost falls back to the product's cost", () => {
    const c = saleCost(sale({ id: "c", item_name: "Oil 1L", amount: 2000, quantity: 1 }), maps);
    expect(c.measured - c.cogs).toBe(500);
  });
  it("buildSalesProfit: profit per sale, null when there is no cost price, totals = the app's gross profit", () => {
    const tx = [
      sale({ id: "a", item_name: "Rice 5kg", amount: 8000, quantity: 1, cost_price: 5000 }),
      sale({ id: "d", item_name: "Mystery item", amount: 1000 }),
      sale({ id: "e", amount: 4000, line_items: [{ name: "Oil 1L", qty: 1, lineTotal: 2000, costPrice: 1500 }, { name: "Gift wrap", qty: 1, lineTotal: 2000 }] }),
      { id: "x", type: "out", category: "expense", amount: 700, transaction_date: "2026-10-02" },
      { id: "y", type: "out", category: "airtime", payment_type: "bill_payment", amount: 500, transaction_date: "2026-10-02" },
    ];
    const { rows, totals } = buildSalesProfit(tx, products);
    expect(rows.map((r) => r.t.id)).toEqual(["a", "d", "e"]);            // only sales — no expenses or bills
    expect(rows.find((r) => r.t.id === "a").profit).toBe(3000);
    expect(rows.find((r) => r.t.id === "d").profit).toBeNull();           // no cost price: not guessed
    const e = rows.find((r) => r.t.id === "e");
    expect(e.profit).toBe(500); expect(e.partial).toBe(true);
    expect(e.item).toBe("Oil 1L, Gift wrap");
    expect(totals).toEqual({ count: 3, revenue: 13000, cost: 6500, profit: 3500, uncosted: 3000 });
    const engine = compute({ transactions: tx, products }, { from: new Date("2026-10-01T00:00:00"), to: new Date("2026-10-31T23:59:59") });
    expect(totals.profit).toBe(engine.profit.grossProfit.amount);
  });
});

describe("profit on the credit report", () => {
  it("goods profit from each item's cost saved with the credit, plus the interest", () => {
    const p = creditProfit({ total_amount: 14000, interest_amount: 1000, items: [
      { product_name: "Rice 5kg", quantity: 1, unit_price: 8000, cost_price: 6000 },
      { product_name: "Oil 1L",   quantity: 4, unit_price: 1500, cost_price: 1200 },
    ] });
    expect(p).toMatchObject({ cost: 10800, goodsProfit: 3200, interest: 1000, profit: 4200, uncosted: 0, partial: false });
  });
  it("credit with no items: interest only, the principal flagged as uncosted", () => {
    expect(creditProfit({ total_amount: 5000, interest_amount: 500, items: null })).toMatchObject({ cost: null, goodsProfit: null, profit: 500, uncosted: 5000, partial: true });
  });
  it("no items and no interest: no profit figure rather than a guessed zero", () => {
    expect(creditProfit({ total_amount: 5000, interest_amount: null, items: [] }).profit).toBeNull();
  });
  it("extra credit added later (no items) is flagged, the items' profit still counts", () => {
    const p = creditProfit({ total_amount: 12000, interest_amount: 0, items: [{ quantity: 1, unit_price: 8000, cost_price: 6000 }] });
    expect(p).toMatchObject({ profit: 2000, uncosted: 4000, partial: true });
  });
  it("totals across accounts", () => {
    const d = buildCreditData([
      { customer_name: "A", total_amount: 8000, interest_amount: 0, outstanding: 8000, amount_paid: 0, status: "active", items: [{ quantity: 1, unit_price: 8000, cost_price: 6000 }] },
      { customer_name: "B", total_amount: 3000, interest_amount: 300, outstanding: 0, amount_paid: 3300, status: "paid", items: [] },
    ]);
    expect(d.profitTotals).toEqual({ cost: 6000, interest: 300, goods: 2000, profit: 2300, uncosted: 3000 });
  });
});

describe("profit on the Ajo report", () => {
  it("fees + commission per client, only once taken; savings are not profit", () => {
    const clients = [{ id: "c1", full_name: "Ngozi", current_balance: 20000, status: "active", contribution_amount: 1000, contribution_frequency: "daily" }];
    const rows = [
      { aso_client_id: "c1", type: "contribution",     amount: 20000, status: "completed", created_at: "2026-10-01T09:00:00Z" },
      { aso_client_id: "c1", type: "registration_fee", amount: 1000,  status: "completed", created_at: "2026-10-01T09:00:00Z" },
      { aso_client_id: "c1", type: "commission",       amount: 1000,  status: "completed", created_at: "2026-10-01T09:00:00Z" },
      { aso_client_id: "c1", type: "withdrawal_fee",   amount: 200,   created_at: "2026-10-02T09:00:00Z" },          // older rows: no status
      { aso_client_id: "c1", type: "withdrawal_fee",   amount: 200,   status: "pending", created_at: "2026-10-02T09:00:00Z" },
      { aso_client_id: "c1", type: "commission",       amount: 999,   status: "completed", created_at: "2026-09-01T09:00:00Z" },   // outside the period
    ];
    const d = buildAsoLedger(clients, rows, "2026-10-01", "2026-10-31");
    expect(d.totRegFees).toBe(1000);
    expect(d.totWdFees).toBe(200);
    expect(d.totCommission).toBe(1000);
    expect(d.totProfit).toBe(2200);
    expect(d.enriched.find((c) => c.id === "c1").p_profit).toBe(2200);
  });
});

describe("profit on the bills report", () => {
  const bill = (o) => ({ payment_type: "bill_payment", type: "out", transaction_date: "2026-10-02", ...o });
  it("printed airtime PINs: discount below face value (no cashback on print)", () => {
    expect(billProfit(bill({ category: "print-airtime", amount: 9700, note: "Network: MTN | Value: ₦100 x100 | Ref X" })))
      .toMatchObject({ face: 10000, discount: 300, cashback: 0, profit: 300 });
  });
  it("all-network bundle: face value saved on the order", () => {
    expect(billProfit(bill({ category: "airtime-bundle", amount: 4850, note: "Face value: ₦5,000 | 5 numbers" })))
      .toMatchObject({ face: 5000, discount: 150, profit: 150 });
  });
  it("airtime and data: 1% cashback", () => {
    expect(billProfit(bill({ category: "airtime", amount: 1000 })).profit).toBe(10);
    expect(billProfit(bill({ category: "data", amount: 2500 })).profit).toBe(25);
  });
  it("cable, electricity…: a cost with no profit; failed bills were refunded and don't count", () => {
    expect(billProfit(bill({ category: "cable", amount: 9000 })).profit).toBe(0);
    const d = buildBillsData([
      bill({ id: 1, category: "airtime", amount: 1000 }),
      bill({ id: 2, category: "print-airtime", amount: 9700, note: "Value: ₦100 x100" }),
      bill({ id: 3, category: "electricity", amount: 5000, bill_status: "failed" }),
    ], "2026-10-01", "2026-10-31");
    expect(d.total).toBe(10700);
    expect(d.paid.length).toBe(2);
    expect(d.failedCount).toBe(1);
    expect(d.profitTotals).toMatchObject({ discount: 300, cashback: 10, profit: 310 });
  });
});

describe("profit on the stock report", () => {
  it("per item: revenue, cost saved at the sale, profit, margin; cart sales split; restock = stock purchases only", () => {
    const tx = [
      sale({ id: "a", item_name: "Rice 5kg", amount: 8000, quantity: 1, cost_price: 5000 }),
      sale({ id: "b", amount: 11000, line_items: [
        { name: "Rice 5kg", qty: 1, lineTotal: 8000, costPrice: 5500 }, { name: "Oil 1L", qty: 2, lineTotal: 3000, costPrice: 1200 },
      ] }),
      sale({ id: "c", item_name: "Mystery item", amount: 1000 }),
      { id: "r", type: "out", category: "stock", item_name: "Rice 5kg", quantity: 10, amount: 55000, transaction_date: "2026-10-02" },
      { id: "x", type: "out", category: "expense", item_name: "Rice 5kg", amount: 700, transaction_date: "2026-10-02" },   // not stock
    ];
    const d = buildStockData(tx, "2026-10-01", "2026-10-31", products);
    const rice = d.rows.find((r) => r.item === "Rice 5kg");
    expect(rice).toMatchObject({ qtySold: 2, revenue: 16000, cogs: 10500, profit: 5500, qtyBought: 10, cost: 55000 });
    expect(rice.margin).toBeCloseTo(5500 / 16000);
    expect(d.rows.find((r) => r.item === "Oil 1L")).toMatchObject({ qtySold: 2, revenue: 3000, cogs: 2400, profit: 600 });
    expect(d.rows.find((r) => r.item === "Mystery item").profit).toBeNull();
    expect(d.totals).toMatchObject({ cogs: 12900, profit: 6100, uncosted: 1000, stockSpend: 55000 });
    // the stock report's profit agrees with the sales report's
    expect(d.totals.profit).toBe(buildSalesProfit(tx.filter((t) => t.type === "in"), products).totals.profit);
  });
});

describe("every owner report PDF carries its profit", () => {
  const profile = { id: "u1", business_name: "Adaeze Fresh Mart" };
  const cases = {
    credit: () => buildCreditData([{ customer_name: "Ngozi", total_amount: 8000, interest_amount: 500, outstanding: 8500, amount_paid: 0, status: "active", due_date: "2026-10-30", items: [{ quantity: 1, unit_price: 8000, cost_price: 6000 }] }]),
    aso: () => buildAsoLedger([{ id: "c1", full_name: "Ngozi", current_balance: 0, status: "active" }],
      [{ aso_client_id: "c1", type: "commission", amount: 1000, status: "completed", created_at: "2026-10-01T09:00:00Z" }], "2026-10-01", "2026-10-31"),
    bills: () => buildBillsData([{ payment_type: "bill_payment", category: "print-airtime", item_name: "MTN PINs", amount: 9700, note: "Value: ₦100 x100", transaction_date: "2026-10-02" }], "2026-10-01", "2026-10-31"),
    stock: () => buildStockData([sale({ id: "a", item_name: "Rice 5kg", amount: 8000, quantity: 1, cost_price: 5000 })], "2026-10-01", "2026-10-31", products),
  };
  const expected = { credit: ["Total profit on credit", "2,500"], aso: ["Total Ajo profit", "1,000"], bills: ["Total profit on bills", "300"], stock: ["Total profit on stock", "3,000"] };
  Object.keys(cases).forEach((type) => {
    it(`${type}: profit in the PDF and in the verified figures`, async () => {
      const data = cases[type]();
      mockSavedDoc = null;
      await buildNativeReportPDF(type, data, profile, "2026-10-01", "2026-10-31");
      expect(mockSavedDoc).not.toBeNull();
      const t = texts(mockSavedDoc);
      const [label, amount] = expected[type];
      expect(t.some((x) => x.includes(label))).toBe(true);
      expect(t.some((x) => x.includes(amount))).toBe(true);
      const summary = reportSummary(type, data);
      expect(summary.length).toBeLessThanOrEqual(8);
      expect(summary.some((r) => /profit/i.test(r.label) && r.value.includes(amount))).toBe(true);
    });
  });
});

describe("CSV exports carry the profit too", () => {
  const lines = (csv) => csv.replace(/^\uFEFF/, "").split("\r\n");
  const col = (csv, name) => {
    const ls = lines(csv); const h = ls.findIndex((l) => l.split(",").includes(name));
    const i = ls[h].split(",").indexOf(name);
    return ls.slice(h + 1).filter(Boolean).map((l) => l.split(",")[i]);
  };
  it("sales: Net Cash (not 'Net Profit'), profit on sales, profit per sale", () => {
    const tx = [sale({ id: "a", item_name: "Rice 5kg", amount: 8000, quantity: 1, cost_price: 5000 }),
                { id: "x", type: "out", category: "expense", amount: 700, transaction_date: "2026-10-02" }];
    const p = buildSalesProfit(tx, products);
    const csv = buildSalesReportCSV({ tx, cashIn: 8000, cashOut: 700, profit: 7300, sales: p.rows, salesTotals: p.totals }, "2026-10-01", "2026-10-31");
    expect(csv).toContain("Net Cash");
    expect(csv).not.toContain("Net Profit");
    expect(csv).toMatch(/Profit on Sales[^\r]*,3000/);
    expect(col(csv, "profit_ngn")).toEqual(["3000", ""]);
  });
  it("credit, Ajo, bills, stock", () => {
    const credit = buildCreditData([{ customer_name: "Ngozi", total_amount: 8000, interest_amount: 500, outstanding: 8500, amount_paid: 0, items: [{ quantity: 1, unit_price: 8000, cost_price: 6000 }] }]);
    expect(col(buildCreditReportCSV(credit), "profit_ngn")).toEqual(["2500"]);
    const aso = buildAsoLedger([{ id: "c1", full_name: "Ngozi", current_balance: 0, status: "active" }],
      [{ aso_client_id: "c1", type: "commission", amount: 1000, status: "completed", created_at: "2026-10-01T09:00:00Z" }], "2026-10-01", "2026-10-31");
    expect(col(buildAsoReportCSV(aso), "period_profit_ngn")).toEqual(["1000"]);
    const bills = buildBillsData([
      { payment_type: "bill_payment", category: "print-airtime", amount: 9700, note: "Value: 100 x100", transaction_date: "2026-10-02" },
      { payment_type: "bill_payment", category: "cable", amount: 9000, bill_status: "failed", transaction_date: "2026-10-02" },
    ], "2026-10-01", "2026-10-31");
    const bcsv = buildBillsReportCSV(bills);
    expect(col(bcsv, "profit_ngn")).toEqual(["300", ""]);
    expect(col(bcsv, "date")).toEqual(["2026-10-02", "2026-10-02"]);   // the transaction's own fields still come through
    const stock = buildStockData([sale({ id: "a", item_name: "Rice 5kg", amount: 8000, quantity: 1, cost_price: 5000 })], "2026-10-01", "2026-10-31", products);
    expect(col(buildStockReportCSV(stock), "profit_ngn")).toEqual(["3000"]);
  });
});

describe("general business report", () => {
  // one month of a small shop: a cash sale, a credit sale later repaid with interest, an Ajo commission, a printed-PIN
  // bill (+ a failed one), an expense and a stock purchase
  const src = () => ({
    transactions: [
      sale({ id: "s1", item_name: "Rice 5kg", amount: 8000, quantity: 1, cost_price: 5000 }),
      sale({ id: "s2", category: "credit sale", item_name: "Oil 1L", amount: 3000, quantity: 2, cost_price: 1200, staff_id: "st1" }),
      { id: "r1", type: "in", category: "debt repayment", amount: 3500, transaction_date: "2026-10-03" },
      { id: "e1", type: "out", category: "expense", item_name: "Transport", amount: 700, transaction_date: "2026-10-03" },
      { id: "k1", type: "out", category: "stock", item_name: "Rice 5kg", quantity: 4, amount: 20000, transaction_date: "2026-10-03" },
      { id: "b1", type: "out", payment_type: "bill_payment", category: "print-airtime", item_name: "MTN PINs", amount: 9700, note: "Value: ₦100 x100", transaction_date: "2026-10-04" },
      { id: "b2", type: "out", payment_type: "bill_payment", category: "electricity", amount: 5000, bill_status: "failed", transaction_date: "2026-10-04" },
    ],
    credits: [{ id: "cr1", customer_name: "Ngozi", total_amount: 3000, interest_amount: 500, outstanding: 0, amount_paid: 3500, status: "paid",
                items: [{ quantity: 2, unit_price: 1500, cost_price: 1200 }] }],
    debtPayments: [{ id: "dp1", credit_id: "cr1", amount: 3500, created_at: "2026-10-03T10:00:00" }],
    asoClients: [{ id: "c1", full_name: "Kemi", current_balance: 20000, status: "active" }],
    contributions: [
      { id: "a1", aso_client_id: "c1", type: "contribution", amount: 20000, status: "completed", created_at: "2026-10-02T09:00:00" },
      { id: "a2", aso_client_id: "c1", type: "commission",   amount: 1000,  status: "completed", created_at: "2026-10-02T09:00:00" },
      { id: "a3", aso_client_id: "c1", type: "withdrawal_fee", amount: 200, status: "pending",   created_at: "2026-10-02T09:00:00" },
    ],
    products: [{ id: "p-rice", product_name: "Rice 5kg", cost_price: 5000, quantity: 3, low_stock_threshold: 5, needs_costing: false },
               { id: "p-oil", product_name: "Oil 1L", cost_price: 1200, quantity: 40, low_stock_threshold: 5, needs_costing: false }],
    staffMap: { st1: "Tunde" },
  });

  it("profit from every source, each counted once, and matching the Finance screen plus bills", () => {
    const d = buildGeneralData(src(), "2026-10-01", "2026-10-31");
    expect(d.profit.goods).toBe(3000 + 600);            // cash sale + credit sale — the credit's goods aren't counted again
    expect(d.profit.interest).toBe(500);                 // collected with the repayment
    expect(d.profit.ajo).toBe(1000);                     // commission taken; the pending fee isn't profit yet; savings never are
    expect(d.profit.bills).toBe(300);                    // PIN discount; the failed bill was refunded
    expect(d.profit.gross).toBe(5400);
    expect(d.profit.expenses).toBe(700);                 // stock purchase and bills are not expenses
    expect(d.profit.net).toBe(4700);
    expect(d.profit.financeNet).toBe(4400);              // the Finance screen: same, without what bills earned
    expect(d.money.stock).toBe(20000);
    expect(d.money.repayments).toBe(3500);
    expect(d.salesSummary).toMatchObject({ count: 2, total: 11000, qty: 3 });
    expect(d.stockOnHand).toBe(3 * 5000 + 40 * 1200);
    expect(d.lowStock).toBe(1);
    expect(d.ajo).toMatchObject({ held: 20000, collections: 20000, clients: 1 });
    expect(d.bills).toMatchObject({ total: 9700, count: 1, profit: 300, failedCount: 1 });
    expect(d.staff).toEqual([{ name: "Tunde", count: 1, amount: 3000 }]);
    expect(d.topItems.map((r) => r.item)).toEqual(["Rice 5kg", "Oil 1L"]);
  });

  it("PDF, verified figures and CSV", async () => {
    const d = buildGeneralData(src(), "2026-10-01", "2026-10-31");
    mockSavedDoc = null;
    await buildNativeReportPDF("general", d, { id: "u1", business_name: "Adaeze Fresh Mart" }, "2026-10-01", "2026-10-31");
    const t = texts(mockSavedDoc);
    for (const label of ["BUSINESS REPORT", "Where the profit came from", "Net profit", "Money in & out", "Credit", "Ajo savings", "Bills", "Stock", "Staff sales"]) {
      expect(t.some((x) => x.toUpperCase().includes(label.toUpperCase()))).toBe(true);
    }
    expect(t.some((x) => x.includes("4,700"))).toBe(true);
    const summary = reportSummary("general", d);
    expect(summary).toHaveLength(8);
    expect(summary.find((r) => r.label === "Net profit").value).toContain("4,700");
    const csv = buildGeneralReportCSV(d);
    expect(csv).toMatch(/Profit,Net profit \(₦\),4700/);
    expect(csv).toMatch(/Profit,Gross profit \(₦\),5400/);
  });

  it("an empty business still produces a report of zeroes", () => {
    const d = buildGeneralData({}, "2026-10-01", "2026-10-31");
    expect(d.profit).toMatchObject({ goods: 0, ajo: 0, interest: 0, bills: 0, gross: 0, expenses: 0, net: 0 });
    expect(reportSummary("general", d)).toHaveLength(8);
  });
});

describe("report PDF letterhead + verify footer", () => {

  it("business details in the header; KudiAI + Amaya + verify link + QR in the footer of the last page", async () => {
    const pdf = await createReportPdf({
      title: "Sales Report", businessName: "Adaeze Fresh Mart", period: "1 Oct 2026 – 31 Oct 2026",
      letterhead: { businessName: "Adaeze Fresh Mart", address: "12 Market Road, Ikeja, Lagos", phone: "08031234567", email: "adaeze@demo.ng", generatedAt: new Date("2026-10-02T14:04:00Z") },
      verifyRef: "KDR-202610-ABCDEFGH",
    });
    pdf.addSectionTitle("Sales & Profit");
    pdf.addTable([{ key: "a", label: "A", w: 1 }], Array.from({ length: 70 }, (_, i) => ({ a: `row ${i}` })));   // forces a 2nd page
    const doc = pdf.getDoc();
    const t = texts(doc);
    const has = (s) => t.some((x) => x.includes(s));
    expect(has("Adaeze Fresh Mart")).toBe(true);
    expect(has("12 Market Road, Ikeja, Lagos")).toBe(true);
    expect(has("08031234567")).toBe(true);
    expect(has("adaeze@demo.ng")).toBe(true);
    expect(has("SALES REPORT")).toBe(true);
    expect(has("Generated 2 Oct 2026")).toBe(true);
    const pages = doc.internal.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    expect(t.filter((x) => x.includes("Generated by KudiAI Track")).length).toBe(1);
    expect(t.filter((x) => x.includes("A product of Amaya & Co. Technologies")).length).toBe(1);
    expect(t.filter((x) => x === "KDR-202610-ABCDEFGH").length).toBe(2);                   // the letterhead + the footer
    expect(doc.output()).toContain("https://kudiai.app/verify?ref=KDR-202610-ABCDEFGH");   // the clickable link
    expect(t.filter((x) => x === "Scan to verify").length).toBe(1);                        // the QR is there
    // the footer is on the last page; the others carry just their page number
    expect(pageTexts(doc, pages)).toEqual(expect.arrayContaining(["Generated by KudiAI Track", "Scan to verify", `Page ${pages} of ${pages}`]));
    for (let p = 1; p < pages; p++) {
      const pt = pageTexts(doc, p);
      expect(pt).toContain(`Page ${p} of ${pages}`);
      expect(pt.some((x) => /Generated by|Verify this report|Scan to verify/.test(x))).toBe(false);
    }
  });

  it("a full last page: the footer moves to a page of its own, never over the rows", async () => {
    let sawOwnPage = false;
    for (let n = 20; n <= 75; n++) {
      const pdf = await createReportPdf({ title: "Sales Report", businessName: "Shop", letterhead: { businessName: "Shop" }, verifyRef: "KDR-202610-ABCDEFGH" });
      pdf.addSectionTitle("Sales");
      pdf.addTable([{ key: "a", label: "A", w: 1 }], Array.from({ length: n }, (_, i) => ({ a: `row ${i}` })));
      const doc = pdf.getDoc();
      const pages = doc.internal.getNumberOfPages();
      const last = pageTexts(doc, pages);
      expect([n, texts(doc).filter((x) => x === "Generated by KudiAI Track").length]).toEqual([n, 1]);
      expect([n, last.includes("Generated by KudiAI Track")]).toEqual([n, true]);
      if (last.some((x) => x.startsWith("End of report."))) {
        sawOwnPage = true;
        expect(last.some((x) => x.startsWith("row "))).toBe(false);
        expect(pageTexts(doc, pages - 1)).toContain(`row ${n - 1}`);
      }
    }
    expect(sawOwnPage).toBe(true);
  });

  it("without a reference (offline) the report still has the business header and KudiAI footer, just no verify block", async () => {
    const pdf = await createReportPdf({ title: "Stock Report", businessName: "Shop", period: "Oct", letterhead: { businessName: "Shop" } });
    const t = texts(pdf.getDoc());
    expect(t.some((x) => x.includes("Generated by KudiAI Track"))).toBe(true);
    expect(t.some((x) => x.includes("Verify this report"))).toBe(false);
  });

  it("other statements keep the original look when they don't ask for the letterhead", async () => {
    const pdf = await createReportPdf({ title: "Statement", businessName: "Shop" });
    const t = texts(pdf.getDoc());
    expect(t.some((x) => x.includes("Generated by KudiAI Track"))).toBe(false);
    expect(t.some((x) => x.startsWith("KudiAI Track  ·  Generated"))).toBe(true);
  });

  it("their footer is on the last page too, and never needs a page of its own", async () => {
    for (const n of [10, 60, 140]) {
      const pdf = await createReportPdf({ title: "Statement", businessName: "Shop" });
      pdf.addTable([{ key: "a", label: "A", w: 1 }], Array.from({ length: n }, (_, i) => ({ a: `row ${i}` })));
      const doc = pdf.getDoc();
      const pages = doc.internal.getNumberOfPages();
      expect(texts(doc).filter((x) => x.startsWith("KudiAI Track  ·  Generated")).length).toBe(1);
      expect(pageTexts(doc, pages).some((x) => x.startsWith("KudiAI Track  ·  Generated"))).toBe(true);
      expect(pageTexts(doc, pages)).toContain(`row ${n - 1}`);
      for (let p = 1; p < pages; p++) expect(pageTexts(doc, p)).toContain(`Page ${p} of ${pages}`);
    }
  });
});

describe("verify page — a report reference", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let host, root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); window.history.replaceState(null, "", "/"); });
  const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

  it("shows what the report is, for whom, which period, and its figures", async () => {
    mockRpc = jest.fn(async () => ({ data: {
      found: true, is_report: true, kind: "Sales report", status: "successful", business: "Adaeze Fresh Mart", account_business: "Adaeze Fresh Mart",
      period_from: "2026-10-01", period_to: "2026-10-31", occurred_at: "2026-10-02T14:04:00Z",
      summary: [{ label: "Total sales", value: "₦172,100.00" }, { label: "Profit on sales", value: "₦3,300.00" }],
    }, error: null }));
    window.history.replaceState(null, "", "/verify?ref=kdr-202610-abcdefgh");
    await act(async () => { root.render(<VerifyReceipt />); });
    await flush();
    expect(mockRpc).toHaveBeenCalledWith("verify_receipt", { p_ref: "KDR-202610-ABCDEFGH" });
    const text = host.textContent;
    expect(text).toContain("Report verified");
    expect(text).toContain("Sales report");
    expect(text).toContain("Adaeze Fresh Mart");
    expect(text).toContain("1 Oct 2026 – 31 Oct 2026");
    expect(text).toContain("Profit on sales");
    expect(text).toContain("₦3,300.00");
    expect(text).not.toContain("Transaction type");   // not the receipt layout
  });

  it("an unknown report says 'No report found'", async () => {
    mockRpc = jest.fn(async () => ({ data: { found: false }, error: null }));
    window.history.replaceState(null, "", "/verify?ref=KDR-202610-ZZZZZZZZ");
    await act(async () => { root.render(<VerifyReceipt />); });
    await flush();
    expect(host.textContent).toContain("No report found");
  });
});

void PNG_1PX;
