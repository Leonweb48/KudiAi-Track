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

// 1x1 opaque PNG — stands in for a DISCO logo the browser wrapper loaded and re-encoded
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const bill = {
  category: "electricity", amount: 15000, created_at: "2026-09-24T08:12:01Z", bill_status: "success",
  item_name: "IKEDC (Ikeja) Prepaid", meterNo: "12345678901", token: "4821-9034-7712-5560-1183",
};

function render(providerLogo) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const addImage = jest.spyOn(doc, "addImage");
  renderReceiptPdf(doc, buildBillReceipt(bill), { providerLogo });
  return { doc, addImage };
}

describe("receipt PDF — electricity provider logo", () => {
  test("a receipt with a provider logo draws it right-aligned in the title row, inside a 38 x 16 mm box", () => {
    const { addImage } = render({ dataUrl: PIXEL, w: 200, h: 150 });   // a 4:3 logo, like the DISCO jpgs
    const call = addImage.mock.calls.find((c) => c[0] === PIXEL);
    expect(call).toBeDefined();
    const [, , x, y, w, h] = call;
    expect(x + w).toBeCloseTo(192, 5);            // right margin (210 - 18)
    expect(w).toBeLessThanOrEqual(38 + 1e-9);
    expect(h).toBeLessThanOrEqual(16 + 1e-9);
    expect(w / h).toBeCloseTo(200 / 150, 5);      // aspect ratio preserved
    expect(y).toBeGreaterThan(30);                // below the coloured header band…
    expect(y + h).toBeLessThan(60);               // …and clear of the amount box
  });

  test("a wide logo is limited by width, a tall one by height", () => {
    const wide = render({ dataUrl: PIXEL, w: 400, h: 100 }).addImage.mock.calls.find((c) => c[0] === PIXEL);
    expect(wide[4]).toBeCloseTo(38, 5);
    const tall = render({ dataUrl: PIXEL, w: 100, h: 400 }).addImage.mock.calls.find((c) => c[0] === PIXEL);
    expect(tall[5]).toBeCloseTo(16, 5);
  });

  test("no provider logo (or an unusable one) draws nothing extra and still renders", () => {
    for (const p of [null, undefined, { dataUrl: PIXEL, w: 0, h: 0 }]) {
      const { addImage } = render(p);
      expect(addImage.mock.calls.find((c) => c[0] === PIXEL)).toBeUndefined();
    }
  });

  test("a logo that fails to encode never breaks the receipt", () => {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    jest.spyOn(doc, "addImage").mockImplementation(() => { throw new Error("bad image"); });
    expect(() => renderReceiptPdf(doc, buildBillReceipt(bill), { providerLogo: { dataUrl: "nope", w: 10, h: 10 } })).not.toThrow();
  });
});
