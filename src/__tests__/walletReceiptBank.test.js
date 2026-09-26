import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { TextEncoder, TextDecoder } from "util";

// html2canvas paints pixels jsdom cannot — stand in for it and keep the element it was asked to draw.
// (A plain function, not jest.fn: CRA's jest config resets mock implementations between tests.)
jest.mock("html2canvas", () => async (el) => { globalThis.__captured = el; return { fake: true }; });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
// eslint-disable-next-line import/first
const { jsPDF } = require("jspdf");
// eslint-disable-next-line import/first
const { buildWalletReceipt, buildBillReceipt, buildTransactionReceipt } = require("../utils/receiptConfig");
// eslint-disable-next-line import/first
const { renderReceiptPdf } = require("../utils/receiptPdfLayout");
// eslint-disable-next-line import/first
const { ReceiptCard } = require("../components/shared/ReceiptCard");
// eslint-disable-next-line import/first
const { captureReceiptCanvas } = require("../utils/captureReceipt");

const AT = "2026-09-24T09:12:01Z";
const ledger = (o) => ({ id: "l1", direction: "debit", status: "completed", amount_kobo: 500000, balance_after_kobo: 1234500, created_at: AT, receipt_ref: "KDT-202609-ABCD2345", ...o });
const field = (r, label) => r.fields.find((f) => f.label === label);
const BAL = "₦12,345.00";

describe("wallet transfer — the bank it went to", () => {
  const base = { businessName: "Adaeze Fresh Mart", ownerName: "Adaeze Okafor" };

  test("a bank with a logo: named in the recipient row, on the header, with its logo", () => {
    const r = buildWalletReceipt(ledger({ source: "withdrawal" }), { ...base, recipientBankName: "Guaranty Trust Bank",
      withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "058" } });
    expect(r.counterparty).toEqual({ role: "recipient", bank: "Guaranty Trust Bank", logoUrl: "/logos/banks/gtbank.png", initials: "GT" });
    expect(field(r, "Recipient Details").value).toBe("ADA OBI\nGuaranty Trust Bank  •  0123456789");
  });
  test("the code alone still finds the logo (the bank list may not have loaded)", () => {
    const r = buildWalletReceipt(ledger({ source: "withdrawal" }), { ...base, withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "044" } });
    expect(r.counterparty.logoUrl).toBe("/logos/banks/access.png");
    expect(r.counterparty.bank).toBe("Access Bank");
  });
  test("a fintech gets its logo and a short name, whichever provider's code / spelling the list used", () => {
    const r = buildWalletReceipt(ledger({ source: "withdrawal" }), { ...base, recipientBankName: "OPay Digital Services Limited (OPay)",
      withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "100004" } });
    expect(r.counterparty).toEqual({ role: "recipient", bank: "OPay", logoUrl: "/logos/banks/opay.png", initials: "OP" });
    expect(field(r, "Recipient Details").value).toBe("ADA OBI\nOPay  •  0123456789");
    // the bank list may not have loaded — the code alone is enough
    const m = buildWalletReceipt(ledger({ source: "withdrawal" }), { ...base, withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "090405" } });
    expect(m.counterparty).toMatchObject({ bank: "Moniepoint", logoUrl: "/logos/banks/moniepoint.png" });
  });
  test("a bank we have no logo for is still NAMED — with no logo", () => {
    const r = buildWalletReceipt(ledger({ source: "withdrawal" }), { ...base, recipientBankName: "Hayat Trust MFB",
      withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "51364" } });
    expect(r.counterparty).toEqual({ role: "recipient", bank: "Hayat Trust MFB", logoUrl: null, initials: "HT" });
    expect(field(r, "Recipient Details").value).toContain("Hayat Trust MFB");
  });
  test("a bare unknown code is not invented into a bank name (the row keeps showing the code as before)", () => {
    const r = buildWalletReceipt(ledger({ source: "withdrawal" }), { ...base, withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "090999" } });
    expect(r.counterparty).toBeNull();
    expect(field(r, "Recipient Details").value).toBe("ADA OBI\n090999  •  0123456789");
  });
  test("a transfer reversal has no bank header", () => {
    const r = buildWalletReceipt(ledger({ source: "withdrawal_reversal", direction: "credit" }), { ...base, withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "058" } });
    expect(r.counterparty).toBeNull();
  });
});

