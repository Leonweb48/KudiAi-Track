/* global globalThis */
// Client statements (2026-10-03): the shared statement layout (also copied to the server for the monthly email) —
// header with the KudiAI Track name and the client's details, verify footer with reference + QR code — the client
// Statements screen (savings / wallet / monthly, back steps through the tabs) and its helpers. Fictional client.
import "../testUtils/textEncoder";   // first: jsPDF needs TextEncoder when it loads
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import jsQR from "jsqr";
import {
  WALLET_SOURCE_TITLES, clientHolder, groupByMonth, monthlyStatementSections, renderStatementPdf,
  savingsEntries, savingsStatementSections, verifyUrl, walletEntries, walletStatementSections,
} from "../utils/statementPdfLayout";
import { WALLET_TITLES } from "../utils/receiptConfig";
import { buildSavingsStatementCSV } from "../utils/exportCSV";
import { statementDates } from "../utils/statementPeriod";
import { qrMatrix } from "../utils/statementVerify";
import ClientStatements, { statementMonths, statementRange } from "../screens/ClientStatements";
import { jsPDF } from "jspdf";

let mockSaved = [];
jest.mock("../utils/pdfSave", () => ({ savePdf: async (doc, filename) => { mockSaved.push({ doc, filename }); } }));
jest.mock("../utils/pdfAssets", () => ({ loadPdfAssets: async () => ({ logo: null, fontReg: null, fontMed: null }), registerNotoSans: () => "helvetica" }));
// Supabase: every query is a chain that resolves to the table's canned rows; calls are recorded
let mockTables = {};
let mockCalls = [];
jest.mock("../utils/supabase", () => ({
  supabase: {
    from: (table) => {
      const p = () => Promise.resolve({ data: mockTables[table] ?? [], error: null });
      const obj = new Proxy({}, { get: (_, prop) => (prop === "then" ? (a, b) => p().then(a, b) : (...args) => { mockCalls.push([table, prop, args]); return obj; }) });
      return obj;
    },
  },
}));
jest.mock("react-router-dom", () => ({ useNavigate: () => () => {} }), { virtual: true });
jest.mock("../hooks/usePlatformConfig", () => ({ usePlatformConfig: () => ({ walletEnabled: true }) }));
let mockWalletThrows = false;
jest.mock("../hooks/useWallet", () => ({
  useWallet: () => {
    if (mockWalletThrows) throw new Error("boom");
    return { receiptFor: () => null, entryFor: () => ({}), wallet: { flw_account_number: "9048817263", flw_account_bank: "Wema Bank", flw_account_name: "KudiAI - Ngozi Eze" } };
  },
}));
jest.mock("../components/WalletPanel", () => ({ WalletTxRow: ({ row }) => <div data-testid="wallet-row">{row.source}</div> }));

const tjTexts = (src) => src.match(/\((?:[^()\\]|\\.)*\)\s*Tj/g)
  ?.map((m) => m.replace(/\)\s*Tj$/, "").slice(1).replace(/\\([()\\])/g, "$1")) || [];
const texts = (doc) => tjTexts(doc.output());
/** The text drawn on one page (1-based). */
const pageTexts = (doc, n) => tjTexts(doc.internal.pages[n].join("\n"));
const inserts = (type) => mockCalls.filter(([t, op, args]) => t === "report_verifications" && op === "insert" && (!type || args[0]?.report_type === type)).map((c) => c[2][0]);

