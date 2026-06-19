import { useState, useEffect, useRef, useMemo } from "react";
import { useStore }     from "../hooks/useStore";
import { useInventory } from "../hooks/useInventory";
import { supabase }     from "../utils/supabase";
import { fmt, today }   from "../utils/helpers";
import Transactions     from "./Transactions";
import Credit           from "./Credit";
import Aso              from "./Aso";
import Insights         from "./Insights";
import Inventory        from "./Inventory";
import BillPayments     from "./BillPayments";
import VoiceModal       from "../components/VoiceModal";
import SyncBar          from "../components/SyncBar";
import Icon             from "../components/Icon";
import AppLogo          from "../components/AppLogo";

/* ─── Navigation config ──────────────────────────────────────────────────── */
const ALL_NAV = [
  { id: "home",         icon: "home",      label: "Home"    },
  { id: "bills",        icon: "bills",     label: "Bills"   },
  { id: "transactions", icon: "txn",       label: "Sales"   },
  { id: "credit",       icon: "credit",    label: "Credit"  },
  { id: "aso",          icon: "aso",       label: "Ajo"     },
  { id: "inventory",    icon: "inventory", label: "Stock"   },
  { id: "insights",     icon: "insights",  label: "Reports" },
  { id: "profile",      icon: "user",      label: "Profile" },
];
const PINNED      = new Set(["home", "bills", "profile"]);
const PRINT_MODS  = new Set(["print-airtime", "print-data"]);
const SUPPORT_URL = "https://admin.kudiai.app";

/* ─── Tiny SVG helper ────────────────────────────────────────────────────── */
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
  person:  "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8",
  box:     "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z|M3.27 6.96L12 12.01l8.73-5.05|M12 22.08V12",
  mic:     "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z|M19 10v2a7 7 0 01-14 0v-2|M12 19v4|M8 23h8",
};

function greetingText() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
function fmtDate() {
  return new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/* ─── Stat card ──────────────────────────────────────────────────────────── */
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
        : <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 leading-tight">{value}</p>
      }
      {sub && !loading && <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
    </button>
  );
}

/* ─── Quick action button ────────────────────────────────────────────────── */
function ActionBtn({ label, icon, bg, iconColor, onClick }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150 focus-visible:outline-none">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-md ${bg}`}>
        <Svg d={icon} size={22} color={iconColor} sw={2} />
      </div>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight max-w-[60px]">
        {label}
      </span>
    </button>
  );
}

