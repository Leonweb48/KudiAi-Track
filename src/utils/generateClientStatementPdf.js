// Browser wrapper for clients' statement PDFs (layout: statementPdfLayout.js — the same code that draws the PDF attached
// to the monthly statement email, so a downloaded month and an emailed month are the same document).

import { savePdf } from "./pdfSave";
import { loadPdfAssets, registerNotoSans } from "./pdfAssets";
import { WALLET_TITLES } from "./receiptConfig";
import {
  monthlyStatementFilename, monthlyStatementSections, renderStatementPdf, savingsStatementSections,
} from "./statementPdfLayout";

const titleFor = (source) => WALLET_TITLES[source] || String(source || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function newDoc() {
  const [{ jsPDF }, assets] = await Promise.all([import("jspdf"), loadPdfAssets()]);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const font = registerNotoSans(doc, assets);
  return { doc, assets: { logo: assets.logo, font } };
}

/** A savings statement for any period (client_savings_statement result). */
export async function buildSavingsStatementPdf(statement) {
  const { doc, assets } = await newDoc();
  renderStatementPdf(doc, { sections: savingsStatementSections(statement), generatedAt: new Date() }, assets);
  doc.setProperties({ title: "Savings statement", subject: "KudiAI Track savings statement", author: "KudiAI Track · Amaya & Co. Technologies" });
  return doc;
}

export function savingsStatementFilename(from, to) {
  const d = (s) => String(s || "").slice(0, 10);
  return `savings_statement_${d(from)}_to_${d(to)}.pdf`;
}

export async function saveSavingsStatementPdf(statement, { from, to } = {}) {
  await savePdf(await buildSavingsStatementPdf(statement), savingsStatementFilename(from || statement?.from, to || statement?.to));
}

/** The monthly statement (client_statement_data result: savings + wallet for one month). */
export async function buildMonthlyStatementPdf(data) {
  const { doc, assets } = await newDoc();
  renderStatementPdf(doc, { sections: monthlyStatementSections(data, { titleFor }), generatedAt: new Date() }, assets);
  doc.setProperties({ title: `Statement — ${data?.month || ""}`, subject: "KudiAI Track monthly statement", author: "KudiAI Track · Amaya & Co. Technologies" });
  return doc;
}

export async function saveMonthlyStatementPdf(data) {
  await savePdf(await buildMonthlyStatementPdf(data), monthlyStatementFilename(data?.month));
}
