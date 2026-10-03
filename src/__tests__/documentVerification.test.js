/* global globalThis */
// Every document the app makes is verifiable (2026-10-03, owner request): a shared receipt carries its verify link; the
// receipt image shows the link, reference and QR; plain PDFs (credit history, Ajo / transaction / bill statements,
// contribution cards), invoices and invoice receipts, and the PIN voucher sheet get a reference + verify footer; the
// verify page words each kind. Fictional business and customers.
import "../testUtils/textEncoder";   // first: jsPDF needs TextEncoder when it loads
/* eslint-disable import/first */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { verifyLink, verifyShareText, receiptShareText } from "../utils/verifyLink";
import { shareFile } from "../utils/shareFile";
import { createReportPdf, fmtCurrency } from "../utils/generateReportPdf";
import { exportInvoicePdf } from "../utils/generateInvoicePdf";
import { buildVoucherPdf } from "../utils/printVouchers";
import { saveReceiptPdf } from "../utils/generateReceiptPdf";
import { ReceiptCard } from "../components/shared/ReceiptCard";
import VerifyReceipt from "../screens/VerifyReceipt";
import { spanDays, watDay } from "../utils/statementPeriod";
/* eslint-enable import/first */

const REF = "KDR-202610-TESTREF2";
let mockInserts = [];
let mockInsertFail = false;
let mockRpc = jest.fn();
jest.mock("../utils/supabase", () => ({
  supabase: {
    rpc: (...a) => mockRpc(...a),
    from: (table) => ({
      insert: (row) => ({ select: () => ({ single: async () => {
        mockInserts.push({ table, row });
        return mockInsertFail ? { data: null, error: { message: "offline" } } : { data: { ref: "KDR-202610-TESTREF2" }, error: null };
      } }) }),
    }),
  },
}));
let mockSaved = [];
jest.mock("../utils/pdfSave", () => ({ savePdf: async (doc, filename, opts) => { mockSaved.push({ doc, filename, opts }); } }));
let mockNative = false;
let mockShares = [];
jest.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mockNative, getPlatform: () => (mockNative ? "android" : "web") } }));
jest.mock("@capacitor/filesystem", () => ({ Filesystem: { writeFile: async ({ path }) => ({ uri: `file:///cache/${path}` }) }, Directory: { Cache: "CACHE" } }));
jest.mock("@capacitor/share", () => ({ Share: { share: async (o) => { mockShares.push(o); } } }));
// jsdom has no canvas: the receipt image's QR comes back as a tiny real PNG; the PDFs' vector QR uses the real library
jest.mock("qrcode", () => ({
  ...jest.requireActual("qrcode"),
  toDataURL: async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
}));
jest.mock("../components/BarcodeScanner", () => () => null);
jest.mock("react-router-dom", () => ({ useNavigate: () => () => {} }), { virtual: true });

// jsPDF text: "(...) Tj"; a string with a character outside Latin-1 (₦) is written as UTF-16 byte pairs
const NUL = String.fromCharCode(0);
const utf16 = (s) => {
  if (!s.includes(NUL)) return s;
  const b = s.replace(/\\(.)/g, "$1");
  let out = "";
  for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode(b.charCodeAt(i) * 256 + b.charCodeAt(i + 1));
  return out;
};
const tjTexts = (src) => src.match(/\((?:[^()\\]|\\.)*\)\s*Tj/g)?.map((m) => utf16(m.replace(/\)\s*Tj$/, "").slice(1)).replace(/\\([()\\])/g, "$1")) || [];
const pageTexts = (doc, n) => tjTexts(doc.internal.pages[n].join("\n"));
const allTexts = (doc) => Array.from({ length: doc.internal.getNumberOfPages() }, (_, i) => pageTexts(doc, i + 1)).flat();

beforeEach(() => { mockInserts = []; mockInsertFail = false; mockSaved = []; mockShares = []; mockNative = false; });

