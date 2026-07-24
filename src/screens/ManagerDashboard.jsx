import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Capacitor }          from "@capacitor/core";
import { App as CapApp }      from "@capacitor/app";
import { supabase }           from "../utils/supabase";
import { useStore }           from "../hooks/useStore";
import { useInventory }       from "../hooks/useInventory";
import { useInvoices }        from "../hooks/useInvoices";
import { today }              from "../utils/helpers";
import { normalizeSlug }      from "../utils/plans";
import AppLogo                from "../components/AppLogo";
import Icon                   from "../components/Icon";
import NotificationCenter     from "../components/NotificationCenter";
import { useToast }           from "../components/Toast";
import AIChatWidget           from "../components/AIChatWidget";
import VoiceModal             from "../components/VoiceModal";
import SyncBar                from "../components/SyncBar";
import { AddTxnModal }        from "./Transactions";
import { useT }               from "../contexts/LanguageContext";
import { makeNav }            from "./manager/ManagerShared";
import ManagerHome            from "./manager/ManagerHome";
import ManagerSales           from "./manager/ManagerSales";
import ManagerRecords         from "./manager/ManagerRecords";
import ManagerStock           from "./manager/ManagerStock";
import ManagerMe              from "./manager/ManagerMe";
import ManagerBranchRoster      from "./manager/ManagerBranchRoster";
import ManagerStaffManagement   from "./manager/ManagerStaffManagement";

