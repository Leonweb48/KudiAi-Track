import { useState, useEffect } from "react";
import { useStore }      from "../hooks/useStore";
import { useInventory }  from "../hooks/useInventory";
import { useNotifications } from "../hooks/useNotifications";
import { supabase }      from "../utils/supabase";
import { fmt, today }    from "../utils/helpers";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import Transactions      from "./Transactions";
import Credit            from "./Credit";
import Aso               from "./Aso";
import Inventory         from "./Inventory";
import SyncBar           from "../components/SyncBar";
import Icon              from "../components/Icon";
import { LanguageProvider } from "../contexts/LanguageContext";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildTransactionReceipt } from "../utils/receiptConfig";

const NAV = [
  { id: "overview",     icon: "home",      label: "Overview"  },
  { id: "transactions", icon: "txn",       label: "Sales"     },
  { id: "inventory",    icon: "inventory", label: "Stock"     },
  { id: "credit",       icon: "credit",    label: "Credit"    },
  { id: "aso",          icon: "aso",       label: "Ajo"       },
];

function StatCard({ label, value, color = "text-slate-800 dark:text-white", sub }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700/50">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-xl font-extrabold tabular leading-tight truncate ${color}`} style={{ minWidth: 0 }}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Overview({ store, branchName }) {
  const { transactions, credits, asoClients, loading } = store;
  const [receipt, setReceipt] = useState(null);

  const todayTx   = transactions.filter(t => t.transaction_date === today());
  const cashIn    = todayTx.filter(t => t.type === "in" ).reduce((s, t) => s + t.amount, 0);
  const cashOut   = todayTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit    = cashIn - cashOut;

  const now      = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthSales = transactions
    .filter(t => t.type === "in" && (t.transaction_date || "").startsWith(monthStr))
    .reduce((s, t) => s + t.amount, 0);

  const openCredits  = credits.filter(c => c.status !== "paid");
  const outstanding  = openCredits.reduce((s, c) => s + c.outstanding, 0);
  const totalAso     = asoClients.reduce((s, c) => s + c.current_balance, 0);

  const recent = transactions.slice(0, 5);

  return (
    <div className="px-4 pt-5 pb-28 space-y-5">
      {/* Hero */}
      <div className="rounded-3xl px-6 py-6 text-white shadow-lg bg-[linear-gradient(145deg,#7c3aed_0%,#6d28d9_55%,#4c1d95_100%)]">
        <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Today's Profit</p>
        {loading
          ? <div className="h-10 w-40 bg-white/20 rounded-xl animate-pulse mt-2 mb-4" />
          : <AmountDisplay amount={Math.abs(profit)} size="hero" align="left" className="mt-1.5 mb-4" style={{ color: profit < 0 ? '#fca5a5' : '#fff' }} />
        }
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest">In</p>
            {loading ? <p className="text-base font-bold">—</p> : <AmountDisplay amount={cashIn} size="row" align="left" className="text-white font-bold" />}
          </div>
          <div className="w-px bg-white/20 self-stretch" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest">Out</p>
            {loading ? <p className="text-base font-bold">—</p> : <AmountDisplay amount={cashOut} size="row" align="left" className="text-white font-bold" />}
          </div>
          <div className="w-px bg-white/20 self-stretch" />
          <div>
            <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest">Txns</p>
            <p className="text-base font-bold">{loading ? "—" : todayTx.length}</p>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Month Sales"    value={fmt(monthSales)}       color="text-green-600 dark:text-green-400" />
        <StatCard label="Open Credits"   value={fmt(outstanding)}      color="text-amber-600 dark:text-amber-400" sub={`${openCredits.length} record${openCredits.length !== 1 ? "s" : ""}`} />
        <StatCard label="Aso Collections" value={fmt(totalAso)}        color="text-blue-600 dark:text-blue-400"   sub={`${asoClients.length} clients`} />
        <StatCard label="Total Txns"     value={transactions.length}   color="text-violet-600 dark:text-violet-400" />
      </div>

      {/* Recent transactions */}
      {recent.length > 0 && (
        <div>
          <p className="text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-2">Recent Transactions</p>
          <div className="space-y-2">
            {recent.map(tx => (
              <button key={tx.id} onClick={() => setReceipt(buildTransactionReceipt(tx, store.profile))}
                className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 flex items-center gap-3 border border-slate-100 dark:border-slate-700/50 active:scale-[0.98] transition-transform">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${tx.type === "in" ? "bg-green-500" : "bg-red-400"}`} />
                <p className="flex-1 text-sm text-slate-700 dark:text-slate-200 truncate font-medium">{tx.item_name || tx.category}</p>
                <span className={`text-sm font-extrabold flex-shrink-0 tabular ${tx.type === "in" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {tx.type === "in" ? "+" : "−"}{fmt(tx.amount)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {transactions.length === 0 && !loading && (
        <div className="text-center py-12">
          <p className="text-slate-400 text-sm font-semibold">No transactions yet for this branch</p>
          <p className="text-slate-400 text-xs mt-1">Go to Sales to record a transaction</p>
        </div>
      )}

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function ProfileTab({ staff, ownerName, onSignOut }) {
  const roleLabel = (staff.role || "").replace(/_/g, " ");
  const initials  = (staff.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="px-4 pt-5 pb-28 space-y-4">
      <div className="flex flex-col items-center py-5">
        <div className="w-20 h-20 rounded-full overflow-hidden mb-3 border-4 border-violet-200 dark:border-violet-800">
          {staff.profile_image_url
            ? <img src={staff.profile_image_url} alt={staff.full_name} className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-700 dark:text-violet-300 font-black text-2xl">{initials}</div>
          }
        </div>
        <h2 className="text-lg font-extrabold text-slate-800 dark:text-white">{staff.full_name}</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 capitalize mt-0.5">Branch Manager{ownerName ? ` · ${ownerName}` : ""}</p>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-700 border border-slate-100 dark:border-slate-700">
        {[
          { label: "Full Name", value: staff.full_name },
          { label: "Email",     value: staff.email },
          { label: "Phone",     value: staff.phone },
          { label: "Role",      value: roleLabel, cap: true },
          { label: "Business",  value: ownerName },
          { label: "Status",    value: staff.status, cap: true },
        ].filter(f => f.value).map(f => (
          <div key={f.label} className="flex items-start justify-between px-4 py-3 gap-4">
            <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold shrink-0">{f.label}</p>
            <p className={`text-sm font-semibold text-slate-700 dark:text-slate-200 text-right ${f.cap ? "capitalize" : ""}`}>{f.value}</p>
          </div>
        ))}
      </div>

      <button onClick={onSignOut}
        className="w-full py-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-800">
        Sign Out
      </button>
    </div>
  );
}

export default function BranchManagerDashboard({ session, staff }) {
  const [tab, setTab] = useState("overview");

  const ownerId    = staff?.owner_id;
  const branchId   = staff?.branch_id;
  const staffId    = staff?.id;
  const staffName  = staff?.full_name;

  const notif    = useNotifications(ownerId);
  const { addNotification } = notif;

  const store     = useStore(ownerId, staffId, staffName, addNotification, branchId);
  const inventory = useInventory(ownerId, staffId, addNotification, branchId);

  const isDark = store.profile?.dark_mode;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !!isDark);
  }, [isDark]);

  const [ownerName,   setOwnerName]   = useState("");
  const [branchName,  setBranchName]  = useState("Branch");

  useEffect(() => {
    if (!ownerId) return;
    supabase.from("profiles").select("business_name, full_name").eq("id", ownerId).maybeSingle()
      .then(({ data }) => { if (data) setOwnerName(data.business_name || data.full_name || ""); });
  }, [ownerId]);

  useEffect(() => {
    if (!branchId) return;
    supabase.from("branches").select("name").eq("id", branchId).maybeSingle()
      .then(({ data }) => { if (data) setBranchName(data.name); });
  }, [branchId]);

  const handleSignOut = () => supabase.auth.signOut();

  const SCREENS = {
    overview:     <Overview     store={store} branchName={branchName} />,
    transactions: <Transactions store={store} plan="premium" inventory={inventory} />,
    inventory:    <Inventory    inventory={inventory} isOwner={true}  plan="premium" />,
    credit:       <Credit       store={store} plan="premium" />,
    aso:          <Aso          store={store} plan="premium" />,
    profile:      <ProfileTab   staff={staff} ownerName={ownerName} onSignOut={handleSignOut} />,
  };

  const allTabs = [
    ...NAV,
    { id: "profile", icon: "user", label: "Profile" },
  ];

  return (
    <LanguageProvider>
    <div className={isDark ? "dark" : ""}>
      <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 flex justify-center">
        <div className="w-full max-w-md relative flex flex-col h-[100dvh]">
          <SyncBar isOnline={store.isOnline} pending={store.pendingSync} isSyncing={store.isSyncing} onSync={store.runSync} />

          {/* Header */}
          <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 pb-3 flex items-center gap-2.5" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
            <div className="w-8 h-8 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
              <Icon name="home" size={16} className="text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide leading-none">Branch Manager</p>
              <p className="text-sm font-bold text-slate-800 dark:text-white truncate leading-tight">{branchName}</p>
            </div>
            <span className="text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-bold px-2 py-1 rounded-full">
              {ownerName}
            </span>
          </div>

          <main className="flex-1 overflow-y-auto overscroll-contain">
            {SCREENS[tab]}
          </main>

          {/* Bottom nav */}
          <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 z-30" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="flex">
              {allTabs.map(n => (
                <button key={n.id} onClick={() => setTab(n.id)}
                  className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors ${tab === n.id ? "text-violet-600 dark:text-violet-400" : "text-slate-400 dark:text-slate-500"}`}>
                  <Icon name={n.icon} size={20} />
                  <span className="text-[9px] font-semibold leading-none">{n.label}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </div>
    </LanguageProvider>
  );
}
