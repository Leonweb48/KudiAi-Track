// Business posters (2026-10-27) — drawn on a canvas in the owner's phone, no server rendering.
//   pay  "Pay with transfer": the wallet's account number, bank and the account name Flutterwave registered (what a payer's
//        bank shows), with a QR to kudiai.app/pay/<code> where anyone can check the number really is this business's.
//   ajo  "Ajo & Esusu available": daily Ajo / Esusu circle / savings card, with a big "scan to join" QR to
//        kudiai.app/join/<code> (wallet sign-up with this business already chosen).
// Everything is laid out in a 1000-unit-wide space; the height follows the size (A4 print or WhatsApp Status). Blocks
// between the header and the footer share the free height, and shrink together when a long business name needs room.
// Printed text comes from i18n/posters.js in the language the owner picked for the poster.
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { translate } from "../i18n";
import { bankLogoUrl, bankInitials, cleanBankName, displayBankName } from "./bankLogos";

export const POSTER_SIZES = {
  a4:     { w: 1240, h: 1754, scale: 1.6 },   // 1984 × 2806 px, 240 dpi on A4
  status: { w: 1080, h: 1920, scale: 1 },
};

export const posterLink = (type, code) => `https://kudiai.app/${type === "ajo" ? "join" : "pay"}/${code}`;

const FONT = '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const f = (w, s) => `${w} ${Math.round(s * 10) / 10}px ${FONT}`;
const C = {
  deep: "#0B3B26", deeper: "#05241A", brand: "#3DA829", brandDark: "#2E8020", lime: "#A6F08A",
  ink: "#0F172A", slate: "#64748B", line: "#E2E8F0", white: "#FFFFFF",
};
const W = 1000, M = 56;

const ICON = {
  globe: { stroke: "M2.5 12h19|M12 2.5c2.8 3 2.8 16 0 19|M12 2.5c-2.8 3-2.8 16 0 19|M21.5 12a9.5 9.5 0 11-19 0 9.5 9.5 0 0119 0z" },
  mail:  { stroke: "M4.5 5h15a2 2 0 012 2v10a2 2 0 01-2 2h-15a2 2 0 01-2-2V7a2 2 0 012-2z|M3 6.5l9 6.5 9-6.5" },
  ig:    { stroke: "M8 3h8a5 5 0 015 5v8a5 5 0 01-5 5H8a5 5 0 01-5-5V8a5 5 0 015-5z|M16.2 12a4.2 4.2 0 11-8.4 0 4.2 4.2 0 018.4 0z" },
  x:     { fill: "M17.8 2.5h3.3l-7.2 8.2 8.5 10.8h-6.6l-5.2-6.6-5.9 6.6H1.4l7.7-8.8L1 2.5h6.8l4.7 6.1zm-1.2 17h1.8L7.5 4.4H5.5z" },
  fb:    { fill: "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z" },
  li:    { fill: "M20.4 2H3.6A1.6 1.6 0 0 0 2 3.6v16.8A1.6 1.6 0 0 0 3.6 22h16.8a1.6 1.6 0 0 0 1.6-1.6V3.6A1.6 1.6 0 0 0 20.4 2zM8 19H5V9.5h3zM6.5 8.2a1.7 1.7 0 1 1 0-3.5 1.7 1.7 0 0 1 0 3.5zM19 19h-3v-4.6c0-1.1 0-2.5-1.5-2.5S12.7 13 12.7 14.3V19h-3V9.5h2.9v1.3a3.1 3.1 0 0 1 2.8-1.6c3 0 3.6 2 3.6 4.6z" },
  phone: { stroke: "M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z" },
  pin:   { stroke: "M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z|M15 10a3 3 0 11-6 0 3 3 0 016 0z" },
  daily: { stroke: "M7 3v3|M17 3v3|M4 9h16|M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z|M9 14.5l2 2 4-4" },
  esusu: { stroke: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M13 7a4 4 0 11-8 0 4 4 0 018 0z|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75" },
  card:  { stroke: "M4 6h16a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z|M2 11h20|M6 15h3" },
  check: { stroke: "M5 12.5l4.5 4.5L19 7.5" },
};

function drawIcon(ctx, name, x, y, size, color, lw = 2.2) {
  const ic = ICON[name];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (ic.stroke) ic.stroke.split("|").forEach((d) => ctx.stroke(new Path2D(d)));
  if (ic.fill) ctx.fill(new Path2D(ic.fill));
  ctx.restore();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  const k = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k); ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k); ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || ctx.measureText(next).width <= maxW) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The biggest size (max → min, in steps of 2) at which `text` fits `maxLines` lines of `maxW`. */
