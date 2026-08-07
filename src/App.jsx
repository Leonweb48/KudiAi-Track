import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation, Routes, Route } from "react-router-dom";
import { useStore }          from "./hooks/useStore";
import { useAuth }           from "./hooks/useAuth";
import { ToastProvider }     from "./components/Toast";
import { usePushNotifications } from "./hooks/usePushNotifications";
import SyncBar               from "./components/SyncBar";
import BottomNav             from "./components/BottomNav";
import AppLogo               from "./components/AppLogo";
import NotificationCenter    from "./components/NotificationCenter";
import VoiceModal            from "./components/VoiceModal";
import DailyVoice            from "./components/DailyVoice";
import Home                  from "./screens/Home";
import Transactions          from "./screens/Transactions";
import Insights              from "./screens/Insights";
import Settings              from "./screens/Settings";
import Auth                  from "./screens/Auth";
import Onboarding            from "./screens/Onboarding";
import SubscriptionPlan      from "./screens/SubscriptionPlan";
import StaffDashboard        from "./screens/StaffDashboard";
import MarketerDashboard     from "./screens/MarketerDashboard";
import MarketerFirstLogin    from "./screens/MarketerFirstLogin";
import BillPayments          from "./screens/BillPayments";
import Inventory             from "./screens/Inventory";
import Reports               from "./screens/Reports";
import AIAssistant           from "./screens/AIAssistant";
import LockScreen            from "./components/LockScreen";
import PinSetupFlow          from "./components/PinSetupFlow";
import AIChatWidget         from "./components/AIChatWidget";
import Loyalty               from "./screens/Loyalty";
import Branches              from "./screens/Branches";
import { unlockAudio }       from "./utils/tts";
import MoreSheet             from "./components/MoreSheet";
import ManagerDashboard from "./screens/ManagerDashboard";
import AjoMemberPortal       from "./screens/AjoMemberPortal";
import CoopList              from "./screens/CoopList";
import CoopDashboard         from "./screens/CoopDashboard";
import CoopMemberPortal, { CoopMemberFirstLogin, OrgMemberArchivedScreen } from "./screens/CoopMemberPortal";
import PaymentReturn         from "./screens/PaymentReturn";
import { Browser }           from "@capacitor/browser";
import { StatusBar, Style }  from "@capacitor/status-bar";
import { Capacitor }         from "@capacitor/core";
import { App as CapApp }     from "@capacitor/app";
import Finance               from "./screens/Finance";
import OrgPortal             from "./screens/OrgPortal";
import OrgFirstLogin         from "./screens/OrgFirstLogin";
import OrgMemberOtpVerify   from "./screens/OrgMemberOtpVerify";
import StaffOtpVerify       from "./screens/StaffOtpVerify";
import StaffFirstLogin      from "./screens/StaffFirstLogin";
import { useConsent }       from "./hooks/useConsent";
import ConsentModal         from "./components/ConsentModal";
import AjoClientOtpVerify   from "./screens/AjoClientOtpVerify";
import AjoClientArchivedScreen from "./screens/AjoClientArchivedScreen";
import OrgOtpVerify         from "./screens/OrgOtpVerify";
import OfflineScreen        from "./screens/OfflineScreen";
import AdminDashboard        from "./screens/AdminDashboard";
import Help                  from "./screens/Help";
import Verification           from "./screens/Verification";
import Profile               from "./screens/Profile";
import { useInventory }      from "./hooks/useInventory";
import { useInvoices }      from "./hooks/useInvoices";
import { usePinLock }        from "./hooks/usePinLock";
import { useLoyalty }        from "./hooks/useLoyalty";
import { useBranches }       from "./hooks/useBranches";
import { usePermissions }    from "./hooks/usePermissions";
import { useNotifications }  from "./hooks/useNotifications";
import { canDo }             from "./utils/plans";
import {
  isPaidPlan, isPaidCompliant, getMissingPaidFields, getPaidGraceInfo,
  recordPaidSince, clearPaidSince,
  isComplianceIntroShown, markComplianceIntroShown,
  isFeatureLocked,
} from "./utils/paidCompliance";
import { buildContext }      from "./utils/buildContext";
import LanguageSelector      from "./screens/LanguageSelector";
import { hasChosenLang, setLang, markLangChosen } from "./utils/i18n";
import { useLanguage as useLangCtx } from "./contexts/LanguageContext";

