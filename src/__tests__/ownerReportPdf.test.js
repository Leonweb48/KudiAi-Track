// Owner reports (2026-10-02): profit per sale (profitEngine.saleCost via Reports.buildSalesProfit), the receipt-style
// letterhead + verify footer of the report PDF, and the verify page's report view.
import { TextEncoder, TextDecoder } from "util";
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
/* eslint-disable import/first */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { saleCost, productMaps, compute } from "../lib/profitEngine";
import { buildSalesProfit } from "../screens/Reports";
import { createReportPdf } from "../utils/generateReportPdf";
import VerifyReceipt from "../screens/VerifyReceipt";
/* eslint-enable import/first */

let mockRpc;
jest.mock("../utils/supabase", () => ({ supabase: { rpc: (fn, args) => mockRpc(fn, args), from: () => ({}) } }));
jest.mock("../components/BarcodeScanner", () => () => null);
jest.mock("react-router-dom", () => ({ useNavigate: () => () => {} }), { virtual: true });   // ESM-only v7; mocked like the other screen tests
jest.mock("../hooks/useCampaigns", () => ({ useCampaigns: () => ({ slotMap: {}, loading: false, recordEvent: () => {} }) }));
// a tiny real PNG so the QR image goes into the PDF (jsdom has no canvas for the qrcode library)
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
jest.mock("qrcode", () => ({ toDataURL: async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }));
jest.mock("../utils/pdfSave", () => ({ savePdf: async () => {} }));

const products = [
  { id: "p-rice", product_name: "Rice 5kg", cost_price: 6000, needs_costing: false },
  { id: "p-oil",  product_name: "Oil 1L",   cost_price: 1500, needs_costing: false },
];
const sale = (o) => ({ id: o.id, type: "in", category: "sale", transaction_date: "2026-10-02", amount: o.amount, ...o });

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

describe("report PDF letterhead + verify footer", () => {
  // jsPDF writes text as "(...) Tj" — pull the strings out of the uncompressed PDF
  const texts = (doc) => doc.output().match(/\((?:[^()\\]|\\.)*\)\s*Tj/g)?.map((m) => m.replace(/\)\s*Tj$/, "").slice(1)) || [];

  it("business details in the header, KudiAI + Amaya + verify link + QR in the footer of every page", async () => {
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
    expect(doc.internal.getNumberOfPages()).toBeGreaterThan(1);
    expect(t.filter((x) => x.includes("Generated by KudiAI Track")).length).toBe(doc.internal.getNumberOfPages());
    expect(t.filter((x) => x.includes("A product of Amaya & Co. Technologies")).length).toBe(doc.internal.getNumberOfPages());
    expect(t.filter((x) => x === "KDR-202610-ABCDEFGH").length).toBeGreaterThanOrEqual(doc.internal.getNumberOfPages());
    expect(doc.output()).toContain("https://kudiai.app/verify?ref=KDR-202610-ABCDEFGH");   // the clickable link
    expect(t.filter((x) => x === "Scan to verify").length).toBe(doc.internal.getNumberOfPages());   // the QR is there
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