function fit(ctx, text, weight, max, min, maxW, maxLines = 1) {
  let size = max, lines = [];
  for (; size >= min; size -= 2) {
    ctx.font = f(weight, size);
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines };
  }
  size = min;
  ctx.font = f(weight, size);
  lines = wrap(ctx, text, maxW);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return { size, lines };
}

function text(ctx, lines, x, y, size, weight, color, align = "left", lh = 1.18) {
  ctx.font = f(weight, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh));
  return lines.length * size * lh;
}

const loadImg = (src) => new Promise((resolve) => {
  if (!src) { resolve(null); return; }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

function drawQr(ctx, url, x, y, size, logo) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "Q" });
  const n = qr.modules.size;
  const cell = size / n;
  ctx.fillStyle = C.deep;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell + 0.35, cell + 0.35);
    }
  }
  if (logo) {   // a small logo in the middle — Q correction carries a centre patch of this size
    const s = size * 0.2, lx = x + (size - s) / 2, ly = y + (size - s) / 2;
    ctx.fillStyle = C.white; rrect(ctx, lx - 6, ly - 6, s + 12, s + 12, 12); ctx.fill();
    ctx.drawImage(logo, lx, ly, s, s);
  }
}

const groupNumber = (n) => {
  const d = String(n || "").replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(n || "");
};

// ── background, header and footer (both posters) ───────────────────────────
function drawBackground(ctx, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0E4A2F"); g.addColorStop(0.55, C.deep); g.addColorStop(1, C.deeper);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.5, 120, 10, W * 0.5, 120, 620);
  glow.addColorStop(0, "rgba(61,168,41,.38)"); glow.addColorStop(1, "rgba(61,168,41,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = "rgba(166,240,138,.10)"; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(W + 40, -40, 220 + i * 70, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1.5;
  for (let i = -H; i < W; i += 34) { ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + 260, H - 260); ctx.stroke(); }
  ctx.restore();
}

function drawHeader(ctx, logo, pill) {
  const y = 44;
  ctx.fillStyle = C.white; rrect(ctx, M, y, 72, 72, 20); ctx.fill();
  if (logo) ctx.drawImage(logo, M + 8, y + 8, 56, 56);
  text(ctx, ["KudiAI Track"], M + 90, y + 10, 32, 900, C.white);
  text(ctx, ["by Amaya & Co. Technologies"], M + 91, y + 48, 15, 600, "rgba(255,255,255,.72)");
  // the pill on the right never runs into the brand name
  const room = W - M - (M + 90 + 250);
  let size = 18;
  ctx.font = f(800, size);
  while (ctx.measureText(pill).width + 40 > room && size > 12) { size -= 1; ctx.font = f(800, size); }
  const pw = ctx.measureText(pill).width + 40, ph = size + 22;
  ctx.fillStyle = C.lime; rrect(ctx, W - M - pw, y + 36 - ph / 2, pw, ph, ph / 2); ctx.fill();
  text(ctx, [pill], W - M - pw / 2, y + 36 - size * 0.62, size, 800, C.deep, "center");
  return y + 72;
}

