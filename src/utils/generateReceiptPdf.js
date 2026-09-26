// Browser wrapper for the receipt PDF: loads jsPDF (lazily — it is large), the
// logo and NotoSans, lays the receipt out as real vector text, and saves/shares it.
// The layout itself lives in receiptPdfLayout.js.

import { savePdf } from "./pdfSave";
import { loadPdfAssets, registerNotoSans, loadImageAsset } from "./pdfAssets";
import { renderReceiptPdf } from "./receiptPdfLayout";
import { discoFromText, electricityLogoUrl } from "./electricityLogos";

export async function generateReceiptPdf(data) {
  // An electricity receipt carries its DISCO's logo (public/logos/electricity logos/)
  const discoLogoUrl = data.category === "electricity" ? electricityLogoUrl(discoFromText(data.provider)) : null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [{ jsPDF }, assets, providerLogo] = await Promise.all([
    import("jspdf"), loadPdfAssets(), discoLogoUrl ? loadImageAsset(origin + discoLogoUrl) : Promise.resolve(null),
  ]);
  const doc  = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const font = registerNotoSans(doc, assets);
  renderReceiptPdf(doc, data, { logo: assets.logo, providerLogo, font });
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
