import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../utils/supabase";
import { useTheme } from "../hooks/useTheme";
import BillPayments from "./BillPayments";
import CashbackCard from "../components/CashbackCard";
import GroupChat from "./GroupChat";
import AIChatWidget from "../components/AIChatWidget";
import { buildCoopMemberContext } from "../utils/buildContext";
import { CoopSavingReceipt, CoopWithdrawalRequestReceipt } from "../components/shared/Receipt";
import { CoopNotificationBell, useChatUnread, ChatToast } from "../components/shared/CoopNotifications";

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
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);

  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-green-500", "bg-green-500"];

  const submit = async () => {
    if (password.length < 8) { setError("Minimum 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false, account_type: "org_member", email_verified: true },
    });
    if (err) { setError(err.message); setSaving(false); return; }
    // Fire welcome email now — member has completed full setup and is about to land on portal
    const memberEmail = member?.email || (await supabase.auth.getUser()).data?.user?.email || "";
    fetch("https://admin.kudiai.app/api/public/email-trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-trigger-secret": process.env.REACT_APP_EMAIL_SECRET },
      body: JSON.stringify({
        event: "org_member_first_login",
        data: { name: member?.full_name || "", email: memberEmail, org_name: member?.org?.name || member?.organizations?.name || "" },
      }),
    }).catch(() => null);
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
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">Password set!</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Taking you to your portal…</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-14 pb-5">
        <div className="w-12 h-12 bg-green-600 rounded-2xl flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Set Your Password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Hi {member?.full_name?.split(" ")[0] || "there"}! Choose a password for your member portal access.
        </p>
      </div>
      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">New Password *</label>
          <div className="relative">
            <input type={showPwd ? "text" : "password"} value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Minimum 8 characters"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500" />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-green-600 dark:text-green-400">
              {showPwd ? "Hide" : "Show"}
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
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Confirm Password *</label>
          <input type={showPwd ? "text" : "password"} value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            placeholder="Repeat your password"
            className={`w-full border rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 ${confirm && confirm !== password ? "border-red-400 dark:border-red-600" : "border-slate-200 dark:border-slate-700"}`} />
          {confirm && confirm !== password && <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>}
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">{error}</p>}
        <button onClick={submit} disabled={saving || password.length < 8 || password !== confirm}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition">
          {saving ? "Saving…" : "Set Password & Enter Portal →"}
        </button>
        <button onClick={() => supabase.auth.signOut()} className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center">
          Sign out
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
  const activeLoans  = loans.filter(l => ["approved","disbursed","ongoing"].includes(l.status));
  const pendingWd    = wdRequests.filter(r => r.status === "pending");
  const pinnedAnns   = announcements.filter(a => a.is_pinned);
  const visibleAnns  = [...pinnedAnns.slice(0,1), ...announcements.filter(a => !a.is_pinned).slice(0,2)].slice(0,3);
  const activePolls  = polls.filter(p => !p.closes_at || new Date(p.closes_at) > new Date()).slice(0, 2);
  const upcomingEvts = events.filter(e => e.event_date && new Date(e.event_date) > new Date()).slice(0, 2);
  const orgActions   = [
    ...activePolls.map(p => ({ id: p.id, type:"poll",  label: p.question, sub:"Active poll · Tap to vote" })),
    ...upcomingEvts.map(e => ({ id: e.id, type:"event", label: e.title,    sub: new Date(e.event_date).toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short"}) + (e.location ? ` · ${e.location}` : "") })),
  ];

  const STATS = [
    { label:"Savings Balance",  value: fmt(member.savings_balance),
      sub: "current balance", bg:"#059669", tab:"contributions",
      icon:"M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { label:"Active Loans",     value: activeLoans.length,
      sub: activeLoans.length > 0 ? fmt(activeLoans.reduce((s,l)=>s+(l.outstanding_balance||0),0))+" owed" : "none active",
      bg:"#dc2626", tab:"loans",
      icon:"M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
    { label:"Withdrawal Reqs",  value: pendingWd.length,
      sub: pendingWd.length > 0 ? "pending approval" : "none pending",
      bg: pendingWd.length > 0 ? "#d97706" : "#64748b", tab:"contributions",
      icon:"M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" },
    { label:"Messages",         value: announcements.length,
      sub: pinnedAnns.length > 0 ? `${pinnedAnns.length} pinned` : "from organisation",
      bg:"#00A651", tab:"messages",
      icon:"M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  ];

  return (
    <div className="pb-8 space-y-6">

      {/* ── Hero Balance Card ── */}
      <div className="mx-4 mt-5 rounded-3xl px-6 py-6 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(145deg,#059669 0%,#047857 55%,#065f46 100%)" }}>
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
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Savings Balance</p>
          <p className="text-4xl font-black tracking-tight mt-1.5 mb-5 tabular-nums">{fmt(member.savings_balance)}</p>
          <div className="flex gap-4 flex-wrap">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Member Since</p>
              <p className="text-sm font-bold">{fmtDate(member.joined_date)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Status</p>
              <p className="text-sm font-bold capitalize">{member.status || "active"}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Org Members</p>
              <p className="text-sm font-bold tabular-nums">{org.member_count || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Services ── */}
      <div className="px-4">
        <div className="flex justify-between items-center mb-4">
          <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">Quick Services</p>
          {onNavigate && <button onClick={() => onNavigate("bills")} className="text-[10px] font-bold text-green-600 dark:text-green-400">View All →</button>}
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
        <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em] mb-4">My Summary</p>
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
        <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em] mb-3">Organisation</p>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 dark:border-slate-700/40">
            <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center text-lg">
              {ORG_TYPE_ICONS[org.type] || "🏢"}
            </div>
            <div>
              <p className="text-sm font-extrabold text-slate-800 dark:text-white">{org.name}</p>
              <p className="text-[10px] text-slate-400 capitalize">{org.type?.replace(/_/g," ")} · {org.member_count || 0} members</p>
            </div>
          </div>
          {[
            ["Total Funds", fmt(org.total_savings || 0), "#059669"],
            ["Loans Out",   fmt(org.total_loans_out || 0), "#dc2626"],
          ].map(([k, v, c]) => (
            <div key={k} className="flex justify-between items-center px-4 py-3 border-b border-slate-50 dark:border-slate-700/30 last:border-0">
              <span className="text-xs text-slate-400">{k}</span>
              <span className="text-sm font-extrabold" style={{ color: c }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Announcements ── */}
      {visibleAnns.length > 0 && (
        <div className="px-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">Announcements</p>
            {onNavigate && <button onClick={() => onNavigate("messages")} className="text-[10px] font-bold text-green-600 dark:text-green-400">View All →</button>}
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
            <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">From Organisation</p>
            <button onClick={() => onNavigate?.("broadcast")} className="text-[10px] font-bold text-green-600 dark:text-green-400">See All →</button>
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
  const [programId, setProgramId] = useState(preProgram?.id || "");
  const [programs,  setPrograms]  = useState(preProgram ? [preProgram] : []);
  const [amount,    setAmount]    = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");

  useEffect(() => {
    if (preProgram) return;
    coopFn("member-get-programs", { member_id: member.id, org_id: org.id })
      .then(r => setPrograms((r.programs || []).filter(p => p.status === "active")))
      .catch(() => null);
  }, [member.id, org.id, preProgram]);

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
    if (!amt || amt <= 0) { setError("Enter a valid amount"); return; }
    if (isFixed && !metTarget && (paidThisMonth + amt) < required) {
      setError(`Pay at least ${fmt(remaining)} to meet your ${fmt(required)} monthly target`);
      return;
    }
    setLoading(true); setError("");
    try {
      const res = await coopFn("initialize-member-payment", {
        member_id: member.id, org_id: org.id, amount: amt,
        program_id: programId || undefined,
        callback_url: window.location.origin,
      });
      if (!res.authorization_url) throw new Error("Payment initialization failed");
      localStorage.setItem(`${ORG_PAY_PREFIX}${res.reference}`, JSON.stringify({
        member_id: member.id, org_id: org.id, amount: amt,
        program_id: programId || undefined,
      }));
      window.location.href = res.authorization_url;
    } catch (e) {
      setLoading(false);
      setError(e.message || "Payment failed. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end justify-center"
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-5" />
        <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-0.5">Monthly Contribution</h3>
        <p className="text-xs text-slate-400 mb-4">{monthLabel} · {org.name}</p>

        {/* Program selector — only shown when not pre-selected */}
        {!preProgram && programs.length > 0 && (
          <div className="mb-4">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Contribution Program</label>
            <select value={programId} onChange={e => { setProgramId(e.target.value); setError(""); }} disabled={loading}
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50">
              <option value="">— General contribution —</option>
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
                {metTarget ? "✓ Target Met" : "Outstanding"}
              </span>
            </div>
            <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, (paidThisMonth / required) * 100)}%`, background: metTarget ? "#16a34a" : "#f59e0b" }} />
            </div>
            <div className="flex justify-between text-[10px] font-semibold mb-1">
              <span className="text-slate-500 dark:text-slate-400">{fmt(paidThisMonth)} paid</span>
              <span className="text-slate-600 dark:text-slate-300">{fmt(required)} target</span>
            </div>
            {!metTarget && (
              <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                {fmt(remaining)} remaining for {monthLabel}
              </p>
            )}
          </div>
        )}

        {/* Voluntary program label */}
        {preProgram && !isFixed && (
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{preProgram.name}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Voluntary — pay any amount</p>
          </div>
        )}

        {/* Amount input */}
        <div className="mb-4">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            {metTarget ? "Extra Contribution (₦)" : `Amount (₦)${isFixed ? ` · Min ${fmt(remaining)}` : ""}`}
          </label>
          <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
            placeholder={metTarget ? "Top up beyond your target (optional)" : isFixed ? `Min ${fmt(remaining)}` : "Enter amount"}
            disabled={loading}
            className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-50" />
          {metTarget && <p className="text-[10px] text-green-600 dark:text-green-400 mt-1">You've already met your {monthLabel} target. Any extra payment is a bonus contribution.</p>}
        </div>

        {error && <p className="text-xs px-3 py-2.5 rounded-xl mb-4 border bg-red-50 border-red-200 text-red-600">{error}</p>}

        <button onClick={handlePay} disabled={loading || !amount}
          className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl text-sm disabled:opacity-60">
          {loading
            ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Preparing payment…</span>
            : `Pay ${amount ? fmt(parseFloat(amount) || 0) : ""} via Paystack →`}
        </button>

        {!loading && (
          <button onClick={onClose} className="w-full py-3 text-xs text-slate-400 hover:text-slate-600 mt-1">Cancel</button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  REQUEST WITHDRAWAL MODAL
// ═══════════════════════════════════════════════════
function RequestWithdrawalModal({ member, org, onClose, onSuccess }) {
  const [amount,  setAmount]  = useState("");
  const [reason,  setReason]  = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [done,    setDone]    = useState(false);

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError("Enter a valid amount"); return; }
    if (amt > (member.savings_balance || 0)) { setError(`Amount exceeds your balance of ${fmt(member.savings_balance)}`); return; }
    setSaving(true); setError("");
    try {
      await coopFn("request-member-withdrawal", { member_id: member.id, org_id: org.id, amount: amt, reason });
      setDone(true);
      onSuccess?.();
    } catch (e) { setError(e.message || "Failed to submit request"); }
    finally { setSaving(false); }
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
            <p className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Request Submitted</p>
            <p className="text-xs text-slate-400 mb-6">Your withdrawal request is pending approval from {org.name}.</p>
            <button onClick={onClose} className="w-full py-3 bg-green-600 text-white font-bold rounded-2xl text-sm">Done</button>
          </div>
        ) : (
          <>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Request Withdrawal</h3>
            <p className="text-xs text-slate-400 mb-4">Available balance: <strong className="text-green-600">{fmt(member.savings_balance)}</strong></p>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦) *</label>
                <input type="number" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
                  placeholder="Enter amount"
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Reason (Optional)</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why do you need this withdrawal?"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} disabled={saving} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={handleSubmit} disabled={saving || !amount}
                className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {saving ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  CONTRIBUTIONS TAB
// ═══════════════════════════════════════════════════
function ContributionsTab({ member: initialMember, org, onMemberUpdate }) {
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
          <p className="text-lg font-extrabold text-green-600 tabular">{fmt(member.savings_balance)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Current Balance</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center">
          <p className="text-lg font-extrabold text-green-600 tabular">{fmt(totalContributed)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Total Contributions</p>
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
            Pay via Paystack
          </button>
        )}
        <button onClick={() => setShowWdReq(true)}
          className={`${hasPaystack ? "flex-1" : "w-full"} py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          Request Withdrawal
          {pendingWd > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-black flex items-center justify-center">{pendingWd}</span>}
        </button>
      </div>

      {programs.filter(p => p.status === "active").length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Contribution Programs</p>
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
                      {!isFixed && <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded-lg">Voluntary</span>}
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
                        style={{ width: `${pct}%`, background: metTarget ? "#16a34a" : "#f59e0b" }} />
                    </div>
                    <div className="flex justify-between text-[9px] font-semibold text-slate-400">
                      <span>{fmt(paid)} paid this month</span>
                      <span className={metTarget ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
                        {metTarget ? "Target met ✓" : `${fmt(remaining)} remaining`}
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
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Withdrawal Requests</p>
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
                    <button onClick={() => setSelectedRequest(r)} className="text-[10px] font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-2 py-0.5 rounded-full">
                      Receipt
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Contribution History</p>
        {history.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">No contributions yet</div>
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
        <CoopSavingReceipt
          saving={{ ...selectedHistory, org_members: { full_name: member.full_name, membership_id: member.membership_id } }}
          orgName={org.name}
          onClose={() => setSelectedHistory(null)}
        />
      )}
      {selectedRequest && (
        <CoopWithdrawalRequestReceipt
          request={selectedRequest}
          orgName={org.name}
          memberName={member.full_name}
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
  const [loans,      setLoans]      = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null);
  const [showApply,  setShowApply]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [repaying,   setRepaying]   = useState(false);
  const [error,      setError]      = useState("");
  const defaultRate  = org.default_loan_interest_rate ?? 10;
  const [form, setForm] = useState({
    amount_requested: "", interest_rate: String(defaultRate),
    loan_purpose: "", repayment_months: "12",
  });

  const load = useCallback(() => {
    coopFn("get-loans", { org_id: org.id, member_id: member.id })
      .then(r => setLoans(r.loans || []))
      .finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const principal = parseFloat(form.amount_requested) || 0;
  const rate      = parseFloat(form.interest_rate) || 0;
  const months    = parseInt(form.repayment_months) || 1;
  const preview   = calcLoanPreview(principal, rate, months);

  const handleApply = async () => {
    if (!form.amount_requested) { setError("Amount required"); return; }
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
        callback_url: window.location.origin,
      });
      if (!res.authorization_url) throw new Error("Payment initialization failed");
      localStorage.setItem(`${ORG_LOAN_PAY_PREFIX}${res.reference}`, JSON.stringify({
        member_id: member.id, org_id: org.id, loan_id: loan.id, amount: repayAmt,
      }));
      window.location.href = res.authorization_url;
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
        Apply for a Loan
      </button>

      {loans.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">No Loans Yet</p>
          <p className="text-sm text-slate-400">Submit an application above and your organisation will review it.</p>
        </div>
      ) : (
        loans.map(l => {
          const isOverdue = l.status === "disbursed" && l.due_date && l.due_date < today;
          return (
            <button key={l.id} onClick={() => openLoan(l)}
              className={`bg-white dark:bg-slate-800 rounded-2xl p-4 border text-left w-full ${isOverdue ? "border-red-300 dark:border-red-700" : "border-slate-100 dark:border-slate-700"}`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-white">{l.loan_purpose || "General Loan"}</p>
                  <p className="text-[10px] text-slate-400">{fmtDate(l.applied_at)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-bold capitalize ${LOAN_STATUS_COL[l.status] || "text-slate-500"}`}>● {l.status}</span>
                    {isOverdue && <span className="text-[9px] font-black text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">OVERDUE</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold text-amber-600">{fmt(l.amount_requested)}</p>
                  {l.outstanding_balance > 0 && <p className="text-xs text-red-500 font-bold">Owed: {fmt(l.outstanding_balance)}</p>}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                {[["Interest", `${l.interest_rate}%`], ["Monthly", fmt(l.monthly_installment || 0)], ["Due", fmtDate(l.due_date)]].map(([k, v]) => (
                  <div key={k}><p className="text-[10px] text-slate-400">{k}</p><p className="text-xs font-bold text-slate-700 dark:text-slate-200">{v || "—"}</p></div>
                ))}
              </div>
            </button>
          );
        })
      )}

      {/* Loan application modal */}
      {showApply && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Apply for a Loan</h3>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦) *</label>
                  <input value={form.amount_requested} onChange={set("amount_requested")} type="number" placeholder="0"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Months</label>
                  <input value={form.repayment_months} onChange={set("repayment_months")} type="number" min="1"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Purpose</label>
                <input value={form.loan_purpose} onChange={set("loan_purpose")} placeholder="What's it for?"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
              </div>
              {principal > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2">Estimated Repayment</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[["Interest ({rate}%)".replace("{rate}", String(rate)), fmt(preview.totalInterest)],
                      ["Total", fmt(preview.totalRepayable)],
                      ["Per Month", fmt(preview.monthlyInstallment)]].map(([k, v]) => (
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
              <button onClick={() => { setShowApply(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={handleApply} disabled={saving} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Submitting…" : "Submit"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Loan detail sheet */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-sm p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-base font-extrabold text-slate-800 dark:text-white">{selected.loan_purpose || "General Loan"}</p>
                <p className="text-[10px] text-slate-400">{fmtDate(selected.applied_at)}</p>
              </div>
              <span className={`text-xs font-bold capitalize px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 ${LOAN_STATUS_COL[selected.status]}`}>{selected.status}</span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-3 mb-3 grid grid-cols-2 gap-2">
              {[
                ["Amount", fmt(selected.amount_requested)],
                ["Interest", `${selected.interest_rate}%`],
                ["Total Repayable", fmt(selected.total_repayable || selected.amount_requested)],
                ["Monthly Install.", fmt(selected.monthly_installment || 0)],
                ["Outstanding", fmt(selected.outstanding_balance)],
                ["Due Date", fmtDate(selected.due_date)],
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
              <button onClick={() => handlePaystackRepay(selected)} disabled={repaying}
                className="w-full py-3 bg-green-600 text-white rounded-2xl font-bold text-sm mb-3 flex items-center justify-center gap-2 disabled:opacity-70 active:scale-[0.98] transition-transform">
                {repaying
                  ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Preparing payment…</>
                  : <><svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>Pay via Paystack — {fmt(selected.monthly_installment || selected.outstanding_balance)}</>}
              </button>
            )}

            {selected.status === "pending" && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 mb-3 text-center">
                <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Awaiting Review</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">Your application is being reviewed by the admin.</p>
              </div>
            )}

            {repayments.length > 0 && (
              <div className="mb-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Repayment History</p>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
                  {repayments.map(r => (
                    <div key={r.id} className="flex justify-between items-center bg-slate-50 dark:bg-slate-700 rounded-lg px-2.5 py-1.5">
                      <div>
                        <p className="text-xs font-bold text-green-600">{fmt(r.amount)}</p>
                        <p className="text-[10px] text-slate-400">{fmtDT(r.created_at)} · {r.payment_method}</p>
                      </div>
                      {r.interest_portion > 0 && (
                        <p className="text-[10px] text-amber-600">+{fmt(r.interest_portion)} interest</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => { setSelected(null); setRepayments([]); setError(""); }}
              className="w-full py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  BROADCAST STATION TAB (member portal)
// ═══════════════════════════════════════════════════
function MemberBroadcastTab({ member, org }) {
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState("all");
  const [rsvping,    setRsvping]    = useState(null);
  const [voting,     setVoting]     = useState(null);

  const load = useCallback(() => {
    coopFn("member-get-broadcasts", { member_id: member.id, org_id: org.id })
      .then(r => setBroadcasts(r.broadcasts || []))
      .finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  const handleRsvp = async (meetingId, status) => {
    setRsvping(meetingId);
    try { await coopFn("set-rsvp", { meeting_id: meetingId, member_id: member.id, org_id: org.id, status }); load(); }
    catch (e) { alert(e.message); }
    finally { setRsvping(null); }
  };

  const handleVote = async (pollId, optionIndex) => {
    setVoting(pollId);
    try { await coopFn("member-submit-poll-vote", { poll_id: pollId, member_id: member.id, option_index: optionIndex }); load(); }
    catch (e) { alert(e.message); }
    finally { setVoting(null); }
  };

  const FILTER_TABS = [
    { id: "all",          label: "All"           },
    { id: "meeting",      label: "Meetings"      },
    { id: "announcement", label: "Announcements" },
    { id: "event",        label: "Events"        },
    { id: "poll",         label: "Polls"         },
  ];
  const RSVP_OPTIONS = [
    { status: "attending",     label: "Attending", color: "bg-green-500 text-white"  },
    { status: "maybe",         label: "Maybe",     color: "bg-amber-400 text-white"  },
    { status: "not_attending", label: "Can't Go",  color: "bg-slate-400 text-white"  },
  ];
  const TYPE_COLORS = {
    meeting:      { bg: "bg-[#0D2040]", text: "text-white", label: "Meeting"      },
    announcement: { bg: "bg-amber-500",  text: "text-white", label: "Announcement" },
    event:        { bg: "bg-[#00A651]",  text: "text-white", label: "Event"        },
    poll:         { bg: "bg-purple-600", text: "text-white", label: "Poll"         },
  };

  const visible = filter === "all" ? broadcasts : broadcasts.filter(b => b._type === filter);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-[3px] border-t-transparent rounded-full animate-spin" style={{ borderColor: "#00A651", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
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
            <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">Nothing here yet</p>
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
                    className="inline-block mb-2 text-[10px] font-bold text-green-500 bg-green-50 dark:bg-green-900/20 px-2.5 py-1 rounded-lg">🔗 Join Online</a>
                )}
                {item.agenda && (
                  <div className="bg-slate-50 dark:bg-slate-700 rounded-xl px-3 py-2 mb-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Agenda</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line line-clamp-4">{item.agenda}</p>
                  </div>
                )}
                {item.my_attendance && (
                  <p className={`text-[10px] font-bold mb-2 ${item.my_attendance === "present" ? "text-green-600" : "text-red-500"}`}>
                    {item.my_attendance === "present" ? "✓ You were marked present" : "✗ You were marked absent"}
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
                    className="inline-block mt-2 text-[10px] font-bold text-green-500 bg-green-50 dark:bg-green-900/20 px-2.5 py-1 rounded-lg">🔗 More info</a>
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
                        <div className="absolute inset-0" style={{ width: `${pct}%`, background: isMyVote ? "#00A65120" : "#00000008" }} />
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
                  {item.total_votes || 0} votes · {item.is_active ? "Poll open" : "Poll closed"}
                  {item.closes_at && item.is_active ? ` · Closes ${fmtDT(item.closes_at)}` : ""}
                </p>
                {item.my_vote == null && item.is_active && (
                  <p className="text-[10px] font-bold mt-1" style={{ color: "#00A651" }}>Tap an option to vote</p>
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
  const [view,      setView]      = useState("ticket"); // "ticket" | "faq"
  const [category,  setCategory]  = useState("General");
  const [subject,   setSubject]   = useState("");
  const [message,   setMessage]   = useState("");
  const [sending,   setSending]   = useState(false);
  const [error,     setError]     = useState("");
  const [done,      setDone]      = useState(null); // ticket_ref on success
  const [openFaq,   setOpenFaq]   = useState(null);

  const submit = async () => {
    if (!subject.trim() || !message.trim()) { setError("Please fill in the subject and message."); return; }
    setSending(true); setError("");
    try {
      const res = await coopFn("submit-support-ticket", {
        member_id: member.id, org_id: org.id,
        category, subject: subject.trim(), message: message.trim(),
      });
      setDone(res.ticket_ref);
      setSubject(""); setMessage(""); setCategory("General");
    } catch (e) {
      setError(e.message || "Failed to submit ticket. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab switcher */}
      <div className="flex-none flex border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
        {[
          { id: "ticket", label: "Raise a Ticket", icon: "M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" },
          { id: "faq",    label: "FAQ",            icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
        ].map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-bold border-b-2 transition-colors
              ${view === t.id ? "border-[#00A651] text-[#00A651]" : "border-transparent text-slate-400 dark:text-slate-500"}`}>
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
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#00A651,#059669)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <p className="text-base font-extrabold text-slate-800 dark:text-white">Ticket Submitted!</p>
                <p className="text-[12px] text-slate-400 mt-1">Reference: <span className="font-bold text-[#00A651]">{done}</span></p>
                <p className="text-[12px] text-slate-400 mt-2 leading-relaxed">You'll receive a confirmation email shortly. Your organisation admin has been notified.</p>
              </div>
              <button onClick={() => setDone(null)}
                className="mt-2 px-6 py-2.5 bg-[#00A651] text-white text-sm font-bold rounded-xl active:opacity-80">
                Raise Another Ticket
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="bg-[#00A651]/8 dark:bg-[#00A651]/10 rounded-2xl p-4 border border-[#00A651]/20">
                <p className="text-[12px] font-bold text-[#00A651]">How it works</p>
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
                  {["General", "Savings", "Loans", "Technical"].map(c => (
                    <button key={c} onClick={() => setCategory(c)}
                      className={`py-2.5 rounded-xl text-[12px] font-bold border-2 transition-all active:scale-[0.97]
                        ${category === c ? "border-[#00A651] bg-[#00A651]/8 text-[#00A651]" : "border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Subject *</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief description of your issue…"
                  className="w-full bg-slate-100 dark:bg-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-[#00A651]" />
              </div>

              {/* Message */}
              <div>
                <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Message *</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5}
                  placeholder="Describe your issue in detail…"
                  className="w-full bg-slate-100 dark:bg-slate-800 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-white outline-none resize-none focus:ring-2 focus:ring-[#00A651]" />
              </div>

              <button onClick={submit} disabled={sending || !subject.trim() || !message.trim()}
                className="w-full py-3.5 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50 active:opacity-80 transition-opacity"
                style={{ background: "linear-gradient(135deg,#00A651,#059669)" }}>
                {sending
                  ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Sending…</>
                  : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>Submit Ticket</>}
              </button>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Frequently Asked Questions</p>
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
            <div className="mt-4 bg-[#00A651]/8 dark:bg-[#00A651]/10 rounded-2xl p-4 border border-[#00A651]/20 text-center">
              <p className="text-[12px] text-slate-500 dark:text-slate-400">Can't find your answer?</p>
              <button onClick={() => setView("ticket")} className="mt-1.5 text-[12px] font-bold text-[#00A651] active:opacity-70">Raise a support ticket →</button>
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
//  MAIN PORTAL
// ═══════════════════════════════════════════════════
const MAIN_TABS = [
  { id: "home",          label: "Home",    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "contributions", label: "Savings", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "loans",         label: "Loans",   icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
  { id: "messages",      label: "Chat",    icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
];

const MORE_TABS = [
  { id: "bills",     label: "Bills",     color:"#7c3aed", icon:"M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
  { id: "broadcast", label: "Broadcast", color:"#0f766e", icon:"M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "support",   label: "Support",   color:"#00A651", icon:"M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" },
];

// ─── Member Profile Sheet ─────────────────────────────────────────────────────
function ProfileSheet({ member, onClose, onSave }) {
  const [form,       setForm]       = useState({ full_name: member.full_name || "", phone: member.phone || "" });
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
    if (!form.full_name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    try {
      let avatar_url = member.avatar_url || null;
      if (avatarFile) {
        const ext  = avatarFile.name.split(".").pop() || "jpg";
        const path = `members/${member.id}/${Date.now()}.${ext}`;
        const { data, error: upErr } = await supabase.storage.from("avatars").upload(path, avatarFile, { upsert: true });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(data.path);
        avatar_url = publicUrl;
      }
      const { error: dbErr } = await supabase.rpc("update_my_member_profile", {
        p_full_name:  form.full_name.trim(),
        p_phone:      form.phone.trim() || null,
        p_avatar_url: avatar_url,
      });
      if (dbErr) throw dbErr;
      onSave({ full_name: form.full_name.trim(), phone: form.phone.trim() || null, avatar_url });
      onClose();
    } catch (e) { setError(e.message || "Failed to save"); }
    setSaving(false);
  };

  const inp = "w-full bg-slate-100 rounded-xl px-4 py-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-green-400";
  const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day:"numeric", month:"short", year:"numeric" }) : "—";

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md bg-white rounded-t-3xl flex flex-col overflow-hidden"
        style={{ maxHeight: "92dvh" }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-base font-extrabold text-slate-800">My Profile</h3>
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
                : <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-black text-white shadow-xl ring-4 ring-green-100"
                    style={{ background: "linear-gradient(145deg,#00A651,#0D2040)" }}>
                    {member.full_name?.charAt(0).toUpperCase()}
                  </div>
              }
              <div className="absolute bottom-0 right-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center border-2 border-white shadow-md">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} className="w-4 h-4"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </div>
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
            <p className="text-[11px] text-slate-400">Tap to change photo</p>
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Full Name</label>
            <input className={inp} value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} />
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Phone Number</label>
            <input className={inp} type="tel" placeholder="08000000000" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
          </div>

          {[
            ["Membership ID", member.membership_id],
            ["Role",          member.role],
            ["Status",        member.status],
            ["Member Since",  fmtDate(member.joined_date)],
          ].map(([label, val]) => (
            <div key={label}>
              <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{label}</label>
              <p className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm text-slate-500 capitalize">{val || "—"}</p>
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm active:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 active:bg-green-700">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CoopMemberPortal({ member: initialMember }) {
  const { isDark, toggle: toggleDark } = useTheme();
  const [member,        setMember]        = useState(initialMember);
  const [tab,           setTab]           = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "bills";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "bills";
    return "home";
  });
  const [announcements, setAnnouncements] = useState([]);
  const [loans,         setLoans]         = useState([]);
  const [wdRequests,    setWdRequests]    = useState([]);
  const [polls,         setPolls]         = useState([]);
  const [events,        setEvents]        = useState([]);
  const [showMore,      setShowMore]      = useState(false);
  const [showProfile,   setShowProfile]   = useState(false);
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

  const { chatUnread, chatToasts, dismissChatToast } = useChatUnread({
    orgId: org.id,
    isActive: tab === "messages",
  });

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


  // Load announcements + summary counts for dashboard
  useEffect(() => {
    if (!member?.id || !org?.id) return;
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
    }).catch(console.error);
  }, [member?.id, org?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = useCallback((tabId) => {
    setTab(tabId);
    setShowMore(false);
  }, []);

  const openQuickService = useCallback((serviceId) => {
    setBillsAutoSvc(serviceId);
    setTab("bills");
    setShowMore(false);
  }, []);

  const handleMemberUpdate = (updatedMember) => {
    setMember(prev => ({ ...prev, ...updatedMember }));
  };

  if (!member) return null;

  const tabContent = {
    home:          <HomeTab member={member} org={org} announcements={announcements} polls={polls} events={events} loans={loans} wdRequests={wdRequests} onQuickService={openQuickService} onNavigate={navigateTo} userEmail={member.email} />,
    contributions: <ContributionsTab member={member} org={org} onMemberUpdate={handleMemberUpdate} />,
    loans:         <LoansTab member={member} org={org} />,
    bills:         <MemberBillsTab member={member} org={org} autoService={billsAutoSvc} onAutoOpened={() => setBillsAutoSvc(null)} />,
    broadcast:     <MemberBroadcastTab member={member} org={org} />,
    support:       <SupportTab member={member} org={org} />,
    messages:      <GroupChat orgId={org.id} myName={member.full_name} myRole="member" orgName={org.name} org={org} onBack={() => navigateTo("home")} />,
  };

  const isMoreTab = MORE_TABS.some(t => t.id === tab);
  const emergencyCount = announcements.filter(a => a.type === "emergency").length;

  return (
    <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
      <div className="w-full max-w-md flex flex-col h-full relative">

        {/* ── Header — matches org portal h-14 ── */}
        <header className="flex-none z-30 h-14 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
          <img src="/logo.png" alt="KudiAi" className="h-8 w-8 object-contain flex-shrink-0" />
          <div className="flex items-baseline gap-0.5 select-none">
            <span className="text-[17px] font-black tracking-tight text-slate-800 dark:text-white leading-none">Kudi</span>
            <span className="text-[17px] font-black tracking-tight leading-none"
              style={{ background: "linear-gradient(135deg,#00A651,#059669)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase leading-none ml-1">Track</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <CoopNotificationBell orgId={org.id} recipientId={member.id} recipientType="member" onNavigate={navigateTo} />
            <button onClick={() => setShowProfile(true)} className="active:scale-90 transition-transform">
              {member.avatar_url
                ? <img src={member.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border-2 border-slate-100 dark:border-slate-700 shadow-sm" />
                : <div className="w-9 h-9 rounded-full flex items-center justify-center text-base font-extrabold text-white border-2 border-slate-100 dark:border-slate-700 shadow-sm"
                    style={{ background: "linear-gradient(145deg,#00A651,#0D2040)" }}>
                    {member.full_name?.charAt(0).toUpperCase()}
                  </div>
              }
            </button>
          </div>
        </header>

        {/* ── Main Content ── */}
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {tabContent[tab]}
        </main>

        {/* ── Bottom Navigation — matches org portal ── */}
        <nav className="flex-none z-40 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shadow-float">
          <div className="flex items-stretch h-[60px]">
            {MAIN_TABS.map(t => {
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => { setTab(t.id); setShowMore(false); }}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 relative focus-visible:outline-none">
                  {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-[#00A651] dark:bg-green-400" />}
                  <div className={`relative transition-all duration-200 ${active ? "scale-110" : "scale-100"}`}>
                    <svg viewBox="0 0 24 24" fill="none" className="w-[21px] h-[21px]"
                      stroke={active ? "#00A651" : "#94a3b8"} strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                      <path d={t.icon} />
                    </svg>
                    {t.id === "messages" && chatUnread > 0 && !active && (
                      <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 bg-green-500 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center px-0.5 shadow-sm">
                        {chatUnread > 99 ? "99+" : chatUnread}
                      </span>
                    )}
                  </div>
                  <span className={`text-[8px] font-bold uppercase tracking-wide leading-none ${active ? "text-[#00A651] dark:text-green-400" : "text-slate-400 dark:text-slate-500"}`}>
                    {t.label}
                  </span>
                </button>
              );
            })}
            {/* Hamburger / Menu */}
            <button onClick={() => setShowMore(p => !p)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 relative focus-visible:outline-none">
              {isMoreTab && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-[#00A651] dark:bg-green-400" />}
              <div className={`relative transition-all duration-200 ${showMore ? "scale-110" : "scale-100"}`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-[21px] h-[21px]"
                  stroke={isMoreTab || showMore ? "#00A651" : "#94a3b8"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                {emergencyCount > 0 && !showMore && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </div>
              <span className={`text-[8px] font-bold uppercase tracking-wide leading-none ${isMoreTab || showMore ? "text-[#00A651] dark:text-green-400" : "text-slate-400 dark:text-slate-500"}`}>
                Menu
              </span>
            </button>
          </div>
          <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} className="bg-white dark:bg-slate-900" />
        </nav>

        {/* ── Chat drop-in toasts ── */}
        {chatToasts.length > 0 && (
          <div className="fixed top-[60px] inset-x-0 z-[185] flex flex-col items-center gap-2 px-4 pointer-events-none">
            {chatToasts.map(ct => (
              <ChatToast
                key={ct._tid}
                toast={ct}
                orgName={org.name}
                onNavigate={() => { navigateTo("messages"); dismissChatToast(ct._tid); }}
                onDismiss={() => dismissChatToast(ct._tid)}
              />
            ))}
          </div>
        )}

        {/* ── Side Drawer — matches org portal ── */}
        {showMore && (
          <div className="fixed inset-0 z-50 flex" onClick={() => setShowMore(false)}>
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
                    : <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl font-black text-white"
                        style={{ background: "linear-gradient(145deg,#00A651,#0D2040)" }}>
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
                      className={`w-full flex items-center gap-4 px-5 py-3.5 transition-colors ${active ? "text-[#00A651]" : "text-slate-700 dark:text-slate-200"}`}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 flex-shrink-0"
                        stroke={active ? "#00A651" : "currentColor"} strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                        <path d={t.icon} />
                      </svg>
                      <span className={`text-sm ${active ? "font-extrabold" : "font-semibold"}`}>{t.label}</span>
                      {active && <div className="ml-auto w-1 h-5 bg-[#00A651] rounded-full" />}
                    </button>
                  );
                })}
                <div className="mx-5 my-2 border-t border-slate-100 dark:border-slate-800" />
                {MORE_TABS.map(t => {
                  const active = tab === t.id;
                  return (
                    <button key={t.id} onClick={() => navigateTo(t.id)}
                      className={`w-full flex items-center gap-4 px-5 py-3.5 transition-colors ${active ? "text-[#00A651]" : "text-slate-700 dark:text-slate-200"}`}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: (t.color || "#64748b") + "18" }}>
                        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ stroke: active ? "#00A651" : (t.color || "#64748b") }}>
                          {t.icon.split("|").map((p, i) => <path key={i} d={p} />)}
                        </svg>
                      </div>
                      <span className={`text-sm ${active ? "font-extrabold" : "font-semibold"}`}>{t.label}</span>
                      {active && <div className="ml-auto w-1 h-5 bg-[#00A651] rounded-full" />}
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
                  <span className="text-sm font-semibold">Edit Profile</span>
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
                  <span className="text-sm font-semibold">{isDark ? "Light Mode" : "Dark Mode"}</span>
                </button>
              </div>

              {/* Sign out */}
              <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
                <button onClick={() => supabase.auth.signOut()}
                  className="flex items-center gap-3 text-slate-500 dark:text-slate-400 text-sm font-semibold active:opacity-70 transition-opacity">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign Out
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
            <p className="text-base font-extrabold text-slate-800 dark:text-white">Verifying payment…</p>
            <p className="text-xs text-slate-400 mt-2">Please wait while we confirm your contribution</p>
          </div>
        </div>
      )}

      {member && (
        <AIChatWidget
          portalContext={buildCoopMemberContext(member, loans, org)}
          greeting={`Hi${member.full_name ? ` ${member.full_name.split(" ")[0]}` : ""}! I'm **KudiAI**, your cooperative assistant.\n\nI know your savings, loans, and membership details — ask me anything!`}
          quickChips={[
            { label: "My Savings",     q: "What is my current savings balance?" },
            { label: "Loan Status",    q: "What are my active loans and remaining balances?" },
            { label: "Loan Eligibility", q: "Am I eligible for a new loan?" },
            { label: "Payment Plan",   q: "Show my loan payment schedule" },
            { label: "Coop Benefits",  q: "What benefits do I get as a cooperative member?" },
          ]}
          inputPlaceholder="Ask about your coop account…"
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
                <p className="text-xl font-extrabold text-slate-800 dark:text-white mb-1">Payment Confirmed!</p>
                <p className="text-3xl font-black text-green-600 mt-3 mb-1">{fmt(paymentResult.amount)}</p>
                <p className="text-xs text-slate-400 mb-8">added to your savings balance</p>
                <button onClick={() => setPaymentResult(null)}
                  className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl text-sm">
                  View Savings
                </button>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-red-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-xl font-extrabold text-slate-800 dark:text-white mb-1">Payment Failed</p>
                <p className="text-xs text-slate-400 mt-2 mb-8">{paymentResult.error}</p>
                <button onClick={() => setPaymentResult(null)}
                  className="w-full py-4 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white font-bold rounded-2xl text-sm">
                  Dismiss
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