describe("the verify link", () => {
  it("is the reference's page on kudiai.app, sent with a shared document", () => {
    expect(verifyLink("KDT-202610-ABCDEFGH")).toBe("https://kudiai.app/verify?ref=KDT-202610-ABCDEFGH");
    expect(verifyShareText("KDT-202610-ABCDEFGH", "receipt"))
      .toBe("Verify this receipt (Ref KDT-202610-ABCDEFGH): https://kudiai.app/verify?ref=KDT-202610-ABCDEFGH");
    expect(verifyShareText("", "receipt")).toBe("");
    // only a receipt with a stored reference can be looked up
    expect(receiptShareText({ hasRef: false, receiptRef: "KDT-202610-ABCDEFGH" })).toBe("");
    expect(receiptShareText({ hasRef: true, receiptRef: "KDT-202610-ABCDEFGH" })).toContain("https://kudiai.app/verify?ref=KDT-202610-ABCDEFGH");
  });

  it("documents are dated in WAT", () => {
    expect(watDay("2026-10-03T23:30:00Z")).toBe("2026-10-04");
    expect(watDay("2026-10-03")).toBe("2026-10-03");
    expect(watDay("not a date")).toBe("");
    expect(spanDays(["2026-10-05T10:00:00Z", "2026-09-30T23:30:00Z"])).toEqual({ fromDate: "2026-10-01", toDate: "2026-10-05" });
  });
});

describe("sharing a receipt sends its verify link", () => {
  const file = () => new File(["x"], "receipt.png", { type: "image/png" });
  afterEach(() => { delete navigator.canShare; delete navigator.share; });

  it("in the app: the share sheet gets the file and the link as its text", async () => {
    mockNative = true;
    expect(await shareFile(file(), { text: "Verify this receipt: LINK" })).toBe("shared");
    expect(mockShares).toEqual([expect.objectContaining({ title: "receipt.png", url: "file:///cache/receipt.png", text: "Verify this receipt: LINK" })]);
  });

  it("in a browser: shared with the link where it can be, else the file alone", async () => {
    navigator.share = jest.fn(async () => {});
    navigator.canShare = jest.fn(() => true);
    await shareFile(file(), { text: "LINK" });
    expect(navigator.share.mock.calls[0][0]).toMatchObject({ title: "receipt.png", text: "LINK" });
    navigator.canShare = jest.fn((p) => !p.text);   // a browser that can't send text with a file
    await shareFile(file(), { text: "LINK" });
    expect(navigator.share.mock.calls[1][0].text).toBeUndefined();
  });

  it("the receipt PDF goes with its link", async () => {
    await saveReceiptPdf({ title: "Airtime", amount: 100, status: "success", direction: "out", hasRef: true,
      receiptRef: "KDT-202610-ABCDEFGH", fields: [], filenames: { pdf: "airtime.pdf" } });
    expect(mockSaved[0].filename).toBe("airtime.pdf");
    expect(mockSaved[0].opts.shareText).toBe(verifyShareText("KDT-202610-ABCDEFGH", "receipt"));
  });
});

describe("the receipt image shows how to verify it", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let host, root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const data = { title: "Airtime", status: "success", amount: 100, datetime: "3 Oct 2026", fields: [], receiptRef: "KDT-202610-ABCDEFGH" };

  it("a receipt with a stored reference: link, reference and QR on the image", async () => {
    await act(async () => { root.render(<ReceiptCard data={{ ...data, hasRef: true }} />); });
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(host.textContent).toContain("Verify this receipt");
    expect(host.textContent).toContain("kudiai.app/verify");
    expect(host.textContent).toContain("Ref KDT-202610-ABCDEFGH");
    expect(host.querySelector('img[alt="Scan to verify"]')).not.toBeNull();
  });

  it("no stored reference (an old receipt): nothing to verify, so no block", async () => {
    await act(async () => { root.render(<ReceiptCard data={{ ...data, hasRef: false }} />); });
    expect(host.textContent).not.toContain("Verify this receipt");
  });
});

