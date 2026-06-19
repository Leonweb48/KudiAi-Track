import { useState, useEffect, useCallback, useRef } from "react";
import { supabase }      from "../utils/supabase";
import { useStore }      from "../hooks/useStore";
import { useInventory }  from "../hooks/useInventory";
import { fmt, today }    from "../utils/helpers";
import { buildContext }  from "../utils/buildContext";
import AppLogo           from "../components/AppLogo";
import Icon              from "../components/Icon";
import BillPayments      from "./BillPayments";
import Credit            from "./Credit";
import Aso               from "./Aso";
import Inventory         from "./Inventory";

/* ════════════════════════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════════════════════════ */
const CHAT_URL = "https://admin.kudiai.app/api/public/chat";
const SECRET   = "kuditrack-email-trigger-2026-amaya";
const YEAR     = new Date().getFullYear();

const NAV = [
  { id: "home",    icon: "home",      label: "Home"    },
  { id: "sales",   icon: "txn",       label: "Sales"   },
  { id: "records", icon: "credit",    label: "Records" },
  { id: "stock",   icon: "inventory", label: "Stock"   },
  { id: "me",      icon: "user",      label: "Me"      },
];

/* ════════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════════ */
function greet() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function fmtDate() {
  return new Date().toLocaleDateString("en-NG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
function dateRange(period) {
  const now = new Date();
  if (period === "today")  return today();
  if (period === "week")   { const d = new Date(now); d.setDate(d.getDate() - 7);  return d.toISOString().split("T")[0]; }
  if (period === "month")  { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0]; }
  return null;
}
async function uploadAvatar(file, staffId) {
  const ext  = file.name.split(".").pop();
  const path = `staff/${staffId}/avatar.${ext}`;
  await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

/* ════════════════════════════════════════════════════════════════════
   MICRO-COMPONENTS
════════════════════════════════════════════════════════════════════ */
function Svg({ d, size = 18, color = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
const IC = {
  in:     "M12 19V5|M5 12l7-7 7 7",
  out:    "M12 5v14|M19 12l-7 7-7-7",
  up:     "M18 15l-6-6-6 6",
  dn:     "M6 9l6 6 6-6",
  x:      "M18 6L6 18|M6 6l12 12",
  back:   "M19 12H5|M12 19l-7-7 7-7",
  check:  "M20 6L9 17l-5-5",
  copy:   "M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.91 4.895 3 6 3h8c1.105 0 2 .911 2 2.036v1.866m-6 .17h8c1.105 0 2 .91 2 2.035v10.857C20 21.09 19.105 22 18 22h-8c-1.105 0-2-.911-2-2.036V9.107c0-1.124.895-2.036 2-2.036z",
  share:  "M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8|M16 6l-4-4-4 4|M12 2v13",
  receipt:"M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  bills:  "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2",
  lock:   "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z|M7 11V7a5 5 0 0110 0v4",
  unlock: "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z|M7 11V7a5 5 0 019.9-1",
  cam:    "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z|M12 17a4 4 0 100-8 4 4 0 000 8",
  pen:    "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7|M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  doc:    "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8|M10 9H8",
  bot:    "M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h4a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2h4V5.73A2 2 0 0110 4a2 2 0 012-2z|M9 12a1 1 0 100 2 1 1 0 000-2z|M15 12a1 1 0 100 2 1 1 0 000-2z",
  send:   "M22 2L11 13|M22 2L15 22 11 13 2 9l20-7z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  phone:  "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.34 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z",
  mail:   "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z|M22 6l-10 7L2 6",
  alert:  "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z|M12 9v4|M12 17h.01",
  out2:   "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4|M16 17l5-5-5-5|M21 12H9",
  moon:   "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  sun:    "M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42|M12 5a7 7 0 100 14A7 7 0 0012 5z",
  faq:    "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3|M12 17h.01",
  plus:   "M12 5v14|M5 12h14",
  filter: "M22 3H2l8 9.46V19l4 2V12.46L22 3z",
  store:  "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
  aso:    "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 6v6l4 2",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
};

function Skel({ className = "" }) {
  return <div className={`bg-slate-100 dark:bg-slate-700/60 rounded-xl animate-pulse ${className}`} />;
}

function Pill({ label, color = "slate" }) {
  const c = { green:"bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400", orange:"bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400", slate:"bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400", red:"bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400", blue:"bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" };
  return <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${c[color]}`}>{label}</span>;
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        <Svg d={IC[icon]} size={15} color="#64748b" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

function Card({ children, className = "" }) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-card border border-slate-100 dark:border-slate-700/50 ${className}`}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1 mb-2">{children}</p>;
}

/* ════════════════════════════════════════════════════════════════════
   PIN LOCK
════════════════════════════════════════════════════════════════════ */
function PinPad({ title, sub, value, onChange, onSubmit, error, submitLabel = "Confirm" }) {
  const digits = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return (
    <div className="flex flex-col items-center gap-6 pt-4">
      <div className="text-center">
        <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
        {sub && <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
      </div>
      <div className="flex gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${value.length > i ? "bg-brand-600 border-brand-600 scale-110" : "border-slate-300 dark:border-slate-600"}`} />
        ))}
      </div>
      {error && <p className="text-sm text-red-500 font-semibold -mt-2">{error}</p>}
      <div className="grid grid-cols-3 gap-3 w-64">
        {digits.map((d, i) => (
          d === "" ? <div key={i} /> :
          <button key={i}
            onClick={() => {
              if (d === "⌫") { onChange(v => v.slice(0, -1)); return; }
              if (value.length >= 4) return;
              const next = value + d;
              onChange(next);
              if (next.length === 4) setTimeout(() => onSubmit(next), 120);
            }}
            className={`h-14 rounded-2xl text-xl font-bold transition-all active:scale-90 ${d === "⌫" ? "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300" : "bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/50 text-slate-800 dark:text-slate-100"}`}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

function StaffPinLock({ staffId, onUnlock }) {
  const PIN_KEY = `kudi_pin_${staffId}`;
  const stored  = localStorage.getItem(PIN_KEY);
  const [step,  setStep]  = useState(stored ? "enter" : "set1"); // set1 | set2 | enter
  const [pin1,  setPin1]  = useState("");
  const [pin2,  setPin2]  = useState("");
  const [input, setInput] = useState("");
  const [err,   setErr]   = useState("");

  const handleSet1 = (v) => { if (v.length === 4) { setPin1(v); setStep("set2"); setPin2(""); setErr(""); } };
  const handleSet2 = (v) => {
    if (v.length === 4) {
      if (v !== pin1) { setErr("PINs don't match. Try again."); setPin2(""); setStep("set1"); setPin1(""); }
      else { localStorage.setItem(PIN_KEY, v); onUnlock(); }
    }
  };
  const handleEnter = (v) => {
    if (v.length === 4) {
      if (v === stored) { setErr(""); onUnlock(); }
      else { setErr("Incorrect PIN"); setInput(""); }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/95 backdrop-blur-sm flex flex-col items-center justify-center px-8">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-brand-600/20 flex items-center justify-center">
          <Svg d={IC.shield} size={32} color="#16a34a" sw={1.5} />
        </div>
        <p className="text-white font-extrabold text-xl">KudiAI Track</p>
        <p className="text-slate-400 text-sm">Staff Portal · Secured by AMAYA</p>
      </div>
      {step === "set1" && (
        <PinPad title="Create your PIN" sub="Choose a 4-digit PIN to protect your account"
          value={pin1} onChange={setPin1} onSubmit={handleSet1} error={err} />
      )}
      {step === "set2" && (
        <PinPad title="Confirm your PIN" sub="Enter the same PIN again to confirm"
          value={pin2} onChange={setPin2} onSubmit={handleSet2} error={err} />
      )}
      {step === "enter" && (
        <PinPad title="Enter your PIN" sub="Unlock your staff portal"
          value={input} onChange={setInput} onSubmit={handleEnter} error={err} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   RECEIPT MODAL
════════════════════════════════════════════════════════════════════ */
function ReceiptModal({ txn, staffName, businessName, onClose }) {
  const isIn     = txn.type === "in";
  const receiptNo = `RCP-${txn.id?.toString().slice(0, 8).toUpperCase() || "00000000"}`;
  const [copied, setCopied] = useState(false);

  const receiptText = [
    "═══════════════════════════",
    `       ${businessName || "Business"}`,
    "═══════════════════════════",
    `Receipt: ${receiptNo}`,
    `Date:    ${txn.transaction_date || "—"}`,
    `Staff:   ${staffName || "—"}`,
    "───────────────────────────",
    `Item:    ${txn.item_name || "Transaction"}`,
    `Type:    ${isIn ? "Cash In (Sale)" : "Cash Out"}`,
    `Payment: ${txn.payment_type || "—"}`,
    txn.category ? `Category: ${txn.category}` : "",
    txn.customer_name ? `Customer: ${txn.customer_name}` : "",
    "───────────────────────────",
    `AMOUNT: ₦${Number(txn.amount).toLocaleString("en-NG")}`,
    "═══════════════════════════",
    "  Powered by AMAYA & Co.",
    "   Technologies Ltd",
  ].filter(Boolean).join("\n");

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Receipt ${receiptNo}`, text: receiptText }); } catch { /* dismissed */ }
    } else {
      await navigator.clipboard.writeText(receiptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`px-6 py-5 flex items-center justify-between ${isIn ? "bg-green-500" : "bg-red-500"}`}>
          <div>
            <p className="text-white/70 text-[11px] font-bold uppercase tracking-widest">Receipt</p>
            <p className="text-white font-black text-xl mt-0.5">{fmt(txn.amount)}</p>
            <p className="text-white/80 text-[11px] mt-0.5">{isIn ? "Cash In · Sale" : "Cash Out"}</p>
          </div>
          <div className="text-right">
            <p className="text-white font-bold text-sm">{receiptNo}</p>
            <p className="text-white/70 text-xs mt-0.5">{txn.transaction_date}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          {[
            ["Item",     txn.item_name || "Transaction"],
            ["Category", txn.category],
            ["Payment",  txn.payment_type],
            ["Customer", txn.customer_name],
            ["Staff",    staffName],
            ["Business", businessName],
          ].filter(([,v]) => v).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{k}</span>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 max-w-[55%] text-right truncate">{v}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={share}
            className="flex-1 h-12 rounded-2xl bg-brand-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition">
            <Svg d={copied ? IC.check : IC.share} size={16} color="#fff" />
            {copied ? "Copied!" : "Share Receipt"}
          </button>
          <button onClick={onClose}
            className="h-12 px-5 rounded-2xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 font-bold text-sm active:scale-95 transition bg-white dark:bg-slate-800">
            Close
          </button>
        </div>

        <div className="text-center pb-4">
          <p className="text-[10px] text-slate-300 dark:text-slate-600">Powered by AMAYA & Co. Technologies</p>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   STATEMENT MODAL
════════════════════════════════════════════════════════════════════ */
function StatementModal({ store, staffName, businessName, onClose }) {
  const [period,  setPeriod]  = useState("month");
  const [copied,  setCopied]  = useState(false);
  const { transactions = [], credits = [], asoClients = [] } = store;

  const cutoff = dateRange(period);
  const txns   = cutoff ? transactions.filter(t => t.transaction_date >= cutoff) : transactions;
  const cashIn  = txns.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const cashOut = txns.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit  = cashIn - cashOut;

  const openCr = credits.filter(c => c.status !== "paid");
  const crAmt  = openCr.reduce((s, c) => s + (c.outstanding || 0), 0);
  const ajoBal = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);

  const periodLabel = { today:"Today", week:"Last 7 Days", month:"Last 30 Days", all:"All Time" }[period];

  const statementText = [
    "═══════════════════════════════════",
    "       STAFF ACTIVITY STATEMENT",
    "═══════════════════════════════════",
    `Staff:    ${staffName || "—"}`,
    `Business: ${businessName || "—"}`,
    `Period:   ${periodLabel}`,
    `Date:     ${new Date().toLocaleDateString("en-NG")}`,
    "───────────────────────────────────",
    "TRANSACTIONS",
    `  Total Cash In:   ₦${cashIn.toLocaleString("en-NG")}`,
    `  Total Cash Out:  ₦${cashOut.toLocaleString("en-NG")}`,
    `  Net Profit:      ₦${profit.toLocaleString("en-NG")}`,
    `  Total Txns:      ${txns.length}`,
    "───────────────────────────────────",
    "CREDIT & AJO",
    `  Outstanding Cr:  ₦${crAmt.toLocaleString("en-NG")} (${openCr.length} open)`,
    `  Ajo Savings:     ₦${ajoBal.toLocaleString("en-NG")} (${asoClients.length} members)`,
    "───────────────────────────────────",
    `  Generated: ${new Date().toLocaleString("en-NG")}`,
    "  Powered by AMAYA & Co. Technologies",
    "  © " + YEAR + " All rights reserved",
    "═══════════════════════════════════",
  ].join("\n");

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "Staff Statement", text: statementText }); } catch { /* dismissed */ }
    } else {
      await navigator.clipboard.writeText(statementText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl overflow-hidden shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
          <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">Activity Statement</p>
          <button onClick={onClose}><Svg d={IC.x} size={20} color="#94a3b8" /></button>
        </div>

        {/* Period picker */}
        <div className="px-6 py-4 flex gap-2 overflow-x-auto no-scrollbar">
          {[["today","Today"],["week","7 Days"],["month","30 Days"],["all","All Time"]].map(([v, l]) => (
            <button key={v} onClick={() => setPeriod(v)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-[12px] font-bold transition ${period === v ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="px-6 pb-4 overflow-y-auto flex-1 space-y-3">
          {[
            ["Cash In",       fmt(cashIn),                    "green" ],
            ["Cash Out",      fmt(cashOut),                   "red"   ],
            ["Net Profit",    fmt(profit),                    profit >= 0 ? "green" : "red"],
            ["Transactions",  txns.length + " records",       "slate" ],
            ["Outstanding Cr",fmt(crAmt) + ` (${openCr.length})`, "orange"],
            ["Ajo Balance",   fmt(ajoBal) + ` (${asoClients.length})`, "blue" ],
          ].map(([l, v, c]) => (
            <div key={l} className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
              <span className="text-[12px] font-bold text-slate-500 dark:text-slate-400">{l}</span>
              <Pill label={v} color={c} />
            </div>
          ))}
        </div>

        <div className="px-6 pb-6 pt-3 flex gap-3 border-t border-slate-100 dark:border-slate-700/50">
          <button onClick={share}
            className="flex-1 h-12 rounded-2xl bg-brand-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition">
            <Svg d={copied ? IC.check : IC.share} size={16} color="#fff" />
            {copied ? "Copied!" : "Share Statement"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   AMAYA AI CHAT
════════════════════════════════════════════════════════════════════ */
const STAFF_GREETING = "Hi! I'm **AMAYA**, your personal AI business assistant.\n\nI can see your sales, credit records, and ajo data right now. Ask me anything — advice, analysis, summaries, or how to grow your performance!";

const QUICK_ASKS = [
  { label: "Today's summary",    q: "Give me a summary of my sales and activities today"      },
  { label: "Advice",             q: "Based on my data, what advice do you have for me?"        },
  { label: "Overdue credits",    q: "Which customers owe me the most and are overdue?"         },
  { label: "Ajo health",         q: "How are my Ajo members doing? Any missed contributions?"  },
  { label: "My performance",     q: "Evaluate my performance this month and suggest improvements" },
];

function FmtText({ text }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {line.split(/\*\*([^*]+)\*\*/g).map((p, j) =>
            j % 2 === 1 ? <strong key={j} className="font-semibold">{p}</strong> : p
          )}
        </span>
      ))}
    </>
  );
}

function AmayaChat({ store, inventory, staff }) {
  const [messages,  setMessages]  = useState([{ role: "assistant", text: STAFF_GREETING }]);
  const [input,     setInput]     = useState("");
  const [thinking,  setThinking]  = useState(false);
  const listRef  = useRef(null);
  const inputRef = useRef(null);
  const msgRef   = useRef(messages);
  msgRef.current = messages;

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, thinking]);

  const ask = useCallback(async (q) => {
    const query = q.trim();
    if (!query || thinking) return;
    setMessages(prev => [...prev, { role: "user", text: query }]);
    setInput("");
    setThinking(true);
    try {
      const staffCtx = `STAFF CONTEXT:\nName: ${staff?.full_name}\nRole: ${staff?.role}\nBusiness: ${staff?.business_name}\n\n`;
      const context  = staffCtx + buildContext(store, inventory?.products || [], []);
      const history  = msgRef.current.slice(1).map(m => ({ role: m.role, text: m.text }));
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": SECRET },
        body: JSON.stringify({ message: query, lang: "en", businessContext: context, history }),
      });
      const reply = res.ok ? await res.text() : "I couldn't get a response. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", text: reply || "No response received." }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Network error. Please check your connection and try again." }]);
    } finally {
      setThinking(false);
    }
  }, [thinking, store, inventory, staff]);

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700/50">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md">
          <Svg d={IC.bot} size={20} color="#fff" sw={1.5} />
        </div>
        <div>
          <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">AMAYA AI</p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <p className="text-[10px] text-slate-400">Online · Staff Assistant</p>
          </div>
        </div>
      </div>

      {/* Quick asks */}
      <div className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto no-scrollbar flex-shrink-0">
        {QUICK_ASKS.map(q => (
          <button key={q.label} onClick={() => ask(q.q)}
            className="flex-shrink-0 px-3 py-2 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700/40 rounded-xl text-[11px] font-bold text-brand-700 dark:text-brand-400 active:scale-95 transition">
            {q.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-xl bg-brand-600 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                <Svg d={IC.bot} size={14} color="#fff" sw={1.5} />
              </div>
            )}
            <div className={`max-w-[78%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${m.role === "user" ? "bg-brand-600 text-white rounded-tr-sm font-medium" : "bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 rounded-tl-sm shadow-card"}`}>
              <FmtText text={m.text} />
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-xl bg-brand-600 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
              <Svg d={IC.bot} size={14} color="#fff" sw={1.5} />
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-2xl rounded-tl-sm px-4 py-3 shadow-card">
              <div className="flex gap-1.5 items-center h-4">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 rounded-full bg-brand-400" style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex gap-2">
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          placeholder={thinking ? "AMAYA is thinking…" : "Ask AMAYA anything…"}
          disabled={thinking}
          className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3.5 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60" />
        <button onClick={() => ask(input)} disabled={!input.trim() || thinking}
          className="w-11 h-11 rounded-xl bg-brand-600 flex items-center justify-center active:scale-90 transition disabled:opacity-40">
          <Svg d={IC.send} size={16} color="#fff" />
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   FAQ
════════════════════════════════════════════════════════════════════ */
const FAQS = [
  { q: "How do I record a sale?",          a: "Go to the Sales tab and tap the '+' button. Fill in the item name, amount, category, and payment type then tap Save." },
  { q: "How do I view a receipt?",         a: "In the Sales tab, tap on any transaction in the list. A receipt will pop up with a Share button to send it." },
  { q: "How do I pay a bill?",             a: "Go to the Sales tab and tap 'Pay Bill'. Select the service (airtime, data, electricity etc.) and follow the steps." },
  { q: "How do I generate my statement?",  a: "Go to Me → Statement. Choose a period (today, 7 days, 30 days, or all time) and tap Share Statement." },
  { q: "How do I change my profile photo?",a: "Go to Me → Edit Profile, then tap the camera icon on your avatar and select a photo from your gallery." },
  { q: "What is the PIN for?",             a: "The PIN locks your portal when you're away. If you've set it up, you'll need to enter it whenever you come back to the app." },
  { q: "Why can't I see some modules?",    a: "Your manager controls which modules you can access. Contact them if you think you're missing something." },
  { q: "How do I contact support?",        a: "Go to Me → Help & Support → Send a Message. Describe your issue and the support team will respond." },
  { q: "What is AMAYA AI?",               a: "AMAYA is your AI assistant built into the portal. It can analyse your sales, credit, and ajo data and give you personalised advice." },
];

function FAQ() {
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-2">
      {FAQS.map((f, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700/50 shadow-card">
          <button onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-4 py-4 text-left gap-3">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1">{f.q}</span>
            <Svg d={open === i ? IC.up : IC.dn} size={16} color="#94a3b8" />
          </button>
          {open === i && (
            <div className="px-4 pb-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   HOME TAB
════════════════════════════════════════════════════════════════════ */
function StaffHome({ staff, store, inventory, livePerms, onGoTo }) {
  const { transactions = [], credits = [], loading } = store;
  const allowed  = livePerms.filter(p => p.can_view).map(p => p.module);
  const todayStr = today();
  const todayTx  = transactions.filter(t => t.transaction_date === todayStr);
  const cashIn   = todayTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const cashOut  = todayTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit   = cashIn - cashOut;

  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yStr = yest.toISOString().split("T")[0];
  const yIn  = transactions.filter(t => t.transaction_date === yStr && t.type === "in").reduce((s, t) => s + t.amount, 0);
  const trend = yIn > 0 ? pct(cashIn - yIn, yIn) : null;

  const overdueCredits = credits.filter(c => c.status !== "paid" && c.due_date && c.due_date < todayStr);
  const lowStock       = (inventory?.lowStock || []);
  const name           = (staff?.full_name || "Staff").split(" ")[0];

  return (
    <div className="overflow-y-auto h-full px-4 pt-5 pb-28 space-y-5">
      {/* Greeting row */}
      <div>
        <p className="text-xl font-black text-slate-800 dark:text-slate-100">{greet()}, {name} 👋</p>
        <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate()}</p>
      </div>

      {/* Alerts */}
      {overdueCredits.length > 0 && (
        <button onClick={() => onGoTo("records", "credit")}
          className="w-full flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-2xl px-4 py-3 active:scale-[.98] transition-all text-left">
          <Svg d={IC.alert} size={18} color="#ef4444" />
          <p className="flex-1 text-sm font-semibold text-red-700 dark:text-red-400">
            {overdueCredits.length} overdue credit{overdueCredits.length > 1 ? "s" : ""} — tap to follow up
          </p>
          <Svg d="M9 18l6-6-6-6" size={16} color="#ef4444" />
        </button>
      )}
      {lowStock.length > 0 && (
        <button onClick={() => onGoTo("stock")}
          className="w-full flex items-center gap-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/40 rounded-2xl px-4 py-3 active:scale-[.98] transition-all text-left">
          <Svg d={IC.alert} size={18} color="#f97316" />
          <p className="flex-1 text-sm font-semibold text-orange-700 dark:text-orange-400">
            {lowStock.length} item{lowStock.length > 1 ? "s" : ""} running low in stock
          </p>
          <Svg d="M9 18l6-6-6-6" size={16} color="#f97316" />
        </button>
      )}

      {/* Hero card */}
      <div className="rounded-3xl px-6 py-6 text-white shadow-lg relative overflow-hidden"
        style={{ background: "linear-gradient(145deg,#16a34a 0%,#15803d 60%,#14532d 100%)" }}>
        <div className="absolute -right-6 -top-6 w-36 h-36 rounded-full bg-white/5" />
        <div className="absolute -right-2 -bottom-8 w-28 h-28 rounded-full bg-white/5" />
        <div className="relative z-10">
          <div className="flex items-start justify-between">
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Today's Profit</p>
            {trend !== null && !loading && (
              <span className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${trend >= 0 ? "bg-white/20" : "bg-red-500/30"}`}>
                <Svg d={trend >= 0 ? IC.up : IC.dn} size={11} color="white" sw={3} />
                {Math.abs(trend)}%
              </span>
            )}
          </div>
          {loading ? <Skel className="h-10 w-40 mt-2 mb-4 !bg-white/20 !rounded-xl" />
            : <p className="text-4xl font-black tabular mt-1 mb-5">{fmt(profit)}</p>}
          <div className="flex gap-8">
            <div>
              <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">Cash In</p>
              {loading ? <Skel className="h-5 w-20 mt-0.5 !bg-white/20" />
                : <p className="text-base font-extrabold tabular mt-0.5">{fmt(cashIn)}</p>}
            </div>
            <div>
              <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">Cash Out</p>
              {loading ? <Skel className="h-5 w-20 mt-0.5 !bg-white/20" />
                : <p className="text-base font-extrabold tabular mt-0.5">{fmt(cashOut)}</p>}
            </div>
            <div>
              <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">Sales</p>
              {loading ? <Skel className="h-5 w-10 mt-0.5 !bg-white/20" />
                : <p className="text-base font-extrabold tabular mt-0.5">{todayTx.filter(t => t.type === "in").length}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "New Sale",    icon: IC.plus,    bg: "bg-green-500",  tab: "sales",   sub: "cash"   },
          { label: "Pay Bill",    icon: IC.bills,   bg: "bg-blue-500",   tab: "sales",   sub: "bills"  },
          { label: "Credit",      icon: IC.receipt, bg: "bg-orange-500", tab: "records", sub: "credit" },
          { label: "Ajo",         icon: IC.aso,     bg: "bg-purple-500", tab: "records", sub: "ajo"    },
        ].map(a => (
          <button key={a.label} onClick={() => onGoTo(a.tab, a.sub)}
            className="flex flex-col items-center gap-2 active:scale-90 transition-transform">
            <div className={`w-14 h-14 rounded-2xl ${a.bg} flex items-center justify-center shadow-md`}>
              <Svg d={a.icon} size={22} color="#fff" sw={2} />
            </div>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 text-center leading-tight">{a.label}</span>
          </button>
        ))}
      </div>

      {/* Recent transactions */}
      {allowed.includes("transactions") && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <SectionLabel>Recent Sales</SectionLabel>
            <button onClick={() => onGoTo("sales", "all")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">View all →</button>
          </div>
          {loading ? [1,2,3].map(i => <Skel key={i} className="h-[68px]" />) :
           transactions.slice(0, 5).length === 0
            ? <div className="text-center py-8"><p className="text-sm text-slate-400">No sales recorded yet today</p></div>
            : transactions.slice(0, 5).map((t, i) => (
                <button key={t.id || i} onClick={() => onGoTo("sales", "receipt", t)}
                  className="w-full flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50 active:scale-[.98] transition-all text-left">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${t.type === "in" ? "bg-green-50 dark:bg-green-900/30" : "bg-red-50 dark:bg-red-900/30"}`}>
                    <Svg d={t.type === "in" ? IC.in : IC.out} size={16} color={t.type === "in" ? "#16a34a" : "#ef4444"} sw={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{t.item_name || "Transaction"}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">{t.category} · {t.transaction_date}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-extrabold tabular ${t.type === "in" ? "text-green-600" : "text-red-500"}`}>
                      {t.type === "in" ? "+" : "−"}{fmt(t.amount)}
                    </p>
                    <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5">View receipt →</p>
                  </div>
                </button>
              ))
          }
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SALES TAB (Cash In/Out + Bills + History + Receipts)
════════════════════════════════════════════════════════════════════ */
function StaffSales({ store, staff, session, livePerms, initialSub = "cash", initialReceipt = null }) {
  const [sub,     setSub]     = useState(initialSub);
  const [receipt, setReceipt] = useState(initialReceipt);
  const [search,  setSearch]  = useState("");
  const [period,  setPeriod]  = useState("all");
  const { transactions = [], loading } = store;
  const allowed = livePerms.filter(p => p.can_view).map(p => p.module);

  // Switch sub-tab from parent
  useEffect(() => { setSub(initialSub); }, [initialSub]);
  useEffect(() => { setReceipt(initialReceipt); }, [initialReceipt]);

  const cutoff  = dateRange(period);
  const filtered = transactions.filter(t => {
    const matchPeriod = !cutoff || t.transaction_date >= cutoff;
    const matchSearch = !search || (t.item_name || "").toLowerCase().includes(search.toLowerCase())
      || (t.customer_name || "").toLowerCase().includes(search.toLowerCase())
      || (t.category || "").toLowerCase().includes(search.toLowerCase());
    return matchPeriod && matchSearch;
  });

  const cashOnly = filtered.filter(t => !(t.category || "").toLowerCase().includes("bill"));

  const billEnabled = allowed.includes("bills");

  return (
    <div className="h-full flex flex-col">
      {/* Sub-nav */}
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

      {/* Bills tab */}
      {sub === "bills" && (
        <div className="flex-1 overflow-hidden">
          {!billEnabled
            ? <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center pb-16">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <Svg d={IC.bills} size={28} color="#94a3b8" />
                </div>
                <p className="text-base font-bold text-slate-700 dark:text-slate-300">Bill Payments Not Enabled</p>
                <p className="text-sm text-slate-400 leading-relaxed">Contact your manager to enable bill payment access.</p>
              </div>
            : <div className="h-full overflow-y-auto pb-16">
                <BillPayments store={store} staffName={staff?.full_name}
                  staffEmail={session?.user?.email || staff?.email || ""}
                  businessName={staff?.business_name} />
              </div>
          }
        </div>
      )}

      {/* Cash / All tab */}
      {sub !== "bills" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search + Filter */}
          <div className="flex-shrink-0 px-4 py-3 space-y-2 bg-slate-50 dark:bg-slate-900/50">
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Svg d={IC.search} size={16} color="#94a3b8" />
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search sales…"
                className="w-full h-10 pl-9 pr-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {[["all","All time"],["today","Today"],["week","7 Days"],["month","30 Days"]].map(([v, l]) => (
                <button key={v} onClick={() => setPeriod(v)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition ${period === v ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Stats row */}
          {(() => {
            const list = sub === "cash" ? cashOnly : filtered;
            const inAmt  = list.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
            const outAmt = list.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
            return (
              <div className="flex-shrink-0 grid grid-cols-3 gap-px bg-slate-100 dark:bg-slate-700/50 border-y border-slate-100 dark:border-slate-700/50">
                {[["Cash In", fmt(inAmt), "text-green-600"],["Cash Out", fmt(outAmt), "text-red-500"],["Count", list.length + " txns", "text-slate-700 dark:text-slate-200"]].map(([l, v, c]) => (
                  <div key={l} className="bg-white dark:bg-slate-800 px-3 py-2.5 text-center">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{l}</p>
                    <p className={`text-sm font-extrabold tabular mt-0.5 ${c}`}>{v}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-16">
            {loading ? [1,2,3,4].map(i => <Skel key={i} className="h-[72px]" />) :
             (sub === "cash" ? cashOnly : filtered).length === 0
              ? <div className="text-center py-12">
                  <p className="text-sm text-slate-400 dark:text-slate-500">No transactions found</p>
                </div>
              : (sub === "cash" ? cashOnly : filtered).map((t, i) => (
                  <button key={t.id || i} onClick={() => setReceipt(t)}
                    className="w-full flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50 active:scale-[.98] transition-all text-left">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${t.type === "in" ? "bg-green-50 dark:bg-green-900/30" : "bg-red-50 dark:bg-red-900/30"}`}>
                      <Svg d={t.type === "in" ? IC.in : IC.out} size={16} color={t.type === "in" ? "#16a34a" : "#ef4444"} sw={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{t.item_name || "Transaction"}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{t.category || "—"} · {t.payment_type || "—"}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-extrabold tabular ${t.type === "in" ? "text-green-600" : "text-red-500"}`}>
                        {t.type === "in" ? "+" : "−"}{fmt(t.amount)}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{t.transaction_date}</p>
                    </div>
                    <Svg d={IC.receipt} size={14} color="#cbd5e1" />
                  </button>
                ))
            }
          </div>
        </div>
      )}

      {receipt && (
        <ReceiptModal txn={receipt} staffName={staff?.full_name}
          businessName={staff?.business_name} onClose={() => setReceipt(null)} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   RECORDS TAB (Credit + Ajo)
════════════════════════════════════════════════════════════════════ */
function StaffRecords({ store, staff, livePerms, initialSub = "credit" }) {
  const [sub, setSub] = useState(initialSub);
  useEffect(() => { setSub(initialSub); }, [initialSub]);
  const allowed = livePerms.filter(p => p.can_view).map(p => p.module);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-3 pb-0">
        <div className="flex gap-1">
          {[["credit","Credit"],["ajo","Ajo"]].map(([v, l]) => (
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
            ? <div className="h-full overflow-y-auto pb-16"><Credit store={store} plan="starter" /></div>
            : <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center pb-16">
                <p className="text-base font-bold text-slate-600 dark:text-slate-400">Credit access not enabled</p>
                <p className="text-sm text-slate-400">Contact your manager to enable credit module.</p>
              </div>
        )}
        {sub === "ajo" && (
          allowed.includes("aso")
            ? <div className="h-full overflow-y-auto pb-16"><Aso store={store} plan="starter" staffId={staff?.id} /></div>
            : <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center pb-16">
                <p className="text-base font-bold text-slate-600 dark:text-slate-400">Ajo access not enabled</p>
                <p className="text-sm text-slate-400">Contact your manager to enable Ajo module.</p>
              </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   STOCK TAB
════════════════════════════════════════════════════════════════════ */
function StaffStock({ inventory, staff, livePerms }) {
  const allowed = livePerms.filter(p => p.can_view).map(p => p.module);
  const canAdd  = livePerms.find(p => p.module === "inventory")?.can_create || false;
  if (!allowed.includes("inventory")) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center pb-16">
        <p className="text-base font-bold text-slate-600 dark:text-slate-400">Stock access not enabled</p>
        <p className="text-sm text-slate-400">Your manager hasn't enabled inventory for your account.</p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-hidden pb-16">
      <Inventory
        inventory={inventory}
        isOwner={false}
        canAdd={canAdd}
        plan="starter"
        staffBranchId={staff?.branch_id || null}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ME TAB
════════════════════════════════════════════════════════════════════ */
function StaffMe({ staff, session, store, inventory, livePerms, staffId }) {
  const [view,        setView]        = useState("menu"); // menu|edit|pin|statement|chat|faq|support
  const [isDark,      setIsDark]      = useState(() => localStorage.getItem("kuditrack_dark") === "1");
  const [editForm,    setEditForm]    = useState({ full_name: staff?.full_name || "", phone: staff?.phone || "" });
  const [photoFile,   setPhotoFile]   = useState(null);
  const [photoPreview,setPhotoPreview]= useState(null);
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState("");
  const [supportMsg,  setSupportMsg]  = useState("");
  const [supportSent, setSupportSent] = useState(false);
  const [supportSend, setSupportSend] = useState(false);
  const fileRef = useRef(null);

  const PIN_KEY = `kudi_pin_${staffId}`;
  const hasPin  = !!localStorage.getItem(PIN_KEY);

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
      if (photoFile) { photoUrl = await uploadAvatar(photoFile, staffId); }
      await supabase.from("staff").update({
        full_name:         editForm.full_name,
        phone:             editForm.phone,
        profile_image_url: photoUrl,
      }).eq("id", staffId);
      setSaveMsg("Profile saved!");
      setTimeout(() => { setSaveMsg(""); setView("menu"); }, 1500);
    } catch { setSaveMsg("Save failed. Please try again."); }
    setSaving(false);
  };

  const sendSupport = async () => {
    if (!supportMsg.trim()) return;
    setSupportSend(true);
    try {
      await supabase.from("support_messages").insert({
        sender_id:   staff?.user_id || session?.user?.id,
        sender_name: staff?.full_name,
        sender_role: "staff",
        message:     supportMsg.trim(),
      });
      setSupportSent(true);
      setSupportMsg("");
      setTimeout(() => setSupportSent(false), 4000);
    } catch { /* ignore */ }
    setSupportSend(false);
  };

  const SubHeader = ({ title }) => (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0 bg-white dark:bg-slate-900">
      <button onClick={() => setView("menu")} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition">
        <Svg d={IC.back} size={18} color="#64748b" />
      </button>
      <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
    </div>
  );

  /* ── Edit Profile ── */
  if (view === "edit") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Edit Profile" />
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 pb-20">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl bg-brand-600 flex items-center justify-center shadow-lg overflow-hidden">
              {photoPreview
                ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                : staff?.profile_image_url
                  ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
                  : <span className="text-2xl font-black text-white">{initials}</span>
              }
            </div>
            <button onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-brand-600 border-2 border-white dark:border-slate-900 flex items-center justify-center shadow-md active:scale-90 transition">
              <Svg d={IC.cam} size={15} color="#fff" />
            </button>
          </div>
          <p className="text-[12px] text-slate-400">Tap camera to change photo</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (!f) return; setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); }} />
        </div>

        {/* Fields */}
        <div className="space-y-3">
          {[["Full Name","full_name","text"],["Phone","phone","tel"]].map(([l, k, t]) => (
            <div key={k}>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{l}</p>
              <input type={t} value={editForm[k]} onChange={e => setEditForm(p => ({ ...p, [k]: e.target.value }))}
                className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
          ))}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Email</p>
            <input disabled value={staff?.email || session?.user?.email || "—"}
              className="w-full h-12 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 text-sm font-semibold text-slate-400 cursor-not-allowed" />
          </div>
        </div>

        {saveMsg && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${saveMsg.includes("saved") ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/30 text-red-600"}`}>
            <Svg d={saveMsg.includes("saved") ? IC.check : IC.alert} size={16} color="currentColor" />
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

  /* ── PIN Setup ── */
  if (view === "pin") return (
    <div className="h-full flex flex-col">
      <SubHeader title={hasPin ? "Change PIN" : "Set Up PIN"} />
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <PinPad title={hasPin ? "Enter new PIN" : "Create your PIN"}
          sub="4-digit PIN to lock your portal when you step away"
          value="" onChange={() => {}} onSubmit={(pin) => { localStorage.setItem(PIN_KEY, pin); setView("menu"); }} error="" />
        {hasPin && (
          <button onClick={() => { localStorage.removeItem(PIN_KEY); setView("menu"); }}
            className="w-full mt-8 h-11 rounded-2xl border border-red-200 dark:border-red-800/50 text-red-500 text-sm font-bold active:scale-95 transition">
            Remove PIN Lock
          </button>
        )}
      </div>
    </div>
  );

  /* ── Statement ── */
  if (view === "statement") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Activity Statement" />
      <div className="flex-1">
        <StatementModal store={store} staffName={staff?.full_name} businessName={staff?.business_name} onClose={() => setView("menu")} />
      </div>
    </div>
  );

  /* ── AMAYA Chat ── */
  if (view === "chat") return (
    <div className="h-full flex flex-col">
      <SubHeader title="AMAYA AI Assistant" />
      <div className="flex-1 overflow-hidden">
        <AmayaChat store={store} inventory={inventory} staff={staff} />
      </div>
    </div>
  );

  /* ── FAQ ── */
  if (view === "faq") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Frequently Asked Questions" />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-20">
        <FAQ />
      </div>
    </div>
  );

  /* ── Support ── */
  if (view === "support") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Contact Support" />
      <div className="flex-1 overflow-y-auto px-4 py-5 pb-20 space-y-4">
        {supportSent
          ? <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Svg d={IC.check} size={28} color="#16a34a" sw={2.5} />
              </div>
              <p className="text-base font-bold text-slate-800 dark:text-slate-100">Message Sent!</p>
              <p className="text-sm text-slate-400 leading-relaxed">The support team will review your message and get back to you shortly.</p>
              <button onClick={() => setView("menu")} className="mt-4 px-6 py-3 rounded-2xl bg-brand-600 text-white font-bold text-sm active:scale-95 transition">Back to Settings</button>
            </div>
          : <>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Describe your issue or question and the support team will respond as soon as possible.
              </p>
              <textarea value={supportMsg} onChange={e => setSupportMsg(e.target.value)}
                placeholder="How can we help you today?" rows={5}
                className="w-full rounded-2xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              <button onClick={sendSupport} disabled={supportSend || !supportMsg.trim()}
                className="w-full h-12 rounded-2xl bg-brand-600 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50">
                <Svg d={IC.send} size={15} color="#fff" />
                {supportSend ? "Sending…" : "Send Message"}
              </button>
            </>
        }
      </div>
    </div>
  );

  /* ── Main Me menu ── */
  const MenuRow = ({ icon, label, sub, onClick, badge }) => (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-4 active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        <Svg d={IC[icon]} size={18} color="#64748b" />
      </div>
      <div className="flex-1 text-left">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
      {badge && <span className="px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-[11px] font-bold">{badge}</span>}
      <Svg d="M9 18l6-6-6-6" size={16} color="#cbd5e1" />
    </button>
  );

  return (
    <div className="h-full overflow-y-auto pb-24">
      {/* Profile card */}
      <div className="mx-4 mt-5 mb-5">
        <Card className="p-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center shadow-lg flex-shrink-0 overflow-hidden">
            {staff?.profile_image_url
              ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
              : <span className="text-xl font-black text-white">{initials}</span>
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 truncate">{staff?.full_name || "Staff"}</p>
            <p className="text-[12px] font-bold text-brand-600 dark:text-brand-400 capitalize mt-0.5">{staff?.role || "Staff Member"}</p>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">{staff?.business_name || "—"}</p>
          </div>
          <button onClick={() => setView("edit")}
            className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center active:scale-90 transition flex-shrink-0">
            <Svg d={IC.pen} size={16} color="#16a34a" />
          </button>
        </Card>
      </div>

      {/* Account section */}
      <div className="px-4 mb-4">
        <SectionLabel>Account</SectionLabel>
        <Card className="overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
          <InfoRow icon="mail"  label="Email"    value={staff?.email || session?.user?.email} />
          <InfoRow icon="phone" label="Phone"    value={staff?.phone} />
          <InfoRow icon="store" label="Business" value={staff?.business_name} />
        </Card>
      </div>

      {/* Tools section */}
      <div className="px-4 mb-4">
        <SectionLabel>Tools</SectionLabel>
        <Card className="overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
          <MenuRow icon="bot"  label="AMAYA AI Assistant"  sub="Ask anything about your data"   onClick={() => setView("chat")}      />
          <MenuRow icon="doc"  label="Activity Statement"  sub="Generate & share your statement" onClick={() => setView("statement")} />
          <MenuRow icon="lock" label={hasPin ? "Change PIN Lock" : "Set Up PIN Lock"}  sub={hasPin ? "PIN is active" : "Secure your portal"} onClick={() => setView("pin")} badge={hasPin ? "On" : null} />
        </Card>
      </div>

      {/* Preferences */}
      <div className="px-4 mb-4">
        <SectionLabel>Preferences</SectionLabel>
        <Card className="overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
              <Svg d={isDark ? IC.moon : IC.sun} size={18} color="#64748b" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Dark Mode</p>
            </div>
            <button onClick={toggleDark}
              className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${isDark ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${isDark ? "left-7" : "left-1"}`} />
            </button>
          </div>
        </Card>
      </div>

      {/* Help & Support */}
      <div className="px-4 mb-4">
        <SectionLabel>Help & Support</SectionLabel>
        <Card className="overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
          <MenuRow icon="faq"    label="Frequently Asked Questions" sub="Common questions & answers" onClick={() => setView("faq")}     />
          <MenuRow icon="mail"   label="Contact Support"            sub="Send us a message"          onClick={() => setView("support")} />
          <MenuRow icon="shield" label="Security"                   sub="Account protected by AMAYA" onClick={() => {}}                  />
        </Card>
      </div>

      {/* Sign out */}
      <div className="px-4 mb-4">
        <button onClick={() => supabase.auth.signOut()}
          className="w-full h-12 rounded-2xl border border-red-200 dark:border-red-800/50 text-red-500 dark:text-red-400 text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition bg-white dark:bg-slate-800">
          <Svg d={IC.out2} size={16} color="currentColor" />
          Sign Out
        </button>
      </div>

      {/* Footer */}
      <div className="text-center py-4 px-8 space-y-1">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-semibold">KudiAI Track · Staff Portal</p>
        <p className="text-[10px] text-slate-300 dark:text-slate-600">
          Powered by AMAYA & Co. Technologies<br />
          All rights reserved © {YEAR}
        </p>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MAIN STAFF DASHBOARD
════════════════════════════════════════════════════════════════════ */
export default function StaffDashboard({ session, staff }) {
  const [tab,       setTab]       = useState("home");
  const [subNav,    setSubNav]    = useState(null);   // sub-tab hint
  const [subData,   setSubData]   = useState(null);   // e.g. receipt txn object
  const [livePerms, setLivePerms] = useState(staff?.staff_permissions || []);
  const [pinLocked, setPinLocked] = useState(false);

  const staffId = staff?.id;
  const ownerId = staff?.owner_id;
  const PIN_KEY = `kudi_pin_${staffId}`;

  const store     = useStore(ownerId, staffId, staff?.full_name);
  const inventory = useInventory(ownerId, staffId);

  // Dark mode bootstrap
  useEffect(() => {
    document.documentElement.classList.toggle("dark", localStorage.getItem("kuditrack_dark") === "1");
  }, []);

  // PIN lock when app goes to background
  useEffect(() => {
    if (!localStorage.getItem(PIN_KEY)) return;
    const onHide = () => { if (document.visibilityState === "hidden") setPinLocked(true); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [PIN_KEY]);

  /* ── Permission refresh ── */
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

  /* ── Nav badge counts ── */
  const todayStr  = today();
  const overdueCr = (store.credits || []).filter(c => c.status !== "paid" && c.due_date && c.due_date < todayStr).length;
  const lowStk    = (inventory?.lowStock || []).length;
  const badge = (id) => {
    if (id === "records" && overdueCr > 0) return overdueCr;
    if (id === "stock"   && lowStk   > 0) return lowStk;
    return 0;
  };

  /* ── Navigate with optional sub-context ── */
  const goTo = useCallback((t, sub = null, data = null) => {
    setTab(t);
    setSubNav(sub);
    setSubData(data);
  }, []);

  const avatarInitial = (staff?.full_name || "S")[0].toUpperCase();

  function renderContent() {
    switch (tab) {
      case "home":    return <StaffHome    staff={staff} store={store} inventory={inventory} livePerms={livePerms} onGoTo={goTo} />;
      case "sales":   return <StaffSales   store={store} staff={staff} session={session} livePerms={livePerms} initialSub={subNav || "cash"} initialReceipt={subData} />;
      case "records": return <StaffRecords store={store} staff={staff} livePerms={livePerms} initialSub={subNav || "credit"} />;
      case "stock":   return <StaffStock   inventory={inventory} staff={staff} livePerms={livePerms} />;
      case "me":      return <StaffMe      staff={staff} session={session} store={store} inventory={inventory} livePerms={livePerms} staffId={staffId} />;
      default:        setTab("home"); return null;
    }
  }

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative overflow-hidden">

        {/* PIN lock overlay */}
        {pinLocked && (
          <StaffPinLock staffId={staffId} onUnlock={() => setPinLocked(false)} />
        )}

        {/* Header */}
        <header className="flex-shrink-0 h-14 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 z-30">
          <AppLogo className="h-8 w-8" />
          <p className="text-[15px] font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">KudiAI Track</p>
          <button onClick={() => goTo("me")}
            className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center shadow-sm active:scale-90 transition-transform">
            {staff?.profile_image_url
              ? <img src={staff.profile_image_url} alt="" className="w-9 h-9 rounded-full object-cover" />
              : <span className="text-sm font-black text-white">{avatarInitial}</span>
            }
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-hidden">
          {renderContent()}
        </main>

        {/* Bottom nav — 5 tabs */}
        <nav className="flex-shrink-0 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float z-40">
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

      </div>
    </div>
  );
}
