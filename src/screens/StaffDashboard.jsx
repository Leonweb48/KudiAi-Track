import { useState, useEffect, useCallback } from "react";
import { supabase }    from "../utils/supabase";
import { useStore }    from "../hooks/useStore";
import { fmt, today }  from "../utils/helpers";
import AppLogo         from "../components/AppLogo";
import Icon            from "../components/Icon";
import BillPayments    from "./BillPayments";

/* ─── Greeting ───────────────────────────────────────────────────── */
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

/* ─── SVG helper ─────────────────────────────────────────────────── */
function Svg({ d, size = 18, color = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const P = {
  in:          "M12 19V5|M5 12l7-7 7 7",
  out:         "M12 5v14|M19 12l-7 7-7-7",
  txn:         "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  credit:      "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8|M23 21v-2a4 4 0 00-3-3.87|M16 3.13a4 4 0 010 7.75",
  aso:         "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z|M9 22V12h6v10",
  inventory:   "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z|M7 7h.01",
  insights:    "M18 20V10|M12 20V4|M6 20v-6",
  bills:       "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2",
  user:        "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2|M12 11a4 4 0 100-8 4 4 0 000 8",
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
};

/* ─── Nav definition ─────────────────────────────────────────────── */
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
const PINNED     = new Set(["home", "bills", "profile"]);
const PRINT_MODS = new Set(["print-airtime", "print-data"]);

/* ─── Quick bill services ────────────────────────────────────────── */
const BILL_SERVICES = [
  { id: "airtime",     label: "Airtime",     g1: "#ef4444", g2: "#dc2626", icon: "airtime"     },
  { id: "data",        label: "Data",         g1: "#3b82f6", g2: "#1d4ed8", icon: "data"        },
  { id: "electricity", label: "Electricity",  g1: "#f59e0b", g2: "#d97706", icon: "electricity" },
  { id: "cable",       label: "Cable TV",     g1: "#8b5cf6", g2: "#6d28d9", icon: "cable"       },
  { id: "betting",     label: "Betting",      g1: "#10b981", g2: "#059669", icon: "betting"     },
];

/* ─── Stat card ──────────────────────────────────────────────────── */
function StatCard({ label, value, iconPath, iconBg, iconColor, sub, loading }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Svg d={iconPath} size={16} color={iconColor} sw={2.5} />
        </div>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-tight">{label}</span>
      </div>
      {loading
        ? <div className="h-6 w-20 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
        : <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{value}</p>
      }
      {sub && !loading && (
        <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">{sub}</p>
      )}
    </div>
  );
}

/* ─── Recent tx row ──────────────────────────────────────────────── */
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
      <p className={`text-sm font-extrabold tabular flex-shrink-0 ${isIn ? "text-green-600" : "text-red-500"}`}>
        {isIn ? "+" : "−"}{fmt(t.amount)}
      </p>
    </div>
  );
}

