// Wallet statement PDF — A4 landscape, real vector text, one page per month.
//
// Every month in the selected period starts on its own page (a busy month
// continues onto further pages with the column header repeated). Each carries the
// stored running balance after every entry, and closes with that month's totals.
// All times are the stored server timestamps rendered in WAT.
//
// Pure layout — no fetching, no browser APIs — so it is tested in Node.
// generateWalletStatementPdf.js is the browser wrapper.

import { formatWAT, formatWATDate, formatWATTime, watMonthKey, monthKeyLabel } from "./wat";
import { fmtNaira } from "./receiptPdfLayout";

const NAVY  = [15, 28, 69];
const GREEN = [61, 168, 41];
const INK   = [30, 41, 59];
const MUTED = [100, 116, 139];
const HAIR  = [226, 232, 240];
const PANEL = [248, 250, 252];
const WHITE = [255, 255, 255];
const IN_FG  = [15, 123, 62];
const OUT_FG = [185, 28, 28];

const PAGE_W = 297;
const ML = 14;
const MR = 14;
const RIGHT = PAGE_W - MR;
const CW = PAGE_W - ML - MR;
const ROWS_BOTTOM = 188;             // rows and totals stop above the footer

// Column layout (mm from the left margin) — amounts are right-aligned to their column's right edge.
const COL = {
  date:    { x: ML,       w: 38 },
  desc:    { x: ML + 38,  w: 92 },
  ref:     { x: ML + 130, w: 40 },
  in:      { x: ML + 170, w: 30 },
  out:     { x: ML + 200, w: 30 },
  bal:     { x: ML + 230, w: 39 },
};

const STATUS_NOTE = { pending: "Pending", processing: "Pending", failed: "Failed", reversed: "Reversed" };

/**
 * Turn wallet_ledger rows into statement entries, oldest first.
 * @param rows     wallet_ledger rows
 * @param titleFor (source) => human title for a ledger source
 */