const FOOTER_H = 236;
function drawFooter(ctx, H, logo, tr) {
  const y0 = H - FOOTER_H;
  ctx.fillStyle = C.white; rrect(ctx, 0, y0, W, FOOTER_H + 40, 40); ctx.fill();
  ctx.fillStyle = C.brand; ctx.fillRect(0, y0 + FOOTER_H - 8, W, 8);
  let y = y0 + 28;
  if (logo) ctx.drawImage(logo, M, y, 56, 56);
  text(ctx, [tr("posters.p.poweredBy")], M + 70, y + 4, 15, 600, C.slate);
  text(ctx, ["KudiAI Track"], M + 70, y + 22, 28, 900, C.deep);
  // "Get it on Google Play" pill
  ctx.font = f(800, 21);
  const playTxt = "Google Play", sub = tr("posters.p.getApp").replace(/\s*Google Play\s*/i, "").trim() || "Get it on";
  ctx.font = f(600, 12);
  const subW = ctx.measureText(sub).width;
  ctx.font = f(800, 21);
  const pw = Math.max(ctx.measureText(playTxt).width, subW) + 80, ph = 58, px = W - M - pw;
  ctx.fillStyle = "#000"; rrect(ctx, px, y, pw, ph, 14); ctx.fill();
  const tx = px + 18, ty = y + 14;   // the Play triangle in its four colours
  [["#00D7FE", [[0, 0], [16, 15], [0, 30]]], ["#FFD500", [[16, 15], [23, 10], [27, 15], [23, 20]]],
   ["#FF3A44", [[0, 30], [16, 15], [23, 20]]], ["#00F076", [[0, 0], [23, 10], [16, 15]]]].forEach(([col, pts]) => {
    ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(tx + a, ty + b) : ctx.moveTo(tx + a, ty + b)));
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  });
  text(ctx, [sub.toUpperCase()], px + 56, y + 9, 12, 600, "#fff");
  text(ctx, [playTxt], px + 56, y + 24, 21, 800, "#fff");

  y += 56 + 22;
  const cols = [M, W / 2 + 10];
  const rows = [
    [["globe"], "kudiai.app", ["mail"], "support@kudiai.app"],
    [["ig", "x"], "@kudiai_track", ["fb", "li"], "@KudiTrack"],
  ];
  rows.forEach((r, ri) => {
    [0, 1].forEach((ci) => {
      const icons = r[ci * 2], label = r[ci * 2 + 1];
      let x = cols[ci];
      icons.forEach((ic) => { drawIcon(ctx, ic, x, y + ri * 36, 24, C.brandDark); x += 31; });
      text(ctx, [label], x + 6, y + ri * 36 + 2, 21, 700, C.ink);
    });
  });
  y += 72 + 12;
  text(ctx, ["KudiAI Track is a product of Amaya & Co. Technologies · RC 9587896"], W / 2, y, 14, 600, C.slate, "center");
}

/** Lay `build(k)` blocks out between top and bottom, shrinking (k) until the minimum gaps fit. */
function placeBlocks(ctx, build, top, bottom) {
  let k = 1, blocks = build(k);
  const need = (bs) => bs.reduce((a, b) => a + b.h, 0) + (bs.length + 1) * 22;
  while (need(blocks) > bottom - top && k > 0.62) { k -= 0.04; blocks = build(k); }
  // a tall size (WhatsApp Status) has room to spare: grow everything while generous gaps still fit
  const roomy = (bs) => bs.reduce((a, b) => a + b.h, 0) + (bs.length + 1) * 60 <= bottom - top;
  while (k >= 1 && k < 1.2) { const bigger = build(k + 0.04); if (!roomy(bigger)) break; k += 0.04; blocks = bigger; }
  const sum = blocks.reduce((a, b) => a + b.h, 0);
  const n = blocks.length + 1;
  const gap = Math.max(14, Math.min(96, (bottom - top - sum) / n));
  let y = top + gap + Math.max(0, (bottom - top - sum - gap * n) / 2);
  blocks.forEach((b) => { b.draw(y); y += b.h + gap; });
}

function businessBlock(ctx, name, k) {
  const { size, lines } = fit(ctx, name, 900, 78 * k, 34, W - 2 * M, 2);
  const h = lines.length * size * 1.12 + 26;
  return { h, draw: (y) => {
    text(ctx, lines, W / 2, y, size, 900, C.white, "center", 1.12);
    ctx.fillStyle = C.lime; rrect(ctx, W / 2 - 44, y + h - 8, 88, 8, 4); ctx.fill();
  } };
}

