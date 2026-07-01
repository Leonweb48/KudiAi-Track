import { savePdf } from "./pdfSave";

const koboToNaira = (k) => (k || 0) / 100;
const fmtK = (k) => `₦${koboToNaira(k).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

function dateFmt(str) {
  if (!str) return "";
  return new Date(str + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

async function imgToBase64(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

function ribbonText(status) {
  if (status === "paid")           return { text: "PAID",    color: [22, 163, 74] };
  if (status === "overdue")        return { text: "OVERDUE", color: [220, 38, 38] };
  if (status === "cancelled")      return { text: "VOID",    color: [100, 116, 139] };
  if (status === "partially_paid") return { text: "PARTIAL", color: [217, 119, 6] };
  return                                  { text: "UNPAID",  color: [37, 99, 235] };
}

const SLOGAN = "Talk your money. Track your profit. Grow your business.";

export async function exportInvoicePdf(inv, profile, invoiceSettings = {}, { isReceipt = false } = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = doc.internal.pageSize.getWidth();   // 210
  const H = doc.internal.pageSize.getHeight();  // 297
  const ML = 15;  // left margin
  const MR = W - 15;  // right margin
  const TW = MR - ML;  // text width

  // ── 0. Merge profile + invoiceSettings for display ───────────────────────
  const biz = {
    name:    profile?.business_name || "My Business",
    phone:   invoiceSettings.contact_phone  || profile?.owner_phone    || "",
    email:   invoiceSettings.contact_email  || profile?.email          || "",
    address: invoiceSettings.address        || profile?.address         || "",
    reg:     invoiceSettings.reg_number     || "",
    bank:    invoiceSettings.bank_name      || profile?.bank_name       || "",
    acctNo:  invoiceSettings.account_number || profile?.bank_account_number || "",
    acctName:invoiceSettings.account_name   || profile?.bank_account_name   || "",
    logo:    invoiceSettings.logo_url       || "",
    thanks:  invoiceSettings.thank_you_note || "Thank you for your business!",
  };

  // ── 1. Logo (async, best-effort) ─────────────────────────────────────────
  let logoB64 = null;
  if (biz.logo) logoB64 = await imgToBase64(biz.logo);
  // Also try to load the app icon for the footer
  let iconB64 = null;
  try { iconB64 = await imgToBase64(`${window.location.origin}/icon.png`); } catch {}

  // ── 2. Header section ────────────────────────────────────────────────────
  // Clean white bg — no colored header bar
  let y = ML;

  // Logo (top-left, 20×20 mm)
  const logoSize = 22;
  if (logoB64) {
    try { doc.addImage(logoB64, "PNG", ML, y, logoSize, logoSize, "", "FAST"); }
    catch {}
  }

  // Business name + details (top-right)
  const bzX = MR;
  let by = y + 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(biz.name, bzX, by, { align: "right" });
  by += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  if (biz.reg)     { doc.text(`Reg. No: ${biz.reg}`, bzX, by, { align: "right" }); by += 4; }
  if (biz.address) {
    const aLines = doc.splitTextToSize(biz.address, 80);
    doc.text(aLines, bzX, by, { align: "right" });
    by += aLines.length * 4;
  }
  const contactLine = [biz.phone, biz.email].filter(Boolean).join("  |  ");
  if (contactLine) { doc.text(contactLine, bzX, by, { align: "right" }); by += 4; }

  y = Math.max(y + logoSize + 4, by + 3);

  // ── 3. Horizontal divider ────────────────────────────────────────────────
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(ML, y, MR, y);
  y += 7;

  // ── 4. INVOICE / RECEIPT title + meta block ──────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(isReceipt ? 22 : 15, isReceipt ? 163 : 23, isReceipt ? 74 : 42);
  doc.text(isReceipt ? "RECEIPT" : "INVOICE", ML, y + 2);

  // Right: Invoice No + Dates (stacked)
  const metaLX = MR - 65;
  const metaVX = MR;
  let my = y - 2;

  const addMeta = (label, value) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(label, metaLX, my);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(value || "—", metaVX, my, { align: "right" });
    my += 5.5;
  };

  addMeta(isReceipt ? "RECEIPT NO" : "INVOICE NO", inv.invoice_number || "—");
  addMeta("DATE", dateFmt(inv.issue_date) || dateFmt(new Date().toISOString().slice(0, 10)));
  if (!isReceipt && inv.due_date) addMeta("DUE DATE", dateFmt(inv.due_date));
  if (isReceipt) addMeta("PAID DATE", dateFmt(new Date().toISOString().slice(0, 10)));

  y = Math.max(y + 14, my + 4);

  // ── 5. Status ribbon (diagonal watermark) ────────────────────────────────
  const rb = isReceipt ? { text: "PAID", color: [22, 163, 74] } : ribbonText(inv.status);
  doc.saveGraphicsState();
  const cx = W / 2 + 30;
  const cy = H / 2 - 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(52);
  doc.setTextColor(rb.color[0], rb.color[1], rb.color[2]);
  doc.setGState(new doc.GState({ opacity: 0.07 }));
  doc.text(rb.text, cx, cy, { align: "center", angle: 45 });
  doc.restoreGraphicsState();

  // ── 6. Bill To ───────────────────────────────────────────────────────────
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(ML, y, TW * 0.5 - 4, 34, 3, 3, "F");

  let btY = y + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("BILL TO", ML + 4, btY);
  btY += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(inv.customer_name || "—", ML + 4, btY);
  btY += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  if (inv.customer_phone) { doc.text(inv.customer_phone, ML + 4, btY); btY += 4.5; }
  if (inv.customer_email) { doc.text(inv.customer_email, ML + 4, btY); }

  y += 40;

  // ── 7. Items table ────────────────────────────────────────────────────────
  // Columns: S/N | DESCRIPTION | QTY | UNIT PRICE | AMOUNT
  const colSN   = 10;
  const colDesc = TW * 0.42;
  const colQty  = 14;
  const colUnit = TW * 0.20;
  // colAmt = remainder

  const cX = [ML, ML + colSN, ML + colSN + colDesc, ML + colSN + colDesc + colQty, ML + colSN + colDesc + colQty + colUnit];

  // Table header bg
  doc.setFillColor(27, 42, 94);
  doc.roundedRect(ML, y, TW, 9, 2, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("S/N",         cX[0] + 1.5, y + 5.5);
  doc.text("DESCRIPTION", cX[1] + 1.5, y + 5.5);
  doc.text("QTY",         cX[2] + 1,   y + 5.5);
  doc.text("UNIT PRICE",  cX[3] + 1,   y + 5.5);
  doc.text("AMOUNT",      MR - 1,      y + 5.5, { align: "right" });
  y += 9;

  // Rows
  const items = inv.invoice_items || [];
  items.forEach((item, i) => {
    const rowH = 11;
    if (i % 2 === 0) {
      doc.setFillColor(250, 251, 253);
      doc.rect(ML, y, TW, rowH, "F");
    }

    // Row border
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(ML, y + rowH, MR, y + rowH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(27, 42, 94);
    doc.text(String(i + 1), cX[0] + 2.5, y + 6.5);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    const descLines = doc.splitTextToSize(item.description || "", colDesc - 4);
    doc.text(descLines[0] || "", cX[1] + 1.5, y + 6.5);

    doc.setTextColor(71, 85, 105);
    doc.text(String(item.quantity || 1), cX[2] + 1, y + 6.5);
    doc.text(fmtK(item.unit_price_kobo), cX[3] + 1, y + 6.5);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(fmtK(item.line_total_kobo), MR - 1, y + 6.5, { align: "right" });

    y += rowH;
  });

  y += 4;

  // ── 8. Totals section ────────────────────────────────────────────────────
  const tLX = MR - 70;
  const tVX = MR;

  const tRow = (label, value, highlight = false, red = false) => {
    if (highlight) {
      doc.setFillColor(27, 42, 94);
      doc.roundedRect(tLX - 4, y - 4.5, 70 + 4, 10, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text(label, tLX, y);
      doc.text(value, tVX, y, { align: "right" });
      y += 12;
    } else {
      doc.setFont("helvetica", red ? "bold" : "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(red ? 220 : 71, red ? 38 : 85, red ? 38 : 105);
      doc.text(label, tLX, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(red ? 220 : 15, red ? 38 : 23, red ? 38 : 42);
      doc.text(value, tVX, y, { align: "right" });
      y += 7;
    }
  };

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(tLX - 4, y - 2, MR, y - 2);
  y += 2;

  tRow("Subtotal", fmtK(inv.subtotal_kobo));
  if (inv.discount_kobo > 0) tRow("Discount", `−${fmtK(inv.discount_kobo)}`, false, true);
  if (inv.vat_kobo > 0)      tRow("VAT (7.5%)", fmtK(inv.vat_kobo));
  tRow("TOTAL DUE", fmtK(inv.total_kobo), true);

  if (inv.amount_paid_kobo > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(22, 163, 74);
    doc.text("Amount Paid", tLX, y);
    doc.setFont("helvetica", "bold");
    doc.text(fmtK(inv.amount_paid_kobo), tVX, y, { align: "right" });
    y += 7;

    const bal = inv.total_kobo - inv.amount_paid_kobo;
    if (bal > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(220, 38, 38);
      doc.text("Balance Due", tLX, y);
      doc.text(fmtK(bal), tVX, y, { align: "right" });
      y += 9;
    }
  }

  y += 5;

  // ── 9. Payment details ────────────────────────────────────────────────────
  const hasBank = biz.bank || biz.acctNo || biz.acctName;
  const hasPmtInstr = !!inv.payment_instructions;
  if (hasBank || hasPmtInstr) {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(ML, y, MR, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("PAYMENT DETAILS", ML, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);

    if (hasBank) {
      const bankLines = [
        biz.bank ? `Bank: ${biz.bank}` : null,
        biz.acctNo   ? `Account Number: ${biz.acctNo}` : null,
        biz.acctName ? `Account Name: ${biz.acctName}` : null,
      ].filter(Boolean);
      bankLines.forEach(l => { doc.text(l, ML, y); y += 5; });
    }
    if (hasPmtInstr) {
      const instrLines = doc.splitTextToSize(inv.payment_instructions, TW);
      doc.text(instrLines, ML, y);
      y += instrLines.length * 5;
    }
    y += 3;
  }

  // ── 10. Notes ─────────────────────────────────────────────────────────────
  if (inv.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("NOTES", ML, y);
    y += 5;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const noteLines = doc.splitTextToSize(inv.notes, TW);
    doc.text(noteLines, ML, y);
    y += noteLines.length * 5 + 5;
  }

  // ── 11. Thank-you note ────────────────────────────────────────────────────
  if (biz.thanks) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(27, 42, 94);
    const thankLines = doc.splitTextToSize(biz.thanks, TW);
    doc.text(thankLines, ML, y);
  }

  // ── 12. Footer ────────────────────────────────────────────────────────────
  const footerH = 18;
  doc.setFillColor(248, 250, 252);
  doc.rect(0, H - footerH, W, footerH, "F");

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(0, H - footerH, W, H - footerH);

  const iconSize = 8;
  const footerY  = H - footerH / 2 - 1;

  // App icon (small, left of center)
  if (iconB64) {
    try {
      doc.addImage(iconB64, "PNG", W / 2 - 60, footerY - iconSize / 2 - 1, iconSize, iconSize, "", "FAST");
    } catch {}
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text("Generated by KudiAI Track", W / 2, footerY - 4, { align: "center" });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text(SLOGAN, W / 2, footerY + 1, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `A product of Amaya & Co. Technologies. All rights reserved © ${new Date().getFullYear()}`,
    W / 2, footerY + 6, { align: "center" }
  );

  const prefix = isReceipt ? "receipt" : "invoice";
  await savePdf(doc, `${prefix}_${inv.invoice_number || Date.now()}.pdf`);
}