const CLIENT = { name: "Ngozi Eze", membership_number: "AJO-202608-0001", phone: "0801", email: "ngozi@demo.ng", address: "5 Allen Avenue", lga: "Ikeja", state: "Lagos" };
const SAVINGS = {
  client: CLIENT,
  business: { name: "Adaeze Fresh Mart", phone: "0803 123 4567", address: "Shop 14, Ikeja" },
  from: "2026-09-01T00:00:00+01:00", to: "2026-11-01T00:00:00+01:00",
  opening: 0, total_in: 8000, total_out: 800, closing: 7200, brought_forward: 0,
  entries: [
    { at: "2026-09-10T09:00:00Z", label: "Contribution", ref: "KDT-1", credit: true, amount: 5000, balance: 5000 },
    { at: "2026-09-10T09:00:00Z", label: "Registration Fee", ref: "KDT-2", credit: false, amount: 200, balance: 4800 },
    { at: "2026-09-30T23:30:00Z", label: "Contribution", ref: "KDT-3", credit: true, amount: 3000, balance: 7800 },
    { at: "2026-10-05T11:00:00Z", label: "Withdrawal", ref: "KDT-4", credit: false, amount: 600, balance: 7200 },
  ],
};
const REF = "KDR-202610-ABCDEFGH";

