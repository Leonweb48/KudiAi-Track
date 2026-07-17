import { useMemo, useState, useEffect } from "react";
import { fmt, today } from "../../utils/helpers";
import { AmountDisplay } from "../../components/shared/AmountDisplay";
import { canDo } from "../../utils/plans";
import { useT, useLanguage } from "../../contexts/LanguageContext";
import { supabase } from "../../utils/supabase";
import { useCampaigns } from "../../hooks/useCampaigns";
import { usePartnerOffers } from "../../hooks/usePartnerOffers";
import AnnouncementBarSlot from "../../components/slots/AnnouncementBarSlot";
import OffersSection from "../../components/slots/OffersSection";
import TabCardQuadSlot from "../../components/slots/TabCardQuadSlot";
import TabCardDuoSlot from "../../components/slots/TabCardDuoSlot";
import {
  Svg, P,
  TxRow,
  makeBillServices, fmtDate, greetingText,
} from "./StaffShared";

/* Brand gradient — canonical; green-drift + violet entries resolve here (Gate S3) */
const BRAND_GRAD = "linear-gradient(135deg,#3DA829,#2E8020)";

/* Gradient per service id — category-identity colors as named constants (SVCGRAD ruling) */
const SVCGRAD = {
  "cash-in":     BRAND_GRAD,
  "cash-out":    "linear-gradient(135deg,#ef4444,#dc2626)",
  "credit":      "linear-gradient(135deg,#d97706,#b45309)",
  "bills":       "linear-gradient(135deg,#ec4899,#be185d)",
  "mic":         BRAND_GRAD,
  "airtime":     "linear-gradient(135deg,#ef4444,#dc2626)",
  "data":        "linear-gradient(135deg,#3b82f6,#1d4ed8)",
  "electricity": "linear-gradient(135deg,#f59e0b,#d97706)",
  "cable":       BRAND_GRAD,
  "betting":     BRAND_GRAD,
  "ajo":         "linear-gradient(135deg,#6366f1,#4f46e5)",
  "report":      "linear-gradient(135deg,#64748b,#475569)",
};

