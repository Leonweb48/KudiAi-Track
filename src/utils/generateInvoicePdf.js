import { savePdf } from "./pdfSave";

// ── Brand palette ──────────────────────────────────────────────────────────────
const NAVY    = [22,  37,  90];
const GREEN   = [61,  168, 41];
const TGREEN  = [234, 246, 228];
const LTGREEN = [243, 250, 239];
const DARK    = [44,  44,  42];
const SEC     = [95,  94,  90];
const MUTED   = [138, 138, 133];
const HAIRLN  = [230, 228, 220];
const PANEL   = [246, 248, 252];
const WHITE   = [255, 255, 255];
const RED     = [220, 38,  38];
const AMBER   = [217, 119, 6];
const TRED    = [254, 242, 242];
const TAMBER  = [255, 251, 235];
const LBLUE   = [148, 172, 220];

const SLOGAN = "Talk your money. Track your profit. Grow your business.";

// ── Formatting ─────────────────────────────────────────────────────────────────
const koboToNaira = (k) => (k || 0) / 100;
const fmtK = (k) => fmtN(koboToNaira(k));
const fmtN = (n) =>
  "₦" + Number(n || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function dateFmtShort(str) {
  if (!str) return "";
  return new Date(str + "T00:00:00").toLocaleDateString("en-NG", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ── Asset loading ──────────────────────────────────────────────────────────────
async function imgToBase64(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 5000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((ok) => {
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

function getImgFmt(dataUrl) {
  if (!dataUrl) return "JPEG";
  if (dataUrl.startsWith("data:image/png"))  return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

function initials(name) {
  return (name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => (w[0] || "").toUpperCase())
    .join("");
}

// ── Merge identical line items ─────────────────────────────────────────────────
function mergeItems(items) {
  const seen = new Map();
  for (const item of (items || [])) {
    const key = `${(item.description || "").trim()}|${item.unit_price_kobo}`;
    if (seen.has(key)) {
      const ex = seen.get(key);
      ex.quantity = Number(ex.quantity) + Number(item.quantity || 1);
      ex.line_total_kobo = Math.round(ex.quantity * (item.unit_price_kobo || 0));
    } else {
      seen.set(key, { ...item, quantity: Number(item.quantity || 1) });
    }
  }
  return Array.from(seen.values());
}

// ── Status config ──────────────────────────────────────────────────────────────
function statusCfg(status, isReceipt) {
  if (isReceipt)                   return { text: "RECEIPT", pill: GREEN,       tint: LTGREEN,        border: GREEN       };
  if (status === "paid")           return { text: "PAID",    pill: GREEN,       tint: LTGREEN,        border: GREEN       };
  if (status === "overdue")        return { text: "OVERDUE", pill: RED,         tint: TRED,           border: RED         };
  if (status === "cancelled")      return { text: "VOID",    pill: MUTED,       tint: PANEL,          border: HAIRLN      };
  if (status === "partially_paid") return { text: "PARTIAL", pill: AMBER,       tint: TAMBER,         border: AMBER       };
  if (status === "sent")           return { text: "SENT",    pill: [37,99,235], tint: [239,246,255],  border: [37,99,235] };
  return                                  { text: "DRAFT",   pill: MUTED,       tint: PANEL,          border: HAIRLN      };
}

// ── Auto-shrink font to fit text within maxW (mm). Font face must be set first. ─
function fitText(doc, text, maxW, startSize, minSize = 7.5) {
  let fs = startSize;
  doc.setFontSize(fs);
  while (fs > minSize && doc.getTextWidth(text) > maxW) {
    fs -= 0.5;
    doc.setFontSize(fs);
  }
  return fs;
}

// ── Wrap + cap at maxLines, adding ellipsis if truncated ──────────────────────
function wrapCapped(doc, text, maxW, maxLines) {
  const lines = doc.splitTextToSize(String(text || ""), maxW);
  if (lines.length <= maxLines) return lines;
  const capped = lines.slice(0, maxLines);
  const last   = capped[maxLines - 1];
  capped[maxLines - 1] = last.length > 2 ? last.slice(0, -2) + "…" : last + "…";
  return capped;
}

// ══════════════════════════════════════════════════════════════════════════════
export async function exportInvoicePdf(
  inv,
  profile,
  invoiceSettings = {},
  { isReceipt = false, returnBase64 = false } = {}
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const W = doc.internal.pageSize.getWidth();   // 210 mm
  const H = doc.internal.pageSize.getHeight();  // 297 mm

  // ── Layout grid ───────────────────────────────────────────────────────────
  const ML       = 14;           // left margin
  const MR       = W - 14;       // right margin  (196 mm)
  const TW       = MR - ML;      // content width (182 mm)
  const PAD_H    = 3;            // horizontal inner padding for cells / cards
  const FOOTER_H = 20;
  const CONTENT_BOT = H - FOOTER_H - 4;  // 273 mm

  // Table column widths — must sum to TW
  const C_SN   = Math.round(TW * 0.06);  // 11 mm  — #
  const C_QTY  = Math.round(TW * 0.08);  // 15 mm  — QTY
  const C_UNIT = Math.round(TW * 0.18);  // 33 mm  — UNIT PRICE
  const C_AMT  = Math.round(TW * 0.18);  // 33 mm  — AMOUNT
  const C_DESC = TW - C_SN - C_QTY - C_UNIT - C_AMT;  // 90 mm — DESCRIPTION

  // Column left-edge X positions
  const X_SN   = ML;
  const X_DESC = X_SN   + C_SN;
  const X_QTY  = X_DESC + C_DESC;
  const X_UNIT = X_QTY  + C_QTY;
  const X_AMT  = X_UNIT + C_UNIT;
  // X_AMT + C_AMT === MR ✓

  // Anchor points used throughout (all amounts right-align at AMT_R)
  const AMT_R  = MR - PAD_H;           // 193 mm — right edge for all amounts
  const UNIT_R = X_AMT - PAD_H;        // 160 mm — right edge for unit prices
  const QTY_C  = X_QTY + C_QTY / 2;   // 122.5 mm — centre for QTY column
  const DESC_L = X_DESC + PAD_H;       //  28 mm — left for description text
  const SN_C   = X_SN + C_SN / 2;     //  19.5 mm — centre for # column

  // Totals block (starts aligned with QTY column — ~63% across the page)
  const TOT_X       = X_QTY;           // 115 mm
  const TOT_LABEL_X = TOT_X + PAD_H;   // 118 mm — labels left-align here
  const PAY_W       = TOT_X - ML - 6;  //  95 mm — payment details column

  // Row sizing
  const ROW_LINE_H = 4.8;  // mm per wrapped line
  const MIN_ROW_H  = 10;   // minimum row height
  const TOT_ROW_H  = 8;    // totals section row height

  // ── Business info ──────────────────────────────────────────────────────────
  const biz = {
    name:     profile?.business_name         || "My Business",
    phone:    invoiceSettings.contact_phone  || profile?.owner_phone         || "",
    email:    invoiceSettings.contact_email  || profile?.email               || "",
    address:  invoiceSettings.address        || profile?.address             || "",
    reg:      invoiceSettings.reg_number     || "",
    bank:     invoiceSettings.bank_name      || profile?.bank_name           || "",
    acctNo:   invoiceSettings.account_number || profile?.bank_account_number || "",
    acctName: invoiceSettings.account_name   || profile?.bank_account_name   || "",
    logo:     invoiceSettings.logo_url       || "",
    thanks:   invoiceSettings.thank_you_note
                || "Thank you for your business. We truly value your patronage.",
  };

  // ── Load assets ────────────────────────────────────────────────────────────
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [logoB64, appLogoB64, fontRegB64, fontMedB64] = await Promise.all([
    biz.logo ? imgToBase64(biz.logo) : Promise.resolve(null),
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

  const setReg  = (sz) => { doc.setFont(FONT, "normal"); if (sz) doc.setFontSize(sz); };
  const setMed  = (sz) => { doc.setFont(FONT, "bold");   if (sz) doc.setFontSize(sz); };
  const setItal = (sz) => { doc.setFont("helvetica", "italic"); if (sz) doc.setFontSize(sz); };
  const col     = (...c) => doc.setTextColor(...c);
  const splitW  = (txt, w) => doc.splitTextToSize(String(txt || ""), w);

  // ── Derived state ──────────────────────────────────────────────────────────
  const ss          = statusCfg(inv.status, isReceipt);
  const isPaid      = isReceipt || inv.status === "paid";
  const isOverdue   = inv.status === "overdue";
  const amtPaidKobo = inv.amount_paid_kobo || 0;
  const amtDueKobo  = Math.max(0, (inv.total_kobo || 0) - amtPaidKobo);
  const fullyPaid   = isPaid || amtDueKobo <= 0;
  const items       = mergeItems(inv.invoice_items || []);

  // ══════════════════════════════════════════════════════════════════════════
  // Per-page draw functions
  // ══════════════════════════════════════════════════════════════════════════

  function drawTopStrips() {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 4, "F");
    doc.setFillColor(...GREEN);
    doc.rect(0, 4, W, 2, "F");
  }

  function drawWatermark() {
    if (!isPaid) return;
    doc.saveGraphicsState();
    setMed(72);
    col(...GREEN);
    doc.setGState(new doc.GState({ opacity: 0.055 }));
    doc.text("PAID", W / 2, H / 2 + 10, { align: "center", angle: 45 });
    doc.restoreGraphicsState();
  }

  function drawFooter(pageNum, total) {
    const fy  = H - FOOTER_H;
    const fcY = fy + FOOTER_H / 2;
    doc.setFillColor(...NAVY);
    doc.rect(0, fy, W, FOOTER_H, "F");
    doc.setFillColor(...GREEN);
    doc.rect(0, H - 1.5, W, 1.5, "F");

    const ltSz = 10;
    const ltX  = ML;
    const ltY  = fy + (FOOTER_H - ltSz) / 2;
    if (appLogoB64) {
      doc.setFillColor(...WHITE);
      doc.roundedRect(ltX - 1, ltY - 1, ltSz + 2, ltSz + 2, 2, 2, "F");
      try { doc.addImage(appLogoB64, "PNG", ltX, ltY, ltSz, ltSz, "", "FAST"); } catch {}
    }
    const fTX = appLogoB64 ? ML + ltSz + 4 : ML;

    setMed(8);   col(...WHITE);
    doc.text("KudiAI Track", fTX, fcY - 3);
    setItal(7);  col(...LBLUE);
    doc.text(SLOGAN, fTX, fcY + 2.5);

    setReg(7); col(...LBLUE);
    doc.text(
      `A product of Amaya & Co. Technologies © ${new Date().getFullYear()}`,
      MR, fcY - 3, { align: "right" }
    );
    doc.text(`Page ${pageNum} of ${total}`, MR, fcY + 2.5, { align: "right" });
  }

  // Table header band — returns Y after the band
  function drawTableHeader(atY) {
    const HDR_H = 9.5;
    doc.setFillColor(...NAVY);
    doc.roundedRect(ML, atY, TW, HDR_H, 2.5, 2.5, "F");
    // Square off the bottom two corners
    doc.rect(ML, atY + 3, TW, HDR_H - 3, "F");

    setMed(7.5); col(...WHITE);
    const hY = atY + HDR_H / 2 + 2;   // vertically centred baseline

    doc.text("#",           SN_C,  hY, { align: "center" });
    doc.text("DESCRIPTION", DESC_L, hY);
    doc.text("QTY",         QTY_C, hY, { align: "center" });
    doc.text("UNIT PRICE",  UNIT_R, hY, { align: "right"  });
    doc.text("AMOUNT",      AMT_R,  hY, { align: "right"  });

    return atY + HDR_H;
  }

  // Slim repeat header for continuation pages — returns Y after header
  function drawSlimHeader(atY) {
    const nameW = TW / 2 - 4;
    setMed(9); col(...NAVY);
    doc.text(splitW(biz.name, nameW)[0], ML, atY + 5);
    setReg(8);  col(...SEC);
    doc.text(
      `${isReceipt ? "RECEIPT" : "INVOICE"} ${inv.invoice_number || ""}`,
      MR, atY + 5, { align: "right" }
    );
    doc.setDrawColor(...HAIRLN);
    doc.setLineWidth(0.3);
    doc.line(ML, atY + 8, MR, atY + 8);
    return atY + 13;
  }

  function newPage(inTable) {
    doc.addPage();
    drawTopStrips();
    drawWatermark();
    let ny = 8;
    ny = drawSlimHeader(ny);
    if (inTable) ny = drawTableHeader(ny);
    return ny;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1
  // ══════════════════════════════════════════════════════════════════════════
  drawTopStrips();
  drawWatermark();

  let y = 8;   // below the 6 mm top strips

  // ── HEADER: logo/biz-info (left) + INVOICE title/badge (right) ────────────
  // Reserve HDR_RIGHT_W mm for the right block; enforce HDR_GAP min gap.
  const TILE        = 19;
  const HDR_GAP     = 8;
  const HDR_RIGHT_W = 70;
  const HDR_LEFT_LIM = MR - HDR_RIGHT_W - HDR_GAP;  // max x for left content

  const tileX = ML;
  const tileY = y;

  if (logoB64) {
    doc.setFillColor(...PANEL);
    doc.roundedRect(tileX, tileY, TILE, TILE, 3, 3, "F");
    try {
      doc.addImage(logoB64, getImgFmt(logoB64), tileX + 1, tileY + 1, TILE - 2, TILE - 2, "", "FAST");
    } catch {}
  } else {
    doc.setFillColor(...NAVY);
    doc.roundedRect(tileX, tileY, TILE, TILE, 3, 3, "F");
    setMed(initials(biz.name).length > 2 ? 8 : 11);
    col(...WHITE);
    doc.text(initials(biz.name) || "?", tileX + TILE / 2, tileY + TILE / 2 + 1.5, { align: "center" });
  }

  // Business info — constrained to the left block
  const bizInfoX = tileX + TILE + 5;
  const bizInfoW = HDR_LEFT_LIM - bizInfoX;
  let bizY = tileY + 4;

  setMed(11); col(...NAVY);
  const bizNameLines = splitW(biz.name, bizInfoW).slice(0, 2);
  doc.text(bizNameLines, bizInfoX, bizY);
  bizY += bizNameLines.length * 5.2 + 1;

  setReg(7.5); col(...MUTED);
  if (biz.reg) {
    doc.text(`RC: ${biz.reg}`, bizInfoX, bizY); bizY += 4;
  }
  if (biz.address) {
    doc.text(splitW(biz.address, bizInfoW)[0], bizInfoX, bizY); bizY += 4;
  }
  const contact = [biz.phone, biz.email].filter(Boolean).join("  ·  ");
  if (contact) {
    doc.text(splitW(contact, bizInfoW)[0], bizInfoX, bizY);
  }

  // Right block: INVOICE / RECEIPT title + status badge
  let invY = tileY + 5.5;
  setMed(24); col(...NAVY);
  doc.setCharSpace(1.2);
  doc.text(isReceipt ? "RECEIPT" : "INVOICE", MR, invY, { align: "right" });
  doc.setCharSpace(0);
  invY += 7;

  setMed(7.5);
  const bw = doc.getTextWidth(ss.text) + 10;
  const bh = 7;
  const bx = MR - bw;
  doc.setFillColor(...ss.tint);
  doc.setDrawColor(...ss.border); doc.setLineWidth(0.6);
  doc.roundedRect(bx, invY, bw, bh, 2, 2, "FD");
  col(...ss.pill);
  doc.text(ss.text, bx + bw / 2, invY + 4.9, { align: "center" });

  y = Math.max(tileY + TILE + 6, invY + bh + 6);

  // ── META BAR ───────────────────────────────────────────────────────────────
  const metaH = 18;
  doc.setFillColor(...PANEL);
  doc.roundedRect(ML, y, TW, metaH, 3, 3, "F");

  const todayStr = new Date().toISOString().slice(0, 10);
  const metaCols = [
    { label: isReceipt ? "RECEIPT NO." : "INVOICE NO.", val: inv.invoice_number || "—" },
    { label: "ISSUE DATE", val: dateFmtShort(inv.issue_date || todayStr) },
    ...(!isReceipt && inv.due_date ? [{ label: "DUE DATE", val: dateFmtShort(inv.due_date) }] : []),
    ...(fullyPaid ? [{ label: "PAID ON", val: dateFmtShort(todayStr), green: true }] : []),
  ];
  const colCount = Math.max(metaCols.length, 3);
  const mStep    = TW / colCount;

  metaCols.forEach((mc, i) => {
    const colL = ML + i * mStep + PAD_H + 2;
    const colW = mStep - (PAD_H + 2) * 2;

    setReg(6.5); col(...MUTED); doc.setCharSpace(0.7);
    doc.text(mc.label, colL, y + 6);
    doc.setCharSpace(0);

    // Value — one line, auto-shrink if too long for the column
    setMed(8.5); col(...(mc.green ? GREEN : DARK));
    const valText = splitW(mc.val, colW)[0] || mc.val;
    fitText(doc, valText, colW, 8.5, 6.5);
    doc.text(valText, colL, y + 13.5);
    doc.setFontSize(8.5);
  });

  y += metaH + 6;

  // ── BILL TO + AMOUNT PANELS ────────────────────────────────────────────────
  const panelW  = (TW - 6) / 2;   // ~88 mm each
  const panelH  = 34;
  const billX   = ML;
  const amtPX   = ML + panelW + 6;
  const cardPad = 4;               // inner padding for both panels

  // Bill To panel
  doc.setFillColor(...LTGREEN);
  doc.roundedRect(billX, y, panelW, panelH, 3, 3, "F");
  doc.setFillColor(...GREEN);
  doc.roundedRect(billX, y, 3, panelH, 1.5, 1.5, "F");

  const billCX = billX + cardPad + 3;
  const billCW = panelW - cardPad * 2 - 3;
  let btY = y + cardPad + 1.5;

  setReg(6.5); col(...SEC); doc.setCharSpace(0.7);
  doc.text("BILL TO", billCX, btY); doc.setCharSpace(0); btY += 5;

  setMed(10); col(...NAVY);
  const custLines = splitW(inv.customer_name || "—", billCW).slice(0, 2);
  doc.text(custLines, billCX, btY); btY += custLines.length * 5 + 1;

  setReg(8); col(...SEC);
  if (inv.customer_phone) { doc.text(inv.customer_phone, billCX, btY); btY += 4.5; }
  if (inv.customer_email) { doc.text(splitW(inv.customer_email, billCW)[0], billCX, btY); }

  // Amount panel
  if (fullyPaid) {
    doc.setFillColor(...TGREEN);
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.6);
  } else if (isOverdue) {
    doc.setFillColor(...TRED);
    doc.setDrawColor(...RED); doc.setLineWidth(0.6);
  } else {
    doc.setFillColor(...PANEL);
    doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.4);
  }
  doc.roundedRect(amtPX, y, panelW, panelH, 3, 3, "FD");

  const amtCX = amtPX + cardPad;
  const amtCW = panelW - cardPad * 2;
  let amY = y + cardPad + 1.5;

  setReg(6.5); col(...SEC); doc.setCharSpace(0.7);
  doc.text(fullyPaid ? "AMOUNT PAID" : "AMOUNT DUE", amtCX, amY);
  doc.setCharSpace(0); amY += 6;

  setMed(14); col(...(fullyPaid ? GREEN : isOverdue ? RED : NAVY));
  const heroAmt = fmtK(fullyPaid ? inv.total_kobo : amtDueKobo);
  fitText(doc, heroAmt, amtCW, 14, 9);
  doc.text(heroAmt, amtCX, amY);
  doc.setFontSize(14); amY += 6;

  setReg(7.5);
  if (fullyPaid) {
    col(...GREEN);
    doc.text("✓ Fully paid  ·  Balance ₦0.00", amtCX, amY);
  } else {
    col(...SEC);
    if (inv.due_date) { doc.text(`Due: ${dateFmtShort(inv.due_date)}`, amtCX, amY); amY += 4.5; }
    if (amtPaidKobo > 0) { col(...GREEN); doc.text(`Paid: ${fmtK(amtPaidKobo)}`, amtCX, amY); }
  }

  y += panelH + 8;

  // ── LINE ITEMS TABLE ────────────────────────────────────────────────────────
  y = drawTableHeader(y);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Description: max 3 lines, ellipsis on overflow
    const descLns = wrapCapped(doc, item.description || "", C_DESC - PAD_H * 2, 3);
    const rowH    = Math.max(MIN_ROW_H, descLns.length * ROW_LINE_H + 5);

    if (y + rowH > CONTENT_BOT) {
      y = newPage(true);
    }

    // Row hairline
    doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.2);
    doc.line(ML, y, MR, y);

    // Vertical midpoint for single-value cells
    const rMidY = y + rowH / 2 + 1.8;

    // Description start: vertically centred block
    const descStartY = y + (rowH - descLns.length * ROW_LINE_H) / 2 + ROW_LINE_H - 0.5;

    // # — centred in SN column
    setMed(8); col(...GREEN);
    doc.text(String(i + 1), SN_C, rMidY, { align: "center" });

    // Description
    setReg(9.5); col(...DARK);
    descLns.forEach((ln, li) => doc.text(ln, DESC_L, descStartY + li * ROW_LINE_H));

    // QTY — centred
    setReg(9.5); col(...SEC);
    doc.text(String(item.quantity || 1), QTY_C, rMidY, { align: "center" });

    // Unit price — right-aligned at UNIT_R, auto-shrink
    const unitTxt = fmtK(item.unit_price_kobo);
    fitText(doc, unitTxt, C_UNIT - PAD_H * 2, 9.5, 7.5);
    doc.text(unitTxt, UNIT_R, rMidY, { align: "right" });
    doc.setFontSize(9.5);

    // Amount — right-aligned at AMT_R, auto-shrink, medium weight
    setMed(9.5); col(...DARK);
    const amtTxt = fmtK(item.line_total_kobo);
    fitText(doc, amtTxt, C_AMT - PAD_H * 2, 9.5, 7.5);
    doc.text(amtTxt, AMT_R, rMidY, { align: "right" });
    doc.setFontSize(9.5);

    y += rowH;
  }

  // Table closing hairline
  doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.2);
  doc.line(ML, y, MR, y);
  y += 6;

  // ── TOTALS + PAYMENT DETAILS BLOCK ─────────────────────────────────────────
  const totRows = [
    { label: "Subtotal",    val: fmtK(inv.subtotal_kobo) },
    ...(inv.discount_kobo > 0
      ? [{ label: "Discount",   val: `−${fmtK(inv.discount_kobo)}`, red: true }] : []),
    ...(inv.vat_kobo > 0
      ? [{ label: "VAT (7.5%)", val: fmtK(inv.vat_kobo) }] : []),
    ...((inv.other_charges_kobo || 0) > 0
      ? [{ label: inv.other_charges_label || "Other Charges", val: fmtK(inv.other_charges_kobo) }] : []),
  ];

  const pmtRows = [
    biz.bank     ? ["Bank",         biz.bank    ] : null,
    biz.acctNo   ? ["Account No.",  biz.acctNo  ] : null,
    biz.acctName ? ["Account Name", biz.acctName] : null,
    inv.payment_instructions ? ["Instructions", inv.payment_instructions] : null,
  ].filter(Boolean);

  const thanksLns = biz.thanks ? splitW(biz.thanks, TW - 8) : [];

  const TOTAL_BAR_H = 11;
  const totH  = totRows.length * TOT_ROW_H + TOTAL_BAR_H + 6
    + (amtPaidKobo > 0 ? TOT_ROW_H : 0)
    + (amtDueKobo > 0 && amtPaidKobo > 0 ? TOT_ROW_H : 0);
  const payH  = pmtRows.length > 0 ? pmtRows.length * 14 + 14 : 0;
  const notesH  = inv.notes ? (splitW(inv.notes, TW).length * 5.2 + 14) : 0;
  const thankH  = thanksLns.length > 0 ? thanksLns.length * 5.5 + 14 : 0;
  const blockH  = Math.max(totH, payH) + notesH + thankH + 8;

  if (y + blockH > CONTENT_BOT) {
    y = newPage(false);
  }

  const blockTop = y;
  let ty = blockTop;

  // Totals column — labels at TOT_LABEL_X, amounts at AMT_R
  for (const row of totRows) {
    const rowBase = ty + 5.5;
    setReg(9.5); col(...(row.red ? RED : SEC));
    doc.text(row.label, TOT_LABEL_X, rowBase);
    setMed(9.5); col(...(row.red ? RED : DARK));
    fitText(doc, row.val, C_AMT - PAD_H * 2, 9.5, 7.5);
    doc.text(row.val, AMT_R, rowBase, { align: "right" });
    doc.setFontSize(9.5);
    ty += TOT_ROW_H;
  }

  // TOTAL DUE / TOTAL RECEIVED bar — spans from TOT_X to MR
  const tdBarW = MR - TOT_X;
  doc.setFillColor(...NAVY);
  doc.roundedRect(TOT_X, ty, tdBarW, TOTAL_BAR_H, 2.5, 2.5, "F");
  const tdBase = ty + TOTAL_BAR_H / 2 + 2.5;
  setMed(9.5); col(...WHITE);
  doc.text(isReceipt ? "TOTAL RECEIVED" : "TOTAL DUE", TOT_LABEL_X, tdBase);
  const totalTxt = fmtK(inv.total_kobo);
  fitText(doc, totalTxt, C_AMT - PAD_H * 2, 9.5, 7.5);
  doc.text(totalTxt, AMT_R, tdBase, { align: "right" });
  doc.setFontSize(9.5);
  ty += TOTAL_BAR_H + 5;

  if (amtPaidKobo > 0) {
    const paidBase = ty + 5.5;
    setReg(9.5); col(...GREEN);
    doc.text("Amount Paid", TOT_LABEL_X, paidBase);
    setMed(9.5); col(...GREEN);
    const paidTxt = fmtK(amtPaidKobo);
    fitText(doc, paidTxt, C_AMT - PAD_H * 2, 9.5, 7.5);
    doc.text(paidTxt, AMT_R, paidBase, { align: "right" });
    doc.setFontSize(9.5);
    ty += TOT_ROW_H;

    if (amtDueKobo > 0) {
      const balBase = ty + 5.5;
      setReg(9.5); col(...RED);
      doc.text("Balance Due", TOT_LABEL_X, balBase);
      setMed(9.5); col(...RED);
      const balTxt = fmtK(amtDueKobo);
      fitText(doc, balTxt, C_AMT - PAD_H * 2, 9.5, 7.5);
      doc.text(balTxt, AMT_R, balBase, { align: "right" });
      doc.setFontSize(9.5);
      ty += TOT_ROW_H;
    }
  }

  // Payment details — left column
  if (pmtRows.length > 0) {
    let py = blockTop;
    setMed(7.5); col(...NAVY); doc.setCharSpace(0.5);
    doc.text("PAYMENT DETAILS", ML, py + 5.5); doc.setCharSpace(0);
    doc.setFillColor(...NAVY);
    doc.rect(ML, py + 8, 24, 0.5, "F");
    py += 14;

    for (const [lbl, val] of pmtRows) {
      setReg(8);   col(...MUTED); doc.text(lbl, ML, py); py += 4;
      setMed(9.5); col(...DARK);
      const vLines = splitW(val, PAY_W).slice(0, 2);
      doc.text(vLines, ML, py);
      py += vLines.length * 5.2 + 3;
    }
  }

  y = Math.max(ty, blockTop + Math.max(totH, payH)) + 6;

  // ── NOTES ──────────────────────────────────────────────────────────────────
  if (inv.notes) {
    setReg(7.5); col(...MUTED); doc.setCharSpace(0.5);
    doc.text("NOTES", ML, y); doc.setCharSpace(0); y += 5;
    setItal(9.5); col(...SEC);
    const nLns = splitW(inv.notes, TW);
    doc.text(nLns, ML, y);
    y += nLns.length * 5.2 + 6;
  }

  // ── THANK-YOU ──────────────────────────────────────────────────────────────
  if (thanksLns.length > 0) {
    doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.3);
    doc.line(ML, y, MR, y); y += 6;
    setItal(9); col(...MUTED);
    doc.text(thanksLns, ML + TW / 2, y, { align: "center" });
  }

  // ── FOOTER on every page ────────────────────────────────────────────────────
  const totalPages = doc.internal.pages.length - 1;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(p, totalPages);
  }

  // ── OUTPUT ──────────────────────────────────────────────────────────────────
  const prefix = isReceipt ? "receipt" : "invoice";
  const fname  = `${prefix}_${(inv.invoice_number || Date.now()).toString().replace(/\//g, "-")}.pdf`;
  if (returnBase64) return doc.output("datauristring").split(",")[1];
  await savePdf(doc, fname);
}