describe("wallet deposit — the bank it came from", () => {
  const base = { businessName: "Adaeze Fresh Mart", walletAccountNumber: "9876543210" };

  test("funding: the sender's bank, written our way, with its logo", () => {
    const r = buildWalletReceipt(ledger({ source: "topup", direction: "credit" }), { ...base, originator: "CHIDI OKEKE", originatorBank: "WEMA BANK PLC" });
    expect(r.counterparty).toEqual({ role: "sender", bank: "Wema Bank", logoUrl: "/logos/banks/wema.png", initials: "WE" });
    expect(field(r, "Sender Details").value).toBe("CHIDI OKEKE\nWema Bank");
  });
  test("funding from a fintech: its logo and short name", () => {
    const r = buildWalletReceipt(ledger({ source: "topup", direction: "credit" }), { ...base, originator: "CHIDI OKEKE", originatorBank: "KUDA MICROFINANCE BANK" });
    expect(r.counterparty).toEqual({ role: "sender", bank: "Kuda Bank", logoUrl: "/logos/banks/kuda.png", initials: "KU" });
  });
  test("funding from a bank with no logo still names the bank", () => {
    const r = buildWalletReceipt(ledger({ source: "topup", direction: "credit" }), { ...base, originator: "CHIDI OKEKE", originatorBank: "HAYAT TRUST MFB" });
    expect(r.counterparty).toEqual({ role: "sender", bank: "Hayat Trust MFB", logoUrl: null, initials: "HT" });
  });
  test("an older deposit (no bank stored) is unchanged", () => {
    const r = buildWalletReceipt(ledger({ source: "topup", direction: "credit" }), { ...base, originator: "CHIDI OKEKE" });
    expect(r.counterparty).toBeNull();
    expect(field(r, "Sender Details").value).toBe("CHIDI OKEKE");
  });
  test("a payment received names the payer's bank too", () => {
    const r = buildWalletReceipt(ledger({ source: "sale", direction: "credit" }), { ...base, request: { customer_name: "Mama Ade" }, originatorBank: "ACCESS" });
    expect(field(r, "Sender Details").value).toBe("Mama Ade\nAccess Bank");
    expect(r.counterparty.logoUrl).toBe("/logos/banks/access.png");
  });
  test("a bill payment has no bank on the other side", () => {
    expect(buildWalletReceipt(ledger({ source: "bill_spend" }), base).counterparty).toBeNull();
  });
});

describe("the running balance never leaves the app (bill + wallet receipts)", () => {
  test("wallet receipts flag their balance row private, for every source", () => {
    for (const source of ["withdrawal", "topup", "sale", "bill_spend", "bill_reversal", "subscription_spend", "adjustment"]) {
      const r = buildWalletReceipt(ledger({ source, direction: source === "topup" || source === "sale" || source === "bill_reversal" ? "credit" : "debit" }), { businessName: "B" });
      expect(field(r, "Account balance after")).toMatchObject({ private: true });
      expect(r.hideBalanceOnShare).toBe(true);
      expect(r.balanceAfter).toBe(12345);            // still there for the in-app view
    }
  });
  test("bill receipts too — and a bill booked as an expense; an ordinary sale keeps its balance", () => {
    const bill = buildBillReceipt({ category: "airtime", amount: 500, network: "MTN", bill_status: "success", created_at: AT, balance_after: 12345 });
    expect(field(bill, "Balance After")).toMatchObject({ private: true });
    expect(bill.hideBalanceOnShare).toBe(true);

    const billTxn = buildTransactionReceipt({ type: "out", payment_type: "bill_payment", amount: 500, item_name: "MTN Airtime", created_at: AT, balance_after: 12345 });
    expect(field(billTxn, "Balance After").private).toBe(true);
    expect(billTxn.hideBalanceOnShare).toBe(true);

    const sale = buildTransactionReceipt({ type: "in", payment_type: "cash", amount: 500, item_name: "Rice", created_at: AT, balance_after: 12345 });
    expect(field(sale, "Balance After").private).toBeFalsy();
    expect(sale.hideBalanceOnShare).toBe(false);
  });
});