describe("shared statement layout", () => {
  it("wallet entries are named exactly as the app's receipts name them", () => {
    expect(WALLET_SOURCE_TITLES).toEqual(WALLET_TITLES);
  });

  it("savings: months carry the opening forward; 00:30 WAT on 1 Oct belongs to October", () => {
    const months = groupByMonth(savingsEntries(SAVINGS.entries), { openingKobo: 0 });
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-10"]);
    expect(months[0]).toMatchObject({ openingKobo: 0, totalInKobo: 500000, totalOutKobo: 20000, closingKobo: 480000 });
    expect(months[1]).toMatchObject({ openingKobo: 480000, totalInKobo: 300000, totalOutKobo: 60000, closingKobo: 720000 });
  });

  it("savings statement PDF: KudiAI Track header, title, the client's name, contact details and address; verify footer + QR", () => {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
    renderStatementPdf(doc, {
      sections: savingsStatementSections(SAVINGS, { period: "1 Sep 2026 – 31 Oct 2026" }),
      generatedAt: "2026-10-03T10:00:00Z", verify: { ref: REF, qr: qrMatrix(verifyUrl(REF)) },
    }, { font: "helvetica" });
    const t = texts(doc);
    const has = (s) => t.some((x) => x.includes(s));
    const count = (s) => t.filter((x) => x.includes(s)).length;
    expect(doc.internal.getNumberOfPages()).toBe(2);
    for (const s of ["SAVINGS STATEMENT", "STATEMENT FOR", "Ngozi Eze", "0801  ·  ngozi@demo.ng", "5 Allen Avenue, Ikeja, Lagos",
                     "SAVINGS ACCOUNT", "Membership AJO-202608-0001", "Savings with Adaeze Fresh Mart", "September 2026", "October 2026",
                     "NGN 4,800.00", "NGN 7,200.00", "Total for October 2026"]) {
      expect([s, has(s)]).toEqual([s, true]);
    }
    expect(count("KudiAI Track") >= 2).toBe(true);                                // header on every page
    expect(count("Generated by KudiAI Track")).toBe(1);                          // footer on the last page only
    expect(count("A product of Amaya & Co. Technologies")).toBe(3);              // both headers + the footer
    expect(count("Verify this statement at ")).toBe(1);
    expect(count("Scan to verify")).toBe(1);
    expect(t.filter((x) => x === REF).length).toBe(1);
    expect(doc.output()).toContain(verifyUrl(REF));                              // the clickable link
    // page 1: just its number; page 2 (the last): the footer with the link and the QR
    const p1 = pageTexts(doc, 1), p2 = pageTexts(doc, 2);
    expect(p1).toContain("Page 1 of 2");
    expect(p1.some((x) => /Generated by|Verify this statement|Scan to verify/.test(x))).toBe(false);
    expect(p2).toEqual(expect.arrayContaining(["Generated by KudiAI Track", "Verify this statement at ", "Scan to verify", REF, "Page 2 of 2"]));
  });

  it("the footer goes on the last page — on a page of its own when the last page is full", () => {
    const render = (n) => {
      const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
      const rows = Array.from({ length: n }, (_, i) => ({ created_at: `2026-10-${String(2 + (i % 25)).padStart(2, "0")}T10:00:00Z`, direction: "credit",
        amount_kobo: 100000, balance_after_kobo: 100000 * (i + 1), source: "topup", receipt_ref: `KDT-${i}` }));
      renderStatementPdf(doc, {
        sections: walletStatementSections({ entries: walletEntries(rows), holder: clientHolder(CLIENT), account: { number: "9048817263" }, period: "October 2026" }),
        verify: { ref: REF, qr: qrMatrix(verifyUrl(REF)) },
      }, { font: "helvetica" });
      return doc;
    };
    let sawOwnPage = false;
    for (let n = 1; n <= 45; n++) {
      const doc = render(n);
      const pages = doc.internal.getNumberOfPages();
      const last = pageTexts(doc, pages);
      expect([n, texts(doc).filter((x) => x === "Generated by KudiAI Track").length]).toEqual([n, 1]);
      expect([n, last.includes("Generated by KudiAI Track") && last.includes("Scan to verify") && last.includes(`Page ${pages} of ${pages}`)]).toEqual([n, true]);
      for (let p = 1; p < pages; p++) expect([n, p, pageTexts(doc, p).includes(`Page ${p} of ${pages}`)]).toEqual([n, p, true]);
      if (last.some((x) => x.startsWith("End of statement."))) {
        sawOwnPage = true;
        expect(last.some((x) => x.startsWith("KDT-"))).toBe(false);                // nothing but the header, the note and the footer
        expect(pageTexts(doc, pages - 1).some((x) => x.startsWith("Total for "))).toBe(true);
      }
    }
    expect(sawOwnPage).toBe(true);
  });

  it("the QR code drawn on statements scans to the verify link", () => {
    const m = qrMatrix(verifyUrl(REF));
    const scale = 4, quiet = 4, n = (m.size + quiet * 2) * scale;
    const px = new Uint8ClampedArray(n * n * 4).fill(255);
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
      if (!m.isDark(r, c)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = (((r + quiet) * scale + dy) * n + ((c + quiet) * scale + dx)) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
    expect(jsQR(px, n, n)?.data).toBe("https://kudiai.app/verify?ref=KDR-202610-ABCDEFGH");
  });

  it("a client's wallet statement carries the client and the wallet account", () => {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
    const entries = walletEntries([{ created_at: "2026-10-01T08:00:00Z", direction: "debit", amount_kobo: 250000, balance_after_kobo: 450000, source: "withdrawal", narration: "To GTBank", receipt_ref: "KDT-9" }]);
    renderStatementPdf(doc, { sections: walletStatementSections({ entries, holder: clientHolder(CLIENT), account: { number: "9048817263", bank: "Wema Bank" }, period: "1 Oct 2026" }) }, { font: "helvetica" });
    const t = texts(doc);
    for (const s of ["WALLET STATEMENT", "Ngozi Eze", "5 Allen Avenue, Ikeja, Lagos", "WALLET ACCOUNT", "Account 9048817263", "Wema Bank", "Transfer · To GTBank"]) {
      expect([s, t.some((x) => x.includes(s))]).toEqual([s, true]);
    }
    expect(t.some((x) => x.includes("Verify this statement"))).toBe(false);    // no reference → no verify block, still a statement
  });

  it("monthly statement: both accounts at a glance first, then savings and wallet in full", () => {
    const data = {
      month: "2026-10",
      savings: { ...SAVINGS, opening: 4800, total_in: 3000, total_out: 600, closing: 7200, entries: SAVINGS.entries.slice(2) },
      wallet: { account: { number: "8012345678", bank: "Wema Bank" }, opening_kobo: 450000, in_kobo: 0, out_kobo: 0, closing_kobo: 450000, entries: [] },
    };
    const sections = monthlyStatementSections(data);
    expect(sections.map((s) => s.title)).toEqual(["MONTHLY STATEMENT", "MONTHLY STATEMENT · SAVINGS", "MONTHLY STATEMENT · WALLET"]);
    expect(sections[0].panels.map((p) => p.title)).toEqual(["Savings", "Wallet"]);
    expect(sections[2].months[0]).toMatchObject({ openingKobo: 450000, closingKobo: 450000, entries: [] });
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
    renderStatementPdf(doc, { sections }, { font: "helvetica" });
    const t = texts(doc);
    expect(doc.internal.getNumberOfPages()).toBe(3);
    expect(t.some((x) => x.includes("October 2026 at a glance"))).toBe(true);
    expect(t.some((x) => x.includes("Account 8012345678"))).toBe(true);
    expect(t.some((x) => x.includes("No wallet transactions this month."))).toBe(true);
  });

  it("wallet entries read both the app's ledger rows and the server's statement rows", () => {
    const a = walletEntries([{ created_at: "2026-10-01T08:00:00Z", direction: "debit", amount_kobo: 250000, balance_after_kobo: 450000, source: "withdrawal", narration: "To GTBank", receipt_ref: "KDT-9" }]);
    const b = walletEntries([{ at: "2026-10-01T08:00:00Z", credit: false, amount_kobo: 250000, balance_after_kobo: 450000, source: "withdrawal", narration: "To GTBank", ref: "KDT-9" }]);
    expect(b).toEqual(a);
  });
});

describe("statement helpers", () => {
  it("period chips as a WAT range, and the days a statement covers", () => {
    expect(statementRange("month", "", "", "2026-10-15")).toEqual({ from: "2026-10-01T00:00:00+01:00", to: "2026-10-16T00:00:00+01:00" });
    expect(statementRange("week", "", "", "2026-10-15").from).toBe("2026-10-11T00:00:00+01:00");   // Sunday
    expect(statementDates(statementRange("month", "", "", "2026-10-15"))).toEqual({ fromDate: "2026-10-01", toDate: "2026-10-15" });
    expect(statementDates(statementRange("all", "", "", "2026-10-15"), "2026-08-31T23:30:00Z")).toEqual({ fromDate: "2026-09-01", toDate: "2026-10-15" });
  });
  it("downloadable months: from joining to now, newest first, across a year end", () => {
    expect(statementMonths("2025-11-20", "2026-02-03")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(statementMonths("2020-01-01", "2026-02-03")).toHaveLength(24);
  });
  it("savings CSV: opening, every entry with its balance, closing", () => {
    const lines = buildSavingsStatementCSV(SAVINGS).replace(/^﻿/, "").split("\r\n");
    expect(lines[1]).toBe(",Opening balance,,,,0");
    expect(lines[5]).toBe("2026-10-05 12:00:00,Withdrawal,KDT-4,,600,7200");
    expect(lines[6]).toBe(",Closing balance,,8000,800,7200");
  });
});

describe("client Statements screen", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let host, root;
  beforeEach(() => {
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    mockSaved = []; mockCalls = []; mockWalletThrows = false;
    mockTables = { report_verifications: { ref: REF }, client_statements: [], wallet_ledger: [
      { id: 1, created_at: new Date().toISOString(), direction: "credit", amount_kobo: 2000000, balance_after_kobo: 3450000, source: "topup", status: "completed" },
    ] };
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
  const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
  const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text) || [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
  const CLIENT_ROW = { full_name: "Ngozi Eze", phone: "0801", email: "ngozi@demo.ng", address: "5 Allen Avenue", lga: "Ikeja", state: "Lagos" };
  const mount = async (props = {}) => {
    const call = props.call || jest.fn(async (action) => (action === "get-savings-statement" ? { statement: SAVINGS } : {}));
    const onClose = jest.fn();
    await act(async () => { root.render(<ClientStatements call={call} clientId="c1" client={CLIENT_ROW} since="2026-08-01" walletUserId="u1" hasWallet onClose={onClose} {...props} />); });
    await flush();
    return { call, onClose };
  };

  it("savings tab shows the server's statement; its PDF is registered for verification (savings_statement)", async () => {
    const { call } = await mount();
    expect(call).toHaveBeenCalledWith("get-savings-statement", expect.objectContaining({ client_id: "c1" }));
    expect(host.textContent).toContain("KDT-4");
    expect(host.textContent).toMatch(/Bal\s*₦7,200/);
    await click(button("PDF"));
    expect(mockSaved).toHaveLength(1);
    const reg = inserts("savings_statement");
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ business_name: "Ngozi Eze", period_to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(reg[0].summary.map((s) => s.label)).toEqual(["Membership", "Opening balance", "Money in", "Money out", "Closing balance", "Transactions"]);
  });

  it("wallet tab shows the wallet statement (not a blank screen); its PDF is for the client (wallet_statement)", async () => {
    await mount();
    await click(button("Wallet"));
    expect(host.querySelectorAll('[data-testid="wallet-row"]').length).toBe(1);
    await click(button("PDF"));
    const reg = inserts("wallet_statement");
    expect(reg).toHaveLength(1);
    expect(reg[0].business_name).toBe("Ngozi Eze");
    expect(reg[0].summary[0]).toEqual({ label: "Wallet account", value: "9048817263" });
    expect(mockSaved).toHaveLength(1);
  });

  it("a tab that fails shows a way back instead of a white screen", async () => {
    mockWalletThrows = true;
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await mount();
    await click(button("Wallet"));
    expect(host.textContent).toContain("This screen couldn't load");
    await click(button("Go back"));
    expect(host.textContent).toContain("KDT-4");                              // back on the savings tab
    spy.mockRestore();
  });

  it("back goes to the previous tab, then out of Statements (through the browser history)", async () => {
    const { onClose } = await mount();
    await click(button("Wallet"));
    await click(button("Monthly"));
    const back = host.querySelector('button[aria-label="Back"]');
    await click(back);
    expect(host.querySelector('[data-testid="wallet-row"]')).not.toBeNull();   // Monthly → Wallet
    await click(back);
    expect(host.textContent).toContain("KDT-4");                              // Wallet → Savings
    expect(onClose).not.toHaveBeenCalled();
    await click(back);                                                         // Savings → out (history.back → popstate)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the phone's / browser's back button steps back too", async () => {
    const { onClose } = await mount();
    await click(button("Monthly"));
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate", { state: null })); });
    expect(host.textContent).toContain("KDT-4");                              // Monthly → Savings, still open
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate", { state: null })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("monthly tab: savings and wallet, marks sent months, downloads the month (registered as monthly_statement)", async () => {
    mockTables.client_statements = [{ month: "2026-09-01", emailed_at: "2026-10-01T06:10:00Z", notified_at: "2026-10-01T06:10:00Z" }];
    const month = { month: "2026-09", savings: { ...SAVINGS, entries: SAVINGS.entries.slice(0, 2) },
                    wallet: { account: { number: "9048817263", bank: "Wema Bank" }, opening_kobo: 0, in_kobo: 0, out_kobo: 0, closing_kobo: 0, entries: [] } };
    const call = jest.fn(async (action) => (action === "get-monthly-statement" ? { statement: month } : { statement: SAVINGS }));
    await mount({ call, hasWallet: false, initialTab: "monthly", initialMonth: "2026-09" });
    const text = host.textContent;
    expect(text).toContain("ngozi@demo.ng");
    expect(text).toContain("Sent 1 Oct 2026 · savings and wallet");
    const row = [...host.querySelectorAll("p")].find((p) => p.textContent === "September 2026").closest("div.flex");
    await click(row.querySelector("button"));
    expect(call).toHaveBeenCalledWith("get-monthly-statement", { client_id: "c1", month: "2026-09" });
    expect(mockSaved.map((s) => s.filename)).toEqual(["KudiAI_Statement_September_2026.pdf"]);
    expect(mockSaved[0].doc.internal.getNumberOfPages()).toBe(3);              // at a glance + savings + wallet
    const reg = inserts("monthly_statement");
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ period_from: "2026-09-01", period_to: "2026-09-30", business_name: "Ngozi Eze" });
    expect(reg[0].summary).toHaveLength(8);
  });
});
