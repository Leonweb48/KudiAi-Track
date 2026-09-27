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
