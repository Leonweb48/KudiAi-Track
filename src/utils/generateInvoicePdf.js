import { savePdf } from "./pdfSave";

// ── Brand palette ──────────────────────────────────────────────────────────────
const NAVY    = [22,  37,  90 ];   // #16255A — structure
const GREEN   = [61,  168, 41 ];   // #3DA829 — accent
const TGREEN  = [234, 246, 228];   // #EAF6E4 — paid tint
const LTGREEN = [243, 250, 239];   // #F3FAEF — softer paid tint
const DARK    = [44,  44,  42 ];   // #2c2c2a
const SEC     = [95,  94,  90 ];   // #5f5e5a
const MUTED   = [138, 138, 133];   // #8a8a85
const HAIRLN  = [230, 228, 220];   // #e6e4dc
const PANEL   = [246, 248, 252];   // #F6F8FC
const WHITE   = [255, 255, 255];
const RED     = [220, 38,  38 ];
const AMBER   = [217, 119, 6  ];
const TRED    = [254, 242, 242];
const TAMBER  = [255, 251, 235];
const LBLUE   = [148, 172, 220];   // light blue for footer text

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

// ── Merge identical line items (same description + unit price) ─────────────────
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
  if (isReceipt)                   return { text:"RECEIPT", pill:GREEN,   tint:LTGREEN, border:GREEN  };
  if (status === "paid")           return { text:"PAID",    pill:GREEN,   tint:LTGREEN, border:GREEN  };
  if (status === "overdue")        return { text:"OVERDUE", pill:RED,     tint:TRED,    border:RED    };
  if (status === "cancelled")      return { text:"VOID",    pill:MUTED,   tint:PANEL,   border:HAIRLN };
  if (status === "partially_paid") return { text:"PARTIAL", pill:AMBER,   tint:TAMBER,  border:AMBER  };
  if (status === "sent")           return { text:"SENT",    pill:[37,99,235], tint:[239,246,255], border:[37,99,235] };
  return                                  { text:"DRAFT",   pill:MUTED,   tint:PANEL,   border:HAIRLN };
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

  const W  = doc.internal.pageSize.getWidth();   // 210mm
  const H  = doc.internal.pageSize.getHeight();  // 297mm
  const ML = 15;                                  // left margin
  const MR = W - 15;                              // right margin
  const TW = MR - ML;                             // content width (180mm)
  const FOOTER_H    = 18;
  const CONTENT_BOT = H - FOOTER_H - 3;          // safe bottom of content

  // ── Business info ────────────────────────────────────────────────────────
  const biz = {
    name:     profile?.business_name          || "My Business",
    phone:    invoiceSettings.contact_phone   || profile?.owner_phone          || "",
    email:    invoiceSettings.contact_email   || profile?.email                || "",
    address:  invoiceSettings.address         || profile?.address              || "",
    reg:      invoiceSettings.reg_number      || "",
    bank:     invoiceSettings.bank_name       || profile?.bank_name            || "",
    acctNo:   invoiceSettings.account_number  || profile?.bank_account_number  || "",
    acctName: invoiceSettings.account_name    || profile?.bank_account_name    || "",
    logo:     invoiceSettings.logo_url        || "",
    thanks:   invoiceSettings.thank_you_note
                || "Thank you for your business. We truly value your patronage.",
  };

  // ── Load assets ──────────────────────────────────────────────────────────
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [logoB64, appLogoB64, fontRegB64, fontMedB64] = await Promise.all([
    biz.logo ? imgToBase64(biz.logo) : Promise.resolve(null),
    imgToBase64(`${origin}/logo.png`),
    loadFontBase64(`${origin}/fonts/NotoSans-Regular.ttf`),
    loadFontBase64(`${origin}/fonts/NotoSans-Medium.ttf`),
  ]);

  // ── Register Unicode font ────────────────────────────────────────────────
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
  const setMed  = (sz) => { doc.setFont(FONT, FONT === "NotoSans" ? "bold" : "bold"); if (sz) doc.setFontSize(sz); };
  const setItal = (sz) => { doc.setFont("helvetica", "italic"); if (sz) doc.setFontSize(sz); };
  const col     = (...c) => doc.setTextColor(...c);
  const splitW  = (txt, w) => doc.splitTextToSize(String(txt || ""), w);

  // ── Derived state ────────────────────────────────────────────────────────
  const ss           = statusCfg(inv.status, isReceipt);
  const isPaid       = isReceipt || inv.status === "paid";
  const isOverdue    = inv.status === "overdue";
  const amtPaidKobo  = inv.amount_paid_kobo || 0;
  const amtDueKobo   = Math.max(0, (inv.total_kobo || 0) - amtPaidKobo);
  const fullyPaid    = isPaid || amtDueKobo <= 0;
  const items        = mergeItems(inv.invoice_items || []);

  // ── Table column X positions ─────────────────────────────────────────────
  const cSN   = 9;
  const cAmt  = 33;
  const cUnit = 33;
  const cQty  = 14;
  const cDesc = TW - cSN - cQty - cUnit - cAmt;   // ≈ 91mm
  const cX    = [ML, ML+cSN, ML+cSN+cDesc, ML+cSN+cDesc+cQty, ML+cSN+cDesc+cQty+cUnit];

  // ── Per-page helpers ─────────────────────────────────────────────────────
  let pageCount = 1;

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
    const fy   = H - FOOTER_H;
    const fcY  = fy + FOOTER_H / 2;
    doc.setFillColor(...NAVY);
    doc.rect(0, fy, W, FOOTER_H, "F");
    doc.setFillColor(...GREEN);
    doc.rect(0, H - 1.5, W, 1.5, "F");

    // Logo tile
    const ltSz = 10;
    const ltX  = ML;
    const ltY  = fy + (FOOTER_H - ltSz) / 2;
    if (appLogoB64) {
      doc.setFillColor(...WHITE);
      doc.roundedRect(ltX - 1, ltY - 1, ltSz + 2, ltSz + 2, 2, 2, "F");
      try { doc.addImage(appLogoB64, "PNG", ltX, ltY, ltSz, ltSz, "", "FAST"); } catch {}
    }
    const fTextX = appLogoB64 ? ML + ltSz + 4 : ML;

    setMed(7.5); col(...WHITE);
    doc.text("KudiAI Track", fTextX, fcY - 2.5);
    setItal(5.5); col(...LBLUE);
    doc.text(SLOGAN, fTextX, fcY + 2.5);

    setReg(5.5); col(...LBLUE);
    doc.text(
      `A product of Amaya & Co. Technologies © ${new Date().getFullYear()}`,
      MR, fcY - 2.5, { align: "right" }
    );
    doc.text(`Page ${pageNum} of ${total}`, MR, fcY + 2.5, { align: "right" });
  }

  function drawTableHeader(atY) {
    const HDR_H = 9;
    doc.setFillColor(...NAVY);
    doc.roundedRect(ML, atY, TW, HDR_H, 2.5, 2.5, "F");
    doc.rect(ML, atY + 3, TW, HDR_H - 3, "F");   // square off bottom corners
    setMed(7); col(...WHITE);
    const hY = atY + 6.2;
    doc.text("#",           cX[0] + 2,       hY);
    doc.text("DESCRIPTION", cX[1] + 2,       hY);
    doc.text("QTY",         cX[2] + cQty/2,  hY, { align: "center" });
    doc.text("UNIT PRICE",  cX[4] - 2,       hY, { align: "right" });
    doc.text("AMOUNT",      MR,              hY, { align: "right" });
    return atY + HDR_H;
  }

  function drawSlimHeader(atY) {
    setMed(9); col(...NAVY);
    doc.text(biz.name, ML, atY + 5);
    setReg(8);  col(...SEC);
    doc.text(
      `${isReceipt ? "RECEIPT" : "INVOICE"} ${inv.invoice_number || ""}`,
      MR, atY + 5, { align: "right" }
    );
    doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.3);
    doc.line(ML, atY + 8, MR, atY + 8);
    return atY + 12;
  }

  function newPage(inTable) {
    doc.addPage();
    pageCount++;
    drawTopStrips();
    drawWatermark();
    let ny = 8;
    ny = drawSlimHeader(ny);
    if (inTable) ny = drawTableHeader(ny);
    return ny;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1 — start
  // ══════════════════════════════════════════════════════════════════════════
  drawTopStrips();
  drawWatermark();

  let y = 8;   // below top strips (4pt navy + 2pt green)

  // ── HEADER SECTION ───────────────────────────────────────────────────────
  const TILE = 19;       // logo tile size mm (≈54pt)
  const tileX = ML;
  const tileY = y;

  if (logoB64) {
    doc.setFillColor(...PANEL);
    doc.roundedRect(tileX, tileY, TILE, TILE, 3, 3, "F");
    try { doc.addImage(logoB64, getImgFmt(logoB64), tileX+1, tileY+1, TILE-2, TILE-2, "", "FAST"); } catch {}
  } else {
    doc.setFillColor(...NAVY);
    doc.roundedRect(tileX, tileY, TILE, TILE, 3, 3, "F");
    setMed(initials(biz.name).length > 2 ? 8 : 11);
    col(...WHITE);
    doc.text(initials(biz.name) || "?", tileX + TILE/2, tileY + TILE/2 + 1.5, { align: "center" });
  }

  // Business info (right of tile)
  let bizY = tileY + 4;
  const bizInfoX = tileX + TILE + 5;
  setMed(13); col(...NAVY);
  doc.text(splitW(biz.name, 80)[0], bizInfoX, bizY);
  bizY += 5.5;
  setReg(7.5); col(...MUTED);
  if (biz.reg)     { doc.text(`RC: ${biz.reg}`, bizInfoX, bizY); bizY += 4; }
  if (biz.address) { doc.text(splitW(biz.address, 75)[0], bizInfoX, bizY); bizY += 4; }
  const contact = [biz.phone, biz.email].filter(Boolean).join("  ·  ");
  if (contact) doc.text(contact, bizInfoX, bizY);

  // "INVOICE" title (top-right)
  let invY = tileY + 5.5;
  setMed(24); col(...NAVY);
  doc.setCharSpace(1.2);
  doc.text(isReceipt ? "RECEIPT" : "INVOICE", MR, invY, { align: "right" });
  doc.setCharSpace(0);
  invY += 7;

  // Status badge (pill)
  setMed(7.5);
  const bw   = doc.getTextWidth(ss.text) + 10;
  const bh   = 7;
  const bx   = MR - bw;
  doc.setFillColor(...ss.tint);
  doc.setDrawColor(...ss.border); doc.setLineWidth(0.6);
  doc.roundedRect(bx, invY, bw, bh, 2, 2, "FD");
  col(...ss.pill);
  doc.text(ss.text, bx + bw/2, invY + 4.9, { align: "center" });

  y = Math.max(tileY + TILE + 6, invY + bh + 6);

  // ── META BAR ─────────────────────────────────────────────────────────────
  const metaH = 18;
  doc.setFillColor(...PANEL);
  doc.roundedRect(ML, y, TW, metaH, 3, 3, "F");

  const todayStr = new Date().toISOString().slice(0, 10);
  const metaCols = [
    { label: isReceipt ? "RECEIPT NO." : "INVOICE NO.", val: inv.invoice_number || "—" },
    { label: "ISSUE DATE",  val: dateFmtShort(inv.issue_date || todayStr) },
    ...(!isReceipt && inv.due_date ? [{ label: "DUE DATE",  val: dateFmtShort(inv.due_date) }] : []),
    ...(fullyPaid ? [{ label: "PAID ON", val: dateFmtShort(todayStr), green: true }] : []),
  ];
  const mStep = TW / Math.max(metaCols.length, 3);
  metaCols.forEach((mc, i) => {
    const cx = ML + i * mStep + 6;
    setReg(6.5); col(...MUTED); doc.setCharSpace(0.7);
    doc.text(mc.label, cx, y + 6);
    doc.setCharSpace(0);
    setMed(8.5);
    col(...(mc.green ? GREEN : DARK));
    doc.text(mc.val, cx, y + 13.5);
  });
  y += metaH + 6;

  // ── BILL TO + AMOUNT PANELS ───────────────────────────────────────────────
  const panelW = (TW - 6) / 2;
  const panelH = 34;
  const billX  = ML;
  const amtPX  = ML + panelW + 6;

  // Bill To
  doc.setFillColor(...LTGREEN);
  doc.roundedRect(billX, y, panelW, panelH, 3, 3, "F");
  doc.setFillColor(...GREEN);
  doc.roundedRect(billX, y, 3, panelH, 1.5, 1.5, "F");

  let btY = y + 5.5;
  setReg(6.5); col(...SEC); doc.setCharSpace(0.7);
  doc.text("BILL TO", billX + 7, btY); doc.setCharSpace(0); btY += 5;
  setMed(10); col(...NAVY);
  doc.text(splitW(inv.customer_name || "—", panelW - 12)[0], billX + 7, btY); btY += 5.5;
  setReg(8); col(...SEC);
  if (inv.customer_phone) { doc.text(inv.customer_phone, billX + 7, btY); btY += 4.5; }
  if (inv.customer_email) { doc.text(splitW(inv.customer_email, panelW - 12)[0], billX + 7, btY); }

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

  let amY = y + 5.5;
  setReg(6.5); col(...SEC); doc.setCharSpace(0.7);
  doc.text(fullyPaid ? "AMOUNT PAID" : "AMOUNT DUE", amtPX + 6, amY);
  doc.setCharSpace(0); amY += 6;
  setMed(14);
  col(...(fullyPaid ? GREEN : isOverdue ? RED : NAVY));
  doc.text(fmtK(fullyPaid ? inv.total_kobo : amtDueKobo), amtPX + 6, amY);
  amY += 6;
  setReg(7.5);
  if (fullyPaid) {
    col(...GREEN);
    doc.text("✓ Fully paid  ·  Balance ₦0.00", amtPX + 6, amY);
  } else {
    col(...SEC);
    if (inv.due_date) { doc.text(`Due: ${dateFmtShort(inv.due_date)}`, amtPX + 6, amY); amY += 4.5; }
    if (amtPaidKobo > 0) {
      col(...GREEN);
      doc.text(`Paid: ${fmtK(amtPaidKobo)}`, amtPX + 6, amY);
    }
  }

  y += panelH + 8;

  // ── LINE ITEMS TABLE ──────────────────────────────────────────────────────
  y = drawTableHeader(y);

  for (let i = 0; i < items.length; i++) {
    const item     = items[i];
    const descLns  = splitW(item.description || "", cDesc - 4);
    const rowH     = Math.max(10, descLns.length * 4.8 + 6);

    // Page break before drawing — move whole row
    if (y + rowH > CONTENT_BOT) {
      y = newPage(true);
    }

    // Hairline
    doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.2);
    doc.line(ML, y, MR, y);

    const rMidY  = y + rowH / 2 + 1.8;   // vertically centered baseline
    const descT  = y + 5;                  // description starts from top

    // # (green)
    setMed(7.5); col(...GREEN);
    doc.text(String(i + 1), cX[0] + 2.5, rMidY);

    // Description
    setReg(9); col(...DARK);
    descLns.forEach((ln, li) => doc.text(ln, cX[1] + 2, descT + li * 4.8));

    // QTY (centered)
    setReg(8.5); col(...SEC);
    doc.text(String(item.quantity || 1), cX[2] + cQty / 2, rMidY, { align: "center" });

    // Unit price (right-aligned to end of unit col)
    doc.text(fmtK(item.unit_price_kobo), cX[4] - 2, rMidY, { align: "right" });

    // Amount (right-aligned, medium)
    setMed(8.5); col(...DARK);
    doc.text(fmtK(item.line_total_kobo), MR, rMidY, { align: "right" });

    y += rowH;
  }

  // Closing hairline
  doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.2);
  doc.line(ML, y, MR, y);
  y += 6;

  // ── TOTALS + PAYMENT DETAILS ──────────────────────────────────────────────
  // Gather totals rows
  const totRows = [
    { label: "Subtotal",  val: fmtK(inv.subtotal_kobo) },
    ...(inv.discount_kobo > 0
      ? [{ label: "Discount", val: `−${fmtK(inv.discount_kobo)}`, red: true }] : []),
    ...(inv.vat_kobo > 0
      ? [{ label: `VAT (7.5%)`, val: fmtK(inv.vat_kobo) }] : []),
    ...((inv.other_charges_kobo || 0) > 0
      ? [{ label: inv.other_charges_label || "Other Charges", val: fmtK(inv.other_charges_kobo) }] : []),
  ];

  // Payment details items
  const pmtRows = [
    biz.bank     ? ["Bank",         biz.bank    ] : null,
    biz.acctNo   ? ["Account No.",  biz.acctNo  ] : null,
    biz.acctName ? ["Account Name", biz.acctName] : null,
    inv.payment_instructions ? ["Instructions", inv.payment_instructions] : null,
  ].filter(Boolean);

  // Thank-you lines
  const thanksLns = biz.thanks ? splitW(biz.thanks, TW - 8) : [];

  // Estimate block height
  const totH =
    totRows.length * 7 +
    13 +   // TOTAL DUE bar
    (amtPaidKobo > 0 ? 7 : 0) +
    (amtDueKobo > 0 && amtPaidKobo > 0 ? 7 : 0) +
    4;
  const payH = pmtRows.length > 0 ? pmtRows.length * 13 + 14 : 0;
  const notesH = inv.notes ? (splitW(inv.notes, TW).length * 4.5 + 12) : 0;
  const thankH = thanksLns.length > 0 ? thanksLns.length * 5.2 + 12 : 0;
  const blockH = Math.max(totH, payH) + notesH + thankH + 6;

  if (y + blockH > CONTENT_BOT) {
    y = newPage(false);
  }

  const blockTop = y;

  // ── Totals column (right 48%)
  const TOT_W = Math.floor(TW * 0.48);
  const TOT_X = MR - TOT_W;
  let ty = blockTop;

  for (const row of totRows) {
    setReg(8.5);
    col(...(row.red ? RED : SEC));
    doc.text(row.label, TOT_X, ty);
    setMed(8.5);
    col(...(row.red ? RED : DARK));
    doc.text(row.val, MR, ty, { align: "right" });
    ty += 7;
  }

  // TOTAL DUE bar
  const tdH = 10;
  doc.setFillColor(...NAVY);
  doc.roundedRect(TOT_X - 2, ty - 1, TOT_W + 2, tdH, 2.5, 2.5, "F");
  setMed(9.5); col(...WHITE);
  const tdLabel = isReceipt ? "TOTAL RECEIVED" : "TOTAL DUE";
  doc.text(tdLabel, TOT_X + 3, ty + 6.2);
  doc.text(fmtK(inv.total_kobo), MR, ty + 6.2, { align: "right" });
  ty += tdH + 4;

  if (amtPaidKobo > 0) {
    setReg(8.5); col(...GREEN);
    doc.text("Amount Paid", TOT_X, ty);
    setMed(8.5); col(...GREEN);
    doc.text(fmtK(amtPaidKobo), MR, ty, { align: "right" });
    ty += 7;
    if (amtDueKobo > 0) {
      setReg(8.5); col(...RED);
      doc.text("Balance Due", TOT_X, ty);
      setMed(8.5); col(...RED);
      doc.text(fmtK(amtDueKobo), MR, ty, { align: "right" });
      ty += 7;
    }
  }

  // ── Payment details column (left ~48%)
  const PAY_W = TOT_X - ML - 8;
  if (pmtRows.length > 0) {
    let py = blockTop;
    setMed(7); col(...NAVY); doc.setCharSpace(0.5);
    doc.text("PAYMENT DETAILS", ML, py); doc.setCharSpace(0);
    doc.setFillColor(...NAVY);
    doc.rect(ML, py + 2.5, 22, 0.5, "F");
    py += 8;

    for (const [lbl, val] of pmtRows) {
      setReg(7); col(...MUTED);
      doc.text(lbl, ML, py); py += 3.5;
      setMed(8); col(...DARK);
      const vLines = splitW(val, PAY_W);
      doc.text(vLines, ML, py);
      py += vLines.length * 4.5 + 3;
    }
  }

  y = Math.max(ty, blockTop + Math.max(totH, payH)) + 5;

  // ── NOTES ────────────────────────────────────────────────────────────────
  if (inv.notes) {
    setReg(7); col(...MUTED); doc.setCharSpace(0.5);
    doc.text("NOTES", ML, y); doc.setCharSpace(0); y += 5;
    setItal(8); col(...SEC);
    const nLns = splitW(inv.notes, TW);
    doc.text(nLns, ML, y);
    y += nLns.length * 4.5 + 6;
  }

  // ── THANK-YOU NOTE ────────────────────────────────────────────────────────
  if (thanksLns.length > 0) {
    doc.setDrawColor(...HAIRLN); doc.setLineWidth(0.3);
    doc.line(ML, y, MR, y);
    y += 6;
    setItal(8.5); col(...MUTED);
    doc.text(thanksLns, ML + TW / 2, y, { align: "center" });
  }

  // ── FOOTERS (all pages, with accurate page count) ─────────────────────────
  const totalPages = doc.internal.pages.length - 1;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(p, totalPages);
  }

  // ── OUTPUT ───────────────────────────────────────────────────────────────
  const prefix = isReceipt ? "receipt" : "invoice";
  const fname  = `${prefix}_${(inv.invoice_number || Date.now()).toString().replace(/\//g, "-")}.pdf`;
  if (returnBase64) return doc.output("datauristring").split(",")[1];
  await savePdf(doc, fname);
}
