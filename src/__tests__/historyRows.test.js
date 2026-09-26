import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { TextEncoder, TextDecoder } from "util";

// WalletPanel pulls in the wallet UI's data layer; nothing here needs a real client
jest.mock("../utils/supabase", () => ({ supabase: { from: () => ({}), functions: { invoke: () => Promise.resolve({}) } } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
// AmountDisplay measures itself with a ResizeObserver, which jsdom does not have
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
// eslint-disable-next-line import/first
const { walletEntry, txEntry, billVisual, tidyName, statusOf, networkFromText } = require("../utils/historyEntries");
// eslint-disable-next-line import/first
const { formatWATStamp } = require("../utils/wat");
// eslint-disable-next-line import/first
const { buildTransactionReceipt } = require("../utils/receiptConfig");
// eslint-disable-next-line import/first
const { WalletTxRow } = require("../components/WalletPanel");
// eslint-disable-next-line import/first
const { TxRow } = require("../components/shared/TxRow");

const AT = "2026-09-26T07:23:00Z";                    // 8:23:00 AM WAT — the time in the OPay sample
const ledger = (o) => ({ id: "l1", direction: "debit", source: "withdrawal", status: "completed", amount_kobo: 500000, created_at: AT, ...o });
const field = (r, label) => r.fields.find((f) => f.label === label);

describe("formatWATStamp — the OPay-style stamp", () => {
  test("Sep 26th, 8:23:00 AM (WAT, with seconds, no year)", () => {
    expect(formatWATStamp("2026-09-26T07:23:00Z")).toBe("Sep 26th, 8:23:00 AM");
    expect(formatWATStamp("2026-09-25T21:44:10Z")).toBe("Sep 25th, 10:44:10 PM");
  });
  test("ordinals", () => {
    const day = (d) => formatWATStamp(`2026-09-${String(d).padStart(2, "0")}T10:00:00Z`).split(",")[0];
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30].map(day)).toEqual(
      ["Sep 1st", "Sep 2nd", "Sep 3rd", "Sep 4th", "Sep 11th", "Sep 12th", "Sep 13th", "Sep 21st", "Sep 22nd", "Sep 23rd", "Sep 30th"]);
  });
  test("midnight and noon, and the WAT day rolling over", () => {
    expect(formatWATStamp("2026-09-25T23:05:09Z")).toBe("Sep 26th, 12:05:09 AM");
    expect(formatWATStamp("2026-09-26T11:00:00Z")).toBe("Sep 26th, 12:00:00 PM");
  });
  test("a date-only value shows the day, never an invented time; junk shows a dash", () => {
    expect(formatWATStamp("2026-09-24")).toBe("Sep 24th");
    expect(formatWATStamp("not a date")).toBe("—");
  });
});

describe("tidyName / networkFromText / statusOf", () => {
  test("a shouted name is tidied, a mixed-case one is left alone", () => {
    expect(tidyName("ADA OBI")).toBe("Ada Obi");
    expect(tidyName("O'NEIL MARY-ANN")).toBe("O'Neil Mary-Ann");
    expect(tidyName("Nellobyte-SOL")).toBe("Nellobyte-SOL");
    expect(tidyName("")).toBe("");
    expect(tidyName(null)).toBe("");
  });
  test("networks", () => {
    expect(networkFromText("MTN Airtime")).toBe("MTN");
    expect(networkFromText("airtel 1GB data")).toBe("Airtel");
    expect(networkFromText("Glo Data 5GB")).toBe("Glo");
    expect(networkFromText("9mobile")).toBe("9mobile");
    expect(networkFromText("Global Traders")).toBeNull();
  });
  test("status pills", () => {
    expect(statusOf("completed")).toMatchObject({ label: "Successful", tone: "ok" });
    expect(statusOf("pending", true).label).toBe("Pending");
    expect(statusOf("pending", false).label).toBe("Processing");
    expect(statusOf("reversed")).toMatchObject({ label: "Reversed", tone: "muted" });
    expect(statusOf("failed")).toMatchObject({ label: "Failed", tone: "failed" });
  });
});

describe("walletEntry — transfers and deposits", () => {
  const wd = (o) => ({ account_name: "ADA OBI", account_number: "0123456789", bank_code: "058", ...o });

  test("a transfer names who it went to and shows their bank's logo, with an 'out' badge", () => {
    const e = walletEntry(ledger(), { withdrawal: wd(), recipientBankName: "Guaranty Trust Bank" });
    expect(e.title).toBe("Transfer to Ada Obi");
    expect(e.avatar).toMatchObject({ logoUrl: "/logos/banks/gtbank.png", name: "Guaranty Trust Bank", dir: "out" });
    expect(e.status.label).toBe("Successful");
  });
  test("a fintech recipient (Flutterwave's code) gets its logo", () => {
    const e = walletEntry(ledger(), { withdrawal: wd({ bank_code: "100004" }), recipientBankName: "OPay Digital Services Limited (OPay)" });
    expect(e.avatar).toMatchObject({ logoUrl: "/logos/banks/opay.png", name: "OPay" });
  });
  test("a bank without a logo falls back to the arrow, still named in the title", () => {
    const e = walletEntry(ledger(), { withdrawal: wd({ bank_code: "51364" }), recipientBankName: "Hayat Trust MFB" });
    expect(e.title).toBe("Transfer to Ada Obi");
    expect(e.avatar).toMatchObject({ logoUrl: null, icon: "up", dir: null });
  });
  test("a transfer with no details yet is just 'Transfer' with the up arrow", () => {
    const e = walletEntry(ledger(), {});
    expect(e.title).toBe("Transfer");
    expect(e.avatar).toMatchObject({ logoUrl: null, icon: "up" });
  });
  test("a deposit names who paid and shows their bank, with an 'in' badge", () => {
    const e = walletEntry(ledger({ source: "topup", direction: "credit" }), { originator: "CHIDI OKEKE", originatorBank: "WEMA BANK PLC" });
    expect(e.title).toBe("Transfer from Chidi Okeke");
    expect(e.avatar).toMatchObject({ logoUrl: "/logos/banks/wema.png", name: "Wema Bank", dir: "in" });
  });
  test("an older deposit (no bank stored) keeps the down arrow; with no payer it is 'Wallet funding'", () => {
    expect(walletEntry(ledger({ source: "topup", direction: "credit" }), { originator: "CHIDI OKEKE" }).avatar).toMatchObject({ logoUrl: null, icon: "down" });
    expect(walletEntry(ledger({ source: "topup", direction: "credit" }), {}).title).toBe("Wallet funding");
  });
  test("a payment received names the payer", () => {
    const e = walletEntry(ledger({ source: "sale", direction: "credit" }), { request: { customer_name: "Mama Ade" }, originatorBank: "ACCESS" });
    expect(e.title).toBe("Payment from Mama Ade");
    expect(e.avatar.logoUrl).toBe("/logos/banks/access.png");
  });
  test("the sources the wallet already labelled keep their label and sign; fees get the % icon", () => {
    expect(walletEntry(ledger({ source: "peer_esusu_contribution" })).title).toBe("Circle contribution");
    expect(walletEntry(ledger({ source: "ajo_collection", direction: "credit" })).title).toBe("Contribution received");
    expect(walletEntry(ledger({ source: "transfer_fee" }))).toMatchObject({ title: "Transfer fee", avatar: { icon: "percent" } });
    expect(walletEntry(ledger({ source: "adjustment" })).avatar.icon).toBe("wallet");
  });
  test("status follows the row", () => {
    expect(walletEntry(ledger({ status: "pending" })).status.label).toBe("Processing");
    expect(walletEntry(ledger({ status: "pending", direction: "credit", source: "ajo_payout" })).status.label).toBe("Pending");
    expect(walletEntry(ledger({ status: "reversed" })).status.label).toBe("Reversed");
    expect(walletEntry(ledger({ status: "pending" })).avatar.tone).toBe("pending");
  });
});

describe("walletEntry — bill payments from the wallet", () => {
  const bill = (narration, source = "bill_spend") => walletEntry(ledger({ source, narration }), {});

  test("airtime: the network's logo, titled without the phone number", () => {
    const e = bill("MTN Airtime — 08031234567");
    expect(e.title).toBe("MTN Airtime");
    expect(e.avatar).toMatchObject({ logoUrl: "/mtn.png", icon: "phone", dir: null });
  });
  test("data", () => {
    expect(bill("Glo Data 5GB").avatar.logoUrl).toBe("/glo.jpg");
    expect(bill("MTN 1GB").avatar.logoUrl).toBe("/mtn.png");
  });
  test("electricity: the DISCO's logo and the bulb", () => {
    const e = bill("IKEDC Prepaid Electricity");
    expect(e.avatar.logoUrl).toMatch(/electricity%20logos\/ikedc/);
    expect(e.avatar.icon).toBe("bulb");
  });
  test("cable and betting", () => {
    expect(bill("DStv Compact").avatar).toMatchObject({ logoUrl: "/logos/bills/dstv.png", icon: "tv" });
    expect(bill("SportyBet Wallet Top-up").avatar.logoUrl).toBe("/logos/bills/sportybet.png");
    expect(bill("Spectranet 20GB").avatar.logoUrl).toBe("/logos/bills/spectranet.png");
  });
  test("no recognisable provider → the category icon, or the generic bills icon", () => {
    expect(bill("Airtime top-up").avatar).toMatchObject({ logoUrl: null, icon: "phone" });
    expect(bill("Something else").avatar).toMatchObject({ logoUrl: null, icon: "bills" });
    expect(bill("").title).toBe("Bill payment");
  });
  test("a refund says what it refunds", () => {
    const e = bill("DStv Compact", "bill_reversal");
    expect(e.title).toBe("Refund: DStv Compact");
    expect(e.direction).toBe("out");   // (the row's own direction decides the sign; this test row is a debit)
  });
  test("billVisual takes a stored record too (the webhook's raw codes)", () => {
    expect(billVisual({ record: { category: "cable", item_name: "gotv Max", note: "Provider: gotv" } }).logoUrl).toBe("/logos/bills/gotv.png");
    expect(billVisual({ record: { category: "betting", item_name: "product-bang-bet Wallet" } }).logoUrl).toBe("/logos/bills/bangbet.png");
    expect(billVisual({ record: { category: "electricity", item_name: "08 Electric" } }).logoUrl).toMatch(/kaedc/);
  });
});

describe("txEntry — the general history", () => {
  const tx = (o) => ({ type: "out", payment_type: "bill_payment", amount: 500, created_at: AT, ...o });

  test("bills carry their provider's logo, from any shape of record", () => {
    expect(txEntry(tx({ category: "airtime", item_name: "MTN Airtime", note: "Phone: 0803 | Network: MTN" })).bill.logoUrl).toBe("/mtn.png");
    expect(txEntry(tx({ category: "electricity", item_name: "IKEDC Prepaid Electricity" })).bill.logoUrl).toMatch(/ikedc/);
    expect(txEntry(tx({ category: "electricity", item_name: "08 Electric" })).bill.logoUrl).toMatch(/kaedc/);     // webhook: a company code
    expect(txEntry(tx({ category: "cable", item_name: "gotv Max", note: "Provider: gotv | Smartcard: 1" })).bill.logoUrl).toBe("/logos/bills/gotv.png");
    expect(txEntry(tx({ category: "betting", item_name: "product-bang-bet Wallet" })).bill.logoUrl).toBe("/logos/bills/bangbet.png");
    expect(txEntry(tx({ category: "waec", item_name: "WAEC Direct" })).bill.logoUrl).toBe("/logos/bills/waec.png");
  });
  test("a bill with no known provider still gets its category icon", () => {
    expect(txEntry(tx({ category: "electricity", item_name: "Electric" })).bill).toMatchObject({ logoUrl: null, icon: "bulb" });
    expect(txEntry(tx({ category: "cable", item_name: "Cable" })).bill).toMatchObject({ logoUrl: null, icon: "tv" });
  });
  test("a sale or an expense is not a bill", () => {
    expect(txEntry({ type: "in", category: "sale", payment_type: "cash", item_name: "Rice", amount: 1 }).bill).toBeNull();
    expect(txEntry({ type: "out", category: "expense", payment_type: "cash", item_name: "Rent", amount: 1 }).bill).toBeNull();
    expect(txEntry({ type: "in", category: "airtime", payment_type: "cash", item_name: "Sold airtime", amount: 1 }).bill).toBeNull();
  });
  test("status", () => {
    expect(txEntry(tx({ category: "airtime" })).status.label).toBe("Successful");
    expect(txEntry(tx({ category: "airtime", bill_status: "failed" })).status.label).toBe("Failed");
    expect(txEntry({ type: "in", category: "sale", _pending: true }).status.label).toBe("Pending");
  });
});

describe("a bill opened from the general history is the SAME receipt as on the Bills page", () => {
  const profile = { business_name: "Adaeze Fresh Mart", business_address: "12 Allen Avenue", business_phone: "0803" };
  const base = { type: "out", payment_type: "bill_payment", amount: 15700, created_at: AT, transaction_date: "2026-09-26" };

  test("cable recorded by the webhook: the provider's logo, a proper name, the smartcard", () => {
    const r = buildTransactionReceipt({ ...base, category: "cable", item_name: "gotv Max", note: "Provider: gotv | Smartcard: 9876543210" }, profile);
    expect(r.category).toBe("cable");
    expect(r.provider).toBe("GOtv");
    expect(field(r, "Provider").value).toBe("GOtv");
    expect(field(r, "Smartcard No.").value).toBe("9876543210");
    expect(r.businessName).toBe("Adaeze Fresh Mart");
  });
  test("airtime: network, phone and the provider reference come from the note", () => {
    const r = buildTransactionReceipt({ ...base, category: "airtime", item_name: "MTN Airtime", note: "Phone: 08031234567 | Network: MTN | Ref: ABC123" }, profile);
    expect(r.provider).toBe("MTN");
    expect(field(r, "Phone").value).toBe("08031234567");
    expect(field(r, "Provider Ref.").value).toBe("ABC123");
  });
  test("electricity: the token and the DISCO", () => {
    const r = buildTransactionReceipt({ ...base, category: "electricity", item_name: "IKEDC (Ikeja) Prepaid",
      note: "Token: 4821-9034 | Meter: 45023918476 | Type: Prepaid | Provider: IKEDC (Ikeja) | Phone: 0803" }, profile);
    expect(r.provider).toBe("IKEDC");
    expect(field(r, "Token").value).toBe("4821-9034");
    expect(field(r, "Meter No.").value).toBe("45023918476");
  });
  test("who served, and a pending row", () => {
    const r = buildTransactionReceipt({ ...base, category: "data", item_name: "MTN 1GB Data", staff_name: "Tunde", _pending: true, note: "Network: MTN" }, profile);
    expect(field(r, "Served by").value).toBe("Tunde");
    expect(r.status).toBe("pending");
  });
  test("a sale is unchanged", () => {
    const r = buildTransactionReceipt({ type: "in", payment_type: "cash", category: "sale", amount: 500, item_name: "Rice", created_at: AT }, profile);
    expect(r.title).toBe("Rice");
    expect(r.provider).toBeUndefined();
    expect(r.category).toBeUndefined();
  });
});

describe("the rows", () => {
  let host, root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const render = (el) => act(() => { root.render(el); });

  test("a wallet transfer row reads like the OPay list: logo, 'Transfer to NAME', the stamp, −amount, Successful", () => {
    const row = ledger();
    const entry = walletEntry(row, { withdrawal: { account_name: "ADA OBI", bank_code: "058" }, recipientBankName: "Guaranty Trust Bank" });
    render(<WalletTxRow row={row} entry={entry} />);
    expect(host.querySelector('img[src="/logos/banks/gtbank.png"]')).not.toBeNull();
    expect(host.textContent).toContain("Transfer to Ada Obi");
    expect(host.textContent).toContain("Sep 26th, 8:23:00 AM");
    expect(host.textContent).toContain("−₦5,000.00");
    expect(host.textContent).toContain("Successful");
  });
  test("a deposit row: +amount, and the sender", () => {
    const row = ledger({ source: "topup", direction: "credit", amount_kobo: 29200000 });
    render(<WalletTxRow row={row} entry={walletEntry(row, { originator: "SOLOMON JOHN", originatorBank: "WEMA BANK PLC" })} />);
    expect(host.textContent).toContain("Transfer from Solomon John");
    expect(host.textContent).toContain("+₦292,000.00");
    expect(host.querySelector('img[src="/logos/banks/wema.png"]')).not.toBeNull();
  });
  test("a row without an entry still renders from the ledger row alone; a hidden balance hides the amount", () => {
    render(<WalletTxRow row={ledger()} hidden />);
    expect(host.textContent).toContain("Transfer");
    expect(host.textContent).toContain("••••");
    expect(host.textContent).not.toContain("5,000");
  });
  test("a pending debit says Processing (unchanged)", () => {
    render(<WalletTxRow row={ledger({ status: "pending" })} />);
    expect(host.textContent).toContain("Processing");
  });

  test("the general history: a bill row shows the provider's logo, the stamp, the signed amount and the pill", () => {
    render(<TxRow tx={{ id: "1", type: "out", category: "airtime", payment_type: "bill_payment", item_name: "MTN Airtime", note: "Network: MTN", amount: 5000, created_at: AT, transaction_date: "2026-09-26" }} />);
    expect(host.querySelector('img[src="/mtn.png"]')).not.toBeNull();
    expect(host.textContent).toContain("MTN Airtime");
    expect(host.textContent).toContain("Sep 26th, 8:23:00 AM");
    expect(host.textContent).toContain("−₦5,000.00");
    expect(host.textContent).toContain("Successful");
  });
  test("a sale row keeps its arrow (no logo) and reads +amount; date-only rows show just the day", () => {
    render(<TxRow tx={{ id: "2", type: "in", category: "sale", payment_type: "cash", item_name: "Rice", amount: 1200, transaction_date: "2026-09-24" }} />);
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("+₦1,200.00");
    expect(host.textContent).toContain("Sep 24th");
    expect(host.textContent).not.toMatch(/\d:\d\d/);
  });
  test("the Transactions variant carries the same logo and pill; a failed bill says Failed", () => {
    render(<TxRow variant="transactions" tx={{ id: "3", type: "out", category: "cable", payment_type: "bill_payment", item_name: "DSTV Compact", amount: 15700, created_at: AT, bill_status: "failed" }} />);
    expect(host.querySelector('img[src="/logos/bills/dstv.png"]')).not.toBeNull();
    expect(host.textContent).toContain("Failed");
    expect(host.textContent).toContain("Sep 26th, 8:23:00 AM");
  });
});
