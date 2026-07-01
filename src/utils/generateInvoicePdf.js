import { savePdf } from "./pdfSave";

const koboToNaira = (k) => (k || 0) / 100;
const fmtK = (k) => `₦${koboToNaira(k).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

function dateFmt(str) {
  if (!str) return "";
  return new Date(str + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

// Fetch image as base64 with a 4-second timeout
async function imgToBase64(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror  = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

function statusStyle(status, isReceipt) {
  if (isReceipt)                    return { text: "RECEIPT",  bg: [22,163,74],   fg: [255,255,255] };
  if (status === "paid")            return { text: "PAID",     bg: [22,163,74],   fg: [255,255,255] };
  if (status === "overdue")         return { text: "OVERDUE",  bg: [220,38,38],   fg: [255,255,255] };
  if (status === "cancelled")       return { text: "VOID",     bg: [100,116,139], fg: [255,255,255] };
  if (status === "partially_paid")  return { text: "PARTIAL",  bg: [217,119,6],   fg: [255,255,255] };
  if (status === "sent")            return { text: "SENT",     bg: [37,99,235],   fg: [255,255,255] };
  return                                   { text: "DRAFT",    bg: [148,163,184], fg: [255,255,255] };
}

const NAVY  = [27, 42, 94];
const BLUE  = [37, 99, 235];
const SLATE = [71, 85, 105];
const DARK  = [15, 23, 42];
const LIGHT = [248, 250, 252];
const MID   = [226, 232, 240];
const WHITE = [255, 255, 255];

const SLOGAN = "Talk your money. Track your profit. Grow your business.";

export async function exportInvoicePdf(inv, profile, invoiceSettings = {}, { isReceipt = false } = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W  = doc.internal.pageSize.getWidth();   // 210mm
  const H  = doc.internal.pageSize.getHeight();  // 297mm
  const ML = 18;
  const MR = W - 18;
  const TW = MR - ML;

  // ── Business info ────────────────────────────────────────────────────────
  const biz = {
    name:     profile?.business_name      || "My Business",
    phone:    invoiceSettings.contact_phone   || profile?.owner_phone    || "",
    email:    invoiceSettings.contact_email   || profile?.email          || "",
    address:  invoiceSettings.address         || profile?.address         || "",
    reg:      invoiceSettings.reg_number      || "",
    bank:     invoiceSettings.bank_name       || profile?.bank_name       || "",
    acctNo:   invoiceSettings.account_number  || profile?.bank_account_number || "",
    acctName: invoiceSettings.account_name    || profile?.bank_account_name   || "",
    logo:     invoiceSettings.logo_url        || "",
    thanks:   invoiceSettings.thank_you_note  || "Thank you for your business. We truly value your patronage.",
  };

  // ── Load images in parallel ──────────────────────────────────────────────
  const [logoB64, appLogoB64] = await Promise.all([
    biz.logo ? imgToBase64(biz.logo) : Promise.resolve(null),
    imgToBase64(`${window.location.origin}/logo.png`),
  ]);

  // ── HEADER BAND ──────────────────────────────────────────────────────────
  // Full-width navy gradient band
  const BAND_H = 38;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, BAND_H, "F");

  // Decorative diagonal accent stripe inside band
  doc.setFillColor(37, 58, 110); // slightly lighter navy
  doc.triangle(W - 60, 0, W, 0, W, BAND_H, "F");

  // Business logo inside band (top-left)
  const LOGO_BOX = 24;
  const LOGO_X   = ML;
  const LOGO_Y   = (BAND_H - LOGO_BOX) / 2;
  if (logoB64) {
    // White rounded container behind logo
    doc.setFillColor(...WHITE);
    doc.roundedRect(LOGO_X - 1, LOGO_Y - 1, LOGO_BOX + 2, LOGO_BOX + 2, 3, 3, "F");
    try { doc.addImage(logoB64, "JPEG", LOGO_X, LOGO_Y, LOGO_BOX, LOGO_BOX, "", "FAST"); } catch {}
  }

  // Business name + reg in band (right of logo or left-aligned)
  const textStartX = logoB64 ? LOGO_X + LOGO_BOX + 6 : ML;
  let bandY = LOGO_Y + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...WHITE);
  doc.text(biz.name, textStartX, bandY);
  bandY += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(180, 196, 230);
  if (biz.reg)     { doc.text(`Reg: ${biz.reg}`, textStartX, bandY); bandY += 4; }
  if (biz.address) {
    const aLines = doc.splitTextToSize(biz.address, 90);
    doc.text(aLines[0], textStartX, bandY);
    bandY += 4;
  }
  const contactParts = [biz.phone, biz.email].filter(Boolean).join("  ·  ");
  if (contactParts) doc.text(contactParts, textStartX, bandY);

  // ── INVOICE / RECEIPT TITLE ROW ─────────────────────────────────────────
  let y = BAND_H + 10;

  // Title left
  const ss = statusStyle(inv.status, isReceipt);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(...NAVY);
  doc.text(isReceipt ? "RECEIPT" : "INVOICE", ML, y);

  // Status badge (pill) — right side of title
  const badgeText  = ss.text;
  doc.setFontSize(8);
  const badgeW = doc.getTextWidth(badgeText) + 8;
  const badgeX = MR - badgeW;
  const badgeY = y - 7;
  doc.setFillColor(...ss.bg);
  doc.roundedRect(badgeX, badgeY, badgeW, 8, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...ss.fg);
  doc.text(badgeText, badgeX + 4, badgeY + 5.5);

  y += 5;

  // ── META GRID — invoice number, dates ───────────────────────────────────
  // Light separator
  doc.setDrawColor(...MID);
  doc.setLineWidth(0.3);
  doc.line(ML, y, MR, y);
  y += 5;

  // Two-column meta layout
  const metaRows = [
    [isReceipt ? "RECEIPT NO." : "INVOICE NO.", inv.invoice_number || "—"],
    ["ISSUE DATE",   dateFmt(inv.issue_date) || dateFmt(new Date().toISOString().slice(0, 10))],
    ...((!isReceipt && inv.due_date) ? [["DUE DATE", dateFmt(inv.due_date)]] : []),
    ...(isReceipt ? [["PAID DATE", dateFmt(new Date().toISOString().slice(0, 10))]] : []),
  ];

  const colW    = TW / 2 - 4;
  const perRow  = 2;
  for (let i = 0; i < metaRows.length; i += perRow) {
    const rowPairs = metaRows.slice(i, i + perRow);
    const curY = y;
    rowPairs.forEach(([label, val], j) => {
      const cx = ML + j * (colW + 8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...SLATE);
      doc.text(label, cx, curY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...DARK);
      doc.text(String(val || "—"), cx, curY + 5);
    });
    y += 12;
  }

  y += 2;

  // ── BILL TO + PAYMENT SUMMARY ─────────────────────────────────────────────
  const halfW  = TW / 2 - 3;
  const billX  = ML;
  const summX  = ML + halfW + 6;

  // Bill To box
  doc.setFillColor(...LIGHT);
  doc.roundedRect(billX, y, halfW, 32, 3, 3, "F");
  doc.setDrawColor(...MID);
  doc.setLineWidth(0.3);
  doc.roundedRect(billX, y, halfW, 32, 3, 3, "S");

  // Blue left accent on Bill To
  doc.setFillColor(...BLUE);
  doc.roundedRect(billX, y, 3, 32, 1.5, 1.5, "F");

  let btY = y + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...SLATE);
  doc.text("BILL TO", billX + 6, btY);
  btY += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text(doc.splitTextToSize(inv.customer_name || "—", halfW - 10)[0], billX + 6, btY);
  btY += 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE);
  if (inv.customer_phone) { doc.text(inv.customer_phone, billX + 6, btY); btY += 4.5; }
  if (inv.customer_email) { doc.text(doc.splitTextToSize(inv.customer_email, halfW - 10)[0], billX + 6, btY); }

  // Summary box (right)
  doc.setFillColor(...LIGHT);
  doc.roundedRect(summX, y, halfW, 32, 3, 3, "F");
  doc.setDrawColor(...MID);
  doc.setLineWidth(0.3);
  doc.roundedRect(summX, y, halfW, 32, 3, 3, "S");

  const amtDue = inv.total_kobo - inv.amount_paid_kobo;
  const isFullyPaid = amtDue <= 0;

  let smY = y + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...SLATE);
  doc.text(isFullyPaid ? "AMOUNT PAID" : "AMOUNT DUE", summX + 5, smY);
  smY += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(isFullyPaid ? 22 : 27, isFullyPaid ? 163 : 42, isFullyPaid ? 74 : 94);
  doc.text(fmtK(isFullyPaid ? inv.total_kobo : amtDue), summX + 5, smY);
  smY += 6;
  if (inv.due_date && !isReceipt) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text(`Due: ${dateFmt(inv.due_date)}`, summX + 5, smY);
  }
  if (inv.amount_paid_kobo > 0 && !isFullyPaid) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(22, 163, 74);
    doc.text(`Paid: ${fmtK(inv.amount_paid_kobo)}`, summX + 5, smY);
  }
  if (isFullyPaid) {
    smY += 1;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(22, 163, 74);
    doc.text("✓ Fully Paid", summX + 5, smY);
  }

  y += 38;

  // ── ITEMS TABLE ──────────────────────────────────────────────────────────
  // Column widths (mm): S/N=9, Desc=flexible, Qty=12, Unit=30, Amount=28
  const cSN   = 9;
  const cAmt  = 30;
  const cUnit = 30;
  const cQty  = 12;
  const cDesc = TW - cSN - cQty - cUnit - cAmt;

  const cX = [
    ML,
    ML + cSN,
    ML + cSN + cDesc,
    ML + cSN + cDesc + cQty,
    ML + cSN + cDesc + cQty + cUnit,
  ];

  // Header row
  const tHdrH = 9;
  doc.setFillColor(...NAVY);
  doc.roundedRect(ML, y, TW, tHdrH, 2, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...WHITE);
  const hdrY = y + 6;
  doc.text("#",          cX[0] + 2,   hdrY);
  doc.text("DESCRIPTION",cX[1] + 2,   hdrY);
  doc.text("QTY",        cX[2] + 2,   hdrY);
  doc.text("UNIT PRICE", cX[3] + 2,   hdrY);
  doc.text("AMOUNT",     MR,           hdrY, { align: "right" });
  y += tHdrH;

  const items = inv.invoice_items || [];
  items.forEach((item, i) => {
    const descLines = doc.splitTextToSize(item.description || "", cDesc - 4);
    const rowH = Math.max(10, descLines.length * 4.5 + 4);

    if (i % 2 === 0) {
      doc.setFillColor(249, 250, 252);
      doc.rect(ML, y, TW, rowH, "F");
    }
    doc.setDrawColor(...MID);
    doc.setLineWidth(0.15);
    doc.line(ML, y + rowH, MR, y + rowH);

    const rY = y + 6.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text(String(i + 1), cX[0] + 2.5, rY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    descLines.forEach((line, li) => doc.text(line, cX[1] + 2, rY + li * 4.5));

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...SLATE);
    doc.text(String(item.quantity || 1), cX[2] + 2, rY);
    doc.text(fmtK(item.unit_price_kobo),  cX[3] + 2, rY);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text(fmtK(item.line_total_kobo), MR, rY, { align: "right" });

    y += rowH;
  });

  y += 6;

  // ── TOTALS BLOCK ─────────────────────────────────────────────────────────
  const tBW  = 78;
  const tBX  = MR - tBW;

  const drawTotRow = (label, val, highlight = false, isRed = false, isGreen = false) => {
    if (highlight) {
      doc.setFillColor(...NAVY);
      doc.roundedRect(tBX - 2, y - 5, tBW + 2, 10, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...WHITE);
      doc.text(label, tBX + 2, y);
      doc.text(val,   MR,      y, { align: "right" });
      y += 13;
    } else {
      doc.setFont("helvetica", isRed || isGreen ? "bold" : "normal");
      doc.setFontSize(8);
      const [lr, lg, lb] = isRed ? [220,38,38] : isGreen ? [22,163,74] : SLATE;
      const [vr, vg, vb] = isRed ? [220,38,38] : isGreen ? [22,163,74] : DARK;
      doc.setTextColor(lr, lg, lb);
      doc.text(label, tBX + 2, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(vr, vg, vb);
      doc.text(val, MR, y, { align: "right" });
      y += 7;
    }
  };

  doc.setDrawColor(...MID);
  doc.setLineWidth(0.3);
  doc.line(tBX - 2, y - 3, MR, y - 3);
  y += 2;

  drawTotRow("Subtotal",    fmtK(inv.subtotal_kobo));
  if (inv.discount_kobo > 0) drawTotRow("Discount",   `−${fmtK(inv.discount_kobo)}`, false, true);
  if (inv.vat_kobo > 0)      drawTotRow("VAT (7.5%)", fmtK(inv.vat_kobo));

  drawTotRow(isReceipt ? "TOTAL RECEIVED" : "TOTAL DUE", fmtK(inv.total_kobo), true);

  if (inv.amount_paid_kobo > 0) {
    drawTotRow("Amount Paid",  fmtK(inv.amount_paid_kobo), false, false, true);
    const bal = inv.total_kobo - inv.amount_paid_kobo;
    if (bal > 0) drawTotRow("Balance Due", fmtK(bal), false, true);
  }

  y += 4;

  // ── PAYMENT DETAILS ───────────────────────────────────────────────────────
  const hasBank = biz.bank || biz.acctNo;
  if (hasBank || inv.payment_instructions) {
    doc.setFillColor(...LIGHT);
    doc.setDrawColor(...MID);
    doc.setLineWidth(0.3);

    // Section heading with left accent
    doc.setFillColor(...NAVY);
    doc.roundedRect(ML, y, 3, 5, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...NAVY);
    doc.text("PAYMENT DETAILS", ML + 5, y + 4);
    y += 9;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...DARK);
    const pmtLines = [
      hasBank && biz.bank     ? `Bank: ${biz.bank}` : null,
      hasBank && biz.acctNo   ? `Account Number: ${biz.acctNo}` : null,
      hasBank && biz.acctName ? `Account Name: ${biz.acctName}` : null,
      inv.payment_instructions || null,
    ].filter(Boolean);

    pmtLines.forEach(l => {
      const wrapped = doc.splitTextToSize(l, TW);
      doc.text(wrapped, ML, y);
      y += wrapped.length * 5;
    });
    y += 4;
  }

  // ── NOTES ─────────────────────────────────────────────────────────────────
  if (inv.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE);
    doc.text("NOTES", ML, y);
    y += 5;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    const noteLines = doc.splitTextToSize(inv.notes, TW);
    doc.text(noteLines, ML, y);
    y += noteLines.length * 5 + 4;
  }

  // ── THANK-YOU NOTE ────────────────────────────────────────────────────────
  if (biz.thanks && y < H - 35) {
    // Decorative thank-you box
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(191, 219, 254);
    doc.setLineWidth(0.3);
    const thankLines = doc.splitTextToSize(biz.thanks, TW - 12);
    const boxH = thankLines.length * 5 + 10;
    doc.roundedRect(ML, y, TW, boxH, 3, 3, "FD");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(30, 64, 175);
    doc.text(thankLines, ML + 6, y + 7);
    y += boxH + 4;
  }

  // ── WATERMARK (diagonal status text) ─────────────────────────────────────
  doc.saveGraphicsState();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(56);
  doc.setTextColor(...ss.bg);
  doc.setGState(new doc.GState({ opacity: 0.05 }));
  doc.text(ss.text, W / 2 + 20, H / 2 - 10, { align: "center", angle: 45 });
  doc.restoreGraphicsState();

  // ── FOOTER ─────────────────────────────────────────────────────────────────
  const footH = 20;
  doc.setFillColor(...NAVY);
  doc.rect(0, H - footH, W, footH, "F");

  // KudiAI Track logo in footer
  const fIconSize = 10;
  const fIconX    = ML;
  const fIconY    = H - footH + (footH - fIconSize) / 2;
  if (appLogoB64) {
    try {
      doc.setFillColor(...WHITE);
      doc.roundedRect(fIconX - 1, fIconY - 1, fIconSize + 2, fIconSize + 2, 2, 2, "F");
      doc.addImage(appLogoB64, "PNG", fIconX, fIconY, fIconSize, fIconSize, "", "FAST");
    } catch {}
  }

  const fTextX  = appLogoB64 ? ML + fIconSize + 5 : ML;
  const fCenterY = H - footH / 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  doc.text("KudiAI Track", fTextX, fCenterY - 3);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(6);
  doc.setTextColor(148, 172, 220);
  doc.text(SLOGAN, fTextX, fCenterY + 2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(100, 126, 180);
  doc.text(
    `A product of Amaya & Co. Technologies © ${new Date().getFullYear()}`,
    MR, fCenterY, { align: "right" }
  );

  // Page number
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(148, 172, 220);
  doc.text("Page 1 of 1", MR, fCenterY + 5, { align: "right" });

  const prefix = isReceipt ? "receipt" : "invoice";
  await savePdf(doc, `${prefix}_${(inv.invoice_number || Date.now()).toString().replace(/\//g, "-")}.pdf`);
}
