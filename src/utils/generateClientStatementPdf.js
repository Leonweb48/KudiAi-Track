// Browser wrapper for clients' statement PDFs (layout: statementPdfLayout.js — the same code that draws the PDF attached
// to the monthly statement email, so a downloaded month and an emailed month are the same document). Each PDF gets a
// KDR reference + QR code so whoever holds it can check it at kudiai.app/verify.

import { savePdf } from "./pdfSave";
import { loadPdfAssets, registerNotoSans } from "./pdfAssets";
import { WALLET_TITLES } from "./receiptConfig";
import { registerStatement } from "./statementVerify";
import { verifyShareText } from "./verifyLink";
import {
  monthDates, monthlyStatementFilename, monthlyStatementSections, monthlyVerifySummary, periodLabel,
  renderStatementPdf, savingsStatementSections, savingsVerifySummary,
} from "./statementPdfLayout";

const titleFor = (source) => WALLET_TITLES[source] || String(source || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function newDoc() {
  const [{ jsPDF }, assets] = await Promise.all([import("jspdf"), loadPdfAssets()]);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const font = registerNotoSans(doc, assets);
  return { doc, assets: { logo: assets.logo, font } };
}

/**
 * A savings statement for any period (client_savings_statement result).
 * @param dates { fromDate, toDate } the days it covers (statementPeriod.statementDates)
 */
export async function buildSavingsStatementPdf(statement, dates = {}) {
  return (await savingsPdf(statement, dates)).doc;
}

async function savingsPdf(statement, dates = {}) {
  const [{ doc, assets }, verify] = await Promise.all([
    newDoc(),
    registerStatement("savings_statement", { ...dates, holderName: statement?.client?.name, summary: savingsVerifySummary(statement) }),
  ]);
  const period = periodLabel(dates.fromDate, dates.toDate);
  renderStatementPdf(doc, { sections: savingsStatementSections(statement, { period }), generatedAt: new Date(), verify }, assets);
  doc.setProperties({ title: "Savings statement", subject: "KudiAI Track savings statement", author: "KudiAI Track · Amaya & Co. Technologies" });
  return { doc, ref: verify?.ref || "" };
}

export function savingsStatementFilename({ fromDate, toDate } = {}) {
  return `savings_statement_${fromDate || ""}_to_${toDate || ""}.pdf`;
}

export async function saveSavingsStatementPdf(statement, dates = {}) {
  const { doc, ref } = await savingsPdf(statement, dates);
  await savePdf(doc, savingsStatementFilename(dates), { shareText: verifyShareText(ref, "statement") });
}

/** The monthly statement (client_statement_data result: savings + wallet for one month). */
export async function buildMonthlyStatementPdf(data) {
  return (await monthlyPdf(data)).doc;
}

async function monthlyPdf(data) {
  const [{ doc, assets }, verify] = await Promise.all([
    newDoc(),
    registerStatement("monthly_statement", { ...monthDates(data?.month), holderName: data?.savings?.client?.name, summary: monthlyVerifySummary(data) }),
  ]);
  renderStatementPdf(doc, { sections: monthlyStatementSections(data, { titleFor }), generatedAt: new Date(), verify }, assets);
  doc.setProperties({ title: `Statement — ${data?.month || ""}`, subject: "KudiAI Track monthly statement", author: "KudiAI Track · Amaya & Co. Technologies" });
  return { doc, ref: verify?.ref || "" };
}

export async function saveMonthlyStatementPdf(data) {
  const { doc, ref } = await monthlyPdf(data);
  await savePdf(doc, monthlyStatementFilename(data?.month), { shareText: verifyShareText(ref, "statement") });
}
