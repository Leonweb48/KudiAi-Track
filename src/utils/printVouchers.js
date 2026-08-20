// Generates a preview tab of voucher cards + downloads a PDF via html2canvas → jsPDF.
// PDF generation runs in the main React window (libraries loaded); the preview tab
// calls back via window.opener.__kvDL() so no bundling is needed in the tab's HTML.
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

// ── PDF generation (runs in main React window context) ────────────────────────

async function generateVoucherPDF(pins, businessName, category) {
  const isData    = category === 'print-data';
  const typeLabel = isData ? 'Data Voucher' : 'Airtime Voucher';
  const biz       = esc(businessName || 'My Business');
  const network   = (pins[0]?.network || pins[0]?.mobilenetwork || 'voucher')
    .toLowerCase().replace(/\s+/g, '-');
  const dateStr   = new Date().toISOString().slice(0, 10);
  const filename  = `vouchers-${network}-${dateStr}.pdf`;

  // Build card HTML using kv-prefixed class names to avoid collision with app CSS
  const cardsHtml = pins.map(p => {
    const rawPin = String(p.EPIN ?? p.pin ?? p.code ?? '');
    const net    = p.network || p.mobilenetwork || '';
    const amount = p.amount ? `₦${Number(p.amount).toLocaleString('en-NG')}` : '';
    const serial = p.sno || p.serial || p.batchno || '';
    const date   = fmtDate(p.transactiondate);
    const cfg    = NET_STYLE[net] || DEF_STYLE;

    return `<div class="kvcard">
  <div class="kvcard-top" style="background:${cfg.bg};color:${cfg.fg}">
    <span class="kvbiz">${biz}</span>
    <span class="kvnet">${esc(net) || 'Voucher'}</span>
  </div>
  <div class="kvcard-mid">
    <div class="kvtype">${typeLabel}</div>
    <div class="kvdenom">${esc(amount)}</div>
    <div class="kvpin-lbl">PIN</div>
    <div class="kvpin">${esc(fmtPin(rawPin))}</div>
    ${serial ? `<div class="kvmeta">SN:&nbsp;${esc(serial)}</div>` : ''}
    ${date   ? `<div class="kvmeta">${esc(date)}</div>`            : ''}
  </div>
  <div class="kvcard-bot">
    <div class="kvload">Recharge:&nbsp;<strong>*311*${esc(rawPin)}#</strong></div>
    <div class="kvcare">Customer Care:&nbsp;<strong>${cfg.care}</strong></div>
    <div class="kvgen">Generated via KudiAI Track App&nbsp;&nbsp;|&nbsp;&nbsp;Amaya &amp; Co. Technologies</div>
  </div>
</div>`;
  }).join('\n');

  // Render at exact physical dimensions: CSS mm → physical mm in PDF via Receipt formula
  const container = document.createElement('div');
  container.style.cssText = [
    'position:fixed', 'top:-9999px', 'left:-9999px',
    'width:210mm',        // A4 width → mmW ≈ 210mm in PDF
    'background:#ffffff',
    'padding:8mm',
    'box-sizing:border-box',
    'font-family:Arial,Helvetica,sans-serif',
  ].join(';');

  container.innerHTML = `<style>
*{box-sizing:border-box;margin:0;padding:0}
.kvgrid{display:flex;flex-wrap:wrap}
.kvcard{width:85mm;height:25mm;margin:2mm 2.5mm;border:1.5px dashed #999;border-radius:3px;overflow:hidden;display:flex;flex-direction:column}
.kvcard-top{display:flex;align-items:center;justify-content:space-between;padding:2px 6px;gap:4px;flex-shrink:0}
.kvbiz{font-size:6px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68%}
.kvnet{font-size:9px;font-weight:900;letter-spacing:.5px;white-space:nowrap}
.kvcard-mid{padding:2px 6px;flex:1;overflow:hidden}
.kvtype{font-size:6px;color:#777;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1px}
.kvdenom{font-size:11px;font-weight:900;line-height:1;margin-bottom:2px}
.kvpin-lbl{font-size:5px;color:#999;text-transform:uppercase;letter-spacing:.5px}
.kvpin{font-size:10px;font-weight:900;font-family:'Courier New',monospace;letter-spacing:1.5px;margin:1px 0 2px;word-break:break-all}
.kvmeta{font-size:5px;color:#666;margin-bottom:1px;line-height:1.2}
.kvcard-bot{padding:2px 6px;background:#f6f6f6;border-top:1px solid #e5e5e5;flex-shrink:0}
.kvload{font-size:6px;margin-bottom:1px}
.kvcare{font-size:6px;margin-bottom:1px}
.kvgen{font-size:5px;color:#bbb;margin-top:1px}
</style>
<div class="kvgrid">${cardsHtml}</div>`;

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
    await savePdf(pdf, filename);
  } finally {
    document.body.removeChild(container);
  }
}

// ── Preview tab ───────────────────────────────────────────────────────────────