function titleBlock(ctx, title, sub, k) {
  const t = fit(ctx, title, 900, 92 * k, 40, W - 2 * M, 2);
  const s = fit(ctx, sub, 600, 28 * k, 18, W - 2 * M, 2);
  const th = t.lines.length * t.size * 1.06;
  return { h: th + 14 + s.lines.length * s.size * 1.2, draw: (y) => {
    text(ctx, t.lines, W / 2, y, t.size, 900, C.lime, "center", 1.06);
    text(ctx, s.lines, W / 2, y + th + 14, s.size, 600, "rgba(255,255,255,.88)", "center", 1.2);
  } };
}

function contactBlock(ctx, contact, k) {
  const items = [];
  if (contact?.phone) items.push(["phone", contact.phone]);
  if (contact?.address) items.push(["pin", contact.address]);
  if (!items.length) return null;
  const size = 22 * Math.max(k, 0.85), maxW = W - 2 * M - 40;
  const rows = items.map(([ic, v]) => ({ ic, ...fit(ctx, v, 700, size, 16, maxW, 2) }));
  const h = rows.reduce((a, r) => a + r.lines.length * r.size * 1.25, 0) + (rows.length - 1) * 8;
  return { h, draw: (y) => {
    rows.forEach((r) => {
      ctx.font = f(700, r.size);
      const w = Math.max(...r.lines.map((l) => ctx.measureText(l).width));
      const x = (W - w - 36) / 2;
      drawIcon(ctx, r.ic, x, y + 1, r.size + 2, C.lime);
      text(ctx, r.lines, x + 36, y, r.size, 700, C.white, "left", 1.25);
      y += r.lines.length * r.size * 1.25 + 8;
    });
  } };
}

/** Numbered steps; with draw = false it only measures. Returns the height used. */
function steps(ctx, items, x, y, size, maxW, numBg, numFg, color, draw = true) {
  let yy = y;
  items.forEach((s, i) => {
    const d = size * 1.5;
    const r = fit(ctx, s, 700, size, size * 0.75, maxW - d - 14, 2);
    const th = r.lines.length * r.size * 1.2;
    if (draw) {
      ctx.fillStyle = numBg; ctx.beginPath(); ctx.arc(x + d / 2, yy + d / 2, d / 2, 0, Math.PI * 2); ctx.fill();
      text(ctx, [String(i + 1)], x + d / 2, yy + d / 2 - size * 0.55, size * 0.95, 900, numFg, "center");
      text(ctx, r.lines, x + d + 14, yy + Math.max(0, (d - th) / 2), r.size, 700, color, "left", 1.2);
    }
    yy += Math.max(d, th) + (i < items.length - 1 ? size * 0.6 : 0);
  });
  return yy - y;
}

