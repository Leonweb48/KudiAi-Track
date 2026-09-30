import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { refFromScan } from "../screens/VerifyReceipt";
import VerifyReceipt from "../screens/VerifyReceipt";

let mockRpc;
jest.mock("../utils/supabase", () => ({ supabase: { rpc: (fn, args) => mockRpc(fn, args) } }));
// BarcodeScanner opens a real camera — stub it so wiring tests only check that VerifyReceipt passes the right onScan
jest.mock("../components/BarcodeScanner", () => (props) => {
  global.__lastScannerProps = props;
  return <button type="button" onClick={() => props.onScan(global.__scanText)}>Scan a QR code instead</button>;
});

describe("refFromScan — making sense of whatever a QR decoded to", () => {
  it("a bare reference is returned as-is", () => {
    expect(refFromScan("KDT-202609-X7K2M9PQ")).toBe("KDT-202609-X7K2M9PQ");
  });
  it("pulls ?ref= out of the verify URL the receipt's own QR encodes", () => {
    expect(refFromScan("https://kudiai.app/verify?ref=KDT-202609-X7K2M9PQ")).toBe("KDT-202609-X7K2M9PQ");
  });
  it("still works with extra query params, a different domain, or http", () => {
    expect(refFromScan("http://www.kudiai.app/verify?utm_source=x&ref=KDT-202609-X7K2M9PQ&foo=1")).toBe("KDT-202609-X7K2M9PQ");
  });
  it("a URL with no ref= falls back to the raw text (so it visibly fails validation rather than silently doing nothing)", () => {
    expect(refFromScan("https://kudiai.app/verify")).toBe("https://kudiai.app/verify");
  });
  it("trims whitespace a scanner might include", () => {
    expect(refFromScan("  KDT-202609-X7K2M9PQ  ")).toBe("KDT-202609-X7K2M9PQ");
  });
  it("garbage / empty input never throws", () => {
    expect(refFromScan("")).toBe("");
    expect(refFromScan(null)).toBe("");
    expect(refFromScan(undefined)).toBe("");
  });
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => {
  mockRpc = jest.fn(async () => ({ data: { found: true, kind: "Wallet transfer", amount: 5000, occurred_at: "2026-09-24T08:00:00Z" }, error: null }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("VerifyReceipt — scanner wiring", () => {
  it("renders the scanner, and a scanned URL fills the field, uppercased, and checks it", async () => {
    global.__scanText = "https://kudiai.app/verify?ref=kdt-202609-x7k2m9pq";
    await act(async () => { root.render(<VerifyReceipt />); });
    const scanBtn = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Scan a QR code"));
    expect(scanBtn).toBeDefined();
    await act(async () => { scanBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
    expect(mockRpc).toHaveBeenCalledWith("verify_receipt", { p_ref: "KDT-202609-X7K2M9PQ" });
    expect(host.querySelector("input").value).toBe("KDT-202609-X7K2M9PQ");
    expect(host.textContent).toMatch(/receipt verified/i);
  });

  it("a scanned bare reference is checked the same way", async () => {
    global.__scanText = "kdt-202609-x7k2m9pq";
    await act(async () => { root.render(<VerifyReceipt />); });
    const scanBtn = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Scan a QR code"));
    await act(async () => { scanBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
    expect(mockRpc).toHaveBeenCalledWith("verify_receipt", { p_ref: "KDT-202609-X7K2M9PQ" });
  });
});

describe("VerifyReceipt — transaction type and status", () => {
  const check = async (answer) => {
    mockRpc = jest.fn(async () => ({ data: { found: true, amount: 100, occurred_at: "2026-09-30T08:00:00Z", business: "Ada Fresh Mart", ...answer }, error: null }));
    await act(async () => { root.render(<VerifyReceipt />); });
    const input = host.querySelector("input");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(input, "KDT-202609-X7K2M9PQ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); });
    const rows = Object.fromEntries([...host.querySelectorAll("div > span:first-child")].map((s) => [s.textContent, s.nextSibling?.textContent]));
    return { rows, banner: host.querySelector('[data-testid="receipt-banner"]').textContent, pill: host.querySelector('[data-testid="receipt-status"]') };
  };

  it("successful: the specific type, a green Successful status, and 'Receipt verified'", async () => {
    const { rows, banner, pill } = await check({ kind: "Airtime purchase", status: "successful" });
    expect(rows["Transaction type"]).toBe("Airtime purchase");
    expect(rows.Status).toBe("Successful");
    expect(pill.style.color).toBe("rgb(22, 101, 52)");
    expect(banner).toMatch(/Receipt verified/);
    expect(banner).toMatch(/completed successfully/);
  });

  it("pending: Pending status, and the banner says not to treat it as paid yet", async () => {
    const { rows, banner } = await check({ kind: "Transfer", status: "pending" });
    expect(rows["Transaction type"]).toBe("Transfer");
    expect(rows.Status).toBe("Pending");
    expect(banner).toMatch(/payment pending/);
    expect(banner).not.toMatch(/Receipt verified/);
    expect(banner).toMatch(/Don't treat it as paid/);
  });

  it("failed: Failed status, and the banner says it is not proof of payment", async () => {
    const { rows, banner, pill } = await check({ kind: "Data purchase", status: "failed" });
    expect(rows.Status).toBe("Failed");
    expect(pill.style.color).toBe("rgb(153, 27, 27)");
    expect(banner).toMatch(/transaction failed/);
    expect(banner).toMatch(/not proof of payment/);
    expect(banner).not.toMatch(/Receipt verified/);
  });

  it("reversed: Reversed status, money returned, not proof of payment", async () => {
    const { rows, banner } = await check({ kind: "Transfer", status: "reversed" });
    expect(rows.Status).toBe("Reversed");
    expect(banner).toMatch(/reversed and the money returned/);
  });

  it("an answer without a status (older server) keeps the old banner and shows no Status row", async () => {
    const { rows, banner, pill } = await check({ kind: "Wallet debit" });
    expect(rows["Transaction type"]).toBe("Wallet debit");
    expect(rows.Status).toBeUndefined();
    expect(pill).toBeNull();
    expect(banner).toMatch(/Receipt verified/);
    expect(banner).toMatch(/This transaction was recorded on KudiAI Track\.$/);
  });

  it("an unknown status word is not dressed up as a status", async () => {
    const { rows, banner } = await check({ kind: "Sale", status: "weird" });
    expect(rows.Status).toBeUndefined();
    expect(banner).toMatch(/Receipt verified/);
  });

  it("business and amount are still shown", async () => {
    const { rows } = await check({ kind: "Sale", status: "successful" });
    expect(rows.Business).toBe("Ada Fresh Mart");
    expect(rows.Amount).toMatch(/100/);
  });
});