function Spinner() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <img
        src="/logo-tp.png"
        alt=""
        className="logo-pulse"
        style={{ width: 72, height: 72, objectFit: "contain" }}
      />
    </div>
  );
}

export default function App() {
  const navigate   = useNavigate();
  const location   = useLocation();

  // Derive active tab from URL path — maps legacy credit/aso routes to finance
  const rawTab = location.pathname === "/" ? "home" : location.pathname.slice(1).split("/")[0];
  const tab    = (rawTab === "credit" || rawTab === "aso") ? "finance" : rawTab;

  const MORE_TABS = new Set(["finance", "insights", "settings"]);

  // Close MoreSheet on any navigation (covers notification deep links)
  useEffect(() => { setMoreSheetOpen(false); }, [location.pathname]);

  const setTab = (t) => {
    if (t === "more") { setMoreSheetOpen(true); return; }
    setMoreSheetOpen(false);
    const target = (t === "credit" || t === "aso") ? "finance" : t;
    navigate(target === "home" ? "/" : `/${target}`);
  };

  const { changeLang } = useLangCtx();

  // hasChosenLang() checks localStorage["kt_lang_chosen"]. False on brand-new devices.
  const [langChosen, setLangChosen] = useState(hasChosenLang);

  const [autoAdd,       setAutoAdd]       = useState(null);
  const [voiceOpen,     setVoiceOpen]     = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [showUpgrade,   setShowUpgrade]   = useState(false);
  const [showReports,  setShowReports]  = useState(false);
  const [showAI,       setShowAI]       = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [showLoyalty,  setShowLoyalty]  = useState(false);
  const [showCoop,     setShowCoop]     = useState(false);
  const [coopOrg,      setCoopOrg]      = useState(null);
  const [aiQuery,      setAiQuery]      = useState("");
  const [branchReport, setBranchReport] = useState(null);
  const [showComplianceIntro, setShowComplianceIntro] = useState(false);

  // eslint-disable-next-line no-unused-vars
  const { status, session, plan, setReady, refetch, retryAuth, upgradeAvailable, plansVersion, staff, ajoClient, orgMember, adminUser, marketer, org } = useAuth();
  const userId = session?.user?.id;

  // Consent gate — checks once per userId whether the user has accepted legal docs
  const consent = useConsent(userId);

  // Store
  const store = useStore(userId, null, null);

  // Cross-device lang sync: once the profile loads, apply server-side lang preference.
  useEffect(() => {
    const serverLang = store.profile?.preferred_language;
    if (!serverLang || hasChosenLang()) return;
    setLang(serverLang);
    markLangChosen();
    changeLang(serverLang);
    setLangChosen(true);
  }, [store.profile?.preferred_language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inventory
  const inventory = useInventory(userId, null);

  // Invoices — lifted here so daily alerts + AI context can use invoice data
  const invoiceHook = useInvoices(userId);

  // Two-tier PIN lock (server-side via pin-manager edge function)
  const pinLock = usePinLock(userId);

  // Notification engine — owner portal only. Pass null for ajo_client to prevent a
  // ghost realtime subscription when AjoMemberPortal's NotificationCenter is live.
  const notifHook = useNotifications(status === "ajo_client" ? null : userId);

  // Push notification deep-link handler — called by usePushNotifications on tap
  const handlePushDeepLink = useCallback((dl) => {
    if (!dl?.tab || !userId) return;
    const target = (dl.tab === "credit" || dl.tab === "aso") ? "finance" : dl.tab;
    navigate(target === "home" ? "/" : `/${target}`, { replace: true, state: (dl.id || dl.sub) ? { id: dl.id, sub: dl.sub } : undefined });
  }, [navigate, userId]);

  // Register FCM token + handle push taps (no-op on web)
  usePushNotifications(userId, handlePushDeepLink);

  // Loyalty program
  const loyalty = useLoyalty(userId);

  // Branch management (premium only)
  const branchesHook = useBranches(userId);

  // Data refresh is now realtime-first (useStore's transactions_rt channel) + resume handler
  // in Transactions.jsx (10s debounce) + a 30s backup poll when rt is disconnected.
  // The 3s interval and the kt-new-transaction re-dispatch were removed — they caused
  // duplicate owner notifications for every staff-recorded transaction.

  // Request camera, mic, and location permissions on native
  usePermissions();

  const isDark = store.profile?.dark_mode ?? (localStorage.getItem("kuditrack_dark") === "1");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !!isDark);
  }, [isDark]);

  // Unlock AudioContext on first user interaction so subsequent async TTS calls
  // can play audio on Android WebView (which blocks autoplay after any await).
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("click",      unlock, true);
    };
    document.addEventListener("touchstart", unlock, true);
    document.addEventListener("click",      unlock, true);
    return () => {
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("click",      unlock, true);
    };
  }, []);

  // ── Handle Paystack return URLs and subscription upgrade returns ──
  useEffect(() => {
    const params  = new URLSearchParams(location.search);
    const billRef = params.get("bill_ref") || params.get("trxref") || params.get("reference");

    // Bill payment return — redirect to /bills preserving query params
    if (billRef && localStorage.getItem(`ck_bill_pending_${billRef}`)) {
      if (location.pathname !== "/bills") navigate(`/bills${location.search}`, { replace: true });
      Object.keys(localStorage).filter(k => k.startsWith("sub_pending_")).forEach(k => localStorage.removeItem(k));
      return;
    }

    // Orphaned bill pending (user navigated away mid-payment) — only redirect if < 30 min old
    const orphanKeys = Object.keys(localStorage).filter(k => k.startsWith("ck_bill_pending_"));
    if (orphanKeys.length > 0) {
      const hasRecent = orphanKeys.some(k => {
        const ts = parseInt((k.match(/(\d{13})$/) || [])[1] || "0", 10);
        return ts && Date.now() - ts < 30 * 60 * 1000;
      });
      if (hasRecent) {
        if (location.pathname !== "/bills") navigate("/bills", { replace: true });
        return;
      }
      // Stale keys (> 30 min) — clean them up so they never redirect again
      orphanKeys.forEach(k => localStorage.removeItem(k));
    }

    // Subscription upgrade return
    const subRef = params.get("sub_ref");
    const hasSub = (subRef && localStorage.getItem(`sub_pending_${subRef}`)) ||
                   Object.keys(localStorage).some(k => k.startsWith("sub_pending_"));
    if (hasSub) setShowUpgrade(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Smart daily alerts (overdue credits + missed aso payments) ──
  const alertFiredRef = useRef(false);
  useEffect(() => {
    if (!userId || store.loading || alertFiredRef.current) return;

    const key     = `kt_daily_alerts_${userId}`;
    const todayStr = new Date().toDateString();
    if (sessionStorage.getItem(key) === todayStr) return;

    alertFiredRef.current = true;
    sessionStorage.setItem(key, todayStr);

  }, [userId, store.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const addTransactionWithLoyalty = async (txnData) => {
    await store.addTransaction(txnData);
    if (txnData.type === "in" && txnData.customer_name) {
      loyalty.awardByName(txnData.customer_name, parseFloat(txnData.amount) || 0);
    }
  };

  // Navigate to /bills when deep-link payment callback fires.
  // If BillPayments is not yet mounted (different route), it will remount fresh and
  // miss the one-time custom event. To bridge this, persist the callback URL in
  // sessionStorage so the mount effect in BillPayments can pick it up.
  useEffect(() => {
    const handler = (e) => {
      // Bridge the callback URL across the navigation so a freshly-mounted
      // BillPayments can still process it even after missing the CustomEvent.
      if (e.detail?.url) {
        try { sessionStorage.setItem("ck_payment_callback_url", e.detail.url); } catch {}
      }
      if (window.location.pathname !== "/bills") navigate("/bills");
    };
    window.addEventListener("paymentCallback", handler);
    return () => window.removeEventListener("paymentCallback", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate to /bills when the payment browser closes and a payment is pending.
  // Handles: InAppBrowser user-close (inAppBrowserFinished), CCT close (browserFinished).
  // Guard: skip if already on /bills — BillPayments' own listener handles fulfillment there.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const onBrowserDone = () => {
      // Only navigate when there is a RECENT pending key (< 30 min) — stale keys
      // should not force /bills navigation and are cleaned up by the mount effect.
      const hasRecentPending = Object.keys(localStorage).some(k => {
        if (!k.startsWith("ck_bill_pending_")) return false;
        const ts = parseInt((k.match(/(\d{13})$/) || [])[1] || "0", 10);
        return ts && Date.now() - ts < 30 * 60 * 1000;
      });
      if (hasRecentPending && window.location.pathname !== "/bills") navigate("/bills");
    };
    let listener;
    Browser.addListener("browserFinished", onBrowserDone).then(l => { listener = l; });
    window.addEventListener("inAppBrowserFinished", onBrowserDone);
    return () => {
      listener?.remove();
      window.removeEventListener("inAppBrowserFinished", onBrowserDone);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Edge-to-edge status bar: transparent + icon colour adapts to light/dark mode.
  // CSS env(safe-area-inset-top) on the container keeps content below the bar.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
  }, [isDark]);

  // Android hardware back button — use Capacitor's canGoBack (WebView history)
  // rather than window.history.length which is unreliable in the WebView context.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = CapApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        navigate(-1);
      } else {
        CapApp.exitApp();
      }
    });
    return () => { sub.then(s => s.remove()); };
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerQuickAction = (targetTab, type = null, category = null) => {
    setTab(targetTab);
    setAutoAdd({ tab: targetTab, type, category });
  };
  const clearAutoAdd = () => setAutoAdd(null);

  const [upgradeBannerDismissed, setUpgradeBannerDismissed] = useState(false);

  const openUpgrade   = () => setShowUpgrade(true);
  const closeUpgrade  = () => setShowUpgrade(false);
  const finishUpgrade = (planId) => { setReady(planId); setShowUpgrade(false); };

  // ── Paid-plan compliance tracking ───────────────────────────────────────────
  // Record when the owner first hits a paid plan (sets grace period start once).
  // Show a one-time explanation modal for new and existing paid users who are
  // not yet compliant, so they know what changed and why.
  useEffect(() => {
    if (!userId || store.loading) return;
    if (!isPaidPlan(plan)) {
      // Plan dropped to free — reset so a future re-upgrade gets a fresh grace period.
      clearPaidSince(userId);
      return;
    }
    recordPaidSince(userId);
    if (!isComplianceIntroShown(userId) && !isPaidCompliant(store.profile || {})) {
      setShowComplianceIntro(true);
      markComplianceIntroShown(userId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, plan, store.loading]);

  // Compliance state — recomputed from live profile on every render.
  const paidPlan       = isPaidPlan(plan);
  const paidCompliant  = isPaidCompliant(store.profile || {});
  const { inGrace, graceDaysLeft } = getPaidGraceInfo(userId || "");
  const complianceCtx  = { isPaid: paidPlan, isCompliant: paidCompliant, inGrace };
  const missingPaidFields = paidPlan && !paidCompliant ? getMissingPaidFields(store.profile || {}) : [];

  // Allow slot CTAs (promo_code action) to open the upgrade screen from anywhere
  useEffect(() => {
    const handler = () => setShowUpgrade(true);
    window.addEventListener("kt:openUpgrade", handler);
    return () => window.removeEventListener("kt:openUpgrade", handler);
  }, []);

  // Public routes: WebView / App-Links have no session, must render before auth check
  if (location.pathname === "/payment-return" ||
      location.pathname === "/app/payment-callback") return <PaymentReturn />;

  const portalStatuses = ["ready", "staff", "branch_manager", "marketer", "organisation", "org_member", "ajo_client"];

  // Single loading gate: covers both the auth resolution window and the pin-manager
  // check_status call that follows. Collapsing them into one return keeps the same
  // Spinner instance mounted the whole time so no animation restart / blink occurs.
  if (status === "loading" || (portalStatuses.includes(status) && pinLock.loading)) return <Spinner />;

  // Super Admin — full command center
  if (status === "admin") return <AdminDashboard session={session} adminUser={adminUser} />;

  // Organisation — OTP first, then password setup
  if (status === "org_otp")   return <OrgOtpVerify org={org} />;
  if (status === "org_setup") return <OrgFirstLogin org={org} />;

  // Org member — OTP first, then password setup
  if (status === "org_member_otp")   return <OrgMemberOtpVerify member={orgMember} />;
  if (status === "org_member_setup") return <CoopMemberFirstLogin member={orgMember} />;

  // Staff — OTP first, then password setup, then portal
  if (status === "staff_otp")   return <StaffOtpVerify staff={staff} />;
  if (status === "staff_setup") return <StaffFirstLogin staff={staff} />;

  // Ajo client — OTP first, then password setup
  if (status === "ajo_client_otp")      return <AjoClientOtpVerify ajoClient={ajoClient} />;
  if (status === "ajo_client_setup")    return <AjoMemberPortal session={session} ajoClient={ajoClient} pinLock={pinLock} />;
  if (status === "ajo_client_archived")  return <AjoClientArchivedScreen ajoClient={ajoClient} />;
  if (status === "org_member_archived") return <OrgMemberArchivedScreen member={orgMember} />;
  if (status === "offline")             return <OfflineScreen onRetry={retryAuth} />;
  if (status === "unauthenticated")  return <Auth />;
  if (status === "onboarding")       return <Onboarding session={session} onComplete={refetch} />;
  if (status === "subscribing")      return <SubscriptionPlan session={session} onComplete={setReady} />;
  if (status === "marketer_setup")   return <MarketerFirstLogin marketer={marketer} />;

  // ── Consent gate — blocks portal entry until legal docs are accepted ──
  if (portalStatuses.includes(status) && !consent.loading && consent.needsConsent) {
    return (
      <ConsentModal
        userId={userId}
        onGranted={() => consent.refetch()}
        isReConsent={consent.isReConsent}
        changeSummary={consent.changeSummary}
      />
    );
  }

  // ── PIN setup gate — blocks all portals until both PINs are configured ──
  // Covers: organisation, org_member, ajo_client, staff, branch_manager, marketer, main app.
  // status !== null guards against triggering setup when check_status failed (network error / edge-function cold start).
  if (pinLock.status !== null && (!pinLock.appPinSet || !pinLock.txnPinSet)) {
    return <PinSetupFlow pinLock={pinLock} userId={userId} session={session} />;
  }
  // Lock screen (inactivity or new device)
  if (pinLock.locked) {
    const isAjoCli = status === "ajo_client" || status === "ajo_client_setup";
    return <LockScreen
      pinLock={pinLock}
      businessName={isAjoCli
        ? (ajoClient?.full_name || "Member")
        : (store.profile?.business_name || store.profile?.owner_name || staff?.business_name)}
      avatarUrl={isAjoCli ? ajoClient?.profile_image_url : store.profile?.profile_image_url}
    />;
  }
  // ── Language selection gate — shown once per device if no preference is set ──
  // Excluded from the onboarding + subscription flows (owner hasn't set up their account yet).
  const langGateStatuses = ["ready", "staff", "branch_manager", "marketer", "organisation", "org_member", "ajo_client"];
  if (langGateStatuses.includes(status) && !langChosen && !store.loading) {
    return (
      <LanguageSelector userId={userId} />
    );
  }

  // ── Authenticated portals (PIN already set) ──
  if (status === "organisation")  return <OrgPortal session={session} org={org} />;
  if (status === "org_member")    return <CoopMemberPortal member={orgMember} />;
  if (status === "ajo_client")    return <AjoMemberPortal session={session} ajoClient={ajoClient} pinLock={pinLock} />;
  if (status === "staff")         return <StaffDashboard session={session} staff={staff} pinLock={pinLock} />;
  if (status === "branch_manager") return <ManagerDashboard session={session} staff={staff} pinLock={pinLock} />;
  if (status === "marketer")      return <MarketerDashboard marketer={marketer} />;

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
                    inventory={inventory}
                    invoiceHook={invoiceHook}
                    plan={plan}
                    setTab={setTab}
                    onQuickAction={triggerQuickAction}
                    onVoiceOpen={() => setVoiceOpen(true)}
                    onAIOpen={() => setShowAI(true)}
                    onGoVerification={() => navigate("/verification")}
                    onGoSettings={() => navigate("/settings")} />,
    transactions: <Transactions
                    store={{ ...store, addTransaction: addTransactionWithLoyalty }}
                    plan={plan}
                    autoOpen={autoAdd?.tab === "transactions"}
                    autoType={autoAdd?.type}
                    autoCategory={autoAdd?.category}
                    onAutoOpened={clearAutoAdd}
                    onVoiceOpen={() => setVoiceOpen(true)}
                    onUpgrade={openUpgrade}
                    inventory={inventory} />,
    finance:      <Finance
                    store={store}
                    plan={plan}
                    onUpgrade={openUpgrade}
                    autoOpenTab={
                      autoAdd?.tab === "credit"  ? "credit"      :
                      autoAdd?.tab === "aso"     ? "ajo"         :
                      autoAdd?.tab === "finance" && autoAdd?.type ? autoAdd.type :
                      null
                    }
                    onAutoOpened={clearAutoAdd}
                    userId={userId}
                    session={session}
                    onSelectCoopOrg={setCoopOrg}
                    inventory={inventory}
                    invoiceHook={invoiceHook} />,
    inventory:    <Inventory
                    inventory={inventory}
                    isOwner={true}
                    plan={plan}
                    onUpgrade={openUpgrade}
                    branches={branchesHook.branches}
                    staffList={store.staffList || []} />,
    bills:        <BillPayments store={store} plan={plan} session={session}
                    markup={canDo(plan, "apiAccess") ? 1.05 : 1.098}
                    pointsEnabled
                    staffEmail={session?.user?.email}
                    staffName={store.profile?.owner_name || store.profile?.business_name}
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
                    lock={pinLock}
                    onLoyalty={() => setShowLoyalty(true)}
                    onBranches={() => setShowBranches(true)}
                    onCoops={() => setShowCoop(true)} />,
  };

  return (
    <ToastProvider onDeepLink={handlePushDeepLink}>
    <div className={isDark ? "dark" : ""}>
      <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 md:bg-slate-200 dark:md:bg-slate-950 flex justify-center transition-colors duration-200">
        <div className="w-full max-w-md relative flex flex-col h-[100dvh] md:shadow-2xl md:shadow-black/20 dark:md:shadow-black/60 md:border-x md:border-slate-300/50 dark:md:border-slate-700/50">
          {/* Owner portal header — flex-none at column root, same pattern as Staff/Manager/Ajo */}
          <header className="flex-none z-sticky bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
            <div style={{ height: "env(safe-area-inset-top, 0px)" }} />
            <div className="h-14 flex items-center justify-between px-4">
            <AppLogo businessName={store.profile?.business_name} />
            <div className="flex-none flex items-center gap-2">
              <NotificationCenter
                userId={userId}
                onNavigate={(dl) => {
                  if (!dl?.tab) return;
                  const target = (dl.tab === "credit" || dl.tab === "aso") ? "finance" : dl.tab;
                  navigate(target === "home" ? "/" : `/${target}`, (dl.id || dl.sub) ? { state: { id: dl.id, sub: dl.sub } } : undefined);
                }}
                toast={null}
              />
              <button onClick={() => navigate("/profile")} aria-label="Profile"
                className="w-9 h-9 rounded-full border-2 border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden active:scale-90 transition-transform">
                {store.profile?.profile_image_url
                  ? <img src={store.profile.profile_image_url} alt="Profile" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><path d="M12 11a4 4 0 100-8 4 4 0 000 8" />
                      </svg>
                    </div>
                }
              </button>
            </div>
            </div>
          </header>

          <SyncBar
            isOnline={store.isOnline}
            fromCache={store.fromCache}
            dbError={store.dbError}
            loadError={store.loadError}
            lastSyncTime={store.lastSyncTime}
            syncing={store.syncing}
            syncResult={store.syncResult}
            pendingCount={store.pendingCount}
          />

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

          <main className="flex-1 overflow-y-auto overscroll-contain">
            <Routes>
              <Route path="/"             element={SCREENS.home}         />
              <Route path="/transactions" element={SCREENS.transactions}  />
              <Route path="/finance"      element={SCREENS.finance}       />
              <Route path="/credit"       element={SCREENS.finance}       />
              <Route path="/aso"          element={SCREENS.finance}       />
              <Route path="/inventory"    element={SCREENS.inventory}     />
              <Route path="/bills"        element={SCREENS.bills}         />
              <Route path="/insights"     element={SCREENS.insights}      />
              <Route path="/loyalty"      element={SCREENS.loyalty}       />
              <Route path="/settings"     element={SCREENS.settings}      />
              <Route path="/help"          element={<Help store={store} session={session} plan={plan} />} />
              <Route path="/profile"       element={<Profile      store={store} session={session} plan={plan} lock={pinLock} />} />
              <Route path="/verification" element={<Verification store={store} />} />
              <Route path="/payment-return"        element={<PaymentReturn />} />
              <Route path="/app/payment-callback" element={<PaymentReturn />} />
              <Route path="*"             element={SCREENS.home}          />
            </Routes>
          </main>

          <BottomNav active={MORE_TABS.has(tab) ? "more" : tab} onNavigate={setTab} badges={notifHook.badgeTabs} />

          <MoreSheet
            open={moreSheetOpen}
            onClose={() => setMoreSheetOpen(false)}
            onNavigate={setTab}
          />

          {voiceOpen && (
            <VoiceModal
              onClose={() => setVoiceOpen(false)}
              onSave={txn => { addTransactionWithLoyalty(txn); setVoiceOpen(false); }}
            />
          )}

          <DailyVoice
            userId={userId}
            context={store.loading ? "" : buildContext(store, inventory?.products || [], branchesHook?.branches || [])}
            fallback="Your business is ready for a great day — stay focused and keep the momentum going!"
            dataLoading={store.loading}
          />


        </div>
      </div>

      {/* Report generator — full-screen overlay, z-60
           Compliance lock: blocked after grace expires for non-compliant paid owners. */}
      {showReports && !isFeatureLocked("pdfExport", complianceCtx) && (
        <Reports store={store} onClose={() => setShowReports(false)} />
      )}
      {showReports && isFeatureLocked("pdfExport", complianceCtx) && (
        <ComplianceLockModal
          feature="PDF Reports"
          onClose={() => setShowReports(false)}
          onCompleteProfile={() => { setShowReports(false); navigate("/"); }}
        />
      )}

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
          plan={plan}
          onUpgrade={openUpgrade}
          onReport={(filteredStore) => setBranchReport(filteredStore)}
          onClose={() => setShowBranches(false)}
        />
      )}

      {/* Loyalty program — full-screen overlay, z-60 */}
      {showLoyalty && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-50 dark:bg-slate-900">
          <Loyalty
            loyalty={loyalty}
            plan={plan}
            onUpgrade={openUpgrade}
            onClose={() => setShowLoyalty(false)}
          />
        </div>
      )}

      {/* AI Business Assistant — full-screen overlay, z-50 (gated to aiChatbot feature + compliance) */}
      {showAI && canDo(plan, "aiChatbot") && !isFeatureLocked("aiChatbot", complianceCtx) && (
        <AIAssistant
          store={store}
          inventory={inventory}
          branches={branchesHook.branches}
          invoices={invoiceHook.invoices}
          initialQuery={aiQuery}
          onClose={() => setShowAI(false)}
        />
      )}
      {showAI && canDo(plan, "aiChatbot") && isFeatureLocked("aiChatbot", complianceCtx) && (
        <ComplianceLockModal
          feature="AI Assistant"
          onClose={() => setShowAI(false)}
          onCompleteProfile={() => { setShowAI(false); navigate("/"); }}
        />
      )}

      {/* Floating AI Chat Widget — visible on all screens when full-screen AI is closed */}
      {!showAI && canDo(plan, "aiChatbot") && !isFeatureLocked("aiChatbot", complianceCtx) && (
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
      {coopOrg && (
        <CoopDashboard
          org={coopOrg}
          onBack={() => { setCoopOrg(null); }}
          adminEmail={session?.user?.email}
          userId={userId}
        />
      )}

      {/* PIN lock screen removed — now handled as full-page gate above */}

      {/* ── Compliance intro modal — shown once per paid user when not yet compliant ── */}
      {showComplianceIntro && (
        <ComplianceIntroModal
          missingFields={missingPaidFields}
          graceDaysLeft={graceDaysLeft}
          onClose={() => setShowComplianceIntro(false)}
          onComplete={() => { setShowComplianceIntro(false); navigate("/"); }}
        />
      )}

    </div>
    </ToastProvider>
  );
}

// ── Compliance Intro Modal ────────────────────────────────────────────────────
// Shown once per paid user explaining the new profile requirement.
function ComplianceIntroModal({ missingFields, graceDaysLeft, onClose, onComplete }) {
  const groups = [...new Set((missingFields || []).map(f => f.group))];
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 900,
      background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "0 16px",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 20,
        padding: "28px 22px",
        width: "100%", maxWidth: 400,
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 36, textAlign: "center", marginBottom: 12 }}>📋</div>
        <h2 style={{ fontSize: 17, fontWeight: 800, textAlign: "center", color: "#111827", margin: "0 0 8px" }}>
          Profile requirements for paid plans
        </h2>
        <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6, textAlign: "center", margin: "0 0 16px" }}>
          To support future lending partnerships, paid-plan owners now need a complete, verified profile. You have{" "}
          <strong>{graceDaysLeft} days</strong> to complete it — all features work normally during this period.
        </p>
        <p style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, margin: "0 0 8px" }}>What&apos;s needed:</p>
        <ul style={{ margin: "0 0 20px", padding: "0 0 0 18px" }}>
          {groups.map(g => (
            <li key={g} style={{ fontSize: 13, color: "#374151", lineHeight: 1.8 }}>{g}</li>
          ))}
          <li style={{ fontSize: 13, color: "#374151", lineHeight: 1.8 }}>Identity verified via NIN</li>
          <li style={{ fontSize: 13, color: "#374151", lineHeight: 1.8 }}>Settlement bank account linked</li>
        </ul>
        <button
          onClick={onComplete}
          style={{
            width: "100%", padding: "13px",
            background: "linear-gradient(135deg,#b45309 0%,#92400e 100%)",
            color: "#fff", border: "none", borderRadius: 12,
            fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 10,
          }}
        >
          Start completing my profile
        </button>
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "10px",
            background: "none", color: "#9ca3af",
            border: "none", fontSize: 13, cursor: "pointer",
          }}
        >
          I&apos;ll do it later
        </button>
      </div>
    </div>
  );
}

