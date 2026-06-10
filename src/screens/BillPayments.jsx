import { useState, useMemo, useCallback, useEffect } from "react";
import { fmt, today } from "../utils/helpers";
import { peyflex } from "../utils/peyflex";
import { BillReceipt } from "../components/shared/Receipt";

/* ── Static data ─────────────────────────────────────────────────── */

const CATS = [
  { id: "airtime",     label: "Airtime",     g1: "#ef4444", g2: "#dc2626", live: true  },
  { id: "data",        label: "Data",        g1: "#3b82f6", g2: "#1d4ed8", live: true  },
  { id: "electricity", label: "Electricity", g1: "#f59e0b", g2: "#d97706", live: true  },
  { id: "cable_tv",    label: "Cable TV",    g1: "#8b5cf6", g2: "#6d28d9", live: true  },
  { id: "betting",     label: "Betting",     g1: "#16a34a", g2: "#15803d", live: true  },
  { id: "internet",    label: "Internet",    g1: "#06b6d4", g2: "#0e7490", live: false },
  { id: "water",       label: "Water",       g1: "#0ea5e9", g2: "#0369a1", live: false },
  { id: "insurance",   label: "Insurance",   g1: "#64748b", g2: "#334155", live: false },
  { id: "education",   label: "Education",   g1: "#10b981", g2: "#047857", live: false },
];

const NETWORKS = ["MTN", "Airtel", "Glo", "9mobile"];

const NET_CONFIG = {
  MTN:       { bg: "#FFC300", fg: "#000", abbr: "MTN"     },
  Airtel:    { bg: "#EF3340", fg: "#fff", abbr: "Airtel"  },
  Glo:       { bg: "#007838", fg: "#fff", abbr: "Glo"     },
  "9mobile": { bg: "#006B54", fg: "#fff", abbr: "9mobile" },
};

const CABLE_PROVIDERS = ["DSTV", "GOtv", "StarTimes"];

const CABLE_CONFIG = {
  DSTV:      { bg: "#0066B2", fg: "#fff", abbr: "DStv" },
  GOtv:      { bg: "#E87722", fg: "#fff", abbr: "GOtv" },
  StarTimes: { bg: "#E50914", fg: "#fff", abbr: "Star" },
};

const BETTING_PROVIDERS = [
  { id: "bet9ja",    label: "Bet9ja",    bg: "#1a8b2d", fg: "#fff" },
  { id: "sportybet", label: "SportyBet", bg: "#0d47a1", fg: "#fff" },
  { id: "nairabet",  label: "NairaBet",  bg: "#e55c00", fg: "#fff" },
  { id: "betking",   label: "BetKing",   bg: "#8B0000", fg: "#fff" },
  { id: "merrybet",  label: "MerryBet",  bg: "#1c5a8a", fg: "#fff" },
  { id: "paripesa",  label: "Paripesa",  bg: "#214d2e", fg: "#fff" },
];

const ELEC_DISCOS = [
  { code: "aba-electric",   name: "Aba"           },
  { code: "phed",           name: "Port Harcourt" },
  { code: "kano-electric",  name: "Kano"          },
  { code: "kaedco",         name: "Kaduna"        },
  { code: "jos-electric",   name: "Jos"           },
  { code: "ikeja-electric", name: "Ikeja"         },
  { code: "ibedc",          name: "Ibadan"        },
  { code: "eedc",           name: "Enugu"         },
  { code: "eko-electric",   name: "Eko (Lagos)"   },
  { code: "bedc",           name: "Benin"         },
  { code: "yedc",           name: "Yola"          },
  { code: "aedc",           name: "Abuja"         },
];

const INTERNET_PROVIDERS  = ["Spectranet","Smile","ipNX","Swift","Glo Fiber","MTN Home"];
const WATER_PROVIDERS     = ["Lagos Water Corp.","Abuja Water Board","Kano Water Board","Ibadan Water Corp.","Port Harcourt Water Board","Enugu Water","Other"];
const INSURANCE_PROVIDERS = ["AIICO Insurance","Leadway Assurance","Sovereign Trust","AXA Mansard","NEM Insurance","Custodian","Other"];
const INSURANCE_TYPES     = ["Motor/Vehicle","Health","Life","Home/Property","Travel","Business"];
const EDU_FEES            = ["School Fees","WAEC","JAMB","NECO","NYSC","Post-UTME","Transcript","Hostel Fees","Other"];

/* ── Icons ───────────────────────────────────────────────────────── */

