import { useState, useMemo, useCallback, useEffect } from "react";
import { fmt, today } from "../utils/helpers";
import { clubkonnect } from "../utils/clubkonnect";
import { canDo } from "../utils/plans";
import { BillReceipt } from "../components/shared/Receipt";
import { supabase } from "../utils/supabase";

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
  { id: "print-data",   label: "Print Data",      g1: "#64748b", g2: "#475569", enterprise: true },
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
  "print-data":  "M6 9V2h12v7|M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2|M6 14h12v8H6v-8z",
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

/* ─── Overview / history ───────────────────────────────────────────────────── */

function Overview({ bills }) {
  const todayStr   = new Date().toISOString().slice(0, 10);
  const weekAgoStr = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })();
  const todayTotal = bills.filter(b => (b.transaction_date || "") === todayStr).reduce((s, b) => s + b.amount, 0);
  const weekTotal  = bills.filter(b => (b.transaction_date || "") >= weekAgoStr).reduce((s, b) => s + b.amount, 0);
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

function BillRow({ bill }) {
  const cat = CATS.find(c => c.id === bill.category) || CATS[0];
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
              Services showing "Invalid Key" need their API key updated in Supabase secrets. Copy the key from your ClubKonnect dashboard for each broken service.
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

export default function BillPayments({ store, plan, staffName = null, businessName = null, autoService = null, onAutoOpened = null }) {
  const { transactions, addTransaction, profile } = store;
  // plan is a slug string from useAuth (e.g. "enterprise"), not a plan object
  const planSlug = typeof plan === "string" ? plan : (plan?.slug ?? "");
  // Unlock for enterprise: match by feature key or slug name
  const isEnterprise = canDo(planSlug, "apiAccess") || planSlug === "enterprise";

  const [selectedCat,  setSelectedCat]  = useState(null);
  const [showKeyStatus, setShowKeyStatus] = useState(false);
  const [form,        setForm]        = useState({});
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [receipt,     setReceipt]     = useState(null);
  const [pins,        setPins]        = useState(null);
  // Result of ClubKonnect fulfillment after Paystack return
  const [fulfillResult, setFulfillResult] = useState(null); // null | { ok, label, detail, pinsArr, psRef }

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

  const resetVerify = () => { setVerifyStatus("idle"); setVerifyName(""); };

  const openSheet = useCallback((catId) => {
    const catMeta = CATS.find(c => c.id === catId);
    if (catMeta?.enterprise && !isEnterprise) return;
    setSelectedCat(catId);
    setForm({ network: "MTN", phone: "", amount: "", planId: "", planName: "",
               provider: "", smartcard: "", meterNo: "", meterType: "01",
               company: "", customerId: "", examType: "", profileId: "",
               accountNo: "", value: "100", quantity: "1" });
    setError(""); setPins(null); resetVerify(); setPlans([]); setPlansError(""); setPkgs([]); setPkgsError("");
    if (catId === "data") loadPlans("data-plans", { network: "MTN" });
    if (catId === "spectranet") loadPlans("spectranet-plans", {});
    if (catId === "smile") loadPlans("smile-plans", {});
    if (catId === "print-data") loadPlans("data-plans", { network: "MTN" });
  }, [isEnterprise]);

  useEffect(() => {
    if (autoService) { openSheet(autoService); onAutoOpened?.(); }
  }, [autoService]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle return from Paystack redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billRef = params.get("bill_ref");
    const trxref  = params.get("trxref") || params.get("reference");
    const ref = billRef || trxref;
    if (!ref) return;
    // Clean URL immediately
    window.history.replaceState({}, "", window.location.pathname);
    const stored = localStorage.getItem(BILL_PENDING_PREFIX + ref);
    if (!stored) return;
    const pending = JSON.parse(stored);
    setSaving(true);
    fulfillAfterPayment(ref, pending);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closeSheet = () => { setSelectedCat(null); setForm({}); setError(""); resetVerify(); };

  const loadPlans = async (action, extra) => {
    setPlansLoading(true); setPlans([]); setPlansError("");
    try {
      const r = await clubkonnect(action, extra);
      if (r?.plans?.length) { setPlans(r.plans); }
      else { setPlansError(r?.error || "No plans returned from provider"); }
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
      if (selectedCat === "print-airtime" && (!form.network || !form.value || !form.quantity)) throw new Error("Network, value and quantity required");
      if (selectedCat === "print-data"  && (!form.network || !form.planId || !form.quantity))  throw new Error("Network, plan and quantity required");

      // Calculate charge amount
      const chargeAmount = selectedCat === "print-airtime"
        ? parseInt(form.value, 10) * parseInt(form.quantity || "1", 10)
        : selectedCat === "print-data"
          ? amount * parseInt(form.quantity || "1", 10)
          : amount;

      if (!chargeAmount || chargeAmount <= 0) throw new Error("Invalid amount");

      // Store bill details so we can fulfill after payment return
      const ref = `KDT-BILL-${Date.now()}`;
      localStorage.setItem(BILL_PENDING_PREFIX + ref, JSON.stringify({
        cat: selectedCat, form: { ...form }, verifyName,
      }));

      // Initialize Paystack
      const email = profile?.email || "";
      const catLabel = CATS.find(c => c.id === selectedCat)?.label || selectedCat;
      const callbackUrl = `${window.location.origin}${window.location.pathname}?bill_ref=${ref}`;

      const { data: ps } = await supabase.functions.invoke("paystack", {
        body: {
          action: "initialize",
          email,
          amount: chargeAmount,
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

  // ── Step 2: Verify payment then fulfill via ClubKonnect ───────────────────────
  const fulfillAfterPayment = useCallback(async (ref, pending) => {
    setError("");
    try {
      // Verify payment with Paystack
      const { data: vd } = await supabase.functions.invoke("paystack", {
        body: { action: "verify", reference: ref },
      });
      if (vd?.data?.status !== "success") {
        throw new Error(vd?.data?.gateway_response || "Payment not confirmed. Please contact support.");
      }

      const { cat, form: f, verifyName: vName } = pending;
      let apiRef = "", note = "", itemName = "", customerRef = "", cardDetails = "", pinsArr = null;
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
        note = r.token ? `Token: ${r.token} | Meter: ${f.meterNo} | ${vName}${apiRef ? ` | Ref: ${apiRef}` : ""}` : `Meter: ${f.meterNo} | ${vName}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

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
        apiRef = r.reference; pinsArr = r.pins || [];
        const qty = parseInt(f.quantity, 10);
        itemName = `${f.network} ₦${f.value} Airtime Print x${qty}`; customerRef = `${qty} pins`;
        note = `Network: ${f.network} | Value: ₦${f.value} x${qty}${apiRef ? ` | Ref: ${apiRef}` : ""}`;

      } else if (cat === "print-data") {
        const r = await clubkonnect("print-data", { network: f.network, planId: f.planId, quantity: f.quantity });
        apiRef = r.reference; pinsArr = r.pins || [];
        const qty = parseInt(f.quantity, 10);
        itemName = `${f.network} ${f.planName} Data Print x${qty}`; customerRef = `${qty} pins`;
        note = `Network: ${f.network} | Plan: ${f.planName} x${qty}${apiRef ? ` | Ref: ${apiRef}` : ""}`;
      }

      const totalAmount = cat === "print-airtime"
        ? parseInt(f.value, 10) * parseInt(f.quantity || "1", 10)
        : cat === "print-data" ? amount * parseInt(f.quantity || "1", 10) : amount;

      const payload = {
        type: "out", category: cat, payment_type: "bill_payment",
        item_name: itemName, customer_name: customerRef,
        amount: totalAmount || amount, note,
        transaction_date: today(),
      };

      await addTransaction(payload);
      localStorage.removeItem(BILL_PENDING_PREFIX + ref);
      setSaving(false);
      setFulfillResult({ ok: true, label: itemName, detail: note, pinsArr: pinsArr || [], psRef: ref, apiRef, cardDetails });
    } catch (err) {
      setSaving(false);
      const ckError = err.message || "Unknown error";
      setFulfillResult({ ok: false, label: "", detail: ckError, psRef: ref, apiRef: "" });

      // Fire-and-forget: alert admin/finance of the failed delivery
      try {
        const { cat, form: f } = pending;
        await supabase.functions.invoke("clubkonnect", {
          body: {
            action:     "bill-failure-alert",
            user_id:    profile?.id    || null,
            user_email: profile?.email || null,
            user_name:  profile?.owner_name || profile?.business_name || null,
            service:    CATS.find(c => c.id === cat)?.label || cat,
            amount:     parseFloat(f.amount) || 0,
            ps_ref:     ref,
            ck_error:   ckError,
          },
        });
      } catch (_) { /* alert is best-effort */ }
    }
  }, [addTransaction, staffName, businessName, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const cat = CATS.find(c => c.id === selectedCat);
  const detected = form.phone?.length >= 4 ? detectNetwork(form.phone) : null;

  return (
    <div className="pb-32 screen-enter">

      {/* ── Paystack return overlay (processing → result) ─────────────────── */}
      {(saving && !selectedCat) || fulfillResult ? (
        <div className="fixed inset-0 z-[60] bg-white dark:bg-slate-900 flex flex-col">

          {/* Processing state */}
          {saving && !fulfillResult && (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">
              <div className="w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-base font-bold text-slate-800 dark:text-white">Payment confirmed!</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Delivering your service, please wait…</p>
              </div>
            </div>
          )}

          {/* Success state */}
          {fulfillResult?.ok && (
            <div className="flex-1 flex flex-col">
              {/* Green header */}
              <div className="flex flex-col items-center justify-center py-10 px-6"
                style={{ background: "linear-gradient(145deg,#059669,#047857)" }}>
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mb-3">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <p className="text-xl font-black text-white">Bill Payment Successful</p>
                <p className="text-sm text-white/70 mt-1">{fulfillResult.label}</p>
              </div>

              {/* Details */}
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
                {/* Detail rows */}
                {fulfillResult.detail.split(" | ").map((d, i) => {
                  const [k, ...rest] = d.split(": ");
                  return rest.length > 0 ? (
                    <div key={i} className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide flex-shrink-0">{k}</span>
                      <span className="text-sm font-bold text-slate-800 dark:text-white text-right break-all">{rest.join(": ")}</span>
                    </div>
                  ) : (
                    <div key={i} className="py-2.5 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-sm text-slate-600 dark:text-slate-400">{d}</span>
                    </div>
                  );
                })}

                {/* Paystack ref */}
                <div className="flex items-start justify-between gap-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold uppercase tracking-wide flex-shrink-0">Payment Ref</span>
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-400 text-right break-all">{fulfillResult.psRef}</span>
                </div>

                {/* Pins */}
                {fulfillResult.pinsArr?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">PIN(s)</p>
                    <div className="space-y-2">
                      {fulfillResult.pinsArr.map((pin, i) => {
                        const serial = pin.EPIN_SERIAL ?? pin.serial ?? "";
                        const code   = pin.EPIN ?? pin.pin ?? pin.code ?? JSON.stringify(pin);
                        return (
                          <div key={i} className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3">
                            {serial ? <p className="text-[10px] text-slate-400 mb-0.5">S/N: {serial}</p> : null}
                            <p className="font-mono font-bold text-slate-800 dark:text-white tracking-widest text-sm">{code}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 pb-8 pt-3">
                <button onClick={() => setFulfillResult(null)}
                  className="w-full py-3.5 bg-green-600 text-white font-bold rounded-xl text-sm">
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Failure state */}
          {fulfillResult && !fulfillResult.ok && (
            <div className="flex-1 flex flex-col px-6 py-8 gap-5">
              <div className="flex flex-col items-center gap-3 pt-4">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <p className="text-lg font-black text-slate-800 dark:text-white text-center">Service Delivery Failed</p>
              </div>

              {/* Exact error from API */}
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-4">
                <p className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-1">Reason from provider</p>
                <p className="text-sm font-semibold text-red-700 dark:text-red-300 leading-relaxed">{fulfillResult.detail}</p>
              </div>

              {/* Payment reference + assurance */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-4 space-y-2">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400">✓ Your Paystack payment was received</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 leading-relaxed">
                  Our team has been automatically notified and will resolve this immediately. Keep this reference:
                </p>
                <p className="font-mono text-sm font-black text-amber-700 dark:text-amber-300 break-all">{fulfillResult.psRef}</p>
              </div>

              <p className="text-xs text-slate-400 dark:text-slate-500 text-center leading-relaxed">
                A critical alert has been sent to the admin and finance team. You will be contacted or your service will be fulfilled shortly.
              </p>

              <button onClick={() => setFulfillResult(null)}
                className="w-full py-3.5 bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl text-sm mt-auto">
                Back to Bill Payments
              </button>
            </div>
          )}

        </div>
      ) : null}

      {/* Header */}
      <div className="px-4 pt-5 pb-4 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Bill Payments</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">VTU services via ClubKonnect</p>
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
            <p className="text-2xl font-black mt-0.5">{fmt(bills.reduce((s, b) => s + b.amount, 0))}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-green-100 uppercase tracking-widest">Transactions</p>
            <p className="text-2xl font-black mt-0.5">{bills.length}</p>
          </div>
        </div>

        {bills.length > 0 && <Overview bills={bills} />}

        {/* Service grid */}
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Select Service</h2>
          <div className="grid grid-cols-3 gap-3">
            {CATS.map(c => {
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
          {!isEnterprise && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-2">
              Print Airtime & Print Data require the Enterprise plan
            </p>
          )}
        </div>

        {/* History */}
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">
            History {bills.length > 0 && <span className="text-slate-400 font-normal">({bills.length})</span>}
          </h2>
          {bills.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <Ico d={CAT_ICONS.airtime} size={22} c="#94a3b8" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No bills paid yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Tap a service above to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {bills.map(b => <BillRow key={b.id || b.item_name + b.created_at} bill={b} />)}
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
                  <p className="text-[10px] text-green-600 font-semibold">Live via ClubKonnect</p>
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
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Data Plan *</label>
                  <PlanGrid plans={plans} selectedId={form.planId} loading={plansLoading} error={plansError}
                    onRetry={() => loadPlans("data-plans", { network: form.network })}
                    onSelect={pl => setForm(f => ({ ...f, planId: pl.plan_id, planName: pl.plan_name, amount: String(pl.plan_amount) }))} />
                </div>
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
                    selectedCat === "print-airtime" ? `Pay with Paystack · ${form.quantity || 1} × ₦${form.value}` :
                    selectedCat === "print-data" ? `Pay with Paystack · ${form.quantity || 1} Plan${parseInt(form.quantity||"1")>1?"s":""}` :
                    form.amount ? `Pay ${fmt(parseFloat(form.amount) || 0)} with Paystack` : `Pay with Paystack`
                  )}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {pins && <PinModal pins={pins.list} title={pins.title} onClose={() => setPins(null)} />}
      {receipt && <BillReceipt bill={receipt} onClose={() => setReceipt(null)} />}
      {showKeyStatus && <KeyStatusPanel onClose={() => setShowKeyStatus(false)} />}
    </div>
  );
}
