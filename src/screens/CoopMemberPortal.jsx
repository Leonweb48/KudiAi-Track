import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { friendlyError } from "../utils/errorMessage";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { buildCallbackUrl, openPaystackCheckout } from "../utils/paystackCheckout";
import { supabase } from "../utils/supabase";
import { performLogout } from "../utils/logout";
import { useTheme } from "../hooks/useTheme";
import { useT, useLanguage } from "../contexts/LanguageContext";
import { LANGUAGES, markLangChosen } from "../utils/i18n";
import Modal from "../components/shared/Modal";
import BillPayments from "./BillPayments";
import CashbackCard from "../components/CashbackCard";
import GroupChat from "./GroupChat";
import AIChatWidget from "../components/AIChatWidget";
import { buildCoopMemberContext } from "../utils/buildContext";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildCoopSavingsReceipt, buildCoopWithdrawalRequestReceipt, buildCoopLoanRepaymentReceipt } from "../utils/receiptConfig";
import { sendEmailTrigger } from "../utils/emailTrigger";
import AppLogo from "../components/AppLogo";
import TransactionPinModal from "../components/TransactionPinModal";
import { useCampaigns } from "../hooks/useCampaigns";
import { usePartnerOffers } from "../hooks/usePartnerOffers";
import AnnouncementBarSlot from "../components/slots/AnnouncementBarSlot";
import OffersSection from "../components/slots/OffersSection";
import PoweredByCardSlot from "../components/slots/PoweredByCardSlot";
import TabCardQuadSlot from "../components/slots/TabCardQuadSlot";
import TabCardDuoSlot from "../components/slots/TabCardDuoSlot";
import { createReportPdf, fmtCurrency as pdfFmt, fmtDate as pdfFmtDate } from "../utils/generateReportPdf";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import NotificationCenter from "../components/NotificationCenter";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useToast } from "../components/Toast";
import SyncBar from "../components/SyncBar";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { setCache, getCache } from "../utils/offlineCache";

const coopFn = async (action, body = {}) => {
  const r = await supabase.functions.invoke("coop-portal", { body: { action, ...body } });
  // Check data.error first — Supabase JS populates r.data even on non-2xx in some versions,
  // and r.error only carries a generic "Edge Function returned a non-2xx" message.
  if (r.data?.error) throw new Error(r.data.error);
  if (r.error) {
    // Try to extract a readable message from the error context body
    const ctx = r.error?.context;
    const body = ctx ? (await ctx.json?.().catch(() => null)) : null;
    if (body?.error) throw new Error(body.error);
    if (body?.message) throw new Error(body.message);
    throw r.error;
  }
  return r.data;
};

const ORG_PAY_PREFIX      = "org_member_pending_";
const ORG_LOAN_PAY_PREFIX = "org_loan_pending_";

const fmt     = n => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT   = d => d ? new Date(d).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const ANN_COLORS = {
  announcement: "bg-green-50 text-green-700 border-green-200",
  notice:       "bg-amber-50 text-amber-700 border-amber-200",
  circular:     "bg-green-50 text-green-700 border-green-200",
  emergency:    "bg-red-50 text-red-700 border-red-300",
};
const ANN_ICONS = { announcement: "📢", notice: "📋", circular: "📄", emergency: "🚨" };
const FREQ_LABELS = { daily:"Daily", weekly:"Weekly", monthly:"Monthly", quarterly:"Quarterly", annual:"Annual", one_time:"One-time" };
const ORG_TYPE_ICONS = { cooperative:"🤝", market_association:"🏪", church:"⛪", ngo:"🌍", youth_group:"👥", savings_group:"💰", community_group:"🏘️", professional_association:"💼", savings_club:"🏦" };