function Ico({ d, size = 22, c = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const CAT_ICONS = {
  airtime:     "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.122.966.356 1.916.7 2.81a2 2 0 01-.45 2.11L6.95 7.91a16 16 0 006.29 6.29l1.27-.56a2 2 0 012.11-.45c.894.344 1.844.578 2.81.7A2 2 0 0122 16.92z",
  data:        "M1.05 5l4.95-3 4.95 3 4.95-3L21 5|M1.05 11l4.95-3 4.95 3 4.95-3L21 11|M1.05 17l4.95-3 4.95 3 4.95-3L21 17",
  electricity: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  cable_tv:    "M21 3H3a2 2 0 00-2 2v12a2 2 0 002 2h18a2 2 0 002-2V5a2 2 0 00-2-2z|M10 20H14|M12 17v3",
  betting:     "M20 7l-9-4L2 7l9 4 9-4z|M20 17l-9 4-9-4|M20 12l-9 4-9-4",
  internet:    "M12 2a10 10 0 100 20 10 10 0 000-20z|M2 12h20|M12 2a15.3 15.3 0 010 20|M12 2a15.3 15.3 0 000 20",
  water:       "M12 2.69l5.66 5.66a8 8 0 11-11.31 0z",
  insurance:   "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z|M9 12l2 2 4-4",
  education:   "M22 10v6M2 10l10-5 10 5-10 5-10-5z|M6 12v5c3 3 9 3 12 0v-5",
};

/* ── Network detection ───────────────────────────────────────────── */

function detectNetwork(phone) {
  const clean = phone.replace(/\D/g, "");
  let prefix;
  if (clean.startsWith("234") && clean.length >= 6) {
    prefix = "0" + clean.slice(3, 6);
  } else if (clean.length >= 4) {
    prefix = clean.slice(0, 4);
  } else {
    return null;
  }
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

/* ── Helpers ─────────────────────────────────────────────────────── */

const rcpId = () => "RCP-" + Math.random().toString(36).slice(2, 8).toUpperCase();

function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })
    + " · " + d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

function catMeta(id) { return CATS.find(c => c.id === id) || CATS[0]; }

function initForm(catId) {
  switch (catId) {
    case "airtime":     return { network: "MTN", phone: "", amount: "" };
    case "data":        return { network: "MTN", phone: "", planId: "", planName: "", amount: "" };
    case "electricity": return { disco: "ikeja-electric", discoName: "Ikeja", meterType: "prepaid", meter: "", phone: "", amount: "" };
    case "cable_tv":    return { provider: "DSTV", smartcard: "", planId: "", planName: "", amount: "", phone: "" };
    case "betting":     return { provider: "bet9ja", account: "", amount: "" };
    case "internet":    return { provider: "Spectranet", account: "", plan: "", amount: "" };
    case "water":       return { provider: "Lagos Water Corp.", account: "", phone: "", amount: "" };
    case "insurance":   return { provider: "AIICO Insurance", type: "Motor/Vehicle", policyNo: "", phone: "", amount: "" };
    case "education":   return { institution: "", student: "", regNo: "", feeType: "School Fees", amount: "" };
    default: return {};
  }
}

function buildNames(catId, form) {
  switch (catId) {
    case "airtime":     return { item_name: `${form.network} Airtime`,                             customer_name: form.phone,     note: `Network: ${form.network}` };
    case "data":        return { item_name: `${form.network} ${form.planName || ""} Data`,         customer_name: form.phone,     note: `Network: ${form.network} | Plan: ${form.planName}` };
    case "electricity": return { item_name: `Electricity – ${form.discoName || form.disco}`,      customer_name: form.meter,     note: `Meter: ${form.meter} | ${form.meterType}` };
    case "cable_tv":    return { item_name: `${form.provider} – ${form.planName || form.planId}`, customer_name: form.smartcard, note: `Provider: ${form.provider}` };
    case "betting": {
      const bp = BETTING_PROVIDERS.find(p => p.id === form.provider);
      const label = bp?.label || form.provider;
      return { item_name: `${label} Wallet Funding`, customer_name: form.account, note: `Platform: ${label} | ID: ${form.account}` };
    }
    case "internet":    return { item_name: `${form.provider} Internet${form.plan ? ` – ${form.plan}` : ""}`, customer_name: form.account,  note: `Provider: ${form.provider}` };
    case "water":       return { item_name: `Water Bill – ${form.provider}`,                      customer_name: form.account,   note: `Account: ${form.account}` };
    case "insurance":   return { item_name: `${form.provider} – ${form.type}`,                    customer_name: form.phone,     note: `Type: ${form.type}${form.policyNo ? ` | Policy: ${form.policyNo}` : ""}` };
    case "education":   return { item_name: form.feeType,                                         customer_name: form.student,   note: `Institution: ${form.institution} | Reg: ${form.regNo}` };
    default:            return { item_name: "Bill Payment", customer_name: "", note: "" };
  }
}

/* ── Shared form inputs ──────────────────────────────────────────── */

function FInput({ label, value, onChange, type = "text", placeholder = "", req = false }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}{req ? " *" : ""}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
    </div>
  );
}

function FSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}</label>
      <select value={value} onChange={onChange}
        className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
        {options.map(o => typeof o === "string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value || o.p} value={o.value || o.p}>{o.label || o.p}{o.a ? ` – ₦${o.a.toLocaleString()}` : ""}</option>
        )}
      </select>
    </div>
  );
}

/* ── Network selector with brand logos + auto-detect ────────────── */

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
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center shadow-sm"
                  style={{ background: cfg.bg }}>
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

/* ── Cable TV selector with brand logos ──────────────────────────── */

function CableSelector({ value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Provider *</label>
      <div className="grid grid-cols-3 gap-3">
        {CABLE_PROVIDERS.map(p => {
          const cfg = CABLE_CONFIG[p];
          const sel = value === p;
          return (
            <button key={p} type="button" onClick={() => onChange(p)}
              className={`relative flex flex-col items-center gap-2 rounded-2xl py-3 px-2 transition-all duration-150 active:scale-95 border-2 ${sel ? "shadow-md" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"}`}
              style={sel ? { borderColor: cfg.bg + "99", background: cfg.bg + "18" } : {}}>
              <div className="w-full h-9 rounded-xl flex items-center justify-center" style={{ background: cfg.bg }}>
                <span className="text-[12px] font-black" style={{ color: cfg.fg }}>{cfg.abbr}</span>
              </div>
              <span className={`text-[11px] font-bold ${sel ? "text-slate-700 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>{p}</span>
              {sel && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center shadow-sm"
                  style={{ background: cfg.bg }}>
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

/* ── Betting platform selector ───────────────────────────────────── */

function BettingSelector({ value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Platform *</label>
      <div className="grid grid-cols-3 gap-2">
        {BETTING_PROVIDERS.map(p => {
          const sel = value === p.id;
          return (
            <button key={p.id} type="button" onClick={() => onChange(p.id)}
              className={`relative flex flex-col items-center gap-1.5 rounded-2xl py-2.5 px-1.5 transition-all duration-150 active:scale-95 border-2 ${sel ? "shadow-md" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"}`}
              style={sel ? { borderColor: p.bg + "99", background: p.bg + "18" } : {}}>
              <div className="w-full h-7 rounded-lg flex items-center justify-center" style={{ background: p.bg }}>
                <span className="text-[9px] font-black leading-none" style={{ color: p.fg }}>{p.label.slice(0, 7)}</span>
              </div>
              <span className={`text-[9px] font-bold leading-none text-center ${sel ? "text-slate-700 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>{p.label}</span>
              {sel && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center shadow-sm"
                  style={{ background: p.bg }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={p.fg} strokeWidth={4} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Bills dashboard card ────────────────────────────────────────── */

function BillsDashboard({ bills }) {
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();

  const todayBills = bills.filter(b => (b.transaction_date || "") === todayStr);
  const weekBills  = bills.filter(b => (b.transaction_date || "") >= weekAgoStr);

  const catData = CATS.map(c => {
    const cb = bills.filter(b => b.category === c.id);
    return { ...c, total: cb.reduce((s, b) => s + b.amount, 0), count: cb.length };
  }).filter(c => c.count > 0).sort((a, b) => b.total - a.total);

  const maxTotal  = Math.max(...catData.map(c => c.total), 1);
  const recentBill = bills[0];
  const todayTotal = todayBills.reduce((s, b) => s + b.amount, 0);
  const weekTotal  = weekBills.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700/60 overflow-hidden shadow-sm">

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700/60">
        <p className="text-[11px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Bills Overview</p>
        {recentBill && (
          <p className="text-[10px] text-slate-400 font-medium truncate max-w-[140px]">
            Last · <span className="text-slate-500 dark:text-slate-400">{fmtDT(recentBill.created_at).split("·")[1]?.trim()}</span>
          </p>
        )}
      </div>

      {/* Today / 7 Days */}
      <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-700/60">
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Today</p>
          <p className="text-xl font-black text-slate-800 dark:text-white leading-tight mt-0.5">{fmt(todayTotal)}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-1.5 h-1.5 rounded-full ${todayBills.length > 0 ? "bg-green-500" : "bg-slate-300"}`} />
            <p className="text-[11px] text-slate-400">{todayBills.length} payment{todayBills.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Last 7 Days</p>
          <p className="text-xl font-black text-slate-800 dark:text-white leading-tight mt-0.5">{fmt(weekTotal)}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-1.5 h-1.5 rounded-full ${weekBills.length > 0 ? "bg-blue-400" : "bg-slate-300"}`} />
            <p className="text-[11px] text-slate-400">{weekBills.length} payment{weekBills.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
      </div>

      {/* Category bars */}
      {catData.length > 0 ? (
        <div className="px-5 pt-3.5 pb-4 border-t border-slate-100 dark:border-slate-700/60">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-3.5">Top Spend</p>
          <div className="space-y-3">
            {catData.slice(0, 4).map(c => (
              <div key={c.id} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-xl flex-shrink-0 flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg,${c.g1},${c.g2})` }}>
                  <Ico d={CAT_ICONS[c.id] || CAT_ICONS.airtime} size={13} c="white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1.5">
                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate">{c.label}</p>
                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 ml-2 flex-shrink-0">{fmt(c.total)}</p>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.max((c.total / maxTotal) * 100, 4)}%`,
                               background: `linear-gradient(90deg,${c.g1},${c.g2})` }} />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 flex-shrink-0 w-8 text-right font-medium">{c.count}×</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 py-5 border-t border-slate-100 dark:border-slate-700/60 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Pay a bill to see your spending breakdown</p>
        </div>
      )}
    </div>
  );
}

/* ── Payment form ────────────────────────────────────────────────── */

function PhoneWithDetect({ value, onChange, label = "Phone Number", req = true }) {
  const detected = value.length >= 4 ? detectNetwork(value) : null;
  const cfg = detected ? NET_CONFIG[detected] : null;
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{label}{req ? " *" : ""}</label>
      <div className="relative">
        <input type="tel" value={value} onChange={onChange} placeholder="08012345678"
          className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 pr-20" />
        {cfg && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black px-2 py-0.5 rounded-full leading-none"
            style={{ background: cfg.bg, color: cfg.fg }}>
            {cfg.abbr}
          </span>
        )}
      </div>
    </div>
  );
}

