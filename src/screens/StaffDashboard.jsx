import { useState, useEffect } from "react";
import { useStore }       from "../hooks/useStore";
import { supabase }       from "../utils/supabase";
import Transactions       from "./Transactions";
import Credit             from "./Credit";
import Aso                from "./Aso";
import Insights           from "./Insights";
import BillPayments       from "./BillPayments";
import VoiceModal         from "../components/VoiceModal";
import SyncBar            from "../components/SyncBar";

function Avatar({ url, name, size = "md" }) {
  const sz = size === "lg" ? "w-14 h-14 text-xl" : "w-9 h-9 text-sm";
  const initials = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name} className={`${sz} rounded-full object-cover`} />;
  return (
    <div className={`${sz} rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center`}>
      {initials}
    </div>
  );
}

const MODULE_ICONS = {
  bills: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <path d="M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 13h6M9 17h4" />
    </svg>
  ),
  transactions: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  ),
  credit: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  aso: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  insights: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4"  />
      <line x1="6"  y1="20" x2="6"  y2="14" />
    </svg>
  ),
};

const MODULE_LABELS = {
  transactions: "Transactions",
  bills:        "Bills",
  credit:       "Credit Sales",
  aso:          "Aso Savings",
  insights:     "Insights",
};

export default function StaffDashboard({ session, staff }) {
  const ownerId  = staff.owner_id;
  const staffId  = staff.id;
  const staffName = staff.full_name;

  // Staff uses owner's data scope
  const store = useStore(ownerId, staffId, staffName);

  // Compute allowed modules from staff_permissions
  const allowed = (staff.staff_permissions || []).filter(p => p.can_view).map(p => p.module);

  const [tab,       setTab]       = useState(allowed[0] || "");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [autoAdd,   setAutoAdd]   = useState(null);
  const [ownerName, setOwnerName] = useState("");

  const isDark = store.profile?.dark_mode;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !!isDark);
  }, [isDark]);

  useEffect(() => {
    supabase.from("profiles").select("business_name, full_name").eq("id", ownerId).maybeSingle()
      .then(({ data }) => { if (data) setOwnerName(data.business_name || data.full_name || ""); });
  }, [ownerId]);

  const handleSignOut = () => supabase.auth.signOut();

  const canCreate = (module) => (staff.staff_permissions || []).some(p => p.module === module && p.can_create);

  if (allowed.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-amber-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">No Modules Assigned</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Your account has no module access yet. Contact your manager to get permissions assigned.</p>
        <button onClick={handleSignOut} className="bg-red-50 border border-red-200 text-red-500 font-semibold text-sm px-6 py-3 rounded-xl">
          Sign Out
        </button>
      </div>
    );
  }

  const renderTab = () => {
    const noCreate = !canCreate(tab);
    switch (tab) {
      case "transactions":
        return <Transactions store={store} plan="premium" autoOpen={autoAdd?.tab === "transactions"} autoType={autoAdd?.type} onAutoOpened={() => setAutoAdd(null)} onVoiceOpen={() => setVoiceOpen(true)} onUpgrade={() => {}} readOnly={noCreate} />;
      case "bills":
        return <BillPayments store={store} staffName={staffName} businessName={store.profile?.business_name || ""} />;
      case "credit":
        return <Credit store={store} plan="premium" autoOpen={autoAdd?.tab === "credit"} onAutoOpened={() => setAutoAdd(null)} onUpgrade={() => {}} readOnly={noCreate} />;
      case "aso":
        return <Aso store={store} plan="premium" autoOpen={autoAdd?.tab === "aso"} onAutoOpened={() => setAutoAdd(null)} onUpgrade={() => {}} readOnly={noCreate} />;
      case "insights":
        return <Insights store={store} plan="premium" onUpgrade={() => {}} />;
      default:
        return null;
    }
  };

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex justify-center">
        <div className="w-full max-w-md relative flex flex-col min-h-screen">
          <SyncBar isOnline={store.isOnline} pending={store.pendingSync} />

          {/* Staff Header */}
          <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4 pt-12 pb-3 flex items-center gap-3">
            <Avatar url={staff.profile_image_url} name={staffName} />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-slate-800 dark:text-white truncate">{staffName}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{ownerName && `${ownerName} · `}{staff.role?.replace(/_/g, " ")}</p>
            </div>
            <button onClick={handleSignOut}
              className="text-xs text-red-500 font-semibold px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40">
              Sign Out
            </button>
          </div>

          {/* Module Tabs */}
          <div className="flex bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 overflow-x-auto">
            {allowed.map(m => (
              <button key={m} onClick={() => setTab(m)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${tab === m ? "border-green-500 text-green-600" : "border-transparent text-slate-400"}`}>
                <span className={tab === m ? "text-green-600" : "text-slate-400"}>{MODULE_ICONS[m]}</span>
                {MODULE_LABELS[m]}
              </button>
            ))}
          </div>

          <main className="flex-1 overflow-y-auto">
            {renderTab()}
          </main>

          {voiceOpen && canCreate("transactions") && (
            <VoiceModal
              onClose={() => setVoiceOpen(false)}
              onSave={txn => { store.addTransaction(txn); setVoiceOpen(false); }}
            />
          )}

          {store.dbError && (
            <div className="fixed bottom-6 left-4 right-4 max-w-md mx-auto z-50 bg-red-600 text-white rounded-2xl px-4 py-3 shadow-lg flex items-start gap-3 fade-in" role="alert">
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
        </div>
      </div>
    </div>
  );
}
