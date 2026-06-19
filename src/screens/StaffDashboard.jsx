import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase }     from "../utils/supabase";
import { useStore }     from "../hooks/useStore";
import { useInventory } from "../hooks/useInventory";
import { fmt, today }   from "../utils/helpers";
import AppLogo          from "../components/AppLogo";
import Icon             from "../components/Icon";
import BillPayments     from "./BillPayments";
import Transactions     from "./Transactions";
import Credit           from "./Credit";
import Aso              from "./Aso";
import Inventory        from "./Inventory";
import Insights         from "./Insights";

/* ─── Helpers ────────────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
function fmtDate() {
  return new Date().toLocaleDateString("en-NG", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
function pct(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 100);
}

/* ─── Inline SVG paths ───────────────────────────────────────────── */
const P = {
  in:          "M12 19V5|M5 12l7-7 7 7",
  out:         "M12 5v14|M19 12l-7 7-7-7",
  up:          "M18 15l-6-6-6 6",
  down:        "M6 9l6 6 6-6",
  bills:       "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2",
  credit:      "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  aso:         "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
  inventory:   "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z|M7 7h.01",
  airtime:     "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .82h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z",
  data:        "M1 6l11-4 11 4|M1 12l11-4 11 4|M1 18l11-4 11 4",
  electricity: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  cable:       "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8",
  betting:     "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 8v4l3 3",
  signout:     "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4|M16 17l5-5-5-5|M21 12H9",
  mail:        "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z|M22 6l-10 7L2 6",
  phone:       "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.34 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z",
  moon:        "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  sun:         "M12 1v2|M12 21v2|M4.22 4.22l1.42 1.42|M18.36 18.36l1.42 1.42|M1 12h2|M21 12h2|M4.22 19.78l1.42-1.42|M18.36 5.64l1.42-1.42|M12 5a7 7 0 100 14A7 7 0 0012 5z",
  send:        "M22 2L11 13|M22 2L15 22 11 13 2 9l20-7z",
  check:       "M20 6L9 17l-5-5",
  alert:       "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z|M12 9v4|M12 17h.01",
  lock:        "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z|M7 11V7a5 5 0 0110 0v4",
  shield:      "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  store:       "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
  bell:        "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9|M13.73 21a2 2 0 01-3.46 0",
  refresh:     "M23 4v6h-6|M1 20v-6h6|M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  txn:         "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  badge:       "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
};

