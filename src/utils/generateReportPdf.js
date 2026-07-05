// ── Shared KudiAI Report/Statement PDF Engine ─────────────────────────────────
// Single source of truth for every report and statement across the platform.
// Usage:
//   const pdf = await createReportPdf({ title, businessName, period, logoUrl })
//   pdf.addStats([{ label, value, color?, bg? }])
//   pdf.addSectionTitle("Section")
//   pdf.addTable(cols, rows)        // cols: { key, label, w, right?, bold?, color? }
//   pdf.addTotalsBlock(rows)        // rows: { label, value, bold?, highlight?, sep? }
//   pdf.addBarChart(bars)
//   pdf.addStatement(txns)          // bank-statement rows
//   await pdf.save("filename.pdf")
// ─────────────────────────────────────────────────────────────────────────────

import { savePdf } from "./pdfSave";

// Brand palette — matches invoice PDF
const NAVY   = [15,  28,  69];
const GREEN  = [61,  168, 41];
const DARK   = [44,  44,  42];
const SEC    = [95,  94,  90];
const MUTED  = [138, 138, 133];
const HAIRLN = [230, 228, 220];
const PANEL  = [246, 248, 252];
const WHITE  = [255, 255, 255];
const RED    = [220, 38,  38];

// ── Helpers ───────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  if (!hex || !hex.startsWith("#")) return SEC;
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function resolveColor(c, row) {
  if (!c) return SEC;
  if (Array.isArray(c)) return c;
  if (typeof c === "function") {
    const v = c(row);
    return Array.isArray(v) ? v : hexToRgb(v || "");
  }
  return hexToRgb(c);
}

export function fmtCurrency(n) {
  return "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-NG", {
    day: "numeric", month: "short", year: "numeric",
  });
}