describe("plain PDFs: a reference, the verify footer on the last page, the link when shared", () => {
  const make = () => createReportPdf({
    title: "Credit Payment History", businessName: "Adaeze Fresh Mart", period: "Chidi Okafor", docNoun: "statement",
    verify: { type: "credit_statement", holderName: "Chidi Okafor", fromDate: "2026-10-01", toDate: "2026-10-03",
              summary: [{ label: "Outstanding", value: "₦500.00" }] },
  });

  it("saves the reference with the figures, prints it with the QR on the last page, and shares the link", async () => {
    const pdf = await make();
    expect(mockInserts).toEqual([{ table: "report_verifications", row: {
      report_type: "credit_statement", period_from: "2026-10-01", period_to: "2026-10-03", business_name: "Chidi Okafor",
      summary: [{ label: "Outstanding", value: "₦500.00" }],
    } }]);
    expect(pdf.verifyRef).toBe(REF);
    pdf.addTable([{ key: "a", label: "A", w: 1 }], Array.from({ length: 80 }, (_, i) => ({ a: `row ${i}` })));
    const doc = pdf.getDoc();
    const pages = doc.internal.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    expect(pageTexts(doc, pages)).toEqual(expect.arrayContaining(["Generated by KudiAI Track", "Verify this statement at ", REF, "Scan to verify"]));
    expect(pageTexts(doc, 1).some((x) => /Verify this|Scan to verify/.test(x))).toBe(false);
    await pdf.save("Credit_Payments_Chidi_Okafor.pdf");
    expect(mockSaved[0].opts.shareText).toBe(verifyShareText(REF, "statement"));
  });

  it("offline (no reference saved): still made, with its plain footer and nothing to verify", async () => {
    mockInsertFail = true;
    const pdf = await make();
    expect(pdf.verifyRef).toBe("");
    const t = allTexts(pdf.getDoc());
    expect(t.some((x) => x.startsWith("Verify this"))).toBe(false);
    expect(t.some((x) => x.startsWith("KudiAI Track  ·  Generated"))).toBe(true);
    await pdf.save("x.pdf");
    expect(mockSaved[0].opts.shareText).toBe("");
  });
});

describe("a debt statement", () => {
  it("closes on what is still owed — payments bring a debt down", async () => {
    mockInsertFail = true;
    const pdf = await createReportPdf({ title: "Credit Payment History", businessName: "Adaeze Fresh Mart" });
    pdf.addStatement([{ date: "1 Oct 2026", description: "Payment · cash", reference: "—", debit: "", credit: "five", balance: "forty" }],
      { openingBalance: 45000, totalCredits: 5000, closingBalance: 40000 });
    const t = allTexts(pdf.getDoc());
    expect(t).toContain(fmtCurrency(40000));
    expect(t).not.toContain(fmtCurrency(50000));   // not debt + payments
  });
});

describe("invoices and invoice receipts are verifiable", () => {
  const inv = { invoice_number: "INV-0007", customer_name: "Bola Stores", total_kobo: 1500000, subtotal_kobo: 1500000, amount_paid_kobo: 500000,
                status: "partially_paid", issue_date: "2026-10-01", due_date: "2026-10-15", invoice_items: [] };
  const profile = { business_name: "Adaeze Fresh Mart", phone: "0803 000 0000" };
  const pdfTexts = (b64) => tjTexts(atob(b64));

  it("an invoice: the reference with its figures, the verify panel, the link for sharing", async () => {
    const out = await exportInvoicePdf(inv, profile, {}, { returnBase64: true, withRef: true });
    expect(out.ref).toBe(REF);
    expect(out.shareText).toBe(verifyShareText(REF, "invoice"));
    const row = mockInserts[0].row;
    expect(row).toMatchObject({ report_type: "invoice", period_from: "2026-10-01", period_to: "2026-10-15", business_name: "Adaeze Fresh Mart" });
    expect(row.summary.map((s) => s.label)).toEqual(["Invoice no.", "Customer", "Total due", "Amount paid", "Balance due", "Status"]);
    expect(row.summary[0].value).toBe("INV-0007");
    expect(row.summary[5].value).toBe("PARTIAL");
    const t = pdfTexts(out.base64);
    expect(t).toEqual(expect.arrayContaining(["Verify this invoice", "kudiai.app/verify", REF]));
  });

  it("an invoice receipt is its own kind; the email attachment (base64 only) is unchanged", async () => {
    const out = await exportInvoicePdf({ ...inv, status: "paid", amount_paid_kobo: 1500000 }, profile, {}, { isReceipt: true, returnBase64: true, withRef: true });
    expect(mockInserts[0].row.report_type).toBe("invoice_receipt");
    expect(mockInserts[0].row.summary.map((s) => s.label)).toEqual(["Receipt no.", "Customer", "Total received", "Amount paid", "Status"]);
    expect(pdfTexts(out.base64)).toContain("Verify this receipt");
    expect(typeof (await exportInvoicePdf(inv, profile, {}, { returnBase64: true }))).toBe("string");
  });

  it("downloaded or shared from the app: the link goes with it", async () => {
    await exportInvoicePdf(inv, profile, {});
    expect(mockSaved[0].opts.shareText).toBe(verifyShareText(REF, "invoice"));
  });
});