// ── Compliance Lock Modal ─────────────────────────────────────────────────────
// Shown when a non-compliant paid owner (past grace period) tries to open a
// restricted premium feature. Core money functions are always accessible.
function ComplianceLockModal({ feature, onClose, onCompleteProfile }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 900,
      background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "0 16px",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 20,
        padding: "28px 22px",
        width: "100%", maxWidth: 360,
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 36, textAlign: "center", marginBottom: 12 }}>🔒</div>
        <h2 style={{ fontSize: 16, fontWeight: 800, textAlign: "center", color: "#111827", margin: "0 0 8px" }}>
          {feature} requires a complete profile
        </h2>
        <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6, textAlign: "center", margin: "0 0 6px" }}>
          Complete your profile and verify your identity to continue using this feature.
        </p>
        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5, textAlign: "center", margin: "0 0 20px" }}>
          All core functions — recording sales, managing savings clients, paying bills, and viewing transaction history — are always available.
        </p>
        <button
          onClick={onCompleteProfile}
          style={{
            width: "100%", padding: "13px",
            background: "linear-gradient(135deg,#b91c1c 0%,#991b1b 100%)",
            color: "#fff", border: "none", borderRadius: 12,
            fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 10,
          }}
        >
          Complete my profile
        </button>
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "10px",
            background: "none", color: "#9ca3af",
            border: "none", fontSize: 13, cursor: "pointer",
          }}
        >
          Go back
        </button>
      </div>
    </div>
  );
}
