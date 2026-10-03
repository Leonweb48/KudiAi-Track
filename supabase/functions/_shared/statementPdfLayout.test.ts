// Run: deno test --no-lock --node-modules-dir=none --allow-env supabase/functions/_shared/statementPdfLayout.test.ts
// The monthly client statement's PDF is built on the server with this copy of the app's statement layout (jsPDF from
// npm, the same major version as the app). Fictional client.
import { jsPDF } from "npm:jspdf@4.2.1";
import { monthlyStatementFilename, monthlyStatementSections, renderMonthlyStatementPdf } from "./statementPdfLayout.js";

function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT ${msg}`);
}

const DATA = {
  month: "2026-10",
  generatedAt: "2026-11-01T06:00:00Z",
  savings: {
    client: { name: "Ngozi Eze", membership_number: "AJO-202608-0001", phone: "0801 000 0000" },
    business: { name: "Adaeze Fresh Mart", phone: "0803 123 4567", address: "Shop 14, Ikeja" },
    opening: 4800, total_in: 5000, total_out: 2600, closing: 7200,
    entries: [
      { at: "2026-09-30T23:30:00Z", label: "Contribution", ref: "KDT-202610-AAAAAAA3", credit: true, amount: 3000, balance: 7800 },
      { at: "2026-10-05T11:00:00Z", label: "Withdrawal", ref: "KDT-202610-AAAAAAA4", credit: false, amount: 1000, balance: 6800 },
      { at: "2026-10-05T11:00:00Z", label: "Withdrawal Fee", ref: "KDT-202610-AAAAAAA5", credit: false, amount: 100, balance: 6700 },
      { at: "2026-10-20T08:00:00Z", label: "Esusu Payout · Esusu: Market Women Circle", ref: "KDT-202610-AAAAAAA6", credit: true, amount: 2000, balance: 8700 },
      { at: "2026-10-20T08:00:00Z", label: "Esusu Pot Sweep · Esusu: Market Women Circle", ref: "KDT-202610-AAAAAAA7", credit: false, amount: 1500, balance: 7200 },
    ],
  },
  wallet: {
    account: { number: "8012345678", bank: "Wema Bank" },
    opening_kobo: 1000000, in_kobo: 0, out_kobo: 550000, closing_kobo: 450000,
    entries: [
      { at: "2026-09-30T23:30:00Z", source: "ajo_contribution", credit: false, amount_kobo: 300000, balance_after_kobo: 700000, ref: "KDT-202610-BBBBBBB1" },
      { at: "2026-10-31T22:59:00Z", source: "withdrawal", narration: "To GTBank", credit: false, amount_kobo: 250000, balance_after_kobo: 450000, ref: "KDT-202610-BBBBBBB2" },
    ],
  },
};

// jsPDF writes text as "(...) Tj"
const texts = (doc: jsPDF) => (doc.output() as string).match(/\((?:[^()\\]|\\.)*\)\s*Tj/g)
  ?.map((m) => m.replace(/\)\s*Tj$/, "").slice(1).replace(/\\([()\\])/g, "$1")) || [];

Deno.test("monthly statement: savings page + wallet page, server-side with the built-in font", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
  const { pages } = renderMonthlyStatementPdf(doc, DATA, { font: "helvetica" });
  const t = texts(doc);
  const has = (s: string) => t.some((x) => x.includes(s));
  ok(pages === 2, `two pages (savings, wallet), got ${pages}`);
  ok(has("SAVINGS STATEMENT") && has("WALLET STATEMENT"), "both statements");
  ok(has("October 2026"), "the month");
  ok(has("Ngozi Eze") && has("Membership AJO-202608-0001"), "the client");
  ok(has("Savings with Adaeze Fresh Mart"), "the business");
  ok(has("Wallet 8012345678 (Wema Bank)"), "the wallet account");
  ok(has("NGN 4,800.00") && has("NGN 7,200.00"), "opening and closing savings balance (built-in font: NGN)");
  ok(has("NGN 10,000.00") && has("NGN 4,500.00"), "opening and closing wallet balance");
  ok(has("1 Oct 2026"), "00:30 WAT on 1 Oct is shown as 1 Oct");
  ok(has("Ajo Contribution") && has("Transfer · To GTBank"), "wallet entries named");
  ok(has("Page 2 of 2"), "footer page count");
  ok((doc.output("arraybuffer") as ArrayBuffer).byteLength > 2000, "a real PDF");
});

Deno.test("a quiet month still gets a statement with its balance", () => {
  const sections = monthlyStatementSections({ month: "2026-10", savings: { ...DATA.savings, entries: [], total_in: 0, total_out: 0, opening: 7200, closing: 7200 }, wallet: null });
  ok(sections.length === 1 && sections[0].months[0].entries.length === 0, "savings only, no entries");
  ok(sections[0].months[0].openingKobo === 720000 && sections[0].months[0].closingKobo === 720000, "balance carried");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
  renderMonthlyStatementPdf(doc, { month: "2026-10", savings: sections.length ? { ...DATA.savings, entries: [], total_in: 0, total_out: 0, opening: 7200, closing: 7200 } : null }, { font: "helvetica" });
  ok(texts(doc).some((x) => x.includes("No savings transactions this month.")), "says so");
  ok(monthlyStatementFilename("2026-10") === "KudiAI_Statement_October_2026.pdf", "file name");
});
