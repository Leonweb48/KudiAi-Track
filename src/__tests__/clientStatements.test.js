/* global globalThis */
// Client statements (2026-10-03): the shared statement layout (also copied to the server for the monthly email), the
// client Statements screen (savings / wallet / monthly) and its helpers. Fictional client.
import "../testUtils/textEncoder";   // first: jsPDF needs TextEncoder when it loads
import fs from "fs";
import path from "path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  WALLET_SOURCE_TITLES, groupByMonth, monthlyStatementSections, renderMonthlyStatementPdf, renderStatementPdf,
  savingsEntries, savingsStatementSections, walletEntries,
} from "../utils/statementPdfLayout";
import { WALLET_TITLES } from "../utils/receiptConfig";
import { buildSavingsStatementCSV } from "../utils/exportCSV";
import ClientStatements, { statementMonths, statementRange } from "../screens/ClientStatements";
import { jsPDF } from "jspdf";

let mockSaved = [];
jest.mock("../utils/pdfSave", () => ({ savePdf: async (doc, filename) => { mockSaved.push({ doc, filename }); } }));
jest.mock("../utils/pdfAssets", () => ({ loadPdfAssets: async () => ({ logo: null, fontReg: null, fontMed: null }), registerNotoSans: () => "helvetica" }));
let mockStatementRows = [];
jest.mock("../utils/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: mockStatementRows }) }) }) },
}));
jest.mock("react-router-dom", () => ({ useNavigate: () => () => {} }), { virtual: true });
jest.mock("../hooks/usePlatformConfig", () => ({ usePlatformConfig: () => ({ walletEnabled: true }) }));
jest.mock("../hooks/useWallet", () => ({ useWallet: () => ({ receiptFor: () => null, entryFor: () => ({}), wallet: null }) }));

const texts = (doc) => doc.output().match(/\((?:[^()\\]|\\.)*\)\s*Tj/g)
  ?.map((m) => m.replace(/\)\s*Tj$/, "").slice(1).replace(/\\([()\\])/g, "$1")) || [];