export default function ManagerDashboard({ session, staff: staffProp, pinLock }) {
  const t     = useT();
  const toast = useToast(); // eslint-disable-line no-unused-vars

  const NAV = useMemo(() => makeNav(t), [t]);

  const [staffPatch,       setStaffPatch]       = useState({});
  const staff = useMemo(() => ({ ...staffProp, ...staffPatch }), [staffProp, staffPatch]);

  const [tab,              setTab]              = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "sales";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "sales";
    return "home";
  });
  const [subNav,           setSubNav]           = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "bills";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "bills";
    return null;
  });
  const [subData,          setSubData]          = useState(null);
  const [livePerms,        setLivePerms]        = useState(staff?.staff_permissions || []);
  const [voiceOpen,        setVoiceOpen]        = useState(false);
  const [showAddTxn,       setShowAddTxn]       = useState(false);
  const [addTxnType,       setAddTxnType]       = useState("in");
  const [showBranchRoster,     setShowBranchRoster]     = useState(false);
  const [showStaffManagement,  setShowStaffManagement]  = useState(false);

  const openAddTxn = useCallback((type) => { setAddTxnType(type); setShowAddTxn(true); }, []);

  const staffId = staff?.id;
  const ownerId = staff?.owner_id;

  const store      = useStore(ownerId, staffId, staff?.full_name, staff?.branch_id || null);
  const inventory  = useInventory(ownerId, staffId, staff?.branch_id || null);
  const invoiceHook = useInvoices(ownerId);

  const [ownerPlan, setOwnerPlan] = useState("starter");
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    async function fetchOwnerPlan() {
      const { data } = await supabase.rpc("get_owner_plan");
      if (!cancelled) setOwnerPlan(normalizeSlug(data || "starter"));
    }
    fetchOwnerPlan();
    const ch = supabase
      .channel(`owner_sub_${ownerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${ownerId}` }, fetchOwnerPlan)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [ownerId]);

  const plan = ownerPlan;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", localStorage.getItem("kuditrack_dark") === "1");
  }, []);

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
    return () => { supabase.removeChannel(ch); };
  }, [ownerId, staffId, fetchPerms]);

  const lastPermsResumeRef = useRef(0);
  useEffect(() => {
    if (!staffId) return;
    const onResume = () => {
      if (Date.now() - lastPermsResumeRef.current < 10_000) return;
      lastPermsResumeRef.current = Date.now();
      fetchPerms();
    };
    const onVisibility = () => { if (!document.hidden) onResume(); };
    document.addEventListener("visibilitychange", onVisibility);
    let appListener;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener("appStateChange", ({ isActive }) => { if (isActive) onResume(); })
        .then(l => { appListener = l; });
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      appListener?.remove();
    };
  }, [staffId, fetchPerms]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVoiceSave = useCallback(async (parsed) => {
    if (!parsed || !ownerId) return;
    const { error } = await supabase.from("transactions").insert({
      user_id:          ownerId,
      staff_id:         staffId,
      branch_id:        staff?.branch_id || null,
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
    if (error) console.error("handleVoiceSave:", error.message);
  }, [ownerId, staffId, staff]);

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

  const avatarInitial = (staff?.full_name || "M")[0].toUpperCase();

  function renderContent() {
    if (showBranchRoster) {
      return (
        <ManagerBranchRoster
          staff={staff} store={store}
          onBack={() => setShowBranchRoster(false)}
        />
      );
    }
    if (showStaffManagement) {
      return (
        <ManagerStaffManagement
          staff={staff} pinLock={pinLock}
          onBack={() => setShowStaffManagement(false)}
        />
      );
    }
    switch (tab) {
      case "home":    return (
        <ManagerHome
          staff={staff} store={store} inventory={inventory} plan={plan}
          onGoTo={goTo} onVoiceOpen={() => setVoiceOpen(true)} onAddCash={openAddTxn}
        />
      );
      case "sales":   return (
        <ManagerSales
          store={store} staff={staff} session={session} livePerms={livePerms}
          initialSub={subNav} initialData={subData}
          onVoiceOpen={() => setVoiceOpen(true)} inventory={inventory}
          onAddCash={openAddTxn} plan={plan}
        />
      );
      case "records": return (
        <ManagerRecords
          store={store} staff={staff} livePerms={livePerms} initialSub={subNav}
          plan={plan} invoiceHook={invoiceHook} inventory={inventory} ownerId={ownerId}
        />
      );
      case "stock":   return (
        <ManagerStock inventory={inventory} staff={staff} livePerms={livePerms} plan={plan} />
      );
      case "me":      return (
        <ManagerMe
          staff={staff} session={session} store={store} inventory={inventory}
          livePerms={livePerms} pinLock={pinLock} plan={plan}
          staffId={staffId} ownerId={ownerId}
          onBranchRoster={() => setShowBranchRoster(true)}
          onStaffManagement={() => setShowStaffManagement(true)}
          initialView={subNav}
          onStaffUpdate={p => setStaffPatch(prev => ({ ...prev, ...p }))}
        />
      );
      default: setTab("home"); return null;
    }
  }

  return (
    <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative">

        {/* Header */}
        <header className="flex-none z-sticky min-h-[56px] flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm"
          style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
          <div className="flex items-center gap-2 flex-none min-w-0">
            <AppLogo className="h-8 w-8 flex-shrink-0" />
            {staff?.business_name ? (
              <p className="text-[15px] font-black text-slate-800 dark:text-white leading-tight truncate" style={{ maxWidth: 160 }}>
                {staff.business_name}
              </p>
            ) : (
              <div className="flex items-baseline gap-0.5 select-none">
                <span className="text-[17px] font-black tracking-tight text-slate-800 dark:text-white leading-none">Kudi</span>
                <span className="text-[17px] font-black tracking-tight leading-none"
                  style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase leading-none ml-1">Track</span>
              </div>
            )}
          </div>
          <div className="flex-none flex items-center gap-2">
            <NotificationCenter
              userId={session?.user?.id}
              onNavigate={(dl) => { if (dl?.tab) goTo(dl.tab, dl.sub || null); }}
              toast={toast}
            />
            <button onClick={() => goTo("me")}
              className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center border-2 border-slate-100 dark:border-slate-700 shadow-sm active:scale-90 transition-transform overflow-hidden">
              {staff?.profile_image_url
                ? <img src={staff.profile_image_url} alt="" className="w-9 h-9 object-cover" />
                : <span className="text-sm font-black text-white">{avatarInitial}</span>}
            </button>
          </div>
        </header>

        <SyncBar isOnline={store.isOnline} />

        {/* Content */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {renderContent()}
        </main>

        {/* Bottom nav — hidden when full-screen overlays are active */}
        {!showBranchRoster && !showStaffManagement && (
          <nav className="flex-none z-sticky bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float">
            <div className="flex items-stretch h-[60px]">
              {NAV.map(n => {
                const active = tab === n.id && !showBranchRoster;
                const cnt    = badge(n.id);
                return (
                  <button key={n.id} onClick={() => { setTab(n.id); setSubNav(null); setSubData(null); setShowBranchRoster(false); setShowStaffManagement(false); }}
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
        )}

        {/* Add Transaction Modal */}
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

      </div>
    </div>
  );
}
