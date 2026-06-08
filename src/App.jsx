import { useState, useEffect, useRef } from "react";
import { useStore }          from "./hooks/useStore";
import { useAuth }           from "./hooks/useAuth";
import { useNotifications }  from "./hooks/useNotifications";
import { fmt }               from "./utils/helpers";
import SyncBar               from "./components/SyncBar";
import BottomNav             from "./components/BottomNav";
import VoiceModal            from "./components/VoiceModal";
import NotificationCenter    from "./components/NotificationCenter";
import Home                  from "./screens/Home";
import Transactions          from "./screens/Transactions";
import Credit                from "./screens/Credit";
import Aso                   from "./screens/Aso";
import Insights              from "./screens/Insights";
import Settings              from "./screens/Settings";
import Auth                  from "./screens/Auth";
import Onboarding            from "./screens/Onboarding";
import SubscriptionPlan      from "./screens/SubscriptionPlan";
import StaffDashboard        from "./screens/StaffDashboard";
import StaffFirstLogin       from "./screens/StaffFirstLogin";
import BillPayments          from "./screens/BillPayments";

function Spinner() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-[3px] border-brand-500 border-t-transparent rounded-full spinner" />
        <p className="text-xs text-slate-400 font-medium">Loading…</p>
      </div>
    </div>
  );
}

export default function App() {
  const [tab,         setTab]         = useState("home");
  const [autoAdd,     setAutoAdd]     = useState(null);
  const [voiceOpen,   setVoiceOpen]   = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { status, session, plan, setReady, refetch, staff } = useAuth();
  const userId = session?.user?.id;

  // Notification system — initialised before store so addNotification is stable
  const notif = useNotifications(userId);
  const { addNotification } = notif;

  // Store — pass addNotification so it fires on key events
  const store = useStore(userId, null, null, addNotification);

  const isDark = store.profile?.dark_mode;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !!isDark);
  }, [isDark]);

  // ── Smart daily alerts (overdue credits + missed aso payments) ──
  const alertFiredRef = useRef(false);
  useEffect(() => {
    if (!userId || store.loading || alertFiredRef.current) return;

    const key     = `kt_daily_alerts_${userId}`;
    const todayStr = new Date().toDateString();
    if (sessionStorage.getItem(key) === todayStr) return;

    alertFiredRef.current = true;
    sessionStorage.setItem(key, todayStr);

    // Overdue credits
    const overdueCredits = store.credits.filter(c => c.status === "overdue");
    if (overdueCredits.length > 0) {
      const total = overdueCredits.reduce((s, c) => s + c.outstanding, 0);
      addNotification(
        "credits",
        `${overdueCredits.length} Overdue Credit${overdueCredits.length > 1 ? "s" : ""}`,
        `${fmt(total)} still outstanding`
      );
    }

    // Missed aso contributions
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const overdueAso = store.asoClients.filter(c => {
      if (!c.next_contribution_date || c.status !== "active") return false;
      return now > new Date(c.next_contribution_date);
    });
    if (overdueAso.length > 0) {
      addNotification(
        "aso",
        `${overdueAso.length} Ajo Payment${overdueAso.length > 1 ? "s" : ""} Overdue`,
        "Clients have missed their contribution dates"
      );
    }
  }, [userId, store.loading, store.credits, store.asoClients, addNotification]);

  const triggerQuickAction = (targetTab, type = null) => {
    setTab(targetTab);
    setAutoAdd({ tab: targetTab, type });
  };
  const clearAutoAdd = () => setAutoAdd(null);

  const openUpgrade   = () => setShowUpgrade(true);
  const closeUpgrade  = () => setShowUpgrade(false);
  const finishUpgrade = (planId) => { setReady(planId); setShowUpgrade(false); };

  if (status === "loading")         return <Spinner />;
  if (status === "unauthenticated") return <Auth />;
  if (status === "onboarding")      return <Onboarding session={session} onComplete={refetch} />;
  if (status === "subscribing")     return <SubscriptionPlan session={session} onComplete={setReady} />;
  if (status === "staff_setup")     return <StaffFirstLogin session={session} staff={staff} />;
  if (status === "staff")           return <StaffDashboard session={session} staff={staff} />;

  if (showUpgrade) {
    return (
      <div className={isDark ? "dark" : ""}>
        <SubscriptionPlan
          session={session}
          currentPlan={plan}
          onComplete={finishUpgrade}
          onClose={closeUpgrade}
          isUpgrade
        />
      </div>
    );
  }

  const SCREENS = {
    home:         <Home
                    store={store}
                    plan={plan}
                    setTab={setTab}
                    onQuickAction={triggerQuickAction}
                    onVoiceOpen={() => setVoiceOpen(true)}
                    notif={notif} />,
    transactions: <Transactions
                    store={store}
                    plan={plan}
                    autoOpen={autoAdd?.tab === "transactions"}
                    autoType={autoAdd?.type}
                    onAutoOpened={clearAutoAdd}
                    onVoiceOpen={() => setVoiceOpen(true)}
                    onUpgrade={openUpgrade} />,
    credit:       <Credit
                    store={store}
                    plan={plan}
                    autoOpen={autoAdd?.tab === "credit"}
                    onAutoOpened={clearAutoAdd}
                    onUpgrade={openUpgrade} />,
    aso:          <Aso
                    store={store}
                    plan={plan}
                    autoOpen={autoAdd?.tab === "aso"}
                    onAutoOpened={clearAutoAdd}
                    onUpgrade={openUpgrade} />,
    bills:        <BillPayments store={store} />,
    insights:     <Insights
                    store={store}
                    plan={plan}
                    onUpgrade={openUpgrade} />,
    settings:     <Settings
                    store={store}
                    session={session}
                    plan={plan}
                    onUpgrade={openUpgrade} />,
  };

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="h-screen bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
        <div className="w-full max-w-md relative flex flex-col h-screen">
          <SyncBar isOnline={store.isOnline} pending={store.pendingSync} />

          <main className="flex-1 overflow-y-auto">
            {SCREENS[tab]}
          </main>

          <BottomNav active={tab} onNavigate={setTab} />

          {voiceOpen && (
            <VoiceModal
              onClose={() => setVoiceOpen(false)}
              onSave={txn => { store.addTransaction(txn); setVoiceOpen(false); }}
            />
          )}

          {store.dbError && (
            <div className="fixed bottom-24 left-4 right-4 max-w-md mx-auto z-50 bg-red-600 text-white rounded-2xl px-4 py-3 shadow-lg flex items-start gap-3 fade-in" role="alert">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Save failed</p>
                <p className="text-xs opacity-80 mt-0.5 break-words">{store.dbError}</p>
              </div>
              <button onClick={store.clearDbError} className="text-white/70 hover:text-white flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Notification panel — full-screen overlay, z-50 */}
      <NotificationCenter notif={notif} />
    </div>
  );
}
