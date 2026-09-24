// Browser wrapper for the wallet statement PDF (see walletStatementPdfLayout.js).

import { savePdf } from "./pdfSave";
import { loadPdfAssets, registerNotoSans } from "./pdfAssets";
import { buildStatementEntries, renderWalletStatementPdf } from "./walletStatementPdfLayout";
import { WALLET_TITLES } from "./receiptConfig";
import { watMonthKey } from "./wat";

const titleFor = (source) => WALLET_TITLES[source] || String(source || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * @param rows     wallet_ledger rows for the period (any order)
 * @param business { name, address, phone, account }
 */
export async function generateWalletStatementPdf(rows, business = {}) {
  const [{ jsPDF }, assets] = await Promise.all([import("jspdf"), loadPdfAssets()]);
  const doc  = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const font = registerNotoSans(doc, assets);
  const entries = buildStatementEntries(rows, titleFor);
  renderWalletStatementPdf(doc, { entries, business, generatedAt: new Date() }, { logo: assets.logo, font });
  doc.setProperties({ title: `Wallet statement${business.name ? ` — ${business.name}` : ""}`, subject: "KudiAI Track wallet statement", author: "KudiAI Track · Amaya & Co. Technologies" });
  return { doc, entries };
}

export function walletStatementPdfFilename(entries) {
  const first = entries[0] ? watMonthKey(entries[0].at) : "";
  const last  = entries.length ? watMonthKey(entries[entries.length - 1].at) : "";
  const span  = first && last ? (first === last ? first : `${first}_to_${last}`) : "empty";
  return `wallet_statement_${span}.pdf`;
}

/** Build the statement PDF and hand it to the platform (download on web, share sheet on native). */
export async function saveWalletStatementPdf(rows, business = {}) {
  const { doc, entries } = await generateWalletStatementPdf(rows, business);
  await savePdf(doc, walletStatementPdfFilename(entries));
}
