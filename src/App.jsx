import { useState, useEffect, useRef } from "react";
import { useStore }          from "./hooks/useStore";
import { useAuth }           from "./hooks/useAuth";
import { useNotifications }  from "./hooks/useNotifications";
import { fmt }               from "./utils/helpers";
import SyncBar               from "./components/SyncBar";
import BottomNav             from "./components/BottomNav";
import VoiceModal            from "./components/VoiceModal";
import NotificationCenter    from "./components/NotificationCenter";
import DailyVoice            from "./components/DailyVoice";
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
import MarketerDashboard     from "./screens/MarketerDashboard";
import MarketerFirstLogin    from "./screens/MarketerFirstLogin";
import BillPayments          from "./screens/BillPayments";
import Inventory             from "./screens/Inventory";
import Reports               from "./screens/Reports";
import AIAssistant           from "./screens/AIAssistant";
import LockScreen            from "./components/LockScreen";
import AIChatWidget         from "./components/AIChatWidget";
import Loyalty               from "./screens/Loyalty";
import Branches              from "./screens/Branches";
import BranchManagerDashboard from "./screens/BranchManagerDashboard";
import AjoClientPortal       from "./screens/AjoClientPortal";
import CoopList              from "./screens/CoopList";
import CoopDashboard         from "./screens/CoopDashboard";
import CoopMemberPortal, { CoopMemberFirstLogin } from "./screens/CoopMemberPortal";
import OrgPortal             from "./screens/OrgPortal";
import OrgFirstLogin         from "./screens/OrgFirstLogin";
import OrgMemberOtpVerify   from "./screens/OrgMemberOtpVerify";
import AdminDashboard        from "./screens/AdminDashboard";
import { useInventory }      from "./hooks/useInventory";
import { useBiometricLock }  from "./hooks/useBiometricLock";
import { useLoyalty }        from "./hooks/useLoyalty";
import { useBranches }       from "./hooks/useBranches";
import { LanguageProvider }  from "./contexts/LanguageContext";

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
  const [showUpgrade,  setShowUpgrade]  = useState(false);
  const [showReports,  setShowReports]  = useState(false);
  const [showAI,       setShowAI]       = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [showLoyalty,  setShowLoyalty]  = useState(false);
  const [showCoop,     setShowCoop]     = useState(false);
  const [coopOrg,      setCoopOrg]      = useState(null);
  const [aiQuery,      setAiQuery]      = useState("");
  const [branchReport, setBranchReport] = useState(null);

  const { status, session, plan, setReady, refetch, upgradeAvailable, staff, ajoClient, orgMember, adminUser, marketer, org } = useAuth();
  const userId = session?.user?.id;

  // Notification system — initialised before store so addNotification is stable
  const notif = useNotifications(userId);
  const { addNotification } = notif;

  // Store — pass addNotification so it fires on key events
  const store = useStore(userId, null, null, addNotification);

  // Inventory — separate hook; also fires low-stock notifications
  const inventory = useInventory(userId, null, addNotification);

  // Biometric / PIN lock
  const lock = useBiometricLock(userId);

  // Loyalty program
  const loyalty = useLoyalty(userId);

  // Branch management (premium only)
  const branchesHook = useBranches(userId);

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

  const addTransactionWithLoyalty = async (txnData) => {
    await store.addTransaction(txnData);
    if (txnData.type === "in" && txnData.customer_name) {
      loyalty.awardByName(txnData.customer_name, parseFloat(txnData.amount) || 0);
    }
  };

  const triggerQuickAction = (targetTab, type = null) => {
    setTab(targetTab);
    setAutoAdd({ tab: targetTab, type });
  };
  const clearAutoAdd = () => setAutoAdd(null);

  const [upgradeBannerDismissed, setUpgradeBannerDismissed] = useState(false);

  const openUpgrade   = () => setShowUpgrade(true);
  const closeUpgrade  = () => setShowUpgrade(false);
  const finishUpgrade = (planId) => { setReady(planId); setShowUpgrade(false); };

  if (status === "loading")         return <Spinner />;

  // Super Admin — full command center
  if (status === "admin") return <AdminDashboard session={session} adminUser={adminUser} />;

  // Organisation self-registered portal
  if (status === "org_setup") return <OrgFirstLogin org={org} />;
  if (status === "organisation") return <OrgPortal session={session} org={org} />;

  // Org member — email OTP verification then password change on first login
  if (status === "org_member_otp")   return <OrgMemberOtpVerify member={orgMember} />;
  if (status === "org_member_setup") return <CoopMemberFirstLogin member={orgMember} />;
  if (status === "org_member") return (
    <>
      <CoopMemberPortal member={orgMember} />
      <AIChatWidget />
    </>
  );

  // Ajo client login — route to dedicated client portal
  if (status === "ajo_client_setup" || status === "ajo_client") {
    return (
      <>
        <AjoClientPortal session={session} ajoClient={ajoClient} />
        <AIChatWidget />
      </>
    );
  }

  if (status === "unauthenticated") return <Auth />;

  if (status === "onboarding")      return <Onboarding session={session} onComplete={refetch} />;
  if (status === "subscribing")     return <SubscriptionPlan session={session} onComplete={setReady} />;
  if (status === "staff_setup")     return <StaffFirstLogin session={session} staff={staff} />;
  if (status === "staff") return (
    <>
      <StaffDashboard session={session} staff={staff} />
      <AIChatWidget />
    </>
  );
  if (status === "branch_manager") return (
    <>
      <BranchManagerDashboard session={session} staff={staff} />
      <AIChatWidget />
    </>
  );
  if (status === "marketer_setup")  return <MarketerFirstLogin marketer={marketer} />;
  if (status === "marketer")        return <MarketerDashboard marketer={marketer} />;

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
                    setTab={setTab}
                    onQuickAction={triggerQuickAction}
                    onVoiceOpen={() => setVoiceOpen(true)}
                    notif={notif} />,
    transactions: <Transactions
                    store={{ ...store, addTransaction: addTransactionWithLoyalty }}
                    plan={plan}
                    autoOpen={autoAdd?.tab === "transactions"}
                    autoType={autoAdd?.type}
                    onAutoOpened={clearAutoAdd}
                    onVoiceOpen={() => setVoiceOpen(true)}
                    onUpgrade={openUpgrade}
                    inventory={inventory} />,
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
    inventory:    <Inventory
                    inventory={inventory}
                    isOwner={true}
                    plan={plan}
                    onUpgrade={openUpgrade}
                    branches={branchesHook.branches} />,
    bills:        <BillPayments store={store} plan={plan}
                    autoService={autoAdd?.tab === "bills" ? autoAdd?.type : null}
                    onAutoOpened={clearAutoAdd} />,
    insights:     <Insights
                    store={store}
                    inventory={inventory}
                    plan={plan}
                    onUpgrade={openUpgrade}
                    onReports={() => setShowReports(true)}
                    onAIOpen={q => { setAiQuery(q || ""); setShowAI(true); }} />,
    loyalty:      <Loyalty
                    loyalty={loyalty}
                    plan={plan}
                    onUpgrade={openUpgrade} />,
    settings:     <Settings
                    store={store}
                    session={session}
                    plan={plan}
                    onUpgrade={openUpgrade}
                    lock={lock}
                    onNotifications={() => notif.setOpen(true)}
                    onLoyalty={() => setShowLoyalty(true)}
                    onBranches={() => setShowBranches(true)}
                    onCoops={() => setShowCoop(true)} />,
  };

  return (
    <LanguageProvider>
    <div className={isDark ? "dark" : ""}>
      <div className="h-screen bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
        <div className="w-full max-w-md relative flex flex-col h-screen">
          <SyncBar isOnline={store.isOnline} pending={store.pendingSync} isSyncing={store.isSyncing} onSync={store.runSync} />

          {upgradeAvailable && !upgradeBannerDismissed && (
            <div className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs px-3 py-2">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
              <span className="flex-1">New plan available — upgrade to unlock more features</span>
              <button onClick={openUpgrade} className="font-bold underline whitespace-nowrap">View Plans</button>
              <button onClick={() => setUpgradeBannerDismissed(true)} className="ml-1 opacity-70 hover:opacity-100">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
              </button>
            </div>
          )}

          <main className="flex-1 overflow-y-auto">
            {SCREENS[tab]}
          </main>

          <BottomNav active={tab} onNavigate={setTab} />

          {voiceOpen && (
            <VoiceModal
              onClose={() => setVoiceOpen(false)}
              onSave={txn => { addTransactionWithLoyalty(txn); setVoiceOpen(false); }}
            />
          )}

          <DailyVoice
            userId={userId}
            profile={store.profile}
            credits={store.credits}
            asoClients={store.asoClients}
            lowStock={inventory.lowStock}
            loading={store.loading}
          />

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

      {/* Report generator — full-screen overlay, z-60 */}
      {showReports && <Reports store={store} onClose={() => setShowReports(false)} />}

      {/* Branch report — wrapped at z-[80] so it appears above BranchDetail (z-70) */}
      {branchReport && (
        <div className="fixed inset-0 z-[80]">
          <Reports store={branchReport} onClose={() => setBranchReport(null)} />
        </div>
      )}

      {/* Branch management — full-screen overlay, z-60 */}
      {showBranches && (
        <Branches
          store={{ ...store, ...branchesHook }}
          userId={userId}
          inventory={inventory}
          onReport={(filteredStore) => setBranchReport(filteredStore)}
          onClose={() => setShowBranches(false)}
        />
      )}

      {/* Loyalty program — full-screen overlay, z-60 */}
      {showLoyalty && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-50 dark:bg-slate-900 max-w-md mx-auto left-1/2 -translate-x-1/2">
          <Loyalty
            loyalty={loyalty}
            plan={plan}
            onUpgrade={openUpgrade}
            onClose={() => setShowLoyalty(false)}
          />
        </div>
      )}

      {/* AI Business Assistant — full-screen overlay, z-50 */}
      {showAI && (
        <AIAssistant
          store={store}
          inventory={inventory}
          branches={branchesHook.branches}
          initialQuery={aiQuery}
          onClose={() => setShowAI(false)}
        />
      )}

      {/* Floating AI Chat Widget — visible on all screens when full-screen AI is closed */}
      {!showAI && (
        <AIChatWidget store={store} inventory={inventory} branches={branchesHook.branches} />
      )}

      {/* Cooperative / Community Org system — z-60 */}
      {showCoop && !coopOrg && (
        <CoopList
          userId={userId}
          onOpen={org => setCoopOrg(org)}
          onClose={() => setShowCoop(false)}
        />
      )}
      {showCoop && coopOrg && (
        <CoopDashboard
          org={coopOrg}
          onBack={() => setCoopOrg(null)}
        />
      )}

      {/* Biometric / PIN lock screen — z-[100], covers everything */}
      {lock.locked && lock.enabled && (
        <LockScreen lock={lock} businessName={store.profile?.business_name || store.profile?.owner_name} />
      )}
    </div>
    </LanguageProvider>
  );
}