function Svg({ d, size = 18, color = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/* ─── Nav definition ─────────────────────────────────────────────── */
const ALL_NAV = [
  { id: "home",         icon: "home",      label: "Home"    },
  { id: "bills",        icon: "bills",     label: "Bills"   },
  { id: "transactions", icon: "txn",       label: "Sales"   },
  { id: "credit",       icon: "credit",    label: "Credit"  },
  { id: "aso",          icon: "aso",       label: "Ajo"     },
  { id: "inventory",    icon: "inventory", label: "Stock"   },
  { id: "insights",     icon: "insights",  label: "Reports" },
  { id: "settings",     icon: "settings",  label: "Settings"},
];
const PINNED     = new Set(["home", "bills", "settings"]);
const PRINT_MODS = new Set(["print-airtime", "print-data"]);

/* ─── Quick bill services ────────────────────────────────────────── */
const BILL_SERVICES = [
  { id: "airtime",     label: "Airtime",    g1: "#ef4444", g2: "#dc2626", icon: "airtime"     },
  { id: "data",        label: "Data",       g1: "#3b82f6", g2: "#1d4ed8", icon: "data"        },
  { id: "electricity", label: "Electricity",g1: "#f59e0b", g2: "#d97706", icon: "electricity" },
  { id: "cable",       label: "Cable TV",   g1: "#8b5cf6", g2: "#6d28d9", icon: "cable"       },
  { id: "betting",     label: "Betting",    g1: "#10b981", g2: "#059669", icon: "betting"     },
];

/* ─── Shared sub-components ──────────────────────────────────────── */
function Skeleton({ className = "" }) {
  return <div className={`bg-slate-100 dark:bg-slate-700 rounded-xl animate-pulse ${className}`} />;
}

function StatCard({ label, value, sub, iconPath, iconBg, iconColor, trend, loading, onClick }) {
  return (
    <button onClick={onClick}
      className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50 text-left active:scale-95 transition-all w-full">
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Svg d={iconPath} size={16} color={iconColor} sw={2.5} />
        </div>
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 leading-tight flex-1">{label}</span>
        {trend !== undefined && !loading && (
          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${trend >= 0 ? "text-green-500" : "text-red-400"}`}>
            <Svg d={trend >= 0 ? P.up : P.down} size={10} color="currentColor" sw={3} />
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      {loading ? <Skeleton className="h-6 w-24 mt-1" /> : (
        <p className="text-xl font-black text-slate-800 dark:text-slate-100 tabular">{value}</p>
      )}
      {sub && !loading && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{sub}</p>
      )}
    </button>
  );
}

function AlertBanner({ icon, text, color = "orange" }) {
  const colors = {
    orange: "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700/40 text-orange-700 dark:text-orange-300",
    red:    "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40 text-red-700 dark:text-red-300",
    blue:   "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/40 text-blue-700 dark:text-blue-300",
  };
  return (
    <div className={`flex items-center gap-2.5 rounded-2xl px-4 py-3 border text-sm font-semibold ${colors[color]}`}>
      <Svg d={P[icon] || P.alert} size={16} color="currentColor" />
      <span className="flex-1">{text}</span>
    </div>
  );
}

function TxRow({ t }) {
  const isIn = t.type === "in";
  return (
    <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isIn ? "bg-green-50 dark:bg-green-900/30" : "bg-red-50 dark:bg-red-900/30"}`}>
        <Svg d={isIn ? P.in : P.out} size={16} color={isIn ? "#16a34a" : "#ef4444"} sw={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{t.item_name || "Transaction"}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{t.category || "—"} · {t.payment_type || "—"}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-sm font-extrabold tabular ${isIn ? "text-green-600" : "text-red-500"}`}>
          {isIn ? "+" : "−"}{fmt(t.amount)}
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">{t.transaction_date || ""}</p>
      </div>
    </div>
  );
}

/* ─── Home tab ───────────────────────────────────────────────────── */
function StaffHome({ staff, store, inventory, allowed, livePerms, onBillOpen, onTabSwitch }) {
  const { transactions = [], credits = [], asoClients = [], loading } = store;

  const todayStr = today();
  const todayTx  = transactions.filter(t => t.transaction_date === todayStr);
  const cashIn   = todayTx.filter(t => t.type === "in" ).reduce((s, t) => s + t.amount, 0);
  const cashOut  = todayTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit   = cashIn - cashOut;

  // Yesterday comparison
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yesterdayStr = yest.toISOString().split("T")[0];
  const yesterdayIn  = transactions.filter(t => t.transaction_date === yesterdayStr && t.type === "in").reduce((s, t) => s + t.amount, 0);
  const profitTrend  = yesterdayIn > 0 ? pct(cashIn - yesterdayIn, yesterdayIn) : null;

  const openCredits  = credits.filter(c => c.status !== "paid");
  const overdueCount = openCredits.filter(c => c.due_date && c.due_date < todayStr).length;
  const outstanding  = openCredits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const totalAso     = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const lowStockCount = (inventory?.lowStock || []).length;
  const recent        = transactions.slice(0, 5);

  const name = (staff?.full_name || "").split(" ")[0] || "Staff";
  const canView = (mod) => allowed.includes(mod);

  return (
    <div className="px-4 pt-5 pb-28 space-y-5 overflow-y-auto h-full">

      {/* Greeting */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xl font-black text-slate-800 dark:text-slate-100">
            {greeting()}, {name} 👋
          </p>
          <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate()}</p>
        </div>
        <button onClick={() => onTabSwitch("settings")}
          className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center shadow-md active:scale-90 transition-transform flex-shrink-0">
          <span className="text-sm font-black text-white">
            {(staff?.full_name || "S")[0].toUpperCase()}
          </span>
        </button>
      </div>

      {/* Smart alerts */}
      {overdueCount > 0 && canView("credit") && (
        <AlertBanner icon="alert" color="red"
          text={`${overdueCount} overdue credit${overdueCount > 1 ? "s" : ""} need follow-up`} />
      )}
      {lowStockCount > 0 && canView("inventory") && (
        <AlertBanner icon="alert" color="orange"
          text={`${lowStockCount} product${lowStockCount > 1 ? "s" : ""} running low on stock`} />
      )}

      {/* Hero card */}
      <div className="rounded-3xl px-6 py-6 text-white shadow-lg relative overflow-hidden"
        style={{ background: "linear-gradient(145deg,#16a34a 0%,#15803d 55%,#14532d 100%)" }}>
        {/* Decorative rings */}
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-white/5" />
        <div className="absolute -right-4 -top-4 w-28 h-28 rounded-full bg-white/5" />

        <div className="flex items-start justify-between relative z-10">
          <div>
            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Today's Profit</p>
            {loading
              ? <Skeleton className="h-10 w-40 mt-2 mb-4 bg-white/20" />
              : <p className="text-4xl font-black tabular mt-1 mb-4">{fmt(profit)}</p>
            }
            <div className="flex gap-6">
              <div>
                <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">Cash In</p>
                {loading ? <Skeleton className="h-5 w-20 mt-0.5 bg-white/20" />
                  : <p className="text-base font-extrabold tabular">{fmt(cashIn)}</p>}
              </div>
              <div>
                <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">Cash Out</p>
                {loading ? <Skeleton className="h-5 w-20 mt-0.5 bg-white/20" />
                  : <p className="text-base font-extrabold tabular">{fmt(cashOut)}</p>}
              </div>
            </div>
          </div>
          {profitTrend !== null && !loading && (
            <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold ${profitTrend >= 0 ? "bg-white/20 text-white" : "bg-white/10 text-white/70"}`}>
              <Svg d={profitTrend >= 0 ? P.up : P.down} size={12} color="currentColor" sw={3} />
              {Math.abs(profitTrend)}% vs yesterday
            </div>
          )}
        </div>

        {/* Sales count pill */}
        {!loading && canView("transactions") && (
          <div className="mt-4 inline-flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-full">
            <Svg d={P.txn} size={13} color="white" />
            <span className="text-[12px] font-bold text-white">{todayTx.filter(t => t.type === "in").length} sales today</span>
          </div>
        )}
      </div>

      {/* Quick bill services */}
      {canView("bills") && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Quick Services</p>
            <button onClick={() => onBillOpen("airtime")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all →</button>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {BILL_SERVICES.map(s => (
              <button key={s.id} onClick={() => onBillOpen(s.id)}
                className="flex flex-col items-center gap-2 active:scale-90 transition-transform">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-md"
                  style={{ background: `linear-gradient(135deg, ${s.g1}, ${s.g2})` }}>
                  <Svg d={P[s.icon]} size={22} color="#fff" sw={2} />
                </div>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 text-center leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      {(canView("transactions") || canView("credit") || canView("aso") || canView("inventory")) && (
        <div className="grid grid-cols-2 gap-3">
          {canView("transactions") && (
            <StatCard label="Today Sales" loading={loading}
              value={`${todayTx.filter(t => t.type === "in").length} txns`}
              sub={fmt(cashIn)} trend={profitTrend}
              iconPath={P.txn} iconBg="bg-green-50 dark:bg-green-900/30" iconColor="#16a34a"
              onClick={() => onTabSwitch("transactions")} />
          )}
          {canView("credit") && (
            <StatCard label="Outstanding" loading={loading}
              value={fmt(outstanding)} sub={`${openCredits.length} open`}
              iconPath={P.credit} iconBg="bg-orange-50 dark:bg-orange-900/30" iconColor="#f97316"
              onClick={() => onTabSwitch("credit")} />
          )}
          {canView("aso") && (
            <StatCard label="Ajo Savings" loading={loading}
              value={fmt(totalAso)} sub={`${asoClients.length} members`}
              iconPath={P.aso} iconBg="bg-purple-50 dark:bg-purple-900/30" iconColor="#8b5cf6"
              onClick={() => onTabSwitch("aso")} />
          )}
          {canView("inventory") && (
            <StatCard label="Stock Alerts" loading={loading}
              value={lowStockCount === 0 ? "All good" : `${lowStockCount} low`}
              sub={`${inventory?.products?.length ?? 0} products`}
              iconPath={P.inventory} iconBg="bg-blue-50 dark:bg-blue-900/30" iconColor="#3b82f6"
              onClick={() => onTabSwitch("inventory")} />
          )}
        </div>
      )}

      {/* Recent transactions */}
      {canView("transactions") && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Recent Sales</p>
            {transactions.length > 5 && (
              <button onClick={() => onTabSwitch("transactions")}
                className="text-[11px] font-bold text-brand-600 dark:text-brand-400">View all →</button>
            )}
          </div>
          {loading
            ? [1,2,3].map(i => <Skeleton key={i} className="h-[68px]" />)
            : recent.length === 0
              ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <Svg d={P.txn} size={22} color="#94a3b8" />
                  </div>
                  <p className="text-sm text-slate-400 dark:text-slate-500">No sales recorded today yet</p>
                </div>
              )
              : recent.map((t, i) => <TxRow key={t.id || i} t={t} />)
          }
        </div>
      )}

      {/* Module shortcuts — if no transactions perm but other perms exist */}
      {!canView("transactions") && livePerms.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">Your Modules</p>
          <div className="grid grid-cols-3 gap-3">
            {ALL_NAV.filter(n => allowed.includes(n.id) && !PINNED.has(n.id)).map(n => (
              <button key={n.id} onClick={() => onTabSwitch(n.id)}
                className="bg-white dark:bg-slate-800 rounded-2xl py-4 shadow-card border border-slate-100 dark:border-slate-700/50 flex flex-col items-center gap-2 active:scale-95 transition-all">
                <Icon name={n.icon} size={22} className="text-brand-600 dark:text-brand-400" />
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Settings tab ───────────────────────────────────────────────── */
function StaffSettings({ staff, session, livePerms }) {
  const [isDark,   setIsDark]   = useState(() => localStorage.getItem("kuditrack_dark") === "1");
  const [msg,      setMsg]      = useState("");
  const [sent,     setSent]     = useState(false);
  const [sending,  setSending]  = useState(false);
  const [section,  setSection]  = useState(null); // "support" | null

  const initials = (staff?.full_name || "S").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const MODULE_LABELS = {
    bills:          "Bills",
    transactions:   "Sales",
    credit:         "Credit",
    aso:            "Ajo",
    inventory:      "Stock",
    insights:       "Reports",
    "print-airtime":"Print Airtime",
    "print-data":   "Print Data",
  };

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("kuditrack_dark", next ? "1" : "0");
    document.documentElement.classList.toggle("dark", next);
  };

  const sendSupport = async () => {
    if (!msg.trim()) return;
    setSending(true);
    try {
      await supabase.from("support_messages").insert({
        sender_id:   staff?.user_id || session?.user?.id,
        sender_name: staff?.full_name,
        sender_role: "staff",
        message:     msg.trim(),
      });
      setSent(true);
      setMsg("");
      setTimeout(() => setSent(false), 4000);
    } catch { /* ignore */ }
    setSending(false);
  };

  const DetailRow = ({ icon, label, value }) => (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        <Svg d={P[icon]} size={15} color="#64748b" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{value || "—"}</p>
      </div>
    </div>
  );

  const SectionHeading = ({ children }) => (
    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1 mb-2 mt-1">{children}</p>
  );

  return (
    <div className="px-4 pt-5 pb-28 space-y-5 overflow-y-auto h-full">

      {/* Avatar card */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-5 shadow-card border border-slate-100 dark:border-slate-700/50 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center shadow-lg flex-shrink-0">
          {staff?.profile_image_url
            ? <img src={staff.profile_image_url} alt="" className="w-16 h-16 rounded-2xl object-cover" />
            : <span className="text-xl font-black text-white">{initials}</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 truncate">{staff?.full_name || "Staff"}</p>
          <p className="text-[12px] font-bold text-brand-600 dark:text-brand-400 capitalize mt-0.5">{staff?.role || "Staff Member"}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{staff?.business_name || "—"}</p>
        </div>
      </div>

      {/* Account details */}
      <div>
        <SectionHeading>Account Info</SectionHeading>
        <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-card border border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
          <DetailRow icon="mail"  label="Email"    value={staff?.email || session?.user?.email} />
          <DetailRow icon="phone" label="Phone"    value={staff?.phone} />
          <DetailRow icon="store" label="Business" value={staff?.business_name} />
          <DetailRow icon="badge" label="Role"     value={staff?.role ? (staff.role.charAt(0).toUpperCase() + staff.role.slice(1)) : "Staff"} />
        </div>
      </div>

      {/* Module access */}
      {livePerms.length > 0 && (
        <div>
          <SectionHeading>Module Access</SectionHeading>
          <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-card border border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
            {livePerms.map(p => (
              <div key={p.module} className="flex items-center gap-3 px-4 py-3.5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${p.can_view ? "bg-green-50 dark:bg-green-900/30" : "bg-slate-100 dark:bg-slate-700"}`}>
                  <Icon name={p.module === "transactions" ? "txn" : p.module === "aso" ? "aso" : p.module} size={16}
                    className={p.can_view ? "text-green-600 dark:text-green-400" : "text-slate-400"} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{MODULE_LABELS[p.module] || p.module}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {p.can_view ? "View" : "No access"}{p.can_create ? " · Add records" : ""}
                  </p>
                </div>
                <div className={`w-2 h-2 rounded-full ${p.can_view ? "bg-green-500" : "bg-slate-300 dark:bg-slate-600"}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preferences */}
      <div>
        <SectionHeading>Preferences</SectionHeading>
        <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-card border border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
          {/* Dark mode */}
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
              <Svg d={isDark ? P.moon : P.sun} size={15} color="#64748b" />
            </div>
            <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Dark Mode</span>
            <button onClick={toggleDark}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${isDark ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${isDark ? "left-6" : "left-1"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Security info */}
      <div>
        <SectionHeading>Security</SectionHeading>
        <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-card border border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <Svg d={P.shield} size={15} color="#3b82f6" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Account Protected</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Signed in as {session?.user?.email || staff?.email}</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-green-500" />
          </div>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
              <Svg d={P.lock} size={15} color="#64748b" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Permissions managed by owner</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Contact your manager to change access</p>
            </div>
          </div>
        </div>
      </div>

      {/* Help & Support */}
      <div>
        <SectionHeading>Help & Support</SectionHeading>
        {section !== "support"
          ? (
            <button onClick={() => setSection("support")}
              className="w-full bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border border-slate-100 dark:border-slate-700/50 flex items-center gap-3 active:scale-95 transition-all">
              <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
                <Svg d={P.mail} size={15} color="#16a34a" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Send a message</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Report an issue or ask a question</p>
              </div>
              <Svg d="M9 18l6-6-6-6" size={16} color="#94a3b8" />
            </button>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50 space-y-3">
              {sent
                ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 py-2">
                    <Svg d={P.check} size={18} color="currentColor" />
                    <p className="text-sm font-bold">Message sent! We'll get back to you shortly.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Send Support Message</p>
                      <button onClick={() => setSection(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                        <Svg d="M18 6L6 18|M6 6l12 12" size={18} color="currentColor" />
                      </button>
                    </div>
                    <textarea value={msg} onChange={e => setMsg(e.target.value)}
                      placeholder="Describe your issue or question…" rows={4}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                    <button onClick={sendSupport} disabled={sending || !msg.trim()}
                      className="w-full h-11 rounded-xl bg-brand-600 text-white text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50">
                      <Svg d={P.send} size={15} color="#fff" />
                      {sending ? "Sending…" : "Send Message"}
                    </button>
                  </>
                )
              }
            </div>
          )
        }
      </div>

      {/* App info */}
      <div className="text-center space-y-1 py-2">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">KudiAI Track · Staff Portal</p>
        <p className="text-[10px] text-slate-300 dark:text-slate-600">v2.0 · Powered by KudiAI</p>
      </div>

      {/* Sign out */}
      <button onClick={() => supabase.auth.signOut()}
        className="w-full h-12 rounded-2xl border border-red-200 dark:border-red-800/50 text-red-500 dark:text-red-400 text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition bg-white dark:bg-slate-800">
        <Svg d={P.signout} size={16} color="currentColor" />
        Sign Out
      </button>
    </div>
  );
}

/* ─── Bills gate ─────────────────────────────────────────────────── */
function BillsGate({ livePerms, allowed, store, staff, session, billAutoService, onAutoOpened }) {
  if (livePerms.length > 0 && !allowed.includes("bills")) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center pb-20">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
          <Svg d={P.bills} size={28} color="#94a3b8" />
        </div>
        <p className="text-base font-bold text-slate-700 dark:text-slate-300">Bills Not Enabled</p>
        <p className="text-sm text-slate-400 dark:text-slate-500 leading-relaxed">
          Your manager hasn't enabled bill payments for your account yet. Contact them to get access.
        </p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto pb-20">
      <BillPayments
        store={store}
        staffName={staff?.full_name}
        staffEmail={session?.user?.email || staff?.email || ""}
        businessName={staff?.business_name}
        autoService={billAutoService}
        onAutoOpened={onAutoOpened}
      />
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────── */
export default function StaffDashboard({ session, staff }) {
  const [tab,             setTab]             = useState("home");
  const [livePerms,       setLivePerms]       = useState(staff?.staff_permissions || []);
  const [billAutoService, setBillAutoService] = useState(null);

  const staffId  = staff?.id;
  const ownerId  = staff?.owner_id;

  // Scope data to the business this staff belongs to, filtered by staff_id
  const store     = useStore(ownerId, staffId, staff?.full_name);
  const inventory = useInventory(ownerId, staffId);

  // Derived
  const allowed = useMemo(() =>
    livePerms.filter(p => p.can_view).map(p => p.module),
    [livePerms]
  );
  const canCreate = useMemo(() => {
    const m = {};
    livePerms.forEach(p => { m[p.module] = p.can_create; });
    return m;
  }, [livePerms]);

  // Evict tab if permission revoked
  useEffect(() => {
    if (!PINNED.has(tab) && !allowed.includes(tab)) setTab("home");
  }, [allowed, tab]);

  // Dark mode bootstrap
  useEffect(() => {
    const dark = localStorage.getItem("kuditrack_dark") === "1";
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  /* ── Permission refresh ────────────────────────────────────────── */
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
    const onFocus   = () => fetchPerms();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [ownerId, staffId, fetchPerms]);

  /* ── Visible nav ───────────────────────────────────────────────── */
  const visibleNav = useMemo(() =>
    ALL_NAV.filter(n => PINNED.has(n.id) || (allowed.includes(n.id) && !PRINT_MODS.has(n.id))),
    [allowed]
  );

  /* ── Alert counts for nav badges ──────────────────────────────── */
  const todayStr     = today();
  const overdueCount = (store.credits || []).filter(c => c.status !== "paid" && c.due_date && c.due_date < todayStr).length;
  const lowStockCount = (inventory?.lowStock || []).length;

  const navBadge = (id) => {
    if (id === "credit" && overdueCount > 0) return overdueCount;
    if (id === "inventory" && lowStockCount > 0) return lowStockCount;
    return 0;
  };

  /* ── Open bill service from home ───────────────────────────────── */
  const openBillService = useCallback((serviceId) => {
    setBillAutoService(serviceId);
    setTab("bills");
  }, []);

  /* ── Avatar ────────────────────────────────────────────────────── */
  const avatarInitial = (staff?.full_name || "S")[0].toUpperCase();

  /* ── Tab render ────────────────────────────────────────────────── */
  function renderTab() {
    switch (tab) {
      case "home":
        return (
          <StaffHome
            staff={staff}
            store={store}
            inventory={inventory}
            allowed={allowed}
            livePerms={livePerms}
            onBillOpen={openBillService}
            onTabSwitch={setTab}
          />
        );

      case "bills":
        return (
          <BillsGate
            livePerms={livePerms} allowed={allowed}
            store={store} staff={staff} session={session}
            billAutoService={billAutoService}
            onAutoOpened={() => setBillAutoService(null)}
          />
        );

      case "transactions":
        return allowed.includes("transactions") ? (
          <div className="h-full overflow-hidden">
            <Transactions
              store={store}
              plan="starter"
              inventory={inventory}
              readOnly={!canCreate.transactions}
            />
          </div>
        ) : null;

      case "credit":
        return allowed.includes("credit") ? (
          <div className="h-full overflow-hidden">
            <Credit store={store} plan="starter" />
          </div>
        ) : null;

      case "aso":
        return allowed.includes("aso") ? (
          <div className="h-full overflow-hidden">
            <Aso store={store} plan="starter" staffId={staffId} />
          </div>
        ) : null;

      case "inventory":
        return allowed.includes("inventory") ? (
          <div className="h-full overflow-hidden">
            <Inventory
              inventory={inventory}
              isOwner={false}
              canAdd={!!canCreate.inventory}
              plan="starter"
              staffBranchId={staff?.branch_id || null}
            />
          </div>
        ) : null;

      case "insights":
        return allowed.includes("insights") ? (
          <div className="h-full overflow-hidden">
            <Insights
              store={store}
              inventory={inventory}
              plan="starter"
              staffName={staff?.full_name}
            />
          </div>
        ) : null;

      case "settings":
        return (
          <StaffSettings
            staff={staff}
            session={session}
            livePerms={livePerms}
          />
        );

      default:
        setTab("home");
        return null;
    }
  }

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative overflow-hidden">

        {/* Header */}
        <header className="flex-shrink-0 h-14 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 z-30">
          <AppLogo className="h-8 w-8" />
          <p className="text-[15px] font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">KudiAI Track</p>
          <button onClick={() => setTab("settings")}
            className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center shadow-sm active:scale-90 transition-transform relative">
            {staff?.profile_image_url
              ? <img src={staff.profile_image_url} alt="" className="w-9 h-9 rounded-full object-cover" />
              : <span className="text-sm font-black text-white">{avatarInitial}</span>
            }
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-hidden">
          {renderTab()}
        </main>

        {/* Bottom nav */}
        <nav className="flex-shrink-0 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float z-40">
          <div className="flex items-stretch h-[60px]">
            {visibleNav.map(n => {
              const active = tab === n.id;
              const badge  = navBadge(n.id);
              return (
                <button key={n.id} onClick={() => setTab(n.id)}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative focus-visible:outline-none">
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />
                  )}
                  <div className={`relative transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                    <Icon name={n.icon} size={21}
                      className={active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"} />
                    {badge > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center leading-none">
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </div>
                  <span className={`text-[8px] font-bold uppercase tracking-wide leading-none transition-colors ${active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"}`}>
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
