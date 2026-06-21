import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase }           from "../utils/supabase";
import { useStore }           from "../hooks/useStore";
import { useInventory }       from "../hooks/useInventory";
import { useBiometricLock }   from "../hooks/useBiometricLock";
import { useNotifications }   from "../hooks/useNotifications";
import NotificationCenter, { NotificationBell } from "../components/NotificationCenter";
import { fmt, today }         from "../utils/helpers";
import { canDo, normalizeSlug } from "../utils/plans";
import AppLogo                from "../components/AppLogo";
import Icon                   from "../components/Icon";
import Modal                  from "../components/shared/Modal";
import AIChatWidget           from "../components/AIChatWidget";
import VoiceModal             from "../components/VoiceModal";
import { TransactionReceipt, StaffActivityStatement } from "../components/shared/Receipt";
import BillPayments           from "./BillPayments";
import Credit                 from "./Credit";
import Aso                    from "./Aso";
import Inventory              from "./Inventory";
import Insights               from "./Insights";
import StaffReports           from "./StaffReports";
import { AddTxnModal }        from "./Transactions";

/* ═══════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════ */
const ADMIN_URL = "https://admin.kudiai.app";
const YEAR      = new Date().getFullYear();

const TICKET_TYPES = [
  { value: "account",     label: "Account / Login"      },
  { value: "transaction", label: "Transaction Issue"     },
  { value: "technical",   label: "Technical Problem"     },
  { value: "ajo",         label: "Ajo / Savings Group"   },
  { value: "general",     label: "General Enquiry"       },
];

const NAV = [
  { id: "home",    icon: "home",      label: "Home"    },
  { id: "sales",   icon: "txn",       label: "Sales"   },
  { id: "records", icon: "credit",    label: "Records" },
  { id: "stock",   icon: "inventory", label: "Stock"   },
  { id: "me",      icon: "user",      label: "Me"      },
];