// every string the PDF layout prints
function pdfText(spec) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const printed = [];
  const text = doc.text.bind(doc);
  doc.text = (t, ...rest) => { printed.push(...[].concat(t).map(String)); return text(t, ...rest); };
  renderReceiptPdf(doc, spec);
  return printed.join(" | ");
}

describe("the PDF", () => {
  const walletSpec = buildWalletReceipt(ledger({ source: "withdrawal" }), { businessName: "Adaeze Fresh Mart", recipientBankName: "Guaranty Trust Bank",
    withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "058" } });

  test("a wallet receipt PDF names the bank but prints no balance", () => {
    const t = pdfText(walletSpec);
    expect(t).toContain("Guaranty Trust Bank");
    expect(t).not.toMatch(/balance/i);
    expect(t).not.toContain("12,345.00");
  });
  test("a bill receipt PDF prints no balance", () => {
    const t = pdfText(buildBillReceipt({ category: "airtime", amount: 500, network: "MTN", bill_status: "success", created_at: AT, balance_after: 12345 }));
    expect(t).not.toMatch(/balance/i);
    expect(t).not.toContain("12,345.00");
  });
  test("an ordinary sale receipt still prints its balance", () => {
    const t = pdfText(buildTransactionReceipt({ type: "in", payment_type: "cash", amount: 500, item_name: "Rice", created_at: AT, balance_after: 12345 }));
    expect(t).toMatch(/balance after/i);
    expect(t).toContain("12,345.00");
  });
});

describe("the card and the shared image", () => {
  let host, root;
  beforeEach(() => {
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, "complete", { get: () => true, configurable: true });
    globalThis.__captured = null;
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const spec = buildWalletReceipt(ledger({ source: "withdrawal" }), { businessName: "Adaeze Fresh Mart", recipientBankName: "Guaranty Trust Bank",
    withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "058" } });

  test("the card shows the bank's logo and who it went to, and keeps the balance for the app", () => {
    act(() => root.render(<ReceiptCard data={spec} />));
    const img = host.querySelector('img[src="/logos/banks/gtbank.png"]');
    expect(img).not.toBeNull();
    expect(host.textContent).toContain("Sent to Guaranty Trust Bank");
    expect(host.textContent).toContain("Account balance after");
    expect(host.textContent).toContain(BAL);
  });
  test("a bank without a logo gets an initials tile and the same caption", () => {
    const opay = buildWalletReceipt(ledger({ source: "withdrawal" }), { businessName: "B", recipientBankName: "Hayat Trust MFB",
      withdrawal: { account_name: "ADA OBI", account_number: "0123456789", bank_code: "51364" } });
    act(() => root.render(<ReceiptCard data={opay} />));
    expect(host.querySelector('img[src^="/logos/banks/"]')).toBeNull();
    expect(host.textContent).toContain("HT");
    expect(host.textContent).toContain("Sent to Hayat Trust MFB");
  });
  test("a deposit card says who it was received from", () => {
    const dep = buildWalletReceipt(ledger({ source: "topup", direction: "credit" }), { businessName: "B", originator: "CHIDI OKEKE", originatorBank: "WEMA BANK PLC" });
    act(() => root.render(<ReceiptCard data={dep} />));
    expect(host.textContent).toContain("Received from Wema Bank");
    expect(host.querySelector('img[src="/logos/banks/wema.png"]')).not.toBeNull();
  });
  test("the shared IMAGE drops the private rows; the on-screen card keeps them", async () => {
    const ref = React.createRef();
    act(() => root.render(<ReceiptCard data={spec} innerRef={ref} />));
    await captureReceiptCanvas(ref.current);
    const shared = globalThis.__captured.outerHTML;
    expect(shared).not.toContain("Account balance after");
    expect(shared).not.toContain(BAL);
    expect(shared).toContain("Recipient Details");            // everything else is there
    expect(shared).toContain("Guaranty Trust Bank");
    expect(host.textContent).toContain("Account balance after");   // the live card is untouched
    expect(host.textContent).toContain(BAL);
  });
});
