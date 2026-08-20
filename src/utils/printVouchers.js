// Generates a preview tab of voucher cards + downloads/shares a PDF via html2canvas → jsPDF.
// PDF generation runs in the main React window (libraries loaded); the preview tab
// calls back via window.opener.__kvDL() / window.opener.__kvSH() so no bundling is needed.
// [KT/boot] — keep this comment as a regression detector for the print→PDF migration.

import html2canvas from 'html2canvas';
import { jsPDF }   from 'jspdf';
import { savePdf } from './pdfSave';

const NET_STYLE = {
  MTN:       { bg: '#FFC300', fg: '#000000', care: '180' },
  Airtel:    { bg: '#EF3340', fg: '#ffffff', care: '111' },
  Glo:       { bg: '#007838', fg: '#ffffff', care: '121' },
  '9mobile': { bg: '#006B54', fg: '#ffffff', care: '200' },
};
const DEF_STYLE = { bg: '#333333', fg: '#ffffff', care: '—' };

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

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Shared card HTML builder ──────────────────────────────────────────────────
// prefix = 'kv' for the PDF DOM container (avoids collisions with app CSS),
//        = ''   for the preview tab (no app CSS present).

function buildCardHtmlList(pins, businessName, category, prefix) {
  const p       = prefix ? `${prefix}-` : '';
  const isData  = category === 'print-data';
  const typeLbl = isData ? 'Data Voucher' : 'Airtime Voucher';
  const biz     = esc(businessName || 'My Business');

  return pins.map(pin => {
    const rawPin = String(pin.EPIN ?? pin.pin ?? pin.code ?? '');
    const net    = pin.network || pin.mobilenetwork || '';
    const amount = pin.amount ? `₦${Number(pin.amount).toLocaleString('en-NG')}` : '';
    const serial = pin.sno || pin.serial || pin.batchno || '';
    const date   = fmtDate(pin.transactiondate);
    const cfg    = NET_STYLE[net] || DEF_STYLE;
    const cls    = prefix || 'card';

    return `<div class="${cls}">
  <div class="${cls}-top" style="background:${cfg.bg};color:${cfg.fg}">
    <span class="${p}biz">${biz}</span>
    <span class="${p}net">${esc(net) || 'Voucher'}</span>
  </div>
  <div class="${cls}-mid">
    <div class="${p}type">${typeLbl}${amount ? ' · ' + esc(amount) : ''}</div>
    <div class="${p}pin-wrap">
      <div class="${p}pin-lbl">&#128273; PIN</div>
      <div class="${p}pin">${esc(fmtPin(rawPin))}</div>
    </div>
    ${serial ? `<div class="${p}meta">SN:&nbsp;${esc(serial)}</div>` : ''}
    ${date   ? `<div class="${p}meta">${esc(date)}</div>`            : ''}
  </div>
  <div class="${cls}-bot">
    <div class="${p}load">Recharge:&nbsp;<strong>*311*${esc(rawPin)}#</strong></div>
    <div class="${p}care">Customer Care:&nbsp;<strong>${cfg.care}</strong></div>
    <div class="${p}gen">Generated via KudiAI Track App&nbsp;&nbsp;|&nbsp;&nbsp;Amaya &amp; Co. Technologies</div>
  </div>
</div>`;
  }).join('\n');
}

// ── Shared card CSS ───────────────────────────────────────────────────────────
// prefix = 'kv' for PDF container, '' for preview tab

function cardCss(prefix) {
  const p   = prefix ? `${prefix}-` : '';
  const cls = prefix || 'card';
  return `
*{box-sizing:border-box;margin:0;padding:0}
.${prefix || 'grid'}{display:flex;flex-wrap:wrap}
.${cls}{width:85mm;height:25mm;margin:2mm 2.5mm;border:1.5px dashed #999;border-radius:3px;overflow:hidden;display:flex;flex-direction:column}
.${cls}-top{display:flex;align-items:center;justify-content:space-between;padding:2px 6px;gap:4px;flex-shrink:0}
.${p}biz{font-size:6px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68%}
.${p}net{font-size:9px;font-weight:900;letter-spacing:.5px;white-space:nowrap}
.${cls}-mid{padding:2px 6px;flex:1;overflow:hidden}
.${p}type{font-size:6px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;font-weight:600}
.${p}pin-wrap{background:#fffde7;border:1px solid #f0d060;border-radius:2px;padding:2px 5px;margin:1px 0 2px}
.${p}pin-lbl{font-size:6px;color:#8a6800;text-transform:uppercase;letter-spacing:.5px;font-weight:800;margin-bottom:1px}
.${p}pin{font-size:13px;font-weight:900;font-family:'Courier New',monospace;letter-spacing:2px;word-break:break-all;color:#1a1a1a;line-height:1}
.${p}meta{font-size:5px;color:#666;margin-bottom:1px;line-height:1.2}
.${cls}-bot{padding:2px 6px;background:#f6f6f6;border-top:1px solid #e5e5e5;flex-shrink:0}
.${p}load{font-size:6px;margin-bottom:1px}
.${p}care{font-size:6px;margin-bottom:1px}
.${p}gen{font-size:5px;color:#bbb;margin-top:1px}`;
}