export function openPrintVoucherCards(pins, businessName, category) {
  if (!pins?.length) return;

  // Expose PDF generator on the opener so the preview tab can call it.
  // Namespaced to avoid collisions; the opened window calls window.opener.__kvDL()
  window.__kvDL = () => generateVoucherPDF(pins, businessName, category).catch(console.error);

  const biz       = esc(businessName || 'My Business');
  const isData    = category === 'print-data';
  const typeLabel = isData ? 'Data Voucher' : 'Airtime Voucher';

  const cardsHtml = pins.map(p => {
    const rawPin = String(p.EPIN ?? p.pin ?? p.code ?? '');
    const net    = p.network || p.mobilenetwork || '';
    const amount = p.amount ? `₦${Number(p.amount).toLocaleString('en-NG')}` : '';
    const serial = p.sno || p.serial || p.batchno || '';
    const date   = fmtDate(p.transactiondate);
    const cfg    = NET_STYLE[net] || DEF_STYLE;

    return `<div class="card">
  <div class="card-top" style="background:${cfg.bg};color:${cfg.fg}">
    <span class="biz">${biz}</span>
    <span class="net">${esc(net) || 'Voucher'}</span>
  </div>
  <div class="card-mid">
    <div class="type-lbl">${typeLabel}</div>
    <div class="denom">${esc(amount)}</div>
    <div class="pin-lbl">PIN</div>
    <div class="pin">${esc(fmtPin(rawPin))}</div>
    ${serial ? `<div class="meta">SN:&nbsp;${esc(serial)}</div>` : ''}
    ${date   ? `<div class="meta">${esc(date)}</div>`            : ''}
  </div>
  <div class="card-bot">
    <div class="load">Recharge:&nbsp;<strong>*311*${esc(rawPin)}#</strong></div>
    <div class="care">Customer Care:&nbsp;<strong>${cfg.care}</strong></div>
    <div class="gen">Generated via KudiAI Track App&nbsp;&nbsp;|&nbsp;&nbsp;Amaya &amp; Co. Technologies</div>
  </div>
</div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${biz} — Voucher Cards</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111}
.bar{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f4f4f4;border-bottom:1px solid #ddd}
.return-btn{
  padding:8px 18px;background:#fff;color:#444;
  border:1.5px solid #ccc;border-radius:6px;font-size:13px;font-weight:600;
  cursor:pointer
}
.return-btn:hover{background:#efefef}
.dl-btn{
  margin-left:auto;
  padding:9px 28px;background:#3DA829;color:#fff;
  border:none;border-radius:6px;font-size:14px;font-weight:700;
  cursor:pointer;letter-spacing:.3px
}
.dl-btn:hover{background:#2e8020}
.dl-btn:disabled{opacity:.55;cursor:not-allowed}
.grid{display:flex;flex-wrap:wrap;padding:4mm 3mm}
.card{
  width:48%;margin:1%;
  border:1.5px dashed #999;border-radius:3px;
  overflow:hidden;display:flex;flex-direction:column;
  page-break-inside:avoid;break-inside:avoid;
}
.card-top{display:flex;align-items:center;justify-content:space-between;padding:2px 6px;gap:4px}
.biz{font-size:6px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68%}
.net{font-size:9px;font-weight:900;letter-spacing:.5px;white-space:nowrap}
.card-mid{padding:2px 6px;flex:1}
.type-lbl{font-size:6px;color:#777;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1px}
.denom{font-size:11px;font-weight:900;line-height:1;margin-bottom:2px}
.pin-lbl{font-size:5px;color:#999;text-transform:uppercase;letter-spacing:.5px}
.pin{font-size:10px;font-weight:900;font-family:'Courier New',monospace;letter-spacing:1.5px;margin:1px 0 2px;word-break:break-all}
.meta{font-size:5px;color:#666;margin-bottom:1px;line-height:1.2}
.card-bot{padding:2px 6px;background:#f6f6f6;border-top:1px solid #e5e5e5}
.load{font-size:6px;margin-bottom:1px}
.care{font-size:6px;margin-bottom:1px}
.gen{font-size:5px;color:#bbb;margin-top:1px}
@media print{
  .bar{display:none}
  .return-btn{display:none}
  .grid{padding:4mm 3mm}
  .card{
    width:85mm;height:25mm;
    margin:2mm 2.5mm;
    box-sizing:border-box;
    overflow:hidden;
    border-color:#bbb;
  }
}
@page{size:A4 portrait;margin:8mm}
</style>
</head>
<body>
<div class="bar">
  <button class="return-btn" onclick="window.close()">← Return</button>
  <button class="dl-btn" id="dlBtn" onclick="dlPdf()">⬇️  Download as PDF</button>
</div>
<div class="grid">
${cardsHtml}
</div>
<script>
function dlPdf() {
  if (!window.opener || !window.opener.__kvDL) {
    alert('The main window has been closed. Please close this tab and tap Download Cards again.');
    return;
  }
  var btn = document.getElementById('dlBtn');
  btn.textContent = 'Generating…';
  btn.disabled = true;
  window.opener.__kvDL().then(function() {
    btn.textContent = '✓ Downloaded';
    setTimeout(function() {
      btn.textContent = '⬇️  Download as PDF';
      btn.disabled = false;
    }, 2500);
  }).catch(function() {
    btn.textContent = 'Error — tap to retry';
    btn.disabled = false;
  });
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
