/* global globalThis */
// Owner monthly reports (2026-10-03): the Reports page's "Statements & monthly reports" — the monthly Business Report +
// Wallet Statement (the same PDFs the owner-reports function emails on the 1st), the email switch, the wallet
// statement, and back from those views to Reports (arrow and phone/browser back). Fictional business.
import "../testUtils/textEncoder";   // first: jsPDF needs TextEncoder when it loads
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Reports from "../screens/Reports";
import OwnerMonthlyReports from "../screens/OwnerMonthlyReports";
import { walletMonthFromLedger } from "../utils/statementPdfLayout";

let mockSaved = [];
jest.mock("../utils/pdfSave", () => ({ savePdf: async (doc, filename) => { mockSaved.push({ doc, filename }); } }));
jest.mock("../utils/pdfAssets", () => ({
  loadPdfAssets: async () => ({ logo: null, fontReg: null, fontMed: null }), registerNotoSans: () => "helvetica",
  loadImageAsset: async () => null, downscaleImage: async () => null,
}));
// Supabase: every query is a chain resolving to the table's canned rows; calls are recorded
let mockTables = {};
let mockCalls = [];
jest.mock("../utils/supabase", () => ({
  supabase: {
    from: (table) => {
      const p = () => Promise.resolve({ data: typeof mockTables[table] === "function" ? mockTables[table]() : (mockTables[table] ?? []), error: null });
      const obj = new Proxy({}, { get: (_, prop) => (prop === "then" ? (a, b) => p().then(a, b) : (...args) => { mockCalls.push([table, prop, args]); return obj; }) });
      return obj;
    },
  },
}));
jest.mock("react-router-dom", () => ({ useNavigate: () => () => {} }), { virtual: true });
jest.mock("../hooks/usePlatformConfig", () => ({ usePlatformConfig: () => ({ walletEnabled: true }) }));
jest.mock("../hooks/useCampaigns", () => ({ useCampaigns: () => ({ slotMap: {}, loading: false, recordEvent: () => {} }) }));
jest.mock("../hooks/useWallet", () => ({
  useWallet: () => ({ receiptFor: () => null, entryFor: () => ({}), wallet: { flw_account_number: "9034521876", flw_account_bank: "Wema Bank" } }),
}));
jest.mock("../components/WalletPanel", () => ({ WalletTxRow: ({ row }) => <div data-testid="wallet-row">{row.source}</div> }));

const PROFILE = { id: "owner-1", business_name: "Adaeze Fresh Mart", email: "adaeze@demo.ng", business_phone: "0803", business_address: "Shop 14, Ikeja",
                  created_at: "2026-08-15T10:00:00Z", monthly_reports_email: true };
const STORE = { transactions: [], credits: [], asoClients: [], profile: PROFILE, staffMap: {} };
const calls = (table, op) => mockCalls.filter(([t, o]) => t === table && (!op || o === op));
const inserts = (type) => calls("report_verifications", "insert").map((c) => c[2][0]).filter((r) => !type || r.report_type === type);