const BILL_SERVICES = [
  { id: "mic",         label: "Mic Sale",    g1: "#059669", g2: "#065f46", isMic: true },
  { id: "airtime",     label: "Airtime",     g1: "#ef4444", g2: "#dc2626", icon: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" },
  { id: "data",        label: "Data",        g1: "#3b82f6", g2: "#1d4ed8", icon: "M1 6l11-4 11 4|M1 12l11-4 11 4|M1 18l11-4 11 4" },
  { id: "electricity", label: "Electricity", g1: "#f59e0b", g2: "#d97706", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  { id: "cable",       label: "Cable TV",    g1: "#8b5cf6", g2: "#6d28d9", icon: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
  { id: "betting",     label: "Betting",     g1: "#10b981", g2: "#059669", icon: "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 8v4l3 3" },
];

/* ═══════════════════════════════════════════════════════════════════
   TINY HELPERS
═══════════════════════════════════════════════════════════════════ */
function greetingText() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function fmtDate() {
  return new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function dateRange(period) {
  const now = new Date();
  if (period === "today") return today();
  if (period === "week")  { const d = new Date(now); d.setDate(d.getDate() - 7);  return d.toISOString().split("T")[0]; }
  if (period === "month") { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0]; }
  return null;
}
async function uploadAvatar(file, staffId) {
  const ext  = file.name.split(".").pop();
  const path = `staff/${staffId}/avatar.${ext}`;
  await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  const base = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  return `${base}?v=${Date.now()}`;
}

/* ═══════════════════════════════════════════════════════════════════
   SHARED MICRO-COMPONENTS
═══════════════════════════════════════════════════════════════════ */
function Svg({ d, size = 18, color = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const P = {
  in:      "M12 19V5|M5 12l7-7 7 7",
  out:     "M12 5v14|M19 12l-7 7-7-7",
  credit:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  bank:    "M3 22h18|M6 18v-7|M10 18v-7|M14 18v-7|M18 18v-7|M12 2L2 7h20L12 2z",
  bills:   "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  report:  "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8",
  mic:     "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z|M19 10v2a7 7 0 01-14 0v-2|M12 19v4|M8 23h8",
  share:   "M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8|M16 6l-4-4-4 4|M12 2v13",
  check:   "M20 6L9 17l-5-5",
  send:    "M22 2L11 13|M22 2L15 22 11 13 2 9l20-7z",
  lock:    "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z|M7 11V7a5 5 0 0110 0v4",
  shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  back:    "M19 12H5|M12 19l-7-7 7-7",
  cam:     "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z|M12 17a4 4 0 100-8 4 4 0 000 8",
  pen:     "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7|M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  doc:     "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8",
  sun:     "M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42|M12 5a7 7 0 100 14A7 7 0 0012 5z",
  moon:    "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  out2:    "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4|M16 17l5-5-5-5|M21 12H9",
  faq:     "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z|M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01",
  person:  "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8",
  finger:  "M12 10a2 2 0 00-2 2v4a2 2 0 004 0v-4a2 2 0 00-2-2z|M12 4a8 8 0 018 8|M4 12a8 8 0 018-8",
  alert:   "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z|M12 9v4|M12 17h.01",
  search:  "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  store:   "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
  help:    "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01",
};

function SectionLabel({ children }) {
  return <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 px-1">{children}</p>;
}

function SettingsCard({ children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700 shadow-card divide-y divide-slate-100 dark:divide-slate-700/80 mb-5">
      {children}
    </div>
  );
}

function Row({ icon, label, sub, onClick, right }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-[14px] text-left active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[15px] leading-snug text-slate-800 dark:text-slate-100">{label}</p>
        {sub && <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {right !== undefined ? right : (
        <Svg d="M9 18l6-6-6-6" size={16} color="#cbd5e1" />
      )}
    </button>
  );
}

function RowIcon({ d }) {
  return <Svg d={d} size={20} color="#64748b" />;
}

/* ═══════════════════════════════════════════════════════════════════
   STAT CARD (business portal style)
═══════════════════════════════════════════════════════════════════ */
function StatCard({ label, value, icon, iconBg, iconColor, sub, onClick, loading }) {
  return (
    <button onClick={onClick}
      className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50 text-left active:scale-95 transition-all duration-150 w-full">
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Svg d={icon} size={16} color={iconColor} sw={2.5} />
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-tight">{label}</span>
      </div>
      {loading
        ? <div className="h-6 w-20 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
        : <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{value}</p>
      }
      {sub && !loading && <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ACTION BUTTON (business portal style)
═══════════════════════════════════════════════════════════════════ */
function ActionBtn({ label, icon, bg, onClick }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-md ${bg}`}>
        <Svg d={icon} size={22} color="white" sw={2} />
      </div>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[60px]">{label}</span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TX ROW (business portal style)
═══════════════════════════════════════════════════════════════════ */
function TxRow({ t, onClick }) {
  const isIn   = t.type === "in";
  const failed = t.bill_status === "failed";
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 shadow-card border active:scale-[.98] transition-all text-left ${
        failed
          ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/50"
          : "bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700/50"
      }`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
        failed ? "bg-red-100 dark:bg-red-900/30" : isIn ? "bg-green-50 dark:bg-green-900/30" : "bg-red-50 dark:bg-red-900/30"
      }`}>
        <Svg d={isIn ? P.in : P.out} size={16} color={failed ? "#dc2626" : isIn ? "#16a34a" : "#ef4444"} sw={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{t.item_name || "Transaction"}</p>
          {failed && <span className="flex-shrink-0 text-[9px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-full">FAILED</span>}
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{t.category} · {t.payment_type}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-sm font-extrabold tabular ${failed ? "text-red-400 line-through" : isIn ? "text-green-600" : "text-red-500"}`}>
          {isIn ? "+" : "−"}{fmt(t.amount)}
        </p>
        {onClick && <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5">receipt →</p>}
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PIN SETUP MODAL (matches business portal Settings.jsx exactly)
═══════════════════════════════════════════════════════════════════ */
function PinSetupModal({ onDone, onClose }) {
  const [step,  setStep]  = useState(1);
  const [pin1,  setPin1]  = useState("");
  const [pin2,  setPin2]  = useState("");
  const [error, setError] = useState("");

  const active    = step === 1 ? pin1 : pin2;
  const setActive = step === 1 ? setPin1 : setPin2;

  const handleDigit = (d) => {
    if (active.length >= 4) return;
    const next = active + d;
    setActive(next);
    setError("");
    if (next.length === 4) {
      if (step === 1) {
        setTimeout(() => setStep(2), 250);
      } else {
        if (pin1 === next) { onDone(pin1); }
        else { setError("PINs don't match. Try again."); setPin2(""); setPin1(""); setTimeout(() => setStep(1), 800); }
      }
    }
  };

  const handleDel = () => { setActive(v => v.slice(0, -1)); setError(""); };

  return (
    <Modal title={step === 1 ? "Set App PIN" : "Confirm PIN"} onClose={onClose}>
      <div className="flex flex-col items-center gap-6 py-2">
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
          {step === 1 ? "Choose a 4-digit PIN to protect your app" : "Enter your PIN again to confirm"}
        </p>
        <div className="flex gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${active.length > i ? "bg-brand-500 border-brand-500 scale-110" : "border-slate-300 dark:border-slate-600"}`} />
          ))}
        </div>
        {error && <p className="text-xs text-red-500 font-semibold -mt-2">{error}</p>}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
          {[1,2,3,4,5,6,7,8,9].map(n => (
            <button key={n} onClick={() => handleDigit(String(n))}
              className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-lg font-bold transition active:scale-95">
              {n}
            </button>
          ))}
          <div />
          <button onClick={() => handleDigit("0")}
            className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-lg font-bold transition active:scale-95">
            0
          </button>
          <button onClick={handleDel}
            className="h-14 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center transition active:scale-95">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
              <line x1="18" y1="9" x2="13" y2="14" /><line x1="13" y1="9" x2="18" y2="14" />
            </svg>
          </button>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center px-4">
          Your PIN is stored securely on this device only
        </p>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOCK SCREEN
═══════════════════════════════════════════════════════════════════ */
function LockScreen({ lock }) {
  const [pin,    setPin]    = useState("");
  const [error,  setError]  = useState("");
  const [bioErr, setBioErr] = useState("");
  const [trying, setTrying] = useState(false);

  const handleDigit = async (d) => {
    if (trying) return;
    const next = pin + d;
    if (next.length > 4) return;
    setPin(next);
    setError("");
    if (next.length === 4) {
      setTrying(true);
      const ok = await lock.unlockWithPIN(next);
      if (!ok) { setError("Incorrect PIN"); setPin(""); }
      setTrying(false);
    }
  };

  const handleBio = async () => {
    setTrying(true); setBioErr("");
    const ok = await lock.unlockWithBiometric();
    if (!ok) setBioErr("Biometric failed. Use your PIN.");
    setTrying(false);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col items-center justify-center px-8">
      <div className="flex flex-col items-center gap-3 mb-10">
        <div className="w-16 h-16 rounded-2xl bg-brand-600/20 flex items-center justify-center">
          <Svg d={P.lock} size={32} color="#16a34a" sw={1.5} />
        </div>
        <p className="text-white font-extrabold text-xl">KudiAI Track</p>
        <p className="text-slate-400 text-sm">Enter your PIN to continue</p>
      </div>

      <div className="flex gap-4 mb-6">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${pin.length > i ? "bg-brand-500 border-brand-500 scale-110" : "border-slate-600"}`} />
        ))}
      </div>

      {(error || bioErr) && <p className="text-red-400 text-sm font-semibold mb-4">{error || bioErr}</p>}

      <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
        {[1,2,3,4,5,6,7,8,9].map(n => (
          <button key={n} onClick={() => handleDigit(String(n))} disabled={trying}
            className="h-14 rounded-2xl bg-slate-800 text-white text-xl font-bold transition active:scale-90 disabled:opacity-50">
            {n}
          </button>
        ))}
        <div />
        <button onClick={() => handleDigit("0")} disabled={trying}
          className="h-14 rounded-2xl bg-slate-800 text-white text-xl font-bold transition active:scale-90 disabled:opacity-50">
          0
        </button>
        <button onClick={() => { setPin(p => p.slice(0, -1)); setError(""); }}
          className="h-14 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center transition active:scale-90">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
            <line x1="18" y1="9" x2="13" y2="14" /><line x1="13" y1="9" x2="18" y2="14" />
          </svg>
        </button>
      </div>

      {lock.hasBiometric && (
        <button onClick={handleBio} disabled={trying}
          className="mt-6 flex items-center gap-2 text-brand-400 text-sm font-semibold active:opacity-70 transition">
          <Svg d={P.finger} size={18} color="#4ade80" />
          Use Fingerprint / Face ID
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SUPPORT TICKET MODAL (same as business portal)
═══════════════════════════════════════════════════════════════════ */
function SupportModal({ onClose, staffName, staffEmail }) {
  const [form, setForm]       = useState({ subject: "", description: "", type: "general", priority: "medium", user_name: staffName || "", user_email: staffEmail || "" });
  const [submitting, setSub]  = useState(false);
  const [done, setDone]       = useState(null);
  const [err, setErr]         = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.user_email.trim()) { setErr("Subject and email are required."); return; }
    setSub(true); setErr("");
    try {
      const res = await fetch(`${ADMIN_URL}/api/public/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source: "manager", submitter_type: "manager" }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Failed to submit ticket"); return; }
      setDone(d.ticket_no);
    } catch { setErr("Network error. Please try again."); }
    finally { setSub(false); }
  };

  return (
    <Modal title="Help & Support" onClose={onClose}>
      {done ? (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Svg d={P.check} size={24} color="#10b981" sw={2.5} />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800 dark:text-slate-100">Ticket Submitted!</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Your ticket number is <span className="font-bold text-brand-600 dark:text-brand-400">#{done}</span></p>
            <p className="text-xs text-slate-400 mt-2">Our team will respond to {form.user_email} shortly.</p>
          </div>
          <button onClick={onClose} className="mt-2 w-full py-3 bg-brand-600 text-white rounded-xl font-bold text-sm transition">Close</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[["Your Name","user_name","text","Your name"],["Email *","user_email","email","your@email.com"]].map(([l, k, t, ph]) => (
              <div key={k}>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{l}</label>
                <input type={t} placeholder={ph} value={form[k]} onChange={e => setForm(f => ({...f, [k]: e.target.value}))}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Category</label>
            <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none">
              {TICKET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Subject *</label>
            <input placeholder="Brief summary of your issue" value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))} required
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Description</label>
            <textarea placeholder="Describe the problem in detail…" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} rows={3}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none" />
          </div>
          {err && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2 rounded-xl">⚠ {err}</p>}
          <button type="submit" disabled={submitting}
            className="w-full py-3 bg-brand-600 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2">
            {submitting && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {submitting ? "Submitting…" : "Submit Ticket"}
          </button>
        </form>
      )}
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   FAQ
═══════════════════════════════════════════════════════════════════ */
const FAQS = [
  { q: "How do I record a sale?",           a: "Go to the Sales tab, then tap the + New Transaction button. Fill in the item, amount, category and payment type." },
  { q: "How do I use the mic to record?",   a: "On the Home tab, tap the green 'Mic Sale' button. Speak your transaction naturally — e.g. 'I sold 3 bags of rice for ₦4,500 cash'." },
  { q: "How do I view and share a receipt?",a: "In the Sales tab, tap any transaction row. A receipt appears with a Share button to send via any app." },
  { q: "How do I pay a bill?",              a: "On the Home tab tap a bill service shortcut, or go to Sales tab and select Bill Payments." },
  { q: "How do I generate my statement?",   a: "Go to Me → Activity Statement. Choose a period and tap Share Statement." },
  { q: "What is the PIN lock for?",         a: "The PIN locks the portal when you step away. Go to Me → Security to set it up." },
  { q: "Why can't I see some features?",    a: "Your manager controls your access. Contact them if you think something is missing." },
  { q: "How do I change my profile photo?", a: "Go to Me → Edit Profile, then tap the camera icon on your avatar." },
  { q: "What is KudiAI Assistant?",         a: "KudiAI Assistant (the ✨ button) is an AI that analyses your sales, credit, and Ajo data and gives you personalised advice." },
];

function FAQ() {
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-2">
      {FAQS.map((f, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 shadow-card overflow-hidden">
          <button onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-4 py-4 text-left gap-3">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1">{f.q}</span>
            <Svg d={open === i ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} size={16} color="#94a3b8" />
          </button>
          {open === i && <div className="px-4 pb-4"><p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.a}</p></div>}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HOME TAB
═══════════════════════════════════════════════════════════════════ */
function ManagerHome({ staff, store, inventory, plan, onGoTo, onVoiceOpen, onAddCash }) {
  const { transactions = [], credits = [], asoClients = [], loading } = store;
  const todayStr     = today();
  const todayTx      = transactions.filter(t => t.transaction_date === todayStr);
  const cashIn       = todayTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const cashOut      = todayTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit       = cashIn - cashOut;
  const totalCredit  = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const overdueCount = credits.filter(c => c.status === "overdue").length;
  const totalAso     = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const lowStock     = (inventory?.lowStock || []);

  const name = (staff?.full_name || "Staff").split(" ")[0];

  return (
    <div className="overflow-y-auto h-full px-4 pb-6 screen-enter">

      {/* Greeting */}
      <div className="pt-5 pb-2">
        <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">{greetingText()} 👋</p>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white leading-tight mt-0.5 truncate">{name}</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate()}</p>
      </div>

      {/* Alerts */}
      {overdueCount > 0 && (
        <button onClick={() => onGoTo("records", "credit")}
          className="w-full flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-2xl px-4 py-3 mb-4 active:scale-[.98] transition text-left">
          <Svg d={P.alert} size={18} color="#ef4444" />
          <p className="flex-1 text-sm font-semibold text-red-700 dark:text-red-400">{overdueCount} overdue credit{overdueCount > 1 ? "s" : ""} — tap to follow up</p>
          <Svg d="M9 18l6-6-6-6" size={16} color="#ef4444" />
        </button>
      )}
      {canDo(plan, "inventory") && lowStock.length > 0 && (
        <button onClick={() => onGoTo("stock")}
          className="w-full flex items-center gap-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/40 rounded-2xl px-4 py-3 mb-4 active:scale-[.98] transition text-left">
          <Svg d={P.alert} size={18} color="#f97316" />
          <p className="flex-1 text-sm font-semibold text-orange-700 dark:text-orange-400">{lowStock.length} item{lowStock.length > 1 ? "s" : ""} running low in stock</p>
          <Svg d="M9 18l6-6-6-6" size={16} color="#f97316" />
        </button>
      )}

      {/* Hero card */}
      <div className="rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero mb-5"
        style={{ background: "linear-gradient(145deg,#059669 0%,#047857 55%,#065f46 100%)" }}>
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Today's Profit</p>
          {loading
            ? <div className="h-12 w-44 bg-white/20 rounded-xl animate-pulse mt-2 mb-5" />
            : <p className={`text-4xl font-black tracking-tight mt-1.5 mb-5 tabular ${profit < 0 ? "text-red-300" : "text-white"}`}>{profit < 0 && "−"}{fmt(Math.abs(profit))}</p>
          }
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Cash In</p>
              <p className="text-base font-bold tabular">{loading ? "—" : fmt(cashIn)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Cash Out</p>
              <p className="text-base font-bold tabular">{loading ? "—" : fmt(cashOut)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Txns</p>
              <p className="text-base font-bold tabular">{loading ? "—" : todayTx.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Services + Mic (business portal style) */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50 mb-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Quick Services</p>
          <button onClick={() => onGoTo("sales", "bills")}
            className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
        </div>
        <div className="grid grid-cols-3 gap-y-5">
          {BILL_SERVICES.map(s => (
            <button key={s.id}
              onClick={() => s.isMic ? onVoiceOpen() : onGoTo("sales", "bills", s.id)}
              className="flex flex-col items-center gap-2 active:scale-90 transition-transform">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
                style={{ background: `linear-gradient(135deg,${s.g1},${s.g2})` }}>
                {s.isMic
                  ? <Svg d={P.mic} size={22} color="white" sw={2} />
                  : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {(s.icon || "").split("|").map((d, i) => <path key={i} d={d} />)}
                    </svg>
                }
              </div>
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards — all clickable to their tabs */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard label="Cash In"        value={fmt(cashIn)}      icon={P.in}     iconBg="bg-green-100 dark:bg-green-900/40"  iconColor="#16a34a" loading={loading} onClick={() => onGoTo("sales", "cash")} />
        <StatCard label="Cash Out"       value={fmt(cashOut)}     icon={P.out}    iconBg="bg-red-100 dark:bg-red-900/40"     iconColor="#ef4444" loading={loading} onClick={() => onGoTo("sales", "all")} />
        <StatCard label="Pending Credit" value={fmt(totalCredit)} icon={P.credit} iconBg="bg-amber-100 dark:bg-amber-900/40" iconColor="#d97706"
          sub={overdueCount > 0 ? `⚠ ${overdueCount} overdue` : `${credits.length} records`} loading={loading} onClick={() => onGoTo("records", "credit")} />
        {canDo(plan, "aso") && (
          <StatCard label="Ajo Balance" value={fmt(totalAso)} icon={P.bank} iconBg="bg-blue-100 dark:bg-blue-900/40" iconColor="#2563eb"
            sub={`${asoClients.length} clients`} loading={loading} onClick={() => onGoTo("records", "ajo")} />
        )}
      </div>

      {/* Quick Actions */}
      <div className="mb-5">
        <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Quick Actions</h2>
        <div className="grid grid-cols-3 gap-y-4 gap-x-2">
          <ActionBtn label="Cash In"   icon={P.in}     bg="bg-gradient-to-br from-green-500 to-emerald-600" onClick={() => onAddCash("in")} />
          <ActionBtn label="Cash Out"  icon={P.out}    bg="bg-gradient-to-br from-red-500 to-red-600"       onClick={() => onAddCash("out")} />
          <ActionBtn label="Pay Bills" icon={P.bills}  bg="bg-gradient-to-br from-cyan-500 to-teal-600"     onClick={() => onGoTo("sales", "bills")} />
          <ActionBtn label="Credit"    icon={P.credit} bg="bg-gradient-to-br from-amber-400 to-amber-500"   onClick={() => onGoTo("records", "credit")} />
          {canDo(plan, "aso") && (
            <ActionBtn label="Ajo" icon={P.bank} bg="bg-gradient-to-br from-blue-500 to-blue-600" onClick={() => onGoTo("records", "ajo")} />
          )}
          <ActionBtn label="Reports"   icon={P.report} bg="bg-gradient-to-br from-purple-500 to-violet-600" onClick={() => onGoTo("me", "reports")} />
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">Recent Transactions</h2>
          <button onClick={() => onGoTo("sales", "all")} className="text-[11px] font-bold text-brand-600 dark:text-brand-400">View all →</button>
        </div>
        {loading
          ? [1,2,3].map(i => <div key={i} className="h-[68px] bg-slate-100 dark:bg-slate-700/60 rounded-2xl animate-pulse mb-2" />)
          : transactions.slice(0, 5).length === 0
            ? <p className="text-center text-sm text-slate-400 py-8">No sales recorded yet</p>
            : transactions.slice(0, 5).map((t, i) => (
                <div key={t.id || i} className="mb-2">
                  <TxRow t={t} onClick={() => onGoTo("sales", "receipt", t)} />
                </div>
              ))
        }
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SALES TAB
═══════════════════════════════════════════════════════════════════ */
function ManagerSales({ store, staff, session, livePerms, initialSub, initialData, onVoiceOpen, inventory, onAddCash, plan }) {
  const [sub,        setSub]       = useState(initialSub || "cash");
  const [receipt,    setReceipt]   = useState(initialData);
  const [search,     setSearch]    = useState("");
  const [period,     setPeriod]    = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { transactions = [], loading } = store;
  const allowed = livePerms.filter(p => p.can_view).map(p => p.module);

  useEffect(() => { if (initialSub) setSub(initialSub); }, [initialSub]);
  useEffect(() => { if (initialData) setReceipt(initialData); }, [initialData]);
  useEffect(() => { setTypeFilter("all"); }, [sub]);

  const cutoff   = dateRange(period);
  const filtered = transactions.filter(t => {
    const inPeriod = !cutoff || t.transaction_date >= cutoff;
    const inSearch = !search || [t.item_name, t.customer_name, t.category].some(v => (v || "").toLowerCase().includes(search.toLowerCase()));
    return inPeriod && inSearch;
  });
  const cashOnly = filtered.filter(t => t.payment_type !== "bill_payment");
  const cashIn   = cashOnly.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const cashOut  = cashOnly.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);

  const allHistory = (() => {
    if (typeFilter === "in")    return filtered.filter(t => t.type === "in"  && t.payment_type !== "bill_payment");
    if (typeFilter === "out")   return filtered.filter(t => t.type === "out" && t.payment_type !== "bill_payment");
    if (typeFilter === "bills") return filtered.filter(t => t.payment_type === "bill_payment");
    return filtered;
  })();

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-3 pb-0">
        <div className="flex gap-1">
          {[["cash","Cash Sales"],["bills","Bill Payments"],["all","All History"]].map(([v, l]) => (
            <button key={v} onClick={() => setSub(v)}
              className={`px-4 py-2.5 text-[12px] font-bold transition-all border-b-2 ${sub === v ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400" : "border-transparent text-slate-400 dark:text-slate-500"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {sub === "bills" && (
        <div className="flex-1 overflow-hidden">
          {!allowed.includes("bills")
            ? <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                <p className="text-base font-bold text-slate-600 dark:text-slate-400">Bills not enabled</p>
                <p className="text-sm text-slate-400">Contact the business owner to enable bill payments.</p>
              </div>
            : <div className="h-full overflow-y-auto pb-4">
                <BillPayments
                  store={store}
                  plan={plan}
                  markup={1.098}
                  airtimeDiscount={0.01}
                  pointsEnabled
                  staffName={staff?.full_name}
                  staffEmail={session?.user?.email || staff?.email || ""}
                  businessName={staff?.business_name || store.profile?.business_name}
                />
              </div>
          }
        </div>
      )}

      {sub !== "bills" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 px-4 py-3 space-y-2 bg-slate-50 dark:bg-slate-900/50">
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Svg d={P.search} size={16} color="#94a3b8" />
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sales…"
                className="w-full h-10 pl-9 pr-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {[["all","All time"],["today","Today"],["week","7 Days"],["month","30 Days"]].map(([v, l]) => (
                <button key={v} onClick={() => setPeriod(v)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition ${period === v ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"}`}>
                  {l}
                </button>
              ))}
              <button onClick={onVoiceOpen}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-green-500 text-white">
                <Svg d={P.mic} size={12} color="white" />
                Mic Sale
              </button>
            </div>
            {sub === "all" && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {[["all","All"],["in","Cash In"],["out","Cash Out"],["bills","Bills"]].map(([v, l]) => (
                  <button key={v} onClick={() => setTypeFilter(v)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition ${typeFilter === v ? "bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900" : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"}`}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            {/* Cash In / Cash Out add buttons */}
            <div className="flex gap-2">
              <button onClick={() => onAddCash("in")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-600 text-white text-xs font-bold active:scale-[0.97] transition">
                <Svg d="M12 5v14|M5 12h14" size={14} color="white" sw={2.5} />
                Cash In
              </button>
              <button onClick={() => onAddCash("out")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-500 text-white text-xs font-bold active:scale-[0.97] transition">
                <Svg d="M5 12h14" size={14} color="white" sw={2.5} />
                Cash Out
              </button>
            </div>
          </div>
          <div className="flex-shrink-0 grid grid-cols-3 gap-px bg-slate-100 dark:bg-slate-700/50 border-y border-slate-100 dark:border-slate-700/50">
            {[["Cash In", fmt(cashIn), "text-green-600"],["Cash Out", fmt(cashOut), "text-red-500"],["Count", (sub === "cash" ? cashOnly : allHistory).length + " txns", "text-slate-700 dark:text-slate-200"]].map(([l, v, c]) => (
              <div key={l} className="bg-white dark:bg-slate-800 px-3 py-2.5 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{l}</p>
                <p className={`text-sm font-extrabold tabular mt-0.5 ${c}`}>{v}</p>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-4">
            {loading ? [1,2,3,4].map(i => <div key={i} className="h-[72px] bg-slate-100 dark:bg-slate-700/60 rounded-2xl animate-pulse" />) :
             (sub === "cash" ? cashOnly : allHistory).length === 0
              ? <p className="text-center text-sm text-slate-400 py-12">No transactions found</p>
              : (sub === "cash" ? cashOnly : allHistory).map((t, i) => (
                  <TxRow key={t.id || i} t={t} onClick={() => setReceipt(t)} />
                ))
            }
          </div>
        </div>
      )}

      {receipt && (
        <TransactionReceipt txn={receipt} profile={store.profile || { business_name: staff?.business_name }} onClose={() => setReceipt(null)} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   RECORDS TAB
═══════════════════════════════════════════════════════════════════ */
function ManagerRecords({ store, staff, livePerms, initialSub, plan }) {
  const ajoOnPlan = canDo(plan, "aso");
  const [sub, setSub] = useState(initialSub || "credit");
  useEffect(() => { if (initialSub) setSub(initialSub); }, [initialSub]);
  const allowed = livePerms.filter(p => p.can_view).map(p => p.module);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-3 pb-0">
        <div className="flex gap-1">
          {[
            ["credit","Credit", true],
            ["ajo","Ajo", ajoOnPlan],
          ].filter(([,, show]) => show).map(([v, l]) => (
            <button key={v} onClick={() => setSub(v)}
              className={`px-6 py-2.5 text-[12px] font-bold transition-all border-b-2 ${sub === v ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400" : "border-transparent text-slate-400 dark:text-slate-500"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {sub === "credit" && (
          allowed.includes("credit")
            ? <div className="h-full overflow-y-auto pb-4"><Credit store={store} plan="starter" /></div>
            : <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                <p className="text-base font-bold text-slate-600 dark:text-slate-400">Credit not enabled</p>
                <p className="text-sm text-slate-400">Contact the business owner to enable the credit module.</p>
              </div>
        )}
        {sub === "ajo" && !ajoOnPlan && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <p className="text-base font-bold text-slate-600 dark:text-slate-400">Plan upgrade required</p>
            <p className="text-sm text-slate-400">Ajo / Savings management requires the Basic plan or higher. Ask the business owner to upgrade.</p>
          </div>
        )}
        {sub === "ajo" && ajoOnPlan && (
          <div className="h-full overflow-y-auto pb-4"><Aso store={store} plan={plan} staffId={staff?.id} /></div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STOCK TAB
═══════════════════════════════════════════════════════════════════ */
function ManagerStock({ inventory, staff, livePerms, plan }) {
  const planAllows = canDo(plan, "inventory");
  const allowed    = livePerms.filter(p => p.can_view).map(p => p.module);
  const canView    = planAllows && allowed.includes("inventory");
  const canAdd     = planAllows && (livePerms.find(p => p.module === "inventory")?.can_create || false);

  if (!planAllows) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
        <p className="text-base font-bold text-slate-600 dark:text-slate-400">Plan upgrade required</p>
        <p className="text-sm text-slate-400">Inventory management requires the Basic plan or higher. Ask the business owner to upgrade.</p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
        <p className="text-base font-bold text-slate-600 dark:text-slate-400">Stock access not enabled</p>
        <p className="text-sm text-slate-400">Your manager hasn't enabled inventory for your account.</p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-hidden">
      <Inventory inventory={inventory} isOwner={false} canAdd={canAdd} plan={plan || "starter"} staffBranchId={staff?.branch_id || null} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ME TAB
═══════════════════════════════════════════════════════════════════ */
function ManagerMe({ staff, session, store, inventory, livePerms, staffId, lock, plan, initialView, onStaffUpdate }) {
  const [view,          setView]          = useState(initialView || "menu");
  const [isDark,        setIsDark]        = useState(() => localStorage.getItem("kuditrack_dark") === "1");
  const [editForm,      setEditForm]      = useState({ full_name: staff?.full_name || "", phone: staff?.phone || "" });
  const [photoFile,     setPhotoFile]     = useState(null);
  const [photoPreview,  setPhotoPreview]  = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [saveMsg,       setSaveMsg]       = useState("");
  const [showPinSetup,  setShowPinSetup]  = useState(false);
  const [showSupport,   setShowSupport]   = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const [showReports,   setShowReports]   = useState(false);
  const [lockBusy,      setLockBusy]      = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { if (initialView) setView(initialView); }, [initialView]);

  const initials = (staff?.full_name || "S").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("kuditrack_dark", next ? "1" : "0");
    document.documentElement.classList.toggle("dark", next);
  };

  const saveProfile = async () => {
    setSaving(true); setSaveMsg("");
    try {
      let photoUrl = staff?.profile_image_url;
      if (photoFile) photoUrl = await uploadAvatar(photoFile, staffId);
      await supabase.from("staff").update({ full_name: editForm.full_name, phone: editForm.phone, profile_image_url: photoUrl }).eq("id", staffId);
      setPhotoFile(null);
      setPhotoPreview(null);
      onStaffUpdate?.({ full_name: editForm.full_name, phone: editForm.phone, profile_image_url: photoUrl });
      setSaveMsg("Profile saved!");
      setTimeout(() => { setSaveMsg(""); setView("menu"); }, 1500);
    } catch { setSaveMsg("Save failed. Please try again."); }
    setSaving(false);
  };

  const SubHeader = ({ title }) => (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0 bg-white dark:bg-slate-900">
      <button onClick={() => setView("menu")} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
        <Svg d={P.back} size={18} color="#64748b" />
      </button>
      <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
    </div>
  );

  /* Reports sub-view */
  if (view === "reports") return (
    <div className="h-full flex flex-col">
      {showReports && (
        <StaffReports
          store={store}
          inventory={inventory}
          staffName={staff?.full_name}
          businessName={staff?.business_name || store.profile?.business_name}
          onClose={() => setShowReports(false)}
        />
      )}
      <SubHeader title="Reports & Insights" />
      <div className="flex-1 overflow-y-auto pb-4">
        <Insights
          store={store}
          inventory={inventory}
          plan={plan || "starter"}
          onUpgrade={null}
          onReports={() => setShowReports(true)}
        />
      </div>
    </div>
  );

  /* Edit profile sub-view */
  if (view === "edit") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Edit Profile" />
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 pb-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl bg-brand-600 flex items-center justify-center shadow-lg overflow-hidden">
              {photoPreview ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                : staff?.profile_image_url ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
                : <span className="text-2xl font-black text-white">{initials}</span>}
            </div>
            <button onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-brand-600 border-2 border-white dark:border-slate-900 flex items-center justify-center shadow-md active:scale-90 transition">
              <Svg d={P.cam} size={15} color="#fff" />
            </button>
          </div>
          <p className="text-[12px] text-slate-400">Tap camera to change photo</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (!f) return; setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); }} />
        </div>
        <div className="space-y-3">
          {[["Full Name","full_name","text"],["Phone","phone","tel"]].map(([l, k, t]) => (
            <div key={k}>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{l}</p>
              <input type={t} value={editForm[k]} onChange={e => setEditForm(p => ({...p, [k]: e.target.value}))}
                className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
          ))}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Email</p>
            <input disabled value={staff?.email || session?.user?.email || "—"}
              className="w-full h-12 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 text-sm text-slate-400 cursor-not-allowed" />
          </div>
        </div>
        {saveMsg && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${saveMsg.includes("saved") ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/30 text-red-600"}`}>
            <Svg d={saveMsg.includes("saved") ? P.check : P.alert} size={16} color="currentColor" />
            <p className="text-sm font-semibold">{saveMsg}</p>
          </div>
        )}
        <button onClick={saveProfile} disabled={saving}
          className="w-full h-12 rounded-2xl bg-brand-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50">
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );

  /* Main Me menu */
  const Toggle2 = (
    <button onClick={e => { e.stopPropagation(); toggleDark(); }}
      className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${isDark ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
      <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
        style={{ left: isDark ? "calc(100% - 22px)" : "2px" }} />
    </button>
  );

  return (
    <div className="h-full overflow-y-auto pb-4">
      {/* Profile card */}
      <div className="mx-4 mt-5 mb-5">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-card border border-slate-100 dark:border-slate-700/50 p-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center shadow-lg flex-shrink-0 overflow-hidden">
            {staff?.profile_image_url
              ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
              : <span className="text-xl font-black text-white">{initials}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 truncate">{staff?.full_name || "Staff"}</p>
            <p className="text-[12px] font-bold text-brand-600 dark:text-brand-400 capitalize mt-0.5">{staff?.role || "Manager"}</p>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{staff?.business_name || "—"}</p>
          </div>
          <button onClick={() => setView("edit")}
            className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center active:scale-90 transition flex-shrink-0">
            <Svg d={P.pen} size={16} color="#16a34a" />
          </button>
        </div>
      </div>

      {/* Account */}
      <div className="px-4 mb-5">
        <SectionLabel>Account</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.person} />} label="Edit Profile" sub="Update your name, phone, and photo" onClick={() => setView("edit")} />
          <Row icon={<RowIcon d={P.report} />} label="Reports & Insights" sub="View your performance analytics" onClick={() => setView("reports")} />
          <Row icon={<RowIcon d={P.doc} />}    label="Activity Statement" sub="Generate & share your statement" onClick={() => setShowStatement(true)} />
        </SettingsCard>
      </div>

      {/* Security */}
      <div className="px-4 mb-5">
        <SectionLabel>Security</SectionLabel>
        <SettingsCard>
          <Row
            icon={<RowIcon d={P.lock} />}
            label="App Lock"
            sub={lock.enabled ? (lock.hasBiometric ? "Locked · Fingerprint / Face + PIN" : "Locked · PIN only") : lock.hasPIN ? "PIN set but lock is off" : "Protect app when you leave"}
            onClick={async () => {
              if (lock.enabled) { lock.disableLock(); }
              else if (lock.hasPIN) { setLockBusy(true); await lock.enableLock(); setLockBusy(false); }
              else { setShowPinSetup(true); }
            }}
            right={
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (lock.enabled) { lock.disableLock(); }
                  else if (lock.hasPIN) { setLockBusy(true); await lock.enableLock(); setLockBusy(false); }
                  else { setShowPinSetup(true); }
                }}
                className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${lock.enabled ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
                {lockBusy
                  ? <span className="absolute inset-0 flex items-center justify-center"><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /></span>
                  : <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200" style={{ left: lock.enabled ? "calc(100% - 22px)" : "2px" }} />
                }
              </button>
            }
          />
          <Row
            icon={<RowIcon d={P.shield} />}
            label={lock.hasPIN ? "Change PIN" : "Set PIN"}
            sub={lock.hasPIN ? (lock.hasBiometric ? "Biometric registered · tap to change PIN" : "Change your 4-digit unlock PIN") : "Set a 4-digit PIN to enable App Lock"}
            onClick={() => setShowPinSetup(true)}
          />
        </SettingsCard>
      </div>

      {/* Preferences */}
      <div className="px-4 mb-5">
        <SectionLabel>Preferences</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={isDark ? P.moon : P.sun} />} label="Dark Mode" onClick={toggleDark} right={Toggle2} />
        </SettingsCard>
      </div>

      {/* Help & Support */}
      <div className="px-4 mb-5">
        <SectionLabel>Help & Support</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.faq} />}    label="Frequently Asked Questions" sub="Browse common questions" onClick={() => setView("faq")} />
          <Row icon={<RowIcon d={P.help} />}   label="Contact Support"           sub="Submit a support ticket"  onClick={() => setShowSupport(true)} />
        </SettingsCard>
      </div>

      {/* Sign Out */}
      <div className="px-4 mb-4">
        <button onClick={() => supabase.auth.signOut()}
          className="w-full py-[15px] bg-red-50 dark:bg-red-950/30 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-900/40 active:bg-red-100 disabled:opacity-60 transition-colors flex items-center justify-center gap-2.5 text-red-500 dark:text-red-400">
          <Svg d={P.out2} size={18} color="currentColor" />
          Sign Out
        </button>
      </div>

      {/* Footer */}
      <div className="text-center py-4 px-8 space-y-1">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">KudiAI Track · Manager Portal</p>
        <p className="text-[10px] text-slate-300 dark:text-slate-600">Powered by AMAYA & Co. Technologies<br />All rights reserved © {YEAR}</p>
      </div>

      {/* FAQ inline view */}
      {view === "faq" && (
        <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-900 flex flex-col">
          <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-900">
            <button onClick={() => setView("menu")} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
              <Svg d={P.back} size={18} color="#64748b" />
            </button>
            <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">Frequently Asked Questions</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 pb-6"><FAQ /></div>
        </div>
      )}

      {/* Modals */}
      {showPinSetup && (
        <PinSetupModal onClose={() => setShowPinSetup(false)} onDone={async (pin) => {
          setShowPinSetup(false);
          await lock.setupPIN(pin);
          setLockBusy(true);
          await lock.enableLock();
          setLockBusy(false);
        }} />
      )}
      {showSupport && <SupportModal onClose={() => setShowSupport(false)} staffName={staff?.full_name} staffEmail={staff?.email || session?.user?.email || ""} />}
      {showStatement && <StaffActivityStatement store={store} staffName={staff?.full_name} businessName={staff?.business_name || store.profile?.business_name} onClose={() => setShowStatement(false)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN STAFF DASHBOARD
═══════════════════════════════════════════════════════════════════ */
export default function ManagerDashboard({ session, staff: staffProp }) {
  const [staffPatch, setStaffPatch] = useState({});
  const staff = useMemo(() => ({ ...staffProp, ...staffPatch }), [staffProp, staffPatch]);
  const [tab,        setTab]       = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "sales";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "sales";
    return "home";
  });
  const [subNav,     setSubNav]    = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "bills";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "bills";
    return null;
  });
  const [subData,    setSubData]   = useState(null);
  const [livePerms,  setLivePerms] = useState(staff?.staff_permissions || []);
  const [voiceOpen,  setVoiceOpen] = useState(false);
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [addTxnType, setAddTxnType] = useState("in");
  const openAddTxn = useCallback((type) => { setAddTxnType(type); setShowAddTxn(true); }, []);

  const staffId  = staff?.id;
  const ownerId  = staff?.owner_id;

  const notif    = useNotifications(staffId);
  const { addNotification } = notif;

  const store     = useStore(ownerId, staffId, staff?.full_name, addNotification);
  const inventory = useInventory(ownerId, staffId, addNotification, staff?.branch_id || null);
  const lock      = useBiometricLock(staffId);

  // Fetch the business owner's active subscription plan.
  // Uses a SECURITY DEFINER RPC so the staff member's JWT can read the
  // owner's subscription row (direct SELECT is blocked by RLS).
  // Realtime re-fetches when the owner's subscription row changes
  // (the migration also adds an RLS policy that allows staff to subscribe).
  const [ownerPlan, setOwnerPlan] = useState("starter");

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;

    async function fetchOwnerPlan() {
      const { data } = await supabase.rpc("get_owner_plan");
      if (!cancelled) setOwnerPlan(normalizeSlug(data || "starter"));
    }

    fetchOwnerPlan();

    // Live-update when the owner upgrades/changes plan
    const ch = supabase
      .channel(`owner_sub_${ownerId}`)
      .on("postgres_changes", {
        event: "*", schema: "public",
        table: "subscriptions",
        filter: `user_id=eq.${ownerId}`,
      }, fetchOwnerPlan)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [ownerId]);

  const plan = ownerPlan;

  // Dark mode bootstrap
  useEffect(() => {
    document.documentElement.classList.toggle("dark", localStorage.getItem("kuditrack_dark") === "1");
  }, []);

  // Permission refresh (broadcast + poll + focus + visibility)
  const fetchPerms = useCallback(async () => {
    if (!staffId) return;
    const { data } = await supabase.from("staff_permissions").select("*").eq("staff_id", staffId);
    if (data) setLivePerms(data);
  }, [staffId]);

  useEffect(() => {
    if (!ownerId || !staffId) return;
    const ch = supabase.channel(`perms_${ownerId}`);
    ch.on("broadcast", { event: "permissions_changed" }, ({ payload }) => {
      if (payload?.staffId === staffId) fetchPerms();
    }).subscribe();
    const poll      = setInterval(fetchPerms, 8000);
    const onVisible = () => { if (document.visibilityState === "visible") fetchPerms(); };
    window.addEventListener("focus", fetchPerms);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
      window.removeEventListener("focus", fetchPerms);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ownerId, staffId, fetchPerms]);

  // Voice: save parsed transaction
  const handleVoiceSave = useCallback(async (parsed) => {
    if (!parsed || !ownerId) return;
    await supabase.from("transactions").insert({
      owner_id:         ownerId,
      staff_id:         staffId,
      staff_name:       staff?.full_name || null,
      type:             parsed.type,
      amount:           parsed.amount,
      item_name:        parsed.item_name,
      category:         parsed.category,
      payment_type:     parsed.payment_type,
      customer_name:    parsed.customer_name || null,
      note:             parsed.note || null,
      quantity:         parsed.quantity || 1,
      transaction_date: parsed.transaction_date || today(),
    });
  }, [ownerId, staffId, staff]);

  // Nav badges
  const todayStr  = today();
  const overdueCr = (store.credits || []).filter(c => c.status !== "paid" && c.due_date && c.due_date < todayStr).length;
  const lowStk    = (inventory?.lowStock || []).length;
  const badge = (id) => {
    if (id === "records" && overdueCr > 0) return overdueCr;
    if (id === "stock"   && lowStk   > 0) return lowStk;
    return 0;
  };

  const goTo = useCallback((t, sub = null, data = null) => {
    setTab(t); setSubNav(sub); setSubData(data);
  }, []);

  const avatarInitial = (staff?.full_name || "S")[0].toUpperCase();

  function renderContent() {
    switch (tab) {
      case "home":    return <ManagerHome    staff={staff} store={store} inventory={inventory} plan={plan} onGoTo={goTo} onVoiceOpen={() => setVoiceOpen(true)} onAddCash={openAddTxn} />;
      case "sales":   return <ManagerSales   store={store} staff={staff} session={session} livePerms={livePerms} initialSub={subNav} initialData={subData} onVoiceOpen={() => setVoiceOpen(true)} inventory={inventory} onAddCash={openAddTxn} plan={plan} />;
      case "records": return <ManagerRecords store={store} staff={staff} livePerms={livePerms} initialSub={subNav} plan={plan} />;
      case "stock":   return <ManagerStock   inventory={inventory} staff={staff} livePerms={livePerms} plan={plan} />;
      case "me":      return <ManagerMe      staff={staff} session={session} store={store} inventory={inventory} livePerms={livePerms} staffId={staffId} lock={lock} plan={plan} initialView={subNav} onStaffUpdate={p => setStaffPatch(prev => ({ ...prev, ...p }))} />;
      default:        setTab("home"); return null;
    }
  }

  return (
    <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative">

        {/* Lock screen */}
        {lock.locked && <LockScreen lock={lock} />}

        {/* Header */}
        <header className="flex-none z-30 h-14 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
          <AppLogo className="h-8 w-8" />
          <div className="flex items-baseline gap-0.5 select-none">
            <span className="text-[17px] font-black tracking-tight text-slate-800 dark:text-white leading-none">Kudi</span>
            <span className="text-[17px] font-black tracking-tight leading-none"
              style={{ background: "linear-gradient(135deg,#16a34a,#059669)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase leading-none ml-1">Track</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell unreadCount={notif.unreadCount} onClick={() => notif.setOpen(true)} />
            <button onClick={() => goTo("me")}
              className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center border-2 border-slate-100 dark:border-slate-700 shadow-sm active:scale-90 transition-transform overflow-hidden">
              {staff?.profile_image_url
                ? <img src={staff.profile_image_url} alt="" className="w-9 h-9 object-cover" />
                : <span className="text-sm font-black text-white">{avatarInitial}</span>}
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {renderContent()}
        </main>

        {/* Bottom nav */}
        <nav className="flex-none z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float">
          <div className="flex items-stretch h-[60px]">
            {NAV.map(n => {
              const active = tab === n.id;
              const cnt    = badge(n.id);
              return (
                <button key={n.id} onClick={() => { setTab(n.id); setSubNav(null); setSubData(null); }}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative focus-visible:outline-none">
                  {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
                  <div className={`relative transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                    <Icon name={n.icon} size={21} className={active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"} />
                    {cnt > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center leading-none">
                        {cnt > 9 ? "9+" : cnt}
                      </span>
                    )}
                  </div>
                  <span className={`text-[8px] font-bold uppercase tracking-wide leading-none ${active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>
                    {n.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} className="bg-white dark:bg-slate-900" />
        </nav>

        {/* Add Transaction Modal (dashboard-level so it escapes overflow:hidden on <main>) */}
        {showAddTxn && (
          <AddTxnModal
            defaultType={addTxnType}
            onAdd={store.addTransaction}
            onClose={() => setShowAddTxn(false)}
            inventory={inventory}
          />
        )}

        {/* Floating KudiAI Chat Widget */}
        <AIChatWidget store={store} inventory={inventory} branches={[]} />

        {/* Voice Modal */}
        {voiceOpen && (
          <VoiceModal onClose={() => setVoiceOpen(false)} onSave={handleVoiceSave} />
        )}

        {/* Notification Center */}
        <NotificationCenter notif={notif} />

      </div>
    </div>
  );
}
