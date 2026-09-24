// Browser wrapper for the receipt PDF: loads jsPDF (lazily — it is large), the
// logo and NotoSans, lays the receipt out as real vector text, and saves/shares it.
// The layout itself lives in receiptPdfLayout.js.

import { savePdf } from "./pdfSave";
import { loadPdfAssets, registerNotoSans } from "./pdfAssets";
import { renderReceiptPdf } from "./receiptPdfLayout";

export async function generateReceiptPdf(data) {
  const [{ jsPDF }, assets] = await Promise.all([import("jspdf"), loadPdfAssets()]);
  const doc  = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const font = registerNotoSans(doc, assets);
  renderReceiptPdf(doc, data, { logo: assets.logo, font });
  doc.setProperties({
    title:   `${data.title || "Receipt"}${data.hasRef && data.receiptRef ? ` — ${data.receiptRef}` : ""}`,
    subject: "KudiAI Track transaction receipt",
    author:  "KudiAI Track · Amaya & Co. Technologies",
  });
  return doc;
}

/** Build the receipt PDF and hand it to the platform (download on web, share sheet on native). */
export async function saveReceiptPdf(data) {
  const doc = await generateReceiptPdf(data);
  await savePdf(doc, data.filenames?.pdf || "receipt.pdf");
}