const SAVINGS = {
  client: { name: "Ngozi Eze", membership_number: "AJO-202608-0001", phone: "0801" },
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

describe("shared statement layout", () => {
  it("the server's copy (monthly email PDF) is byte-for-byte the app's — run scripts/sync-statement-layout.mjs after editing", () => {
    const root = path.resolve(__dirname, "../..");
    const app = fs.readFileSync(path.join(root, "src/utils/statementPdfLayout.js"), "utf8");
    const server = fs.readFileSync(path.join(root, "supabase/functions/_shared/statementPdfLayout.js"), "utf8");
    expect(server).toBe(app);
  });

  it("wallet entries are named exactly as the app's receipts name them", () => {
    expect(WALLET_SOURCE_TITLES).toEqual(WALLET_TITLES);
  });

  it("savings: months carry the opening forward; 00:30 WAT on 1 Oct belongs to October", () => {
    const months = groupByMonth(savingsEntries(SAVINGS.entries), { openingKobo: 0 });
    expect(months.map((m) => m.key)).toEqual(["2026-09", "2026-10"]);
    expect(months[0]).toMatchObject({ openingKobo: 0, totalInKobo: 500000, totalOutKobo: 20000, closingKobo: 480000 });
    expect(months[1]).toMatchObject({ openingKobo: 480000, totalInKobo: 300000, totalOutKobo: 60000, closingKobo: 720000 });
  });

  it("savings statement PDF: one page per month with the client, the business and the balances", () => {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
    renderStatementPdf(doc, { sections: savingsStatementSections(SAVINGS), generatedAt: "2026-10-03T10:00:00Z" }, { font: "helvetica" });
    const t = texts(doc);
    expect(doc.internal.getNumberOfPages()).toBe(2);
    for (const s of ["SAVINGS STATEMENT", "September 2026", "October 2026", "Ngozi Eze  ·  Membership AJO-202608-0001  ·  0801",
                     "Savings with Adaeze Fresh Mart", "NGN 4,800.00", "NGN 7,200.00", "Total for October 2026"]) {
      expect(t.some((x) => x.includes(s))).toBe(true);
    }
  });

  it("monthly statement: savings then wallet, a quiet wallet month still shows its balance", () => {
    const data = {
      month: "2026-10",
      savings: { ...SAVINGS, opening: 4800, total_in: 3000, total_out: 600, closing: 7200, entries: SAVINGS.entries.slice(2) },
      wallet: { account: { number: "8012345678", bank: "Wema Bank" }, opening_kobo: 450000, in_kobo: 0, out_kobo: 0, closing_kobo: 450000, entries: [] },
    };
    const sections = monthlyStatementSections(data);
    expect(sections.map((s) => s.title)).toEqual(["SAVINGS STATEMENT", "WALLET STATEMENT"]);
    expect(sections[1].months[0]).toMatchObject({ openingKobo: 450000, closingKobo: 450000, entries: [] });
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
    renderMonthlyStatementPdf(doc, data, { font: "helvetica" });
    const t = texts(doc);
    expect(t.some((x) => x.includes("Wallet 8012345678 (Wema Bank)"))).toBe(true);
    expect(t.some((x) => x.includes("No wallet transactions this month."))).toBe(true);
  });

  it("wallet entries read both the app's ledger rows and the server's statement rows", () => {
    const a = walletEntries([{ created_at: "2026-10-01T08:00:00Z", direction: "debit", amount_kobo: 250000, balance_after_kobo: 450000, source: "withdrawal", narration: "To GTBank", receipt_ref: "KDT-9" }]);
    const b = walletEntries([{ at: "2026-10-01T08:00:00Z", credit: false, amount_kobo: 250000, balance_after_kobo: 450000, source: "withdrawal", narration: "To GTBank", ref: "KDT-9" }]);
    expect(b).toEqual(a);
    expect(a[0]).toMatchObject({ description: "Transfer · To GTBank", ref: "KDT-9", credit: false, month: "2026-10" });
  });
});

describe("statement helpers", () => {
  it("period chips as a WAT range", () => {
    expect(statementRange("month", "", "", "2026-10-15")).toEqual({ from: "2026-10-01T00:00:00+01:00", to: "2026-10-16T00:00:00+01:00" });
    expect(statementRange("today", "", "", "2026-10-15")).toEqual({ from: "2026-10-15T00:00:00+01:00", to: "2026-10-16T00:00:00+01:00" });
    expect(statementRange("week", "", "", "2026-10-15").from).toBe("2026-10-11T00:00:00+01:00");   // Sunday
    expect(statementRange("custom", "2026-09-01", "2026-09-30", "2026-10-15")).toEqual({ from: "2026-09-01T00:00:00+01:00", to: "2026-10-01T00:00:00+01:00" });
    expect(statementRange("all", "", "", "2026-10-15").from).toBe("2000-01-01T00:00:00+01:00");
  });
  it("downloadable months: from joining to now, newest first, across a year end", () => {
    expect(statementMonths("2025-11-20", "2026-02-03")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
    expect(statementMonths(null, "2026-02-03")).toEqual(["2026-02"]);
    expect(statementMonths("2020-01-01", "2026-02-03")).toHaveLength(24);
  });
  it("savings CSV: opening, every entry with its balance, closing", () => {
    const lines = buildSavingsStatementCSV(SAVINGS).replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("date_time_wat,description,reference,money_in_ngn,money_out_ngn,balance_ngn");
    expect(lines[1]).toBe(",Opening balance,,,,0");
    expect(lines[2]).toBe("2026-09-10 10:00:00,Contribution,KDT-1,5000,,5000");
    expect(lines[5]).toBe("2026-10-05 12:00:00,Withdrawal,KDT-4,,600,7200");
    expect(lines[6]).toBe(",Closing balance,,8000,800,7200");
  });
});

describe("client Statements screen", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let host, root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); mockSaved = []; });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
  const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
  const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text || b.textContent.includes(text));

  it("savings tab shows the server's statement; PDF downloads it", async () => {
    const call = jest.fn(async (action) => (action === "get-savings-statement" ? { statement: SAVINGS } : {}));
    await act(async () => { root.render(<ClientStatements call={call} clientId="c1" clientName="Ngozi Eze" since="2026-08-01" hasWallet onClose={() => {}} />); });
    await flush();
    expect(call).toHaveBeenCalledWith("get-savings-statement", expect.objectContaining({ client_id: "c1" }));
    const text = host.textContent;
    expect(text).toContain("Statements");
    expect(text).toContain("Wallet");                         // tab shown because the client has a wallet
    expect(text).toContain("Withdrawal");
    expect(text).toContain("KDT-4");
    expect(text).toMatch(/Bal\s*₦7,200/);
    await click(button("PDF"));
    expect(mockSaved).toHaveLength(1);
    expect(mockSaved[0].filename).toMatch(/^savings_statement_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("monthly tab (opened from a statement notification): lists months, marks sent ones, downloads the month", async () => {
    mockStatementRows = [{ month: "2026-09-01", emailed_at: "2026-10-01T06:10:00Z", notified_at: "2026-10-01T06:10:00Z" }];
    const month = { month: "2026-09", savings: { ...SAVINGS, entries: SAVINGS.entries.slice(0, 2) }, wallet: null };
    const call = jest.fn(async (action) => (action === "get-monthly-statement" ? { statement: month } : { statement: SAVINGS }));
    await act(async () => { root.render(<ClientStatements call={call} clientId="c1" clientName="Ngozi Eze" clientEmail="ngozi@demo.ng" since="2026-08-01" hasWallet={false} initialTab="monthly" initialMonth="2026-09" onClose={() => {}} />); });
    await flush();
    const text = host.textContent;
    expect(text).not.toContain("Wallet");                     // no wallet → no wallet tab
    expect(text).toContain("ngozi@demo.ng");
    expect(text).toContain("September 2026");
    expect(text).toContain("Sent 1 Oct 2026");
    expect(text).toContain("August 2026");                    // the month they joined
    const row = [...host.querySelectorAll("p")].find((p) => p.textContent === "September 2026").closest("div.flex");
    await click(row.querySelector("button"));
    expect(call).toHaveBeenCalledWith("get-monthly-statement", { client_id: "c1", month: "2026-09" });
    expect(mockSaved.map((s) => s.filename)).toEqual(["KudiAI_Statement_September_2026.pdf"]);
    expect(mockSaved[0].doc.internal.getNumberOfPages()).toBe(1);   // savings only (no wallet), one month
  });
});
