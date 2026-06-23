import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { jsPDF } from "jspdf";
import { fmt, today } from "../utils/helpers";
import { clubkonnect } from "../utils/clubkonnect";
import { canDo } from "../utils/plans";
import { BillReceipt } from "../components/shared/Receipt";
import { supabase } from "../utils/supabase";
import { lookupDataPrice } from "../data/billPrices";

/* ─── Service catalogue ───────────────────────────────────────────────────── */

const CATS = [
  { id: "airtime",      label: "Airtime",        g1: "#ef4444", g2: "#dc2626" },
  { id: "data",         label: "Data Bundle",     g1: "#3b82f6", g2: "#1d4ed8" },
  { id: "cable",        label: "Cable TV",        g1: "#8b5cf6", g2: "#6d28d9" },
  { id: "electricity",  label: "Electricity",     g1: "#f59e0b", g2: "#d97706" },
  { id: "betting",      label: "Betting Wallet",  g1: "#10b981", g2: "#059669" },
  { id: "waec",         label: "WAEC ePin",       g1: "#06b6d4", g2: "#0891b2" },
  { id: "jamb",         label: "JAMB ePin",       g1: "#f97316", g2: "#ea580c" },
  { id: "spectranet",   label: "Spectranet",      g1: "#6366f1", g2: "#4f46e5" },
  { id: "smile",        label: "Smile 4G",        g1: "#ec4899", g2: "#db2777" },
  { id: "print-airtime", label: "Print Airtime",  g1: "#64748b", g2: "#475569", enterprise: true },
  { id: "print-data",     label: "Print Data",      g1: "#64748b", g2: "#475569", enterprise: true },
  { id: "airtime-bundle", label: "Bundle Set",      g1: "#7c3aed", g2: "#5b21b6", enterprise: true },
];

const NETWORKS = ["MTN", "Airtel", "Glo", "9mobile"];
const NET_CONFIG = {
  MTN:       { bg: "#FFC300", fg: "#000", abbr: "MTN"     },
  Airtel:    { bg: "#EF3340", fg: "#fff", abbr: "Airtel"  },
  Glo:       { bg: "#007838", fg: "#fff", abbr: "Glo"     },
  "9mobile": { bg: "#006B54", fg: "#fff", abbr: "9mobile" },
};

const ELECTRICITY_COMPANIES = [
  { code: "01", name: "EKEDC (Eko)" },
  { code: "02", name: "IKEDC (Ikeja)" },
  { code: "03", name: "AEDC (Abuja)" },
  { code: "04", name: "KEDC (Kano)" },
  { code: "05", name: "PHEDC (Port Harcourt)" },
  { code: "06", name: "JEDC (Jos)" },
  { code: "07", name: "IBEDC (Ibadan)" },
  { code: "08", name: "KAEDC (Kaduna)" },
  { code: "09", name: "EEDC (Enugu)" },
  { code: "10", name: "BEDC (Benin)" },
  { code: "11", name: "YEDC (Yola)" },
  { code: "12", name: "APLE (Abuja)" },
];

const CABLE_PROVIDERS = [
  { code: "dstv",      name: "DSTV"      },
  { code: "gotv",      name: "GOtv"      },
  { code: "startimes", name: "StarTimes" },
  { code: "showmax",   name: "Showmax"   },
];

const BETTING_COMPANIES = [
  { code: "product-nairabet",   name: "NairaBet"   },
  { code: "product-bang-bet",   name: "BangBet"    },
  { code: "product-bet-way",    name: "Betway"     },
  { code: "product-bet-land",   name: "BetLand"    },
  { code: "product-bet-king",   name: "BetKing"    },
  { code: "product-1x-bet",     name: "1xBet"      },
  { code: "product-naija-bet",  name: "NaijaBet"   },
  { code: "prd-sporty-bet",     name: "SportyBet"  },
  { code: "product-merry-bet",  name: "MerryBet"   },
];

const WAEC_TYPES = [
  { code: "waecdirect",       name: "WAEC Direct (Scratch Card)" },
  { code: "waec-registration", name: "WAEC Registration"         },
];

const JAMB_TYPES = [
  { code: "utme-no-mock", name: "UTME (No Mock)" },
  { code: "utme-mock",    name: "UTME with Mock" },
  { code: "de",           name: "Direct Entry (DE)" },
];

const PRINT_VALUES = ["100", "200", "500"];

/* ─── Airtime bundle (all-network set) ────────────────────────────────────── */
const BUNDLE_NETWORKS      = ["MTN", "Airtel", "9mobile", "Glo"];
const BUNDLE_CK_COSTS      = { MTN: 970, Airtel: 968, "9mobile": 930, Glo: 920 }; // Distributor rates per ₦1,000
const BUNDLE_FACE_PER_SET   = 4000;  // ₦1,000 × 4 networks
const BUNDLE_CK_PER_SET     = Object.values(BUNDLE_CK_COSTS).reduce((s, c) => s + c, 0); // 3788
const BUNDLE_PROFIT_PER_SET = BUNDLE_FACE_PER_SET - BUNDLE_CK_PER_SET; // 212
const BUNDLE_SET_OPTIONS   = [1, 2, 3, 5, 10];

/* ─── PDF token card generation ──────────────────────────────────────────── */
// dial = airtime USSD  |  dataDial = data bundle USSD
const NET_PDF = {
  MTN:       { r:255,g:195,b:0,   tr:0,  tg:0,  tb:0,  dial:"*555*PIN#",   dataDial:"*323*PIN#"   },
  Airtel:    { r:220,g:30, b:50,  tr:255,tg:255,tb:255, dial:"*126*PIN#",   dataDial:"*141*PIN#"   },
  Glo:       { r:0,  g:120,b:56,  tr:255,tg:255,tb:255, dial:"*123*PIN#",   dataDial:"*127*PIN#"   },
  "9mobile": { r:0,  g:107,b:84,  tr:255,tg:255,tb:255, dial:"*222*PIN#",   dataDial:"*200*PIN#"   },
};
const DEF_NET_PDF = { r:80,g:80,b:80, tr:255,tg:255,tb:255, dial:"dial recharge code", dataDial:"dial to load" };

// Format PIN with dashes every 4 digits — matches real Nigerian recharge card format
function pinDashed(s) {
  const d = String(s).replace(/\D/g,"");
  return d.match(/.{1,4}/g)?.join("-") ?? d;
}

function generateTokenPDF({ fulfillResult, profile, businessName }) {
  const { pinsArr = [], label = "", cat = "", amount = 0, psRef = "" } = fulfillResult || {};
  if (!pinsArr.length) return;

  const biz      = businessName || profile?.business_name || profile?.owner_name || "KudiAI Track";
  const now      = new Date();
  const longDate = now.toLocaleDateString("en-NG", { day:"2-digit", month:"long", year:"numeric" });
  const shortDT  = now.toLocaleDateString("en-NG", { day:"2-digit", month:"2-digit", year:"numeric" })
                 + " " + now.toLocaleTimeString("en-NG", { hour:"2-digit", minute:"2-digit" });
  const isData   = cat === "print-data";

  // Denomination label shown on each card header
  const mVal  = label.match(/\b(\d{2,5})\s+Airtime/i);
  const mData = label.match(/\b(\d+\s*(?:GB|MB)[^|]*?)(?:\s+(?:Data\s+)?Print)/i);
  const denom = cat === "airtime-bundle" ? "N1,000"
              : mVal  ? `N${mVal[1]}`
              : mData ? mData[1].trim()
              : "";

  const pdf = new jsPDF({ orientation:"l", unit:"mm", format:"a4" });
  const W = 297, H = 210;

  // ── PAGE 1: RECEIPT ────────────────────────────────────────────────────────
  pdf.setFillColor(15,29,66); pdf.rect(0,0,W,44,"F");
  pdf.setTextColor(255,255,255); pdf.setFontSize(20); pdf.setFont("helvetica","bold");
  pdf.text("KUDIAITRACK",14,18);
  pdf.setFontSize(9); pdf.setFont("helvetica","normal");
  pdf.setTextColor(34,197,94); pdf.text("Token Receipt",14,27);
  pdf.setTextColor(180,200,240); pdf.text(`${longDate}  .  ${shortDT.split(" ").slice(-1)[0]}`,14,36);
  if (psRef) {
    pdf.setFont("helvetica","bold"); pdf.setFontSize(7.5); pdf.setTextColor(34,197,94);
    pdf.text("PAYMENT REF",W-14,24,{align:"right"});
    pdf.setFont("courier","normal"); pdf.setFontSize(8.5); pdf.setTextColor(255,255,255);
    pdf.text(psRef,W-14,32,{align:"right"});
  }
  pdf.setFillColor(22,163,74); pdf.rect(0,44,W,2.5,"F");
  const meta = [
    ["Business", biz], ["Product", label],
    ["Total Paid", `NGN ${Number(amount).toLocaleString("en-NG")}`],
    ["Tokens Issued", String(pinsArr.length)], ["Status","SUCCESSFUL"],
    ["Generated", shortDT],
  ];
  let ry = 57;
  for (const [k,v] of meta) {
    pdf.setFont("helvetica","bold"); pdf.setFontSize(8); pdf.setTextColor(120,135,160);
    pdf.text(k.toUpperCase(),14,ry);
    pdf.setFont("helvetica","normal"); pdf.setTextColor(20,20,20); pdf.text(String(v),72,ry);
    ry += 11;
  }
  const sx=225,sy=115,sr=40;
  pdf.setFillColor(240,253,244); pdf.circle(sx,sy,sr,"F");
  pdf.setDrawColor(22,163,74); pdf.setLineWidth(1.8); pdf.circle(sx,sy,sr);
  pdf.setLineWidth(0.7); pdf.circle(sx,sy,sr-5);
  pdf.setFont("helvetica","bold"); pdf.setFontSize(15); pdf.setTextColor(22,163,74);
  pdf.text("PAID",sx,sy-3,{align:"center"});
  pdf.setFontSize(8.5); pdf.text("& ISSUED",sx,sy+7,{align:"center"});
  pdf.setFontSize(6.5); pdf.setFont("helvetica","normal"); pdf.text(longDate,sx,sy+16,{align:"center"});
  pdf.setFillColor(15,29,66); pdf.rect(0,H-20,W,20,"F");
  pdf.setFont("helvetica","bold"); pdf.setFontSize(7); pdf.setTextColor(34,197,94);
  pdf.text("AMAYA & Co. Technologies",14,H-9);
  pdf.setFont("helvetica","normal"); pdf.setTextColor(150,165,190);
  pdf.text("Computer-generated receipt . Powered by KudiAI Track",W-14,H-9,{align:"right"});

  // ── PAGE 2+: NIGERIAN RECHARGE CARD FORMAT ─────────────────────────────────
  // One page-set per network (so MTN / Glo / Airtel / 9mobile get their own pages)
  const groups = {};
  for (const pin of pinsArr) {
    const net = pin.network || "Token";
    if (!groups[net]) groups[net] = [];
    groups[net].push(pin);
  }

  const COLS=5, ROWS=5, PER_PAGE=25;
  const LM=8, TM=10, BM=8;
  const cW=(W-2*LM)/COLS;          // 56.2 mm
  const cH=(H-TM-BM)/ROWS;         // 38.4 mm
  const HDR=10;                     // coloured header band height

  for (const [netName, netPins] of Object.entries(groups)) {
    const cfg   = NET_PDF[netName] || DEF_NET_PDF;
    const pages = Math.ceil(netPins.length / PER_PAGE);

    for (let pg=0; pg<pages; pg++) {
      pdf.addPage();

      // Tiny page label
      pdf.setFont("helvetica","normal"); pdf.setFontSize(5); pdf.setTextColor(170,170,170);
      pdf.text(
        `${biz}  |  ${netName} ${denom} ${isData?"Data":"Airtime"} Tokens${pages>1?`  (${pg+1}/${pages})`:""}`,
        W/2, 5.5, {align:"center"}
      );

      const slice = netPins.slice(pg*PER_PAGE,(pg+1)*PER_PAGE);

      for (let i=0; i<slice.length; i++) {
        const pin  = slice[i];
        const col  = i%COLS;
        const row  = Math.floor(i/COLS);
        const x    = LM + col*cW;
        const y    = TM + row*cH;

        const code   = String(pin.EPIN ?? pin.pin ?? pin.code ?? "");
        const serial = String(pin.EPIN_SERIAL ?? pin.sno ?? pin.serial ?? "");

        // ── Card shell ──────────────────────────────────────────────────────
        pdf.setFillColor(255,255,255); pdf.rect(x,y,cW,cH,"F");
        pdf.setLineDashPattern([],0); pdf.setDrawColor(190,190,190); pdf.setLineWidth(0.3);
        pdf.rect(x,y,cW,cH);

        // ── Coloured header band (full-width, like real card) ───────────────
        pdf.setFillColor(cfg.r,cfg.g,cfg.b); pdf.rect(x,y,cW,HDR,"F");

        // Network name — left, large, bold
        pdf.setFont("helvetica","bold"); pdf.setFontSize(8); pdf.setTextColor(cfg.tr,cfg.tg,cfg.tb);
        pdf.text(netName, x+2.5, y+6.5);

        // Denomination — center, large, bold
        pdf.setFontSize(8);
        pdf.text(denom, x+cW/2, y+6.5, {align:"center"});

        // Brand — right, small
        pdf.setFontSize(5); pdf.setFont("helvetica","normal");
        pdf.text(biz, x+cW-2.5, y+6.5, {align:"right"});

        // ── Card body content ───────────────────────────────────────────────
        const cx  = x + 2.5;

        // "PIN:" label
        pdf.setFont("helvetica","bold"); pdf.setFontSize(5.5); pdf.setTextColor(110,110,110);
        pdf.text("PIN:", cx, y+HDR+4);

        // PIN value — large courier bold (dashes like real card)
        pdf.setFont("courier","bold"); pdf.setFontSize(9); pdf.setTextColor(5,5,5);
        pdf.text(pinDashed(code), cx, y+HDR+9.5);

        // S/N
        if (serial) {
          pdf.setFont("helvetica","normal"); pdf.setFontSize(5.5); pdf.setTextColor(100,100,100);
          pdf.text(`S/N: ${serial}`, cx, y+HDR+15.5);
        }

        // Date
        pdf.setFont("helvetica","normal"); pdf.setFontSize(5); pdf.setTextColor(130,130,130);
        pdf.text(`Date: ${shortDT}`, cx, y+HDR+20.5);

        // Dial instruction — bold, bottom of card
        pdf.setFont("helvetica","bold"); pdf.setFontSize(5.5); pdf.setTextColor(40,40,40);
        const dialCode = isData ? cfg.dataDial : cfg.dial;
        pdf.text(`Dial ${dialCode}, then Send`, cx, y+cH-3);

        // Cut guide marks at corners
        pdf.setTextColor(200,200,200); pdf.setFontSize(6); pdf.setFont("helvetica","normal");
        pdf.text("+",x,y,{align:"center"}); pdf.text("+",x+cW,y,{align:"center"});
        pdf.text("+",x,y+cH,{align:"center"}); pdf.text("+",x+cW,y+cH,{align:"center"});
      }
    }
  }

  pdf.save(`KudiAI_Tokens_${Date.now()}.pdf`);
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */


function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })
    + " · " + d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