/* ─── Recent tx row ──────────────────────────────────────────────────────── */
function TxRow({ t }) {
  const isIn = t.type === "in";
  return (
    <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isIn ? "bg-green-50 dark:bg-green-900/30" : "bg-red-50 dark:bg-red-900/30"}`}>
        <Svg d={isIn ? P.in : P.out} size={16} color={isIn ? "#16a34a" : "#ef4444"} sw={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{t.item_name || "Transaction"}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{t.category} · {t.payment_type}</p>
      </div>
      <p className={`text-sm font-extrabold flex-shrink-0 ${isIn ? "text-green-600" : "text-red-500"}`}>
        {isIn ? "+" : "−"}{fmt(t.amount)}
      </p>
    </div>
  );
}

/* ─── Quick bills services on home ──────────────────────────────────────── */
const QUICK_BILL_SERVICES = [
  { id: "airtime",     label: "Airtime",     g1: "#ef4444", g2: "#dc2626", icon: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .82h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" },
  { id: "data",        label: "Data",        g1: "#3b82f6", g2: "#1d4ed8", icon: "M1 6l11-4 11 4|M1 12l11-4 11 4|M1 18l11-4 11 4" },
  { id: "electricity", label: "Electricity", g1: "#f59e0b", g2: "#d97706", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  { id: "cable",       label: "Cable TV",    g1: "#8b5cf6", g2: "#6d28d9", icon: "M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
  { id: "betting",     label: "Betting",     g1: "#10b981", g2: "#059669", icon: "M12 2a10 10 0 100 20A10 10 0 0012 2z|M12 8v4l3 3" },
  { id: "waec",        label: "WAEC",        g1: "#06b6d4", g2: "#0891b2", icon: "M12 2L2 7h20L12 2z|M6 7v13|M18 7v13|M2 17h20" },
];

function QuickBillsCard({ onBillOpen, onVoiceOpen, canVoice }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Quick Services</p>
        <button onClick={() => onBillOpen("bills")} className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
      </div>
      <div className="grid grid-cols-3 gap-y-5">
        {canVoice && (
          <button onClick={onVoiceOpen}
            className="flex flex-col items-center gap-2 active:scale-90 transition-transform">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
              style={{ background: "linear-gradient(135deg,#059669,#065f46)" }}>
              <Svg d={P.mic} size={22} color="white" sw={2} />
            </div>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight">Mic Sale</span>
          </button>
        )}
        {QUICK_BILL_SERVICES.slice(0, canVoice ? 5 : 6).map(s => (
          <button key={s.id} onClick={() => onBillOpen(s.id)}
            className="flex flex-col items-center gap-2 active:scale-90 transition-transform">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm"
              style={{ background: `linear-gradient(135deg,${s.g1},${s.g2})` }}>
              <Svg d={s.icon} size={22} color="white" sw={2} />
            </div>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 text-center leading-tight">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Staff home screen ──────────────────────────────────────────────────── */
function StaffHome({ store, staff, ownerName, allowed, canCreate, setTab, onVoiceOpen, onBillQuick }) {
  const { transactions, credits, asoClients, loading } = store;

  const todayTx  = transactions.filter(t => t.transaction_date === today());
  const cashIn   = todayTx.filter(t => t.type === "in" ).reduce((s, t) => s + Number(t.amount || 0), 0);
  const cashOut  = todayTx.filter(t => t.type === "out").reduce((s, t) => s + Number(t.amount || 0), 0);
  const profit   = cashIn - cashOut;

  const hasTxn     = allowed.includes("transactions");
  const hasCredit  = allowed.includes("credit");
  const hasAso     = allowed.includes("aso");
  const hasBills   = true; // bills is always pinned
  const hasVoice   = hasTxn && canCreate("transactions");

  const totalCredit  = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdueCount = credits.filter(c => c.status === "overdue").length;
  const totalAso     = asoClients.reduce((s, c) => s + c.current_balance, 0);

  const roleLabel = (staff.role || "").replace(/_/g, " ");
  const initials  = (staff.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="px-4 pt-5 pb-32 space-y-5">

      {/* Greeting */}
      <div className="pt-2">
        <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">{greetingText()} 👋</p>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white leading-tight mt-0.5 truncate">
          {staff.full_name || "Staff"}
        </h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 capitalize">
          {roleLabel}{ownerName ? ` · ${ownerName}` : ""}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate()}</p>
      </div>

      {/* Hero card */}
      <div className="rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(145deg,#059669 0%,#047857 55%,#065f46 100%)" }}>
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-6 right-24 w-14 h-14 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Today's Sales</p>
          {loading
            ? <div className="h-12 w-44 bg-white/20 rounded-xl animate-pulse mt-2 mb-5" />
            : <p className={`text-4xl font-black tracking-tight mt-1.5 mb-5 ${profit < 0 ? "text-red-300" : "text-white"}`}>
                {profit < 0 && "−"}{fmt(Math.abs(profit))}
              </p>
          }
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Cash In</p>
              <p className="text-base font-bold">{loading ? "—" : fmt(cashIn)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Cash Out</p>
              <p className="text-base font-bold">{loading ? "—" : fmt(cashOut)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Txns</p>
              <p className="text-base font-bold">{loading ? "—" : todayTx.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Bills services */}
      {hasBills && (
        <QuickBillsCard
          onBillOpen={(id) => { setTab("bills"); onBillQuick(id); }}
          onVoiceOpen={onVoiceOpen}
          canVoice={hasVoice}
        />
      )}

      {/* Stat cards */}
      {(hasTxn || hasCredit || hasAso) && (
        <div className="grid grid-cols-2 gap-3">
          {hasTxn && (
            <>
              <StatCard label="Cash In"  value={fmt(cashIn)}  icon={P.in}  iconBg="bg-green-100 dark:bg-green-900/40"  iconColor="#16a34a" loading={loading} onClick={() => setTab("transactions")} />
              <StatCard label="Cash Out" value={fmt(cashOut)} icon={P.out} iconBg="bg-red-100 dark:bg-red-900/40"    iconColor="#ef4444" loading={loading} onClick={() => setTab("transactions")} />
            </>
          )}
          {hasCredit && (
            <StatCard label="Pending Credit" value={fmt(totalCredit)} icon={P.credit} iconBg="bg-amber-100 dark:bg-amber-900/40" iconColor="#d97706"
              sub={overdueCount > 0 ? `⚠ ${overdueCount} overdue` : `${credits.length} records`} loading={loading} onClick={() => setTab("credit")} />
          )}
          {hasAso && (
            <StatCard label="Ajo Balance" value={fmt(totalAso)} icon={P.bank} iconBg="bg-blue-100 dark:bg-blue-900/40" iconColor="#2563eb"
              sub={`${asoClients.length} clients`} loading={loading} onClick={() => setTab("aso")} />
          )}
        </div>
      )}

      {/* Quick Actions */}
      {(hasTxn || hasCredit || hasAso || allowed.includes("inventory")) && (
        <div>
          <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-3 tracking-wide">Quick Actions</h2>
          <div className="grid grid-cols-3 gap-y-4 gap-x-2">
            {hasTxn && canCreate("transactions") && (
              <ActionBtn label="Cash In"  icon={P.in}  bg="bg-gradient-to-br from-green-500 to-emerald-600" iconColor="white" onClick={() => setTab("transactions")} />
            )}
            {hasTxn && canCreate("transactions") && (
              <ActionBtn label="Cash Out" icon={P.out} bg="bg-gradient-to-br from-red-500 to-red-600"       iconColor="white" onClick={() => setTab("transactions")} />
            )}
            <ActionBtn label="Pay Bills" icon={P.bills} bg="bg-gradient-to-br from-cyan-500 to-teal-600" iconColor="white" onClick={() => setTab("bills")} />
            {hasCredit && canCreate("credit") && (
              <ActionBtn label="Credit Sale" icon={P.credit} bg="bg-gradient-to-br from-amber-400 to-amber-500" iconColor="white" onClick={() => setTab("credit")} />
            )}
            {hasAso && canCreate("aso") && (
              <ActionBtn label="Ajo Client" icon={P.bank} bg="bg-gradient-to-br from-blue-500 to-blue-600" iconColor="white" onClick={() => setTab("aso")} />
            )}
            {allowed.includes("inventory") && (
              <ActionBtn label="Stock" icon={P.box} bg="bg-gradient-to-br from-purple-500 to-violet-600" iconColor="white" onClick={() => setTab("inventory")} />
            )}
            {allowed.includes("insights") && (
              <ActionBtn label="Reports" icon={P.report} bg="bg-gradient-to-br from-slate-500 to-slate-600" iconColor="white" onClick={() => setTab("insights")} />
            )}
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {hasTxn && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">Recent Transactions</h2>
            <button onClick={() => setTab("transactions")}
              className="text-xs text-brand-600 dark:text-brand-400 font-bold tracking-wide">See all</button>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-white dark:bg-slate-800 rounded-2xl animate-pulse border border-slate-100 dark:border-slate-700/50" />)}
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
              <div className="w-12 h-12 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <Svg d={P.report} size={20} color="#94a3b8" sw={1.5} />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No transactions yet</p>
              <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Start recording sales to see them here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.slice(0, 5).map(t => <TxRow key={t.id} t={t} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Staff profile tab ──────────────────────────────────────────────────── */
function StaffProfileTab({ staff, ownerName, livePerms, liveStatus, onSignOut, isDark, onToggleDark }) {
  const roleLabel = (staff.role || "").replace(/_/g, " ");
  const initials  = (staff.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const [showSupport, setShowSupport] = useState(false);
  const [sForm, setSForm] = useState({ subject: "", description: "", type: "general" });
  const [sSubmitting, setSSubmitting] = useState(false);
  const [sDone, setSDone] = useState(null);
  const [sErr,  setSErr]  = useState("");

  const submitTicket = async (e) => {
    e.preventDefault();
    if (!sForm.subject.trim()) { setSErr("Subject required."); return; }
    setSSubmitting(true); setSErr("");
    try {
      const res = await fetch(`${SUPPORT_URL}/api/public/support`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sForm, user_name: staff.full_name, user_email: staff.email, source: "business", submitter_type: "staff" }),
      });
      const d = await res.json();
      if (!res.ok) { setSErr(d.error || "Failed"); return; }
      setSDone(d.ticket_no);
    } catch { setSErr("Network error."); }
    finally { setSSubmitting(false); }
  };

  const fields = [
    { label: "Full Name",    value: staff.full_name },
    { label: "Email",        value: staff.email },
    { label: "Phone",        value: staff.phone },
    { label: "Role",         value: roleLabel, cap: true },
    { label: "Business",     value: ownerName },
    { label: "Status",       value: liveStatus, cap: true },
    { label: "Member Since", value: staff.created_at ? new Date(staff.created_at).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : null },
  ].filter(f => f.value);

  return (
    <div className="px-4 pt-5 pb-32 space-y-4">
      {/* Avatar */}
      <div className="flex flex-col items-center py-4">
        <div className="w-24 h-24 rounded-full overflow-hidden mb-3 border-4 border-green-100 dark:border-green-900/40 shadow-lg">
          {staff.profile_image_url
            ? <img src={staff.profile_image_url} alt={staff.full_name} className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-gradient-to-br from-green-500 to-emerald-700 flex items-center justify-center text-white font-black text-2xl">{initials}</div>
          }
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white">{staff.full_name}</h2>
        <p className="text-sm text-slate-400 dark:text-slate-500 capitalize mt-0.5">{roleLabel}{ownerName ? ` · ${ownerName}` : ""}</p>
        <span className={`mt-2 text-[11px] font-bold px-3 py-1 rounded-full capitalize ${liveStatus === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-600"}`}>
          {liveStatus}
        </span>
      </div>

      {/* Details */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700 border border-slate-100 dark:border-slate-700 shadow-card">
        {fields.map(f => (
          <div key={f.label} className="flex items-start justify-between px-4 py-3 gap-4">
            <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold shrink-0">{f.label}</p>
            <p className={`text-sm font-semibold text-slate-700 dark:text-slate-200 text-right ${f.cap ? "capitalize" : ""}`}>{f.value}</p>
          </div>
        ))}
      </div>

      {/* Module access */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 shadow-card">
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Module Access</p>
        <div className="flex flex-wrap gap-2">
          {(livePerms || []).filter(p => p.can_view).map(p => (
            <span key={p.module} className="text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 px-3 py-1 rounded-full font-semibold capitalize">
              {p.module.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>

      {/* Dark mode */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden shadow-card">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
              {isDark
                ? <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
                : <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
              }
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-white">Dark Mode</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Switch appearance</p>
            </div>
          </div>
          <button onClick={onToggleDark} role="switch" aria-checked={isDark}
            className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${isDark ? "bg-green-500" : "bg-slate-200 dark:bg-slate-600"}`}>
            <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
              style={{ left: isDark ? "calc(100% - 22px)" : "2px" }} />
          </button>
        </div>
      </div>

      <button onClick={() => setShowSupport(true)}
        className="w-full py-3.5 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl text-sm shadow-card">
        Help & Support
      </button>
      <button onClick={onSignOut}
        className="w-full py-3.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-500 font-bold rounded-xl text-sm shadow-card">
        Sign Out
      </button>

      {showSupport && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-4" onClick={e => e.target === e.currentTarget && setShowSupport(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 dark:text-white">Help & Support</h3>
              <button onClick={() => setShowSupport(false)} className="text-slate-400 text-xl leading-none">✕</button>
            </div>
            {sDone ? (
              <div className="text-center py-4 space-y-2">
                <p className="text-3xl">✅</p>
                <p className="font-bold text-slate-800 dark:text-white">Ticket #{sDone} submitted</p>
                <p className="text-xs text-slate-400">Confirmation sent to {staff.email}</p>
                <button onClick={() => { setShowSupport(false); setSDone(null); }} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold text-sm">Close</button>
              </div>
            ) : (
              <form onSubmit={submitTicket} className="space-y-3">
                <select className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none"
                  value={sForm.type} onChange={e => setSForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="general">General Enquiry</option>
                  <option value="account">Account / Login</option>
                  <option value="transaction">Transaction Issue</option>
                  <option value="technical">Technical Problem</option>
                </select>
                <input className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none"
                  value={sForm.subject} onChange={e => setSForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject *" required />
                <textarea className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none resize-none h-20"
                  value={sForm.description} onChange={e => setSForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe your issue…" />
                {sErr && <p className="text-xs text-red-500">{sErr}</p>}
                <button type="submit" disabled={sSubmitting}
                  className="w-full py-3 bg-indigo-600 disabled:opacity-50 text-white rounded-xl font-semibold text-sm">
                  {sSubmitting ? "Submitting…" : "Submit Ticket"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main export ────────────────────────────────────────────────────────── */
export default function StaffDashboard({ session, staff }) {
  const ownerId   = staff.owner_id;
  const staffId   = staff.id;
  const staffName = staff.full_name;
  const branchId  = staff?.branch_id || null;

  const store     = useStore(ownerId, staffId, staffName);
  const inventory = useInventory(ownerId, staffId, null, branchId);

  const [staffBranch, setStaffBranch] = useState(null);
  useEffect(() => {
    if (branchId && supabase) {
      supabase.from("branches").select("id, name").eq("id", branchId).maybeSingle()
        .then(({ data }) => { if (data) setStaffBranch(data); });
    }
  }, [branchId]);

  /* ── Live permissions ─────────────────────────────────────────────── */
  const [livePerms,  setLivePerms]  = useState(staff.staff_permissions || []);
  const [liveStatus, setLiveStatus] = useState(staff.status);

  useEffect(() => {
    if (!supabase || !staffId) return;

    const refreshPerms = () => {
      supabase.from("staff_permissions").select("*").eq("staff_id", staffId)
        .then(({ data }) => { if (data) setLivePerms(data); });
      supabase.from("staff").select("status").eq("id", staffId).maybeSingle()
        .then(({ data }) => { if (data?.status) setLiveStatus(data.status); });
    };

    refreshPerms();

    const onVisibility = () => { if (document.visibilityState === "visible") refreshPerms(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refreshPerms);
    const poll = setInterval(refreshPerms, 8_000);

    const broadcast = supabase.channel(`perms_${ownerId}`)
      .on("broadcast", { event: "permissions_changed" }, ({ payload }) => {
        if (payload?.staffId === staffId) refreshPerms();
      }).subscribe();

    const ch = supabase.channel(`staff_live_${staffId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_permissions", filter: `staff_id=eq.${staffId}` }, refreshPerms)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "staff", filter: `id=eq.${staffId}` }, ({ new: row }) => {
        if (row?.status) setLiveStatus(row.status);
      }).subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refreshPerms);
      clearInterval(poll);
      supabase.removeChannel(broadcast);
      supabase.removeChannel(ch);
    };
  }, [staffId, ownerId]);

  /* ── Derived permissions ──────────────────────────────────────────── */
  const allowed = useMemo(() =>
    livePerms.filter(p => p.can_view && !PRINT_MODS.has(p.module)).map(p => p.module),
  [livePerms]);

  const canCreate = (module) => livePerms.some(p => p.module === module && p.can_create);

  /* ── Owner plan (for enterprise print gates) ──────────────────────── */
  const [ownerPlan, setOwnerPlan] = useState("starter");
  const planFetched = useRef(false);
  useEffect(() => {
    if (planFetched.current || !supabase) return;
    planFetched.current = true;
    supabase.from("subscriptions").select("plan").eq("user_id", ownerId).eq("status", "active").maybeSingle()
      .then(({ data }) => { if (data?.plan) setOwnerPlan(data.plan); });
  }, [ownerId]);

  const isEnterprise     = ownerPlan === "enterprise";
  const canPrintAirtime  = isEnterprise && livePerms.some(p => p.module === "print-airtime" && p.can_view);
  const canPrintData     = isEnterprise && livePerms.some(p => p.module === "print-data"    && p.can_view);
  const billExcludeCats  = [
    ...(!canPrintAirtime ? ["print-airtime"] : []),
    ...(!canPrintData    ? ["print-data"]    : []),
  ];

  /* ── Tab / navigation state ───────────────────────────────────────── */
  const [tab, setTab] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "bills";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "bills";
    return "home";
  });

  const [billAutoService, setBillAutoService] = useState(null);
  const [voiceOpen,   setVoiceOpen]   = useState(false);
  const [autoAdd,     setAutoAdd]     = useState(null);
  const [ownerName,   setOwnerName]   = useState("");
  const [isDark,      setIsDark]      = useState(() => localStorage.getItem("kuditrack_staff_dark") === "1");

  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  const toggleDark = () => { const n = !isDark; setIsDark(n); localStorage.setItem("kuditrack_staff_dark", n ? "1" : "0"); };

  // Paystack return: switch to bills
  useEffect(() => {
    const p   = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) setTab("bills");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Evict non-pinned tabs if permission revoked
  useEffect(() => {
    if (!PINNED.has(tab) && !allowed.includes(tab)) setTab("home");
  }, [livePerms]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.from("profiles").select("business_name, full_name").eq("id", ownerId).maybeSingle()
      .then(({ data }) => { if (data) setOwnerName(data.business_name || data.full_name || ""); });
  }, [ownerId]);

  /* ── Change password flow ─────────────────────────────────────────── */
  const mustChangePassword = Boolean(session?.user?.user_metadata?.must_change_password);
  const [newPassword,      setNewPassword]      = useState("");
  const [confirmPassword,  setConfirmPassword]  = useState("");
  const [passwordError,    setPasswordError]    = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const changePassword = async () => {
    setPasswordError("");
    if (newPassword.length < 8) { setPasswordError("Password must be at least 8 characters"); return; }
    if (newPassword !== confirmPassword) { setPasswordError("Passwords do not match"); return; }
    setChangingPassword(true);
    const metadata = { ...(session.user.user_metadata || {}), must_change_password: false };
    const { error } = await supabase.auth.updateUser({ password: newPassword, data: metadata });
    if (error) setPasswordError(error.message);
    else window.location.reload();
    setChangingPassword(false);
  };

  /* ── Suspended ────────────────────────────────────────────────────── */
  if (liveStatus !== "active") {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-red-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Account Suspended</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Your manager has suspended this staff account. Contact them to restore access.</p>
        <button onClick={() => supabase.auth.signOut()} className="bg-red-50 border border-red-200 text-red-500 font-semibold text-sm px-6 py-3 rounded-xl">Sign Out</button>
      </div>
    );
  }

  /* ── Build visible nav ────────────────────────────────────────────── */
  const visibleNav = ALL_NAV.filter(n => PINNED.has(n.id) || allowed.includes(n.id));

  /* ── Tab content ──────────────────────────────────────────────────── */
  const renderTab = () => {
    // Non-pinned tabs evicted when permission gone
    if (!PINNED.has(tab) && !allowed.includes(tab)) return null;

    // Bills — show "not enabled" only if explicitly missing from livePerms rows
    if (tab === "bills" && !allowed.includes("bills") && livePerms.length > 0) {
      return (
        <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/20 rounded-2xl flex items-center justify-center mb-4 text-amber-500">
            <Icon name="bills" size={28} />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-white mb-2">Bill Payments Not Enabled</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Your manager has not enabled bill payments for your account.</p>
        </div>
      );
    }

    switch (tab) {
      case "home":
        return (
          <StaffHome
            store={store}
            staff={staff}
            ownerName={ownerName}
            allowed={allowed}
            canCreate={canCreate}
            setTab={setTab}
            onVoiceOpen={() => setVoiceOpen(true)}
            onBillQuick={(serviceId) => {
              setBillAutoService(serviceId === "bills" ? null : serviceId);
            }}
          />
        );
      case "bills":
        return (
          <BillPayments
            store={store}
            plan="premium"
            markup={1.098}
            airtimeDiscount={0.01}
            pointsEnabled
            staffName={staffName}
            staffEmail={staff.email}
            businessName={ownerName}
            excludeCats={billExcludeCats}
            autoService={billAutoService}
            onAutoOpened={() => setBillAutoService(null)}
          />
        );
      case "transactions":
        return (
          <Transactions
            store={store}
            plan="premium"
            autoOpen={autoAdd?.tab === "transactions"}
            autoType={autoAdd?.type}
            onAutoOpened={() => setAutoAdd(null)}
            onVoiceOpen={() => setVoiceOpen(true)}
            onUpgrade={() => {}}
            readOnly={!canCreate("transactions")}
            inventory={inventory}
          />
        );
      case "credit":
        return <Credit store={store} plan="premium" autoOpen={autoAdd?.tab === "credit"} onAutoOpened={() => setAutoAdd(null)} onUpgrade={() => {}} readOnly={!canCreate("credit")} />;
      case "aso":
        return <Aso store={store} plan="premium" autoOpen={autoAdd?.tab === "aso"} onAutoOpened={() => setAutoAdd(null)} onUpgrade={() => {}} readOnly={!canCreate("aso")} staffId={staffId} />;
      case "inventory":
        return <Inventory inventory={inventory} isOwner={false} canAdd={canCreate("inventory")} plan="business" onUpgrade={() => {}} branches={staffBranch ? [staffBranch] : []} staffBranchId={branchId} />;
      case "insights":
        return <Insights store={store} plan="premium" onUpgrade={() => {}} staffName={staffName} />;
      case "profile":
        return (
          <StaffProfileTab
            staff={staff}
            ownerName={ownerName}
            livePerms={livePerms}
            liveStatus={liveStatus}
            onSignOut={() => supabase.auth.signOut()}
            isDark={isDark}
            onToggleDark={toggleDark}
          />
        );
      default:
        return null;
    }
  };

  /* ── Render ───────────────────────────────────────────────────────── */
  return (
    <div className={isDark ? "dark" : ""}>
      <div className="h-screen bg-slate-50 dark:bg-slate-900 flex justify-center">
        <div className="w-full max-w-md relative flex flex-col h-screen">
          <SyncBar isOnline={store.isOnline} pending={store.pendingSync} isSyncing={store.isSyncing} onSync={store.runSync} />

          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pt-11 pb-2 flex items-center gap-2 shadow-sm">
            <AppLogo className="h-8 w-auto flex-shrink-0" />

            <div className="flex-1 flex justify-center items-baseline gap-0.5 select-none">
              <span className="text-[18px] font-black tracking-tight text-slate-800 dark:text-white leading-none">Kudi</span>
              <span className="text-[18px] font-black tracking-tight leading-none"
                style={{ background: "linear-gradient(135deg,#16a34a,#059669)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
              <span className="text-[12px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase leading-none ml-1">Track</span>
            </div>

            {/* Avatar → profile */}
            <button onClick={() => setTab("profile")} aria-label="Profile"
              className="w-9 h-9 rounded-full border-2 border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden active:scale-95 transition-transform flex-shrink-0">
              {staff.profile_image_url
                ? <img src={staff.profile_image_url} alt={staff.full_name} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-green-500 to-emerald-700 flex items-center justify-center">
                    <Svg d={P.person} size={18} color="white" sw={2} />
                  </div>
              }
            </button>
          </div>

          {/* ── Main content ───────────────────────────────────────── */}
          <main className="flex-1 overflow-y-auto">
            {renderTab()}
          </main>

          {/* ── Bottom nav ─────────────────────────────────────────── */}
          <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float">
            <div className="flex items-stretch h-[60px]">
              {visibleNav.map(n => {
                const isActive = tab === n.id;
                return (
                  <button key={n.id} onClick={() => setTab(n.id)}
                    aria-label={n.label}
                    aria-current={isActive ? "page" : undefined}
                    className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors duration-150 focus-visible:outline-none">
                    {isActive && (
                      <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />
                    )}
                    <div className={`transition-all duration-200 ${isActive ? "scale-110" : "scale-100"}`}>
                      <Icon name={n.icon} size={21}
                        className={isActive ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"} />
                    </div>
                    <span className={`text-[8px] font-bold uppercase tracking-wide leading-none transition-colors duration-150 ${
                      isActive ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"
                    }`}>{n.label}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
          </nav>

          {/* ── Voice modal ────────────────────────────────────────── */}
          {voiceOpen && canCreate("transactions") && (
            <VoiceModal
              onClose={() => setVoiceOpen(false)}
              onSave={txn => { store.addTransaction(txn); setVoiceOpen(false); }}
            />
          )}

          {/* ── DB error toast ─────────────────────────────────────── */}
          {store.dbError && (
            <div className="fixed bottom-20 left-4 right-4 max-w-md mx-auto z-50 bg-red-600 text-white rounded-2xl px-4 py-3 shadow-lg flex items-start gap-3" role="alert">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Save failed</p>
                <p className="text-xs opacity-80 mt-0.5 break-words">{store.dbError}</p>
              </div>
              <button onClick={store.clearDbError} className="text-white/70 hover:text-white">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {/* ── Force password change ──────────────────────────────── */}
          {mustChangePassword && (
            <div className="fixed inset-0 z-[80] bg-slate-950/70 flex items-center justify-center px-5">
              <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl">
                <div className="w-12 h-12 bg-green-100 text-green-700 rounded-2xl flex items-center justify-center mb-4">
                  <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Create Your Password</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5">Replace the temporary password your manager gave you.</p>
                <div className="space-y-3">
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password"
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm new password"
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {passwordError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{passwordError}</p>}
                  <button onClick={changePassword} disabled={changingPassword}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold rounded-xl py-3 text-sm">
                    {changingPassword ? "Updating..." : "Set Password & Continue"}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