// ── Build the DOM container used by html2canvas ───────────────────────────────

function buildVoucherContainer(pins, businessName, category) {
  const network  = (pins[0]?.network || pins[0]?.mobilenetwork || 'voucher').toLowerCase().replace(/\s+/g, '-');
  const dateStr  = new Date().toISOString().slice(0, 10);
  const filename = `vouchers-${network}-${dateStr}.pdf`;

  const cardsHtml = buildCardHtmlList(pins, businessName, category, 'kv');

  const container = document.createElement('div');
  container.style.cssText = [
    'position:fixed', 'top:-9999px', 'left:-9999px',
    'width:210mm', 'background:#ffffff',
    'padding:8mm', 'box-sizing:border-box',
    'font-family:Arial,Helvetica,sans-serif',
  ].join(';');

  container.innerHTML = `<style>${cardCss('kv')}</style>
<div class="kv">${cardsHtml}</div>`;

  return { container, filename };
}

// ── Render jsPDF from DOM container ──────────────────────────────────────────

async function renderPdfFromContainer(container) {
  document.body.appendChild(container);
  await new Promise(r => setTimeout(r, 150));
  const SCALE = 3;
  try {
    const canvas  = await html2canvas(container, {
      scale: SCALE, useCORS: true, allowTaint: false,
      backgroundColor: '#ffffff', logging: false,
      windowWidth:  container.scrollWidth,
      windowHeight: container.scrollHeight,
    });
    const imgData = canvas.toDataURL('image/png');
    const mmW     = (canvas.width  / SCALE) * (25.4 / 96);
    const mmH     = (canvas.height / SCALE) * (25.4 / 96);
    const pdf     = new jsPDF({ orientation: 'p', unit: 'mm', format: [mmW, mmH] });
    pdf.addImage(imgData, 'PNG', 0, 0, mmW, mmH);
    return pdf;
  } finally {
    document.body.removeChild(container);
  }
}

// ── Download PDF ──────────────────────────────────────────────────────────────

async function generateVoucherPDF(pins, businessName, category) {
  const { container, filename } = buildVoucherContainer(pins, businessName, category);
  const pdf = await renderPdfFromContainer(container);
  await savePdf(pdf, filename);
}

// ── Generate PDF blob (used by share) ────────────────────────────────────────

async function generateVoucherBlob(pins, businessName, category) {
  const { container, filename } = buildVoucherContainer(pins, businessName, category);
  const pdf = await renderPdfFromContainer(container);
  return { blob: pdf.output('blob'), filename };
}

// ── Share PDF via Web Share API (falls back to download on unsupported) ───────

export async function shareVoucherPDF(pins, businessName, category) {
  if (!pins?.length) return;
  try {
    const { blob, filename } = await generateVoucherBlob(pins, businessName, category);
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // user cancelled share sheet — do not fall through
  }
  // Fallback: regular download
  await generateVoucherPDF(pins, businessName, category);
}

// ── Preview tab ───────────────────────────────────────────────────────────────

export function openPrintVoucherCards(pins, businessName, category) {
  if (!pins?.length) return;

  // Expose callbacks on the opener so the preview tab can trigger PDF gen.
  window.__kvDL = () => generateVoucherPDF(pins, businessName, category).catch(console.error);
  window.__kvSH = () => shareVoucherPDF(pins, businessName, category).catch(console.error);

  const biz       = esc(businessName || 'My Business');
  const isData    = category === 'print-data';
  const typeLabel = isData ? 'Data Voucher' : 'Airtime Voucher';

  // Preview tab uses unprefixed class names (no app CSS to collide with)
  const cardsHtml = buildCardHtmlList(pins, businessName, category, '');

  // Preview CSS: same visual rules but for screen (wider cards)
  const screenCss = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111}
