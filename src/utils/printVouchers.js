// Generates a print-ready HTML page of Nigerian-format airtime/data voucher cards.
// 2 cards per row, dashed cut border, A4 portrait (~12 cards/page).
// NCC harmonised recharge code: *311*PIN# (works on all networks).

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

export function openPrintVoucherCards(pins, businessName, category) {
  if (!pins || !pins.length) return;

  const biz      = esc(businessName || 'My Business');
  const isData   = category === 'print-data';
  const typeLabel = isData ? 'Data Voucher' : 'Airtime Voucher';

  const cardsHtml = pins.map((p) => {
    const rawPin  = String(p.EPIN ?? p.pin ?? p.code ?? '');
    const network = p.network || p.mobilenetwork || '';
    const amount  = p.amount ? `₦${Number(p.amount).toLocaleString('en-NG')}` : '';
    const serial  = p.sno || p.serial || p.batchno || '';
    const date    = fmtDate(p.transactiondate);
    const cfg     = NET_STYLE[network] || DEF_STYLE;

    return `<div class="card">
  <div class="card-top" style="background:${cfg.bg};color:${cfg.fg}">
    <span class="biz">${biz}</span>
    <span class="net">${esc(network) || 'Voucher'}</span>
  </div>
  <div class="card-mid">
    <div class="type-lbl">${typeLabel}</div>
    <div class="denom">${esc(amount)}</div>
    <div class="pin-lbl">PIN</div>
    <div class="pin">${esc(fmtPin(rawPin))}</div>
    ${serial ? `<div class="meta">SN:&nbsp;${esc(serial)}</div>` : ''}
    ${date   ? `<div class="meta">${esc(date)}</div>` : ''}
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
.bar{text-align:center;padding:14px 0 16px;background:#f4f4f4;border-bottom:1px solid #ddd}
.print-btn{
  padding:10px 36px;background:#3DA829;color:#fff;
  border:none;border-radius:6px;font-size:15px;font-weight:700;
  cursor:pointer;letter-spacing:.3px
}
.print-btn:hover{background:#2e8020}
.grid{display:flex;flex-wrap:wrap;padding:4mm 3mm}
.card{
  width:48%;margin:1%;
  border:1.5px dashed #999;border-radius:3px;
  overflow:hidden;display:flex;flex-direction:column;
  page-break-inside:avoid;break-inside:avoid;
}
.card-top{
  display:flex;align-items:center;justify-content:space-between;
  padding:2px 6px;gap:4px
}
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
  <button class="print-btn" onclick="window.print()">&#128438;&nbsp; Print Cards</button>
</div>
<div class="grid">
${cardsHtml}
</div>
</body>
</html>`;

  const w = window.open('about:blank', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch (_) {} }, 700);
  }
}
