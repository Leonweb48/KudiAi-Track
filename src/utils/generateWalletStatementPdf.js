// Browser wrapper for the wallet statement PDF — the owner's and a client's (layout: statementPdfLayout.js). The
// statement carries a KDR reference + QR code so whoever holds it can check it at kudiai.app/verify.

import { savePdf } from "./pdfSave";
import { loadPdfAssets, registerNotoSans } from "./pdfAssets";
import { registerStatement } from "./statementVerify";
import { buildStatementEntries, groupByMonth } from "./walletStatementPdfLayout";
import {
  monthDates, monthKeyLabel, periodLabel, renderStatementPdf, walletMonthFromLedger, walletMonthSections, walletStatementSections, walletVerifySummary,
} from "./statementPdfLayout";
import { supabase } from "./supabase";
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

/**
 * One month's wallet statement — the same document the monthly reports email attaches (the server builds it from
 * client_wallet_statement; the app from its own ledger rows via walletMonthFromLedger — same shape, same layout).
 * A quiet month still shows its opening and closing balance.
 */
export async function saveWalletMonthPdf(userId, month, { holder = {}, account = {} } = {}) {
  const { fromDate, toDate } = monthDates(month);
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const t0 = `${fromDate}T00:00:00+01:00`, t1 = `${next}-01T00:00:00+01:00`;
  const [{ data: rows }, { data: prior }] = await Promise.all([
    supabase.from("wallet_ledger").select("*").eq("user_id", userId).gte("created_at", t0).lt("created_at", t1)
      .order("created_at", { ascending: true }).limit(5000),
    supabase.from("wallet_ledger").select("balance_after_kobo, created_at").eq("user_id", userId).lt("created_at", t0)
      .not("balance_after_kobo", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const wallet = walletMonthFromLedger(rows || [], prior || null, account);
  const sections = walletMonthSections(wallet, month, holder, { titleFor });
  const [{ jsPDF }, assets, verify] = await Promise.all([
    import("jspdf"),
    loadPdfAssets(),
    registerStatement("wallet_statement", { fromDate, toDate, holderName: holder.name, summary: walletVerifySummary(sections[0].months, account.number) }),
  ]);
  const doc  = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const font = registerNotoSans(doc, assets);
  renderStatementPdf(doc, { sections, generatedAt: new Date(), verify }, { logo: assets.logo, font });
  doc.setProperties({ title: `Wallet statement — ${monthKeyLabel(month)}`, subject: "KudiAI Track wallet statement", author: "KudiAI Track · Amaya & Co. Technologies" });
  await savePdf(doc, `KudiAI_Wallet_Statement_${monthKeyLabel(month).replace(/\s+/g, "_")}.pdf`);
}

