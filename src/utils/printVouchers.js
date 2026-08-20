// Voucher PDF — pure jsPDF vector drawing, no html2canvas.
// Shares via Capacitor.Share on native; navigator.share / doc.save on web.
// [KT/boot] — keep this comment as a regression detector for the print→PDF migration.

import { Capacitor } from '@capacitor/core';
import { jsPDF }     from 'jspdf';
import { savePdf }   from './pdfSave';

// ── Network branding ─────────────────────────────────────────────────────────

const NET_CFG = {
  MTN:       { bg: '#FFC300', fg: '#000000', care: '180' },
  Airtel:    { bg: '#EF3340', fg: '#ffffff', care: '111' },
  Glo:       { bg: '#007838', fg: '#ffffff', care: '121' },
  '9mobile': { bg: '#006B54', fg: '#ffffff', care: '200' },
};
const DEF_CFG = { bg: '#333333', fg: '#ffffff', care: '' };

// ── Layout constants (all in mm) ──────────────────────────────────────────────

const CARD_W  = 48;    // card width
const CARD_H  = 15;    // card height
const STRIP_H = 4;     // network colour strip at top of card
const COLS    = 4;     // cards per row
const COL_GAP = 2.5;   // horizontal gap between cards
const ROW_GAP = 2;     // vertical gap between rows
const MARGIN_Y = 10;   // top/bottom page margin

// Centre the 4-column grid on A4 (210 mm wide).
// 4×48 + 3×2.5 = 199.5 mm of content → (210−199.5)/2 ≈ 5.25 mm side margins.
const MARGIN_X = (210 - COLS * CARD_W - (COLS - 1) * COL_GAP) / 2;

// How many complete card rows fit on one A4 page (297 mm).
const ROWS_PER_PAGE = Math.floor(
  (297 - 2 * MARGIN_Y + ROW_GAP) / (CARD_H + ROW_GAP)
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function fmtPin(raw) {
  const s = String(raw || '').replace(/\s+/g, '');
  const chunks = [];
  for (let i = 0; i < s.length; i += 4) chunks.push(s.slice(i, i + 4));
  return chunks.join(' ');
}

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return String(d); }
}

// ── PDF card builder ──────────────────────────────────────────────────────────

function buildVoucherPdf(pins, businessName) {
  const doc  = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const biz  = String(businessName || 'My Business');
  const date = new Date().toISOString().slice(0, 10);
  let   page = 0;

  pins.forEach((pin, idx) => {
    const col     = idx % COLS;
    const absRow  = Math.floor(idx / COLS);
    const pageNum = Math.floor(absRow / ROWS_PER_PAGE);
    const pageRow = absRow % ROWS_PER_PAGE;

    if (pageNum > page) { doc.addPage(); page = pageNum; }

    const x = MARGIN_X + col * (CARD_W + COL_GAP);
    const y = MARGIN_Y + pageRow * (CARD_H + ROW_GAP);

    const net    = pin.network || pin.mobilenetwork || '';
    const cfg    = NET_CFG[net] || DEF_CFG;
    const raw    = String(pin.EPIN ?? pin.pin ?? pin.code ?? '');
    const bare   = raw.replace(/\s+/g, '');
    const fmted  = fmtPin(raw);
    const serial = pin.sno || pin.serial || pin.batchno || '';
    const dated  = fmtDate(pin.transactiondate);
    const amount = pin.amount
      ? `N${Number(pin.amount).toLocaleString('en-NG')}`
      : '';

    // ── Dashed border ────────────────────────────────────────────────────────
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.15);
    doc.setLineDash([1, 1], 0);
    doc.rect(x, y, CARD_W, CARD_H, 'S');
    doc.setLineDash([], 0);

    // ── Network colour strip (top STRIP_H mm) ────────────────────────────────
    const { r: bgR, g: bgG, b: bgB } = hexRgb(cfg.bg);
    doc.setFillColor(bgR, bgG, bgB);
    doc.rect(x, y, CARD_W, STRIP_H, 'F');

    // Line 1 — business name (left) + network + denomination (right), 5 pt bold
    const { r: fgR, g: fgG, b: fgB } = hexRgb(cfg.fg);
    doc.setTextColor(fgR, fgG, fgB);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'bold');
    const stripMid = y + STRIP_H / 2;
    doc.text(biz, x + 0.8, stripMid, { baseline: 'middle', maxWidth: CARD_W * 0.55 });
    const rightLbl = [net, amount].filter(Boolean).join(' ');
    if (rightLbl) {
      doc.text(rightLbl, x + CARD_W - 0.8, stripMid, { baseline: 'middle', align: 'right' });
    }

    // ── Card body ────────────────────────────────────────────────────────────
    const bY = y + STRIP_H; // body top

    // Line 2 — PIN, 7 pt bold Courier (monospace)
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(7);
    doc.setFont('courier', 'bold');
    doc.text(fmted || bare || '—', x + 0.8, bY + 2.5, { baseline: 'middle' });

    // Line 3 — serial + date, 4 pt
    doc.setFontSize(4);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    const line3 = [serial ? `SN:${serial}` : '', dated].filter(Boolean).join('  ');
    if (line3) {
      doc.text(line3, x + 0.8, bY + 5.2, { baseline: 'middle', maxWidth: CARD_W - 1.6 });
    }

    // Line 4 — dial code (left) + care number (right), 4 pt
    doc.setTextColor(80, 80, 80);
    if (bare) {
      doc.text(`*311*${bare}#`, x + 0.8, bY + 7.5, { baseline: 'middle' });
    }
    if (cfg.care) {
      doc.text(`Care: ${cfg.care}`, x + CARD_W - 0.8, bY + 7.5, { baseline: 'middle', align: 'right' });
    }
  });

  const net0     = (pins[0]?.network || 'voucher').toLowerCase().replace(/\s+/g, '-');
  const filename = `vouchers-${net0}-${date}.pdf`;
  return { doc, filename };
}

// ── Internal: generate + save/share ──────────────────────────────────────────

async function generateVoucherPDF(pins, businessName) {
  const { doc, filename } = buildVoucherPdf(pins, businessName);
  await savePdf(doc, filename);
}

// ── Public API ────────────────────────────────────────────────────────────────

// category kept in signature for call-site compatibility; not used in PDF layout.
export async function shareVoucherPDF(pins, businessName, category) { // eslint-disable-line no-unused-vars
  if (!pins?.length) return;

  // On native Capacitor: savePdf writes to cache then opens Capacitor.Share
  // (real file URI → Android share sheet). navigator.share with a blob is
  // unreliable inside a WebView.
  if (Capacitor.isNativePlatform()) {
    await generateVoucherPDF(pins, businessName);
    return;
  }

  // Web: try navigator.share with the PDF blob, fall back to doc.save().
  const { doc, filename } = buildVoucherPdf(pins, businessName);
  try {
    const blob = doc.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  doc.save(filename);
}