export function buildStatementEntries(rows, titleFor = (s) => String(s || "").replace(/_/g, " ")) {
  return [...(rows || [])]
    .filter((r) => r && r.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((r) => {
      const credit = r.direction === "credit";
      const amountKobo = Math.round(Number(r.amount_kobo || 0));
      const title = titleFor(r.source);
      const narration = String(r.narration || "").trim();
      const note = STATUS_NOTE[r.status];
      const description = [narration && narration.toLowerCase() !== String(title).toLowerCase() ? `${title} · ${narration}` : title, note ? `(${note})` : ""]
        .filter(Boolean).join(" ");
      return {
        at: r.created_at,
        month: watMonthKey(r.created_at),
        description,
        ref: r.receipt_ref || "",
        credit,
        amountKobo,
        balanceKobo: r.balance_after_kobo == null ? null : Math.round(Number(r.balance_after_kobo)),
      };
    });
}

/** Group entries by WAT month, oldest month first, with the month's totals and opening/closing balance. */
export function groupByMonth(entries) {
  const months = [];
  for (const e of entries) {
    let m = months[months.length - 1];
    if (!m || m.key !== e.month) { m = { key: e.month, label: monthKeyLabel(e.month), entries: [] }; months.push(m); }
    m.entries.push(e);
  }
  for (const m of months) {
    m.totalInKobo  = m.entries.filter((e) => e.credit).reduce((s, e) => s + e.amountKobo, 0);
    m.totalOutKobo = m.entries.filter((e) => !e.credit).reduce((s, e) => s + e.amountKobo, 0);
    const first = m.entries[0];
    const last  = m.entries[m.entries.length - 1];
    m.closingKobo = last.balanceKobo;
    m.openingKobo = first.balanceKobo == null ? null : first.balanceKobo - (first.credit ? first.amountKobo : -first.amountKobo);
  }
  return months;
}

const naira = (kobo) => fmtNaira(kobo / 100);

/**
 * @param doc  fresh jsPDF (A4 landscape, mm)
 * @param data { entries, business: { name, address, phone, account }, generatedAt }
 * @param assets { logo?, font }
 */
export function renderWalletStatementPdf(doc, { entries, business = {}, generatedAt }, { logo = null, font = "helvetica" } = {}) {
  const custom = font !== "helvetica";
  const t = (s) => (custom ? String(s ?? "") : String(s ?? "").replace(/₦/g, "NGN "));
  const setReg  = (size, color = INK) => { doc.setFont(font, "normal"); doc.setFontSize(size); doc.setTextColor(...color); };
  const setBold = (size, color = INK) => { doc.setFont(font, "bold");   doc.setFontSize(size); doc.setTextColor(...color); };
  const setMono = (size, color = INK) => { doc.setFont("courier", "bold"); doc.setFontSize(size); doc.setTextColor(...color); };

  const months = groupByMonth(entries);
  const stamp = formatWAT(generatedAt || new Date());
  let y = 0;
  let firstPage = true;

  const drawHeader = (month, continued) => {
    if (logo) { try { doc.addImage(logo, "PNG", ML, 10, 11, 11); } catch (_) { /* decoration only */ } }
    setBold(13, NAVY);
    doc.text("KudiAI Track", logo ? ML + 14 : ML, 16);
    setReg(7.5, MUTED);
    doc.text("Amaya & Co.", logo ? ML + 14 : ML, 20.5);
    setBold(9, INK);
    doc.text("WALLET STATEMENT", RIGHT, 15.5, { align: "right" });
    setReg(7.5, MUTED);
    doc.text("KudiAI Track · Amaya & Co.", RIGHT, 20.5, { align: "right" });
    doc.setFillColor(...GREEN);
    doc.rect(0, 25, PAGE_W, 1.2, "F");

    setBold(15, INK);
    doc.text(`${month.label}${continued ? " (continued)" : ""}`, ML, 37);
    setReg(8.5, MUTED);
    const who = [business.name, business.account ? `Wallet ${business.account}` : "", business.phone].filter(Boolean).join("  ·  ");
    if (who) doc.text(t(who), ML, 42.5);
    if (business.address) doc.text(t(business.address), ML, 47);
    doc.text(`Generated ${stamp}`, RIGHT, 37, { align: "right" });
    y = 52;
  };

  const drawSummary = (month) => {
    const boxes = [
      ["Opening balance", month.openingKobo == null ? "—" : naira(month.openingKobo), INK],
      ["Money in",        naira(month.totalInKobo),  IN_FG],
      ["Money out",       naira(month.totalOutKobo), OUT_FG],
      ["Closing balance", month.closingKobo == null ? "—" : naira(month.closingKobo), INK],
    ];
    const gap = 4;
    const bw = (CW - gap * 3) / 4;
    boxes.forEach(([label, value, color], i) => {
      const x = ML + i * (bw + gap);
      doc.setFillColor(...PANEL); doc.setDrawColor(...HAIR); doc.setLineWidth(0.3);
      doc.roundedRect(x, y, bw, 15, 2, 2, "FD");
      setReg(7.5, MUTED);
      doc.text(label, x + 4, y + 5.5);
      setBold(11.5, color);
      doc.text(t(value), x + 4, y + 12);
    });
    y += 21;
  };

  const drawTableHead = () => {
    doc.setFillColor(...NAVY);
    doc.rect(ML, y, CW, 7, "F");
    setBold(7.5, WHITE);
    doc.text("DATE & TIME (WAT)", COL.date.x + 2, y + 4.7);
    doc.text("DESCRIPTION", COL.desc.x, y + 4.7);
    doc.text("REFERENCE", COL.ref.x, y + 4.7);
    doc.text("MONEY IN", COL.in.x + COL.in.w - 2, y + 4.7, { align: "right" });
    doc.text("MONEY OUT", COL.out.x + COL.out.w - 2, y + 4.7, { align: "right" });
    doc.text("BALANCE", COL.bal.x + COL.bal.w - 2, y + 4.7, { align: "right" });
    y += 7;
  };

  months.forEach((month) => {
    if (!firstPage) doc.addPage("a4", "landscape");
    firstPage = false;
    drawHeader(month, false);
    drawSummary(month);
    drawTableHead();

    month.entries.forEach((e, i) => {
      const descLines = (() => { setReg(8); return doc.splitTextToSize(t(e.description), COL.desc.w - 3).slice(0, 2); })();
      const h = Math.max(8.4, 5.6 + (descLines.length - 1) * 3.6);
      if (y + h > ROWS_BOTTOM) {
        doc.addPage("a4", "landscape");
            drawHeader(month, true);
        y = 52;
        drawTableHead();
      }
      if (i % 2 === 1) { doc.setFillColor(250, 251, 253); doc.rect(ML, y, CW, h, "F"); }
      const base = y + 3.9;
      setReg(8, INK);
      doc.text(formatWATDate(e.at), COL.date.x + 2, base);
      setReg(7, MUTED);
      doc.text(formatWATTime(e.at), COL.date.x + 2, base + 3.4);
      setReg(8, INK);
      descLines.forEach((ln, k) => doc.text(ln, COL.desc.x, base + k * 3.6));
      if (e.ref) { setMono(7.2, INK); doc.text(e.ref, COL.ref.x, base); }
      if (e.credit) { setReg(8.5, IN_FG); doc.text(t(naira(e.amountKobo)), COL.in.x + COL.in.w - 2, base, { align: "right" }); }
      else          { setReg(8.5, OUT_FG); doc.text(t(naira(e.amountKobo)), COL.out.x + COL.out.w - 2, base, { align: "right" }); }
      if (e.balanceKobo != null) { setBold(8.5, INK); doc.text(t(naira(e.balanceKobo)), COL.bal.x + COL.bal.w - 2, base, { align: "right" }); }
      else { setReg(8.5, MUTED); doc.text("—", COL.bal.x + COL.bal.w - 2, base, { align: "right" }); }
      y += h;
      doc.setDrawColor(...HAIR); doc.setLineWidth(0.15);
      doc.line(ML, y, RIGHT, y);
    });

    // Totals for the month
    if (y + 11 > ROWS_BOTTOM) { doc.addPage("a4", "landscape"); drawHeader(month, true); y = 52; drawTableHead(); }
    doc.setFillColor(...PANEL); doc.setDrawColor(...NAVY); doc.setLineWidth(0.4);
    doc.rect(ML, y + 1, CW, 9, "FD");
    setBold(8.5, INK);
    doc.text(`Total for ${month.label}`, COL.date.x + 2, y + 6.9);
    setBold(8.5, IN_FG);  doc.text(t(naira(month.totalInKobo)),  COL.in.x  + COL.in.w  - 2, y + 6.9, { align: "right" });
    setBold(8.5, OUT_FG); doc.text(t(naira(month.totalOutKobo)), COL.out.x + COL.out.w - 2, y + 6.9, { align: "right" });
    setBold(8.5, INK);
    doc.text(month.closingKobo == null ? "—" : t(naira(month.closingKobo)), COL.bal.x + COL.bal.w - 2, y + 6.9, { align: "right" });
  });

  if (!months.length) {
    drawHeader({ label: "No transactions" }, false);
    setReg(10, MUTED);
    doc.text("There are no wallet transactions in the selected period.", ML, 62);
  }

  // Footers, now that the page count is known
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.3);
    doc.line(ML, 196, RIGHT, 196);
    setReg(7.5, MUTED);
    doc.text("Generated by KudiAI Track · A product of Amaya & Co. Technologies · This statement is computer generated and valid without signature.", ML, 201);
    doc.text(`Page ${p} of ${total}`, RIGHT, 201, { align: "right" });
    doc.text("support@kudiai.app · kudiai.app", ML, 205);
  }
  return { pages: total };
}