function PaymentForm({ catId, form, setForm, verified, verifying, onVerifyMeter, dataPlans, dataPlansLoading, cablePlans, cablePlansLoading }) {
  const s = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (catId === "airtime") {
    const detected = form.phone?.length >= 4 ? detectNetwork(form.phone) : null;
    return (
      <>
        <NetworkSelector value={form.network} onChange={v => s("network", v)} detected={detected && detected === form.network ? detected : null} />
        <PhoneWithDetect value={form.phone} onChange={e => {
          const phone = e.target.value;
          const net = detectNetwork(phone);
          setForm(f => ({ ...f, phone, ...(net ? { network: net } : {}) }));
        }} />
        <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="100" req />
      </>
    );
  }

  if (catId === "data") {
    const detected = form.phone?.length >= 4 ? detectNetwork(form.phone) : null;
    return (
      <>
        <NetworkSelector value={form.network}
          onChange={v => setForm(f => ({ ...f, network: v, planId: "", planName: "", amount: "" }))}
          detected={detected && detected === form.network ? detected : null} />
        <PhoneWithDetect value={form.phone} onChange={e => {
          const phone = e.target.value;
          const net = detectNetwork(phone);
          const netChanged = net && net !== form.network;
          setForm(f => ({ ...f, phone, ...(net ? { network: net } : {}), ...(netChanged ? { planId: "", planName: "", amount: "" } : {}) }));
        }} />
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Data Plan *</label>
          {dataPlansLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-14 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />)}
            </div>
          ) : dataPlans.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {dataPlans.map(pl => {
                const pid = pl.plan_id || pl.plan_code;
                const pname = pl.plan_name || pid;
                const pamount = pl.plan_amount || pl.amount || "";
                return (
                  <button key={pid} type="button"
                    onClick={() => setForm(f => ({ ...f, planId: pid, planName: pname, amount: String(pamount) }))}
                    className={`py-2 px-1 rounded-xl border-2 text-center transition-colors ${form.planId === pid ? "border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                    <p className="text-[11px] font-bold leading-tight">{pname}</p>
                    {pamount ? <p className="text-[10px] font-medium mt-0.5">₦{Number(pamount).toLocaleString()}</p> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1.5">
              <input type="text" value={form.planName || ""}
                onChange={e => setForm(f => ({ ...f, planId: e.target.value, planName: e.target.value }))}
                placeholder="Enter plan name, e.g. 1GB Daily"
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
              <p className="text-[11px] text-slate-400">Plans unavailable — enter plan name manually</p>
            </div>
          )}
        </div>
        <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" req />
      </>
    );
  }

  if (catId === "electricity") return (
    <>
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Distribution Company *</label>
        <select value={form.disco}
          onChange={e => { const d = ELEC_DISCOS.find(x => x.code === e.target.value); s("disco", e.target.value); s("discoName", d?.name || e.target.value); }}
          className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500">
          {ELEC_DISCOS.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Meter Type *</label>
        <div className="grid grid-cols-2 gap-2">
          {["prepaid","postpaid"].map(t => (
            <button key={t} type="button" onClick={() => s("meterType", t)}
              className={`py-2 text-xs font-bold rounded-xl border-2 capitalize transition-colors ${form.meterType === t ? "border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Meter Number *</label>
        <div className="flex gap-2">
          <input type="text" value={form.meter} onChange={e => s("meter", e.target.value)} placeholder="e.g. 45145984782"
            className="flex-1 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
          <button type="button" onClick={onVerifyMeter} disabled={verifying || !form.meter || !form.disco}
            className="px-3 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors whitespace-nowrap">
            {verifying ? "…" : "Verify"}
          </button>
        </div>
        {verified && (
          <div className="mt-2 flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-3 py-2">
            <Ico d="M20 6L9 17l-5-5" size={14} c="#16a34a" />
            <p className="text-xs text-green-700 dark:text-green-400 font-semibold">{verified.customer_name}</p>
          </div>
        )}
      </div>
      <PhoneWithDetect value={form.phone} onChange={e => {
        const phone = e.target.value;
        setForm(f => ({ ...f, phone }));
      }} />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="2000" req />
    </>
  );

  if (catId === "cable_tv") return (
    <>
      <CableSelector value={form.provider}
        onChange={p => setForm(f => ({ ...f, provider: p, planId: "", planName: "", amount: "" }))} />
      <FInput label="Smart Card Number" value={form.smartcard} onChange={e => s("smartcard", e.target.value)} placeholder="1234567890" req />
      <div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Package *</label>
        {cablePlansLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse" />)}</div>
        ) : cablePlans.length > 0 ? (
          <div className="space-y-2">
            {cablePlans.map(pl => {
              const pid = pl.plan_id || pl.plan_code;
              const pname = pl.plan_name || pid;
              const pamount = pl.plan_amount || pl.amount || "";
              return (
                <button key={pid} type="button"
                  onClick={() => setForm(f => ({ ...f, planId: pid, planName: pname, amount: String(pamount) }))}
                  className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl border-2 transition-colors ${form.planId === pid ? "border-violet-500 bg-violet-50 dark:bg-violet-900/30" : "border-slate-200 dark:border-slate-700"}`}>
                  <span className={`text-sm font-semibold ${form.planId === pid ? "text-violet-700 dark:text-violet-300" : "text-slate-700 dark:text-slate-300"}`}>{pname}</span>
                  {pamount ? <span className={`text-sm font-bold ${form.planId === pid ? "text-violet-600" : "text-slate-500"}`}>₦{Number(pamount).toLocaleString()}</span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            <input type="text" value={form.planName || ""}
              onChange={e => setForm(f => ({ ...f, planId: e.target.value, planName: e.target.value }))}
              placeholder="Enter package, e.g. DStv Compact"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            <p className="text-[11px] text-slate-400">Packages unavailable — enter name manually</p>
          </div>
        )}
      </div>
      <PhoneWithDetect value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" req />
    </>
  );

  if (catId === "betting") return (
    <>
      <BettingSelector value={form.provider} onChange={v => s("provider", v)} />
      <FInput label="Account ID / Username" value={form.account} onChange={e => s("account", e.target.value)} placeholder="Your betting account ID or username" req />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="500" req />
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
        <p className="text-xs text-green-700 dark:text-green-300 font-medium">Wallet funded instantly via VTpass. Funds reflect in your betting account within seconds.</p>
      </div>
    </>
  );

  if (catId === "internet") return (
    <>
      <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-xl px-4 py-3">
        <p className="text-xs text-cyan-700 dark:text-cyan-300 font-medium">Recorded locally for tracking. Direct ISP payment not yet available via API.</p>
      </div>
      <FSelect label="Provider *" value={form.provider} onChange={e => s("provider", e.target.value)} options={INTERNET_PROVIDERS} />
      <FInput label="Account / Phone Number" value={form.account} onChange={e => s("account", e.target.value)} placeholder="Account number" req />
      <FInput label="Plan (optional)" value={form.plan} onChange={e => s("plan", e.target.value)} placeholder="e.g. 10Mbps Monthly" />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="5000" req />
    </>
  );

  if (catId === "water") return (
    <>
      <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-xl px-4 py-3">
        <p className="text-xs text-sky-700 dark:text-sky-300 font-medium">Recorded locally for tracking. Direct water board payment not yet available via API.</p>
      </div>
      <FSelect label="Water Board *" value={form.provider} onChange={e => s("provider", e.target.value)} options={WATER_PROVIDERS} />
      <FInput label="Account / Customer Number" value={form.account} onChange={e => s("account", e.target.value)} placeholder="Account number" req />
      <PhoneWithDetect value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} label="Phone Number" req={false} />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="5000" req />
    </>
  );

  if (catId === "insurance") return (
    <>
      <div className="bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3">
        <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">Recorded locally for tracking. Direct insurer payment not yet available via API.</p>
      </div>
      <FSelect label="Insurance Company *" value={form.provider} onChange={e => s("provider", e.target.value)} options={INSURANCE_PROVIDERS} />
      <FSelect label="Insurance Type *" value={form.type} onChange={e => s("type", e.target.value)} options={INSURANCE_TYPES} />
      <FInput label="Policy / Reference Number" value={form.policyNo} onChange={e => s("policyNo", e.target.value)} placeholder="POL-12345" />
      <PhoneWithDetect value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="10000" req />
    </>
  );

  if (catId === "education") return (
    <>
      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3">
        <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">Recorded locally for tracking. Direct institution payment not yet available via API.</p>
      </div>
      <FInput label="Institution Name" value={form.institution} onChange={e => s("institution", e.target.value)} placeholder="University of Lagos" req />
      <FInput label="Student Name" value={form.student} onChange={e => s("student", e.target.value)} placeholder="Full name" req />
      <FInput label="Reg / Matric Number" value={form.regNo} onChange={e => s("regNo", e.target.value)} placeholder="ENG/2024/001" />
      <FSelect label="Fee Type *" value={form.feeType} onChange={e => s("feeType", e.target.value)} options={EDU_FEES} />
      <FInput label="Amount (₦)" value={form.amount} onChange={e => s("amount", e.target.value)} type="number" placeholder="50000" req />
    </>
  );

  return null;
}

/* ── Bill history row ────────────────────────────────────────────── */

function BillRow({ bill }) {
  const cat = catMeta(bill.category);
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700/50 flex items-center gap-3 shadow-sm">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
        <Ico d={CAT_ICONS[bill.category] || CAT_ICONS.airtime} size={18} c="white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{bill.item_name}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
          {bill.customer_name && `${bill.customer_name} · `}{fmtDT(bill.created_at)}
        </p>
        {bill.note && <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate italic">{bill.note}</p>}
      </div>
      <p className="text-sm font-extrabold text-red-500 flex-shrink-0">{fmt(bill.amount)}</p>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */

export default function BillPayments({ store, staffName = null, businessName = null, readOnly = false }) {
  const { transactions, addTransaction } = store;

  const [selectedCat,  setSelectedCat]  = useState(null);
  const [form,         setForm]         = useState({});
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState("");
  const [receipt,      setReceipt]      = useState(null);

  const [verifying,    setVerifying]    = useState(false);
  const [verified,     setVerified]     = useState(null);

  const [dataPlans,         setDataPlans]         = useState([]);
  const [dataPlansLoading,  setDataPlansLoading]  = useState(false);
  const [cablePlans,        setCablePlans]        = useState([]);
  const [cablePlansLoading, setCablePlansLoading] = useState(false);

  const [filterCat,  setFilterCat]  = useState("all");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [amountMin,  setAmountMin]  = useState("");
  const [amountMax,  setAmountMax]  = useState("");
  const [showFilter, setShowFilter] = useState(false);

  const allBills = useMemo(
    () => transactions.filter(t => t.payment_type === "bill_payment"),
    [transactions]
  );

  const bills = useMemo(() => {
    let list = allBills;
    if (filterCat !== "all") list = list.filter(t => t.category === filterCat);
    if (dateFrom)            list = list.filter(t => (t.transaction_date || "") >= dateFrom);
    if (dateTo)              list = list.filter(t => (t.transaction_date || "") <= dateTo);
    if (amountMin)           list = list.filter(t => t.amount >= parseFloat(amountMin));
    if (amountMax)           list = list.filter(t => t.amount <= parseFloat(amountMax));
    return list;
  }, [allBills, filterCat, dateFrom, dateTo, amountMin, amountMax]);

  const totalBills = allBills.reduce((s, b) => s + b.amount, 0);

  const loadDataPlans = useCallback(async (network) => {
    setDataPlansLoading(true); setDataPlans([]);
    try { const res = await peyflex("data-plans", { network }); setDataPlans(res?.plans || []); }
    catch { setDataPlans([]); }
    finally { setDataPlansLoading(false); }
  }, []);

  const loadCablePlans = useCallback(async (provider) => {
    setCablePlansLoading(true); setCablePlans([]);
    try { const res = await peyflex("cabletv-plans", { provider }); setCablePlans(res?.plans || []); }
    catch { setCablePlans([]); }
    finally { setCablePlansLoading(false); }
  }, []);

  const openSheet = (catId) => {
    if (readOnly) return;
    setSelectedCat(catId); setForm(initForm(catId));
    setError(""); setVerified(null);
    setDataPlans([]); setCablePlans([]);
    if (catId === "data") loadDataPlans("MTN");
    if (catId === "cable_tv") loadCablePlans("DSTV");
  };

  const closeSheet = () => { setSelectedCat(null); setForm({}); setError(""); setVerified(null); };

  const handleSetForm = useCallback((updater) => {
    setForm(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (selectedCat === "data" && next.network !== prev.network) loadDataPlans(next.network);
      if (selectedCat === "cable_tv" && next.provider !== prev.provider) loadCablePlans(next.provider);
      return next;
    });
  }, [selectedCat, loadDataPlans, loadCablePlans]);

  const { meter, disco, meterType } = form;
  useEffect(() => { if (selectedCat === "electricity") setVerified(null); }, [selectedCat, meter, disco, meterType]);

  const handleVerifyMeter = async () => {
    if (!form.meter || !form.disco) return;
    setVerifying(true); setVerified(null); setError("");
    try {
      const res = await peyflex("electricity-verify", { meter: form.meter, plan: form.disco, type: form.meterType || "prepaid" });
      if (res?.status === "SUCCESS") setVerified({ customer_name: res.customer_name });
      else setError(res?.message || "Meter verification failed");
    } catch (err) { setError(err.message || "Verification failed. Please try again."); }
    finally { setVerifying(false); }
  };

  const handlePay = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }
    const cat = catMeta(selectedCat);

    if (cat.live) {
      if (selectedCat === "airtime"     && !form.phone)     { setError("Phone number required"); return; }
      if (selectedCat === "data"        && !form.phone)     { setError("Phone number required"); return; }
      if (selectedCat === "data"        && !form.planId)    { setError("Select a data plan"); return; }
      if (selectedCat === "electricity" && !form.meter)     { setError("Meter number required"); return; }
      if (selectedCat === "electricity" && !form.phone)     { setError("Phone number required"); return; }
      if (selectedCat === "electricity" && !verified)       { setError("Please verify meter before paying"); return; }
      if (selectedCat === "cable_tv"    && !form.smartcard) { setError("Smart card number required"); return; }
      if (selectedCat === "cable_tv"    && !form.planId)    { setError("Select a package"); return; }
      if (selectedCat === "cable_tv"    && !form.phone)     { setError("Phone number required"); return; }
      if (selectedCat === "betting"     && !form.account)   { setError("Account ID / username required"); return; }
    } else {
      if (selectedCat === "internet"  && !form.account) { setError("Account number required"); return; }
      if (selectedCat === "education" && !form.student)  { setError("Student name required"); return; }
      if (selectedCat === "water"     && !form.account)  { setError("Account number required"); return; }
      if (selectedCat === "insurance" && !form.phone)    { setError("Phone number required"); return; }
    }

    setSaving(true); setError("");
    let apiRef = null, elecToken = null;

    try {
      if (cat.live) {
        let res;
        if (selectedCat === "airtime")     res = await peyflex("airtime",  { phone: form.phone, network: form.network, amount: form.amount });
        else if (selectedCat === "data")   res = await peyflex("data",     { phone: form.phone, plan: form.planId, amount: form.amount, network: form.network });
        else if (selectedCat === "electricity") res = await peyflex("electricity", { meter: form.meter, plan: form.disco, amount: form.amount, type: form.meterType, phone: form.phone });
        else if (selectedCat === "cable_tv")    res = await peyflex("cabletv",     { smartcard: form.smartcard, plan: form.planId, amount: form.amount, phone: form.phone, provider: form.provider });
        else if (selectedCat === "betting")     res = await peyflex("betting",     { account: form.account, provider: form.provider, amount: form.amount });

        if (!res || res.status !== "SUCCESS") throw new Error(res?.message || "Payment failed. Check your VTpass wallet balance.");
        apiRef = res.reference || null;
        elecToken = res.token || null;
      }

      const { item_name, customer_name, note } = buildNames(selectedCat, form);
      const payload = {
        type: "out", category: selectedCat, payment_type: "bill_payment",
        item_name, customer_name, amount,
        note: `${note}${apiRef ? ` | Ref: ${apiRef}` : ""}`,
        transaction_date: today(),
      };

      await addTransaction(payload);
      setSaving(false); closeSheet();
      setReceipt({ ...payload, receiptId: rcpId(), apiRef, token: elecToken, created_at: new Date().toISOString(), staffName, businessName });
    } catch (err) {
      setSaving(false);
      setError(err.message || "Payment failed. Please try again.");
    }
  };

  const activeFilterCount = [filterCat !== "all", dateFrom, dateTo, amountMin, amountMax].filter(Boolean).length;

  return (
    <div className="pb-32 screen-enter">

      {/* Header */}
      <div className="px-4 pt-5 pb-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 sticky top-0 z-10">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Bill Payments</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Pay utilities, data, betting, insurance &amp; more</p>
        {readOnly && (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
            View-only access. Ask your manager for permission to process bill payments.
          </p>
        )}
      </div>

      <div className="px-4 pt-4 space-y-4">

        {/* Summary strip */}
        <div className="bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl px-5 py-4 text-white flex items-center justify-between shadow-md">
          <div>
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Total Bills Paid</p>
            <p className="text-2xl font-black mt-0.5">{fmt(totalBills)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Transactions</p>
            <p className="text-2xl font-black mt-0.5">{allBills.length}</p>
          </div>
        </div>

        {/* Bills dashboard card */}
        <BillsDashboard bills={allBills} />

        {/* Category cards */}
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Select Service</h2>
          <div className="grid grid-cols-3 gap-3">
            {CATS.map(cat => {
              const count = allBills.filter(t => t.category === cat.id).length;
              return (
                <button key={cat.id} onClick={() => openSheet(cat.id)} disabled={readOnly}
                  className="rounded-2xl p-4 flex flex-col items-center gap-2 shadow-md active:scale-95 transition-all duration-150 text-white disabled:opacity-50 disabled:cursor-not-allowed relative"
                  style={{ background: `linear-gradient(135deg,${cat.g1},${cat.g2})` }}>
                  {!cat.live && (
                    <span className="absolute top-1.5 right-1.5 text-[8px] font-bold bg-white/25 px-1.5 py-0.5 rounded-full leading-none">LOCAL</span>
                  )}
                  <Ico d={CAT_ICONS[cat.id]} size={26} c="rgba(255,255,255,0.95)" />
                  <p className="text-[11px] font-bold">{cat.label}</p>
                  {count > 0 && <p className="text-[9px] font-semibold bg-white/25 px-1.5 py-0.5 rounded-full">{count} paid</p>}
                </button>
              );
            })}
          </div>
        </div>

        {/* History + filters */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">
              Payment History {bills.length > 0 && <span className="text-slate-400 font-normal">({bills.length})</span>}
            </h2>
            <button onClick={() => setShowFilter(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border transition-colors ${activeFilterCount > 0 ? "bg-green-600 text-white border-green-600" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
              <Ico d="M4 6h16|M8 12h8|M12 18h0" size={13} />
              Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 mb-3 scrollbar-hide">
            {["all", ...CATS.map(c => c.id)].map(id => (
              <button key={id} onClick={() => setFilterCat(id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${filterCat === id ? "bg-green-600 text-white" : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                {id === "all" ? "All" : catMeta(id).label}
              </button>
            ))}
          </div>

          {showFilter && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 mb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Date From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Date To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FInput label="Min Amount" value={amountMin} onChange={e => setAmountMin(e.target.value)} type="number" placeholder="0" />
                <FInput label="Max Amount" value={amountMax} onChange={e => setAmountMax(e.target.value)} type="number" placeholder="Any" />
              </div>
              <button onClick={() => { setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax(""); setFilterCat("all"); setShowFilter(false); }}
                className="text-xs text-red-500 font-semibold underline">Clear all filters</button>
            </div>
          )}

          {bills.length === 0 ? (
            <div className="text-center py-14 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <Ico d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4" size={22} c="#94a3b8" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No bill payments yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Tap any service above to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bills.map(b => <BillRow key={b.id || b.item_name + b.created_at} bill={b} />)}
            </div>
          )}
        </div>
      </div>

      {/* Payment bottom sheet */}
      {selectedCat && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg,${catMeta(selectedCat).g1},${catMeta(selectedCat).g2})` }}>
                  <Ico d={CAT_ICONS[selectedCat]} size={17} c="white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-800 dark:text-white">Pay {catMeta(selectedCat).label}</h2>
                  {catMeta(selectedCat).live
                    ? <p className="text-[10px] text-green-600 font-semibold">Live via VTpass</p>
                    : <p className="text-[10px] text-slate-400 font-semibold">Local record</p>
                  }
                </div>
              </div>
              <button onClick={closeSheet} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Ico d="M18 6L6 18|M6 6l12 12" size={14} c="#64748b" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <PaymentForm
                catId={selectedCat} form={form} setForm={handleSetForm}
                verified={verified} verifying={verifying} onVerifyMeter={handleVerifyMeter}
                dataPlans={dataPlans} dataPlansLoading={dataPlansLoading}
                cablePlans={cablePlans} cablePlansLoading={cablePlansLoading}
              />

              {staffName && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <Ico d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8" size={14} c="#3b82f6" />
                  <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">Processed by <strong>{staffName}</strong></p>
                </div>
              )}

              {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

              <div className="pb-6">
                <button onClick={handlePay} disabled={saving}
                  className="w-full text-white font-bold rounded-xl py-3.5 text-sm transition-all disabled:opacity-60"
                  style={{ background: `linear-gradient(135deg,${catMeta(selectedCat).g1},${catMeta(selectedCat).g2})` }}>
                  {saving ? "Processing…" : `Pay ${form.amount ? fmt(parseFloat(form.amount) || 0) : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {receipt && <BillReceipt bill={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