async function imgToBase64(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 5000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise(ok => {
      const r = new FileReader();
      r.onloadend = () => ok(r.result);
      r.onerror   = () => ok(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function loadFontBase64(url) {
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 5000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const buf   = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary  = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch { return null; }
}

// ── Factory ───────────────────────────────────────────────────────────────────
export async function createReportPdf({
  title        = "Report",
  businessName = "Business",
  period       = "",
  subtitle     = "",
  logoUrl      = "",
  landscape    = false,
} = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    unit: "mm", format: "a4",
    orientation: landscape ? "landscape" : "portrait",
  });

  const W  = doc.internal.pageSize.getWidth();
  const H  = doc.internal.pageSize.getHeight();
  const ML = 12;
  const MR = W - 12;
  const CW = MR - ML;
  const HDR_H     = 34;
  const FOOTER_H  = 14;
  const CONTENT_BOT = H - FOOTER_H - 2;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [bizLogoB64, appLogoB64, fontRegB64, fontMedB64] = await Promise.all([
    logoUrl ? imgToBase64(logoUrl) : Promise.resolve(null),
    imgToBase64(`${origin}/logo.png`),
    loadFontBase64(`${origin}/fonts/NotoSans-Regular.ttf`),
    loadFontBase64(`${origin}/fonts/NotoSans-Medium.ttf`),
  ]);

  // ── Register Unicode font ──────────────────────────────────────────────────
  let FONT = "helvetica";
  try {
    if (fontRegB64) {
      doc.addFileToVFS("NotoSans-Regular.ttf", fontRegB64);
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      FONT = "NotoSans";
    }
    if (fontMedB64) {
      doc.addFileToVFS("NotoSans-Medium.ttf", fontMedB64);
      doc.addFont("NotoSans-Medium.ttf", "NotoSans", "bold");
    } else if (FONT === "NotoSans") {
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "bold");
    }
  } catch { /* fall back to helvetica */ }

  const setReg  = sz => { doc.setFont(FONT, "normal"); if (sz) doc.setFontSize(sz); };
  const setMed  = sz => { doc.setFont(FONT, "bold");   if (sz) doc.setFontSize(sz); };
  const setItal = sz => { doc.setFont("helvetica", "italic"); if (sz) doc.setFontSize(sz); };
  const col     = (...c) => doc.setTextColor(...c);

  // ── Page 1 header ──────────────────────────────────────────────────────────
  function drawPage1Header() {
    // Navy band
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, HDR_H, "F");
    // Green accent strip below navy
    doc.setFillColor(...GREEN);
    doc.rect(0, HDR_H, W, 2, "F");

    // App logo (left)
    if (appLogoB64) doc.addImage(appLogoB64, "PNG", ML, 8, 14, 14);
    // Business logo (right, if provided)
    if (bizLogoB64) doc.addImage(bizLogoB64, "JPEG", MR - 16, 8, 14, 14);

    // Text (centered)
    setMed(6.5); col(180, 220, 165);
    doc.text("KudiAI Track", W / 2, 11, { align: "center" });
    setMed(13); col(...WHITE);
    doc.text(String(businessName), W / 2, 21, { align: "center" });
    setReg(7); col(200, 220, 245);
    const meta = [title, period, subtitle].filter(Boolean).join("  ·  ");
    doc.text(meta, W / 2, 30, { align: "center" });
  }

  function drawContinuationHeader() {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 10, "F");
    doc.setFillColor(...GREEN);
    doc.rect(0, 10, W, 1.5, "F");
    setMed(6); col(...WHITE);
    doc.text(`${title} (continued)`, ML, 7);
    setReg(6); col(200, 220, 245);
    doc.text(String(businessName), MR, 7, { align: "right" });
  }

  drawPage1Header();
  let y = HDR_H + 8;

  // ── Page management ────────────────────────────────────────────────────────
  function newPage() {
    doc.addPage();
    drawContinuationHeader();
    y = 18;
  }

  function need(h) {
    if (y + h > CONTENT_BOT) newPage();
  }

  // ── Public API: content methods ────────────────────────────────────────────

  function addStats(stats) {
    if (!stats?.length) return;
    const perRow = stats.length <= 2 ? 2 : Math.min(4, stats.length);
    const boxW = (CW - (perRow - 1) * 3) / perRow;
    const boxH = 18;

    for (let i = 0; i < stats.length; i += perRow) {
      need(boxH + 3);
      const slice = stats.slice(i, i + perRow);
      // eslint-disable-next-line no-loop-func
      slice.forEach((s, j) => {
        const x  = ML + j * (boxW + 3);
        const bg = Array.isArray(s.bg) ? s.bg : hexToRgb(typeof s.bg === "string" ? s.bg : "#f8fafc");
        doc.setFillColor(...bg);
        doc.rect(x, y, boxW, boxH, "F");
        // Label
        setReg(5.5); col(...MUTED);
        doc.text(String(s.label || "").toUpperCase(), x + 3, y + 6);
        // Value
        const vc = Array.isArray(s.color) ? s.color : hexToRgb(typeof s.color === "string" ? s.color : "#2c2c2a");
        setMed(11); col(...vc);
        doc.text(String(s.value ?? ""), x + 3, y + 14, { maxWidth: boxW - 5 });
      });
      y += boxH + 3;
    }
    y += 2;
  }

  function addSectionTitle(text) {
    need(14);
    y += 4;
    // Left accent bar
    doc.setFillColor(...GREEN);
    doc.rect(ML, y - 3.5, 2.5, 9, "F");
    setMed(7.5); col(...NAVY);
    doc.text(String(text).toUpperCase(), ML + 5.5, y + 1.5);
    doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.2);
    doc.line(ML + 5.5, y + 3.5, MR, y + 3.5);
    y += 10;
  }

  function addTable(cols, rows, opts = {}) {
    if (!cols?.length) return;
    const RH    = opts.rowHeight    || 7;
    const HDR_H = opts.headerHeight || 7;

    need(HDR_H + RH);

    function drawHeader() {
      doc.setFillColor(...NAVY);
      doc.rect(ML, y, CW, HDR_H, "F");
      let x = ML + 1.5;
      cols.forEach(c => {
        const cw = CW * (c.w || c.width || (1 / cols.length));
        setMed(6); col(...WHITE);
        const lbl = String(c.label || "").toUpperCase();
        if (c.right) doc.text(lbl, x + cw - 2, y + 4.8, { align: "right" });
        else         doc.text(lbl, x, y + 4.8);
        x += cw;
      });
      y += HDR_H;
    }

    drawHeader();

    if (!rows?.length) {
      setItal(7); col(...MUTED);
      doc.text("No data for this period", ML + CW / 2, y + 5, { align: "center" });
      y += 10;
      return;
    }

    rows.forEach((r, ri) => {
      if (y + RH > CONTENT_BOT) { newPage(); drawHeader(); }
      if (ri % 2 === 0) {
        doc.setFillColor(...PANEL);
        doc.rect(ML, y, CW, RH, "F");
      }
      doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.1);
      doc.line(ML, y + RH, MR, y + RH);

      let x = ML + 1.5;
      cols.forEach(c => {
        const cw  = CW * (c.w || c.width || (1 / cols.length));
        const val = String(r[c.key] ?? "—");
        const tc  = resolveColor(c.color, r);
        c.bold ? setMed(6.5) : setReg(6.5);
        col(...tc);
        if (c.right) doc.text(val, x + cw - 2, y + 4.8, { align: "right", maxWidth: cw - 3 });
        else         doc.text(val, x, y + 4.8, { maxWidth: cw - 2 });
        x += cw;
      });
      y += RH;
    });
    y += 4;
  }

  // Right-aligned totals block (occupies right ~45% of page)
  function addTotalsBlock(items) {
    if (!items?.length) return;
    const RH    = 7;
    const TOT_X = ML + CW * 0.53;
    need(items.length * RH + 6);

    items.forEach((item, i) => {
      if (item.sep) {
        doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.2);
        doc.line(TOT_X, y + 1, MR, y + 1);
        y += 3;
        return;
      }
      if (item.highlight) {
        doc.setFillColor(...NAVY);
        doc.rect(TOT_X, y, MR - TOT_X, RH, "F");
      }

      const textCol = item.highlight ? WHITE : (item.bold ? DARK : SEC);
      setReg(7.5); col(...textCol);
      doc.text(String(item.label || ""), TOT_X + 2, y + 5);

      item.bold ? setMed(7.5) : setReg(7.5);
      const valCol = item.highlight ? WHITE : (item.green ? GREEN : item.red ? RED : DARK);
      col(...valCol);
      doc.text(String(item.value || ""), MR - 2, y + 5, { align: "right" });
      y += RH;
    });
    y += 4;
  }

  function addBarChart(bars) {
    if (!bars?.length) return;
    const CH = 40;
    need(CH + 20);
    const maxV   = Math.max(...bars.map(b => Math.max(b.v1 || 0, b.v2 || b.v || 0)), 1);
    const slot   = CW / bars.length;
    const bw     = Math.min(slot * 0.4, 7);
    const isDual = bars[0]?.v1 !== undefined;

    doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.2);
    [0.25, 0.5, 0.75, 1].forEach(f => {
      const ly = y + CH - CH * f;
      doc.line(ML, ly, MR, ly);
    });

    const skip = Math.ceil(bars.length / 14);
    bars.forEach((b, i) => {
      const cx = ML + i * slot + slot / 2;
      if (isDual) {
        const h1 = Math.max(0.5, (b.v1 / maxV) * CH);
        const h2 = Math.max(0.5, (b.v2 / maxV) * CH);
        doc.setFillColor(...GREEN); doc.rect(cx - bw - 0.5, y + CH - h1, bw, h1, "F");
        doc.setFillColor(...RED);   doc.rect(cx + 0.5,       y + CH - h2, bw, h2, "F");
      } else {
        const h  = Math.max(0.5, ((b.v || 0) / maxV) * CH);
        const bc = b.color ? (Array.isArray(b.color) ? b.color : hexToRgb(b.color)) : GREEN;
        doc.setFillColor(...bc);
        doc.rect(cx - bw / 2, y + CH - h, bw, h, "F");
      }
      if (i % skip === 0) {
        setReg(5); col(...MUTED);
        doc.text(String(b.label || "").slice(0, 7), cx, y + CH + 5, { align: "center" });
      }
    });
    y += CH + 10;

    if (isDual) {
      doc.setFillColor(...GREEN); doc.rect(ML, y, 5, 3.5, "F");
      setReg(6); col(...SEC);
      doc.text("Income", ML + 7, y + 3);
      doc.setFillColor(...RED); doc.rect(ML + 30, y, 5, 3.5, "F");
      doc.text("Expenses", ML + 37, y + 3);
      y += 8;
    }
  }

  // Bank-statement format: chronological rows with running balance
  // txns: [{ date, description, reference, debit, credit, balance, highlight? }]
  function addStatement(txns) {
    const COLS = [
      { key: "date",        label: "Date",        w: 0.12 },
      { key: "description", label: "Description", w: 0.30, bold: true },
      { key: "reference",   label: "Reference",   w: 0.16 },
      { key: "debit",       label: "Debit",       w: 0.14, right: true, color: r => r.debit && r.debit !== "—" ? RED : MUTED },
      { key: "credit",      label: "Credit",      w: 0.14, right: true, color: r => r.credit && r.credit !== "—" ? GREEN : MUTED },
      { key: "balance",     label: "Balance",     w: 0.14, right: true, bold: true },
    ];
    addTable(COLS, txns, { rowHeight: 7 });
  }

  // ── Finalize and save ──────────────────────────────────────────────────────
  async function save(filename) {
    const totalPg = doc.internal.getNumberOfPages();
    const genDate = new Date().toLocaleDateString("en-NG", {
      day: "numeric", month: "short", year: "numeric",
    });

    for (let i = 1; i <= totalPg; i++) {
      doc.setPage(i);
      // Footer band
      doc.setFillColor(...PANEL);
      doc.rect(0, H - FOOTER_H, W, FOOTER_H, "F");
      doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.2);
      doc.line(0, H - FOOTER_H, W, H - FOOTER_H);
      // Green bottom strip
      doc.setFillColor(...GREEN);
      doc.rect(0, H - 1.5, W, 1.5, "F");
      // App logo in footer
      if (appLogoB64) doc.addImage(appLogoB64, "PNG", ML, H - 11, 7, 7);
      // Footer text
      setReg(5.5); col(...MUTED);
      doc.text(`KudiAI Track  ·  Generated ${genDate}`, ML + 10, H - 6);
      setMed(5.5); col(...NAVY);
      doc.text(`Page ${i} of ${totalPg}`, MR, H - 6, { align: "right" });
    }

    await savePdf(doc, filename || "KudiAITrack_Report.pdf");
  }

  async function getBase64() {
    return doc.output("datauristring").split(",")[1];
  }

  // Expose formatting helpers so callers can format their own data
  return { addStats, addSectionTitle, addTable, addTotalsBlock, addBarChart, addStatement, save, getBase64, fmtN: fmtCurrency, fmtD: fmtDate };
}