.bar{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f4f4f4;border-bottom:1px solid #ddd;flex-wrap:wrap}
.return-btn{padding:8px 18px;background:#fff;color:#444;border:1.5px solid #ccc;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
.return-btn:hover{background:#efefef}
.btn-group{margin-left:auto;display:flex;align-items:center;gap:8px}
.sh-btn{padding:9px 24px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.3px}
.sh-btn:hover{background:#4f46e5}
.sh-btn:disabled{opacity:.55;cursor:not-allowed}
.dl-btn{padding:9px 24px;background:#3DA829;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;letter-spacing:.3px}
.dl-btn:hover{background:#2e8020}
.dl-btn:disabled{opacity:.55;cursor:not-allowed}
.grid{display:flex;flex-wrap:wrap;padding:4mm 3mm}
.card{width:48%;margin:1%;border:1.5px dashed #999;border-radius:3px;overflow:hidden;display:flex;flex-direction:column;page-break-inside:avoid;break-inside:avoid}
.card-top{display:flex;align-items:center;justify-content:space-between;padding:2px 6px;gap:4px}
.biz{font-size:6px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68%}
.net{font-size:9px;font-weight:900;letter-spacing:.5px;white-space:nowrap}
.card-mid{padding:2px 6px;flex:1}
.type{font-size:6px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;font-weight:600}
.pin-wrap{background:#fffde7;border:1px solid #f0d060;border-radius:2px;padding:2px 5px;margin:1px 0 2px}
.pin-lbl{font-size:6px;color:#8a6800;text-transform:uppercase;letter-spacing:.5px;font-weight:800;margin-bottom:1px}
.pin{font-size:13px;font-weight:900;font-family:'Courier New',monospace;letter-spacing:2px;word-break:break-all;color:#1a1a1a;line-height:1}
.meta{font-size:5px;color:#666;margin-bottom:1px;line-height:1.2}
.card-bot{padding:2px 6px;background:#f6f6f6;border-top:1px solid #e5e5e5}
.load{font-size:6px;margin-bottom:1px}
.care{font-size:6px;margin-bottom:1px}
.gen{font-size:5px;color:#bbb;margin-top:1px}
@media print{
  .bar{display:none}
  .grid{padding:4mm 3mm}
  .card{width:85mm;height:25mm;margin:2mm 2.5mm;box-sizing:border-box;overflow:hidden;border-color:#bbb}
}
@page{size:A4 portrait;margin:8mm}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${biz} — Voucher Cards</title>
<style>${screenCss}</style>
</head>
<body>
<div class="bar">
  <button class="return-btn" onclick="window.close()">← Return</button>
  <div class="btn-group">
    <button class="sh-btn" id="shBtn" onclick="shPdf()">📤 Share PDF</button>
    <button class="dl-btn" id="dlBtn" onclick="dlPdf()">⬇️ Download PDF</button>
  </div>
</div>
<div class="grid">
${cardsHtml}
</div>
<script>
function dlPdf() {
  if (!window.opener || !window.opener.__kvDL) {
    alert('The main window has been closed. Please close this tab and tap Download again.');
    return;
  }
  var btn = document.getElementById('dlBtn');
  btn.textContent = 'Generating…'; btn.disabled = true;
  window.opener.__kvDL().then(function() {
    btn.textContent = '✓ Downloaded';
    setTimeout(function() { btn.textContent = '⬇️ Download PDF'; btn.disabled = false; }, 2500);
  }).catch(function() { btn.textContent = 'Error — retry'; btn.disabled = false; });
}
function shPdf() {
  if (!window.opener || !window.opener.__kvSH) {
    alert('The main window has been closed. Please close this tab and tap Share again.');
    return;
  }
  var btn = document.getElementById('shBtn');
  btn.textContent = 'Generating…'; btn.disabled = true;
  window.opener.__kvSH().then(function() {
    btn.textContent = '📤 Share PDF';
    btn.disabled = false;
  }).catch(function() { btn.textContent = '📤 Share PDF'; btn.disabled = false; });
}
<\/script>
</body>
</html>`;

  const w = window.open('about:blank', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}
