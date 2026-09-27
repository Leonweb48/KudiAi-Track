import { TextEncoder, TextDecoder } from "util";

// jsPDF's PNG decoder needs TextEncoder, which jsdom doesn't provide
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
// eslint-disable-next-line import/first
const { jsPDF } = require("jspdf");
// eslint-disable-next-line import/first
const { renderReceiptPdf } = require("../utils/receiptPdfLayout");
// eslint-disable-next-line import/first
const { buildBillReceipt } = require("../utils/receiptConfig");

// 1x1 opaque PNG — stands in for the QR the browser wrapper would have rendered
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const bill = {
  category: "electricity", amount: 15000, created_at: "2026-09-24T08:12:01Z", bill_status: "success",
  item_name: "IKEDC (Ikeja) Prepaid", meterNo: "12345678901", token: "4821-9034-7712-5560-1183",
  receipt_ref: "KDT-202609-X7K2M9PQ",
};

function render(qr) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const addImage = jest.spyOn(doc, "addImage");
  const data = buildBillReceipt(bill);
  expect(data.hasRef).toBe(true);   // sanity: this test bill really does trigger the verify block
  renderReceiptPdf(doc, data, { qr });
  return { doc, addImage, data };
}

describe("receipt PDF — verify QR code", () => {
  test("a receipt with a reference draws the QR inside the verify box, clear of the text and the box edges", () => {
    const { addImage } = render({ dataUrl: PIXEL });
    const call = addImage.mock.calls.find((c) => c[0] === PIXEL);
    expect(call).toBeDefined();
    const [, , x, y, w, h] = call;
    expect(w).toBe(14); expect(h).toBe(14);            // square, fits inside the 16mm-tall box
    expect(x + w).toBeLessThanOrEqual(192 - 6 + 1e-9);  // clear of the right margin (210 - 18) with a little breathing room
    expect(x).toBeGreaterThan(70);                      // well clear of the "Verify at…" / "Reference:" text on the left
  });

  test("no QR (still loading, generation failed, or a result with no dataUrl) draws nothing extra and never breaks the receipt", () => {
    for (const q of [null, undefined, {}, { dataUrl: "" }]) {
      const { addImage } = render(q);
      expect(addImage).not.toHaveBeenCalled();   // no logo/providerLogo passed either, so any call at all would be the QR
    }
  });

  test("a QR that fails to encode never breaks the receipt", () => {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    jest.spyOn(doc, "addImage").mockImplementation(() => { throw new Error("bad image"); });
    expect(() => renderReceiptPdf(doc, buildBillReceipt(bill), { qr: { dataUrl: PIXEL } })).not.toThrow();
  });

  test("a receipt with no reference shows neither the verify box nor a QR", () => {
    const { addImage, data } = render({ dataUrl: PIXEL });
    void data;
    const noRefBill = { ...bill, receipt_ref: "" };
    const doc2 = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const addImage2 = jest.spyOn(doc2, "addImage");
    renderReceiptPdf(doc2, buildBillReceipt(noRefBill), { qr: { dataUrl: PIXEL } });
    expect(addImage2.mock.calls.find((c) => c[0] === PIXEL)).toBeUndefined();
    expect(addImage.mock.calls.find((c) => c[0] === PIXEL)).toBeDefined();   // contrast: the referenced one really did draw it
  });
});
