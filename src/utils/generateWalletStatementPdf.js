// Browser wrapper for the wallet statement PDF — the owner's and a client's (layout: statementPdfLayout.js). The
// statement carries a KDR reference + QR code so whoever holds it can check it at kudiai.app/verify.

import { savePdf } from "./pdfSave";
import { loadPdfAssets, registerNotoSans } from "./pdfAssets";
import { registerStatement } from "./statementVerify";
import { buildStatementEntries, groupByMonth } from "./walletStatementPdfLayout";
import { periodLabel, renderStatementPdf, walletStatementSections, walletVerifySummary } from "./statementPdfLayout";
import { WALLET_TITLES } from "./receiptConfig";
import { watMonthKey } from "./wat";

const titleFor = (source) => WALLET_TITLES[source] || String(source || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * @param rows    wallet_ledger rows for the period (any order)
 * @param holder  businessHolder(...) for an owner, clientHolder(...) for a client
 * @param account { number, bank, name }
 * @param dates   { fromDate, toDate } the days it covers
 */
export async function generateWalletStatementPdf(rows, { holder = {}, account = {}, dates = {} } = {}) {
  const entries = buildStatementEntries(rows, titleFor);
  const months = groupByMonth(entries);
  const [{ jsPDF }, assets, verify] = await Promise.all([
    import("jspdf"),
    loadPdfAssets(),
    registerStatement("wallet_statement", { ...dates, holderName: holder.name, summary: walletVerifySummary(months, account.number) }),
  ]);
  const doc  = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const font = registerNotoSans(doc, assets);
  renderStatementPdf(doc, {
    sections: walletStatementSections({ entries, holder, account, period: periodLabel(dates.fromDate, dates.toDate) }),
    generatedAt: new Date(), verify,
  }, { logo: assets.logo, font });
  doc.setProperties({ title: `Wallet statement${holder.name ? ` — ${holder.name}` : ""}`, subject: "KudiAI Track wallet statement", author: "KudiAI Track · Amaya & Co. Technologies" });
  return { doc, entries };
}

export function walletStatementPdfFilename(entries) {
  const first = entries[0] ? watMonthKey(entries[0].at) : "";
  const last  = entries.length ? watMonthKey(entries[entries.length - 1].at) : "";
  const span  = first && last ? (first === last ? first : `${first}_to_${last}`) : "empty";
  return `wallet_statement_${span}.pdf`;
}

/** Build the statement PDF and hand it to the platform (download on web, share sheet on native). */
export async function saveWalletStatementPdf(rows, opts = {}) {
  const { doc, entries } = await generateWalletStatementPdf(rows, opts);
  await savePdf(doc, walletStatementPdfFilename(entries));
}
