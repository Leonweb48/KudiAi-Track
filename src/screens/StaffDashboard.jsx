import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase }           from "../utils/supabase";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useStore }           from "../hooks/useStore";
import { useInventory }       from "../hooks/useInventory";
import { today }              from "../utils/helpers";
import { normalizeSlug }      from "../utils/plans";
import AppLogo                from "../components/AppLogo";
import Icon                   from "../components/Icon";
import SyncBar                from "../components/SyncBar";
import VoiceModal             from "../components/VoiceModal";
import { AddTxnModal }        from "./Transactions";
import { useT }               from "../contexts/LanguageContext";
import { useInvoices }        from "../hooks/useInvoices";
import NotificationCenter     from "../components/NotificationCenter";
import { useToast }           from "../components/Toast";
import StaffHome              from "./staff/StaffHome";
import StaffSales             from "./staff/StaffSales";
import StaffRecords           from "./staff/StaffRecords";
import StaffStock             from "./staff/StaffStock";
import StaffMe                from "./staff/StaffMe";
import { makeNav } from "./staff/StaffShared";
import AIChatWidget           from "../components/AIChatWidget";

/* ═══════════════════════════════════════════════════════════════════
   STAFF DASHBOARD — shell (navigation, header, data hooks)
   Tab content lives in src/screens/staff/*.jsx
═══════════════════════════════════════════════════════════════════ */
export default function StaffDashboard({ session, staff: staffProp, pinLock }) {
  const t    = useT();
  const toast = useToast();

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
  // PERM-1: transactions.can_create gate — staff without create permission cannot open the add modal
  const openAddTxn = useCallback((type) => {
    if (!(livePerms.find(p => p.module === "transactions")?.can_create)) return;
    setAddTxnType(type); setShowAddTxn(true);
  }, [livePerms]);
  const canAddTxn = !!(livePerms.find(p => p.module === "transactions")?.can_create);

  const staffId = staff?.id;
  const ownerId = staff?.owner_id;

  const store       = useStore(ownerId, staffId, staff?.full_name, staff?.branch_id || null);
  const inventory   = useInventory(ownerId, staffId, staff?.branch_id || null);
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

  /* D10: Kill session immediately if owner removes or suspends this staff */
  useEffect(() => {
    if (!staffId) return;
    const ch = supabase
      .channel(`staff_status_${staffId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "staff", filter: `id=eq.${staffId}` },
        (payload) => {
          const s = payload.new?.status;
          if (s === "removed" || s === "suspended") supabase.auth.signOut();
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [staffId]);

  /* D11: Staff-scoped AI context — only their own data, no business-wide figures */
  const staffPortalContext = useMemo(() => {
    if (!staff || !ownerId) return "";
    const { transactions = [], credits = [], asoClients = [] } = store;
    const todayStr  = today();
    const todayTx   = transactions.filter(tx => tx.transaction_date === todayStr);
    const todaySales = todayTx.filter(tx => tx.type === "in").reduce((s, tx) => s + tx.amount, 0);
    const pendingCr  = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
    return `You are assisting ${staff.full_name}, a ${(staff.role || "staff member").replace(/_/g, " ")} at ${staff.business_name || "the business"}.
IMPORTANT: You can ONLY see this staff member's own data — their own sales, credits, and ajo clients. Do NOT reveal full business data or other staff records.
Today's transactions: ${todayTx.length}. Today's cash in: ₦${todaySales.toLocaleString()}.
Pending credit outstanding: ₦${pendingCr.toLocaleString()} across ${credits.length} credit clients. Ajo clients: ${asoClients.length}.
If asked about business-wide figures (total business revenue, all staff performance, business bank details, business wallet), say only the business owner can access that.`;
  }, [staff, store, ownerId]);

  const staffQuickChips = useMemo(() => [
    { label: "Today's Sales",       q: "How much did I sell today?"                       },
    { label: "My Credits",          q: "Show me my pending credit clients and totals"     },
    { label: "Commission",          q: "What is my commission this month?"                },
    { label: "Ajo Summary",         q: "Give me my ajo clients summary"                  },
    { label: "Recent Transactions", q: "What are my most recent transactions?"            },
  ], []);

  usePushNotifications(session?.user?.id ?? null, (dl) => { if (dl?.tab) goTo(dl.tab, dl.sub || null); });

  const avatarInitial = (staff?.full_name || "S")[0].toUpperCase();

  function renderContent() {
    switch (tab) {
      case "home":    return <StaffHome    staff={staff} store={store} inventory={inventory} plan={plan} onGoTo={goTo} onVoiceOpen={() => setVoiceOpen(true)} onAddCash={openAddTxn} canAddTxn={canAddTxn} />;
      case "sales":   return <StaffSales   store={store} staff={staff} session={session} livePerms={livePerms} initialSub={subNav} initialData={subData} onVoiceOpen={() => setVoiceOpen(true)} inventory={inventory} onAddCash={openAddTxn} plan={plan} />;
      case "records": return <StaffRecords store={store} staff={staff} livePerms={livePerms} initialSub={subNav} plan={plan} invoiceHook={invoiceHook} inventory={inventory} ownerId={ownerId} />;
      case "stock":   return <StaffStock   inventory={inventory} staff={staff} livePerms={livePerms} plan={plan} />;
      case "me":      return <StaffMe      staff={staff} session={session} store={store} inventory={inventory} livePerms={livePerms} staffId={staffId} pinLock={pinLock} plan={plan} initialView={subNav} onStaffUpdate={p => setStaffPatch(prev => ({ ...prev, ...p }))} />;
      default:        setTab("home"); return null;
    }
  }

  return (
    <div className="h-[100dvh] bg-white dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative">

        {/* Header */}
        <header className="flex-none z-sticky bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
          <div style={{ height: "env(safe-area-inset-top, 0px)" }} />
          <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-2 flex-none min-w-0">
            <AppLogo className="h-8 w-8 flex-shrink-0" />
            {staff?.business_name ? (
              <p className="text-[15px] font-black text-slate-800 dark:text-white leading-tight truncate" style={{ maxWidth: 160 }}>
                {staff.business_name}
              </p>
            ) : (
              <div className="flex items-baseline gap-0.5">
                <span className="text-[17px] font-black tracking-tight text-slate-800 dark:text-slate-100">Kudi</span>
                <span className="text-[17px] font-black tracking-tight"
                  style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  AI
                </span>
                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Track</span>
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
              className="w-9 h-9 rounded-full flex items-center justify-center border-2 border-slate-100 dark:border-slate-700 shadow-sm active:scale-90 transition-transform overflow-hidden"
              style={{ background: "linear-gradient(135deg,var(--brand-green),var(--brand-green-dark))" }}>
              {staff?.profile_image_url
                ? <img src={staff.profile_image_url} alt="" className="w-9 h-9 object-cover" />
                : <span className="text-sm font-black text-white">{avatarInitial}</span>}
            </button>
          </div>
          </div>
        </header>

        <SyncBar isOnline={store.isOnline} fromCache={store.fromCache} dbError={store.dbError} loadError={store.loadError} />

        {/* Content */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {renderContent()}
        </main>

        {/* Bottom nav — business portal pill-background style */}
        <nav className="flex-none z-20 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-stretch px-1 h-[64px]">
            {NAV.map(n => {
              const active = tab === n.id;
              const cnt    = badge(n.id);
              return (
                <button key={n.id} onClick={() => { setTab(n.id); setSubNav(null); setSubData(null); }}
                  aria-current={active ? "page" : undefined}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 relative focus-visible:outline-none">
                  {active && (
                    <span className="absolute inset-x-0.5 top-1.5 bottom-1.5 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 pointer-events-none" />
                  )}
                  <div className="relative z-10">
                    <Icon name={n.icon} size={22}
                      className={`transition-all duration-200 ${active ? "scale-110 text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}`} />
                    {cnt > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center leading-none">
                        {cnt > 9 ? "9+" : cnt}
                      </span>
                    )}
                  </div>
                  <span className={`relative z-10 text-[9px] font-bold uppercase tracking-wide leading-none transition-colors duration-200 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}`}>
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
        {/* D11: Staff-aware AI assistant — staff-scoped context, no business-wide data */}
        <AIChatWidget
          portalContext={staffPortalContext}
          quickChips={staffQuickChips}
          greeting={`Hi ${(staff?.full_name || "").split(" ")[0] || "there"}! I'm **KudiAI**, your personal assistant.\n\nI can see your own sales, credits, and ajo clients. Ask me anything about your performance!`}
          inputPlaceholder="Ask about your sales, credits, or ajo…"
        />

      </div>
    </div>
  );
}
