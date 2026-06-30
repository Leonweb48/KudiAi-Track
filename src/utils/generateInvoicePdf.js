import { savePdf } from "./pdfSave";

const koboToNaira = (k) => (k || 0) / 100;
const fmtK = (k) => `₦${koboToNaira(k).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

function dateFmt(str) {
  if (!str) return "";
  return new Date(str + "T00:00:00").toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export async function exportInvoicePdf(inv, profile) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12; // margin

  // ── Header bar ───────────────────────────────────────────────────
  doc.setFillColor(22, 163, 74); // brand-600
  doc.rect(0, 0, W, 34, "F");

  // App name (top-left)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("KudiAI Track", M, 9);

  // Business name (center)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(profile?.business_name || "My Business", W / 2, 19, { align: "center" });

  // Business contact (below name)
  const bizSub = [profile?.owner_phone, profile?.address].filter(Boolean).join("  |  ");
  if (bizSub) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(bizSub, W / 2, 27, { align: "center" });
  }

  // INVOICE badge (top-right)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("INVOICE", W - M, 9, { align: "right" });

  // ── Bill To + Invoice Meta row ────────────────────────────────────
  let y = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(140);
  doc.text("BILL TO", M, y);
  y += 4.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(inv.customer_name || "—", M, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(80);
  if (inv.customer_phone) { doc.text(inv.customer_phone, M, y); y += 4.5; }
  if (inv.customer_email) { doc.text(inv.customer_email, M, y); y += 4.5; }

  // Right column — invoice details
  const rv = W - M;       // right value X
  const rl = rv - 42;     // right label X
  let ry = 46;

  const addMeta = (label, value) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text(label, rl, ry);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30);
    doc.setFontSize(8.5);
    doc.text(value || "—", rv, ry, { align: "right" });
    ry += 6;
  };

  addMeta("Invoice No:", inv.invoice_number || "—");
  addMeta("Issue Date:", dateFmt(inv.issue_date) || new Date().toLocaleDateString("en-NG"));
  if (inv.due_date) addMeta("Due Date:", dateFmt(inv.due_date));

  y = Math.max(y, ry) + 6;

  // ── Items table ──────────────────────────────────────────────────
  const tableW = W - M * 2;
  const colDesc = tableW * 0.50;
  const colQty  = tableW * 0.12;
  const colUnit = tableW * 0.19;
  // colTotal uses remainder to W-M

  const cX = [M, M + colDesc, M + colDesc + colQty, M + colDesc + colQty + colUnit];

  // Table header
  doc.setFillColor(243, 244, 246);
  doc.rect(M, y - 4, tableW, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100);
  doc.text("DESCRIPTION",  cX[0] + 1, y + 0.5);
  doc.text("QTY",          cX[1] + 1, y + 0.5);
  doc.text("UNIT PRICE",   cX[2] + 1, y + 0.5);
  doc.text("TOTAL",        W - M - 1, y + 0.5, { align: "right" });
  y += 9;

  // Rows
  const items = inv.invoice_items || [];
  items.forEach((item, i) => {
    if (i % 2 === 1) {
      doc.setFillColor(250, 252, 250);
      doc.rect(M, y - 4, tableW, 10, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(25);
    const descLines = doc.splitTextToSize(item.description || "", colDesc - 4);
    doc.text(descLines,              cX[0] + 1, y);
    doc.text(String(item.quantity || 1), cX[1] + 1, y);
    doc.text(fmtK(item.unit_price_kobo), cX[2] + 1, y);
    doc.text(fmtK(item.line_total_kobo), W - M - 1, y, { align: "right" });
    y += Math.max(descLines.length * 5, 10);
  });

  // Table bottom border
  doc.setDrawColor(226, 232, 240);
  doc.line(M, y, W - M, y);
  y += 7;

  // ── Totals section ────────────────────────────────────────────────
  const tv  = W - M;
  const tl  = tv - 58;
  const tRow = (label, value, bold = false, rgb = [60, 60, 60]) => {
    if (bold) {
      doc.setFillColor(22, 163, 74);
      doc.rect(M, y - 4.5, tableW, 10, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...rgb);
    }
    doc.text(label, tl, y);
    doc.text(value, tv, y, { align: "right" });
    y += bold ? 11 : 8;
  };

  tRow("Subtotal", fmtK(inv.subtotal_kobo));
  if (inv.discount_kobo > 0) tRow("Discount", `−${fmtK(inv.discount_kobo)}`, false, [220, 38, 38]);
  if (inv.vat_kobo > 0)      tRow("VAT (7.5%)", fmtK(inv.vat_kobo));
  tRow("TOTAL DUE", fmtK(inv.total_kobo), true);

  if (inv.amount_paid_kobo > 0) {
    tRow("Amount Paid", fmtK(inv.amount_paid_kobo), false, [22, 163, 74]);
    const bal = inv.total_kobo - inv.amount_paid_kobo;
    if (bal > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(220, 38, 38);
      doc.text("Balance Due", tl, y);
      doc.text(fmtK(bal), tv, y, { align: "right" });
      y += 8;
    }
  }

  y += 4;

  // ── Payment instructions ──────────────────────────────────────────
  if (inv.payment_instructions) {
    doc.setDrawColor(226, 232, 240);
    doc.line(M, y, W - M, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text("HOW TO PAY", M, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(30);
    const instrLines = doc.splitTextToSize(inv.payment_instructions, tableW);
    doc.text(instrLines, M, y);
    y += instrLines.length * 5 + 5;
  }

  // ── Notes ─────────────────────────────────────────────────────────
  if (inv.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text("NOTES", M, y);
    y += 5;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(80);
    const noteLines = doc.splitTextToSize(inv.notes, tableW);
    doc.text(noteLines, M, y);
  }

  // ── Footer ─────────────────────────────────────────────────────────
  doc.setFillColor(248, 250, 252);
  doc.rect(0, H - 14, W, 14, "F");
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(
    `Generated by KudiAI Track  •  ${new Date().toLocaleString("en-NG")}`,
    W / 2, H - 6,
    { align: "center" }
  );

  await savePdf(doc, `invoice_${inv.invoice_number || Date.now()}.pdf`);
}