describe("the PIN voucher sheet: the purchase's reference on its last page", () => {
  const pins = (n) => Array.from({ length: n }, (_, i) => ({ network: "MTN", pin: `12345678901234${String(i).padStart(2, "0")}`, sno: `SN${i}`, amount: 100 }));

  it("under the cards, with the link and the QR", async () => {
    const { doc } = await buildVoucherPdf(pins(6), "Adaeze Fresh Mart", { receiptRef: "KDT-202610-PINS0001" });
    expect(doc.internal.getNumberOfPages()).toBe(1);
    const t = pageTexts(doc, 1);
    expect(t).toEqual(expect.arrayContaining(["Generated by KudiAI Track", "Verify this purchase at ", "kudiai.app/verify", "KDT-202610-PINS0001", "Scan to verify"]));
  });

  it("a full last page: the footer gets a page of its own, never over a card", async () => {
    const { doc } = await buildVoucherPdf(pins(44), "Adaeze Fresh Mart", { receiptRef: "KDT-202610-PINS0001" });
    expect(doc.internal.getNumberOfPages()).toBe(2);
    expect(pageTexts(doc, 2)).toContain("KDT-202610-PINS0001");
    expect(pageTexts(doc, 1)).not.toContain("KDT-202610-PINS0001");
  });

  it("an order without a stored reference: just the cards", async () => {
    const { doc } = await buildVoucherPdf(pins(6), "Adaeze Fresh Mart");
    expect(allTexts(doc).some((x) => x.startsWith("Verify this purchase"))).toBe(false);
  });
});

describe("the verify page words each kind of document", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let host, root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); window.history.replaceState(null, "", "/"); });
  const show = async (result) => {
    mockRpc = jest.fn(async () => ({ data: { found: true, is_report: true, status: "successful", occurred_at: "2026-10-03T10:00:00Z",
      period_from: "2026-10-01", period_to: "2026-10-15", summary: [{ label: "Total due", value: "₦15,000.00" }], ...result }, error: null }));
    window.history.replaceState(null, "", `/verify?ref=${REF}`);
    await act(async () => { root.render(<VerifyReceipt />); });
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    return host.textContent;
  };

  it("an invoice is issued by a business", async () => {
    const text = await show({ kind: "Invoice", doc: "invoice", is_statement: false, business: "Adaeze Fresh Mart" });
    expect(text).toContain("Invoice verified");
    expect(text).toContain("Issued by");
    expect(text).toContain("Figures on the invoice");
  });

  it("a contribution card is a member's", async () => {
    const text = await show({ kind: "Contribution card", doc: "card", is_statement: false, business: "Ngozi Eze" });
    expect(text).toContain("Contribution card verified");
    expect(text).toContain("Member");
  });

  it("an answer from before 'doc' still reads as a statement", async () => {
    const text = await show({ kind: "Wallet statement", is_statement: true, business: "Ngozi Eze" });
    expect(text).toContain("Statement verified");
    expect(text).toContain("Account holder");
  });
});