describe("owner monthly reports", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let host, root;
  beforeEach(() => {
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    mockSaved = []; mockCalls = [];
    mockTables = {
      owner_monthly_reports: [{ month: "2026-09-01", emailed_at: "2026-10-01T06:15:00Z", notified_at: "2026-10-01T06:15:00Z" }],
      wallets: { flw_account_number: "9034521876", flw_account_bank: "Wema Bank", flw_account_name: "KudiAI - Adaeze Fresh Mart" },
      invoice_settings: null,
      report_verifications: { ref: "KDR-202610-ABCDEFGH" },
      wallet_ledger: [],
      profiles: [],
    };
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
  const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
  const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === text) || [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
  const rowOf = (label) => [...host.querySelectorAll("p")].find((p) => p.textContent === label).closest("div.px-4");

  it("lists the months, shows which were sent, and the email switch saves on the profile", async () => {
    await act(async () => { root.render(<OwnerMonthlyReports profile={PROFILE} onBusinessPdf={async () => {}} />); });
    await flush();
    const text = host.textContent;
    expect(text).toContain("August 2026");                        // the month the business joined
    expect(text).toContain("Sent 1 Oct 2026");                    // September went out
    expect(text).toContain("adaeze@demo.ng");
    expect(text).toContain("Wallet statement");                   // the business has a wallet
    await click(host.querySelector('[role="switch"]'));
    const upd = calls("profiles", "update").map((c) => c[2][0]);
    expect(upd).toEqual([{ monthly_reports_email: false }]);
    expect(host.textContent).toContain("Off — you'll still get them here in the app");
  });

  it("a month's Wallet Statement: same shape as the server's, registered and saved for that month", async () => {
    const prior = { balance_after_kobo: 4250000, created_at: "2026-08-31T20:00:00Z" };
    const inMonth = [{ id: 1, created_at: "2026-09-02T10:00:00Z", direction: "credit", amount_kobo: 2000000, balance_after_kobo: 6250000, source: "topup", receipt_ref: "KDT-1" }];
    let n = 0;
    mockTables.wallet_ledger = () => (n++ % 2 === 0 ? inMonth : prior);   // rows in the month, then the row before it
    await act(async () => { root.render(<OwnerMonthlyReports profile={PROFILE} onBusinessPdf={async () => {}} />); });
    await flush();
    await click(rowOf("September 2026").querySelectorAll("button")[1]);
    expect(mockSaved.map((s) => s.filename)).toEqual(["KudiAI_Wallet_Statement_September_2026.pdf"]);
    const reg = inserts("wallet_statement");
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ period_from: "2026-09-01", period_to: "2026-09-30", business_name: "Adaeze Fresh Mart" });
    expect(reg[0].summary.slice(0, 2)).toEqual([{ label: "Wallet account", value: "9034521876" }, { label: "Opening balance", value: "₦42,500.00" }]);
    // the month asked for in WAT
    const lt = calls("wallet_ledger", "lt").map((c) => c[2]);
    expect(lt).toContainEqual(["created_at", "2026-10-01T00:00:00+01:00"]);
  });

  it("walletMonthFromLedger: the server's client_wallet_statement shape", () => {
    const w = walletMonthFromLedger([
      { created_at: "2026-09-03T10:00:00Z", direction: "debit", amount_kobo: 500000, balance_after_kobo: 5750000, source: "withdrawal" },
      { created_at: "2026-09-02T10:00:00Z", direction: "credit", amount_kobo: 2000000, balance_after_kobo: 6250000, source: "topup" },
    ], { balance_after_kobo: 4250000 }, { number: "9034521876" });
    expect(w).toMatchObject({ opening_kobo: 4250000, in_kobo: 2000000, out_kobo: 500000, closing_kobo: 5750000, account: { number: "9034521876" } });
    expect(w.entries.map((e) => e.source)).toEqual(["topup", "withdrawal"]);
    expect(walletMonthFromLedger([], null, {})).toMatchObject({ opening_kobo: 0, closing_kobo: 0, entries: [] });
  });

  it("Reports: the two cards; opened from a notification it lands on the month; back returns to Reports (arrow and phone back)", async () => {
    const onClose = jest.fn();
    await act(async () => { root.render(<Reports store={STORE} initialView="monthly" initialMonth="2026-09" onClose={onClose} />); });
    await flush();
    expect(host.textContent).toContain("Monthly reports");
    expect(rowOf("September 2026").className).toContain("bg-brand-50");      // the month from the link is highlighted
    // the Business Report for September: read like the server does, registered, saved
    await click(rowOf("September 2026").querySelector("button"));
    // the PDF engine first tries the logo and fonts (no network here) — wait for the save
    for (let i = 0; i < 80 && !mockSaved.length; i++) await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(calls("transactions", "gte").map((c) => c[2])).toContainEqual(["transaction_date", "2026-09-01"]);
    expect(calls("transactions", "lte").map((c) => c[2])).toContainEqual(["transaction_date", "2026-09-30"]);
    expect(inserts("general")).toHaveLength(1);
    expect(mockSaved.map((s) => s.filename)).toEqual(["KudiAITrack_Business_Report_2026-09-01_2026-09-30.pdf"]);
    // back arrow → Reports main
    await click(host.querySelector('button[aria-label="Back"]'));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(host.textContent).toContain("Statements & monthly reports");
    expect(onClose).not.toHaveBeenCalled();
    // the wallet statement card, then the phone's back button
    await click(button("Wallet statement"));
    expect(host.textContent).toContain("Every wallet transaction with the balance after it");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate", { state: null })); });
    expect(host.textContent).toContain("Statements & monthly reports");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a branch's view of Reports has no business-wide statements", async () => {
    await act(async () => { root.render(<Reports store={{ transactions: [], credits: [], asoClients: [] }} onClose={() => {}} />); });
    await flush();
    expect(host.textContent).not.toContain("Statements & monthly reports");
  });
});
