// Statement PDF — A4 landscape, real vector text, one page per month per account.
//
// Draws the owner's wallet statement, a client's savings statement, a client's wallet statement, and the monthly
// statement a client is sent (savings + wallet for one month). Every month starts on its own page (a busy month
// continues onto further pages with the column header repeated), shows opening/closing balances and the running
// balance after every entry, and closes with that month's totals. Times are the stored server timestamps in WAT.
//
// SELF-CONTAINED — no imports, no browser APIs. It is copied byte-for-byte to
// supabase/functions/_shared/statementPdfLayout.js so the PDF attached to the monthly email (built on the server) is
// drawn by exactly the same code as the one downloaded in the app. Edit THIS file, then run
// `node scripts/sync-statement-layout.mjs`; src/__tests__/clientStatements.test.js fails while the copies differ.

// ── WAT time (UTC+1 all year — Nigeria has no daylight saving; mirrors src/utils/wat.js) ──
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
function toWAT(input) {
  const t = input instanceof Date ? input : new Date(input == null || input === "" ? Date.now() : input);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + 3600000);
}
function clock(w) {
  let h = w.getUTCHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${pad(w.getUTCMinutes())}:${pad(w.getUTCSeconds())} ${ap}`;
}
/** "18 Sep 2026, 09:14:32 PM WAT" */
export function formatWAT(input) {
  const w = toWAT(input);
  return w ? `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}, ${clock(w)} WAT` : "—";
}
/** "18 Sep 2026" */
export function formatWATDate(input) {
  const w = toWAT(input);
  return w ? `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}` : "—";
}
/** "09:14:32 PM WAT" */
export function formatWATTime(input) {
  const w = toWAT(input);
  return w ? `${clock(w)} WAT` : "—";
}
/** "2026-09" — the WAT calendar month a timestamp falls in */
export function watMonthKey(input) {
  const w = toWAT(input);
  return w ? `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}` : "";
}
/** "2026-09" -> "September 2026" */
export function monthKeyLabel(key) {
  const [y, m] = String(key || "").split("-");
  const i = Number(m) - 1;
  return LONG_MONTHS[i] ? `${LONG_MONTHS[i]} ${y}` : String(key || "");
}
/** ₦1,234.50 */
export function fmtNaira(n) {
  const [int, dec] = Number(n || 0).toFixed(2).split(".");
  return "₦" + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + dec;
}
const naira = (kobo) => fmtNaira(Number(kobo || 0) / 100);
const toKobo = (n) => (n == null || n === "" ? null : Math.round(Number(n) * 100));

// ── Entries ───────────────────────────────────────────────────────────────────
// What each wallet entry is called on a statement (same words as the app's receipts — receiptConfig.WALLET_TITLES;
// a test keeps the two equal). Anything else is title-cased from its source.
export const WALLET_SOURCE_TITLES = {
  topup:                 "Wallet Funding",
  sale:                  "Payment Received",
  bill_spend:            "Bill Payment",
  bill_reversal:         "Bill Refund",
  subscription_spend:    "Plan Upgrade",
  subscription_reversal: "Plan Refund",
  withdrawal:            "Transfer",
  withdrawal_reversal:   "Transfer Refund",
  adjustment:            "Wallet Adjustment",
  transfer_fee:          "Transfer Fee",
  cbn_levy:              "CBN Electronic Transfer Levy",
};
export function walletTitle(source) {
  return WALLET_SOURCE_TITLES[source] || String(source || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_NOTE = { pending: "Pending", processing: "Pending", failed: "Failed", reversed: "Reversed" };

/**
 * Wallet entries, oldest first. Accepts wallet_ledger rows (the app) or client_wallet_statement entries (the server).
 * @param titleFor (source) => what the entry is called
 */
export function walletEntries(rows, titleFor = walletTitle) {
  return [...(rows || [])]
    .map((r) => ({ ...r, at: r.at || r.created_at }))
    .filter((r) => r && r.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((r) => {
      const credit = r.credit != null ? !!r.credit : r.direction === "credit";
      const title = titleFor(r.source);
      const narration = String(r.narration || "").trim();
      const note = STATUS_NOTE[r.status];
      const description = [narration && narration.toLowerCase() !== String(title).toLowerCase() ? `${title} · ${narration}` : title, note ? `(${note})` : ""]
        .filter(Boolean).join(" ");
      return {
        at: r.at,
        month: watMonthKey(r.at),
        description,
        ref: r.ref || r.receipt_ref || "",
        credit,
        amountKobo: Math.round(Number(r.amount_kobo || 0)),
        balanceKobo: r.balance_after_kobo == null ? null : Math.round(Number(r.balance_after_kobo)),
      };
    });
}

/** Savings entries from client_savings_statement (naira, with the running balance already worked out on the server). */
export function savingsEntries(rows) {
  return [...(rows || [])]
    .filter((r) => r && r.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((r) => ({
      at: r.at,
      month: watMonthKey(r.at),
      description: r.label || "Savings entry",
      ref: r.ref || "",
      credit: !!r.credit,
      amountKobo: toKobo(r.amount) || 0,
      balanceKobo: toKobo(r.balance),
    }));
}

/**
 * Group entries by WAT month, oldest first, with each month's totals and opening/closing balance.
 * @param openingKobo the balance before the first entry (when known) — otherwise worked back from the first entry
 */
export function groupByMonth(entries, { openingKobo = null } = {}) {
  const months = [];
  for (const e of entries) {
    let m = months[months.length - 1];
    if (!m || m.key !== e.month) { m = { key: e.month, label: monthKeyLabel(e.month), entries: [] }; months.push(m); }
    m.entries.push(e);
  }
  let carry = openingKobo;
  for (const m of months) {
    m.totalInKobo  = m.entries.filter((e) => e.credit).reduce((s, e) => s + e.amountKobo, 0);
    m.totalOutKobo = m.entries.filter((e) => !e.credit).reduce((s, e) => s + e.amountKobo, 0);
    const first = m.entries[0];
    const last  = m.entries[m.entries.length - 1];
    const workedBack = first.balanceKobo == null ? null : first.balanceKobo - (first.credit ? first.amountKobo : -first.amountKobo);
    // A known opening carries month to month (savings); otherwise each month is worked back from its first entry
    // (the wallet, whose every entry stores its balance).
    m.openingKobo = openingKobo != null ? carry : workedBack;
    m.closingKobo = last.balanceKobo != null ? last.balanceKobo
      : m.openingKobo == null ? null : m.openingKobo + m.totalInKobo - m.totalOutKobo;
    carry = m.closingKobo;
  }
  return months;
}

/** One month, even with no entries (a monthly statement still shows the balance). */
export function singleMonth(key, entries, { openingKobo, closingKobo, inKobo, outKobo }) {
  return {
    key, label: monthKeyLabel(key), entries,
    openingKobo: openingKobo == null ? null : Math.round(openingKobo),
    closingKobo: closingKobo == null ? null : Math.round(closingKobo),
    totalInKobo:  inKobo  != null ? Math.round(inKobo)  : entries.filter((e) => e.credit).reduce((s, e) => s + e.amountKobo, 0),
    totalOutKobo: outKobo != null ? Math.round(outKobo) : entries.filter((e) => !e.credit).reduce((s, e) => s + e.amountKobo, 0),
  };
}

// ── Who the statement is for ──────────────────────────────────────────────────
export function savingsHolder(savings) {
  const c = savings?.client || {};
  const b = savings?.business || {};
  return {
    who: [c.name, c.membership_number ? `Membership ${c.membership_number}` : "", c.phone].filter(Boolean),
    address: [b.name ? `Savings with ${b.name}` : "", b.phone, b.address].filter(Boolean).join("  ·  "),
  };
}
export function walletHolder(wallet, name) {
  const a = wallet?.account || {};
  return {
    who: [name, a.number ? `Wallet ${a.number}${a.bank ? ` (${a.bank})` : ""}` : ""].filter(Boolean),
    address: "",
  };
}

// ── Drawing ───────────────────────────────────────────────────────────────────
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

/**
 * Draw statement sections onto a fresh jsPDF (A4 landscape, mm).
 * @param sections [{ title: "SAVINGS STATEMENT", who: [lines], address, months, emptyText }]
 * @param assets   { logo?, font } — font "helvetica" writes ₦ as "NGN " (the built-in font has no naira sign)
 */
export function renderStatementPdf(doc, { sections, generatedAt }, { logo = null, font = "helvetica" } = {}) {
  const custom = font !== "helvetica";
  const t = (s) => (custom ? String(s ?? "") : String(s ?? "").replace(/₦/g, "NGN "));
  const setReg  = (size, color = INK) => { doc.setFont(font, "normal"); doc.setFontSize(size); doc.setTextColor(...color); };
  const setBold = (size, color = INK) => { doc.setFont(font, "bold");   doc.setFontSize(size); doc.setTextColor(...color); };
  const setMono = (size, color = INK) => { doc.setFont("courier", "bold"); doc.setFontSize(size); doc.setTextColor(...color); };

  const stamp = formatWAT(generatedAt || new Date());
  let y = 0;
  let firstPage = true;
  const newPage = () => { if (!firstPage) doc.addPage("a4", "landscape"); firstPage = false; };

  const drawHeader = (section, month, continued) => {
    if (logo) { try { doc.addImage(logo, "PNG", ML, 10, 11, 11); } catch (_) { /* decoration only */ } }
    setBold(13, NAVY);
    doc.text("KudiAI Track", logo ? ML + 14 : ML, 16);
    setReg(7.5, MUTED);
    doc.text("Amaya & Co.", logo ? ML + 14 : ML, 20.5);
    setBold(9, INK);
    doc.text(section.title || "STATEMENT", RIGHT, 15.5, { align: "right" });
    setReg(7.5, MUTED);
    doc.text("KudiAI Track · Amaya & Co.", RIGHT, 20.5, { align: "right" });
    doc.setFillColor(...GREEN);
    doc.rect(0, 25, PAGE_W, 1.2, "F");

    setBold(15, INK);
    doc.text(`${month.label}${continued ? " (continued)" : ""}`, ML, 37);
    setReg(8.5, MUTED);
    const who = (section.who || []).filter(Boolean).join("  ·  ");
    if (who) doc.text(t(who), ML, 42.5);
    if (section.address) doc.text(t(section.address), ML, 47);
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

  (sections || []).forEach((section) => {
    const months = section.months || [];
    if (!months.length) {
      newPage();
      drawHeader(section, { label: section.emptyLabel || "No transactions" }, false);
      setReg(10, MUTED);
      doc.text(section.emptyText || "There are no transactions in the selected period.", ML, 62);
      return;
    }
    months.forEach((month) => {
      newPage();
      drawHeader(section, month, false);
      drawSummary(month);
      if (!month.entries.length) {
        setReg(10, MUTED);
        doc.text(t(section.emptyText || "No transactions this month."), ML, y + 6);
        return;
      }
      drawTableHead();

      month.entries.forEach((e, i) => {
        const descLines = (() => { setReg(8); return doc.splitTextToSize(t(e.description), COL.desc.w - 3).slice(0, 2); })();
        const h = Math.max(8.4, 5.6 + (descLines.length - 1) * 3.6);
        if (y + h > ROWS_BOTTOM) {
          doc.addPage("a4", "landscape");
          drawHeader(section, month, true);
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
      if (y + 11 > ROWS_BOTTOM) { doc.addPage("a4", "landscape"); drawHeader(section, month, true); y = 52; drawTableHead(); }
      doc.setFillColor(...PANEL); doc.setDrawColor(...NAVY); doc.setLineWidth(0.4);
      doc.rect(ML, y + 1, CW, 9, "FD");
      setBold(8.5, INK);
      doc.text(`Total for ${month.label}`, COL.date.x + 2, y + 6.9);
      setBold(8.5, IN_FG);  doc.text(t(naira(month.totalInKobo)),  COL.in.x  + COL.in.w  - 2, y + 6.9, { align: "right" });
      setBold(8.5, OUT_FG); doc.text(t(naira(month.totalOutKobo)), COL.out.x + COL.out.w - 2, y + 6.9, { align: "right" });
      setBold(8.5, INK);
      doc.text(month.closingKobo == null ? "—" : t(naira(month.closingKobo)), COL.bal.x + COL.bal.w - 2, y + 6.9, { align: "right" });
    });
  });

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

/** The owner's wallet statement (and a client's, from the app) — one wallet section. */
export function renderWalletStatementPdf(doc, { entries, business = {}, generatedAt }, assets) {
  const who = [business.name, business.account ? `Wallet ${business.account}` : "", business.phone].filter(Boolean);
  return renderStatementPdf(doc, {
    sections: [{
      title: "WALLET STATEMENT", who, address: business.address || "", months: groupByMonth(entries),
      emptyText: "There are no wallet transactions in the selected period.",
    }],
    generatedAt,
  }, assets);
}

/** A client's savings statement for a period (client_savings_statement result). */
export function savingsStatementSections(savings) {
  const entries = savingsEntries(savings?.entries);
  return [{
    title: "SAVINGS STATEMENT", ...savingsHolder(savings),
    months: groupByMonth(entries, { openingKobo: toKobo(savings?.opening) }),
    emptyText: "There are no savings transactions in the selected period.",
  }];
}

/**
 * The monthly statement a client is sent: savings, then wallet (when they have one), for one month
 * (client_statement_data result: { month, savings, wallet }).
 */
export function monthlyStatementSections(data, { titleFor = walletTitle } = {}) {
  const key = data?.month || "";
  const sections = [];
  if (data?.savings) {
    const s = data.savings;
    sections.push({
      title: "SAVINGS STATEMENT", ...savingsHolder(s),
      months: [singleMonth(key, savingsEntries(s.entries), {
        openingKobo: toKobo(s.opening), closingKobo: toKobo(s.closing), inKobo: toKobo(s.total_in), outKobo: toKobo(s.total_out),
      })],
      emptyText: "No savings transactions this month.",
    });
  }
  if (data?.wallet) {
    const w = data.wallet;
    sections.push({
      title: "WALLET STATEMENT", ...walletHolder(w, data?.savings?.client?.name),
      months: [singleMonth(key, walletEntries(w.entries, titleFor), {
        openingKobo: w.opening_kobo, closingKobo: w.closing_kobo, inKobo: w.in_kobo, outKobo: w.out_kobo,
      })],
      emptyText: "No wallet transactions this month.",
    });
  }
  return sections;
}

export function renderMonthlyStatementPdf(doc, data, assets) {
  return renderStatementPdf(doc, { sections: monthlyStatementSections(data), generatedAt: data?.generatedAt }, assets);
}

/** "KudiAI_Statement_October_2026.pdf" */
export function monthlyStatementFilename(month) {
  return `KudiAI_Statement_${monthKeyLabel(month).replace(/\s+/g, "_")}.pdf`;
}
