import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase }           from "../utils/supabase";
import { useStore }           from "../hooks/useStore";
import { useInventory }       from "../hooks/useInventory";
import { useNotifications }   from "../hooks/useNotifications";
import NotificationCenter, { NotificationBell } from "../components/NotificationCenter";
import { today }              from "../utils/helpers";
import { normalizeSlug }      from "../utils/plans";
import AppLogo                from "../components/AppLogo";
import Icon                   from "../components/Icon";
import VoiceModal             from "../components/VoiceModal";
import { AddTxnModal }        from "./Transactions";
import { useT }               from "../contexts/LanguageContext";
import { useInvoices }        from "../hooks/useInvoices";
import StaffHome              from "./staff/StaffHome";
import StaffSales             from "./staff/StaffSales";
import StaffRecords           from "./staff/StaffRecords";
import StaffStock             from "./staff/StaffStock";
import StaffMe                from "./staff/StaffMe";
import { makeNav, greetingText, NK, GK } from "./staff/StaffShared";

/* ═══════════════════════════════════════════════════════════════════
   STAFF DASHBOARD — shell (navigation, header, data hooks)
   Tab content lives in src/screens/staff/*.jsx
═══════════════════════════════════════════════════════════════════ */
export default function StaffDashboard({ session, staff: staffProp, pinLock }) {
  const t = useT();

  const NAV = useMemo(() => makeNav(t), [t]);

  const [staffPatch, setStaffPatch] = useState({});
  const staff = useMemo(() => ({ ...staffProp, ...staffPatch }), [staffProp, staffPatch]);

  const [tab,        setTab]       = useState(() => {
    const p   = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "sales";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "sales";
    return "home";
  });
  const [subNav,     setSubNav]    = useState(() => {
    const p   = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "bills";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "bills";
    return null;
  });
  const [subData,    setSubData]   = useState(null);
  const [livePerms,  setLivePerms] = useState(staff?.staff_permissions || []);
  const [voiceOpen,  setVoiceOpen] = useState(false);
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [addTxnType, setAddTxnType] = useState("in");
  const openAddTxn = useCallback((type) => { setAddTxnType(type); setShowAddTxn(true); }, []);

  const staffId = staff?.id;
  const ownerId = staff?.owner_id;

  const notif           = useNotifications(staffId);
  const { addNotification } = notif;

  const store       = useStore(ownerId, staffId, staff?.full_name, addNotification);
  const inventory   = useInventory(ownerId, staffId, addNotification, staff?.branch_id || null);
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
    const channel = supabase
      .channel(`owner_plan_${ownerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `owner_id=eq.${ownerId}` },
        fetchOwnerPlan)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [ownerId]);

  const plan = ownerPlan;

  /* Live permissions */
  const fetchPerms = useCallback(async () => {
    if (!staffId) return;
    const { data } = await supabase.from("staff_permissions").select("*").eq("staff_id", staffId);
    if (data) setLivePerms(data);
  }, [staffId]);

  useEffect(() => {
    fetchPerms();
    if (!staffId || !ownerId) return;
    const channel = supabase
      .channel(`perms_${staffId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_permissions", filter: `staff_id=eq.${staffId}` },
        fetchPerms)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [staffId, ownerId, fetchPerms]);

  /* Voice: save parsed transaction via store (offline queue + sync) */
  const handleVoiceSave = useCallback(async (parsed) => {
    if (!parsed || !ownerId) return;
    await store.addTransaction({
      owner_id:         ownerId,
      staff_id:         staffId,
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
  }, [ownerId, staffId, staff, store]);

  /* Nav badges */
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

  const avatarInitial = (staff?.full_name || "S")[0].toUpperCase();

  function renderContent() {
    switch (tab) {
      case "home":    return <StaffHome    staff={staff} store={store} inventory={inventory} plan={plan} onGoTo={goTo} onVoiceOpen={() => setVoiceOpen(true)} onAddCash={openAddTxn} />;
      case "sales":   return <StaffSales   store={store} staff={staff} session={session} livePerms={livePerms} initialSub={subNav} initialData={subData} onVoiceOpen={() => setVoiceOpen(true)} inventory={inventory} onAddCash={openAddTxn} plan={plan} />;
      case "records": return <StaffRecords store={store} staff={staff} livePerms={livePerms} initialSub={subNav} plan={plan} invoiceHook={invoiceHook} inventory={inventory} ownerId={ownerId} />;
      case "stock":   return <StaffStock   inventory={inventory} staff={staff} livePerms={livePerms} plan={plan} />;
      case "me":      return <StaffMe      staff={staff} session={session} store={store} inventory={inventory} livePerms={livePerms} staffId={staffId} pinLock={pinLock} plan={plan} initialView={subNav} onStaffUpdate={p => setStaffPatch(prev => ({ ...prev, ...p }))} />;
      default:        setTab("home"); return null;
    }
  }

  return (
    <div className="h-[100dvh] bg-[#F6F8FC] dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative">

        {/* Header */}
        <header className="flex-none z-30 h-14 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
          {tab === "home" ? (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest leading-none">{greetingText(t)}</p>
              <p className="text-[17px] font-black leading-tight truncate" style={{ color: NK }}>
                {(staff?.full_name || "Staff").split(" ")[0]}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <AppLogo className="h-7 w-7 flex-shrink-0" />
              <p className="text-[17px] font-extrabold truncate" style={{ color: NK }}>
                {NAV.find(n => n.id === tab)?.label}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <NotificationBell unreadCount={notif.unreadCount} onClick={() => notif.setOpen(true)} />
            <button onClick={() => goTo("me")}
              className="w-9 h-9 rounded-full flex items-center justify-center border-2 border-slate-100 dark:border-slate-700 shadow-sm active:scale-90 transition-transform overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${NK} 0%, #1e3370 100%)` }}>
              {staff?.profile_image_url
                ? <img src={staff.profile_image_url} alt="" className="w-9 h-9 object-cover" />
                : <span className="text-sm font-black text-white">{avatarInitial}</span>}
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {renderContent()}
        </main>

        {/* Bottom nav — navy active, green indicator */}
        <nav className="flex-none z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float">
          <div className="flex items-stretch h-[60px]">
            {NAV.map(n => {
              const active = tab === n.id;
              const cnt    = badge(n.id);
              return (
                <button key={n.id} onClick={() => { setTab(n.id); setSubNav(null); setSubData(null); }}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative focus-visible:outline-none">
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-[3px] rounded-full"
                      style={{ backgroundColor: GK }} />
                  )}
                  <div className="relative transition-all duration-200">
                    <Icon name={n.icon} size={21}
                    className={active ? "text-[#16255A] dark:text-[#3DA829]" : "text-slate-400 dark:text-slate-500"} />
                    {cnt > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center leading-none">
                        {cnt > 9 ? "9+" : cnt}
                      </span>
                    )}
                  </div>
                  <span className={`text-[9px] font-bold leading-none ${active ? "text-[#16255A] dark:text-[#3DA829]" : "text-slate-400 dark:text-slate-500"}`}>
                    {n.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} className="bg-white dark:bg-slate-900" />
        </nav>

        {/* Dashboard-level modals (must escape overflow:hidden on <main>) */}
        {showAddTxn && (
          <AddTxnModal
            defaultType={addTxnType}
            onAdd={store.addTransaction}
            onClose={() => setShowAddTxn(false)}
            inventory={inventory}
          />
        )}
        {voiceOpen && (
          <VoiceModal onClose={() => setVoiceOpen(false)} onSave={handleVoiceSave} />
        )}
        <NotificationCenter notif={notif} />

      </div>
    </div>
  );
}