// ── Pay with transfer ───────────────────────────────────────────────────────
function payBlocks(ctx, o, tr, imgs, k) {
  const cardW = W - 2 * M, pad = 44 * Math.max(k, 0.8);
  const num = fit(ctx, groupNumber(o.account.number), 900, 134 * k, 56, cardW - 2 * pad, 1);
  const bank = displayBankName({ name: cleanBankName(o.account.bank) });
  const bankFit = fit(ctx, bank, 800, 32 * k, 20, cardW - 2 * pad - 72, 1);
  const nameFit = fit(ctx, o.account.name || o.businessName, 800, 32 * k, 18, cardW - 2 * pad, 2);
  const labelS = 18 * Math.max(k, 0.85);
  const numH = num.size * 1.02;
  const cardH = pad + labelS + 14 + numH + 18 + 2 + 26 + labelS + 10 + Math.max(56, bankFit.size * 1.2) + 22
    + labelS + 10 + nameFit.lines.length * nameFit.size * 1.18 + pad;
  const card = { h: cardH, draw: (y) => {
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    ctx.fillStyle = C.white; rrect(ctx, M, y, cardW, cardH, 36); ctx.fill(); ctx.restore();
    ctx.save(); rrect(ctx, M, y, cardW, cardH, 36); ctx.clip();
    const band = ctx.createLinearGradient(M, 0, M + cardW, 0); band.addColorStop(0, C.brand); band.addColorStop(1, C.lime);
    ctx.fillStyle = band; ctx.fillRect(M, y, cardW, 12); ctx.restore();
    let yy = y + pad;
    const x = M + pad, inner = cardW - 2 * pad;
    text(ctx, [tr("posters.p.accountNumber").toUpperCase()], x, yy, labelS, 800, C.brandDark);
    ctx.font = f(800, labelS * 0.85);
    const ngnW = ctx.measureText("NGN").width + 24;
    ctx.fillStyle = "#E8F7E3"; rrect(ctx, x + inner - ngnW, yy - 4, ngnW, labelS + 10, (labelS + 10) / 2); ctx.fill();
    text(ctx, ["NGN"], x + inner - ngnW / 2, yy + 1, labelS * 0.85, 800, C.brandDark, "center");
    yy += labelS + 14;
    text(ctx, num.lines, W / 2, yy, num.size, 900, C.deep, "center", 1.02);
    yy += numH + 18;
    ctx.save(); ctx.setLineDash([10, 9]); ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + inner, yy); ctx.stroke(); ctx.restore();
    yy += 2 + 26;
    text(ctx, [tr("posters.p.bank").toUpperCase()], x, yy, labelS, 800, C.slate);
    yy += labelS + 10;
    const rowH = Math.max(56, bankFit.size * 1.2);
    ctx.fillStyle = "#F1F5F9"; ctx.beginPath(); ctx.arc(x + 28, yy + rowH / 2, 28, 0, Math.PI * 2); ctx.fill();
    if (imgs.bank) {
      ctx.save(); ctx.beginPath(); ctx.arc(x + 28, yy + rowH / 2, 26, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(imgs.bank, x + 2, yy + rowH / 2 - 26, 52, 52); ctx.restore();
    } else {
      text(ctx, [bankInitials(bank)], x + 28, yy + rowH / 2 - 11, 20, 900, C.deep, "center");
    }
    text(ctx, bankFit.lines, x + 72, yy + (rowH - bankFit.size * 1.1) / 2, bankFit.size, 800, C.ink);
    yy += rowH + 22;
    text(ctx, [tr("posters.p.accountName").toUpperCase()], x, yy, labelS, 800, C.slate);
    yy += labelS + 10;
    text(ctx, nameFit.lines, x, yy, nameFit.size, 800, C.ink, "left", 1.18);
  } };

  const qs = 250 * Math.max(k, 0.8);
  const colX = M + qs + 36, colW = W - M - colX;
  const st = fit(ctx, tr("posters.p.scanCheck"), 800, 30 * k, 20, colW, 2);
  const ss = fit(ctx, tr("posters.p.scanCheckSub"), 500, 20 * k, 14, colW, 2);
  const stepS = 21 * Math.max(k, 0.8);
  const stepItems = [tr("posters.p.payStep1"), tr("posters.p.payStep2"), tr("posters.p.payStep3")];
  const stepsH = steps(ctx, stepItems, 0, 0, stepS, colW, "", "", "", false);
  const colH = st.lines.length * st.size * 1.15 + 8 + ss.lines.length * ss.size * 1.25 + 20 + stepsH;
  const row = { h: Math.max(qs, colH), draw: (y) => {
    ctx.fillStyle = C.white; rrect(ctx, M, y, qs, qs, 26); ctx.fill();
    drawQr(ctx, o.link, M + 18, y + 18, qs - 36, imgs.logo);
    let yy = y + Math.max(0, (qs - colH) / 2);
    yy += text(ctx, st.lines, colX, yy, st.size, 800, C.white, "left", 1.15) + 8;
    yy += text(ctx, ss.lines, colX, yy, ss.size, 500, "rgba(255,255,255,.78)", "left", 1.25) + 20;
    steps(ctx, stepItems, colX, yy, stepS, colW, C.lime, C.deep, C.white);
  } };

  return [businessBlock(ctx, o.businessName, k), titleBlock(ctx, tr("posters.p.payTitle"), tr("posters.p.paySub"), k),
    card, row, contactBlock(ctx, o.contact, k)].filter(Boolean);
}