function detectNetwork(phone) {
  const clean = phone.replace(/\D/g, "");
  let prefix;
  if (clean.startsWith("234") && clean.length >= 6) prefix = "0" + clean.slice(3, 6);
  else if (clean.length >= 4) prefix = clean.slice(0, 4);
  else return null;
  const MTN    = ["0703","0706","0803","0806","0810","0813","0814","0816","0903","0906","0913","0916"];
  const AIRTEL = ["0701","0708","0802","0808","0812","0901","0902","0904","0907","0911","0912","0917"];
  const GLO    = ["0705","0805","0807","0811","0815","0905","0915"];
  const NMOB   = ["0809","0817","0818","0908","0909","0919"];
  if (MTN.includes(prefix))    return "MTN";
  if (AIRTEL.includes(prefix)) return "Airtel";
  if (GLO.includes(prefix))    return "Glo";
  if (NMOB.includes(prefix))   return "9mobile";
  return null;
}

/* ─── Icons ───────────────────────────────────────────────────────────────── */

function Ico({ d, size = 22, c = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const CAT_ICONS = {
  airtime:       "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.122.966.356 1.916.7 2.81a2 2 0 01-.45 2.11L6.95 7.91a16 16 0 006.29 6.29l1.27-.56a2 2 0 012.11-.45c.894.344 1.844.578 2.81.7A2 2 0 0122 16.92z",
  data:          "M1.05 5l4.95-3 4.95 3 4.95-3L21 5|M1.05 11l4.95-3 4.95 3 4.95-3L21 11|M1.05 17l4.95-3 4.95 3 4.95-3L21 17",
  cable:         "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8",
  electricity:   "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  betting:       "M12 2a10 10 0 100 20 10 10 0 000-20z|M12 8v4l3 3",
  waec:          "M12 2L2 7l10 5 10-5-10-5z|M2 17l10 5 10-5|M2 12l10 5 10-5",
  jamb:          "M4 19.5A2.5 2.5 0 016.5 17H20|M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z",
  spectranet:    "M5 12.55a11 11 0 0114.08 0|M1.42 9a16 16 0 0121.16 0|M8.53 16.11a6 6 0 016.95 0|M12 20h.01",
  smile:         "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z",
  "print-airtime": "M6 9V2h12v7|M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2|M6 14h12v8H6v-8z",
  "print-data":     "M6 9V2h12v7|M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2|M6 14h12v8H6v-8z",
  "airtime-bundle": "M20 12v10H4V12|M2 7h20v5H2z|M12 22V7|M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z|M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z",
};

/* ─── Shared sub-components ───────────────────────────────────────────────── */

function NetworkSelector({ value, onChange, detected }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Network *</label>
        {detected && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 px-2 py-0.5 rounded-full">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            Auto-detected
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {NETWORKS.map(n => {
          const cfg = NET_CONFIG[n];
          const sel = value === n;
          return (
            <button key={n} type="button" onClick={() => onChange(n)}
              className={`relative flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1 transition-all duration-150 active:scale-95 border-2 ${sel ? "shadow-md" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"}`}
              style={sel ? { borderColor: cfg.bg + "99", background: cfg.bg + "18" } : {}}>
              <div className="w-full h-8 rounded-xl flex items-center justify-center" style={{ background: cfg.bg }}>
                <span className="text-[10px] font-black tracking-wide leading-none" style={{ color: cfg.fg }}>{cfg.abbr}</span>
              </div>
              <span className={`text-[9px] font-bold leading-none ${sel ? "text-slate-700 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>{n}</span>
              {sel && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center shadow-sm" style={{ background: cfg.bg }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={cfg.fg} strokeWidth={4} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PhoneInput({ value, onChange, label = "Phone Number *", placeholder = "08012345678" }) {
  const detected = value.length >= 4 ? detectNetwork(value) : null;
  const cfg = detected ? NET_CONFIG[detected] : null;
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</label>
      <div className="relative">
        <input type="tel" value={value} onChange={onChange} placeholder={placeholder}
          className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 pr-20" />
        {cfg && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black px-2 py-0.5 rounded-full leading-none"
            style={{ background: cfg.bg, color: cfg.fg }}>{cfg.abbr}</span>
        )}
      </div>
    </div>
  );
}

function SelectInput({ label, value, onChange, options, placeholder = "Select…" }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
      </select>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
    </div>
  );
}

function VerifyBadge({ status, name }) {
  if (status === "loading") return (
    <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2">
      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full spinner" />
      <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">Verifying…</p>
    </div>
  );
  if (status === "ok") return (
    <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-3 py-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
      <p className="text-xs text-green-700 dark:text-green-300 font-semibold">{name}</p>
    </div>
  );
  if (status === "error") return (
    <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth={2.5} strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
      <p className="text-xs text-red-700 dark:text-red-300 font-medium">{name}</p>
    </div>
  );
  return null;
}

function PlanGrid({ plans, selectedId, onSelect, loading, error, onRetry }) {
  if (loading) return (
    <div className="grid grid-cols-3 gap-2">
      {[1,2,3,4,5,6].map(i => <div key={i} className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />)}
    </div>
  );
  if (error) return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-3 space-y-2">
      <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-bold text-red-600 dark:text-red-400 underline">Retry</button>}
    </div>
  );
  if (!plans.length) return null;
  return (
    <div className="grid grid-cols-3 gap-2">
      {plans.map(pl => (
        <button key={pl.plan_id} type="button" onClick={() => onSelect(pl)}
          className={`py-2 px-1 rounded-xl border-2 text-center transition-colors ${selectedId === pl.plan_id ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
          <p className="text-[11px] font-bold leading-tight">{pl.plan_name}</p>
          {pl.plan_amount ? <p className="text-[10px] font-medium mt-0.5">₦{Number(pl.plan_amount).toLocaleString()}</p> : null}
        </button>
      ))}
    </div>
  );
}

/* ─── Data-plan card grid ─────────────────────────────────────────────────── */

function parseDataPlan(planName) {
  const name = planName || "";
  const sizeMatch = name.match(/(\d+\.?\d*)\s*(GB|MB)/i);
  const size  = sizeMatch ? parseFloat(sizeMatch[1]) : null;
  const unit  = sizeMatch ? sizeMatch[2].toUpperCase() : "GB";
  const dayMatch   = name.match(/(\d+)\s*[Dd]ay/);
  const monthMatch = name.match(/(\d+)\s*[Mm]onth/i) || (/[Mm]onthly/i.test(name) ? [null, "1"] : null);
  let duration = null, durationDays = 0;
  if (dayMatch) {
    const d = parseInt(dayMatch[1]);
    duration = `${d} Day${d > 1 ? "s" : ""}`;
    durationDays = d;
  } else if (monthMatch) {
    const m = parseInt(monthMatch[1]) || 1;
    duration = `${m} Month${m > 1 ? "s" : ""}`;
    durationDays = m * 30;
  }
  const category = durationDays <= 1 ? "daily" : durationDays <= 7 ? "weekly" : "monthly";
  return { size, unit, duration, category };
}

const DATA_TABS = ["All", "Daily", "Weekly", "Monthly"];

function DataPlanGrid({ plans, selectedId, onSelect, loading, error, onRetry, cashback = 0, pointsEnabled = false }) {
  const [activeTab, setActiveTab] = useState("All");
  useEffect(() => { setActiveTab("All"); }, [plans]);

  const filtered = useMemo(() => {
    if (activeTab === "All") return plans;
    return plans.filter(pl => parseDataPlan(pl.plan_name).category === activeTab.toLowerCase());
  }, [plans, activeTab]);

  if (loading) return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {DATA_TABS.map(t => <div key={t} className="h-7 w-16 bg-slate-100 dark:bg-slate-700 rounded-full animate-pulse" />)}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {[1,2,3,4,5,6].map(i => <div key={i} className="h-24 bg-slate-100 dark:bg-slate-700 rounded-2xl animate-pulse" />)}
      </div>
    </div>
  );
  if (error) return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-3 space-y-2">
      <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-bold text-red-600 dark:text-red-400 underline">Retry</button>}
    </div>
  );
  if (!plans.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {DATA_TABS.map(tab => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors ${activeTab === tab ? "bg-blue-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
            {tab}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {filtered.map(pl => {
          const { size, unit, duration } = parseDataPlan(pl.plan_name);
          const price = Number(pl.plan_amount);
          const earnedCashback = cashback ? Math.floor(price * 0.01) : 0;
          const earnedPts = pointsEnabled && !cashback ? Math.floor(price / 50) : 0;
          const sel = selectedId === pl.plan_id;
          return (
            <button key={pl.plan_id} type="button" onClick={() => onSelect(pl)}
              className={`py-3 px-2 rounded-2xl border-2 text-center transition-all active:scale-95 ${sel ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"}`}>
              {size != null ? (
                <p className={`leading-none font-black ${sel ? "text-blue-700 dark:text-blue-300" : "text-slate-800 dark:text-white"}`}>
                  <span className="text-2xl">{size}</span>
                  <span className="text-sm">{unit}</span>
                </p>
              ) : (
                <p className={`text-[11px] font-bold leading-tight ${sel ? "text-blue-700 dark:text-blue-300" : "text-slate-800 dark:text-white"}`}>{pl.plan_name}</p>
              )}
              {duration && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{duration}</p>}
              <p className={`text-xs font-black mt-1.5 ${sel ? "text-blue-600 dark:text-blue-300" : "text-slate-700 dark:text-slate-300"}`}>
                ₦{price.toLocaleString()}
              </p>
              {earnedCashback > 0 ? (
                <p className="text-[9px] font-bold text-green-600 dark:text-green-400 mt-0.5">+₦{earnedCashback} Cashback</p>
              ) : earnedPts > 0 ? (
                <p className="text-[9px] font-bold text-amber-600 dark:text-amber-400 mt-0.5">+{earnedPts} pts</p>
              ) : null}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <p className="text-center text-xs text-slate-400 dark:text-slate-500 py-4">No {activeTab.toLowerCase()} plans</p>
      )}
    </div>
  );
}

/* ─── Overview / history ───────────────────────────────────────────────────── */

function Overview({ bills }) {
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
  const successful = bills.filter(b => b.bill_status !== "failed");
  const todayTotal = successful.filter(b => (b.transaction_date || "") === todayStr).reduce((s, b) => s + b.amount, 0);
  const weekTotal  = successful.filter(b => (b.transaction_date || "") >= weekAgoStr).reduce((s, b) => s + b.amount, 0);
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/60 overflow-hidden shadow-sm">
      <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/60">
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Today</p>
          <p className="text-xl font-black text-slate-800 dark:text-white leading-tight mt-0.5">{fmt(todayTotal)}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Last 7 Days</p>
          <p className="text-xl font-black text-slate-800 dark:text-white leading-tight mt-0.5">{fmt(weekTotal)}</p>
        </div>
      </div>
    </div>
  );
}

function BillRow({ bill, onOpen }) {
  const cat = CATS.find(c => c.id === bill.category) || CATS[0];
  const failed = bill.bill_status === "failed";
  return (
    <div onClick={onOpen}
      className={`rounded-2xl px-4 py-3.5 border flex items-center gap-3 shadow-sm cursor-pointer active:scale-[0.98] transition-transform ${failed ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/50" : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700/50"}`}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: failed ? "linear-gradient(135deg,#ef4444,#dc2626)" : `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
        <Ico d={CAT_ICONS[bill.category] || CAT_ICONS.airtime} size={18} c="white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{bill.item_name}</p>
          {failed && <span className="text-[9px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">FAILED</span>}
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
          {bill.customer_name && `${bill.customer_name} · `}{fmtDT(bill.created_at)}
        </p>
        {bill.note && <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate italic">{bill.note}</p>}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <p className={`text-sm font-extrabold ${failed ? "text-red-400 line-through" : "text-red-500"}`}>{fmt(bill.amount)}</p>
        <Ico d="M9 18l6-6-6-6" size={14} c="#94a3b8" />
      </div>
    </div>
  );
}

/* ─── PIN/card details modal ──────────────────────────────────────────────── */

function PinModal({ pins, title, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-800 dark:text-white">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <Ico d="M18 6L6 18|M6 6l12 12" size={14} c="#64748b" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
          {pins.map((pin, i) => (
            <div key={i} className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-200 dark:border-slate-700">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Pin {i + 1}</p>
              <p className="font-mono text-sm font-bold text-slate-800 dark:text-white break-all">{String(pin.pin ?? pin)}</p>
              {pin.sno && <p className="text-[10px] text-slate-400 mt-0.5">S/N: {pin.sno}</p>}
            </div>
          ))}
        </div>
        <div className="px-5 pb-5">
          <button onClick={onClose} className="w-full bg-slate-800 dark:bg-slate-700 text-white rounded-xl py-3 text-sm font-bold">Done</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main component ───────────────────────────────────────────────────────── */

function KeyStatusPanel({ onClose }) {
  const [results, setResults]   = useState(null);
  const [checking, setChecking] = useState(true);

  const run = useCallback(async () => {
    setChecking(true); setResults(null);
    try { const r = await clubkonnect("health-check", {}); setResults(r?.results || []); }
    catch (e) { setResults([{ label: "Error", ok: false, detail: e.message }]); }
    finally { setChecking(false); }
  }, []);

  useState(() => { run(); }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-800 dark:text-white">API Key Status</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <Ico d="M18 6L6 18|M6 6l12 12" size={14} c="#64748b" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-2 max-h-96 overflow-y-auto">
          {checking && (
            <div className="flex items-center gap-3 py-4 justify-center">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full spinner" />
              <p className="text-sm text-slate-500">Checking all services…</p>
            </div>
          )}
          {results && results.map((r, i) => (
            <div key={i} className={`rounded-xl px-4 py-2.5 border ${r.ok ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"}`}>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold ${r.ok ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>{r.label}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.ok ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"}`}>
                  {r.ok ? "OK" : r.detail || "Invalid Key"}
                </span>
              </div>
              {!r.ok && r.raw && (
                <p className="text-[10px] text-red-400 dark:text-red-500 mt-1 break-all leading-tight">{r.raw}</p>
              )}
            </div>
          ))}
          {results && results.some(r => !r.ok) && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
              Services showing "Invalid Key" need their API key updated in Supabase secrets. Contact your service provider to get the correct API key for each broken service.
            </p>
          )}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={run} disabled={checking}
            className="flex-1 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl py-2.5 text-sm disabled:opacity-50">
            Re-check
          </button>
          <button onClick={onClose} className="flex-1 bg-slate-800 dark:bg-slate-700 text-white font-bold rounded-xl py-2.5 text-sm">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const BILL_PENDING_PREFIX = "ck_bill_pending_";

/* ─── Map a stored bill transaction to BillReceipt props ─────────────────── */
function billToReceipt(bill, profile, staffName) {
  const refMatch   = (bill.note || "").match(/Ref:\s*([^\s|]+)/i);
  const tokenMatch = (bill.note || "").match(/Token:\s*([^|]+)/i);
  return {
    ...bill,
    businessName: profile?.business_name || profile?.owner_name || "My Business",
    service:      CATS.find(c => c.id === bill.category)?.label || bill.category,
    apiRef:       refMatch?.[1] || "",
    token:        tokenMatch?.[1]?.trim() || undefined,
    staffName:    staffName || undefined,
  };
}

/* ─── PDF statement generator ────────────────────────────────────────────── */
function genBillStatement(allBills, catFilter, period, profile) {
  const biz = profile?.business_name || profile?.owner_name || "My Business";

  let rows = catFilter === "all" ? [...allBills] : allBills.filter(b => b.category === catFilter);
  const now = new Date();
  if (period === "month") {
    rows = rows.filter(b => {
      const d = new Date(b.created_at || b.transaction_date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  } else if (period === "last3") {
    const cut = new Date(); cut.setMonth(cut.getMonth() - 3);
    rows = rows.filter(b => new Date(b.created_at || b.transaction_date) >= cut);
  } else if (period === "year") {
    rows = rows.filter(b => new Date(b.created_at || b.transaction_date).getFullYear() === now.getFullYear());
  }

  const svcName     = catFilter === "all" ? "All Services" : (CATS.find(c => c.id === catFilter)?.label || catFilter);
  const periodLabel = { month: "This Month", last3: "Last 3 Months", year: "This Year", all: "All Time" }[period] || "All Time";
  const totalAmt    = rows.filter(b => b.bill_status !== "failed").reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
  const successCnt  = rows.filter(b => b.bill_status !== "failed").length;

  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const W = 210, M = 14;

  // Header band
  pdf.setFillColor(27, 42, 94);
  pdf.rect(0, 0, W, 42, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(20); pdf.setFont("helvetica", "bold");
  pdf.text("KUDITRACK", M, 17);
  pdf.setFontSize(11); pdf.setFont("helvetica", "normal");
  pdf.text("BILL PAYMENT STATEMENT", M, 26);
  pdf.setFontSize(9); pdf.setTextColor(100, 220, 140);
  pdf.text(`Generated: ${now.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}`, M, 35);

  // Green stripe
  pdf.setFillColor(22, 163, 74);
  pdf.rect(0, 42, W, 3, "F");

  let y = 54;
  pdf.setFontSize(10); pdf.setTextColor(30, 30, 30);
  const info = [["Business", biz], ["Service", svcName], ["Period", periodLabel], ["Total Transactions", String(rows.length)]];
  for (const [lbl, val] of info) {
    pdf.setFont("helvetica", "bold"); pdf.text(`${lbl}:`, M, y);
    pdf.setFont("helvetica", "normal"); pdf.text(val, M + 50, y);
    y += 7;
  }
  y += 6;

  // Table header
  pdf.setFillColor(27, 42, 94);
  pdf.rect(M, y, W - 2 * M, 8, "F");
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(7.5); pdf.setFont("helvetica", "bold");
  const cx = [M + 1, M + 24, M + 70, M + 118, M + 143, M + 162];
  ["DATE", "SERVICE", "DESCRIPTION", "BENEFICIARY", "STATUS", "AMOUNT (₦)"].forEach((h, i) => pdf.text(h, cx[i], y + 5.5));
  y += 10;

  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5);
  let alt = false;
  for (const b of rows) {
    if (y > 272) { pdf.addPage(); y = 20; }
    pdf.setFillColor(...(alt ? [240, 240, 248] : [255, 255, 255]));
    pdf.rect(M, y - 1, W - 2 * M, 7, "F");
    const dateStr = b.created_at
      ? new Date(b.created_at).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "2-digit" })
      : (b.transaction_date || "");
    const failed = b.bill_status === "failed";
    pdf.setTextColor(...(failed ? [185, 28, 28] : [30, 30, 30]));
    pdf.text(dateStr,                                              cx[0], y + 4.5);
    pdf.text((CATS.find(c => c.id === b.category)?.label || b.category || "").slice(0, 14), cx[1], y + 4.5);
    pdf.text((b.item_name     || "").slice(0, 24),                cx[2], y + 4.5);
    pdf.text((b.customer_name || "").slice(0, 16),                cx[3], y + 4.5);
    pdf.text(failed ? "Failed" : "Success",                       cx[4], y + 4.5);
    pdf.text(Number(b.amount || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 }), cx[5], y + 4.5);
    y += 7; alt = !alt;
  }

  // Summary line
  pdf.setDrawColor(22, 163, 74); pdf.setLineWidth(0.5);
  pdf.line(M, y + 2, W - M, y + 2); y += 9;
  pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(30, 30, 30);
  pdf.text(`Successful: ${successCnt} of ${rows.length} transactions`, M, y);
  pdf.setTextColor(22, 163, 74);
  pdf.text(`₦${totalAmt.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`, W - M, y, { align: "right" });

  // Footer
  pdf.setFillColor(27, 42, 94);
  pdf.rect(0, 280, W, 17, "F");
  pdf.setFontSize(8); pdf.setFont("helvetica", "bold"); pdf.setTextColor(100, 220, 140);
  pdf.text("AMAYA & Co. Technologies", M, 289);
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(180, 180, 200);
  pdf.text("Computer-generated statement. No signature required.", W - M, 289, { align: "right" });

  pdf.save(`KudiTrack_Bill_Statement_${svcName.replace(/\s+/g, "_")}_${now.toISOString().slice(0, 10)}.pdf`);
}

/* ─── Statement modal ────────────────────────────────────────────────────── */
function BillStatementModal({ bills, profile, onClose }) {
  const [catFilter, setCatFilter] = useState("all");
  const [period,    setPeriod]    = useState("month");
  const [busy,      setBusy]      = useState(false);

  const usedCats = useMemo(() => {
    const ids = [...new Set(bills.map(b => b.category))];
    return ids.map(id => CATS.find(c => c.id === id)).filter(Boolean);
  }, [bills]);

  const handleGenerate = async () => {
    setBusy(true);
    try { genBillStatement(bills, catFilter, period, profile); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-w-md pb-safe-bottom">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white">Generate Statement</h3>
            <p className="text-xs text-slate-400 mt-0.5">Download PDF for any service or period</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
            <Ico d="M18 6L6 18|M6 6l12 12" size={14} c="#64748b" />
          </button>
        </div>

        <div className="px-5 pt-5 pb-6 space-y-5">
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">Service</p>
            <div className="flex flex-wrap gap-2">
              {[{ id: "all", label: "All Services" }, ...usedCats].map(c => (
                <button key={c.id} onClick={() => setCatFilter(c.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${catFilter === c.id ? "bg-[#1B2A5E] border-[#1B2A5E] text-white" : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">Period</p>
            <div className="flex flex-wrap gap-2">
              {[{ id: "month", label: "This Month" }, { id: "last3", label: "Last 3 Months" }, { id: "year", label: "This Year" }, { id: "all", label: "All Time" }].map(p => (
                <button key={p.id} onClick={() => setPeriod(p.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${period === p.id ? "bg-[#1B2A5E] border-[#1B2A5E] text-white" : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleGenerate} disabled={busy}
            className="w-full bg-[#1B2A5E] text-white rounded-2xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-transform">
            {busy
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <>
                  <Ico d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M12 18v-6|M9 15h6" size={15} c="white" />
                  Download PDF Statement
                </>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Premium result overlay (processing → success / disrupted / failed) ──── */
function BillResultOverlay({ saving, fulfillResult, profile, businessName, staffName, onDone, onShareReceipt }) {
  const catLabel = fulfillResult?.cat
    ? (CATS.find(c => c.id === fulfillResult.cat)?.label || "Bill Payment")
    : "Bill Payment";

  /* Shared header — logo left, service right, green stripe below */
  const Header = () => (
    <div className="flex-shrink-0">
      <div className="px-5 pt-6 pb-5 flex items-center justify-between"
        style={{ background: "linear-gradient(135deg,#0F1D42 0%,#1B2A5E 60%,#1e3a6e 100%)" }}>
        {/* Brand left */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl overflow-hidden bg-white/10 flex items-center justify-center shadow-inner">
            <img src="/logo.png" alt="KudiAI Track"
              className="w-9 h-9 object-contain"
              onError={e => { e.target.style.display = "none"; }} />
          </div>
          <div>
            <p className="text-[11px] font-black tracking-widest uppercase" style={{ color: "#22c55e" }}>KudiAI Track</p>
            <p className="text-[9px] font-medium" style={{ color: "rgba(255,255,255,0.45)" }}>Bill Payment Services</p>
          </div>
        </div>
        {/* Service label right */}
        <div className="text-right">
          <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>Service</p>
          <p className="text-[13px] font-black text-white leading-tight">{catLabel}</p>
        </div>
      </div>
      {/* Green accent stripe */}
      <div style={{ height: 3, background: "linear-gradient(90deg,#16a34a,#22c55e)" }} />
      {/* Ref bar — only when a payment ref exists */}
      {fulfillResult?.psRef ? (
        <div className="px-5 py-1.5 flex items-center justify-between" style={{ background: "#f0fdf4" }}>
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Payment Ref</span>
          <span className="text-[10px] font-mono font-black" style={{ color: "#16a34a" }}>{fulfillResult.psRef.slice(0, 22)}</span>
        </div>
      ) : null}
    </div>
  );

  /* Shared footer */
  const Footer = () => (
    <div className="flex-shrink-0 px-5 py-3 flex items-center justify-between"
      style={{ background: "linear-gradient(135deg,#0F1D42,#1B2A5E)" }}>
      <div>
        <p className="text-[10px] font-black" style={{ color: "#22c55e" }}>AMAYA &amp; Co. Technologies</p>
        <p className="text-[8.5px]" style={{ color: "rgba(255,255,255,0.35)" }}>All rights reserved · Copyright © 2026</p>
      </div>
      {/* Decorative barcode */}
      <div className="flex gap-[2px] items-end" style={{ opacity: 0.18 }}>
        {[10, 6, 14, 4, 12, 8, 16, 5, 10, 4, 14].map((h, i) => (
          <div key={i} style={{ height: h, width: 2.5, background: "white", borderRadius: 1 }} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "#f1f5f9" }}>
      <Header />

      {/* ── Processing ── */}
      {saving && !fulfillResult && (
        <div className="flex-1 flex flex-col items-center justify-center gap-7 px-8">
          <div className="relative">
            <div className="absolute inset-0 rounded-full animate-ping" style={{ background: "rgba(22,163,74,0.18)" }} />
            <div className="relative w-24 h-24 rounded-full shadow-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#0F1D42,#1B2A5E)" }}>
              <img src="/logo.png" alt="" className="w-14 h-14 object-contain"
                onError={e => { e.target.style.display = "none"; }} />
            </div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-black text-slate-800">Payment Confirmed!</p>
            <p className="text-sm text-slate-500 leading-relaxed">Delivering your service, please wait…</p>
            <div className="flex items-center justify-center gap-2 pt-2">
              {[0, 150, 300].map(d => (
                <div key={d} className="w-2 h-2 rounded-full bg-green-500 animate-bounce"
                  style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TXN_HISTORY pending — token may already be at meter ── */}
      {fulfillResult?.ok && fulfillResult?.txnHistoryPending && (
        <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-xl" style={{ background: "rgba(245,158,11,0.3)", transform: "scale(1.4)" }} />
              <div className="relative w-20 h-20 rounded-full shadow-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)" }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-slate-800">Check Your Meter</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">Payment received · Token may already be dispensed</p>
            </div>
          </div>
          <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: "1.5px solid #fde68a" }}>
            <div className="px-4 py-2.5" style={{ background: "#fef3c7" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#92400e" }}>What Happened</p>
            </div>
            <div className="bg-white px-4 py-3 space-y-2">
              <p className="text-sm text-slate-700 leading-relaxed">
                Your payment was successful. The electricity provider recorded this transaction but did not return a token number. <strong>The token may already be loaded on your meter</strong> — please check before retrying.
              </p>
            </div>
          </div>
          <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #bbf7d0" }}>
            <div className="px-4 py-2.5" style={{ background: "#f0fdf4" }}>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#15803d" }}>Payment Reference · Keep This</p>
            </div>
            <div className="bg-white px-4 py-3 space-y-1">
              <p className="font-mono text-sm font-black break-all" style={{ color: "#15803d" }}>{fulfillResult.psRef}</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                If the token is not on your meter within 30 minutes, contact support with this reference.
              </p>
            </div>
          </div>
          <button onClick={onDone}
            className="w-full py-4 font-black rounded-xl text-sm text-white shadow-lg active:scale-[0.98] transition-transform"
            style={{ background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)" }}>
            Done
          </button>
        </div>
      )}

      {/* ── Success ── */}
      {fulfillResult?.ok && !fulfillResult?.txnHistoryPending && (
        <div className="flex-1 overflow-y-auto">
          {/* Amount hero */}
          <div className="bg-white border-b border-slate-100 px-5 py-7 flex flex-col items-center text-center">
            {/* Green glow circle + checkmark */}
            <div className="relative mb-4">
              <div className="absolute inset-0 rounded-full blur-xl" style={{ background: "rgba(22,163,74,0.25)", transform: "scale(1.3)" }} />
              <div className="relative w-20 h-20 rounded-full shadow-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg,#16a34a,#22c55e)" }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "#16a34a" }}>Transaction Successful</p>
            <p className="text-4xl font-black text-slate-900 leading-none">{fmt(fulfillResult.amount || 0)}</p>
            <p className="text-sm text-slate-500 mt-2 font-semibold">{fulfillResult.label}</p>
            {/* Chip */}
            <div className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-black"
              style={fulfillResult.elecOrderId
                ? { background: "#fffbeb", color: "#b45309", border: "1.5px solid #fde68a" }
                : { background: "#f0fdf4", color: "#15803d", border: "1.5px solid #bbf7d0" }}>
              {fulfillResult.elecOrderId
                ? <><div className="w-2.5 h-2.5 rounded-full border-2 border-transparent border-t-amber-500 animate-spin" />PAYMENT RECEIVED · FETCHING TOKEN</>
                : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>DELIVERED SUCCESSFULLY</>
              }
            </div>
            {fulfillResult.earnedPts > 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-black"
                style={{ background: "#fffbeb", color: "#b45309", border: "1.5px solid #fde68a" }}>
                ⭐ +{fulfillResult.earnedPts} pts earned
              </div>
            )}
          </div>

          {/* Detail card */}
          <div className="mx-4 mt-4 rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #e2e8f0", background: "white" }}>
            <div className="px-4 py-2.5" style={{ background: "#f8fafc" }}>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Transaction Details</p>
            </div>
            {fulfillResult.detail.split(" | ").filter(Boolean).map((d, i, arr) => {
              const sep = d.indexOf(": ");
              if (sep === -1) return null;
              const k = d.slice(0, sep);
              const v = d.slice(sep + 2);
              return (
                <div key={i} className={`px-4 py-3 flex items-start justify-between gap-3 ${i < arr.length - 1 ? "border-b border-slate-50" : ""}`}>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex-shrink-0 mt-0.5">{k}</span>
                  <span className="text-sm font-bold text-slate-800 text-right break-all leading-snug">{v}</span>
                </div>
              );
            })}
            {/* Date row */}
            <div className="px-4 py-3 border-t border-slate-50 flex items-start justify-between gap-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex-shrink-0">Date</span>
              <span className="text-sm font-bold text-slate-800">
                {new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </div>
            {/* API Ref */}
            {fulfillResult.apiRef ? (
              <div className="px-4 py-3 border-t border-slate-50 flex items-start justify-between gap-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex-shrink-0">Ref No.</span>
                <span className="text-xs font-mono font-bold break-all text-right" style={{ color: "#16a34a" }}>{fulfillResult.apiRef}</span>
              </div>
            ) : null}
          </div>

          {/* ── Electricity Token — prominent box ── */}
          {(fulfillResult.elecToken || fulfillResult.elecOrderId) && fulfillResult.cat === "electricity" && (
            <div className="mx-4 mt-4 rounded-2xl overflow-hidden shadow-sm" style={{ border: "2px solid #fbbf24" }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#92400e" }}>
                  {fulfillResult.elecToken ? "Electricity Token — Save This!" : "Getting Your Token..."}
                </p>
              </div>
              {fulfillResult.elecToken ? (
                <div className="bg-white px-4 py-4 flex flex-col items-center gap-3">
                  <p className="font-mono text-2xl font-black tracking-widest text-center break-all" style={{ color: "#1e293b" }}>
                    {fulfillResult.elecToken}
                  </p>
                  <button
                    onClick={() => { try { navigator.clipboard.writeText(fulfillResult.elecToken); } catch (_) {} }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black active:scale-95 transition-transform"
                    style={{ background: "#fef3c7", color: "#92400e", border: "1.5px solid #fde68a" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                    Copy Token
                  </button>
                  <p className="text-[10px] text-slate-400 text-center">Enter this token on your prepaid meter to load your units</p>
                </div>
              ) : (
                <div className="bg-white px-4 py-6 flex flex-col items-center gap-3">
                  <div className="relative w-10 h-10">
                    <div className="absolute inset-0 rounded-full border-4 border-amber-100" />
                    <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-amber-400 animate-spin" />
                  </div>
                  <p className="text-xs font-semibold text-slate-500 text-center">Retrieving your token from provider...</p>
                  <p className="text-[10px] text-slate-400 text-center">This can take up to 90 seconds. Please do not close this screen.</p>
                </div>
              )}
            </div>
          )}

          {/* PINs / Vouchers */}
          {fulfillResult.pinsArr?.length > 0 && (
            <div className="mx-4 mt-4 rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: "#f0fdf4" }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#16a34a" }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                  </svg>
                </div>
                <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">PIN(s) / Voucher(s)</p>
                <span className="ml-auto text-[9px] font-black text-white px-2 py-0.5 rounded-full" style={{ background: "#16a34a" }}>
                  {fulfillResult.pinsArr.length}
                </span>
              </div>
              <div className="p-3 space-y-2 bg-white">
                {fulfillResult.pinsArr.map((pin, i) => {
                  const serial = pin.EPIN_SERIAL ?? pin.sno ?? pin.serial ?? "";
                  const code   = pin.EPIN ?? pin.pin ?? pin.code ?? JSON.stringify(pin);
                  const netCfg = pin.network ? NET_CONFIG[pin.network] : null;
                  return (
                    <div key={i} className="rounded-xl px-4 py-3 border" style={{ background: "#f0fdf4", borderColor: "#bbf7d0" }}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">PIN {i + 1}</span>
                          {netCfg && (
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full leading-none" style={{ background: netCfg.bg, color: netCfg.fg }}>{pin.network}</span>
                          )}
                        </div>
                        {serial ? <span className="text-[9px] text-slate-400 font-mono">S/N: {serial}</span> : null}
                      </div>
                      <p className="font-mono font-black tracking-widest text-sm break-all" style={{ color: "#16a34a" }}>{code}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Card details (WAEC/JAMB) */}
          {fulfillResult.cardDetails ? (
            <div className="mx-4 mt-4 rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
              <div className="px-4 py-2.5" style={{ background: "#eff6ff" }}>
                <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#1d4ed8" }}>Card / Scratch Details</p>
              </div>
              <div className="bg-white px-4 py-3">
                <p className="font-mono text-sm font-bold text-slate-800 break-all">{fulfillResult.cardDetails}</p>
              </div>
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="mx-4 mt-5 mb-4 space-y-2.5">
            <button onClick={onShareReceipt}
              className="w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              style={{ border: "2px solid #1B2A5E", color: "#1B2A5E", background: "transparent" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
              </svg>
              Share / Save Receipt
            </button>
            {fulfillResult?.pinsArr?.length > 0 && (
              <button
                onClick={() => generateTokenPDF({ fulfillResult, profile, businessName })}
                className="w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                style={{ border: "2px solid #7c3aed", color: "#7c3aed", background: "transparent" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"/>
                </svg>
                Download Print Cards PDF
              </button>
            )}
            <button onClick={onDone}
              className="w-full py-4 text-white font-black rounded-xl text-sm active:scale-[0.98] transition-transform shadow-lg"
              style={{ background: "linear-gradient(135deg,#16a34a,#059669)" }}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── Payment Disrupted ── */}
      {fulfillResult && !fulfillResult.ok && fulfillResult.disrupted && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-5">
          {/* Amber glow icon */}
          <div className="relative">
            <div className="absolute inset-0 rounded-full blur-xl" style={{ background: "rgba(245,158,11,0.3)", transform: "scale(1.4)" }} />
            <div className="relative w-24 h-24 rounded-full shadow-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)" }}>
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-2xl font-black text-slate-800">Payment Disrupted</p>
            <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-black"
              style={{ background: "#f0fdf4", color: "#15803d", border: "1.5px solid #bbf7d0" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              NOT CHARGED
            </div>
            <p className="text-sm text-slate-500 leading-relaxed pt-1">
              Your payment did not complete — the Paystack page may have been closed or timed out.
            </p>
          </div>
          {/* Info box */}
          <div className="w-full rounded-2xl px-5 py-4 text-center" style={{ background: "#fffbeb", border: "1.5px solid #fde68a" }}>
            <p className="text-sm font-bold" style={{ color: "#92400e" }}>Your account has not been debited.</p>
            <p className="text-xs mt-1" style={{ color: "#b45309" }}>You may safely try your payment again.</p>
          </div>
          <button onClick={onDone}
            className="w-full py-4 font-black rounded-xl text-sm text-white shadow-lg active:scale-[0.98] transition-transform"
            style={{ background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)" }}>
            Try Again
          </button>
        </div>
      )}

      {/* ── Service Delivery Failed ── */}
      {fulfillResult && !fulfillResult.ok && !fulfillResult.disrupted && (
        <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-4">
          {/* Red glow icon */}
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-xl" style={{ background: "rgba(239,68,68,0.25)", transform: "scale(1.4)" }} />
              <div className="relative w-20 h-20 rounded-full shadow-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg,#fee2e2,#fecaca)" }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-slate-800">Service Delivery Failed</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Payment received · Service could not be completed
              </p>
            </div>
          </div>

          {/* Reason from provider */}
          <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #fecaca" }}>
            <div className="px-4 py-2.5" style={{ background: "#fee2e2" }}>
              <p className="text-[9px] font-black text-red-600 uppercase tracking-widest">Reason from Provider</p>
            </div>
            <div className="bg-white px-4 py-3">
              <p className="text-sm font-semibold leading-relaxed" style={{ color: "#b91c1c" }}>{fulfillResult.detail}</p>
            </div>
          </div>

          {/* Paystack ref (money safe) */}
          <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #fde68a" }}>
            <div className="px-4 py-2.5 flex items-center gap-1.5" style={{ background: "#fef3c7" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#92400e" }}>Your Payment Was Received · Keep This Reference</p>
            </div>
            <div className="bg-white px-4 py-3 space-y-2">
              <p className="font-mono text-sm font-black break-all" style={{ color: "#b45309" }}>{fulfillResult.psRef}</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Our team has been automatically alerted. Your service will be fulfilled or a full refund will be issued shortly.
              </p>
            </div>
          </div>

          {/* Assurance notice */}
          <div className="rounded-2xl px-4 py-3" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
            <p className="text-xs font-semibold text-center leading-relaxed" style={{ color: "#1d4ed8" }}>
              A critical alert has been dispatched to the admin and finance team. No further action needed from you.
            </p>
          </div>

          <button onClick={onDone}
            className="w-full py-3.5 font-black rounded-xl text-sm text-white active:scale-[0.98] transition-transform shadow-lg mt-auto"
            style={{ background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)" }}>
            Back to Bill Payments
          </button>
        </div>
      )}

      <Footer />
    </div>
  );
}

export default function BillPayments({ store, plan, staffName = null, staffEmail = null, businessName = null, autoService = null, onAutoOpened = null, excludeCats = [], markup = 1.0, airtimeDiscount = 0, cashback = 0, pointsEnabled = false, bundleAppPct = 0.3 }) {
  const { transactions, addTransaction, profile } = store;
  // plan is a slug string from useAuth (e.g. "enterprise"), not a plan object
  const planSlug = typeof plan === "string" ? plan : (plan?.slug ?? "");
  // Unlock for enterprise: match by feature key or slug name
  const isEnterprise = canDo(planSlug, "apiAccess") || planSlug === "enterprise";

  // Bundle pricing: platform keeps bundleAppPct of gross profit, subscriber saves the rest
  const bundleSubscriberSavings = Math.round(BUNDLE_PROFIT_PER_SET * (1 - bundleAppPct));
  const bundleChargePerSet = BUNDLE_FACE_PER_SET - bundleSubscriberSavings;

  const [selectedCat,   setSelectedCat]   = useState(null);
  const [showKeyStatus, setShowKeyStatus] = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const [form,          setForm]          = useState({});
  const [error,         setError]         = useState("");
  const [receipt,       setReceipt]       = useState(null);
  const [pins,          setPins]          = useState(null);
  const [pointsBalance,   setPointsBalance]   = useState(0);
  const [usePoints,       setUsePoints]       = useState(false);
  const [cashbackBalance, setCashbackBalance] = useState(0);
  const [useCashback,     setUseCashback]     = useState(false);
  const [histCat,         setHistCat]         = useState("all");
  const [histStatus,      setHistStatus]      = useState("all");
  const pointsBalanceRef   = useRef(0);
  const cashbackBalanceRef = useRef(0);

  // Detect Paystack return on first render so overlay appears immediately (no flash)
  const [saving, setSaving] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    return !!(ref && localStorage.getItem(BILL_PENDING_PREFIX + ref));
  });

  // Result of bill fulfillment after Paystack return
  const [fulfillResult, setFulfillResult] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref) return null; // pending — will be resolved by useEffect + fulfillAfterPayment
    // No URL ref: check for orphaned pending entries (user cancelled without redirect)
    const orphaned = Object.keys(localStorage).filter(k => k.startsWith(BILL_PENDING_PREFIX));
    if (orphaned.length > 0) {
      orphaned.forEach(k => localStorage.removeItem(k));
      return { ok: false, disrupted: true, detail: "Your payment was not completed. Please try again.", psRef: "" };
    }
    return null;
  });

  // Verification state
  const [verifyStatus, setVerifyStatus] = useState("idle"); // idle | loading | ok | error
  const [verifyName,   setVerifyName]   = useState("");

  // Dynamic option lists
  const [plans,        setPlans]        = useState([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError,   setPlansError]   = useState("");
  const [pkgs,         setPkgs]         = useState([]);
  const [pkgsLoading,  setPkgsLoading]  = useState(false);
  const [pkgsError,    setPkgsError]    = useState("");

  const bills = useMemo(
    () => transactions.filter(t => t.payment_type === "bill_payment"),
    [transactions]
  );

  const usedBillCats = useMemo(() => {
    const ids = [...new Set(bills.map(b => b.category))];
    return ids.map(id => CATS.find(c => c.id === id)).filter(Boolean);
  }, [bills]);

  const filteredBills = useMemo(() => {
    let r = bills;
    if (histCat    !== "all") r = r.filter(b => b.category === histCat);
    if (histStatus !== "all") r = histStatus === "failed"
      ? r.filter(b => b.bill_status === "failed")
      : r.filter(b => b.bill_status !== "failed");
    return r;
  }, [bills, histCat, histStatus]);

  const resetVerify = () => { setVerifyStatus("idle"); setVerifyName(""); };

  const visibleCats = excludeCats.length ? CATS.filter(c => !excludeCats.includes(c.id)) : CATS;

  const openSheet = useCallback((catId) => {
    if (excludeCats.includes(catId)) return;
    const catMeta = CATS.find(c => c.id === catId);
    if (catMeta?.enterprise && !isEnterprise) return;
    setSelectedCat(catId);
    setForm({ network: "MTN", phone: "", amount: "", planId: "", planName: "",
               provider: "", smartcard: "", meterNo: "", meterType: "01",
               company: "", customerId: "", examType: "", profileId: "",
               accountNo: "", value: "100", quantity: "1", sets: "1" });
    setError(""); setPins(null); resetVerify(); setPlans([]); setPlansError(""); setPkgs([]); setPkgsError("");
    if (catId === "data") loadPlans("data-plans", { network: "MTN" });
    if (catId === "spectranet") loadPlans("spectranet-plans", {});
    if (catId === "smile") loadPlans("smile-plans", {});
    if (catId === "print-data") loadPlans("data-plans", { network: "MTN" });
  }, [isEnterprise, excludeCats]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoService) { openSheet(autoService); onAutoOpened?.(); }
  }, [autoService]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load reward points balance
  useEffect(() => {
    if (!pointsEnabled || !profile?.id) return;
    supabase.from("profiles").select("points_balance").eq("id", profile.id).maybeSingle()
      .then(({ data }) => { const b = data?.points_balance || 0; setPointsBalance(b); pointsBalanceRef.current = b; });
  }, [pointsEnabled, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep ref in sync so fulfillAfterPayment (useCallback) always reads latest balance
  useEffect(() => { pointsBalanceRef.current = pointsBalance; }, [pointsBalance]);

  // Load cashback balance from Supabase (keyed by user email)
  const userEmailCB = staffEmail || profile?.email;
  useEffect(() => {
    if (!userEmailCB) return;
    supabase.from("cashback_transactions").select("amount,type").eq("user_email", userEmailCB)
      .then(({ data }) => {
        if (!data?.length) return;
        const earned   = data.filter(r => r.type === "earned").reduce((s, r) => s + Number(r.amount), 0);
        const redeemed = data.filter(r => r.type === "redeemed").reduce((s, r) => s + Number(r.amount), 0);
        const bal = Math.max(0, Math.floor(earned - redeemed));
        setCashbackBalance(bal);
        cashbackBalanceRef.current = bal;
      });
  }, [userEmailCB]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle return from Paystack redirect — fulfillment runs after first render
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("bill_ref") || params.get("trxref") || params.get("reference");
    if (!ref) return; // orphaned / no-redirect case already handled by initial state

    window.history.replaceState({}, "", window.location.pathname);
    const stored = localStorage.getItem(BILL_PENDING_PREFIX + ref);
    if (!stored) { setSaving(false); return; }
    fulfillAfterPayment(ref, JSON.parse(stored));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect cancellation via bfcache restore (Android back button) or in-app browser close
  const savingRef = useRef(saving);
  savingRef.current = saving;
  useEffect(() => {
    const showDisrupted = () => {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("bill_ref") || params.get("trxref") || params.get("reference");
      if (ref) return; // normal redirect — handled by fulfillAfterPayment
      const keys = Object.keys(localStorage).filter(k => k.startsWith(BILL_PENDING_PREFIX));
      if (keys.length === 0) return;
      keys.forEach(k => localStorage.removeItem(k));
      setSaving(false);
      setSelectedCat(null);
      setFulfillResult({ ok: false, disrupted: true, detail: "Your payment was not completed. Please try again.", psRef: "" });
    };

    // bfcache restore: user pressed back on Paystack and browser served cached page
    const onPageShow = (e) => { if (e.persisted) showDisrupted(); };
    // in-app browser close: Paystack opened in WebView, closed without redirect
    const onVisible  = () => { if (document.visibilityState === "visible" && savingRef.current) showDisrupted(); };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for electricity token when edge function returned PENDING (async processing)
  useEffect(() => {
    const orderId = fulfillResult?.elecOrderId;
    if (!orderId) return;
    let cancelled = false;
    let attempts  = 0;
    const MAX     = 18; // 18 × 5s = 90s max frontend polling
    const poll    = async () => {
      if (cancelled || attempts >= MAX) {
        if (!cancelled) {
          setFulfillResult(prev => prev ? { ...prev, elecOrderId: "", txnHistoryPending: true } : prev);
        }
        return;
      }
      attempts++;
      try {
        const q = await clubkonnect("electricity-query", { orderId });
        if (cancelled) return;
        if (q.status === "SUCCESS" && q.token) {
          const tok = q.token;
          setFulfillResult(prev => {
            if (!prev) return prev;
            const newNote = prev.detail.replace(" | Token loading...", "").replace("Token loading... | ", "").replace("Token loading...", "");
            return { ...prev, elecToken: tok, elecOrderId: "", detail: `Token: ${tok} | ${newNote}`.replace(" |  | ", " | ") };
          });
          return;
        }
        if (q.status === "CANCELLED") {
          setFulfillResult(prev => prev ? { ...prev, elecOrderId: "", txnHistoryPending: true } : prev);
          return;
        }
      } catch (_) {}
      setTimeout(poll, 5000);
    };
    const timer = setTimeout(poll, 5000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [fulfillResult?.elecOrderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeSheet = () => { setSelectedCat(null); setForm({}); setError(""); resetVerify(); setUsePoints(false); setUseCashback(false); };

  const loadPlans = async (action, extra) => {
    setPlansLoading(true); setPlans([]); setPlansError("");
    try {
      const r = await clubkonnect(action, extra);
      if (r?.plans?.length) {
        const network = extra?.network || form.network || "";
        const priced = r.plans.map(p => {
          const customPrice = action === "data-plans" ? lookupDataPrice(network, p.plan_name) : null;
          if (customPrice !== null) return { ...p, plan_amount: customPrice };
          return markup > 1 ? { ...p, plan_amount: Math.ceil(p.plan_amount * markup) } : p;
        });
        setPlans(priced);
      } else { setPlansError(r?.error || "No plans returned from provider"); }
    } catch (e) { setPlansError(e.message || "Failed to load plans"); }
    finally { setPlansLoading(false); }
  };

  const loadPkgs = async (action, extra) => {
    setPkgsLoading(true); setPkgs([]); setPkgsError("");
    try {
      const r = await clubkonnect(action, extra);
      if (r?.packages?.length) { setPkgs(r.packages); }
      else { setPkgsError(r?.error || "No packages returned from provider"); }
    } catch (e) { setPkgsError(e.message || "Failed to load packages"); }
    finally { setPkgsLoading(false); }
  };

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Auto-load cable packages when provider changes
  const handleProviderChange = (provider) => {
    setF("provider", provider); setF("packageId", ""); setF("packageName", ""); setF("amount", "");
    resetVerify(); setF("smartcard", "");
    if (provider) loadPkgs("cable-packages", { provider });
  };

  // Reload data plans when network changes
  const handleNetworkChange = (network) => {
    setF("network", network); setF("planId", ""); setF("planName", ""); setF("amount", "");
    if (selectedCat === "data" || selectedCat === "print-data") loadPlans("data-plans", { network });
  };

  // Verify handlers
  const verifyMeter = async () => {
    if (!form.company || !form.meterNo || !form.meterType) { setError("Select company, meter type and enter meter number"); return; }
    setVerifyStatus("loading"); setError("");
    try {
      const r = await clubkonnect("electricity-verify", { company: form.company, meterNo: form.meterNo, meterType: form.meterType });
      setVerifyStatus("ok"); setVerifyName(r.customer_name);
    } catch (e) {
      setVerifyStatus("error"); setVerifyName(e.message || "Verification failed");
    }
  };

  const verifySmartcard = async () => {
    if (!form.provider || !form.smartcard) { setError("Select provider and enter smartcard number"); return; }
    setVerifyStatus("loading"); setError("");
    try {
      const r = await clubkonnect("cable-verify", { provider: form.provider, smartcard: form.smartcard });
      setVerifyStatus("ok"); setVerifyName(r.customer_name);
    } catch (e) {
      setVerifyStatus("error"); setVerifyName(e.message || "Verification failed");
    }
  };

  const verifyBetting = async () => {
    if (!form.company || !form.customerId) { setError("Select platform and enter customer ID"); return; }
    setVerifyStatus("loading"); setError("");
    try {
      const r = await clubkonnect("betting-verify", { company: form.company, customerId: form.customerId });
      setVerifyStatus("ok"); setVerifyName(r.customer_name);
    } catch (e) {
      setVerifyStatus("error"); setVerifyName(e.message || "Verification failed");
    }
  };

  const verifyJamb = async () => {
    if (!form.examType || !form.profileId) { setError("Select exam type and enter profile ID"); return; }
    setVerifyStatus("loading"); setError("");
    try {
      const r = await clubkonnect("jamb-verify", { examType: form.examType, profileId: form.profileId });
      setVerifyStatus("ok"); setVerifyName(r.customer_name);
    } catch (e) {
      setVerifyStatus("error"); setVerifyName(e.message || "Verification failed");
    }
  };

  const verifySmile = async () => {
    if (!form.accountNo) { setError("Enter account number"); return; }
    setVerifyStatus("loading"); setError("");
    try {
      const r = await clubkonnect("smile-verify", { accountNo: form.accountNo });
      setVerifyStatus("ok"); setVerifyName(r.customer_name);
    } catch (e) {
      setVerifyStatus("error"); setVerifyName(e.message || "Verification failed");
    }
  };

  // ── Step 1: Validate form, initialize Paystack, redirect to checkout ──────────
  const handlePay = async () => {
    setError(""); setSaving(true);
    try {
      const amount = parseFloat(form.amount) || 0;

      // Validate per service
      if (selectedCat === "airtime"     && (!form.phone || !form.network || !amount)) throw new Error("Phone, network and amount required");
      if (selectedCat === "data"        && (!form.phone || !form.planId))              throw new Error("Phone and data plan required");
      if (selectedCat === "cable"       && (!form.provider || !form.packageId || !form.smartcard || !form.phone)) throw new Error("All cable TV fields required");
      if (selectedCat === "cable"       && verifyStatus !== "ok")                      throw new Error("Please verify smartcard number first");
      if (selectedCat === "electricity" && (!form.company || !form.meterType || !form.meterNo || !amount || !form.phone)) throw new Error("All electricity fields required");
      if (selectedCat === "electricity" && verifyStatus !== "ok")                      throw new Error("Please verify meter number first");
      if (selectedCat === "betting"     && (!form.company || !form.customerId || !amount)) throw new Error("Platform, customer ID and amount required");
      if (selectedCat === "betting"     && verifyStatus !== "ok")                      throw new Error("Please verify customer ID first");
      if (selectedCat === "waec"        && (!form.examType || !form.phone))            throw new Error("Exam type and phone required");
      if (selectedCat === "jamb"        && (!form.examType || !form.phone))            throw new Error("Exam type and phone required");
      if (selectedCat === "jamb"        && form.profileId && verifyStatus !== "ok")    throw new Error("Please verify JAMB profile ID first");
      if (selectedCat === "spectranet"  && (!form.accountNo || !form.planId))          throw new Error("Account number and plan required");
      if (selectedCat === "smile"       && (!form.accountNo || !form.planId))          throw new Error("Account number and plan required");
      if (selectedCat === "smile"       && verifyStatus !== "ok")                      throw new Error("Please verify Smile account first");
      if (selectedCat === "print-airtime"   && (!form.network || !form.value || !form.quantity)) throw new Error("Network, value and quantity required");
      if (selectedCat === "print-data"      && (!form.network || !form.planId || !form.quantity))  throw new Error("Network, plan and quantity required");
      if (selectedCat === "airtime-bundle"  && (!form.sets || parseInt(form.sets, 10) < 1))    throw new Error("Select number of sets");

      // Calculate charge amount
      const chargeAmount = selectedCat === "print-airtime"
        ? parseInt(form.value, 10) * parseInt(form.quantity || "1", 10)
        : selectedCat === "print-data"
          ? amount * parseInt(form.quantity || "1", 10)
          : selectedCat === "airtime-bundle"
            ? parseInt(form.sets || "1", 10) * bundleChargePerSet
            : selectedCat === "airtime" && airtimeDiscount > 0
              ? Math.floor(amount * (1 - airtimeDiscount))
              : amount;

      if (!chargeAmount || chargeAmount <= 0) throw new Error("Invalid amount");

      // Points redemption — up to 50% of charge, minimum 50 pts to redeem
      const pointsDiscount = pointsEnabled && usePoints && pointsBalanceRef.current >= 50
        ? Math.min(pointsBalanceRef.current, Math.floor(chargeAmount * 0.5))
        : 0;
      // Cashback redemption — apply full balance up to (chargeAmount - pointsDiscount - 1)
      const cashbackDiscount = useCashback && cashbackBalanceRef.current > 0
        ? Math.min(cashbackBalanceRef.current, Math.max(0, chargeAmount - pointsDiscount - 1))
        : 0;
      const finalAmount = chargeAmount - pointsDiscount - cashbackDiscount;

      // Store bill details so we can fulfill after payment return
      const ref = `KDT-BILL-${Date.now()}`;
      localStorage.setItem(BILL_PENDING_PREFIX + ref, JSON.stringify({
        cat: selectedCat, form: { ...form }, verifyName,
        paidAmount: finalAmount, baseAmount: chargeAmount, pointsDiscount, cashbackUsed: cashbackDiscount,
      }));

      // Initialize Paystack — prefer owner profile email, fall back to staff email
      const email = profile?.email || staffEmail || "";
      const catLabel = CATS.find(c => c.id === selectedCat)?.label || selectedCat;
      const callbackUrl = `${window.location.origin}${window.location.pathname}?bill_ref=${ref}`;

      const { data: ps } = await supabase.functions.invoke("paystack", {
        body: {
          action: "initialize",
          email,
          amount: finalAmount,
          reference: ref,
          callback_url: callbackUrl,
          metadata: {
            bill_type: selectedCat,
            bill_label: catLabel,
            customer: form.phone || form.meterNo || form.smartcard || form.customerId || form.accountNo || "",
          },
        },
      });

      if (ps?.error || !ps?.data?.authorization_url) {
        localStorage.removeItem(BILL_PENDING_PREFIX + ref);
        throw new Error(ps?.error || ps?.data?.message || "Could not initialize payment");
      }

      // Redirect to Paystack checkout
      window.location.href = ps.data.authorization_url;
    } catch (err) {
      setSaving(false);
      setError(err.message || "Payment failed. Please try again.");
    }
  };

  // ── Step 2: Verify payment then fulfill service ───────────────────────────────
  const fulfillAfterPayment = useCallback(async (ref, pending) => {
    setError("");
    try {
      // Verify payment with Paystack
      const { data: vd } = await supabase.functions.invoke("paystack", {
        body: { action: "verify", reference: ref },
      });
      if (vd?.data?.status !== "success") {
        const status = vd?.data?.status || "";
        const gwResp = (vd?.data?.gateway_response || "").toLowerCase();
        const isAbandoned = status === "abandoned" || gwResp.includes("abandon") || gwResp.includes("cancel");
        if (isAbandoned) {
          localStorage.removeItem(BILL_PENDING_PREFIX + ref);
          setSaving(false);
          setFulfillResult({ ok: false, disrupted: true, detail: "Your payment was disrupted before completion. You were not charged.", psRef: ref });
          const { cat: aCat } = pending;
          const aService = CATS.find(c => c.id === aCat)?.label || aCat || "Bill";
          try {
            supabase.functions.invoke("clubkonnect", { body: { action: "bill-cancelled-email", user_email: profile?.email || null, user_name: profile?.owner_name || profile?.business_name || null, service: aService, reference: ref, reason: "The payment session was abandoned before confirmation." } });
          } catch (_) {}
          if (staffEmail && staffEmail !== profile?.email) {
            try {
              supabase.functions.invoke("clubkonnect", { body: { action: "bill-staff-email", staff_email: staffEmail, staff_name: staffName, business_name: businessName || profile?.business_name, service: aService, reference: ref, outcome: "cancelled" } });
            } catch (_) {}
          }
          return;
        }
        throw new Error(vd?.data?.gateway_response || "Payment not confirmed. Please contact support.");
      }

      const { cat, form: f, verifyName: vName, paidAmount, baseAmount, pointsDiscount: redeemedPoints = 0 } = pending;
      let apiRef = "", note = "", itemName = "", customerRef = "", cardDetails = "", pinsArr = null, txnHistoryPending = false, elecToken = "", elecOrderId = "";
      const amount = parseFloat(f.amount) || 0;

      if (cat === "airtime") {
        const r = await clubkonnect("airtime", { phone: f.phone, network: f.network, amount: String(f.amount) });
        apiRef = r.reference; itemName = `${f.network} Airtime`; customerRef = f.phone;
        note = `Network: ${f.network}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "data") {
        const r = await clubkonnect("data", { phone: f.phone, network: f.network, planId: f.planId });
        apiRef = r.reference; itemName = `${f.network} ${f.planName} Data`; customerRef = f.phone;
        note = `Network: ${f.network} | Plan: ${f.planName}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "cable") {
        const r = await clubkonnect("cable", { provider: f.provider, packageId: f.packageId, smartcard: f.smartcard, phone: f.phone });
        apiRef = r.reference;
        const provName = CABLE_PROVIDERS.find(p => p.code === f.provider)?.name || f.provider;
        itemName = `${provName} ${f.packageName}`; customerRef = f.smartcard;
        note = `Smartcard: ${f.smartcard} | ${vName}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "electricity") {
        const r = await clubkonnect("electricity", { company: f.company, meterType: f.meterType, meterNo: f.meterNo, amount: String(f.amount), phone: f.phone });
        apiRef = r.reference;
        const compName = ELECTRICITY_COMPANIES.find(c => c.code === f.company)?.name || f.company;
        const mTypeName = f.meterType === "01" ? "Prepaid" : "Postpaid";
        itemName = `${compName} ${mTypeName}`; customerRef = f.meterNo;
        elecToken = r.token || "";
        if (r.status === "PENDING") {
          // Edge function polled but token not yet ready — frontend will continue polling
          elecOrderId = r.reference || apiRef;
          note = `Meter: ${f.meterNo} | ${vName} | Token loading...${apiRef ? ` | Ref: ${apiRef}` : ""}`;
        } else if (r.status === "TXN_HISTORY") {
          if (elecToken) {
            note = `Token: ${elecToken} | Meter: ${f.meterNo} | ${vName}${apiRef ? ` | Ref: ${apiRef}` : ""}`;
          } else {
            txnHistoryPending = true;
            note = `Meter: ${f.meterNo} | ${vName} | Check meter — token may already be dispensed${apiRef ? ` | Ref: ${apiRef}` : ""}`;
          }
        } else {
          note = elecToken ? `Token: ${elecToken} | Meter: ${f.meterNo} | ${vName}${apiRef ? ` | Ref: ${apiRef}` : ""}` : `Meter: ${f.meterNo} | ${vName}${apiRef ? ` | Ref: ${apiRef}` : ""}`;
        }

      } else if (cat === "betting") {
        const r = await clubkonnect("betting", { company: f.company, customerId: f.customerId, amount: String(f.amount) });
        apiRef = r.reference;
        const compName = BETTING_COMPANIES.find(c => c.code === f.company)?.name || f.company;
        itemName = `${compName} Wallet Top-up`; customerRef = f.customerId;
        note = `Customer: ${f.customerId} | ${vName}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "waec") {
        const r = await clubkonnect("waec", { examType: f.examType, phone: f.phone });
        apiRef = r.reference; cardDetails = r.cardDetails || "";
        itemName = `WAEC ${WAEC_TYPES.find(t => t.code === f.examType)?.name || f.examType}`; customerRef = f.phone;
        note = `Phone: ${f.phone}${cardDetails ? ` | ${cardDetails}` : ""}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "jamb") {
        const r = await clubkonnect("jamb", { examType: f.examType, phone: f.phone });
        apiRef = r.reference; cardDetails = r.cardDetails || "";
        itemName = `JAMB ${JAMB_TYPES.find(t => t.code === f.examType)?.name || f.examType}`; customerRef = f.phone;
        note = `Phone: ${f.phone}${cardDetails ? ` | ${cardDetails}` : ""}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "spectranet") {
        const r = await clubkonnect("spectranet", { accountNo: f.accountNo, planId: f.planId });
        apiRef = r.reference; itemName = `Spectranet ${f.planName}`; customerRef = f.accountNo;
        note = `Account: ${f.accountNo} | Plan: ${f.planName}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "smile") {
        const r = await clubkonnect("smile", { accountNo: f.accountNo, planId: f.planId });
        apiRef = r.reference; itemName = `Smile ${f.planName}`; customerRef = f.accountNo;
        note = `Account: ${f.accountNo} | ${vName}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "print-airtime") {
        const r = await clubkonnect("print-airtime", { network: f.network, value: f.value, quantity: f.quantity });
        apiRef = r.reference; pinsArr = (r.pins || []).map(p => ({ ...p, network: f.network }));
        const qty = parseInt(f.quantity, 10);
        itemName = `${f.network} ₦${f.value} Airtime Print x${qty}`; customerRef = `${qty} pins`;
        note = `Network: ${f.network} | Value: ₦${f.value} x${qty}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "print-data") {
        const r = await clubkonnect("print-data", { network: f.network, planId: f.planId, quantity: f.quantity });
        apiRef = r.reference; pinsArr = (r.pins || []).map(p => ({ ...p, network: f.network }));
        const qty = parseInt(f.quantity, 10);
        itemName = `${f.network} ${f.planName} Data Print x${qty}`; customerRef = `${qty} pins`;
        note = `Network: ${f.network} | Plan: ${f.planName} x${qty}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "airtime-bundle") {
        const sets = parseInt(f.sets || "1", 10);
        const [mtn, airtel, nm, glo] = await Promise.all([
          clubkonnect("print-airtime", { network: "MTN",     value: "1000", quantity: String(sets) }),
          clubkonnect("print-airtime", { network: "Airtel",  value: "1000", quantity: String(sets) }),
          clubkonnect("print-airtime", { network: "9mobile", value: "1000", quantity: String(sets) }),
          clubkonnect("print-airtime", { network: "Glo",     value: "1000", quantity: String(sets) }),
        ]);
        pinsArr = [
          ...(mtn.pins    || []).map(p => ({ ...p, network: "MTN"     })),
          ...(airtel.pins || []).map(p => ({ ...p, network: "Airtel"  })),
          ...(nm.pins     || []).map(p => ({ ...p, network: "9mobile" })),
          ...(glo.pins    || []).map(p => ({ ...p, network: "Glo"     })),
        ];
        apiRef = [mtn.reference, airtel.reference, nm.reference, glo.reference].filter(Boolean).join(" | ");
        itemName    = `All-Network Bundle ×${sets} Set${sets > 1 ? "s" : ""}`;
        customerRef = `${sets * 4} PINs (${sets} per network)`;
        note = `Sets: ${sets} | Networks: MTN, Airtel, 9mobile, Glo | Face value: ₦${(sets * BUNDLE_FACE_PER_SET).toLocaleString()}${apiRef ? ` | Refs: ${apiRef}` : ""}`;
      }

      const totalAmount = cat === "print-airtime"
        ? parseInt(f.value, 10) * parseInt(f.quantity || "1", 10)
        : cat === "print-data"     ? amount * parseInt(f.quantity || "1", 10)
        : cat === "airtime-bundle" ? paidAmount
        : paidAmount || amount;

      const payload = {
        type: "out", category: cat, payment_type: "bill_payment",
        item_name: itemName, customer_name: customerRef,
        amount: totalAmount || amount, note,
        transaction_date: today(),
        bill_status: "success",
      };

      await addTransaction(payload);

      // Cashback: record redeemed amount (if used) and earned amount (1% of paid)
      const { cashbackUsed = 0 } = pending;
      const cbEmail = staffEmail || profile?.email;
      const cbEarned = Math.floor((paidAmount || amount) * 0.01);
      if (cbEmail && (cashbackUsed > 0 || cbEarned > 0)) {
        try {
          const rows = [];
          if (cashbackUsed > 0) rows.push({ user_email: cbEmail, amount: cashbackUsed, type: "redeemed", bill_type: cat, description: `Applied to ${itemName}` });
          if (cbEarned > 0)    rows.push({ user_email: cbEmail, amount: cbEarned,    type: "earned",   bill_type: cat, description: `1% cashback on ${itemName}` });
          await supabase.from("cashback_transactions").insert(rows);
          const newBal = Math.max(0, cashbackBalanceRef.current - cashbackUsed) + cbEarned;
          setCashbackBalance(newBal);
          cashbackBalanceRef.current = newBal;
          setUseCashback(false);
        } catch (_) {}
      }

      // Reward points: earn on data/airtime, deduct redeemed points
      let earnedPts = 0;
      if (pointsEnabled && profile?.id) {
        const earnBase = baseAmount || paidAmount || amount;
        earnedPts = (cat === "data" || cat === "spectranet" || cat === "smile")
          ? Math.floor(earnBase / 50)
          : cat === "airtime" ? Math.floor(earnBase / 100) : 0;
        if (earnedPts > 0 || redeemedPoints > 0) {
          const newBal = Math.max(0, pointsBalanceRef.current - redeemedPoints) + earnedPts;
          try {
            supabase.from("profiles").update({ points_balance: newBal }).eq("id", profile.id);
            if (earnedPts > 0) supabase.from("reward_points_log").insert({ user_id: profile.id, points: earnedPts, transaction_type: "earn", description: `Earned on ${itemName}` });
            if (redeemedPoints > 0) supabase.from("reward_points_log").insert({ user_id: profile.id, points: -redeemedPoints, transaction_type: "redeem", description: `Redeemed on ${itemName}` });
            setPointsBalance(newBal);
          } catch (_) {}
        }
      }

      localStorage.removeItem(BILL_PENDING_PREFIX + ref);
      setSaving(false);
      setFulfillResult({ ok: true, label: itemName, detail: note, pinsArr: pinsArr || [], psRef: ref, apiRef, cardDetails, cat, amount: totalAmount || amount, earnedPts, txnHistoryPending, elecToken, elecOrderId });

      // Send success confirmation emails (best-effort)
      const svcLabel = CATS.find(c => c.id === cat)?.label || cat;
      try {
        await supabase.functions.invoke("clubkonnect", {
          body: { action: "bill-success-email", user_email: profile?.email || null, user_name: profile?.owner_name || profile?.business_name || null, service: svcLabel, amount: totalAmount || amount, reference: ref, detail: note },
        });
      } catch (_) {}
      if (staffEmail && staffEmail !== profile?.email) {
        try {
          supabase.functions.invoke("clubkonnect", { body: { action: "bill-staff-email", staff_email: staffEmail, staff_name: staffName, business_name: businessName || profile?.business_name, service: svcLabel, amount: totalAmount || amount, reference: ref, detail: note, outcome: "success" } });
        } catch (_) {}
      }
    } catch (err) {
      setSaving(false);
      const ckError = err.message || "Unknown error";
      setFulfillResult({ ok: false, label: "", detail: ckError, psRef: ref, apiRef: "" });

      // Record the failed bill in history
      try {
        const { cat: fCat, form: f, paidAmount: fPaid } = pending;
        const catLabel = CATS.find(c => c.id === fCat)?.label || fCat;
        const failAmount = fCat === "print-airtime"
          ? parseInt(f.value || "0", 10) * parseInt(f.quantity || "1", 10)
          : fCat === "print-data"
            ? parseFloat(f.amount || "0") * parseInt(f.quantity || "1", 10)
          : fCat === "airtime-bundle"
            ? fPaid || (parseInt(f.sets || "1", 10) * BUNDLE_FACE_PER_SET)
            : fPaid || parseFloat(f.amount || "0");
        await addTransaction({
          type: "out", category: fCat, payment_type: "bill_payment",
          item_name: catLabel,
          customer_name: f.phone || f.meterNo || f.smartcard || f.customerId || f.accountNo || "",
          amount: failAmount || 0,
          note: `FAILED: ${ckError} | PS: ${ref}`,
          transaction_date: today(),
          bill_status: "failed",
        });
      } catch (_) { /* best-effort */ }

      // Alert admin/finance of the failed delivery
      try {
        const { cat: fCat2, form: f2 } = pending;
        const fSvc = CATS.find(c => c.id === fCat2)?.label || fCat2;
        const fAmt = parseFloat(f2.amount) || 0;
        await supabase.functions.invoke("clubkonnect", {
          body: { action: "bill-failure-alert", user_id: profile?.id || null, user_email: profile?.email || null, user_name: profile?.owner_name || profile?.business_name || null, service: fSvc, amount: fAmt, ps_ref: ref, ck_error: ckError },
        });
        if (staffEmail && staffEmail !== profile?.email) {
          supabase.functions.invoke("clubkonnect", { body: { action: "bill-staff-email", staff_email: staffEmail, staff_name: staffName, business_name: businessName || profile?.business_name, service: fSvc, amount: fAmt, reference: ref, outcome: "failed" } });
        }
      } catch (_) {}
    }
  }, [addTransaction, staffName, staffEmail, businessName, profile, pointsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const cat = CATS.find(c => c.id === selectedCat);
  const detected = form.phone?.length >= 4 ? detectNetwork(form.phone) : null;

  // Pre-compute UI charge amount so points savings displays correctly before submission
  const uiChargeAmt = (() => {
    const a = parseFloat(form.amount) || 0;
    if (selectedCat === "print-airtime")  return parseInt(form.value || "0", 10) * parseInt(form.quantity || "1", 10);
    if (selectedCat === "print-data")     return a * parseInt(form.quantity || "1", 10);
    if (selectedCat === "airtime-bundle") return parseInt(form.sets || "0", 10) * bundleChargePerSet;
    if (selectedCat === "airtime" && airtimeDiscount > 0) return Math.floor(a * (1 - airtimeDiscount));
    return a;
  })();
  const ptsSavings = pointsEnabled && usePoints && pointsBalance >= 50
    ? Math.min(pointsBalance, Math.floor(uiChargeAmt * 0.5)) : 0;
  const cbSavings = useCashback && cashbackBalance > 0
    ? Math.min(cashbackBalance, Math.max(0, uiChargeAmt - ptsSavings - 1)) : 0;

  return (
    <div className="pb-32 screen-enter">

      {/* ── Paystack return overlay (processing → result) ─────────────────── */}
      {((saving && !selectedCat) || fulfillResult) && (
        <BillResultOverlay
          saving={saving}
          fulfillResult={fulfillResult}
          profile={profile}
          businessName={businessName}
          staffName={staffName}
          onDone={() => setFulfillResult(null)}
          onShareReceipt={() => {
            setReceipt({
              created_at:    new Date().toISOString(),
              businessName:  profile?.business_name || profile?.owner_name || "My Business",
              amount:        fulfillResult?.amount || 0,
              category:      fulfillResult?.cat,
              service:       CATS.find(c => c.id === fulfillResult?.cat)?.label || "Bill Payment",
              item_name:     fulfillResult?.label || "",
              customer_name: (() => { const m = (fulfillResult?.detail || "").match(/(?:Phone|Meter|Smartcard|Account|Beneficiary):\s*([^\s|]+)/i); return m?.[1] || ""; })(),
              note:          fulfillResult?.detail || "",
              apiRef:        fulfillResult?.apiRef || "",
              staffName:     staffName || undefined,
              id:            Date.now(),
            });
            setFulfillResult(null);
          }}
        />
      )}

      {/* Header */}
      <div className="px-4 pt-5 pb-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Bill Payments</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">VTU &amp; Bill Payment Services</p>
          </div>
          <button onClick={() => setShowKeyStatus(true)}
            className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold px-3 py-1.5 rounded-full">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            API Status
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* Summary strip */}
        <div className="bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl px-5 py-4 text-white flex items-center justify-between shadow-md">
          <div>
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Total Spent</p>
            <p className="text-2xl font-black mt-0.5">{fmt(bills.filter(b => b.bill_status !== "failed").reduce((s, b) => s + b.amount, 0))}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Transactions</p>
            <p className="text-2xl font-black mt-0.5">{bills.filter(b => b.bill_status !== "failed").length}</p>
          </div>
        </div>

        {bills.length > 0 && <Overview bills={bills} />}

        {/* Cashback balance widget */}
        {userEmailCB && (
          <div className="flex items-center justify-between bg-gradient-to-r from-green-600 to-emerald-600 rounded-2xl px-5 py-4 text-white shadow-md">
            <div>
              <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Cashback Balance</p>
              <p className="text-2xl font-black mt-0.5">₦{cashbackBalance.toLocaleString()}</p>
              <p className="text-[10px] text-green-200 mt-1">Earn 1% on every bill purchase</p>
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">🎁</div>
          </div>
        )}

        {/* Reward points widget */}
        {pointsEnabled && (
          <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">⭐</span>
              <div>
                <p className="text-sm font-black text-amber-800 dark:text-amber-200">Reward Points</p>
                <p className="text-[10px] text-amber-600 dark:text-amber-400">Earn on data & airtime · 1 pt = ₦1</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xl font-black text-amber-700 dark:text-amber-300">{pointsBalance.toLocaleString()}</p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400">pts · ≈ ₦{pointsBalance.toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Service grid */}
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Select Service</h2>
          <div className="grid grid-cols-3 gap-3">
            {visibleCats.map(c => {
              const locked = c.enterprise && !isEnterprise;
              const count  = bills.filter(b => b.category === c.id).length;
              return (
                <button key={c.id} onClick={() => openSheet(c.id)} disabled={locked}
                  className={`rounded-2xl p-4 flex flex-col items-center gap-2 shadow-sm active:scale-95 transition-all duration-150 text-white relative ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
                  style={{ background: `linear-gradient(135deg,${c.g1},${c.g2})` }}>
                  {locked && (
                    <span className="absolute top-1.5 right-1.5 bg-white/30 rounded-full px-1.5 py-0.5 text-[8px] font-black tracking-wide">PRO</span>
                  )}
                  <Ico d={CAT_ICONS[c.id]} size={26} c="rgba(255,255,255,0.95)" />
                  <p className="text-[11px] font-bold text-center leading-tight">{c.label}</p>
                  {count > 0 && <p className="text-[9px] font-semibold bg-white/25 px-1.5 py-0.5 rounded-full">{count}</p>}
                </button>
              );
            })}
          </div>
          {!isEnterprise && visibleCats.some(c => c.enterprise) && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-2">
              Print Airtime & Print Data require the Enterprise plan
            </p>
          )}
        </div>

        {/* History */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">
              History {bills.length > 0 && <span className="text-slate-400 font-normal">({filteredBills.length}{filteredBills.length !== bills.length ? `/${bills.length}` : ""})</span>}
            </h2>
            {bills.length > 0 && (
              <button onClick={() => setShowStatement(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1B2A5E] text-white text-[11px] font-bold active:scale-95 transition-transform">
                <Ico d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M12 18v-6|M9 15h6" size={12} c="white" />
                Statement
              </button>
            )}
          </div>

          {bills.length > 0 && (
            <>
              <div className="flex gap-2 mb-2.5 overflow-x-auto no-scrollbar">
                {[["all","All"],["ok","Successful"],["failed","Failed"]].map(([v,l]) => (
                  <button key={v} onClick={() => setHistStatus(v)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                      histStatus === v
                        ? v === "failed" ? "bg-red-500 text-white" : "bg-slate-800 dark:bg-white text-white dark:text-slate-900"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                    }`}>
                    {l}
                  </button>
                ))}
              </div>
              {usedBillCats.length > 1 && (
                <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
                  {[{ id: "all", label: "All Services" }, ...usedBillCats].map(c => (
                    <button key={c.id} onClick={() => setHistCat(c.id)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                        histCat === c.id
                          ? "bg-[#1B2A5E] text-white"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                      }`}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {bills.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <Ico d={CAT_ICONS.airtime} size={22} c="#94a3b8" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No bills paid yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Tap a service above to get started</p>
            </div>
          ) : filteredBills.length === 0 ? (
            <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No matching transactions</p>
              <button onClick={() => { setHistCat("all"); setHistStatus("all"); }}
                className="text-xs font-bold text-brand-600 dark:text-brand-400 mt-1.5">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredBills.map(b => (
                <BillRow key={b.id || b.item_name + b.created_at} bill={b}
                  onOpen={() => setReceipt(billToReceipt(b, profile, staffName))} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom sheet */}
      {selectedCat && cat && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[94vh] flex flex-col">

            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
                  <Ico d={CAT_ICONS[selectedCat]} size={17} c="white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800 dark:text-white">{cat.label}</h2>
                  <p className="text-[10px] text-green-600 font-semibold">Service Active</p>
                </div>
              </div>
              <button onClick={closeSheet} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Ico d="M18 6L6 18|M6 6l12 12" size={14} c="#64748b" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* ── AIRTIME ── */}
              {selectedCat === "airtime" && <>
                <NetworkSelector value={form.network} onChange={handleNetworkChange} detected={detected && detected === form.network ? detected : null} />
                <PhoneInput value={form.phone} onChange={e => { const v = e.target.value; const net = detectNetwork(v); setForm(f => ({ ...f, phone: v, ...(net ? { network: net } : {}) })); }} />
                {airtimeDiscount > 0 && (
                  <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2">
                    <span className="text-base">🏷️</span>
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold">{(airtimeDiscount * 100).toFixed(0)}% business discount on airtime!</p>
                  </div>
                )}
                <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-3 py-2">
                  <span className="text-base">🎁</span>
                  <p className="text-xs text-green-700 dark:text-green-300 font-semibold">Earn 1% cashback on airtime purchases!</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Amount (₦) *</label>
                  <input type="number" value={form.amount} onChange={e => setF("amount", e.target.value)} placeholder="100"
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {[50,100,200,500,1000].map(a => (
                      <button key={a} type="button" onClick={() => setF("amount", String(a))}
                        className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${form.amount === String(a) ? "bg-green-600 text-white border-green-600" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                        ₦{a}
                      </button>
                    ))}
                  </div>
                </div>
              </>}

              {/* ── DATA ── */}
              {selectedCat === "data" && <>
                <NetworkSelector value={form.network} onChange={handleNetworkChange} detected={detected && detected === form.network ? detected : null} />
                <PhoneInput value={form.phone} onChange={e => { const v = e.target.value; const net = detectNetwork(v); setForm(f => ({ ...f, phone: v, ...(net ? { network: net } : {}) })); }} />
                <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-3 py-2">
                  <span className="text-base">🎁</span>
                  <p className="text-xs text-green-700 dark:text-green-300 font-semibold">Earn 1% cashback on every purchase!</p>
                </div>
                <DataPlanGrid plans={plans} selectedId={form.planId} loading={plansLoading} error={plansError}
                  cashback={cashback} pointsEnabled={pointsEnabled}
                  onRetry={() => loadPlans("data-plans", { network: form.network })}
                  onSelect={pl => setForm(f => ({ ...f, planId: pl.plan_id, planName: pl.plan_name, amount: String(pl.plan_amount) }))} />
              </>}

              {/* ── CABLE TV ── */}
              {selectedCat === "cable" && <>
                <SelectInput label="Provider *" value={form.provider} onChange={handleProviderChange} options={CABLE_PROVIDERS} placeholder="Select provider…" />
                {form.provider && <>
                  <TextInput label="Smartcard / IUC Number *" value={form.smartcard} onChange={v => { setF("smartcard", v); resetVerify(); }} placeholder="Enter smartcard number" />
                  <PhoneInput label="Phone Number *" value={form.phone} onChange={e => setF("phone", e.target.value)} placeholder="08012345678" />
                  <button type="button" onClick={verifySmartcard} disabled={verifyStatus === "loading"}
                    className="w-full border-2 border-purple-500 text-purple-600 dark:text-purple-400 font-bold rounded-xl py-2.5 text-sm disabled:opacity-50">
                    {verifyStatus === "loading" ? "Verifying…" : "Verify Smartcard"}
                  </button>
                  <VerifyBadge status={verifyStatus === "idle" ? null : verifyStatus} name={verifyName} />
                  {verifyStatus === "ok" && <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Subscription Package *</label>
                      <PlanGrid
                        plans={pkgs.map(p => ({ plan_id: p.package_id, plan_name: p.package_name, plan_amount: p.package_amount }))}
                        selectedId={form.packageId} loading={pkgsLoading} error={pkgsError}
                        onRetry={() => loadPkgs("cable-packages", { provider: form.provider })}
                        onSelect={p => setForm(f => ({ ...f, packageId: p.plan_id, packageName: p.plan_name, amount: String(p.plan_amount) }))} />
                    </div>
                  </>}
                </>}
              </>}

              {/* ── ELECTRICITY ── */}
              {selectedCat === "electricity" && <>
                <SelectInput label="Electricity Company *" value={form.company} onChange={v => { setF("company", v); resetVerify(); }} options={ELECTRICITY_COMPANIES} placeholder="Select company…" />
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Meter Type *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ code: "01", name: "Prepaid" }, { code: "02", name: "Postpaid" }].map(mt => (
                      <button key={mt.code} type="button" onClick={() => { setF("meterType", mt.code); resetVerify(); }}
                        className={`py-2.5 rounded-xl border-2 text-sm font-bold transition-colors ${form.meterType === mt.code ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                        {mt.name}
                      </button>
                    ))}
                  </div>
                </div>
                <TextInput label="Meter Number *" value={form.meterNo} onChange={v => { setF("meterNo", v); resetVerify(); }} placeholder="Enter meter number" />
                <PhoneInput label="Phone Number *" value={form.phone} onChange={e => setF("phone", e.target.value)} placeholder="08012345678" />
                <button type="button" onClick={verifyMeter} disabled={verifyStatus === "loading"}
                  className="w-full border-2 border-amber-500 text-amber-600 dark:text-amber-400 font-bold rounded-xl py-2.5 text-sm disabled:opacity-50">
                  {verifyStatus === "loading" ? "Verifying…" : "Verify Meter Number"}
                </button>
                <VerifyBadge status={verifyStatus === "idle" ? null : verifyStatus} name={verifyName} />
                {verifyStatus === "ok" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Amount (₦) * <span className="text-slate-400 font-normal">min ₦1,000</span></label>
                    <input type="number" value={form.amount} onChange={e => setF("amount", e.target.value)} placeholder="1000"
                      className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {[1000,2000,5000,10000,20000].map(a => (
                        <button key={a} type="button" onClick={() => setF("amount", String(a))}
                          className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${form.amount === String(a) ? "bg-amber-500 text-white border-amber-500" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                          ₦{a.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>}

              {/* ── BETTING ── */}
              {selectedCat === "betting" && <>
                <SelectInput label="Betting Platform *" value={form.company} onChange={v => { setF("company", v); resetVerify(); setF("customerId", ""); }} options={BETTING_COMPANIES} placeholder="Select platform…" />
                <TextInput label="Customer ID *" value={form.customerId} onChange={v => { setF("customerId", v); resetVerify(); }} placeholder="Enter your betting ID" />
                <button type="button" onClick={verifyBetting} disabled={verifyStatus === "loading"}
                  className="w-full border-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold rounded-xl py-2.5 text-sm disabled:opacity-50">
                  {verifyStatus === "loading" ? "Verifying…" : "Verify Account"}
                </button>
                <VerifyBadge status={verifyStatus === "idle" ? null : verifyStatus} name={verifyName} />
                {verifyStatus === "ok" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Amount (₦) *</label>
                    <input type="number" value={form.amount} onChange={e => setF("amount", e.target.value)} placeholder="500"
                      className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {[500,1000,2000,5000,10000].map(a => (
                        <button key={a} type="button" onClick={() => setF("amount", String(a))}
                          className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${form.amount === String(a) ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                          ₦{a.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>}

              {/* ── WAEC ── */}
              {selectedCat === "waec" && <>
                <SelectInput label="Exam Type *" value={form.examType} onChange={v => setF("examType", v)} options={WAEC_TYPES} placeholder="Select exam type…" />
                <PhoneInput label="Phone Number *" value={form.phone} onChange={e => setF("phone", e.target.value)} placeholder="08012345678" />
                {form.examType && (
                  <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-xl px-4 py-3">
                    <p className="text-xs text-cyan-700 dark:text-cyan-300 font-medium">The ePin/scratch card details will be shown after payment.</p>
                  </div>
                )}
              </>}

              {/* ── JAMB ── */}
              {selectedCat === "jamb" && <>
                <SelectInput label="Exam Type *" value={form.examType} onChange={v => { setF("examType", v); resetVerify(); }} options={JAMB_TYPES} placeholder="Select exam type…" />
                <PhoneInput label="Phone Number *" value={form.phone} onChange={e => setF("phone", e.target.value)} placeholder="08012345678" />
                <TextInput label="JAMB Profile ID (optional — verify to confirm name)" value={form.profileId} onChange={v => { setF("profileId", v); resetVerify(); }} placeholder="Enter profile ID" />
                {form.profileId && (
                  <button type="button" onClick={verifyJamb} disabled={verifyStatus === "loading"}
                    className="w-full border-2 border-orange-500 text-orange-600 dark:text-orange-400 font-bold rounded-xl py-2.5 text-sm disabled:opacity-50">
                    {verifyStatus === "loading" ? "Verifying…" : "Verify Profile ID"}
                  </button>
                )}
                <VerifyBadge status={verifyStatus === "idle" ? null : verifyStatus} name={verifyName} />
              </>}

              {/* ── SPECTRANET ── */}
              {selectedCat === "spectranet" && <>
                <TextInput label="Account Number *" value={form.accountNo} onChange={v => setF("accountNo", v)} placeholder="Enter Spectranet account number" />
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Data Plan *</label>
                  <PlanGrid plans={plans} selectedId={form.planId} loading={plansLoading} error={plansError}
                    onRetry={() => loadPlans("spectranet-plans", {})}
                    onSelect={pl => setForm(f => ({ ...f, planId: pl.plan_id, planName: pl.plan_name, amount: String(pl.plan_amount) }))} />
                </div>
              </>}

              {/* ── SMILE ── */}
              {selectedCat === "smile" && <>
                <TextInput label="Smile Account Number *" value={form.accountNo} onChange={v => { setF("accountNo", v); resetVerify(); }} placeholder="Enter Smile account number" />
                <button type="button" onClick={verifySmile} disabled={verifyStatus === "loading"}
                  className="w-full border-2 border-pink-500 text-pink-600 dark:text-pink-400 font-bold rounded-xl py-2.5 text-sm disabled:opacity-50">
                  {verifyStatus === "loading" ? "Verifying…" : "Verify Account"}
                </button>
                <VerifyBadge status={verifyStatus === "idle" ? null : verifyStatus} name={verifyName} />
                {verifyStatus === "ok" && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Data Plan *</label>
                    <PlanGrid plans={plans} selectedId={form.planId} loading={plansLoading} error={plansError}
                      onRetry={() => loadPlans("smile-plans", {})}
                      onSelect={pl => setForm(f => ({ ...f, planId: pl.plan_id, planName: pl.plan_name, amount: String(pl.plan_amount) }))} />
                  </div>
                )}
              </>}

              {/* ── PRINT AIRTIME ── */}
              {selectedCat === "print-airtime" && <>
                <NetworkSelector value={form.network} onChange={v => setF("network", v)} detected={null} />
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Denomination *</label>
                  <div className="flex gap-2">
                    {PRINT_VALUES.map(v => (
                      <button key={v} type="button" onClick={() => setF("value", v)}
                        className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition-colors ${form.value === v ? "border-slate-600 bg-slate-600 text-white" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                        ₦{v}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Quantity (1–100) *</label>
                  <input type="number" value={form.quantity} onChange={e => setF("quantity", e.target.value)} min="1" max="100" placeholder="1"
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-500" />
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Total cost: <strong className="text-slate-800 dark:text-white">₦{(parseInt(form.value || 0) * parseInt(form.quantity || 0)).toLocaleString()}</strong>
                    {" "}({form.quantity} × ₦{form.value})
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">PINs will be shown after purchase</p>
                </div>
              </>}

              {/* ── PRINT DATA ── */}
              {selectedCat === "print-data" && <>
                <NetworkSelector value={form.network} onChange={handleNetworkChange} detected={null} />
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Data Plan *</label>
                  <PlanGrid plans={plans} selectedId={form.planId} loading={plansLoading} error={plansError}
                    onRetry={() => loadPlans("data-plans", { network: form.network })}
                    onSelect={pl => setForm(f => ({ ...f, planId: pl.plan_id, planName: pl.plan_name, amount: String(pl.plan_amount) }))} />
                </div>
                {form.planId && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Quantity (1–100) *</label>
                    <input type="number" value={form.quantity} onChange={e => setF("quantity", e.target.value)} min="1" max="100" placeholder="1"
                      className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-500" />
                    <p className="text-[10px] text-slate-400 mt-1">PINs will be shown after purchase</p>
                  </div>
                )}
              </>}

              {/* ── AIRTIME BUNDLE ── */}
              {selectedCat === "airtime-bundle" && <>
                {/* Network breakdown card */}
                <div className="rounded-2xl overflow-hidden border border-violet-200 dark:border-violet-800">
                  <div className="px-4 py-3" style={{ background: "linear-gradient(135deg,#7c3aed,#5b21b6)" }}>
                    <p className="text-xs font-black text-white">All-Network Bundle Set</p>
                    <p className="text-[10px] text-violet-200 mt-0.5">₦1,000 per network · MTN, Airtel, 9mobile & Glo</p>
                  </div>
                  <div className="grid grid-cols-4 gap-0 bg-white dark:bg-slate-800 divide-x divide-slate-100 dark:divide-slate-700">
                    {BUNDLE_NETWORKS.map(n => {
                      const cfg = NET_CONFIG[n];
                      return (
                        <div key={n} className="flex flex-col items-center py-3 px-1 gap-1.5">
                          <div className="w-full h-7 rounded-lg flex items-center justify-center" style={{ background: cfg.bg }}>
                            <span className="text-[9px] font-black" style={{ color: cfg.fg }}>{cfg.abbr}</span>
                          </div>
                          <p className="text-[9px] text-slate-400 leading-none">face ₦1,000</p>
                          <p className="text-[9px] font-bold text-green-600 leading-none">cost ₦{BUNDLE_CK_COSTS[n]}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-4 py-2 bg-violet-50 dark:bg-violet-900/20 border-t border-violet-100 dark:border-violet-800 flex items-center justify-between">
                    <span className="text-[10px] text-violet-600 dark:text-violet-400 font-semibold">Profit per set</span>
                    <span className="text-[10px] font-black text-violet-700 dark:text-violet-300">₦{BUNDLE_PROFIT_PER_SET} gross</span>
                  </div>
                </div>

                {/* Set selector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Number of Sets *</label>
                  <div className="flex gap-2">
                    {BUNDLE_SET_OPTIONS.map(s => (
                      <button key={s} type="button" onClick={() => setF("sets", String(s))}
                        className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition-colors ${form.sets === String(s) ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price breakdown */}
                {parseInt(form.sets || "0", 10) > 0 && (() => {
                  const s = parseInt(form.sets, 10);
                  const faceTotal   = s * BUNDLE_FACE_PER_SET;
                  const discount    = s * bundleSubscriberSavings;
                  const youPay      = s * bundleChargePerSet;
                  const appEarns    = Math.round(s * BUNDLE_PROFIT_PER_SET * bundleAppPct);
                  return (
                    <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                      {[
                        ["Face value",    `₦${faceTotal.toLocaleString()}`, "text-slate-700 dark:text-slate-200"],
                        ["Your discount", `-₦${discount.toLocaleString()}`, "text-green-600 dark:text-green-400"],
                      ].map(([label, val, cls]) => (
                        <div key={label} className="flex justify-between items-center px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                          <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
                          <span className={`text-xs font-bold ${cls}`}>{val}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center px-4 py-3 bg-violet-50 dark:bg-violet-900/20">
                        <span className="text-sm font-black text-slate-700 dark:text-white">You pay</span>
                        <span className="text-lg font-black text-violet-700 dark:text-violet-300">₦{youPay.toLocaleString()}</span>
                      </div>
                      <div className="px-4 py-2 bg-slate-50 dark:bg-slate-700/50 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">Platform earns</span>
                        <span className="text-[10px] font-bold text-slate-500">₦{appEarns.toLocaleString()} (after Paystack on you)</span>
                      </div>
                      <p className="text-[10px] text-slate-400 px-4 py-2 text-center">
                        {s * 4} PINs across all 4 networks · shown after purchase
                      </p>
                    </div>
                  );
                })()}
              </>}

              {/* Cashback balance toggle */}
              {cashbackBalance > 0 && userEmailCB && uiChargeAmt > 0 && (
                <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-xs font-black text-green-800 dark:text-green-200">Apply Cashback</p>
                    <p className="text-[10px] text-green-600 dark:text-green-400">
                      Balance: ₦{cashbackBalance.toLocaleString()} · saves ₦{Math.min(cashbackBalance, Math.max(0, uiChargeAmt - 1)).toLocaleString()}
                    </p>
                  </div>
                  <button type="button" onClick={() => setUseCashback(v => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${useCashback ? "bg-green-500" : "bg-slate-300 dark:bg-slate-600"}`}>
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${useCashback ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              )}

              {/* Redeem points toggle */}
              {pointsEnabled && pointsBalance >= 50 && uiChargeAmt > 0 && (
                <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-xs font-black text-amber-800 dark:text-amber-200">Use Reward Points</p>
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                      {pointsBalance} pts · saves ₦{Math.min(pointsBalance, Math.floor(uiChargeAmt * 0.5)).toLocaleString()}
                    </p>
                  </div>
                  <button type="button" onClick={() => setUsePoints(v => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${usePoints ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"}`}>
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${usePoints ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              )}

              {staffName && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <Ico d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8" size={14} c="#3b82f6" />
                  <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">Processed by <strong>{staffName}</strong></p>
                </div>
              )}

              {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">{error}</p>}

              <div className="pb-6">
                <button onClick={handlePay} disabled={saving}
                  className="w-full text-white font-bold rounded-xl py-3.5 text-sm transition-all disabled:opacity-60"
                  style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
                  {saving ? "Redirecting to Paystack…" : (
                    selectedCat === "print-airtime"   ? `Pay with Paystack · ${form.quantity || 1} × ₦${form.value}` :
                    selectedCat === "print-data"      ? `Pay with Paystack · ${form.quantity || 1} Plan${parseInt(form.quantity||"1")>1?"s":""}` :
                    selectedCat === "airtime-bundle"  ? (parseInt(form.sets||"0")>0 ? `Pay ₦${uiChargeAmt.toLocaleString()} · ${form.sets} Bundle Set${parseInt(form.sets)>1?"s":""}` : "Select number of sets") :
                    form.amount ? `Pay ${fmt(uiChargeAmt - ptsSavings - cbSavings)} with Paystack${ptsSavings > 0 || cbSavings > 0 ? ` · savings applied` : ""}` : `Pay with Paystack`
                  )}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {pins && <PinModal pins={pins.list} title={pins.title} onClose={() => setPins(null)} />}
      {receipt && (
        <BillReceipt
          bill={receipt}
          onClose={() => setReceipt(null)}
          onRetrieveToken={
            receipt.category === "electricity" && !receipt.token && receipt.apiRef
              ? async (orderId) => {
                  const q = await clubkonnect("electricity-query", { orderId });
                  if (q.status === "SUCCESS" && q.token) return q.token;
                  throw new Error(q.status === "CANCELLED"
                    ? "Order was cancelled by provider. Contact support with your reference."
                    : "Token not ready yet. Please wait a few minutes and try again.");
                }
              : undefined
          }
        />
      )}
      {showStatement && <BillStatementModal bills={bills} profile={profile} onClose={() => setShowStatement(false)} />}
      {showKeyStatus && <KeyStatusPanel onClose={() => setShowKeyStatus(false)} />}
    </div>
  );
}