/* ─── Home tab ───────────────────────────────────────────────────── */
function StaffHome({ staff, store, allowed, onBillOpen }) {
  const { transactions = [], credits = [], asoClients = [], loading } = store;

  const todayTx  = transactions.filter(t => t.transaction_date === today());
  const cashIn   = todayTx.filter(t => t.type === "in" ).reduce((s, t) => s + t.amount, 0);
  const cashOut  = todayTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const profit   = cashIn - cashOut;

  const openCredits   = credits.filter(c => c.status !== "paid");
  const outstanding   = openCredits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const totalAso      = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const recent        = transactions.slice(0, 5);

  const name = (staff?.full_name || "").split(" ")[0] || "Staff";

  return (
    <div className="px-4 pt-5 pb-28 space-y-5 overflow-y-auto h-full">
      {/* Greeting */}
      <div>
        <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">
          {greeting()}, {name} 👋
        </p>
        <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-0.5">{fmtDate()}</p>
      </div>

      {/* Hero profit card */}
      <div className="rounded-3xl px-6 py-6 text-white shadow-lg"
        style={{ background: "linear-gradient(145deg,#16a34a 0%,#15803d 55%,#14532d 100%)" }}>
        <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Today's Profit</p>
        {loading
          ? <div className="h-10 w-40 bg-white/20 rounded-xl animate-pulse mt-2 mb-4" />
          : <p className="text-4xl font-black tabular mt-1 mb-4">{fmt(profit)}</p>
        }
        <div className="flex gap-6">
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">Cash In</p>
            {loading
              ? <div className="h-5 w-20 bg-white/20 rounded mt-0.5 animate-pulse" />
              : <p className="text-base font-extrabold tabular">{fmt(cashIn)}</p>
            }
          </div>
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold">Cash Out</p>
            {loading
              ? <div className="h-5 w-20 bg-white/20 rounded mt-0.5 animate-pulse" />
              : <p className="text-base font-extrabold tabular">{fmt(cashOut)}</p>
            }
          </div>
        </div>
      </div>

      {/* Quick bill services */}
      {allowed.includes("bills") && (
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Quick Services</p>
            <button onClick={() => onBillOpen("airtime")}
              className="text-[11px] font-bold text-brand-600 dark:text-brand-400">See all</button>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {BILL_SERVICES.map(s => (
              <button key={s.id} onClick={() => onBillOpen(s.id)}
                className="flex flex-col items-center gap-2 active:scale-90 transition-transform">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-md"
                  style={{ background: `linear-gradient(135deg, ${s.g1}, ${s.g2})` }}>
                  <Svg d={P[s.icon]} size={20} color="#fff" sw={2} />
                </div>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 text-center leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        {allowed.includes("transactions") && (
          <StatCard label="Today's Sales" loading={loading}
            value={todayTx.filter(t => t.type === "in").length + " sales"}
            sub={fmt(cashIn)} iconPath={P.txn} iconBg="bg-green-50 dark:bg-green-900/30" iconColor="#16a34a" />
        )}
        {allowed.includes("credit") && (
          <StatCard label="Credit Out" loading={loading}
            value={fmt(outstanding)} sub={openCredits.length + " open"}
            iconPath={P.credit} iconBg="bg-orange-50 dark:bg-orange-900/30" iconColor="#f97316" />
        )}
        {allowed.includes("aso") && (
          <StatCard label="Ajo Savings" loading={loading}
            value={fmt(totalAso)} sub={asoClients.length + " members"}
            iconPath={P.aso} iconBg="bg-purple-50 dark:bg-purple-900/30" iconColor="#8b5cf6" />
        )}
        {allowed.includes("inventory") && (
          <StatCard label="Stock Items" loading={loading}
            value={store.stockItems?.length ?? "—"} sub="items tracked"
            iconPath={P.inventory} iconBg="bg-blue-50 dark:bg-blue-900/30" iconColor="#3b82f6" />
        )}
      </div>

      {/* Recent transactions */}
      {allowed.includes("transactions") && (
        <div className="space-y-2">
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1">Recent Sales</p>
          {loading
            ? [1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-white dark:bg-slate-800 rounded-2xl animate-pulse border border-slate-100 dark:border-slate-700/50" />
              ))
            : recent.length === 0
              ? <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">No transactions yet today</p>
              : recent.map((t, i) => <TxRow key={t.id || i} t={t} />)
          }
        </div>
      )}
    </div>
  );
}

/* ─── Profile tab ────────────────────────────────────────────────── */
function StaffProfileTab({ staff, livePerms, onSignOut }) {
  const [isDark, setIsDark] = useState(() => localStorage.getItem("kuditrack_dark") === "1");
  const [msg, setMsg]       = useState("");
  const [sent, setSent]     = useState(false);
  const [sending, setSending] = useState(false);

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
        sender_id:   staff?.user_id,
        sender_name: staff?.full_name,
        sender_role: "staff",
        message:     msg.trim(),
      });
      setSent(true);
      setMsg("");
    } catch { /* ignore */ }
    setSending(false);
  };

  const initials = (staff?.full_name || "S").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const MODULE_LABELS = {
    bills: "Bills", transactions: "Sales", credit: "Credit",
    aso: "Ajo", inventory: "Stock", insights: "Reports",
    "print-airtime": "Print Airtime", "print-data": "Print Data",
  };

  return (
    <div className="px-4 pt-5 pb-28 space-y-5 overflow-y-auto h-full">
      {/* Avatar + name */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <div className="w-20 h-20 rounded-full bg-brand-500 flex items-center justify-center shadow-lg">
          {staff?.profile_image_url
            ? <img src={staff.profile_image_url} alt="" className="w-20 h-20 rounded-full object-cover" />
            : <span className="text-2xl font-black text-white">{initials}</span>
          }
        </div>
        <div className="text-center">
          <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{staff?.full_name || "Staff"}</p>
          <p className="text-[12px] font-semibold text-brand-600 dark:text-brand-400 capitalize">{staff?.role || "Staff"}</p>
        </div>
      </div>

      {/* Detail cards */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-card border border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
        {[
          { icon: P.mail,  label: "Email",    value: staff?.email    || "—" },
          { icon: P.phone, label: "Phone",    value: staff?.phone    || "—" },
          { icon: P.user,  label: "Business", value: staff?.business_name || "—" },
        ].map(row => (
          <div key={row.label} className="flex items-center gap-3 px-4 py-3.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
              <Svg d={row.icon} size={15} color="#64748b" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{row.label}</p>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{row.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Module access badges */}
      {livePerms.length > 0 && (
        <div>
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest px-1 mb-2">Module Access</p>
          <div className="flex flex-wrap gap-2">
            {livePerms.map(p => (
              <div key={p.module}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold border ${p.can_view ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700/50" : "bg-slate-100 dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600"}`}>
                {MODULE_LABELS[p.module] || p.module}
                {p.can_create && <span className="ml-1 opacity-60">+write</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dark mode toggle */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <Svg d={isDark ? P.moon : P.sun} size={15} color="#64748b" />
          </div>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Dark Mode</span>
        </div>
        <button onClick={toggleDark}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none ${isDark ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-600"}`}>
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${isDark ? "left-6" : "left-1"}`} />
        </button>
      </div>

      {/* Support form */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50 space-y-3">
        <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Help & Support</p>
        {sent
          ? (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Svg d={P.check} size={16} color="currentColor" />
              <p className="text-sm font-semibold">Message sent!</p>
            </div>
          ) : (
            <>
              <textarea value={msg} onChange={e => setMsg(e.target.value)}
                placeholder="Describe your issue or question…"
                rows={3}
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

      {/* Sign out */}
      <button onClick={onSignOut}
        className="w-full h-12 rounded-2xl border border-red-200 dark:border-red-800/50 text-red-500 dark:text-red-400 text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition bg-white dark:bg-slate-800">
        <Svg d={P.signout} size={16} color="currentColor" />
        Sign Out
      </button>
    </div>
  );
}

/* ─── Main StaffDashboard ────────────────────────────────────────── */
export default function StaffDashboard({ session, staff }) {
  const [tab,             setTab]             = useState("home");
  const [livePerms,       setLivePerms]       = useState(staff?.staff_permissions || []);
  const [billAutoService, setBillAutoService] = useState(null);

  const staffId  = staff?.id;
  const ownerId  = staff?.owner_id;
  const staffEmail = session?.user?.email || staff?.email || "";

  // Data store scoped to this staff member
  const store = useStore(null, staffId, staff?.full_name);

  // Derived permissions
  const allowed = livePerms.filter(p => p.can_view).map(p => p.module);

  // Evict to home if current tab loses permission
  useEffect(() => {
    if (!PINNED.has(tab) && !allowed.includes(tab)) setTab("home");
  }, [allowed, tab]);

  // Dark mode: initialise from localStorage
  useEffect(() => {
    const dark = localStorage.getItem("kuditrack_dark") === "1";
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  /* ── Permission refresh ────────────────────────────────────────── */
  const fetchPerms = useCallback(async () => {
    if (!staffId) return;
    const { data } = await supabase
      .from("staff_permissions")
      .select("*")
      .eq("staff_id", staffId);
    if (data) setLivePerms(data);
  }, [staffId]);

  useEffect(() => {
    if (!ownerId || !staffId) return;

    // Broadcast: owner saves permissions → staff sees update immediately
    const ch = supabase.channel(`perms_${ownerId}`);
    ch.on("broadcast", { event: "permissions_changed" }, ({ payload }) => {
      if (payload?.staffId === staffId) fetchPerms();
    }).subscribe();

    // Periodic poll
    const interval = setInterval(fetchPerms, 8000);

    // Visibility / focus refresh
    const onVisible = () => { if (document.visibilityState === "visible") fetchPerms(); };
    const onFocus   = () => fetchPerms();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      supabase.removeChannel(ch);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [ownerId, staffId, fetchPerms]);

  /* ── Nav items ─────────────────────────────────────────────────── */
  const visibleNav = ALL_NAV.filter(n =>
    PINNED.has(n.id) ||
    (allowed.includes(n.id) && !PRINT_MODS.has(n.id))
  );

  /* ── Home quick-service deep-link ──────────────────────────────── */
  const openBillService = (serviceId) => {
    setBillAutoService(serviceId);
    setTab("bills");
  };

  /* ── Avatar initials ───────────────────────────────────────────── */
  const avatarInitial = (staff?.full_name || "S")[0].toUpperCase();

  /* ── Tab content ───────────────────────────────────────────────── */
  function renderTab() {
    switch (tab) {
      case "home":
        return (
          <StaffHome
            staff={staff}
            store={store}
            allowed={allowed}
            onBillOpen={openBillService}
          />
        );

      case "bills":
        if (livePerms.length > 0 && !allowed.includes("bills")) {
          return (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center pb-20">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <Svg d={P.bills} size={28} color="#94a3b8" />
              </div>
              <p className="text-base font-bold text-slate-700 dark:text-slate-300">Bills Not Enabled</p>
              <p className="text-sm text-slate-400 dark:text-slate-500">Your manager hasn't enabled bill payments for your account yet.</p>
            </div>
          );
        }
        return (
          <div className="h-full overflow-y-auto pb-20">
            <BillPayments
              store={store}
              staffName={staff?.full_name}
              staffEmail={staffEmail}
              businessName={staff?.business_name}
              autoService={billAutoService}
              onAutoOpened={() => setBillAutoService(null)}
            />
          </div>
        );

      case "transactions":
        return allowed.includes("transactions") ? (
          <div className="h-full overflow-y-auto pb-20 px-4 pt-4">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Sales</p>
            {store.transactions.slice(0, 30).map((t, i) => <TxRow key={t.id || i} t={t} />)}
            {store.transactions.length === 0 && !store.loading && (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-10">No transactions yet</p>
            )}
          </div>
        ) : null;

      case "credit":
        return allowed.includes("credit") ? (
          <div className="h-full overflow-y-auto pb-20 px-4 pt-4">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Credit</p>
            {store.credits.slice(0, 20).map((c, i) => (
              <div key={c.id || i} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50 flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{c.debtor_name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 capitalize">{c.status}</p>
                </div>
                <p className="text-sm font-extrabold text-orange-500">{fmt(c.outstanding || 0)}</p>
              </div>
            ))}
            {store.credits.length === 0 && !store.loading && (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-10">No credit records</p>
            )}
          </div>
        ) : null;

      case "aso":
        return allowed.includes("aso") ? (
          <div className="h-full overflow-y-auto pb-20 px-4 pt-4">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Ajo Members</p>
            {store.asoClients.slice(0, 20).map((c, i) => (
              <div key={c.id || i} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50 flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{c.full_name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{c.membership_number}</p>
                </div>
                <p className="text-sm font-extrabold text-purple-600">{fmt(c.current_balance || 0)}</p>
              </div>
            ))}
            {store.asoClients.length === 0 && !store.loading && (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-10">No Ajo members</p>
            )}
          </div>
        ) : null;

      case "inventory":
        return allowed.includes("inventory") ? (
          <div className="h-full overflow-y-auto pb-20 px-4 pt-4">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Stock</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-10">Inventory view coming soon</p>
          </div>
        ) : null;

      case "insights":
        return allowed.includes("insights") ? (
          <div className="h-full overflow-y-auto pb-20 px-4 pt-4">
            <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Reports</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-10">Reports view coming soon</p>
          </div>
        ) : null;

      case "profile":
        return (
          <StaffProfileTab
            staff={staff}
            livePerms={livePerms}
            onSignOut={() => supabase.auth.signOut()}
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
          <button onClick={() => setTab("profile")}
            className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center shadow-sm active:scale-90 transition-transform">
            {staff?.profile_image_url
              ? <img src={staff.profile_image_url} alt="" className="w-9 h-9 rounded-full object-cover" />
              : <span className="text-sm font-black text-white">{avatarInitial}</span>
            }
          </button>
        </header>

        {/* Tab content */}
        <main className="flex-1 overflow-hidden">
          {renderTab()}
        </main>

        {/* Bottom nav */}
        <nav className="flex-shrink-0 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float z-40">
          <div className="flex items-stretch h-[60px]">
            {visibleNav.map(n => {
              const active = tab === n.id;
              return (
                <button key={n.id} onClick={() => setTab(n.id)}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative transition-colors focus-visible:outline-none">
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />
                  )}
                  <div className={`transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                    <Icon name={n.icon} size={21}
                      className={active ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"} />
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