/* ═══════════════════════════════════════════════════════════════════
   HOME TAB — redesigned to match business portal look and feel
═══════════════════════════════════════════════════════════════════ */
export default function StaffHome({ staff, store, inventory, plan, onGoTo, onVoiceOpen, onAddCash, canAddTxn }) {
  const t = useT();
  const { lang } = useLanguage();
  const BILL_SERVICES = useMemo(() => makeBillServices(t), [t]);
  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } = useCampaigns(["announcement_bar","upsell_inline","tab_card_quad","tab_card_duo"], "staff", "staff.home");
  const staffTabCard = (camSlots.tab_card_quad || [])[0] ?? (camSlots.tab_card_duo || [])[0] ?? null;
  const annBars = camSlots.announcement_bar || [];
  const { offers: partnerOffers, loading: offersLoading, recordEvent: recordOfferEvent, ctaUrl } = usePartnerOffers("staff");

  const { transactions = [], credits = [], asoClients = [], loading } = store;

  const [commEarned,       setCommEarned]       = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    const staffId = staff?.id;
    if (!staffId) return;
    const thisMonth = new Date().toISOString().slice(0, 7);
    supabase.from("commission_earnings").select("amount")
      .eq("staff_id", staffId).neq("status", "voided").gte("earned_at", thisMonth + "-01")
      .then(({ data }) => {
        if (data) setCommEarned(data.reduce((s, e) => s + Number(e.amount), 0));
      });
    supabase.from("approval_requests").select("id", { count: "exact", head: true })
      .eq("staff_id", staffId).eq("status", "pending")
      .then(({ count }) => setPendingApprovals(count || 0));
  }, [staff?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayStr     = today();
  const todayTx      = transactions.filter(tx => tx.transaction_date === todayStr);
  const cashIn       = todayTx.filter(tx => tx.type === "in").reduce((s, tx) => s + tx.amount, 0);
  const cashOut      = todayTx.filter(tx => tx.type === "out").reduce((s, tx) => s + tx.amount, 0);
  const profit       = cashIn - cashOut;
  const totalCredit  = credits.reduce((s, c) => s + (c.outstanding || 0), 0);
  const overdueCount = credits.filter(c => c.status === "overdue").length;
  const totalAso     = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const lowStock     = inventory?.lowStock || [];

  /* 8 service buttons (4-col × 2 rows), gradient rounded-2xl */
  const services = useMemo(() => [
    ...(canAddTxn ? [
      { id: "cash-in",  label: "Cash In",  icon: P.in,  onClick: () => onAddCash("in")  },
      { id: "cash-out", label: "Cash Out", icon: P.out, onClick: () => onAddCash("out") },
    ] : []),
    { id: "credit",   label: "Credit",    icon: P.credit, onClick: () => onGoTo("records","credit") },
    { id: "bills",    label: "Pay Bills", icon: P.bills,  onClick: () => onGoTo("sales","bills") },
    ...BILL_SERVICES.slice(0, 3).map(s => ({
      id:      s.id,
      label:   s.label,
      icon:    s.icon,
      onClick: s.isMic ? onVoiceOpen : () => onGoTo("sales","bills",s.id),
    })),
    canDo(plan, "aso")
      ? { id: "ajo",    label: "Ajo",     icon: P.bank,   onClick: () => onGoTo("records","ajo") }
      : { id: "report", label: "Reports", icon: P.report, onClick: () => onGoTo("me","reports") },
  ], [BILL_SERVICES, plan, onAddCash, onVoiceOpen, onGoTo, canAddTxn]);

  return (
    <div className="overflow-y-auto h-full pb-6 space-y-4 screen-enter">
      <AnnouncementBarSlot campaigns={annBars} loading={camLoading} recordEvent={recordCamEvent} />
      <div className="px-4 pt-5 space-y-4">

      {/* D5: Pending approval alert */}
      {pendingApprovals > 0 && (
        <div className="w-full flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl px-4 py-3">
          <Svg d={P.alert} size={18} color="#d97706" />
          <p className="flex-1 text-sm font-semibold text-amber-700 dark:text-amber-400">
            {pendingApprovals} approval request{pendingApprovals > 1 ? "s" : ""} awaiting manager review
          </p>
        </div>
      )}

      {/* Overdue credit alert */}
      {overdueCount > 0 && (
        <button onClick={() => onGoTo("records","credit")}
          className="w-full flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-2xl px-4 py-3 active:scale-[.98] transition text-left">
          <Svg d={P.alert} size={18} color="#ef4444" />
          <p className="flex-1 text-sm font-semibold text-red-700 dark:text-red-400">
            {overdueCount} overdue credit{overdueCount > 1 ? "s" : ""} — tap to follow up
          </p>
          <Svg d="M9 18l6-6-6-6" size={16} color="#ef4444" />
        </button>
      )}

      {/* Low stock alert */}
      {canDo(plan, "inventory") && lowStock.length > 0 && (
        <button onClick={() => onGoTo("stock")}
          className="w-full flex items-center gap-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/40 rounded-2xl px-4 py-3 active:scale-[.98] transition text-left">
          <Svg d={P.alert} size={18} color="#f97316" />
          <p className="flex-1 text-sm font-semibold text-orange-700 dark:text-orange-400">
            {lowStock.length} item{lowStock.length > 1 ? "s" : ""} running low in stock
          </p>
          <Svg d="M9 18l6-6-6-6" size={16} color="#f97316" />
        </button>
      )}

      {/* Hero card — brand gradient */}
      <div className="rounded-3xl px-5 pt-5 pb-6 text-white relative overflow-hidden shadow-hero bg-[linear-gradient(145deg,#3DA829_0%,#2E8020_55%,#1a5c0e_100%)]">
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          {/* Greeting */}
          <p className="text-[12px] font-semibold text-white/70">{greetingText(t)},</p>
          <p className="text-[15px] font-black text-white truncate mb-3">
            {(staff?.full_name || "Staff").split(" ")[0]}
          </p>
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Today's Profit</p>
          <p className="text-[11px] text-white/40 mb-1">{fmtDate(lang)}</p>
          {loading
            ? <div className="h-12 w-44 bg-white/20 rounded-xl animate-pulse mt-2 mb-5" />
            : <AmountDisplay amount={Math.abs(profit)} size="hero" align="left" className="mt-1 mb-5" style={{ color: profit < 0 ? '#fca5a5' : '#fff' }} />
          }
          <div className="h-px bg-white/10 mb-4" />
          <div className="flex gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Cash In</p>
              {loading ? <p className="text-base font-bold tabular text-white">—</p> : <AmountDisplay amount={cashIn} size="row" align="left" className="text-white font-bold" />}
            </div>
            <div className="w-px bg-white/15 self-stretch" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Cash Out</p>
              {loading ? <p className="text-base font-bold tabular text-red-300">—</p> : <AmountDisplay amount={cashOut} size="row" align="left" className="text-red-300 font-bold" />}
            </div>
            <div className="w-px bg-white/15 self-stretch" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Txns</p>
              <p className="text-base font-bold tabular text-white">{loading ? "—" : todayTx.length}</p>
            </div>
            {commEarned !== null && commEarned > 0 && (
              <>
                <div className="w-px bg-white/15 self-stretch" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Commission</p>
                  {loading ? <p className="text-base font-bold tabular text-white">—</p> : <AmountDisplay amount={commEarned} size="row" align="left" className="text-white font-bold" />}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Horizontal stat chips — business portal style */}
      <div className="overflow-x-auto no-scrollbar -mx-4 px-4">
        <div className="flex gap-3 pb-1">
          <button onClick={() => onGoTo("sales","cash")}
            className="flex-shrink-0 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 border bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800/40 active:scale-95 transition">
            <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <Svg d={P.in} size={14} color="#059669" sw={2.5} />
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cash In</p>
              <p className="text-sm font-extrabold tabular text-green-700 dark:text-green-400">{loading ? "—" : fmt(cashIn)}</p>
            </div>
          </button>

          <button onClick={() => onGoTo("sales","all")}
            className="flex-shrink-0 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 border bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/40 active:scale-95 transition">
            <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
              <Svg d={P.out} size={14} color="#ef4444" sw={2.5} />
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Cash Out</p>
              <p className="text-sm font-extrabold tabular text-red-600 dark:text-red-400">{loading ? "—" : fmt(cashOut)}</p>
            </div>
          </button>

          <button onClick={() => onGoTo("records","credit")}
            className="flex-shrink-0 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 border bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/40 active:scale-95 transition">
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <Svg d={P.credit} size={14} color="#d97706" sw={2.5} />
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Credit</p>
              <p className="text-sm font-extrabold tabular text-amber-700 dark:text-amber-400">{loading ? "—" : fmt(totalCredit)}</p>
            </div>
          </button>

          {canDo(plan, "aso") && (
            <button onClick={() => onGoTo("records","ajo")}
              className="flex-shrink-0 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 border bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/40 active:scale-95 transition">
              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <Svg d={P.bank} size={14} color="#3b82f6" sw={2.5} />
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Ajo</p>
                <p className="text-sm font-extrabold tabular text-blue-700 dark:text-blue-400">{loading ? "—" : fmt(totalAso)}</p>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Quick Services — gradient rounded-2xl (matches business portal) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">Quick Services</p>
          <button onClick={() => onGoTo("sales","bills")}
            className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
            See all
          </button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {services.map(s => (
            <button key={s.id} onClick={s.onClick}
              className="flex flex-col items-center gap-2 active:scale-90 transition-transform duration-150">
              <div className="w-[54px] h-[54px] rounded-2xl flex items-center justify-center shadow-sm"
                style={{ background: SVCGRAD[s.id] || BRAND_GRAD }}>
                <Svg d={s.icon} size={22} color="#fff" sw={2} />
              </div>
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 text-center leading-tight w-full truncate px-0.5">
                {s.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] font-bold text-slate-700 dark:text-slate-300 tracking-wide">Recent</p>
          <button onClick={() => onGoTo("sales","all")}
            className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
            View all →
          </button>
        </div>
        {loading
          ? [1,2,3].map(i => <div key={i} className="h-[68px] bg-slate-100 dark:bg-slate-700/60 rounded-2xl animate-pulse mb-2" />)
          : transactions.slice(0, 5).length === 0
            ? <p className="text-center text-sm text-slate-400 py-8">No sales recorded yet</p>
            : transactions.slice(0, 5).map((tx, i) => (
                <div key={tx.id || i} className="mb-2">
                  <TxRow t={tx} onClick={() => onGoTo("sales","receipt",tx)} />
                </div>
              ))
        }
      </div>
      </div>
      {staffTabCard && staffTabCard.slot === "tab_card_quad" && (
        <TabCardQuadSlot campaign={staffTabCard} pageKey="staff.home" recordEvent={recordCamEvent} />
      )}
      {staffTabCard && staffTabCard.slot === "tab_card_duo" && (
        <TabCardDuoSlot campaign={staffTabCard} pageKey="staff.home" recordEvent={recordCamEvent} />
      )}
      <OffersSection
        offers={partnerOffers}
        loading={offersLoading}
        recordEvent={recordOfferEvent}
        ctaUrl={ctaUrl}
        title="Offers"
      />
    </div>
  );
}