// ── Ajo & Esusu available ───────────────────────────────────────────────────
function ajoBlocks(ctx, o, tr, imgs, k) {
  const gap = 20, tw = (W - 2 * M - 2 * gap) / 3, tp = 22;
  const tiles = [["daily", "posters.p.ajoDaily"], ["esusu", "posters.p.ajoEsusu"], ["card", "posters.p.ajoCard"]].map(([ic, key]) => ({
    ic, t: fit(ctx, tr(key), 800, 25 * k, 17, tw - 2 * tp, 2), s: fit(ctx, tr(`${key}Sub`), 500, 18 * k, 13, tw - 2 * tp, 3),
  }));
  const iconD = 64 * Math.max(k, 0.8);
  const tileH = Math.max(...tiles.map((x) => tp + iconD + 16 + x.t.lines.length * x.t.size * 1.15 + 8 + x.s.lines.length * x.s.size * 1.3 + tp));
  const tileRow = { h: tileH, draw: (y) => {
    tiles.forEach((x, i) => {
      const tx = M + i * (tw + gap);
      ctx.fillStyle = "rgba(255,255,255,.08)"; rrect(ctx, tx, y, tw, tileH, 26); ctx.fill();
      ctx.strokeStyle = "rgba(166,240,138,.28)"; ctx.lineWidth = 1.5; rrect(ctx, tx, y, tw, tileH, 26); ctx.stroke();
      const g = ctx.createLinearGradient(tx, y, tx + iconD, y + iconD); g.addColorStop(0, C.lime); g.addColorStop(1, C.brand);
      ctx.fillStyle = g; rrect(ctx, tx + tp, y + tp, iconD, iconD, 18); ctx.fill();
      drawIcon(ctx, x.ic, tx + tp + iconD * 0.2, y + tp + iconD * 0.2, iconD * 0.6, C.deep, 2.3);
      let yy = y + tp + iconD + 16;
      yy += text(ctx, x.t.lines, tx + tp, yy, x.t.size, 800, C.white, "left", 1.15) + 8;
      text(ctx, x.s.lines, tx + tp, yy, x.s.size, 500, "rgba(255,255,255,.78)", "left", 1.3);
    });
  } };

  const cardW = W - 2 * M, pad = 36;
  const qs = 300 * Math.max(k, 0.8);
  const colX = M + pad + qs + 34, colW = M + cardW - pad - colX;
  const jt = fit(ctx, tr("posters.p.scanJoin"), 900, 46 * k, 26, colW, 2);
  const js = fit(ctx, tr("posters.p.scanJoinSub"), 600, 21 * k, 14, colW, 3);
  const stepS = 21 * Math.max(k, 0.8);
  const stepItems = [tr("posters.p.joinStep1"), tr("posters.p.joinStep2"), tr("posters.p.joinStep3")];
  const live = fit(ctx, tr("posters.p.trackLive"), 700, 18 * k, 13, colW - 34, 2);
  const colH = jt.lines.length * jt.size * 1.08 + 10 + js.lines.length * js.size * 1.25 + 20
    + steps(ctx, stepItems, 0, 0, stepS, colW, "", "", "", false) + 18
    + live.lines.length * live.size * 1.25;
  const linkS = 15;
  const cardH = pad + Math.max(qs + 12 + linkS * 1.3, colH) + pad;
  const card = { h: cardH, draw: (y) => {
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    ctx.fillStyle = C.white; rrect(ctx, M, y, cardW, cardH, 36); ctx.fill(); ctx.restore();
    ctx.save(); rrect(ctx, M, y, cardW, cardH, 36); ctx.clip();
    const band = ctx.createLinearGradient(M, 0, M + cardW, 0); band.addColorStop(0, C.brand); band.addColorStop(1, C.lime);
    ctx.fillStyle = band; ctx.fillRect(M, y, cardW, 12); ctx.restore();
    const qy = y + pad + Math.max(0, (cardH - 2 * pad - qs - 12 - linkS * 1.3) / 2);
    ctx.strokeStyle = "#D7EFD0"; ctx.lineWidth = 3; rrect(ctx, M + pad - 6, qy - 6, qs + 12, qs + 12, 18); ctx.stroke();
    drawQr(ctx, o.link, M + pad + 8, qy + 8, qs - 16, imgs.logo);
    text(ctx, [o.link.replace(/^https:\/\//, "")], M + pad + qs / 2, qy + qs + 14, linkS, 700, C.slate, "center");
    let yy = y + pad + Math.max(0, (cardH - 2 * pad - colH) / 2);
    yy += text(ctx, jt.lines, colX, yy, jt.size, 900, C.deep, "left", 1.08) + 10;
    yy += text(ctx, js.lines, colX, yy, js.size, 600, "#475569", "left", 1.25) + 20;
    yy += steps(ctx, stepItems, colX, yy, stepS, colW, C.deep, C.lime, C.ink) + 18;
    drawIcon(ctx, "check", colX, yy - 2, live.size + 6, C.brand, 3);
    text(ctx, live.lines, colX + 34, yy, live.size, 700, C.brandDark, "left", 1.25);
  } };

  return [businessBlock(ctx, o.businessName, k), titleBlock(ctx, tr("posters.p.ajoTitle"), tr("posters.p.ajoSub"), k),
    tileRow, card, contactBlock(ctx, o.contact, k)].filter(Boolean);
}

/**
 * Draw a poster.
 * @param {{ type: "pay"|"ajo", lang: string, size: "a4"|"status", businessName: string, code: string,
 *           account?: { number: string, bank: string, name: string }, contact?: { phone?: string, address?: string },
 *           scale?: number }} o   scale: pixels per size unit (a lighter one for the on-screen preview)
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPoster(o) {
  const sz = POSTER_SIZES[o.size] || POSTER_SIZES.a4;
  const H = Math.round(W * sz.h / sz.w);
  const tr = (key, vars) => translate(key, o.lang, vars);
  const link = posterLink(o.type, o.code);
  const canvas = document.createElement("canvas");
  const scale = o.scale || sz.scale;
  canvas.width = Math.round(sz.w * scale);
  canvas.height = Math.round(sz.h * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(canvas.width / W, canvas.width / W);

  // DM Sans (index.html) — load every weight used, with this poster's own text so the right character subsets come down
  const sample = [o.businessName, o.account?.name, o.contact?.address,
    ...["posters.p.payTitle", "posters.p.ajoTitle", "posters.p.scanJoin", "posters.p.ajoEsusuSub", "posters.p.wallet"].map((key) => tr(key))]
    .filter(Boolean).join(" ");
  if (document.fonts?.load) {
    await Promise.all([900, 800, 700, 600, 500].map((w) => document.fonts.load(f(w, 40), sample).catch(() => null)));
  }
  const [logo, bank] = await Promise.all([
    loadImg("/logo-tp.png"),
    o.type === "pay" ? loadImg(bankLogoUrl({ name: o.account?.bank })) : Promise.resolve(null),
  ]);
  const imgs = { logo, bank };

  drawBackground(ctx, H);
  const top = drawHeader(ctx, logo, o.type === "pay" ? tr("posters.p.wallet") : "KudiAI Ajo · Esusu");
  const opts = { ...o, link };
  placeBlocks(ctx, (k) => (o.type === "pay" ? payBlocks(ctx, opts, tr, imgs, k) : ajoBlocks(ctx, opts, tr, imgs, k)),
    top + 8, H - FOOTER_H - 18);
  drawFooter(ctx, H, logo, tr);
  return canvas;
}

export const posterFileName = (o, ext) => {
  const slug = String(o.businessName || "business").normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `KudiAI-${o.type === "pay" ? "Pay-Poster" : "Ajo-Poster"}-${slug}-${o.lang}${o.size === "status" ? "-Status" : ""}.${ext}`;
};

export const canvasBlob = (canvas, type = "image/png", quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not make the image"))), type, quality));

/** An A4 PDF with the poster filling the page. */
export function posterPdf(canvas) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, 210, 297, undefined, "FAST");
  return doc;
}