// ═══════════════════════════════════════════════════
//  FIRST LOGIN — set password (same pattern as staff/ajo)
// ═══════════════════════════════════════════════════
export function CoopMemberFirstLogin({ member }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);

  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-green-500", "bg-green-500"];

  const submit = async () => {
    if (password.length < 8) { setError(t("setup.minChars")); return; }
    if (password !== confirm) { setError(t("setup.mismatch")); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false, account_type: "org_member", email_verified: true },
    });
    if (err) { setError(friendlyError(err)); setSaving(false); return; }
    // Fire welcome email now — member has completed full setup and is about to land on portal
    const memberEmail = member?.email || (await supabase.auth.getUser()).data?.user?.email || "";
    sendEmailTrigger("org_member_first_login", {
      name: member?.full_name || "", email: memberEmail, org_name: member?.org?.name || member?.organizations?.name || "",
    });
    setSuccess(true);
    // onAuthStateChange fires → must_change_password: false → org_member status → CoopMemberPortal
  };

  if (success) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">{t("setup.passwordSet")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("setup.takingYou")}</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <div className="bg-white dark:bg-[#0b120e] border-b border-slate-100 dark:border-[#162218] px-5 pt-14 pb-6">
        <div className="flex justify-center mb-5">
          <div className="bg-white/90 dark:bg-white/10 rounded-2xl p-2 shadow">
            <AppLogo className="h-9 w-auto" />
          </div>
        </div>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 bg-[linear-gradient(135deg,#3DA829,#065f46)]">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">{t("setup.setPassword")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Hi {member?.full_name?.split(" ")[0] || "there"}! Choose a secure password for your member portal access.
        </p>
      </div>
      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("setup.newPassword")}</label>
          <div className="relative">
            <input type={showPwd ? "text" : "password"} value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder={t("setup.minChars")}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-green-600 dark:text-green-400">
              {showPwd ? t("setup.hide") : t("setup.show")}
            </button>
          </div>
          {password && (
            <div className="flex gap-1 mt-1.5">
              {[1,2,3,4].map(n => (
                <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= score ? colors[score] : "bg-slate-200 dark:bg-slate-700"}`} />
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{t("setup.confirmPassword")}</label>
          <input type={showPwd ? "text" : "password"} value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            placeholder={t("setup.repeatPassword")}
            className={`w-full border rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 ${confirm && confirm !== password ? "border-red-400 dark:border-red-600" : "border-slate-200 dark:border-slate-700"}`} />
          {confirm && confirm !== password && <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>}
        </div>
        <div className="bg-slate-50 dark:bg-[#0b120e] border border-slate-100 dark:border-[#162218] rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Requirements</p>
          {[
            { rule: t("setup.atLeast8"),    pass: password.length >= 8 },
            { rule: t("setup.oneUppercase"), pass: /[A-Z]/.test(password) },
            { rule: t("setup.oneNumber"),    pass: /[0-9]/.test(password) },
          ].map(({ rule, pass }) => (
            <div key={rule} className="flex items-center gap-2">
              <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${pass ? "" : "bg-slate-200 dark:bg-slate-700"}`}
                style={pass ? { background: "#3DA829" } : {}}>
                {pass && <svg viewBox="0 0 24 24" fill="none" className="w-2.5 h-2.5" stroke="white" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>}
              </div>
              <p className={`text-[11px] font-medium ${pass ? "" : "text-slate-400 dark:text-slate-500"}`}
                style={pass ? { color: "#3DA829" } : {}}>
                {rule}
              </p>
            </div>
          ))}
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">{error}</p>}
        <button onClick={submit} disabled={saving || password.length < 8 || password !== confirm}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition">
          {saving ? t("setup.saving") : t("setup.setBtn")}
        </button>
        <button onClick={() => supabase.auth.signOut()} className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center">
          {t("setup.signOut")}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  HOME TAB — Premium Member Dashboard
// ═══════════════════════════════════════════════════
const MBR_QUICK = [
  { id:"airtime",     label:"Airtime",     g1:"#ef4444", g2:"#b91c1c", icon:"M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.122.966.356 1.916.7 2.81a2 2 0 01-.45 2.11L6.95 7.91a16 16 0 006.29 6.29l1.27-.56a2 2 0 012.11-.45c.894.344 1.844.578 2.81.7A2 2 0 0122 16.92z" },
  { id:"data",        label:"Data",        g1:"#3b82f6", g2:"#1d4ed8", icon:"M1.05 5l4.95-3 4.95 3 4.95-3L21 5|M1.05 11l4.95-3 4.95 3 4.95-3L21 11|M1.05 17l4.95-3 4.95 3 4.95-3L21 17" },
  { id:"electricity", label:"Electricity", g1:"#f59e0b", g2:"#b45309", icon:"M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  { id:"cable",       label:"Cable TV",    g1:"#8b5cf6", g2:"#6d28d9", icon:"M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
];

function HomeTab({ member, org, announcements, polls = [], events = [], loans = [], wdRequests = [], onQuickService, onNavigate, userEmail }) {
  const t = useT();
  const activeLoans  = loans.filter(l => ["approved","disbursed","ongoing"].includes(l.status));
  const pendingWd    = wdRequests.filter(r => r.status === "pending");
  const pinnedAnns   = announcements.filter(a => a.is_pinned);
  const visibleAnns  = [...pinnedAnns.slice(0,1), ...announcements.filter(a => !a.is_pinned).slice(0,2)].slice(0,3);
  const activePolls  = polls.filter(p => !p.closes_at || new Date(p.closes_at) > new Date()).slice(0, 2);
  const upcomingEvts = events.filter(e => e.event_date && new Date(e.event_date) > new Date()).slice(0, 2);
  const orgActions   = [
    ...activePolls.map(p => ({ id: p.id, type:"poll",  label: p.question, sub:t("coopMem.activePoll") })),
    ...upcomingEvts.map(e => ({ id: e.id, type:"event", label: e.title,    sub: new Date(e.event_date).toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short"}) + (e.location ? ` · ${e.location}` : "") })),
  ];

  const STATS = [
    { label:t("coopMem.savingsBal"),  value: fmt(member.savings_balance),
      sub: t("coopDash.currentBalance"), bg:"#3DA829", tab:"contributions",
      icon:"M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { label:t("aiChip.activeLoans"),  value: activeLoans.length,
      sub: activeLoans.length > 0 ? fmt(activeLoans.reduce((s,l)=>s+(l.outstanding_balance||0),0))+" "+t("coopDash.owed") : t("coopDash.noneActive"),
      bg:"#dc2626", tab:"loans",
      icon:"M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
    { label:t("coopMem.wdRequests"),  value: pendingWd.length,
      sub: pendingWd.length > 0 ? t("coopDash.pendingApproval") : t("coopDash.nonePending"),
      bg: pendingWd.length > 0 ? "#d97706" : "#64748b", tab:"contributions",
      icon:"M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" },
    { label:t("coop.messages"),       value: announcements.length,
      sub: pinnedAnns.length > 0 ? `${pinnedAnns.length} ${t("coopDash.pinned")}` : t("coopDash.fromOrg"),
      bg:"#3DA829", tab:"messages",
      icon:"M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  ];

  return (
    <div className="pb-8 space-y-6">

      {/* ── Hero Balance Card ── */}
      <div className="mx-4 mt-5 rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero bg-[linear-gradient(145deg,#3DA829_0%,#2E8020_55%,#1E5514_100%)]">
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-6 right-24 w-14 h-14 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-lg font-extrabold text-white flex-shrink-0">
              {member.full_name?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white font-extrabold text-sm leading-tight truncate">{member.full_name}</p>
              <p className="text-green-200 text-[10px] font-mono truncate">{member.membership_id}</p>
            </div>
            <span className="flex-shrink-0 text-[10px] font-bold text-white/70 bg-white/10 px-2 py-0.5 rounded-full capitalize">{member.role}</span>
          </div>
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">{t("coopMem.savingsBal")}</p>
          <AmountDisplay amount={member.savings_balance} size="hero" align="left" className="text-white mt-1.5 mb-5" />
          <div className="flex gap-4 flex-wrap">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("coopMem.memberSince")}</p>
              <p className="text-sm font-bold">{fmtDate(member.joined_date)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("coopMem.status")}</p>
              <p className="text-sm font-bold capitalize">{member.status || "active"}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">{t("coopMem.orgMembers")}</p>
              <p className="text-sm font-bold tabular-nums">{org.member_count || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Services ── */}
      <div className="px-4">
        <div className="flex justify-between items-center mb-4">
          <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">{t("cd.quickServices")}</p>
          {onNavigate && <button onClick={() => onNavigate("bills")} className="text-[10px] font-bold text-green-600 dark:text-green-400">{t("cd.viewAll")}</button>}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {MBR_QUICK.map(s => (
            <button key={s.id} onClick={() => onQuickService?.(s.id)}
              className="flex flex-col items-center gap-2 active:scale-95 transition-transform duration-150">
              <div className="w-full aspect-square rounded-[18px] flex items-center justify-center shadow-lg max-w-[64px] mx-auto"
                style={{ background:`linear-gradient(145deg,${s.g1},${s.g2})` }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  {s.icon.split("|").map((p,i) => <path key={i} d={p} />)}
                </svg>
              </div>
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 leading-tight text-center w-full">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Cashback Balance ── */}
      <CashbackCard userEmail={userEmail} />

      {/* ── My Summary ── */}
      <div className="px-4">
        <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em] mb-4">{t("coopDash.mySummary")}</p>
        <div className="grid grid-cols-2 gap-3">
          {STATS.map(s => (
            <button key={s.label} onClick={() => onNavigate?.(s.tab)}
              className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 shadow-sm text-left active:scale-[0.97] transition-all">
              <div className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center"
                style={{ background: s.bg + "18" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: s.bg }}>
                  {s.icon.split("|").map((p,i) => <path key={i} d={p} />)}
                </svg>
              </div>
              <p className="text-2xl font-black text-slate-800 dark:text-white leading-none tabular-nums">{s.value}</p>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1.5">{s.label}</p>
              {s.sub && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{s.sub}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Organisation Card ── */}
      <div className="px-4">
        <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em] mb-3">{t("coopDash.organisation")}</p>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 dark:border-slate-700/40">
            <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center text-lg">
              {ORG_TYPE_ICONS[org.type] || "🏢"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold text-slate-800 dark:text-white">{org.name}</p>
              <p className="text-[10px] text-slate-400 capitalize">{org.type?.replace(/_/g," ")} · {org.member_count || 0} {t("coopDash.membersLabel")}</p>
            </div>
          </div>
          {[
            [t("coopMem.totalFunds"), fmt(org.total_savings || 0), "#3DA829"],
            [t("coop.loans"),         fmt(org.total_loans_out || 0), "#dc2626"],
          ].map(([k, v, c]) => (
            <div key={k} className="flex justify-between items-center px-4 py-3 border-b border-slate-50 dark:border-slate-700/30 last:border-0">
              <span className="text-xs text-slate-400">{k}</span>
              <span className="text-sm font-extrabold" style={{ color: c }}>{v}</span>
            </div>
          ))}
          {/* ── Cooperative identity ── */}
          {(org.reg_number || org.date_established) && (
            <div className="px-4 py-3 border-t border-slate-50 dark:border-slate-700/30 flex flex-wrap gap-x-5 gap-y-1">
              {org.reg_number && (
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{t("coopMem.regNo")}</p>
                  <p className="text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300">{org.reg_number}</p>
                </div>
              )}
              {org.date_established && (
                <div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{t("coopMem.founded")}</p>
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {new Date(org.date_established).getFullYear()}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Announcements ── */}
      {visibleAnns.length > 0 && (
        <div className="px-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">{t("cd.announcements")}</p>
            {onNavigate && <button onClick={() => onNavigate("messages")} className="text-[10px] font-bold text-green-600 dark:text-green-400">{t("cd.viewAll")}</button>}
          </div>
          <div className="flex flex-col gap-2">
            {visibleAnns.map(a => (
              <div key={a.id} className={`px-4 py-3 rounded-2xl border text-xs ${ANN_COLORS[a.type] || ANN_COLORS.announcement}`}>
                <div className="flex justify-between items-start gap-2">
                  <p className="font-extrabold leading-snug flex-1">{ANN_ICONS[a.type]} {a.title}</p>
                  {a.is_pinned && <span className="text-[9px] flex-shrink-0">📌</span>}
                </div>
                <p className="opacity-75 mt-1.5 line-clamp-2 leading-relaxed">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── From Organisation (active polls + upcoming events) ── */}
      {orgActions.length > 0 && (
        <div className="px-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">{t("coopMem.fromOrg")}</p>
            <button onClick={() => onNavigate?.("broadcast")} className="text-[10px] font-bold text-green-600 dark:text-green-400">{t("cd.seeAll")}</button>
          </div>
          <div className="flex flex-col gap-2">
            {orgActions.map(item => (
              <button key={item.id} onClick={() => onNavigate?.("broadcast")}
                className="w-full bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm px-4 py-3 flex items-center gap-3 text-left active:scale-[0.98] transition-all">
                <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ${item.type === "poll" ? "bg-teal-50 dark:bg-teal-900/20" : "bg-amber-50 dark:bg-amber-900/20"}`}>
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"
                    stroke={item.type === "poll" ? "#0f766e" : "#d97706"}>
                    {item.type === "poll"
                      ? <><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></>
                      : <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>
                    }
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{item.label}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{item.sub}</p>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  PAY VIA PAYSTACK MODAL  (redirect-based)
// ═══════════════════════════════════════════════════
function PayOrgModal({ member, org, preProgram, history, onClose }) {
  const t = useT();
  const [programId, setProgramId] = useState(preProgram?.id || "");
  const [programs,  setPrograms]  = useState(preProgram ? [preProgram] : []);
  const [amount,    setAmount]    = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [txnPin,    setTxnPin]    = useState(null);

  useEffect(() => {
    if (preProgram) return;
    coopFn("member-get-programs", { member_id: member.id, org_id: org.id })
      .then(r => setPrograms((r.programs || []).filter(p => p.status === "active")))
      .catch(() => null);
  }, [member.id, org.id, preProgram]);

  // Reset loading when payment browser closes without a confirmed payment (cancellation)
  useEffect(() => {
    const onBrowserClosed = () => {
      // If the pending key was already removed (paymentCallback handled it), do nothing
      const hasPending = Object.keys(localStorage).some(
        k => k.startsWith(ORG_PAY_PREFIX) || k.startsWith(ORG_LOAN_PAY_PREFIX)
      );
      if (!hasPending) return;
      setLoading(false);
      setError(t("coopMem.paymentFailedMsg"));
    };
    window.addEventListener("inAppBrowserFinished", onBrowserClosed);
    let capListener;
    if (Capacitor.isNativePlatform()) {
      import("@capacitor/browser").then(({ Browser }) => {
        Browser.addListener("browserFinished", onBrowserClosed).then(l => { capListener = l; });
      }).catch(() => {});
    }
    return () => {
      window.removeEventListener("inAppBrowserFinished", onBrowserClosed);
      capListener?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedProg = programs.find(p => p.id === programId) || null;
  const isFixed      = selectedProg?.contribution_type === "fixed";
  const required     = isFixed ? Number(selectedProg.amount) : 0;

  const paidThisMonth = useMemo(() => {
    if (!selectedProg || !history) return 0;
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    return history
      .filter(h => h.type === "deposit" && h.program_id === selectedProg.id && new Date(h.created_at) >= start)
      .reduce((s, h) => s + Number(h.amount), 0);
  }, [selectedProg, history]);

  const remaining = Math.max(0, required - paidThisMonth);
  const metTarget = isFixed && paidThisMonth >= required;
  const monthLabel = new Date().toLocaleString("en-NG", { month: "long", year: "numeric" });

  useEffect(() => {
    if (isFixed && remaining > 0) setAmount(String(remaining));
    else if (!isFixed) setAmount("");
  }, [programId, isFixed, remaining]);

  const handlePay = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError(t("error.somethingWrong")); return; }
    if (isFixed && !metTarget && (paidThisMonth + amt) < required) {
      setError(`Pay at least ${fmt(remaining)} to meet your ${fmt(required)} monthly target`);
      return;
    }
    setLoading(true); setError("");
    try {
      const res = await coopFn("initialize-member-payment", {
        member_id: member.id, org_id: org.id, amount: amt,
        program_id: programId || undefined,
        callback_url: buildCallbackUrl(window.location.origin),
      });
      if (!res.authorization_url) throw new Error(t("coopMem.payFailed"));
      localStorage.setItem(`${ORG_PAY_PREFIX}${res.reference}`, JSON.stringify({
        member_id: member.id, org_id: org.id, amount: amt,
        program_id: programId || undefined,
      }));
      await openPaystackCheckout(res.authorization_url);
    } catch (e) {
      setLoading(false);
      setError(e.message || "Payment failed. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end justify-center"
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[90dvh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-0.5">{t("coopMem.monthlyContrib")}</h3>
        <p className="text-xs text-slate-400 mb-4">{monthLabel} · {org.name}</p>

        {/* Program selector — only shown when not pre-selected */}
        {!preProgram && programs.length > 0 && (
          <div className="mb-4">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t("coopMem.contribProgram")}</label>
            <select value={programId} onChange={e => { setProgramId(e.target.value); setError(""); }} disabled={loading}
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50">
              <option value="">{t("coopMem.generalContrib")}</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}{p.contribution_type === "fixed" ? ` · ${fmt(p.amount)}` : ""}</option>)}
            </select>
          </div>
        )}

        {/* Monthly target status card for fixed programs */}
        {selectedProg && isFixed && (
          <div className={`rounded-2xl p-4 mb-4 border ${metTarget ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"}`}>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200">{selectedProg.name}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${metTarget ? "bg-green-500 text-white" : "bg-amber-500 text-white"}`}>
                {metTarget ? t("coopMem.targetMet") : t("coopMem.outstanding")}
              </span>
            </div>
            <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, (paidThisMonth / required) * 100)}%`, background: metTarget ? "#3DA829" : "#f59e0b" }} />
            </div>
            <div className="flex justify-between text-[10px] font-semibold mb-1">
              <span className="text-slate-500 dark:text-slate-400">{fmt(paidThisMonth)} {t("coopMem.paidThisMonth")}</span>
              <span className="text-slate-600 dark:text-slate-300">{fmt(required)} {t("coopMem.targetLabel")}</span>
            </div>
            {!metTarget && (
              <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                {fmt(remaining)} {t("coopMem.remaining")} for {monthLabel}
              </p>
            )}
          </div>
        )}

        {/* Voluntary program label */}
        {preProgram && !isFixed && (
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{preProgram.name}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{t("coopMem.voluntary")}</p>
          </div>
        )}

        {/* Amount input */}
        <div className="mb-4">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            {metTarget ? t("coopMem.extraContrib") : `${t("coopMem.amountNaira")}${isFixed ? ` · Min ${fmt(remaining)}` : ""}`}
          </label>
          <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
            placeholder={metTarget ? t("coopMem.topUpPlaceholder") : isFixed ? `Min ${fmt(remaining)}` : t("coopMem.enterAmountCoop")}
            disabled={loading}
            className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50" />
          {metTarget && <p className="text-[10px] text-green-600 dark:text-green-400 mt-1">{t("coopMem.targetMetNote")}</p>}
        </div>

        {error && <p className="text-xs px-3 py-2.5 rounded-xl mb-4 border bg-red-50 border-red-200 text-red-600">{error}</p>}

        <button onClick={() => {
          const amt = parseFloat(amount);
          if (!amt || amt <= 0) { setError(t("error.somethingWrong")); return; }
          setTxnPin({
            title: t("coopMem.confirmPaymentTitle"),
            amount: Math.round(amt * 100),
            recipient: org.name,
            description: selectedProg?.name || t("coopMem.savingsContribDesc"),
            onApprove: () => { setTxnPin(null); handlePay(); },
          });
        }} disabled={loading || !amount}
          className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl text-sm disabled:opacity-60">
          {loading
            ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />{t("bill.processing")}</span>
            : `Pay ${amount ? fmt(parseFloat(amount) || 0) : ""} via Paystack →`}
        </button>

        {!loading && (
          <button onClick={onClose} className="w-full py-3 text-xs text-slate-400 hover:text-slate-600 mt-1">{t("common.cancel")}</button>
        )}
        {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  REQUEST WITHDRAWAL MODAL
// ═══════════════════════════════════════════════════
function RequestWithdrawalModal({ member, org, onClose, onSuccess }) {
  const t = useT();
  const [amount,        setAmount]        = useState("");
  const [reason,        setReason]        = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash"); // "cash" | "bank_transfer"
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState("");
  const [done,          setDone]          = useState(false);
  const [txnPin,        setTxnPin]        = useState(null);
  const [feePreview,    setFeePreview]    = useState(null); // { gross_amount, transaction_charge, net_amount, payment_method }
  const [feeLoading,    setFeeLoading]    = useState(false);

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError(t("error.somethingWrong")); return; }
    if (amt > (member.savings_balance || 0)) { setError(t("error.somethingWrong")); return; }
    setSaving(true); setError("");
    try {
      await coopFn("request-member-withdrawal", {
        member_id: member.id, org_id: org.id, amount: amt, reason, payment_method: paymentMethod,
      });
      setDone(true);
      onSuccess?.();
    } catch (e) { setError(e.message || t("error.saveFailed")); }
    finally { setSaving(false); }
  };

  const handleContinue = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError(t("error.somethingWrong")); return; }
    if (amt > (member.savings_balance || 0)) { setError(t("error.somethingWrong")); return; }
    setError(""); setFeeLoading(true);
    try {
      const preview = await coopFn("get-withdrawal-fee-preview", {
        org_id: org.id, amount: amt, payment_method: paymentMethod,
      });
      setFeePreview(preview);
    } catch {
      setFeePreview({ gross_amount: amt, transaction_charge: 0, net_amount: amt, fee_applied: false, payment_method: paymentMethod });
    } finally { setFeeLoading(false); }
  };

  const confirmWithPin = () => {
    const amt = feePreview?.gross_amount || parseFloat(amount);
    const isBankTransfer = (feePreview?.payment_method ?? paymentMethod) === "bank_transfer";
    const chargeDesc = feePreview?.transaction_charge > 0
      ? `You'll receive ₦${Number(feePreview.net_amount).toLocaleString("en-NG")} · ₦${Number(feePreview.transaction_charge).toFixed(2)} ${isBankTransfer ? "transfer & processing fee" : "cooperative processing charge"}`
      : "Savings withdrawal request";
    setTxnPin({
      title: "Request Withdrawal",
      amount: Math.round(amt * 100),
      recipient: org.name,
      description: chargeDesc,
      onApprove: () => { setTxnPin(null); handleSubmit(); },
    });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end justify-center" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6">
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-5" />

        {done ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <p className="text-base font-extrabold text-slate-800 dark:text-white mb-1">{t("coopMem.reqSuccess")}</p>
            <p className="text-xs text-slate-400 mb-6">{t("coopMem.reqPendingDesc")} from {org.name}.</p>
            <button onClick={onClose} className="w-full py-3 bg-green-600 text-white font-bold rounded-2xl text-sm">{t("bp.done")}</button>
          </div>
        ) : feePreview ? (
          <>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">{t("coopMem.wdConfirmTitle")}</h3>
            <div className="bg-slate-50 dark:bg-slate-700/60 rounded-2xl px-4 py-4 mb-4 flex flex-col gap-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">{t("coopMem.wdRequested")}</span>
                <span className="font-bold text-slate-800 dark:text-white">{fmt(feePreview.gross_amount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">{t("coopMem.wdMethod")}</span>
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {(feePreview.payment_method ?? paymentMethod) === "bank_transfer" ? t("coopMem.wdBankTransfer") : t("coopMem.wdCash")}
                </span>
              </div>
              {feePreview.transaction_charge > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">
                    {(feePreview.payment_method ?? paymentMethod) === "bank_transfer" ? t("coopMem.transferFee") : t("coopMem.coopFee")}
                  </span>
                  <span className="font-bold text-red-500">−{fmt(feePreview.transaction_charge)}</span>
                </div>
              )}
              <div className="border-t border-slate-200 dark:border-slate-600 pt-2.5 flex justify-between">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{t("coopMem.wdReceive")}</span>
                <span className="text-base font-black text-green-600">{fmt(feePreview.net_amount)}</span>
              </div>
            </div>
            {feePreview.transaction_charge > 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-4 leading-relaxed">
                {(feePreview.payment_method ?? paymentMethod) === "bank_transfer"
                  ? `The ₦${Number(feePreview.transaction_charge).toFixed(2)} covers your bank transfer and processing costs. It is deducted from your withdrawal.`
                  : `The ₦${Number(feePreview.transaction_charge).toFixed(2)} is a cooperative processing charge. It is deducted from your withdrawal.`
                }
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setFeePreview(null)} disabled={saving}
                className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">
                {t("coopMem.wdBack")}
              </button>
              <button onClick={confirmWithPin} disabled={saving}
                className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {t("coopMem.wdConfirmBtn")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">{t("coopMem.reqWithdrawal")}</h3>
            <p className="text-xs text-slate-400 mb-4">{t("coopMem.wdAvailBal")} <strong className="text-green-600">{fmt(member.savings_balance)}</strong></p>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t("loan.amountField")}</label>
                <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
                  placeholder={t("bill.enterAmount")}
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">{t("coopMem.wdMethodLabel")}</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "cash",          label: t("coopMem.wdCash"),         icon: "💵" },
                    { value: "bank_transfer", label: t("coopMem.wdBankTransfer"), icon: "🏦" },
                  ].map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setPaymentMethod(opt.value)}
                      className={`py-2.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                        paymentMethod === opt.value
                          ? "border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                          : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                      }`}>
                      <span>{opt.icon}</span>{opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t("fin.notesOptional")}</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder={t("coopMem.wdReasonPH")}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} disabled={saving || feeLoading} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">{t("common.cancel")}</button>
              <button onClick={handleContinue} disabled={saving || feeLoading || !amount}
                className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {feeLoading ? "Checking…" : t("loan.submitBtn")}
              </button>
            </div>
          </>
        )}
      </div>
      {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  CONTRIBUTIONS TAB
// ═══════════════════════════════════════════════════
function ContributionsTab({ member: initialMember, org, onMemberUpdate }) {
  const t = useT();
  const [member,          setMember]          = useState(initialMember);
  const [programs,        setPrograms]        = useState([]);
  const [history,         setHistory]         = useState([]);
  const [wdRequests,      setWdRequests]      = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [showPay,         setShowPay]         = useState(false);
  const [payProgram,      setPayProgram]      = useState(null);
  const [showWdReq,       setShowWdReq]       = useState(false);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);

  useEffect(() => { setMember(initialMember); }, [initialMember]);

  const load = useCallback(() => {
    if (!navigator.onLine) { setLoading(false); return; }
    Promise.all([
      coopFn("member-get-programs",            { member_id: member.id, org_id: org.id }),
      coopFn("member-get-savings",             { member_id: member.id }),
      coopFn("get-member-withdrawal-requests", { member_id: member.id }),
    ]).then(([pr, sr, rr]) => {
      setPrograms(pr.programs || []);
      setHistory(sr.savings || []);
      setWdRequests(rr.requests || []);
    }).finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  const totalContributed = history.filter(h => h.type === "deposit").reduce((sum, h) => sum + Number(h.amount), 0);
  const hasPaystack = !!org.paystack_subaccount_code;

  const handleExportSavingsPdf = async () => {
    const sorted = [...history].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const rows = sorted.map(h => {
      const isWd = h.type === "withdrawal";
      const amt  = parseFloat(h.amount) || 0;
      return {
        date:        pdfFmtDate(h.created_at),
        description: (h.org_contribution_programs?.name || (isWd ? "Withdrawal" : "Deposit")),
        reference:   h.payment_method || "—",
        debit:       isWd ? pdfFmt(amt) : "",
        credit:      isWd ? "" : pdfFmt(amt),
        balance:     pdfFmt(parseFloat(h.balance_after) || 0),
      };
    });
    const totD = history.filter(h => h.type === "withdrawal").reduce((s, h) => s + (parseFloat(h.amount) || 0), 0);
    const totC = history.filter(h => h.type !== "withdrawal").reduce((s, h) => s + (parseFloat(h.amount) || 0), 0);
    const lastBal = history.length > 0 ? (parseFloat(history[history.length - 1].balance_after) || 0) : 0;
    const firstRow = sorted[0];
    const openingBalance = firstRow
      ? (firstRow.type === "withdrawal"
          ? (parseFloat(firstRow.balance_after) || 0) + (parseFloat(firstRow.amount) || 0)
          : (parseFloat(firstRow.balance_after) || 0) - (parseFloat(firstRow.amount) || 0))
      : 0;
    const dateFrom = sorted.length > 0 ? pdfFmtDate(sorted[0].created_at) : "";
    const dateTo   = sorted.length > 0 ? pdfFmtDate(sorted[sorted.length - 1].created_at) : "";
    const pdf = await createReportPdf({
      title: "Savings Statement", businessName: org.name || "Coop",
      period: dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : "All time",
      headerRight: [
        { value: org.name || "Coop" },
        { value: member.full_name, sub: true },
        org.phone    ? { value: org.phone,    sub: true } : null,
        org.email    ? { value: org.email,    sub: true } : null,
        org.reg_number ? { value: `Reg: ${org.reg_number}`, sub: true } : null,
      ].filter(Boolean),
      entityDetails: [
        { label: "Member",          value: member.full_name },
        { label: "Membership ID",   value: member.membership_id || "—" },
        { label: "Organisation",    value: org.name },
        { label: "Savings Balance", value: pdfFmt(member.savings_balance || lastBal) },
      ],
    });
    pdf.addStats([
      { label: "Total Deposited", value: pdfFmt(totC),                 color: "#3DA829" },
      { label: "Total Withdrawn", value: pdfFmt(totD),                 color: "#ef4444" },
      { label: "Net Savings",     value: pdfFmt(member.savings_balance || lastBal) },
      { label: "Records",         value: String(history.length) },
    ]);
    pdf.addStatement(rows, { openingBalance, totalDebits: totD, totalCredits: totC });
    await pdf.save(`Savings_Statement_${member.full_name.replace(/\s+/g, "_")}.pdf`);
  };
  const pendingWd = wdRequests.filter(r => r.status === "pending").length;

  const getMonthPaid = (programId) => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    return history
      .filter(h => h.type === "deposit" && h.program_id === programId && new Date(h.created_at) >= start)
      .reduce((s, h) => s + Number(h.amount), 0);
  };

  return (
    <div className="p-4 pb-28 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center">
          <AmountDisplay amount={member.savings_balance} size="stat" align="center" className="text-[#3DA829]" />
          <p className="text-[10px] text-slate-400 mt-0.5">{t("ajoPt.currentBalance")}</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center">
          <AmountDisplay amount={totalContributed} size="stat" align="center" className="text-[#3DA829]" />
          <p className="text-[10px] text-slate-400 mt-0.5">{t("coopMem.totalContribs")}</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {hasPaystack && (
          <button onClick={() => setShowPay(true)}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            {t("coopMem.payPaystack")}
          </button>
        )}
        <button onClick={() => setShowWdReq(true)}
          className={`${hasPaystack ? "flex-1" : "w-full"} py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          {t("coopMem.reqWithdrawal")}
          {pendingWd > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-black flex items-center justify-center">{pendingWd}</span>}
        </button>
      </div>

      {programs.filter(p => p.status === "active").length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">{t("coopMem.contribProgs")}</p>
          {programs.filter(p => p.status === "active").map(p => {
            const isFixed   = p.contribution_type === "fixed";
            const required  = isFixed ? Number(p.amount) : 0;
            const paid      = isFixed ? getMonthPaid(p.id) : 0;
            const remaining = Math.max(0, required - paid);
            const metTarget = isFixed && paid >= required;
            const pct       = isFixed && required > 0 ? Math.min(100, (paid / required) * 100) : 0;
            const isMonthly = p.frequency === "monthly";
            return (
              <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 mb-2 last:mb-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold text-slate-800 dark:text-white leading-snug">{p.name}</p>
                    {p.description && <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{p.description}</p>}
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded-lg">{FREQ_LABELS[p.frequency]}</span>
                      {isFixed && <span className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-600 px-2 py-0.5 rounded-lg">{fmt(p.amount)}</span>}
                      {!isFixed && <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded-lg">{t("prog.typeVoluntary")}</span>}
                    </div>
                  </div>
                  {hasPaystack && (
                    <button
                      onClick={() => { setPayProgram(p); setShowPay(true); }}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all active:scale-95 ${metTarget ? "bg-green-50 dark:bg-green-900/20 text-green-600 border border-green-200 dark:border-green-800" : "bg-green-600 text-white"}`}>
                      {metTarget ? "✓ Paid" : isFixed ? `Pay ${fmt(remaining)}` : "Pay"}
                    </button>
                  )}
                </div>
                {/* Monthly progress bar for fixed programs */}
                {isFixed && isMonthly && (
                  <div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-1">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: metTarget ? "#3DA829" : "#f59e0b" }} />
                    </div>
                    <div className="flex justify-between text-[9px] font-semibold text-slate-400">
                      <span>{fmt(paid)} {t("coopMem.paidThisMonth")}</span>
                      <span className={metTarget ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
                        {metTarget ? t("coopMem.targetMet") : `${fmt(remaining)} ${t("coopMem.remaining")}`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {wdRequests.length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">{t("coopMem.wdRequests")}</p>
          <div className="flex flex-col gap-2">
            {wdRequests.slice(0, 5).map(r => (
              <div key={r.id} className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-slate-700 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{fmt(r.amount)}</p>
                  {r.reason && <p className="text-[10px] text-slate-400 line-clamp-1">{r.reason}</p>}
                  <p className="text-[10px] text-slate-400">{fmtDate(r.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold capitalize px-2 py-0.5 rounded-full ${r.status === "pending" ? "bg-amber-50 text-amber-600" : r.status === "approved" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
                    {r.status}
                  </span>
                  {r.status !== "pending" && (
                    <button onClick={() => setSelectedRequest(r)} className="text-[10px] font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-2 py-0.5 rounded-full">
                      {t("fin.viewReceipt")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("coopMem.contribHistory")}</p>
          {history.length > 0 && (
            <button onClick={handleExportSavingsPdf}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 active:scale-95 transition">
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-slate-500 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15V3m0 12l-4-4m4 4l4-4"/><path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"/>
              </svg>
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-300">PDF</span>
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">{t("coopMem.noContribs")}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map(h => (
              <button key={h.id} onClick={() => setSelectedHistory(h)} className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-slate-700 flex justify-between items-start w-full text-left active:scale-[0.98] transition-transform">
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200 capitalize">{h.type}</p>
                  {h.org_contribution_programs?.name && <p className="text-[10px] text-green-500 font-semibold">{h.org_contribution_programs.name}</p>}
                  <p className="text-[10px] text-slate-400">{fmtDT(h.created_at)} · {h.payment_method}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-extrabold tabular ${h.type === "withdrawal" ? "text-red-500" : "text-green-600"}`}>
                    {h.type === "withdrawal" ? "−" : "+"}{fmt(h.amount)}
                  </p>
                  <p className="text-[10px] text-slate-400">Bal: {fmt(h.balance_after)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showPay && (
        <PayOrgModal
          member={member} org={org}
          preProgram={payProgram}
          history={history}
          onClose={() => { setShowPay(false); setPayProgram(null); }}
        />
      )}
      {showWdReq && (
        <RequestWithdrawalModal
          member={member} org={org}
          onClose={() => setShowWdReq(false)}
          onSuccess={() => { setShowWdReq(false); load(); }}
        />
      )}
      {selectedHistory && (
        <TransactionDetailModal
          data={buildCoopSavingsReceipt(selectedHistory, member.full_name, org.name)}
          onClose={() => setSelectedHistory(null)}
        />
      )}
      {selectedRequest && (
        <TransactionDetailModal
          data={buildCoopWithdrawalRequestReceipt(selectedRequest, member.full_name, org.name)}
          onClose={() => setSelectedRequest(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  LOANS TAB
// ═══════════════════════════════════════════════════
const LOAN_STATUS_COL = {
  pending: "text-amber-500", approved: "text-blue-600", disbursed: "text-green-600",
  repaid: "text-slate-400", rejected: "text-red-500", defaulted: "text-red-700",
};

function calcLoanPreview(principal, rate, months) {
  const totalInterest      = principal * (rate / 100);
  const totalRepayable     = principal + totalInterest;
  const monthlyInstallment = totalRepayable / Math.max(1, months);
  return { totalInterest, totalRepayable, monthlyInstallment };
}

function LoansTab({ member, org }) {
  const t = useT();
  const [loans,      setLoans]      = useState([]);
  const [txnPin,     setTxnPin]     = useState(null);
  const [repayments, setRepayments] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);
  const [showApply,  setShowApply]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [repaying,   setRepaying]   = useState(false);
  const [error,      setError]      = useState("");
  const [receipt,    setReceipt]    = useState(null);
  const defaultRate  = org.default_loan_interest_rate ?? 10;
  const [form, setForm] = useState({
    amount_requested: "", interest_rate: String(defaultRate),
    loan_purpose: "", repayment_months: "12",
  });

  const load = useCallback(() => {
    if (!navigator.onLine) { setLoading(false); return; }
    coopFn("get-loans", { org_id: org.id, member_id: member.id })
      .then(r => setLoans(r.loans || []))
      .finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  // Reset repaying when payment browser closes without a confirmed repayment (cancellation)
  useEffect(() => {
    const onBrowserClosed = () => {
      const hasPending = Object.keys(localStorage).some(
        k => k.startsWith(ORG_PAY_PREFIX) || k.startsWith(ORG_LOAN_PAY_PREFIX)
      );
      if (!hasPending) return;
      setRepaying(false);
      setError(t("coopMem.paymentFailedMsg"));
    };
    window.addEventListener("inAppBrowserFinished", onBrowserClosed);
    let capListener;
    if (Capacitor.isNativePlatform()) {
      import("@capacitor/browser").then(({ Browser }) => {
        Browser.addListener("browserFinished", onBrowserClosed).then(l => { capListener = l; });
      }).catch(() => {});
    }
    return () => {
      window.removeEventListener("inAppBrowserFinished", onBrowserClosed);
      capListener?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const principal = parseFloat(form.amount_requested) || 0;
  const rate      = parseFloat(form.interest_rate) || 0;
  const months    = parseInt(form.repayment_months) || 1;
  const preview   = calcLoanPreview(principal, rate, months);

  const handleApply = async () => {
    if (!form.amount_requested) { setError(t("error.somethingWrong")); return; }
    setSaving(true); setError("");
    try {
      await coopFn("apply-loan", { org_id: org.id, member_id: member.id, ...form, applied_by: "member" });
      setShowApply(false);
      setForm({ amount_requested: "", interest_rate: String(defaultRate), loan_purpose: "", repayment_months: "12" });
      load();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const openLoan = (l) => {
    setSelected(l); setError("");
    coopFn("get-repayments", { loan_id: l.id }).then(r => setRepayments(r.repayments || []));
  };

  const handlePaystackRepay = async (loan) => {
    if (!org.paystack_subaccount_code) { setError("Organisation has not configured Paystack payments"); return; }
    const repayAmt = loan.monthly_installment || loan.outstanding_balance;
    setRepaying(true); setError("");
    try {
      const res = await coopFn("initialize-loan-payment", {
        member_id: member.id, org_id: org.id,
        loan_id: loan.id, amount: repayAmt,
        callback_url: buildCallbackUrl(window.location.origin),
      });
      if (!res.authorization_url) throw new Error(t("coopMem.payFailed"));
      localStorage.setItem(`${ORG_LOAN_PAY_PREFIX}${res.reference}`, JSON.stringify({
        member_id: member.id, org_id: org.id, loan_id: loan.id, amount: repayAmt,
      }));
      await openPaystackCheckout(res.authorization_url);
    } catch (e) {
      setRepaying(false);
      setError(e.message || "Payment failed. Please try again.");
    }
  };

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 pb-28 flex flex-col gap-3">
      <button onClick={() => setShowApply(true)}
        className="w-full py-3 bg-amber-500 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2">
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M12 4v16m8-8H4" /></svg>
        {t("loan.applyTitle")}
      </button>

      {loans.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">{t("loan.noMemberLoans")}</p>
          <p className="text-sm text-slate-400">{t("loan.noMemberDesc")}</p>
        </div>
      ) : (
        loans.map(l => {
          const isOverdue = l.status === "disbursed" && l.due_date && l.due_date < today;
          return (
            <button key={l.id} onClick={() => openLoan(l)}
              className={`bg-white dark:bg-slate-800 rounded-2xl p-4 border text-left w-full ${isOverdue ? "border-red-300 dark:border-red-700" : "border-slate-100 dark:border-slate-700"}`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-white">{l.loan_purpose || t("loan.generalLabel")}</p>
                  <p className="text-[10px] text-slate-400">{fmtDate(l.applied_at)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-bold capitalize ${LOAN_STATUS_COL[l.status] || "text-slate-500"}`}>
                      ● {l.status === "rejected" ? t("coopMem.loanDeclined") : l.status}
                    </span>
                    {isOverdue && <span className="text-[9px] font-black text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">{t("loan.overdueLabel")}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold text-amber-600">{fmt(l.amount_requested)}</p>
                  {l.outstanding_balance > 0 && <p className="text-xs text-red-500 font-bold">{t("coop.loanBalance") || "Owed"}: {fmt(l.outstanding_balance)}</p>}
                </div>
              </div>
              {l.status === "rejected" && l.rejection_reason && (
                <div className="mb-2 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
                  <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide mb-0.5">{t("coopMem.decisionReason")}</p>
                  <p className="text-xs text-red-600 dark:text-red-400">{l.rejection_reason}</p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                {[
                  { k: "interest", label: t("loan.interestLabel"), v: `${l.interest_rate}%` },
                  { k: "monthly",  label: t("loan.monthlyLabel"),  v: fmt(l.monthly_installment || 0) },
                  { k: "due",      label: t("loan.dueDate"),       v: fmtDate(l.due_date) },
                ].map(({ k, label, v }) => (
                  <div key={k}><p className="text-[10px] text-slate-400">{label}</p><p className="text-xs font-bold text-slate-700 dark:text-slate-200">{v || "—"}</p></div>
                ))}
              </div>
            </button>
          );
        })
      )}

      {/* Loan application modal */}
      {showApply && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-sm p-5 max-h-[85dvh] overflow-y-auto">
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">{t("loan.applyTitle")}</h3>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t("loan.amountField")}</label>
                  <input value={form.amount_requested} onChange={set("amount_requested")} type="number" placeholder="0"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t("loan.monthsField")}</label>
                  <input value={form.repayment_months} onChange={set("repayment_months")} type="number" min="1"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{t("loan.purposeField")}</label>
                <input value={form.loan_purpose} onChange={set("loan_purpose")} placeholder="What's it for?"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
              </div>
              {principal > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2">{t("loan.estimatedRepay")}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[[t("loan.interestLabel"), fmt(preview.totalInterest)],
                      [t("loan.totalRepayable"), fmt(preview.totalRepayable)],
                      [t("loan.monthlyLabel"), fmt(preview.monthlyInstallment)]].map(([k, v]) => (
                      <div key={k} className="text-center">
                        <p className="text-[9px] text-amber-600">{k}</p>
                        <p className="text-xs font-extrabold text-amber-800 dark:text-amber-300">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setShowApply(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">{t("common.cancel")}</button>
              <button onClick={handleApply} disabled={saving} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? t("loan.submitting") : t("loan.submitBtn")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Loan detail sheet */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-sm p-5 max-h-[85dvh] overflow-y-auto">
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-base font-extrabold text-slate-800 dark:text-white">{selected.loan_purpose || t("loan.generalLabel")}</p>
                <p className="text-[10px] text-slate-400">{fmtDate(selected.applied_at)}</p>
              </div>
              <span className={`text-xs font-bold capitalize px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 ${LOAN_STATUS_COL[selected.status]}`}>{selected.status}</span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-3 mb-3 grid grid-cols-2 gap-2">
              {[
                [t("loan.amountField"), fmt(selected.amount_requested)],
                [t("loan.interestLabel"), `${selected.interest_rate}%`],
                [t("loan.totalRepayable"), fmt(selected.total_repayable || selected.amount_requested)],
                [t("loan.monthlyInstall"), fmt(selected.monthly_installment || 0)],
                [t("loan.outstanding"), fmt(selected.outstanding_balance)],
                [t("loan.dueDate"), fmtDate(selected.due_date)],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[9px] text-slate-400 uppercase tracking-wider">{k}</p>
                  <p className="text-xs font-bold text-slate-800 dark:text-white">{v}</p>
                </div>
              ))}
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 mb-3">
                <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {selected.status === "disbursed" && selected.outstanding_balance > 0 && (
              <button onClick={() => {
                const repayAmt = selected.monthly_installment || selected.outstanding_balance;
                setTxnPin({
                  title: "Repay Loan Instalment",
                  amount: Math.round((repayAmt || 0) * 100),
                  recipient: org.name,
                  description: "Loan repayment via Paystack",
                  onApprove: () => { setTxnPin(null); handlePaystackRepay(selected); },
                });
              }} disabled={repaying}
                className="w-full py-3 bg-green-600 text-white rounded-2xl font-bold text-sm mb-3 flex items-center justify-center gap-2 disabled:opacity-70 active:scale-[0.98] transition-transform">
                {repaying
                  ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />{t("bill.processing")}</>
                  : <><svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>{t("coopMem.payPaystack")} — {fmt(selected.monthly_installment || selected.outstanding_balance)}</>}
              </button>
            )}

            {selected.status === "pending" && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 mb-3 text-center">
                <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{t("loan.awaitingReview")}</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">{t("loan.awaitingDesc")}</p>
              </div>
            )}

            {repayments.length > 0 && (
              <div className="mb-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">{t("loan.repayHistory")}</p>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
                  {repayments.map(r => (
                    <button key={r.id} onClick={() => setReceipt(buildCoopLoanRepaymentReceipt(r, selected, member.full_name, org.name))}
                      className="w-full text-left flex justify-between items-center bg-slate-50 dark:bg-slate-700 rounded-lg px-2.5 py-1.5 active:scale-[0.98] transition-transform">
                      <div>
                        <p className="text-xs font-bold text-green-600">{fmt(r.amount)}</p>
                        <p className="text-[10px] text-slate-400">{fmtDT(r.created_at)} · {r.payment_method}</p>
                      </div>
                      {r.interest_portion > 0 && (
                        <p className="text-[10px] text-amber-600">+{fmt(r.interest_portion)} interest</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => { setSelected(null); setRepayments([]); setError(""); }}
              className="w-full py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">{t("common.close")}</button>
          </div>
        </div>
      )}
      {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  BROADCAST STATION TAB (member portal)
// ═══════════════════════════════════════════════════
function MemberBroadcastTab({ member, org }) {
  const t = useT();
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState("all");
  const [rsvping,    setRsvping]    = useState(null);
  const [voting,     setVoting]     = useState(null);
  const [actionErr,  setActionErr]  = useState("");

  const load = useCallback(() => {
    coopFn("member-get-broadcasts", { member_id: member.id, org_id: org.id })
      .then(r => setBroadcasts(r.broadcasts || []))
      .finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  const handleRsvp = async (meetingId, status) => {
    setRsvping(meetingId); setActionErr("");
    try { await coopFn("set-rsvp", { meeting_id: meetingId, member_id: member.id, org_id: org.id, status }); load(); }
    catch (e) { setActionErr(friendlyError(e)); }
    finally { setRsvping(null); }
  };

  const handleVote = async (pollId, optionIndex) => {
    setVoting(pollId); setActionErr("");
    try { await coopFn("member-submit-poll-vote", { poll_id: pollId, member_id: member.id, option_index: optionIndex }); load(); }
    catch (e) { setActionErr(friendlyError(e)); }
    finally { setVoting(null); }
  };

  const FILTER_TABS = [
    { id: "all",          label: "All"                        },
    { id: "meeting",      label: t("bcast.meetings")      },
    { id: "announcement", label: t("bcast.announcements") },
    { id: "event",        label: t("bcast.events")        },
    { id: "poll",         label: t("bcast.polls")         },
  ];
  const RSVP_OPTIONS = [
    { status: "attending",     label: t("bcast.attending"), color: "bg-green-500 text-white"  },
    { status: "maybe",         label: t("bcast.maybe"),     color: "bg-amber-400 text-white"  },
    { status: "not_attending", label: t("bcast.cantGo"),    color: "bg-slate-400 text-white"  },
  ];
  const TYPE_COLORS = {
    meeting:      { bg: "bg-[#0D2040]", text: "text-white", label: t("bcast.meeting")      },
    announcement: { bg: "bg-amber-500",  text: "text-white", label: t("bcast.announcement") },
    event:        { bg: "bg-[#3DA829]",  text: "text-white", label: t("bcast.event")        },
    poll:         { bg: "bg-purple-600", text: "text-white", label: t("bcast.poll")         },
  };

  const visible = filter === "all" ? broadcasts : broadcasts.filter(b => b._type === filter);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-[3px] border-t-transparent rounded-full animate-spin" style={{ borderColor: "#3DA829", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {actionErr && (
        <div className="mx-4 mt-3 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-xl px-3 py-2 flex justify-between items-center">
          <span>{actionErr}</span>
          <button onClick={() => setActionErr("")} className="ml-2 font-bold">✕</button>
        </div>
      )}
      {/* Filter tabs */}
      <div className="px-4 pt-4 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {FILTER_TABS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${filter === f.id ? "text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"}`}
            style={filter === f.id ? { background: "#0D2040" } : {}}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-28 flex flex-col gap-3 pt-2">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <span className="text-5xl mb-4">📡</span>
            <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">{t("bcast.noBroadcasts")}</p>
            <p className="text-sm text-slate-400">Your organisation's broadcasts will appear here.</p>
          </div>
        ) : visible.map(item => {
          const tc = TYPE_COLORS[item._type];
          return (
            <div key={item.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
              <div className="flex items-start gap-2 mb-1.5">
                <span className={`flex-shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full mt-0.5 ${tc.bg} ${tc.text}`}>{tc.label}</span>
                <p className="text-sm font-extrabold text-slate-800 dark:text-white leading-snug">{item.title || item.question}</p>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">{fmtDT(item.scheduled_at || item.event_date || item.created_at)}</p>

              {/* Meeting */}
              {item._type === "meeting" && (<>
                {item.location && <p className="text-[11px] text-slate-400 mb-1">📍 {item.location}</p>}
                {item.meeting_link && (
                  <a href={item.meeting_link} target="_blank" rel="noreferrer"
                    className="inline-block mb-2 text-[10px] font-bold text-green-500 bg-green-50 dark:bg-green-900/20 px-2.5 py-1 rounded-lg">{`🔗 ${t("bcast.joinOnline")}`}</a>
                )}
                {item.agenda && (
                  <div className="bg-slate-50 dark:bg-slate-700 rounded-xl px-3 py-2 mb-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t("bcast.agenda")}</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line line-clamp-4">{item.agenda}</p>
                  </div>
                )}
                {item.my_attendance && (
                  <p className={`text-[10px] font-bold mb-2 ${item.my_attendance === "present" ? "text-green-600" : "text-red-500"}`}>
                    {item.my_attendance === "present" ? `✓ ${t("bcast.present")}` : `✗ ${t("bcast.absent")}`}
                  </p>
                )}
                {item.rsvp_counts && (
                  <div className="flex gap-2 text-[10px] text-slate-400 mb-2">
                    <span className="text-green-600 font-bold">✓ {item.rsvp_counts.attending}</span>
                    <span>·</span>
                    <span className="text-amber-500 font-bold">? {item.rsvp_counts.maybe}</span>
                    <span>·</span>
                    <span className="text-slate-400 font-bold">✗ {item.rsvp_counts.not_attending}</span>
                  </div>
                )}
                <div className="flex gap-1.5">
                  {RSVP_OPTIONS.map(opt => {
                    const isActive = item.my_rsvp === opt.status;
                    return (
                      <button key={opt.status} onClick={() => handleRsvp(item.id, opt.status)} disabled={rsvping === item.id}
                        className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold border transition disabled:opacity-50 ${isActive ? opt.color + " border-transparent" : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 bg-transparent"}`}>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </>)}

              {/* Announcement */}
              {item._type === "announcement" && item.body && (
                <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{item.body}</p>
              )}

              {/* Event */}
              {item._type === "event" && (<>
                {item.description && <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">{item.description}</p>}
                {item.location    && <p className="text-[11px] text-slate-400">📍 {item.location}</p>}
                {item.end_date    && <p className="text-[11px] text-slate-400">Until {fmtDT(item.end_date)}</p>}
                {item.event_link  && (
                  <a href={item.event_link} target="_blank" rel="noreferrer"
                    className="inline-block mt-2 text-[10px] font-bold text-green-500 bg-green-50 dark:bg-green-900/20 px-2.5 py-1 rounded-lg">{`🔗 ${t("bcast.moreInfo")}`}</a>
                )}
              </>)}

              {/* Poll */}
              {item._type === "poll" && (<>
                <div className="flex flex-col gap-1.5 mb-2">
                  {(item.options || []).map((opt, i) => {
                    const votes   = (item.vote_counts || {})[i] || 0;
                    const total   = item.total_votes || 0;
                    const pct     = total > 0 ? Math.round(votes / total * 100) : 0;
                    const isMyVote = item.my_vote === i;
                    const hasVoted = item.my_vote != null;
                    return (
                      <button key={i}
                        onClick={() => !hasVoted && item.is_active && handleVote(item.id, i)}
                        disabled={hasVoted || !item.is_active || voting === item.id}
                        className={`relative rounded-xl overflow-hidden text-left border-2 transition ${isMyVote ? "border-green-400" : "border-slate-200 dark:border-slate-600"}`}>
                        <div className="absolute inset-0" style={{ width: `${pct}%`, background: isMyVote ? "#3DA82920" : "#00000008" }} />
                        <div className="relative px-3 py-2 flex justify-between items-center">
                          <span className={`text-[11px] font-semibold ${isMyVote ? "text-green-700 dark:text-green-300" : "text-slate-700 dark:text-slate-200"}`}>
                            {isMyVote && "✓ "}{opt}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-2">{pct}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400">
                  {item.total_votes || 0} {t("bcast.votes")} · {item.is_active ? t("bcast.pollOpen") : t("bcast.pollClosed")}
                  {item.closes_at && item.is_active ? ` · Closes ${fmtDT(item.closes_at)}` : ""}
                </p>
                {item.my_vote == null && item.is_active && (
                  <p className="text-[10px] font-bold mt-1 text-[#3DA829]">{t("bcast.tapToVote")}</p>
                )}
              </>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  SUPPORT TAB
// ═══════════════════════════════════════════════════
const FAQS = [
  {
    q: "How do I make a contribution?",
    a: "Go to the Savings tab and tap 'Pay via Paystack' next to your active contribution program, or use the 'General Contribution' button to pay any amount.",
  },
  {
    q: "How do I apply for a loan?",
    a: "Open the Loans tab and tap 'Apply for Loan'. Fill in the amount and purpose, then submit. Your admin will review and approve or reject the application.",
  },
  {
    q: "How long does loan approval take?",
    a: "Loan approval time depends on your organisation's admin. You will receive an in-app notification and email once a decision is made.",
  },
  {
    q: "How do I repay my loan?",
    a: "Open the Loans tab, tap on your active loan, then tap 'Pay via Paystack'. You will be redirected to a secure payment page.",
  },
  {
    q: "Can I withdraw my savings?",
    a: "Yes. Go to the Savings tab and tap 'Request Withdrawal'. Your admin must approve the request before funds are released.",
  },
  {
    q: "Where can I find my membership ID?",
    a: "Your membership ID is shown on your profile (tap your avatar in the top-right corner) and also visible in the portal header.",
  },
  {
    q: "How do I update my name or profile photo?",
    a: "Tap your avatar in the top-right corner of the portal to open your profile. You can update your name, phone number, and photo there.",
  },
  {
    q: "Why can't I see my loan balance?",
    a: "Loan balances only appear once a loan has been approved and disbursed. If your application is still pending, you will see it listed as 'Awaiting Review'.",
  },
];

function SupportTab({ member, org }) {
  const t = useT();
  const [view,      setView]      = useState("ticket"); // "ticket" | "faq"
  const [category,  setCategory]  = useState("General");
  const [subject,   setSubject]   = useState("");
  const [message,   setMessage]   = useState("");
  const [sending,   setSending]   = useState(false);
  const [error,     setError]     = useState("");
  const [done,      setDone]      = useState(null); // ticket_ref on success
  const [openFaq,   setOpenFaq]   = useState(null);

  const submit = async () => {
    if (!subject.trim() || !message.trim()) { setError(t("error.somethingWrong")); return; }
    setSending(true); setError("");
    try {
      const res = await coopFn("submit-support-ticket", {
        member_id: member.id, org_id: org.id,
        category, subject: subject.trim(), message: message.trim(),
      });
      setDone(res.ticket_ref);
      setSubject(""); setMessage(""); setCategory("General");
    } catch (e) {
      setError(e.message || t("error.saveFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab switcher */}
      <div className="flex-none flex border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        {[
          { id: "ticket", label: t("coopMem.raiseTicketBtn"), icon: "M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" },
          { id: "faq",    label: "FAQ",                       icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
        ].map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-bold border-b-2 transition-colors
              ${view === t.id ? "border-[#3DA829] text-[#3DA829]" : "border-transparent text-slate-400 dark:text-slate-500"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-28">
        {view === "ticket" ? (
          done ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center bg-[linear-gradient(135deg,#3DA829,#2E8020)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <p className="text-base font-extrabold text-slate-800 dark:text-white">{t("coopMem.ticketSuccess")}</p>
                <p className="text-[12px] text-slate-400 mt-1">{t("coopMem.ticketRef")} <span className="font-bold text-[#3DA829]">{done}</span></p>
                <p className="text-[12px] text-slate-400 mt-2 leading-relaxed">You'll receive a confirmation email shortly. Your organisation admin has been notified.</p>
              </div>
              <button onClick={() => setDone(null)}
                className="mt-2 px-6 py-2.5 bg-[#3DA829] text-white text-sm font-bold rounded-xl active:opacity-80">
                {t("coopMem.raiseAnother")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="bg-[#3DA829]/8 dark:bg-[#3DA829]/10 rounded-2xl p-4 border border-[#3DA829]/20">
                <p className="text-[12px] font-bold text-[#3DA829]">{t("coopMem.howItWorks")}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">Your ticket is sent to your organisation admin. You'll get a confirmation email and the admin will follow up with you directly.</p>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3">
                  <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              {/* Category */}
              <div>
                <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-2">Category</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "General",   label: t("coopMem.categoryGeneral") },
                    { key: "Savings",   label: t("coopMem.categorySavings") },
                    { key: "Loans",     label: t("coopMem.categoryLoans")   },
                    { key: "Technical", label: t("coopMem.categoryTech")    },
                  ].map(({ key: c, label: cLabel }) => (
                    <button key={c} onClick={() => setCategory(c)}
                      className={`py-2.5 rounded-xl text-[12px] font-bold border-2 transition-all active:scale-[0.97]
                        ${category === c ? "border-[#3DA829] bg-[#3DA829]/8 text-[#3DA829]" : "border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800"}`}>
                      {cLabel}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("coopMem.subjectField")}</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={t("coopMem.subjectPH")}
                  className="w-full bg-slate-100 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#3DA829]" />
              </div>

              {/* Message */}
              <div>
                <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("coopMem.messageField")}</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5}
                  placeholder={t("coopMem.messagePH")}
                  className="w-full bg-slate-100 dark:bg-slate-800 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-white outline-none resize-none focus:ring-2 focus:ring-[#3DA829]" />
              </div>

              <button onClick={submit} disabled={sending || !subject.trim() || !message.trim()}
                className="w-full py-3.5 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50 active:opacity-80 transition-opacity bg-[linear-gradient(135deg,#3DA829,#2E8020)]">
                {sending
                  ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />{t("coopMem.sending")}</>
                  : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>{t("coopMem.ticketSubmit")}</>}
              </button>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">{t("coopMem.faqTitle")}</p>
            {FAQS.map((faq, i) => (
              <div key={i}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left gap-3 active:bg-slate-50 dark:active:bg-slate-700/50">
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-white leading-snug flex-1">{faq.q}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
                    className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform ${openFaq === i ? "rotate-180" : ""}`}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 border-t border-slate-50 dark:border-slate-700/50 pt-3">
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
            <div className="mt-4 bg-[#3DA829]/8 dark:bg-[#3DA829]/10 rounded-2xl p-4 border border-[#3DA829]/20 text-center">
              <p className="text-[12px] text-slate-500 dark:text-slate-400">{t("coopMem.cantFind")}</p>
              <button onClick={() => setView("ticket")} className="mt-1.5 text-[12px] font-bold text-[#3DA829] active:opacity-70">{t("coopMem.raiseTicket")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



// ═══════════════════════════════════════════════════
//  BILLS TAB (member portal — no print services)
// ═══════════════════════════════════════════════════
function MemberBillsTab({ member, org, autoService = null, onAutoOpened = null }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    coopFn("get-member-bills", { member_id: member.id })
      .then(r => setBills(r.bills || []))
      .catch(() => setBills([]))
      .finally(() => setLoading(false));
  }, [member.id]);

  const addTransaction = useCallback(async (payload) => {
    try {
      const r = await coopFn("add-member-bill", { member_id: member.id, org_id: org.id, ...payload });
      if (r.bill) setBills(prev => [r.bill, ...prev]);
    } catch (e) { console.error("Failed to save member bill:", e); }
  }, [member.id, org.id]);

  const store = useMemo(() => ({
    transactions: bills,
    addTransaction,
    profile: { email: member.email, owner_name: member.full_name, business_name: org.name, id: member.id },
  }), [bills, addTransaction, member.email, member.full_name, org.name, member.id]);

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <BillPayments
      store={store}
      plan=""
      markup={1.098}
      pointsEnabled
      staffName={member.full_name}
      staffEmail={member.email}
      excludeCats={["print-airtime", "print-data"]}
      businessName={org.name}
      autoService={autoService}
      onAutoOpened={onAutoOpened}
    />
  );
}

// ═══════════════════════════════════════════════════
//  OFFICER TAB — role-gated operational surface
// ═══════════════════════════════════════════════════
const OFFICER_ROLES      = ["admin","president","chairman","vice_chairman","treasurer","secretary","officer","welfare_officer","auditor"];
const EXEC_ROLES         = ["admin","president","chairman","vice_chairman"];
const TREASURER_ROLES    = ["admin","president","chairman","vice_chairman","treasurer"];
const SECRETARY_ROLES    = ["admin","president","chairman","vice_chairman","secretary","officer"];
const AUDITOR_ONLY_ROLE  = "auditor";

function OfficerTab({ member, org }) {
  const role = member.role;
  const isExec      = EXEC_ROLES.includes(role);
  const isTreasurer = TREASURER_ROLES.includes(role);
  const isSecretary = SECRETARY_ROLES.includes(role);
  const isAuditor   = role === AUDITOR_ONLY_ROLE;

  const fmt     = n => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
  const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day:"numeric", month:"short", year:"numeric" }) : "—";

  // ── Shared state ──
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState("");

  // ── Loan approval (exec) ──
  const [loans,       setLoans]       = useState([]);
  const [loansLoaded, setLoansLoaded] = useState(false);

  // ── Withdrawal request approval (treasurer) ──
  const [wdReqs,       setWdReqs]       = useState([]);
  const [wdReqsLoaded, setWdReqsLoaded] = useState(false);

  // ── Save recording (treasurer) ──
  const [savForm, setSavForm] = useState({ member_id: "", amount: "", type: "deposit", notes: "" });
  const [members, setMembers] = useState([]);

  // ── Meeting creation (secretary) ──
  const [mtgForm,   setMtgForm]   = useState({ title: "", scheduled_at: "", format: "physical", location: "", description: "" });
  const [mtgBusy,   setMtgBusy]   = useState(false);

  // ── Announcement (secretary) ──
  const [annForm,   setAnnForm]   = useState({ message: "", type: "announcement" });
  const [annBusy,   setAnnBusy]   = useState(false);

  // ── Auditor financials ──
  const [auditData, setAuditData] = useState(null);

  const toast = msg => { setSuccess(msg); setTimeout(() => setSuccess(""), 4000); };

  // Load data based on role
  useEffect(() => {
    if (!org?.id) return;
    const load = async () => {
      setLoading(true); setError("");
      try {
        if ((isExec || isTreasurer) && !loansLoaded) {
          const res = await coopFn("get-loans", { org_id: org.id });
          setLoans(res.loans || []);
          setLoansLoaded(true);
        }
        if (isTreasurer && !wdReqsLoaded) {
          const res = await coopFn("get-withdrawal-requests-admin", { org_id: org.id });
          setWdReqs((res.requests || []).filter(r => r.status === "pending"));
          setWdReqsLoaded(true);
        }
        if (isTreasurer && members.length === 0) {
          const res = await coopFn("get-members", { org_id: org.id });
          setMembers(res.members || []);
        }
        if (isAuditor && !auditData) {
          const [sav, loans, wds, wallet] = await Promise.all([
            coopFn("get-savings",    { org_id: org.id }),
            coopFn("get-loans",      { org_id: org.id }),
            coopFn("get-withdrawals",{ org_id: org.id }),
            coopFn("get-wallet",     { org_id: org.id }),
          ]);
          setAuditData({ savings: sav.savings || [], loans: loans.loans || [], withdrawals: wds.withdrawals || [], wallet: wallet.transactions || [] });
        }
      } catch (e) { setError(e.message || "Load failed"); }
      finally { setLoading(false); }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  const handleLoanAction = async (loan, newStatus) => {
    setError(""); setSuccess("");
    try {
      await coopFn("update-loan", { loan_id: loan.id, org_id: org.id, status: newStatus,
        amount_approved: loan.amount_approved || loan.amount_requested });
      setLoans(prev => prev.map(l => l.id === loan.id ? { ...l, status: newStatus } : l));
      toast(`Loan ${newStatus}`);
    } catch (e) { setError(e.message || "Action failed"); }
  };

  const handleWdReq = async (req, decision) => {
    setError(""); setSuccess("");
    try {
      await coopFn("handle-withdrawal-request", { request_id: req.id, decision, org_id: org.id });
      setWdReqs(prev => prev.filter(r => r.id !== req.id));
      toast(`Withdrawal ${decision === "approve" ? "approved" : "rejected"}`);
    } catch (e) { setError(e.message || "Action failed"); }
  };

  const handleRecordSaving = async () => {
    if (!savForm.member_id || !savForm.amount) { setError("Member and amount are required"); return; }
    setLoading(true); setError("");
    try {
      await coopFn("record-saving", { org_id: org.id, member_id: savForm.member_id,
        amount: parseFloat(savForm.amount), type: savForm.type, notes: savForm.notes || undefined });
      setSavForm({ member_id: "", amount: "", type: "deposit", notes: "" });
      toast("Saving recorded");
    } catch (e) { setError(e.message || "Failed"); }
    finally { setLoading(false); }
  };

  const handleCreateMeeting = async () => {
    if (!mtgForm.title || !mtgForm.scheduled_at) { setError("Title and date are required"); return; }
    setMtgBusy(true); setError("");
    try {
      await coopFn("create-meeting", { org_id: org.id, ...mtgForm });
      setMtgForm({ title: "", scheduled_at: "", format: "physical", location: "", description: "" });
      toast("Meeting created");
    } catch (e) { setError(e.message || "Failed"); }
    finally { setMtgBusy(false); }
  };

  const handleSendAnn = async () => {
    if (!annForm.message.trim()) { setError("Message required"); return; }
    setAnnBusy(true); setError("");
    try {
      await coopFn("send-announcement", { org_id: org.id, message: annForm.message.trim(), type: annForm.type });
      setAnnForm({ message: "", type: "announcement" });
      toast("Announcement sent");
    } catch (e) { setError(e.message || "Failed"); }
    finally { setAnnBusy(false); }
  };

  const sectionClass = "mb-5 bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden";
  const hClass = "px-4 pt-4 pb-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest";
  const rowClass = "px-4 py-3 border-b border-slate-50 dark:border-slate-700/50 last:border-0";
  const inputClass = "w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#3DA829]/40";
  const btnGreen = "flex-1 bg-[#3DA829] active:bg-[#2d8020] text-white text-xs font-bold py-2 rounded-xl disabled:opacity-40 transition-colors";
  const btnRed = "flex-1 bg-red-500 active:bg-red-600 text-white text-xs font-bold py-2 rounded-xl disabled:opacity-40 transition-colors";

  const decidedLoans = (isAuditor ? (auditData?.loans || []) : loans)
    .filter(l => ["approved","rejected","disbursed"].includes(l.status))
    .sort((a, b) => {
      const ta = a.disbursed_at || a.approved_at || a.updated_at || "";
      const tb = b.disbursed_at || b.approved_at || b.updated_at || "";
      return tb.localeCompare(ta);
    });

  const DECISION_STATUS_COL = { approved: "text-green-600 dark:text-green-400", rejected: "text-red-500", disbursed: "text-blue-600 dark:text-blue-400" };

  return (
    <div className="px-4 pt-4 pb-8">
      {/* Role badge */}
      <div className="mb-4 flex items-center gap-2">
        <span className="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[11px] font-bold uppercase tracking-wider border border-blue-100 dark:border-blue-800/50 capitalize">
          {role}
        </span>
        <span className="text-[11px] text-slate-400">Officer access · {org.name}</span>
      </div>

      {error && (
        <div className="mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 text-xs rounded-xl px-4 py-3">{error}</div>
      )}
      {success && (
        <div className="mb-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-400 text-xs rounded-xl px-4 py-3">{success}</div>
      )}

      {loading && !loansLoaded && !wdReqsLoaded && !auditData && (
        <div className="flex justify-center py-12"><div className="w-8 h-8 rounded-full border-2 border-[#3DA829] border-t-transparent animate-spin" /></div>
      )}

      {/* ── EXEC: Loan Approvals ── */}
      {isExec && (
        <div className={sectionClass}>
          <p className={hClass}>Pending Loans</p>
          {loans.filter(l => l.status === "pending").length === 0 ? (
            <p className="px-4 pb-4 text-xs text-slate-400">No pending loan applications</p>
          ) : loans.filter(l => l.status === "pending").map(loan => (
            <div key={loan.id} className={rowClass}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{loan.org_members?.full_name || "Member"}</p>
                  <p className="text-[11px] text-slate-400">{loan.loan_purpose || "—"} · {fmtDate(loan.applied_at)}</p>
                </div>
                <p className="text-sm font-extrabold text-slate-800 dark:text-white">{fmt(loan.amount_requested)}</p>
              </div>
              <div className="flex gap-2">
                <button className={btnGreen} onClick={() => handleLoanAction(loan, "approved")}>Approve</button>
                <button className={btnRed}   onClick={() => handleLoanAction(loan, "rejected")}>Reject</button>
              </div>
            </div>
          ))}
          {loans.filter(l => l.status === "approved").length > 0 && (
            <>
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Approved — Awaiting Disbursal</p>
              {loans.filter(l => l.status === "approved").map(loan => (
                <div key={loan.id} className={rowClass}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{loan.org_members?.full_name || "Member"}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(loan.approved_at)}</p>
                    </div>
                    <p className="text-sm font-extrabold text-slate-800 dark:text-white">{fmt(loan.amount_approved || loan.amount_requested)}</p>
                  </div>
                  {loan.approved_by_display && (
                    <p className="text-[10px] text-slate-400 mb-2">Approved by: {loan.approved_by_display}</p>
                  )}
                  <button className={btnGreen} onClick={() => handleLoanAction(loan, "disbursed")}>Disburse</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── TREASURER: Withdrawal Request Approvals ── */}
      {isTreasurer && (
        <div className={sectionClass}>
          <p className={hClass}>Withdrawal Requests</p>
          {wdReqs.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-slate-400">No pending withdrawal requests</p>
          ) : wdReqs.map(req => (
            <div key={req.id} className={rowClass}>
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{req.org_members?.full_name || "Member"}</p>
                  <p className="text-[11px] text-slate-400">{req.reason || "No reason"} · {fmtDate(req.created_at)}</p>
                </div>
                <p className="text-sm font-extrabold text-slate-800 dark:text-white">{fmt(req.amount)}</p>
              </div>
              <div className="flex gap-2 mt-2">
                <button className={btnGreen} onClick={() => handleWdReq(req, "approve")}>Approve</button>
                <button className={btnRed}   onClick={() => handleWdReq(req, "reject")}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TREASURER: Record Saving ── */}
      {isTreasurer && (
        <div className={sectionClass}>
          <p className={hClass}>Record Saving</p>
          <div className="px-4 pb-4 space-y-3">
            <select className={inputClass} value={savForm.member_id} onChange={e => setSavForm(p => ({ ...p, member_id: e.target.value }))}>
              <option value="">Select member…</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.membership_id})</option>)}
            </select>
            <div className="flex gap-2">
              <input className={inputClass} type="number" placeholder="Amount (₦)" value={savForm.amount} onChange={e => setSavForm(p => ({ ...p, amount: e.target.value }))} />
              <select className={`${inputClass} flex-shrink-0 w-32`} value={savForm.type} onChange={e => setSavForm(p => ({ ...p, type: e.target.value }))}>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdraw</option>
              </select>
            </div>
            <input className={inputClass} placeholder="Notes (optional)" value={savForm.notes} onChange={e => setSavForm(p => ({ ...p, notes: e.target.value }))} />
            <button className={btnGreen} disabled={loading} onClick={handleRecordSaving}>
              {loading ? "Recording…" : "Record Saving"}
            </button>
          </div>
        </div>
      )}

      {/* ── DECISION LOG: decided loans — exec, treasurer, auditor ── */}
      {(isExec || isTreasurer || (isAuditor && auditData)) && decidedLoans.length > 0 && (
        <div className={sectionClass}>
          <p className={hClass}>Decision Log</p>
          {decidedLoans.map(loan => {
            const decidedAt = loan.disbursed_at || loan.approved_at || loan.updated_at;
            const actionLabel = loan.status === "disbursed" ? "Disbursed by" : loan.status === "approved" ? "Approved by" : "Declined by";
            return (
              <div key={loan.id} className={rowClass}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                      {loan.org_members?.full_name || "Member"}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{loan.loan_purpose || "—"}</p>
                    {loan.approved_by_display && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {actionLabel}: {loan.approved_by_display}{decidedAt ? ` · ${fmtDate(decidedAt)}` : ""}
                      </p>
                    )}
                    {loan.rejection_reason && (
                      <p className="text-[10px] italic text-red-400 mt-0.5">"{loan.rejection_reason}"</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-extrabold text-slate-800 dark:text-white">{fmt(loan.amount_approved || loan.amount_requested)}</p>
                    <span className={`text-[9px] font-bold uppercase tracking-wide capitalize ${DECISION_STATUS_COL[loan.status] || "text-slate-400"}`}>
                      {loan.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SECRETARY: Create Meeting ── */}
      {isSecretary && (
        <div className={sectionClass}>
          <p className={hClass}>Create Meeting</p>
          <div className="px-4 pb-4 space-y-3">
            <input className={inputClass} placeholder="Meeting title" value={mtgForm.title} onChange={e => setMtgForm(p => ({ ...p, title: e.target.value }))} />
            <input className={inputClass} type="datetime-local" value={mtgForm.scheduled_at} onChange={e => setMtgForm(p => ({ ...p, scheduled_at: e.target.value }))} />
            <select className={inputClass} value={mtgForm.format} onChange={e => setMtgForm(p => ({ ...p, format: e.target.value }))}>
              <option value="physical">In-person</option>
              <option value="virtual">Virtual</option>
              <option value="hybrid">Hybrid</option>
            </select>
            <input className={inputClass} placeholder="Location / link (optional)" value={mtgForm.location} onChange={e => setMtgForm(p => ({ ...p, location: e.target.value }))} />
            <input className={inputClass} placeholder="Description (optional)" value={mtgForm.description} onChange={e => setMtgForm(p => ({ ...p, description: e.target.value }))} />
            <button className={btnGreen} disabled={mtgBusy} onClick={handleCreateMeeting}>
              {mtgBusy ? "Creating…" : "Create Meeting"}
            </button>
          </div>
        </div>
      )}

      {/* ── SECRETARY: Send Announcement ── */}
      {isSecretary && (
        <div className={sectionClass}>
          <p className={hClass}>Send Announcement</p>
          <div className="px-4 pb-4 space-y-3">
            <select className={inputClass} value={annForm.type} onChange={e => setAnnForm(p => ({ ...p, type: e.target.value }))}>
              <option value="announcement">Announcement</option>
              <option value="notice">Notice</option>
              <option value="circular">Circular</option>
              <option value="emergency">Emergency</option>
            </select>
            <textarea className={`${inputClass} resize-none`} rows={3} placeholder="Message…" value={annForm.message} onChange={e => setAnnForm(p => ({ ...p, message: e.target.value }))} />
            <button className={btnGreen} disabled={annBusy} onClick={handleSendAnn}>
              {annBusy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}

      {/* ── AUDITOR: Read-only Financial View ── */}
      {isAuditor && auditData && (
        <>
          <div className={sectionClass}>
            <p className={hClass}>Savings Ledger</p>
            {auditData.savings.slice(0, 20).map(s => (
              <div key={s.id} className={`${rowClass} flex items-center justify-between`}>
                <div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-white capitalize">{s.type} · {s.payment_method?.replace(/_/g," ")}</p>
                  <p className="text-[10px] text-slate-400">{fmtDate(s.created_at)}</p>
                </div>
                <p className={`text-sm font-bold ${s.type === "deposit" ? "text-green-600" : "text-red-500"}`}>
                  {s.type === "deposit" ? "+" : "-"}{fmt(s.amount)}
                </p>
              </div>
            ))}
            {auditData.savings.length === 0 && <p className="px-4 pb-4 text-xs text-slate-400">No savings records</p>}
          </div>

          <div className={sectionClass}>
            <p className={hClass}>Loans</p>
            {auditData.loans.slice(0, 20).map(l => (
              <div key={l.id} className={`${rowClass} flex items-center justify-between`}>
                <div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-white capitalize">{l.status}</p>
                  <p className="text-[10px] text-slate-400">{fmtDate(l.applied_at)}</p>
                  {l.approved_by_display && <p className="text-[10px] text-slate-400">By: {l.approved_by_display}</p>}
                </div>
                <p className="text-sm font-bold text-slate-800 dark:text-white">{fmt(l.amount_requested)}</p>
              </div>
            ))}
            {auditData.loans.length === 0 && <p className="px-4 pb-4 text-xs text-slate-400">No loans</p>}
          </div>

          <div className={sectionClass}>
            <p className={hClass}>Org Withdrawals</p>
            {auditData.withdrawals.slice(0, 20).map(w => (
              <div key={w.id} className={`${rowClass} flex items-center justify-between`}>
                <div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-white">{w.purpose}</p>
                  <p className="text-[10px] text-slate-400">{fmtDate(w.created_at)}</p>
                  {w.authorized_by_display && <p className="text-[10px] text-slate-400">Auth: {w.authorized_by_display}</p>}
                </div>
                <p className="text-sm font-bold text-red-500">-{fmt(w.total_amount)}</p>
              </div>
            ))}
            {auditData.withdrawals.length === 0 && <p className="px-4 pb-4 text-xs text-slate-400">No withdrawals</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MAIN PORTAL
// ═══════════════════════════════════════════════════
function makeMainTabsMember(t) {
  return [
    { id: "home",          label: t("coop.overview"), icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { id: "contributions", label: t("coop.savings"),  icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "loans",         label: t("coop.loans"),    icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
    { id: "messages",      label: t("coop.chat"),     icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  ];
}

function makeMoreTabsMember(t) {
  return [
    { id: "bills",     label: t("coop.bills"),     color:"#3DA829", icon:"M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
    { id: "broadcast", label: t("coop.broadcast"), color:"#16255A", icon:"M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
    { id: "support",   label: t("coop.support"),   color:"#3DA829", icon:"M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" },
  ];
}

// ─── Member Profile Sheet ─────────────────────────────────────────────────────
function ProfileSheet({ member, onClose, onSave }) {
  const t = useT();
  const [form,       setForm]       = useState({
    full_name:          member.full_name          || "",
    phone:              member.phone              || "",
    address:            member.address            || "",
    occupation:         member.occupation         || "",
    next_of_kin:        member.next_of_kin        || "",
    next_of_kin_phone:  member.next_of_kin_phone  || "",
    gender:             member.gender             || "",
    date_of_birth:      member.date_of_birth      || "",
  });
  const [preview,    setPreview]    = useState(member.avatar_url || null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");
  const fileRef                      = useRef(null);

  const onPickFile = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setAvatarFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const save = async () => {
    if (!form.full_name.trim()) { setError(t("error.somethingWrong")); return; }
    setSaving(true); setError("");
    try {
      let avatar_url = member.avatar_url || null;
      if (avatarFile) {
        const ext  = avatarFile.name.split(".").pop() || "jpg";
        const path = `members/${member.id}/${Date.now()}.${ext}`;
        const { data, error: upErr } = await supabase.storage.from("avatars").upload(path, avatarFile, { upsert: true });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(data.path);
        avatar_url = `${publicUrl}?v=${Date.now()}`;
      }
      const { error: dbErr } = await supabase.rpc("update_my_member_profile", {
        p_full_name:     form.full_name.trim(),
        p_phone:         form.phone.trim() || null,
        p_avatar_url:    avatar_url,
        p_address:       form.address.trim() || null,
        p_occupation:    form.occupation.trim() || null,
        p_next_of_kin:   form.next_of_kin.trim() || null,
        p_nok_phone:     form.next_of_kin_phone.trim() || null,
        p_gender:        form.gender || null,
        p_date_of_birth: form.date_of_birth || null,
      });
      if (dbErr) throw dbErr;
      onSave({
        full_name:         form.full_name.trim(),
        phone:             form.phone.trim() || null,
        avatar_url,
        address:           form.address.trim() || null,
        occupation:        form.occupation.trim() || null,
        next_of_kin:       form.next_of_kin.trim() || null,
        next_of_kin_phone: form.next_of_kin_phone.trim() || null,
        gender:            form.gender || null,
        date_of_birth:     form.date_of_birth || null,
      });
      onClose();
    } catch (e) { setError(e.message || t("error.saveFailed")); }
    setSaving(false);
  };

  const inp = "w-full bg-slate-100 rounded-xl px-4 py-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-green-400";
  const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day:"numeric", month:"short", year:"numeric" }) : "—";

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl flex flex-col overflow-hidden"
        style={{ maxHeight: "92dvh" }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-base font-extrabold text-slate-800">{t("coopMem.myProfile")}</h3>
          <button onClick={onClose} className="text-slate-400 p-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4 min-h-0">
          {/* Avatar picker */}
          <div className="flex flex-col items-center gap-2 pb-4 border-b border-slate-100">
            <button onClick={() => fileRef.current?.click()} className="relative group active:scale-95 transition-transform">
              {preview
                ? <img src={preview} alt="" className="w-24 h-24 rounded-full object-cover ring-4 ring-green-100 shadow-xl" />
                : <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-black text-white shadow-xl ring-4 ring-green-100 bg-[linear-gradient(145deg,#3DA829,#0D2040)]">
                    {member.full_name?.charAt(0).toUpperCase()}
                  </div>
              }
              <div className="absolute bottom-0 right-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center border-2 border-white shadow-md">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} className="w-4 h-4"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </div>
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
            <p className="text-[11px] text-slate-400">{t("coopMem.tapPhoto")}</p>
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("profile.fullName")}</label>
            <input className={inp} value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("profile.phone")}</label>
            <input className={inp} type="tel" placeholder="08000000000" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("profile.address")}</label>
            <input className={inp} value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="12 Market Road, Lagos" />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("mem.occupation")}</label>
            <input className={inp} value={form.occupation} onChange={e => setForm(p => ({ ...p, occupation: e.target.value }))} placeholder="e.g. Trader, Teacher" />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("mem.gender")}</label>
            <select className={inp} value={form.gender} onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}>
              <option value="">{t("mem.genderSelect")}</option>
              <option value="Male">{t("mem.genderMale")}</option>
              <option value="Female">{t("mem.genderFemale")}</option>
              <option value="Other">{t("mem.genderOther")}</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("coopMem.dob")}</label>
            <input className={inp} type="date" value={form.date_of_birth}
              onChange={e => setForm(p => ({ ...p, date_of_birth: e.target.value }))}
              max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().slice(0, 10)} />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("profile.nokName")}</label>
            <input className={inp} value={form.next_of_kin} onChange={e => setForm(p => ({ ...p, next_of_kin: e.target.value }))} placeholder="Next of kin full name" />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{t("profile.nokPhone")}</label>
            <input className={inp} type="tel" value={form.next_of_kin_phone} onChange={e => setForm(p => ({ ...p, next_of_kin_phone: e.target.value }))} placeholder="08000000000" />
          </div>

          {[
            [t("coopMem.memberID"),    member.membership_id],
            [t("coopMem.memberRole"),  member.role],
            [t("coopMem.status"),      member.status],
            [t("coopMem.memberSince"), fmtDate(member.joined_date)],
          ].map(([label, val]) => (
            <div key={label}>
              <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{label}</label>
              <p className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm text-slate-500 capitalize">{val || "—"}</p>
            </div>
          ))}
        </div>

        <div className="px-5 border-t border-slate-100 flex gap-2 flex-shrink-0" style={{ paddingTop: 16, paddingBottom: "max(16px, env(safe-area-inset-bottom, 16px))" }}>
          <button onClick={onClose} className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm active:bg-slate-50">{t("common.cancel")}</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 active:bg-green-700">
            {saving ? t("mem.saving") : t("mem.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CoopMemberPortal({ member: initialMember }) {
  const t = useT();
  const toast = useToast();
  const MAIN_TABS = useMemo(() => makeMainTabsMember(t), [t]);
  const MORE_TABS = useMemo(() => makeMoreTabsMember(t), [t]);

  const { isDark, toggle: toggleDark } = useTheme();
  const { lang, changeLang } = useLanguage();
  const [showLang,      setShowLang]      = useState(false);
  const [member,        setMember]        = useState(initialMember);
  const [coopReloadKey, setCoopReloadKey] = useState(0);

  // Offline-first state
  const { online: portalOnline, reconnectTick } = useOnlineStatus();
  const [portalFromCache, setPortalFromCache] = useState(false);
  const [syncing,         setSyncing]         = useState(false);
  const [syncResult,      setSyncResult]      = useState(null);
  const [lastSyncTime,    setLastSyncTime]    = useState(() => {
    const cached = getCache(initialMember?.id || "", "coop_portal");
    return cached?.ts || null;
  });
  const [tab,           setTab]           = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "bills";
    // Only open Bills for RECENT pending keys (< 30 min); stale keys must not redirect.
    const hasRecentBill = Object.keys(localStorage).some(k => {
      if (!k.startsWith("ck_bill_pending_")) return false;
      const ts = parseInt((k.match(/(\d{13})$/) || [])[1] || "0", 10);
      return ts && Date.now() - ts < 30 * 60 * 1000;
    });
    if (hasRecentBill) return "bills";
    return "home";
  });
  const [announcements, setAnnouncements] = useState([]);
  const [loans,         setLoans]         = useState([]);
  const [wdRequests,    setWdRequests]    = useState([]);
  const [polls,         setPolls]         = useState([]);
  const [events,        setEvents]        = useState([]);
  const [showMore,             setShowMore]             = useState(false);
  const [showProfile,          setShowProfile]          = useState(false);
  const [pendingOfficerCount,  setPendingOfficerCount]  = useState(0);
  const [billsAutoSvc,  setBillsAutoSvc]  = useState(null);
  const [processingPayment, setProcessingPayment] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("trxref") || params.get("reference");
    if (!ref) return false;
    const contrib = localStorage.getItem(ORG_PAY_PREFIX + ref);
    if (contrib) { try { return JSON.parse(contrib).member_id === initialMember?.id; } catch { return false; } }
    const loan = localStorage.getItem(ORG_LOAN_PAY_PREFIX + ref);
    if (loan)    { try { return JSON.parse(loan).member_id    === initialMember?.id; } catch { return false; } }
    return false;
  });
  const [paymentResult, setPaymentResult] = useState(null);

  useEffect(() => { setMember(initialMember); }, [initialMember]);

  const org = member?.org || member?.organizations || {};

  const { slotMap: camSlots, loading: camLoading, recordEvent: recordCamEvent } = useCampaigns(["announcement_bar","tab_card_quad","tab_card_duo"], "org_member", "org_member.home");
  const coopTabCard = (camSlots.tab_card_quad || [])[0] ?? (camSlots.tab_card_duo || [])[0] ?? null;
  const annBars = camSlots.announcement_bar || [];
  const { offers: partnerOffers, loading: offersLoading, recordEvent: recordOfferEvent, ctaUrl } = usePartnerOffers("org_member");

  // Detect Paystack return for savings payment OR loan repayment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("trxref") || params.get("reference");
    if (!ref) return;

    // Contribution payment return
    const contribKey = ORG_PAY_PREFIX + ref;
    const contribStored = localStorage.getItem(contribKey);
    if (contribStored) {
      let pending;
      try { pending = JSON.parse(contribStored); } catch { return; }
      if (pending.member_id !== initialMember?.id) return;
      window.history.replaceState({}, "", window.location.pathname);
      localStorage.removeItem(contribKey);
      setProcessingPayment(true);
      coopFn("confirm-member-payment", {
        member_id: pending.member_id, org_id: pending.org_id,
        reference: ref, program_id: pending.program_id || undefined,
      }).then(res => {
        if (res.member) setMember(prev => ({ ...prev, ...res.member }));
        setTab("contributions");
        setProcessingPayment(false);
        setPaymentResult({ ok: true, amount: res.amount || pending.amount, ref, type: "contribution" });
      }).catch(e => {
        setProcessingPayment(false);
        setPaymentResult({ ok: false, error: e.message || "Payment verification failed", ref });
      });
      return;
    }

    // Loan repayment return
    const loanKey = ORG_LOAN_PAY_PREFIX + ref;
    const loanStored = localStorage.getItem(loanKey);
    if (loanStored) {
      let pending;
      try { pending = JSON.parse(loanStored); } catch { return; }
      if (pending.member_id !== initialMember?.id) return;
      window.history.replaceState({}, "", window.location.pathname);
      localStorage.removeItem(loanKey);
      setProcessingPayment(true);
      coopFn("confirm-loan-payment", {
        member_id: pending.member_id, org_id: pending.org_id,
        loan_id: pending.loan_id, reference: ref,
      }).then(res => {
        setTab("loans");
        setProcessingPayment(false);
        setPaymentResult({ ok: true, amount: res.amount || pending.amount, ref, type: "loan" });
      }).catch(e => {
        setProcessingPayment(false);
        setPaymentResult({ ok: false, error: e.message || "Payment verification failed", ref });
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Native Android: handle paymentCallback deep-link event dispatched by useAuth after Browser.open redirect
  useEffect(() => {
    const handler = (e) => {
      const url = e.detail?.url || "";
      const params = new URLSearchParams(url.split("?")[1] || "");
      const ref = params.get("trxref") || params.get("reference");
      if (!ref) return;

      const contribKey = ORG_PAY_PREFIX + ref;
      const contribStored = localStorage.getItem(contribKey);
      if (contribStored) {
        let pending;
        try { pending = JSON.parse(contribStored); } catch { return; }
        localStorage.removeItem(contribKey);
        setProcessingPayment(true);
        coopFn("confirm-member-payment", {
          member_id: pending.member_id, org_id: pending.org_id,
          reference: ref, program_id: pending.program_id || undefined,
        }).then(res => {
          if (res.member) setMember(prev => ({ ...prev, ...res.member }));
          setTab("contributions");
          setProcessingPayment(false);
          setPaymentResult({ ok: true, amount: res.amount || pending.amount, ref, type: "contribution" });
        }).catch(err => {
          setProcessingPayment(false);
          setPaymentResult({ ok: false, error: err.message || "Payment verification failed", ref });
        });
        return;
      }

      const loanKey = ORG_LOAN_PAY_PREFIX + ref;
      const loanStored = localStorage.getItem(loanKey);
      if (loanStored) {
        let pending;
        try { pending = JSON.parse(loanStored); } catch { return; }
        localStorage.removeItem(loanKey);
        setProcessingPayment(true);
        coopFn("confirm-loan-payment", {
          member_id: pending.member_id, org_id: pending.org_id,
          loan_id: pending.loan_id, reference: ref,
        }).then(res => {
          setTab("loans");
          setProcessingPayment(false);
          setPaymentResult({ ok: true, amount: res.amount || pending.amount, ref, type: "loan" });
        }).catch(err => {
          setProcessingPayment(false);
          setPaymentResult({ ok: false, error: err.message || "Payment verification failed", ref });
        });
      }
    };
    window.addEventListener("paymentCallback", handler);
    return () => window.removeEventListener("paymentCallback", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load announcements + summary counts for dashboard
  useEffect(() => {
    if (!member?.id || !org?.id) return;

    // Offline: serve from cache, skip network
    if (!navigator.onLine) {
      const cached = getCache(member.id, "coop_portal");
      if (cached?.data) {
        const d = cached.data;
        if (d.announcements) setAnnouncements(d.announcements);
        if (d.loans)         setLoans(d.loans);
        if (d.wdRequests)    setWdRequests(d.wdRequests);
        if (d.polls)         setPolls(d.polls);
        if (d.events)        setEvents(d.events);
        setPortalFromCache(true);
        setLastSyncTime(cached.ts);
      }
      return;
    }

    const safe = p => p.catch(() => ({}));
    Promise.all([
      coopFn("member-get-announcements",       { member_id: member.id, org_id: org.id }),
      safe(coopFn("member-get-loans",              { member_id: member.id, org_id: org.id })),
      safe(coopFn("get-member-withdrawal-requests", { member_id: member.id })),
      safe(coopFn("get-polls",  { org_id: org.id })),
      safe(coopFn("get-events", { org_id: org.id })),
    ]).then(([annR, loanR, wdR, pollR, evtR]) => {
      setAnnouncements(annR.announcements || []);
      setLoans(loanR.loans || []);
      setWdRequests(wdR.requests || []);
      setPolls(pollR.polls || []);
      setEvents(evtR.events || []);
      // Persist to cache for offline reads
      setCache(member.id, "coop_portal", {
        announcements: annR.announcements || [],
        loans:         loanR.loans       || [],
        wdRequests:    wdR.requests      || [],
        polls:         pollR.polls       || [],
        events:        evtR.events       || [],
      });
      setPortalFromCache(false);
      setLastSyncTime(Date.now());
    }).catch(console.error);
  }, [member?.id, org?.id, coopReloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Officer pending badge — pending loan approvals + pending withdrawal requests
  useEffect(() => {
    const role = member?.role;
    if (!member?.id || !org?.id || !OFFICER_ROLES.includes(role)) return;
    const canApproveLoan = EXEC_ROLES.includes(role);
    const canApproveWd   = TREASURER_ROLES.includes(role);
    const safe = p => p.catch(() => ({}));
    Promise.all([
      canApproveLoan ? safe(coopFn("get-loans",                    { org_id: org.id })) : Promise.resolve({}),
      canApproveWd   ? safe(coopFn("get-withdrawal-requests-admin", { org_id: org.id })) : Promise.resolve({}),
    ]).then(([loanRes, wdRes]) => {
      const n = (loanRes.loans   || []).filter(l => l.status === "pending").length
              + (wdRes.requests  || []).filter(r => r.status === "pending").length;
      setPendingOfficerCount(n);
    }).catch(() => {});
  }, [member?.id, org?.id, member?.role, coopReloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume-on-foreground — 10 s debounce catches missed changes after backgrounding.
  const lastCoopResumeRef = useRef(0);
  useEffect(() => {
    if (!member?.id) return;
    const onResume = () => {
      if (Date.now() - lastCoopResumeRef.current < 10_000) return;
      lastCoopResumeRef.current = Date.now();
      setCoopReloadKey(k => k + 1);
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
  }, [member?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 60-second fallback poll — CoopMemberPortal has no realtime channel (all data from edge fns).
  // Replaces the former 3 s poll (was 900 edge-fn calls/hour per member).
  useEffect(() => {
    if (!member?.id) return;
    const id = setInterval(() => setCoopReloadKey(k => k + 1), 60_000);
    return () => clearInterval(id);
  }, [member?.id]);

  // Auto-sync on reconnect
  useEffect(() => {
    if (reconnectTick === 0) return;
    setSyncing(true);
    setSyncResult(null);
    setCoopReloadKey(k => k + 1);
    setTimeout(() => {
      setSyncing(false);
      setSyncResult("Up to date");
      setTimeout(() => setSyncResult(null), 4000);
    }, 1500);
  }, [reconnectTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = useCallback((tabId) => {
    setTab(tabId);
    setShowMore(false);
  }, []);

  usePushNotifications(member?.user_id ?? null, (dl) => {
    if (!dl?.tab) return;
    const COOP_MEMBER_TABS = ["home","contributions","loans","messages","bills","broadcast","support","officer"];
    navigateTo(COOP_MEMBER_TABS.includes(dl.tab) ? dl.tab : "home");
  });

  const openQuickService = useCallback((serviceId) => {
    setBillsAutoSvc(serviceId);
    setTab("bills");
    setShowMore(false);
  }, []);

  const handleMemberUpdate = (updatedMember) => {
    setMember(prev => ({ ...prev, ...updatedMember }));
  };

  const isOfficerMember = OFFICER_ROLES.includes(member?.role);

  // Inject officer tab into MORE for qualifying roles — must stay before early return
  const effectiveMoreTabs = useMemo(() => {
    if (!isOfficerMember) return MORE_TABS;
    return [
      ...MORE_TABS,
      { id: "officer", label: "Officer", color: "#1e40af",
        icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [MORE_TABS, isOfficerMember]);

  if (!member) return null;

  const tabContent = {
    home:          <HomeTab member={member} org={org} announcements={announcements} polls={polls} events={events} loans={loans} wdRequests={wdRequests} onQuickService={openQuickService} onNavigate={navigateTo} userEmail={member.email} />,
    contributions: <ContributionsTab member={member} org={org} onMemberUpdate={handleMemberUpdate} />,
    loans:         <LoansTab member={member} org={org} />,
    bills:         <MemberBillsTab member={member} org={org} autoService={billsAutoSvc} onAutoOpened={() => setBillsAutoSvc(null)} />,
    broadcast:     <MemberBroadcastTab member={member} org={org} />,
    support:       <SupportTab member={member} org={org} />,
    messages:      <GroupChat orgId={org.id} myName={member.full_name} myRole="member" orgName={org.name} org={org} onBack={() => navigateTo("home")} />,
    officer:       isOfficerMember ? <OfficerTab member={member} org={org} /> : null,
  };

  const isMoreTab = effectiveMoreTabs.some(t => t.id === tab);
  const emergencyCount = announcements.filter(a => a.type === "emergency").length;

  return (
    <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative">

        {/* ── Header — matches org portal h-14 ── */}
        <header className="flex-none z-30 min-h-[56px] flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm" style={{ paddingTop: "max(12px, env(safe-area-inset-top, 12px))" }}>
          <AppLogo />
          <div className="flex items-center gap-2 flex-shrink-0">
              <NotificationCenter
                userId={member?.user_id ?? null}
                onNavigate={(dl) => {
                  if (!dl?.tab) return;
                  const COOP_MEMBER_TABS = ["home","contributions","loans","messages","bills","broadcast","support","officer"];
                  navigateTo(COOP_MEMBER_TABS.includes(dl.tab) ? dl.tab : "home");
                }}
                toast={toast}
              />
            <button onClick={() => setShowProfile(true)} className="active:scale-90 transition-transform">
              {member.avatar_url
                ? <img src={member.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border-2 border-slate-100 dark:border-slate-700 shadow-sm" />
                : <div className="w-9 h-9 rounded-full flex items-center justify-center text-base font-extrabold text-white border-2 border-slate-100 dark:border-slate-700 shadow-sm bg-[linear-gradient(145deg,#3DA829,#0D2040)]">
                    {member.full_name?.charAt(0).toUpperCase()}
                  </div>
              }
            </button>
          </div>
        </header>

        <SyncBar
          isOnline={portalOnline}
          fromCache={portalFromCache}
          lastSyncTime={lastSyncTime}
          syncing={syncing}
          syncResult={syncResult}
        />

        {/* ── Main Content ── */}
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <AnnouncementBarSlot campaigns={annBars} loading={camLoading} recordEvent={recordCamEvent} />
          {tabContent[tab]}
          {tab === "home" && (
            <>
              {coopTabCard && coopTabCard.slot === "tab_card_quad" && (
                <TabCardQuadSlot campaign={coopTabCard} pageKey="org_member.home" recordEvent={recordCamEvent} />
              )}
              {coopTabCard && coopTabCard.slot === "tab_card_duo" && (
                <TabCardDuoSlot campaign={coopTabCard} pageKey="org_member.home" recordEvent={recordCamEvent} />
              )}
              <OffersSection
                offers={partnerOffers}
                loading={offersLoading}
                recordEvent={recordOfferEvent}
                ctaUrl={ctaUrl}
                title="Offers for Members"
                maxShown={1}
              />
            </>
          )}
        </main>

        {/* Powered by card — always visible above bottom nav */}
        <PoweredByCardSlot portalType="org_member" businessId={org?.id} />

        {/* ── Bottom Navigation — matches org portal ── */}
        <nav className="flex-none z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float">
          <div className="flex items-stretch h-[60px]">
            {MAIN_TABS.map(t => {
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => { setTab(t.id); setShowMore(false); }}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative focus-visible:outline-none">
                  {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-[#3DA829] dark:bg-green-400" />}
                  <div className={`relative transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                    <svg viewBox="0 0 24 24" fill="none" className="w-[21px] h-[21px]"
                      stroke={active ? "#3DA829" : "#94a3b8"} strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                      <path d={t.icon} />
                    </svg>
                  </div>
                  <span className={`text-[8px] font-bold uppercase tracking-wide leading-none ${active ? "text-[#3DA829] dark:text-green-400" : "text-slate-400 dark:text-slate-500"}`}>
                    {t.label}
                  </span>
                </button>
              );
            })}
            {/* Hamburger / Menu */}
            <button onClick={() => setShowMore(p => !p)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 relative focus-visible:outline-none">
              {isMoreTab && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-[#3DA829] dark:bg-green-400" />}
              <div className={`relative transition-all duration-200 ${showMore ? "scale-110" : "scale-100"}`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-[21px] h-[21px]"
                  stroke={isMoreTab || showMore ? "#3DA829" : "#94a3b8"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                {(emergencyCount > 0 || pendingOfficerCount > 0) && !showMore && (
                  pendingOfficerCount > 0
                    ? <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] flex items-center justify-center rounded-full bg-amber-500 text-[8px] font-black text-white">{pendingOfficerCount}</span>
                    : <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </div>
              <span className={`text-[8px] font-bold uppercase tracking-wide leading-none ${isMoreTab || showMore ? "text-[#3DA829] dark:text-green-400" : "text-slate-400 dark:text-slate-500"}`}>
                Menu
              </span>
            </button>
          </div>
          <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} className="bg-white dark:bg-slate-900" />
        </nav>

        {/* ── Side Drawer — matches org portal ── */}
        {showMore && (
          <div className="fixed inset-0 z-[60] flex" onClick={() => setShowMore(false)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
            <div
              className="relative flex flex-col h-full bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
              style={{ width: "75%", maxWidth: 280 }}
              onClick={e => e.stopPropagation()}
            >
              {/* Member profile header */}
              <div className="px-5 pt-12 pb-5 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
                <button onClick={() => { setShowProfile(true); setShowMore(false); }} className="mb-3 active:opacity-75 transition-opacity">
                  {member.avatar_url
                    ? <img src={member.avatar_url} alt="" className="w-12 h-12 rounded-2xl object-cover ring-2 ring-green-200" />
                    : <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl font-black text-white bg-[linear-gradient(145deg,#3DA829,#0D2040)]">
                        {member.full_name?.charAt(0).toUpperCase()}
                      </div>
                  }
                </button>
                <p className="font-extrabold text-slate-800 dark:text-white text-sm leading-tight">{member.full_name}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{member.membership_id}</p>
                <p className="text-[10px] text-slate-400 capitalize">{member.role} · {org.name}</p>
              </div>

              {/* Navigation list */}
              <div className="flex-1 overflow-y-auto py-2">
                {MAIN_TABS.map(t => {
                  const active = tab === t.id;
                  return (
                    <button key={t.id} onClick={() => navigateTo(t.id)}
                      className={`w-full flex items-center gap-4 px-5 py-3.5 transition-colors ${active ? "text-[#3DA829]" : "text-slate-700 dark:text-slate-200"}`}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 flex-shrink-0"
                        stroke={active ? "#3DA829" : "currentColor"} strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                        <path d={t.icon} />
                      </svg>
                      <span className={`text-sm ${active ? "font-extrabold" : "font-semibold"}`}>{t.label}</span>
                      {active && <div className="ml-auto w-1 h-5 bg-[#3DA829] rounded-full" />}
                    </button>
                  );
                })}
                <div className="mx-5 my-2 border-t border-slate-100 dark:border-slate-800" />
                {effectiveMoreTabs.map(t => {
                  const active = tab === t.id;
                  return (
                    <button key={t.id} onClick={() => navigateTo(t.id)}
                      className={`w-full flex items-center gap-4 px-5 py-3.5 transition-colors ${active ? "text-[#3DA829]" : "text-slate-700 dark:text-slate-200"}`}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: (t.color || "#64748b") + "18" }}>
                        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ stroke: active ? "#3DA829" : (t.color || "#64748b") }}>
                          {t.icon.split("|").map((p, i) => <path key={i} d={p} />)}
                        </svg>
                      </div>
                      <span className={`text-sm ${active ? "font-extrabold" : "font-semibold"}`}>{t.label}</span>
                      {active && <div className="ml-auto w-1 h-5 bg-[#3DA829] rounded-full" />}
                      {t.id === "broadcast" && emergencyCount > 0 && !active && (
                        <span className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
                      )}
                    </button>
                  );
                })}
                <div className="mx-5 my-2 border-t border-slate-100 dark:border-slate-800" />
                {/* Edit Profile */}
                <button onClick={() => { setShowProfile(true); setShowMore(false); }}
                  className="w-full flex items-center gap-4 px-5 py-3.5 text-slate-700 dark:text-slate-200 transition-colors">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-50 dark:bg-slate-800">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="#64748b">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <span className="text-sm font-semibold">{t("common.editProfile")}</span>
                </button>
                {/* Dark mode toggle */}
                <button onClick={toggleDark}
                  className="w-full flex items-center gap-4 px-5 py-3.5 text-slate-700 dark:text-slate-200 transition-colors">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-50 dark:bg-slate-800">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="#64748b">
                      {isDark
                        ? <><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></>
                        : <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                      }
                    </svg>
                  </div>
                  <span className="text-sm font-semibold">{t("common.darkMode")}</span>
                </button>
                {/* Language picker */}
                <button onClick={() => setShowLang(true)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 text-slate-700 dark:text-slate-200 transition-colors">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-50 dark:bg-slate-800">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" stroke="#64748b">
                      <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                    </svg>
                  </div>
                  <span className="text-sm font-semibold flex-1 text-left">Language</span>
                  <span className="text-xs text-slate-400">{LANGUAGES.find(l => l.code === lang)?.native || "English"}</span>
                </button>
              </div>

              {/* Sign out */}
              <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
                <button onClick={() => performLogout()}
                  className="flex items-center gap-3 text-slate-500 dark:text-slate-400 text-sm font-semibold active:opacity-70 transition-opacity">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  {t("common.logOut")}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Member profile sheet ── */}
      {showProfile && (
        <ProfileSheet
          member={member}
          onClose={() => setShowProfile(false)}
          onSave={updates => setMember(prev => ({ ...prev, ...updates }))}
        />
      )}

      {/* Payment processing overlay */}
      {processingPayment && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center px-6">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 text-center max-w-xs w-full">
            <div className="w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
            <p className="text-base font-extrabold text-slate-800 dark:text-white">{t("coopMem.verifyingPayment")}</p>
            <p className="text-xs text-slate-400 mt-2">{t("coopMem.pleaseWaitConfirm")}</p>
          </div>
        </div>
      )}

      {member && (
        <AIChatWidget
          portalContext={buildCoopMemberContext(member, loans, org)}
          greeting={`${t("greet.morning").split(" ")[0]}${member.full_name ? ` ${member.full_name.split(" ")[0]}` : ""}! I'm **KudiAI**, your cooperative assistant.\n\nI know your savings, loans, and membership details — ask me anything!`}
          quickChips={[
            { label: t("aiChip.mySavings")       || "My Savings",       q: "What is my current savings balance?" },
            { label: t("aiChip.loanStatus")       || "Loan Status",      q: "What are my active loans and remaining balances?" },
            { label: t("aiChip.loanEligibility")  || "Loan Eligibility", q: "Am I eligible for a new loan?" },
            { label: t("aiChip.paymentPlan")      || "Payment Plan",     q: "Show my loan payment schedule" },
            { label: t("aiChip.coopBenefits")     || "Coop Benefits",    q: "What benefits do I get as a cooperative member?" },
          ]}
          inputPlaceholder={t("aiChip.memberPlaceholder") || "Ask about your coop account…"}
        />
      )}

      {/* Payment result overlay */}
      {paymentResult && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center px-6">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 text-center max-w-xs w-full">
            {paymentResult.ok ? (
              <>
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <p className="text-xl font-extrabold text-slate-800 dark:text-white mb-1">{t("coopMem.paymentConfirmed")}</p>
                <AmountDisplay amount={paymentResult.amount} size="hero" align="center" className="text-[#3DA829] mt-3 mb-1" />
                <p className="text-xs text-slate-400 mb-8">{t("coopMem.addedToBalance")}</p>
                <button onClick={() => setPaymentResult(null)}
                  className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl text-sm">
                  {t("coopMem.viewSavings")}
                </button>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-red-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-xl font-extrabold text-slate-800 dark:text-white mb-1">{t("coopMem.paymentFailed")}</p>
                <p className="text-xs text-slate-400 mt-2 mb-8">{paymentResult.error}</p>
                <button onClick={() => setPaymentResult(null)}
                  className="w-full py-4 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white font-bold rounded-2xl text-sm">
                  {t("coopMem.dismiss")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {showLang && (
        <Modal title="Language" onClose={() => setShowLang(false)}>
          <div className="space-y-2 px-4 pb-4">
            {LANGUAGES.map(l => (
              <button key={l.code} onClick={() => { changeLang(l.code); markLangChosen(); setShowLang(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${lang === l.code ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20" : "border-slate-100 dark:border-slate-700"}`}>
                <span className="text-2xl">{l.flag}</span>
                <div className="flex-1 text-left">
                  <p className="font-bold text-sm text-slate-800 dark:text-slate-100">{l.native}</p>
                  {l.native !== l.name && <p className="text-xs text-slate-400">{l.name}</p>}
                </div>
                {lang === l.code && (
                  <svg className="w-5 h-5 text-brand-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Org Member Archived Screen ───────────────────────────────────────────────
const MEMBER_STATUS_COPY = {
  pending:        { label: "Request Submitted",  color: "text-amber-400",  desc: "Waiting for your organisation to review and approve." },
  owner_approved: { label: "Org Approved",       color: "text-blue-400",   desc: "Your organisation approved the request. Waiting for platform admin to finalise." },
  owner_rejected: { label: "Request Rejected",   color: "text-red-400",    desc: "Your organisation declined the request. You may submit a new request below." },
  admin_approved: { label: "Account Restored",   color: "text-green-400",  desc: "Your access has been fully restored. Please sign out and sign back in." },
  admin_rejected: { label: "Request Rejected",   color: "text-red-400",    desc: "The platform declined this request. Contact your organisation for more information." },
};

export function OrgMemberArchivedScreen({ member }) {
  const t = useT();
  const [existing, setExisting] = useState(undefined);
  const [reason,   setReason]   = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);

  const orgId = member?.org_id || member?.org?.id;

  useEffect(() => {
    if (!orgId) return;
    supabase.functions.invoke("coop-portal", {
      body: { action: "get-member-reactivation-requests", org_id: orgId },
    }).then(({ data }) => {
      const myReq = (data?.requests || []).find(
        r => r.member_id === member?.id && ["pending", "owner_approved", "owner_rejected", "admin_approved"].includes(r.status)
      );
      setExisting(myReq ?? null);
    }).catch(() => setExisting(null));
  }, [orgId, member?.id]);

  async function signOut() {
    await performLogout();
    window.location.reload();
  }

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) { setError("Please explain why you want to reactivate your access."); return; }
    setError(""); setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("coop-portal", {
        body: { action: "submit-member-reactivation", org_id: orgId, reason: reason.trim() },
      });
      if (data?.error) {
        if (data.request_status) {
          setExisting({ status: data.request_status });
        } else {
          setError(data.error);
        }
      } else if (data?.ok) {
        setExisting(data.request);
        setDone(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const statusCfg   = existing ? MEMBER_STATUS_COPY[existing.status] : null;
  const canResubmit = existing?.status === "owner_rejected" || existing?.status === "admin_rejected";

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="mb-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-green-500 flex items-center justify-center mx-auto mb-3">
          <span className="text-white font-black text-2xl">K</span>
        </div>
        <p className="text-slate-400 text-sm">{member?.org?.name || t("coopDash.organisation")} Member Portal</p>
      </div>

      <div className="w-full max-w-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">Account Archived</p>
              <p className="text-slate-400 text-xs">Your portal access has been suspended</p>
            </div>
          </div>
          {member?.full_name && (
            <p className="text-slate-300 text-sm">
              Hi <span className="font-semibold text-white">{member.full_name}</span>, your membership account is currently
              archived. You cannot access the portal or perform any transactions until it is reactivated.
            </p>
          )}
        </div>

        {existing === undefined && (
          <div className="text-center py-4 text-slate-500 text-sm">Checking request status…</div>
        )}

        {existing && !canResubmit && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Reactivation Request</p>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${statusCfg?.color?.replace("text-", "bg-")} flex-shrink-0`} />
              <span className={`font-semibold text-sm ${statusCfg?.color}`}>{statusCfg?.label}</span>
            </div>
            <p className="text-slate-400 text-xs">{statusCfg?.desc}</p>
            {existing.status === "admin_approved" && (
              <button onClick={signOut} className="mt-4 w-full py-2.5 rounded-xl bg-green-500 text-white text-sm font-bold">
                Sign Out &amp; Sign Back In
              </button>
            )}
          </div>
        )}

        {(existing === null || canResubmit) && !done && (
          <form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-5">
            <p className="text-white font-semibold text-sm mb-1">Request Reactivation</p>
            <p className="text-slate-400 text-xs mb-4">
              Submit a reactivation request. Your organisation will review it, and the platform admin will make the final decision.
            </p>
            <label className="block text-xs text-slate-400 mb-1 font-medium">Reason for reactivation</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Explain why you want to reactivate your access…"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm resize-none placeholder-slate-500 focus:outline-none focus:border-green-500 mb-3"
            />
            {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-xl bg-green-500 text-white text-sm font-bold disabled:opacity-50">
              {loading ? "Submitting…" : "Submit Request"}
            </button>
          </form>
        )}

        {done && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 mb-5 text-center">
            <p className="text-green-400 font-semibold text-sm mb-1">Request Submitted</p>
            <p className="text-slate-400 text-xs">Your request has been sent to your organisation for review. You will be notified of the outcome.</p>
          </div>
        )}

        <button onClick={signOut} className="w-full py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm font-medium">
          Sign Out
        </button>
      </div>
    </div>
  );
}
