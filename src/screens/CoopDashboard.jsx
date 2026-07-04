import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../utils/supabase";
import { useTheme } from "../hooks/useTheme";
import { useT } from "../contexts/LanguageContext";
import BillPayments from "./BillPayments";
import CashbackCard from "../components/CashbackCard";
import GroupChat from "./GroupChat";
import { CoopSavingReceipt, CoopBulkWithdrawalReceipt, CoopWithdrawalRequestReceipt } from "../components/shared/Receipt";
import { CoopNotificationBell, useChatUnread, ChatToast } from "../components/shared/CoopNotifications";
import AIChatWidget from "../components/AIChatWidget";
import { buildCoopOrgContext } from "../utils/buildContext";

const coopFn = async (action, body = {}) => {
  const r = await supabase.functions.invoke("coop-portal", { body: { action, ...body } });
  if (r.error) {
    let msg = r.error.message;
    try {
      const errBody = r.data?.error
        ? r.data
        : (r.error.context ? await r.error.context.clone().json() : null);
      if (errBody?.error) msg = errBody.error;
    } catch { /* keep original msg */ }
    throw new Error(msg);
  }
  if (r.data?.error) throw new Error(r.data.error);
  return r.data;
};

const fmt     = n => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT   = d => d ? new Date(d).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const ROLE_COLORS = {
  admin: "bg-green-100 text-green-700", president: "bg-amber-100 text-amber-700",
  chairman: "bg-amber-100 text-amber-700", vice_chairman: "bg-orange-100 text-orange-700",
  treasurer: "bg-green-100 text-green-700", secretary: "bg-blue-100 text-blue-700",
  officer: "bg-pink-100 text-pink-700", welfare_officer: "bg-rose-100 text-rose-700",
  auditor: "bg-cyan-100 text-cyan-700", patron: "bg-indigo-100 text-indigo-700",
  member: "bg-slate-100 text-slate-600",
};
const ROLE_LABELS = {
  admin: "Admin", president: "President", chairman: "Chairman", vice_chairman: "Vice Chairman",
  treasurer: "Treasurer", secretary: "Secretary", officer: "Officer",
  welfare_officer: "Welfare Officer", auditor: "Auditor", patron: "Patron", member: "Member",
};
const ALL_ROLES = ["member","officer","secretary","treasurer","president","chairman","vice_chairman","welfare_officer","auditor","patron","admin"];
const STATUS_COL = {
  active: "text-green-600", suspended: "text-amber-500", removed: "text-red-500",
  pending: "text-amber-500", approved: "text-blue-600", disbursed: "text-green-600",
  repaid: "text-green-600", rejected: "text-red-500", defaulted: "text-red-700",
  scheduled: "text-blue-600", ongoing: "text-green-600", completed: "text-slate-500", cancelled: "text-red-500",
};
const ANN_COLORS = {
  announcement: "bg-blue-50 text-blue-700 border-blue-200",
  notice:       "bg-amber-50 text-amber-700 border-amber-200",
  circular:     "bg-green-50 text-green-700 border-green-200",
  emergency:    "bg-red-50 text-red-700 border-red-200",
};
const FREQ_LABELS = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly",
  quarterly: "Quarterly", annual: "Annual", one_time: "One-time",
};

const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-400";
const ModalWrap = ({ children, onClose }) => (
  <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center" onClick={onClose}>
    <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-5" />
      {children}
    </div>
  </div>
);

// ═══════════════════════════════════════════════════
//  OVERVIEW TAB — Premium Dashboard
// ═══════════════════════════════════════════════════
const OV_QUICK = [
  { id:"airtime",     label:"Airtime",     g1:"#ef4444", g2:"#b91c1c", icon:"M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.25 2.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.122.966.356 1.916.7 2.81a2 2 0 01-.45 2.11L6.95 7.91a16 16 0 006.29 6.29l1.27-.56a2 2 0 012.11-.45c.894.344 1.844.578 2.81.7A2 2 0 0122 16.92z" },
  { id:"data",        label:"Data",        g1:"#3b82f6", g2:"#1d4ed8", icon:"M1.05 5l4.95-3 4.95 3 4.95-3L21 5|M1.05 11l4.95-3 4.95 3 4.95-3L21 11|M1.05 17l4.95-3 4.95 3 4.95-3L21 17" },
  { id:"electricity", label:"Electricity", g1:"#f59e0b", g2:"#b45309", icon:"M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  { id:"cable",       label:"Cable TV",    g1:"#8b5cf6", g2:"#6d28d9", icon:"M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z|M12 19v3|M8 22h8" },
];

function OverviewTab({ org, wallet, programs, announcements, members = [], loans = [], wdRequests = [], onQuickService = null, onNavigate = null, adminEmail = null }) {
  const activeMembers  = members.filter(m => m.status === "active");
  const activePrograms = programs.filter(p => p.status === "active");
  const pendingReqs    = wdRequests.filter(r => r.status === "pending");
  const activeLoans    = loans.filter(l => ["approved","disbursed","ongoing"].includes(l.status));
  const recentTxns     = (wallet?.transactions || []).slice(0, 5);
  const pinnedAnns     = announcements.filter(a => a.is_pinned).slice(0, 1);
  const recentAnns     = announcements.filter(a => !a.is_pinned).slice(0, 2);
  const visibleAnns    = [...pinnedAnns, ...recentAnns].slice(0, 3);

  const STATS = [
    { label:"Members",         value: members.length,       sub:`${activeMembers.length} active`,
      iconBg:"bg-purple-100 dark:bg-purple-900/40", iconColor:"#7c3aed", tab:"members",
      icon:"M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
    { label:"Active Programs",  value: activePrograms.length, sub:`${programs.length} total`,
      iconBg:"bg-green-100 dark:bg-green-900/40", iconColor:"#059669", tab:"programs",
      icon:"M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { label:"Contributions",    value: fmt(org.total_savings), sub:"total collected",
      iconBg:"bg-cyan-100 dark:bg-cyan-900/40", iconColor:"#0891b2", tab:"finance",
      icon:"M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { label:"Withdrawals",      value: fmt(org.total_loans_out), sub:"total disbursed",
      iconBg:"bg-red-100 dark:bg-red-900/40", iconColor:"#dc2626", tab:"finance",
      icon:"M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" },
    { label:"Member Requests",  value: pendingReqs.length,   sub: pendingReqs.length > 0 ? "need attention" : "all clear",
      iconBg: pendingReqs.length > 0 ? "bg-amber-100 dark:bg-amber-900/40" : "bg-slate-100 dark:bg-slate-700/40",
      iconColor: pendingReqs.length > 0 ? "#d97706" : "#64748b", tab:"finance",
      icon:"M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
    { label:"Active Loans",     value: activeLoans.length,   sub: fmt(activeLoans.reduce((s,l) => s+(l.outstanding_balance||0), 0)) + " out",
      iconBg:"bg-orange-100 dark:bg-orange-900/40", iconColor:"#ea580c", tab:"loans",
      icon:"M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
    { label:"Messages",         value: announcements.length, sub:`${announcements.filter(a=>a.is_pinned).length} pinned`,
      iconBg:"bg-green-100 dark:bg-green-900/40", iconColor:"#00A651", tab:"messages",
      icon:"M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
    { label:"Broadcast",        value: "—",                  sub:"meetings, events & more",
      iconBg:"bg-teal-100 dark:bg-teal-900/40", iconColor:"#0f766e", tab:"broadcast",
      icon:"M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
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
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Organisation Wallet</p>
          <p className="text-4xl font-black tracking-tight mt-1.5 mb-5 tabular">{fmt(org.wallet_balance)}</p>
          <div className="flex gap-4 flex-wrap">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Total Savings</p>
              <p className="text-base font-bold tabular">{fmt(org.total_savings)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Loans Out</p>
              <p className="text-base font-bold tabular">{fmt(org.total_loans_out)}</p>
            </div>
            <div className="w-px bg-white/20 self-stretch" />
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Members</p>
              <p className="text-base font-bold tabular">{org.member_count || 0}</p>
            </div>
            {(org.interest_earned > 0) && (
              <>
                <div className="w-px bg-white/20 self-stretch" />
                <div>
                  <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Interest Earned</p>
                  <p className="text-base font-bold tabular text-amber-300">{fmt(org.interest_earned)}</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick Services (org portal only) ── */}
      {onQuickService && (
        <div className="px-4">
          <div className="flex justify-between items-center mb-4">
            <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">Quick Services</p>
            {onNavigate && <button onClick={() => onNavigate("bills")} className="text-[10px] font-bold text-green-600 dark:text-green-400">View All →</button>}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {OV_QUICK.map(s => (
              <button key={s.id} onClick={() => onQuickService(s.id)}
                className="flex flex-col items-center gap-2.5 active:scale-95 transition-transform duration-150">
                <div className="w-[58px] h-[58px] rounded-[18px] flex items-center justify-center shadow-lg"
                  style={{ background:`linear-gradient(145deg,${s.g1},${s.g2})` }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    {s.icon.split("|").map((p,i) => <path key={i} d={p} />)}
                  </svg>
                </div>
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 leading-tight text-center">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Cashback Balance ── */}
      {adminEmail && <CashbackCard userEmail={adminEmail} />}

      {/* ── Dashboard Summary Grid ── */}
      <div className="px-4">
        <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em] mb-4">Dashboard Summary</p>
        <div className="grid grid-cols-2 gap-3">
          {STATS.map(s => (
            <button key={s.label} onClick={() => onNavigate?.(s.tab)}
              className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50 text-left active:scale-95 transition-all duration-150 w-full">
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${s.iconBg}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: s.iconColor }}>
                    {s.icon.split("|").map((p,i) => <path key={i} d={p} />)}
                  </svg>
                </div>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-tight">{s.label}</span>
              </div>
              <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100 tabular leading-tight">{s.value}</p>
              {s.sub && <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">{s.sub}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Recent Activity ── */}
      {recentTxns.length > 0 && (
        <div className="px-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">Recent Activity</p>
            {onNavigate && <button onClick={() => onNavigate("finance")} className="text-[10px] font-bold text-green-600 dark:text-green-400">See All →</button>}
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
            {recentTxns.map((t, i) => {
              const isOut = t.type?.includes("withdrawal") || t.type?.includes("disbursement");
              return (
                <div key={t.id} className={`flex items-center gap-3 px-4 py-3 ${i < recentTxns.length-1 ? "border-b border-slate-50 dark:border-slate-700/40" : ""}`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isOut ? "bg-red-50 dark:bg-red-900/20" : "bg-green-50 dark:bg-green-900/20"}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" stroke={isOut ? "#ef4444" : "#16a34a"}>
                      <path d={isOut ? "M12 5v14M19 12l-7 7-7-7" : "M12 19V5M5 12l7-7 7 7"} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-white capitalize truncate">{t.type?.replace(/_/g," ")}</p>
                    <p className="text-[10px] text-slate-400">{fmtDT(t.created_at)}</p>
                  </div>
                  <p className={`text-sm font-extrabold flex-shrink-0 ${isOut ? "text-red-500" : "text-green-600"}`}>
                    {isOut ? "−" : "+"}{fmt(t.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                  <p className="font-extrabold leading-snug flex-1">{a.title}</p>
                  {a.is_pinned && <span className="text-[9px] flex-shrink-0">📌</span>}
                </div>
                <p className="opacity-75 mt-1.5 line-clamp-2 leading-relaxed">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Org Profile ── */}
      <div className="px-4">
        <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em] mb-3">Organisation Profile</p>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/60 shadow-sm overflow-hidden">
          {[
            ["Reg. Number", org.reg_number],
            ["Type",        org.type?.replace(/_/g," ")],
            ["Phone",       org.phone || "—"],
            ["Email",       org.email || "—"],
            ["Address",     org.address || "—"],
            ...(org.date_established ? [["Established", fmtDate(org.date_established)]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between items-center px-4 py-3 border-b border-slate-50 dark:border-slate-700/30 last:border-0">
              <span className="text-xs text-slate-400">{k}</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-right max-w-[60%] capitalize">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MEMBERS TAB
// ═══════════════════════════════════════════════════
function MembersTab({ org, members, onRefresh }) {
  const [addStep,    setAddStep]    = useState(null); // null | "form"
  const [pendingReg, setPendingReg] = useState(null); // { member_id, email, temp_password, name }
  const [selected,   setSelected]   = useState(null);
  const [editing,    setEditing]    = useState(false);
  const [creds,      setCreds]      = useState(null); // { email, temp_password, name, isReset? }
  const [search,     setSearch]     = useState("");
  const [form,       setForm]       = useState({
    full_name: "", email: "", phone: "", role: "member",
    gender: "", date_of_birth: "", joined_date: "",
    address: "", occupation: "",
    next_of_kin: "", next_of_kin_phone: "",
  });
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const filtered = members.filter(m =>
    m.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    m.membership_id?.toLowerCase().includes(search.toLowerCase()) ||
    m.phone?.includes(search)
  );

  const EMPTY_FORM = { full_name: "", email: "", phone: "", role: "member", gender: "", date_of_birth: "", joined_date: "", address: "", occupation: "", next_of_kin: "", next_of_kin_phone: "" };

  const closeAddFlow = () => {
    setAddStep(null); setPendingReg(null); setError(""); setForm(EMPTY_FORM);
  };

  const handleAdd = async () => {
    if (!form.full_name.trim()) { setError("Full name required"); return; }
    if (!form.email.trim()) { setError("Email address required"); return; }
    setLoading(true); setError("");
    try {
      const result = await coopFn("add-member", { org_id: org.id, ...form });
      setPendingReg({ member_id: result.member.id, email: result.member.email, temp_password: result.temp_password, name: result.member.full_name });
      setForm(EMPTY_FORM);
      setAddStep(null);
      onRefresh();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setLoading(false); }
  };

  const handleEdit = async () => {
    setSaving(true); setError("");
    try {
      await coopFn("update-member", { member_id: selected.id, org_id: org.id, ...form });
      setEditing(false); setSelected(null); onRefresh();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleStatus = async (member, status, reason = "") => {
    setSaving(true);
    try {
      await coopFn("update-member", { member_id: member.id, org_id: org.id, status, suspension_reason: reason });
      setSelected(null); onRefresh();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleResetPassword = async (member) => {
    setSaving(true);
    try {
      const result = await coopFn("reset-member-password", { member_id: member.id, org_id: org.id });
      setSelected(null);
      setCreds({ email: result.email, temp_password: result.temp_password, name: member.full_name, isReset: true });
      onRefresh();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const openEdit = (member) => {
    setForm({
      full_name: member.full_name || "", email: member.email || "", phone: member.phone || "",
      role: member.role || "member", gender: member.gender || "",
      date_of_birth: member.date_of_birth ? member.date_of_birth.split("T")[0] : "",
      joined_date: member.joined_date ? member.joined_date.split("T")[0] : "",
      address: member.address || "", occupation: member.occupation || "",
      next_of_kin: member.next_of_kin || "", next_of_kin_phone: member.next_of_kin_phone || "",
    });
    setEditing(true);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex gap-2">
        <div className="flex-1 relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400" />
        </div>
        <button onClick={() => setAddStep("form")} className="px-4 py-2.5 bg-green-600 text-white rounded-xl text-xs font-bold flex-shrink-0">+ Add</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No members found</div>
        ) : (
          <div className="flex flex-col gap-2 mt-2">
            {filtered.map(m => (
              <button key={m.id} onClick={() => setSelected(m)}
                className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex items-center gap-3 text-left w-full">
                <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-sm font-extrabold text-green-600 flex-shrink-0">
                  {m.full_name?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{m.full_name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{m.membership_id}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ROLE_COLORS[m.role] || ROLE_COLORS.member}`}>{ROLE_LABELS[m.role] || m.role}</span>
                    <span className={`text-[9px] font-bold capitalize ${STATUS_COL[m.status]}`}>● {m.status}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-extrabold text-green-600">{fmt(m.savings_balance)}</p>
                  <p className="text-[9px] text-slate-400">savings</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Registration form ── */}
      {addStep === "form" && (
        <ModalWrap onClose={closeAddFlow}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Register Member</h3>
          <p className="text-xs text-slate-400 mb-4">Fill in the member's details. Login credentials will be emailed to them automatically.</p>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            {[["Full Name *","full_name","text","John Adeyemi"],
              ["Email Address *","email","email","john@email.com"],
              ["Phone Number","phone","tel","08012345678"],
              ["Home Address","address","text","Street address"],
              ["Occupation","occupation","text","Trader"],
              ["Next of Kin Name","next_of_kin","text","Mary Adeyemi"],
              ["Next of Kin Phone","next_of_kin_phone","tel","08098765432"],
            ].map(([label, key, type, ph]) => (
              <div key={key}>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{label}</label>
                <input className={input} type={type} value={form[key]} onChange={set(key)} placeholder={ph} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Gender</label>
                <select className={input} value={form.gender} onChange={set("gender")}>
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Role *</label>
                <select className={input} value={form.role} onChange={set("role")}>
                  {ALL_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date of Birth</label>
                <input className={input} type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date Joined</label>
                <input className={input} type="date" value={form.joined_date} onChange={set("joined_date")} />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={closeAddFlow} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleAdd} disabled={loading} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{loading ? "Creating…" : "Continue →"}</button>
          </div>
        </ModalWrap>
      )}

      {pendingReg && !addStep && (
        <ModalWrap onClose={closeAddFlow}>
          <div className="text-center mb-5">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Member Account Created</h3>
            <p className="text-xs text-slate-400">Credentials emailed to {pendingReg.name}</p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-700/40 rounded-2xl p-4 mb-3">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email</span>
              <span className="text-xs font-bold text-slate-800 dark:text-white break-all text-right max-w-[65%]">{pendingReg.email}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Temp Password</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-green-600 font-mono tracking-wider">{pendingReg.temp_password}</span>
                <button
                  onClick={() => navigator.clipboard?.writeText(pendingReg.temp_password)}
                  className="text-[10px] font-bold text-green-600 border border-green-300 dark:border-green-700 rounded-lg px-2 py-1 active:scale-95 transition-transform">
                  Copy
                </button>
              </div>
            </div>
          </div>

          <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 rounded-xl px-3 py-2.5 mb-4">
            <p className="text-[11px] text-green-700 dark:text-green-300 font-medium">
              Login credentials have been sent to {pendingReg.email}. When they log in for the first time, they will verify their email and set a new password.
            </p>
          </div>

          <button onClick={closeAddFlow} className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm">Done</button>
        </ModalWrap>
      )}

      {/* Credentials modal — shown after password reset only */}
      {creds && (
        <ModalWrap onClose={() => setCreds(null)}>
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Password Reset!</h3>
            <p className="text-xs text-slate-400 mb-5">Share these new credentials with {creds.name}</p>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-4 mb-3 text-left">
              <p className="text-[10px] font-bold text-green-500 uppercase tracking-wider mb-3">Login Credentials</p>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">Email</span>
                <span className="text-xs font-bold text-slate-800 dark:text-white break-all text-right max-w-[65%]">{creds.email}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Temp Password</span>
                <span className="text-base font-extrabold text-green-600 font-mono tracking-wider">{creds.temp_password}</span>
              </div>
            </div>
            <button onClick={() => navigator.clipboard?.writeText(`Email: ${creds.email}\nPassword: ${creds.temp_password}`)}
              className="w-full py-2.5 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 rounded-xl font-bold text-sm mb-2">
              Copy Credentials
            </button>
            <button onClick={() => setCreds(null)} className="w-full py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm">Done</button>
          </div>
        </ModalWrap>
      )}

      {/* Member detail modal */}
      {selected && !editing && (
        <ModalWrap onClose={() => { setSelected(null); setError(""); }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center text-xl font-extrabold text-green-600">{selected.full_name?.charAt(0)}</div>
            <div>
              <p className="text-base font-extrabold text-slate-800 dark:text-white">{selected.full_name}</p>
              <p className="text-xs text-slate-400 font-mono">{selected.membership_id}</p>
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-3 mb-4 grid grid-cols-2 gap-2">
            {[["Role", ROLE_LABELS[selected.role] || selected.role], ["Status", selected.status],
              ["Phone", selected.phone || "—"], ["Email", selected.email || "—"],
              ["Gender", selected.gender || "—"], ["Occupation", selected.occupation || "—"],
              ["Date of Birth", selected.date_of_birth ? fmtDate(selected.date_of_birth) : "—"],
              ["Next of Kin", selected.next_of_kin || "—"],
              ["Joined", fmtDate(selected.joined_date)], ["Savings", fmt(selected.savings_balance)]].map(([k, v]) => (
              <div key={k}><p className="text-[10px] text-slate-400">{k}</p><p className="text-xs font-bold text-slate-800 dark:text-white capitalize">{v}</p></div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => openEdit(selected)} className="w-full py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-sm">Edit Member</button>
            <button onClick={() => { if (window.confirm(`Reset password for ${selected.full_name}?`)) handleResetPassword(selected); }}
              disabled={saving} className="w-full py-2.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl font-bold text-sm">Reset Password</button>
            {selected.status !== "suspended" && selected.status !== "removed" && (
              <button onClick={() => { const r = prompt("Reason for suspension?"); if (r !== null) handleStatus(selected, "suspended", r); }}
                disabled={saving} className="w-full py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-bold text-sm">Suspend</button>
            )}
            {selected.status === "suspended" && (
              <button onClick={() => handleStatus(selected, "active")} disabled={saving}
                className="w-full py-2.5 bg-green-50 text-green-700 border border-green-200 rounded-xl font-bold text-sm">Reactivate</button>
            )}
            {selected.status !== "removed" && (
              <button onClick={() => { if (window.confirm("Remove this member permanently?")) handleStatus(selected, "removed"); }}
                disabled={saving} className="w-full py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-sm">Remove Member</button>
            )}
            <button onClick={() => setSelected(null)} className="w-full py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Close</button>
          </div>
        </ModalWrap>
      )}

      {/* Edit member modal */}
      {editing && selected && (
        <ModalWrap onClose={() => { setEditing(false); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Edit Member</h3>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            {[["Full Name","full_name","text"],["Phone","phone","tel"],["Email","email","email"],
              ["Address","address","text"],["Occupation","occupation","text"],
              ["Next of Kin","next_of_kin","text"],["Next of Kin Phone","next_of_kin_phone","tel"],
            ].map(([label,key,type]) => (
              <div key={key}>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{label}</label>
                <input className={input} type={type} value={form[key]} onChange={set(key)} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Gender</label>
                <select className={input} value={form.gender} onChange={set("gender")}>
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Role</label>
                <select className={input} value={form.role} onChange={set("role")}>
                  {ALL_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date of Birth</label>
                <input className={input} type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date Joined</label>
                <input className={input} type="date" value={form.joined_date} onChange={set("joined_date")} />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => { setEditing(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleEdit} disabled={saving} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button>
          </div>
        </ModalWrap>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  PROGRAMS TAB
// ═══════════════════════════════════════════════════
function ProgramsTab({ org, onRefresh }) {
  const [programs, setPrograms] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showAdd,  setShowAdd]  = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [form,     setForm]     = useState({ name: "", description: "", contribution_type: "fixed", amount: "", frequency: "monthly", due_day: "", target_amount: "" });
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const load = useCallback(() => {
    coopFn("get-programs", { org_id: org.id }).then(r => setPrograms(r.programs || [])).finally(() => setLoading(false));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const resetForm = () => setForm({ name: "", description: "", contribution_type: "fixed", amount: "", frequency: "monthly", due_day: "", target_amount: "" });

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Program name required"); return; }
    setSaving(true); setError("");
    try {
      if (editing) {
        await coopFn("update-program", { program_id: editing.id, ...form });
      } else {
        await coopFn("add-program", { org_id: org.id, ...form });
      }
      setShowAdd(false); setEditing(null); resetForm(); load(); onRefresh();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (program) => {
    if (!window.confirm(`Delete program "${program.name}"? This won't delete existing records.`)) return;
    await coopFn("delete-program", { program_id: program.id });
    load();
  };

  const handleToggleStatus = async (program) => {
    const newStatus = program.status === "active" ? "paused" : "active";
    await coopFn("update-program", { program_id: program.id, status: newStatus });
    load();
  };

  const openEdit = (p) => {
    setForm({ name: p.name, description: p.description || "", contribution_type: p.contribution_type || "fixed",
      amount: String(p.amount || ""), frequency: p.frequency || "monthly",
      due_day: String(p.due_day || ""), target_amount: String(p.target_amount || "") });
    setEditing(p);
    setShowAdd(true);
  };

  const STATUS_BG = { active: "bg-green-100 text-green-700", paused: "bg-amber-100 text-amber-700", closed: "bg-red-100 text-red-600" };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{programs.filter(p => p.status === "active").length} active programs</p>
        <button onClick={() => { resetForm(); setEditing(null); setShowAdd(true); }}
          className="px-4 py-2.5 bg-green-600 text-white rounded-xl text-xs font-bold">+ New Program</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : programs.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center px-6">
            <span className="text-4xl mb-3">📋</span>
            <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">No Programs Yet</p>
            <p className="text-sm text-slate-400 mb-5">Create contribution programs like Welfare Fund, Development Levy, Building Fund etc.</p>
            <button onClick={() => setShowAdd(true)} className="px-5 py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm">Create Program</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mt-2">
            {programs.map(p => (
              <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-extrabold text-slate-800 dark:text-white">{p.name}</p>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${STATUS_BG[p.status] || STATUS_BG.active}`}>{p.status}</span>
                    </div>
                    {p.description && <p className="text-[11px] text-slate-400 line-clamp-1">{p.description}</p>}
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-lg capitalize">{FREQ_LABELS[p.frequency]}</span>
                      <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-lg capitalize">{p.contribution_type}</span>
                      {p.contribution_type === "fixed" && <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-lg">{fmt(p.amount)}</span>}
                    </div>
                  </div>
                  <div className="text-right ml-3 flex-shrink-0">
                    <p className="text-sm font-extrabold text-green-600">{fmt(p.total_collected)}</p>
                    <p className="text-[9px] text-slate-400">collected</p>
                    {p.target_amount > 0 && <p className="text-[9px] text-slate-400">of {fmt(p.target_amount)}</p>}
                  </div>
                </div>
                {p.target_amount > 0 && (
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mt-2">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(100, (p.total_collected / p.target_amount) * 100)}%` }} />
                  </div>
                )}
                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                  <button onClick={() => openEdit(p)} className="flex-1 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-lg">Edit</button>
                  <button onClick={() => handleToggleStatus(p)} className="flex-1 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">
                    {p.status === "active" ? "Pause" : "Activate"}
                  </button>
                  <button onClick={() => handleDelete(p)} className="flex-1 py-1.5 text-xs font-bold text-red-600 bg-red-50 rounded-lg">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <ModalWrap onClose={() => { setShowAdd(false); setEditing(null); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">{editing ? "Edit Program" : "New Contribution Program"}</h3>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Program Name *</label>
              <input className={input} value={form.name} onChange={set("name")} placeholder="e.g. Welfare Fund" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Description</label>
              <textarea className={input} rows={2} value={form.description} onChange={set("description")} placeholder="What is this fund for?" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Type</label>
                <select className={input} value={form.contribution_type} onChange={set("contribution_type")}>
                  <option value="fixed">Fixed Amount</option><option value="voluntary">Voluntary</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Frequency</label>
                <select className={input} value={form.frequency} onChange={set("frequency")}>
                  {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            {form.contribution_type === "fixed" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦)</label>
                  <input className={input} type="number" value={form.amount} onChange={set("amount")} placeholder="0" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Due Day</label>
                  <input className={input} type="number" value={form.due_day} onChange={set("due_day")} placeholder="e.g. 15 (of month)" min="1" max="31" />
                </div>
              </div>
            )}
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Target Amount (₦) — Optional</label>
              <input className={input} type="number" value={form.target_amount} onChange={set("target_amount")} placeholder="Fundraising goal" />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => { setShowAdd(false); setEditing(null); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : editing ? "Save Changes" : "Create Program"}</button>
          </div>
        </ModalWrap>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  FINANCE TAB (Savings + Withdrawals)
// ═══════════════════════════════════════════════════
function FinanceTab({ org, members, programs, onRefresh }) {
  const [subTab,       setSubTab]       = useState("contributions");
  const [savings,      setSavings]      = useState([]);
  const [withdrawals,  setWithdrawals]  = useState([]);
  const [wdRequests,   setWdRequests]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showRecord,   setShowRecord]   = useState(false);
  const [showWd,       setShowWd]       = useState(false);
  const [form,         setForm]         = useState({ member_id: "", amount: "", type: "deposit", payment_method: "cash", notes: "", program_id: "" });
  const [wdForm,       setWdForm]       = useState({ purpose: "", method: "equal", per_member_amount: "", authorized_by: "", notes: "", program_id: "" });
  const [saving,       setSaving]       = useState(false);
  const [handlingReq,  setHandlingReq]  = useState(null);
  const [error,        setError]        = useState("");
  const [viewSaving,   setViewSaving]   = useState(null);
  const [viewWd,       setViewWd]       = useState(null);
  const [viewReq,      setViewReq]      = useState(null);

  const set  = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const setW = k => e => setWdForm(p => ({ ...p, [k]: e.target.value }));

  const load = useCallback(() => {
    Promise.all([
      coopFn("get-savings", { org_id: org.id }),
      coopFn("get-withdrawals", { org_id: org.id }),
      coopFn("get-withdrawal-requests-admin", { org_id: org.id }),
    ]).then(([sr, wr, rr]) => {
      setSavings(sr.savings || []);
      setWithdrawals(wr.withdrawals || []);
      setWdRequests(rr.requests || []);
    }).finally(() => setLoading(false));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const handleRequest = async (req, decision) => {
    setHandlingReq(req.id);
    try {
      await coopFn("handle-withdrawal-request", { request_id: req.id, decision });
      load(); onRefresh();
    } catch (e) { alert(e.message || "Failed"); }
    finally { setHandlingReq(null); }
  };

  const activeMembers = members.filter(m => m.status === "active");
  const activePrograms = programs.filter(p => p.status === "active");

  const handleRecord = async () => {
    if (!form.member_id || !form.amount) { setError("Member and amount required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("record-saving", { org_id: org.id, ...form, amount: parseFloat(form.amount) });
      setShowRecord(false); setForm({ member_id: "", amount: "", type: "deposit", payment_method: "cash", notes: "", program_id: "" });
      load(); onRefresh();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleWithdraw = async () => {
    if (!wdForm.purpose) { setError("Purpose is required"); return; }
    if (wdForm.method === "equal" && !wdForm.per_member_amount) { setError("Amount per member required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("create-withdrawal", { org_id: org.id, ...wdForm,
        per_member_amount: parseFloat(wdForm.per_member_amount || "0") });
      setShowWd(false); setWdForm({ purpose: "", method: "equal", per_member_amount: "", authorized_by: "", notes: "", program_id: "" });
      load(); onRefresh();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 px-4 pt-4 pb-2">
        {[["contributions","Contributions"],["withdrawals","Withdrawals"],["requests","Member Requests"]].map(([id,label]) => {
          const pendingCount = id === "requests" ? wdRequests.filter(r => r.status === "pending").length : 0;
          return (
            <button key={id} onClick={() => setSubTab(id)} className="relative">
              <span className={`flex-1 block py-2 px-2 rounded-xl text-xs font-bold transition ${subTab === id ? "bg-green-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
                {label}
                {pendingCount > 0 && <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-black">{pendingCount}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {subTab === "contributions" && (
        <>
          <div className="px-4 pb-2 flex justify-end">
            <button onClick={() => setShowRecord(true)} className="px-4 py-2.5 bg-green-600 text-white rounded-xl text-xs font-bold">+ Record</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-24">
            {loading ? (
              <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : savings.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">No contributions recorded yet</div>
            ) : (
              <div className="flex flex-col gap-2">
                {savings.map(s => (
                  <button key={s.id} onClick={() => setViewSaving(s)}
                    className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex justify-between items-start w-full text-left active:scale-[0.98] transition-transform">
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white">{s.org_members?.full_name || "—"}</p>
                      {s.org_contribution_programs?.name && <p className="text-[10px] text-green-500 font-semibold">{s.org_contribution_programs.name}</p>}
                      <p className="text-[10px] text-slate-400">{fmtDT(s.created_at)} · {s.payment_method}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-extrabold ${s.type === "withdrawal" ? "text-red-500" : "text-green-600"}`}>
                        {s.type === "withdrawal" ? "−" : "+"}{fmt(s.amount)}
                      </p>
                      <p className="text-[10px] text-slate-400">Bal: {fmt(s.balance_after)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {subTab === "withdrawals" && (
        <>
          <div className="px-4 pb-2 flex justify-end">
            <button onClick={() => setShowWd(true)} className="px-4 py-2.5 bg-red-500 text-white rounded-xl text-xs font-bold">+ Withdraw from Members</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-24">
            {loading ? (
              <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-red-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : withdrawals.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">No withdrawals recorded yet</div>
            ) : (
              <div className="flex flex-col gap-2">
                {withdrawals.map(w => (
                  <button key={w.id} onClick={() => setViewWd(w)}
                    className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 w-full text-left active:scale-[0.98] transition-transform">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-white">{w.purpose}</p>
                        <p className="text-[10px] text-slate-400 capitalize">{w.method} · {w.member_count} members · {fmtDate(w.created_at)}</p>
                        {w.authorized_by && <p className="text-[10px] text-slate-400">Auth: {w.authorized_by}</p>}
                      </div>
                      <p className="text-sm font-extrabold text-red-500">−{fmt(w.total_amount)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {subTab === "requests" && (
        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-2">
          {loading ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : wdRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">No withdrawal requests yet</div>
          ) : (
            <div className="flex flex-col gap-2">
              {wdRequests.map(r => (
                <div key={r.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-sm font-extrabold text-slate-800 dark:text-white">{r.org_members?.full_name || "—"}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{r.org_members?.membership_id}</p>
                      <p className="text-[10px] text-slate-400">{fmtDT(r.created_at)}</p>
                      {r.reason && <p className="text-[11px] text-slate-500 mt-0.5 italic">"{r.reason}"</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-base font-extrabold text-amber-600">−{fmt(r.amount)}</p>
                      <span className={`text-[10px] font-bold capitalize ${r.status === "pending" ? "text-amber-500" : r.status === "approved" ? "text-green-600" : "text-red-500"}`}>
                        ● {r.status}
                      </span>
                    </div>
                  </div>
                  {r.status === "pending" ? (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleRequest(r, "reject")}
                        disabled={handlingReq === r.id}
                        className="flex-1 py-2 rounded-xl text-xs font-bold border border-red-200 text-red-500 disabled:opacity-50">
                        Reject
                      </button>
                      <button
                        onClick={() => handleRequest(r, "approve")}
                        disabled={handlingReq === r.id}
                        className="flex-1 py-2 rounded-xl text-xs font-bold bg-green-600 text-white disabled:opacity-50">
                        {handlingReq === r.id ? "Processing…" : "Approve"}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setViewReq(r)}
                      className="w-full mt-2 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 active:scale-[0.98] transition-transform">
                      View Receipt
                    </button>
                  )}
                  {r.admin_notes && (
                    <p className="text-[10px] text-slate-400 mt-1.5">Note: {r.admin_notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRecord && (
        <ModalWrap onClose={() => { setShowRecord(false); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Record Contribution</h3>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Member *</label>
              <select className={input} value={form.member_id} onChange={set("member_id")}>
                <option value="">Select member…</option>
                {activeMembers.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.membership_id})</option>)}
              </select>
            </div>
            {activePrograms.length > 0 && (
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Program (Optional)</label>
                <select className={input} value={form.program_id} onChange={set("program_id")}>
                  <option value="">— General —</option>
                  {activePrograms.map(p => <option key={p.id} value={p.id}>{p.name} ({fmt(p.amount)})</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Type</label>
                <select className={input} value={form.type} onChange={set("type")}>
                  <option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦) *</label>
                <input className={input} type="number" value={form.amount} onChange={set("amount")} placeholder="0" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Payment Method</label>
              <select className={input} value={form.payment_method} onChange={set("payment_method")}>
                {["cash","transfer","paystack","cheque"].map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Notes</label>
              <input className={input} value={form.notes} onChange={set("notes")} placeholder="Optional notes" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setShowRecord(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleRecord} disabled={saving} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : "Record"}</button>
          </div>
        </ModalWrap>
      )}

      {showWd && (
        <ModalWrap onClose={() => { setShowWd(false); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Withdraw from Members</h3>
          <p className="text-xs text-slate-400 mb-4">Deduct from member savings balances for an org expense</p>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Purpose / Reason *</label>
              <input className={input} value={wdForm.purpose} onChange={setW("purpose")} placeholder="e.g. Building levy payment" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Method</label>
              <select className={input} value={wdForm.method} onChange={setW("method")}>
                <option value="equal">Equal Distribution (deduct same amount from all active members)</option>
                <option value="individual">Individual (set per member — not yet available via portal)</option>
              </select>
            </div>
            {wdForm.method === "equal" && (
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount per Member (₦) *</label>
                <input className={input} type="number" value={wdForm.per_member_amount} onChange={setW("per_member_amount")} placeholder="0" />
                <p className="text-[10px] text-slate-400 mt-1">Will deduct from {activeMembers.length} active members → Total: {fmt(parseFloat(wdForm.per_member_amount || "0") * activeMembers.length)}</p>
              </div>
            )}
            {activePrograms.length > 0 && (
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Link to Program (Optional)</label>
                <select className={input} value={wdForm.program_id} onChange={setW("program_id")}>
                  <option value="">— None —</option>
                  {activePrograms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Authorized By</label>
              <input className={input} value={wdForm.authorized_by} onChange={setW("authorized_by")} placeholder="Treasurer name" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Notes</label>
              <textarea className={input} rows={2} value={wdForm.notes} onChange={setW("notes")} placeholder="Additional notes" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setShowWd(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleWithdraw} disabled={saving} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Processing…" : "Proceed"}</button>
          </div>
        </ModalWrap>
      )}

      {viewSaving && <CoopSavingReceipt saving={viewSaving} orgName={org.name} onClose={() => setViewSaving(null)} />}
      {viewWd && <CoopBulkWithdrawalReceipt withdrawal={viewWd} orgName={org.name} onClose={() => setViewWd(null)} />}
      {viewReq && <CoopWithdrawalRequestReceipt request={viewReq} orgName={org.name} onClose={() => setViewReq(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  LOANS TAB
// ═══════════════════════════════════════════════════
function calcLoan(principal, rate, months) {
  const totalInterest     = principal * (rate / 100);
  const totalRepayable    = principal + totalInterest;
  const monthlyInstallment = totalRepayable / Math.max(1, months);
  return { totalInterest, totalRepayable, monthlyInstallment };
}

function LoansTab({ org, members, onRefresh }) {
  const defaultRate    = org.default_loan_interest_rate ?? 10;
  const [loans,        setLoans]        = useState([]);
  const [repayments,   setRepayments]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showApply,    setShowApply]    = useState(false);
  const [selected,     setSelected]     = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject,   setShowReject]   = useState(false);
  const [repayForm,    setRepayForm]    = useState({ amount: "", payment_method: "cash" });
  const [rateEdit,     setRateEdit]     = useState(false);
  const [rateVal,      setRateVal]      = useState(String(defaultRate));
  const [form, setForm] = useState({
    member_id: "", amount_requested: "", interest_rate: String(defaultRate),
    loan_purpose: "", repayment_months: "12",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const load = useCallback(() => {
    coopFn("get-loans", { org_id: org.id })
      .then(r => setLoans(r.loans || []))
      .finally(() => setLoading(false));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const loadRepayments = useCallback((loanId) => {
    coopFn("get-repayments", { loan_id: loanId }).then(r => setRepayments(r.repayments || []));
  }, []);

  const set  = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const setR = k => e => setRepayForm(p => ({ ...p, [k]: e.target.value }));

  // Live preview calculation in form
  const principal = parseFloat(form.amount_requested) || 0;
  const rate      = parseFloat(form.interest_rate) || 0;
  const months    = parseInt(form.repayment_months) || 1;
  const preview   = calcLoan(principal, rate, months);

  const handleSaveRate = async () => {
    await coopFn("update-loan-settings", { org_id: org.id, default_loan_interest_rate: parseFloat(rateVal) || 0 });
    setRateEdit(false); onRefresh();
  };

  const handleApply = async () => {
    if (!form.member_id || !form.amount_requested) { setError("Member and amount required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("apply-loan", { org_id: org.id, ...form, applied_by: "admin" });
      setShowApply(false);
      setForm({ member_id: "", amount_requested: "", interest_rate: String(defaultRate), loan_purpose: "", repayment_months: "12" });
      load();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleLoanAction = async (loan, newStatus, extra = {}) => {
    setSaving(true); setError("");
    try {
      await coopFn("update-loan", {
        loan_id: loan.id, org_id: org.id, status: newStatus,
        amount_approved: loan.amount_requested, approved_by_name: "Admin", ...extra,
      });
      setSelected(null); setShowReject(false); setRejectReason(""); load(); onRefresh();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleRepay = async () => {
    if (!repayForm.amount) { setError("Amount required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("record-repayment", {
        org_id: org.id, loan_id: selected.id, member_id: selected.member_id,
        amount: parseFloat(repayForm.amount), payment_method: repayForm.payment_method,
      });
      setRepayForm({ amount: "", payment_method: "cash" });
      load(); onRefresh();
      loadRepayments(selected.id);
      setSelected(prev => prev ? { ...prev, outstanding_balance: Math.max(0, (prev.outstanding_balance || 0) - parseFloat(repayForm.amount)) } : null);
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleCheckOverdue = async () => {
    try { await coopFn("check-overdue-loans", { org_id: org.id }); }
    catch { /* silent */ }
  };

  const openLoan = (l) => { setSelected(l); setRepayForm({ amount: "", payment_method: "cash" }); setError(""); loadRepayments(l.id); };
  const closeSelected = () => { setSelected(null); setRepayments([]); setError(""); setShowReject(false); setRejectReason(""); };

  const activeMembers = members.filter(m => m.status === "active");
  const pendingLoans  = loans.filter(l => l.status === "pending");
  const activeLoans   = loans.filter(l => l.status === "disbursed");
  const today         = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
          {pendingLoans.length} pending · {activeLoans.length} active
        </p>
        <div className="flex gap-2">
          <button onClick={handleCheckOverdue} title="Send overdue alerts"
            className="px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 border border-red-200 dark:border-red-800 rounded-xl text-xs font-bold">
            ⚠ Overdue
          </button>
          <button onClick={() => setShowApply(true)} className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-bold">+ New Loan</button>
        </div>
      </div>

      {/* Default interest rate setting */}
      <div className="mx-4 mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Default Interest Rate</p>
          {rateEdit ? (
            <div className="flex items-center gap-2 mt-1">
              <input value={rateVal} onChange={e => setRateVal(e.target.value)} type="number" min="0" step="0.5"
                className="w-20 px-2 py-1 rounded-lg border border-amber-300 text-sm font-bold bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
              <span className="text-sm font-bold text-amber-700">%</span>
              <button onClick={handleSaveRate} className="px-3 py-1 bg-amber-500 text-white rounded-lg text-xs font-bold">Save</button>
              <button onClick={() => setRateEdit(false)} className="px-2 py-1 text-slate-500 text-xs">Cancel</button>
            </div>
          ) : (
            <p className="text-sm font-extrabold text-amber-700 dark:text-amber-300">{defaultRate}% per loan</p>
          )}
        </div>
        {!rateEdit && (
          <button onClick={() => { setRateEdit(true); setRateVal(String(defaultRate)); }}
            className="text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1">
            Edit
          </button>
        )}
      </div>

      {/* Loan list */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : loans.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No loans yet</div>
        ) : (
          <div className="flex flex-col gap-2">
            {loans.map(l => {
              const isOverdue = l.status === "disbursed" && l.due_date && l.due_date < today;
              return (
                <button key={l.id} onClick={() => openLoan(l)}
                  className={`bg-white dark:bg-slate-800 rounded-xl p-3 border flex justify-between items-start text-left w-full ${isOverdue ? "border-red-300 dark:border-red-700" : "border-slate-100 dark:border-slate-700"}`}>
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-white">{l.org_members?.full_name || "—"}</p>
                    <p className="text-[10px] text-slate-400">{l.loan_purpose || "General"} · {fmtDate(l.applied_at)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-bold capitalize ${STATUS_COL[l.status]}`}>● {l.status}</span>
                      {isOverdue && <span className="text-[9px] font-black text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">OVERDUE</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold text-amber-600">{fmt(l.amount_requested)}</p>
                    {l.outstanding_balance > 0 && <p className="text-[10px] text-red-500">Due: {fmt(l.outstanding_balance)}</p>}
                    {(l.monthly_installment > 0) && <p className="text-[10px] text-slate-400">{fmt(l.monthly_installment)}/mo</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* New loan modal */}
      {showApply && (
        <ModalWrap onClose={() => { setShowApply(false); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">New Loan Application</h3>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Member *</label>
              <select className={input} value={form.member_id} onChange={set("member_id")}>
                <option value="">Select member…</option>
                {activeMembers.map(m => <option key={m.id} value={m.id}>{m.full_name} ({m.membership_id})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦) *</label>
                <input className={input} type="number" value={form.amount_requested} onChange={set("amount_requested")} placeholder="0" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Interest (%)</label>
                <input className={input} type="number" value={form.interest_rate} onChange={set("interest_rate")} placeholder="0" step="0.5" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Repay Months</label>
                <input className={input} type="number" value={form.repayment_months} onChange={set("repayment_months")} placeholder="12" min="1" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Purpose</label>
                <input className={input} value={form.loan_purpose} onChange={set("loan_purpose")} placeholder="Business…" />
              </div>
            </div>
            {principal > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2">Loan Summary</p>
                <div className="grid grid-cols-3 gap-2">
                  {[["Interest", fmt(preview.totalInterest)], ["Total Repayable", fmt(preview.totalRepayable)], ["Monthly", fmt(preview.monthlyInstallment)]].map(([k, v]) => (
                    <div key={k} className="text-center">
                      <p className="text-[9px] text-amber-600 dark:text-amber-500">{k}</p>
                      <p className="text-xs font-extrabold text-amber-800 dark:text-amber-300">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setShowApply(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleApply} disabled={saving} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Creating…" : "Submit"}</button>
          </div>
        </ModalWrap>
      )}

      {/* Loan detail modal */}
      {selected && (
        <ModalWrap onClose={closeSelected}>
          <div className="flex justify-between mb-3">
            <div>
              <p className="text-base font-extrabold text-slate-800 dark:text-white">{selected.org_members?.full_name}</p>
              <p className="text-xs text-slate-400">{selected.loan_purpose || "General loan"}</p>
            </div>
            <span className={`text-xs font-bold capitalize px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 ${STATUS_COL[selected.status]}`}>{selected.status}</span>
          </div>

          {/* Loan breakdown */}
          <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-3 mb-3 grid grid-cols-2 gap-2">
            {[
              ["Principal", fmt(selected.amount_requested)],
              ["Interest", `${selected.interest_rate}% (${fmt(selected.total_interest || 0)})`],
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

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}

          {/* Actions by status */}
          {selected.status === "pending" && !showReject && (
            <div className="flex gap-2 mb-3">
              <button onClick={() => handleLoanAction(selected, "approved")} disabled={saving}
                className="flex-1 py-2.5 bg-green-50 text-green-700 border border-green-200 rounded-xl font-bold text-sm">✓ Approve</button>
              <button onClick={() => setShowReject(true)} disabled={saving}
                className="flex-1 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-sm">✕ Reject</button>
            </div>
          )}
          {selected.status === "pending" && showReject && (
            <div className="mb-3">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Rejection Reason</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2}
                placeholder="Reason for rejection…"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm resize-none mb-2" />
              <div className="flex gap-2">
                <button onClick={() => setShowReject(false)} className="flex-1 py-2 border border-slate-200 dark:border-slate-600 text-slate-600 rounded-xl font-bold text-sm">Back</button>
                <button onClick={() => handleLoanAction(selected, "rejected", { rejection_reason: rejectReason })} disabled={saving}
                  className="flex-1 py-2 bg-red-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "…" : "Confirm Reject"}</button>
              </div>
            </div>
          )}

          {selected.status === "approved" && (
            <div className="mb-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
              <p className="text-xs font-bold text-blue-700 dark:text-blue-400 mb-2">Disburse funds to member</p>
              <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-3">
                Disbursing will deduct <strong>{fmt(selected.amount_approved || selected.amount_requested)}</strong> from the org wallet and credit it to the member's savings account.
              </p>
              <button onClick={() => handleLoanAction(selected, "disbursed", { repayment_months: selected.repayment_months })} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Processing…" : "Disburse Loan →"}</button>
            </div>
          )}

          {selected.status === "disbursed" && selected.outstanding_balance > 0 && (
            <div className="mb-3">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Record Repayment (Cash/Bank)</p>
              <div className="flex gap-2 mb-2">
                <input value={repayForm.amount} onChange={setR("amount")} type="number" placeholder={`e.g. ${fmt(selected.monthly_installment || 0)}`}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                <select value={repayForm.payment_method} onChange={setR("payment_method")}
                  className="px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-xs">
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank</option>
                  <option value="paystack">Paystack</option>
                </select>
                <button onClick={handleRepay} disabled={saving} className="px-4 py-2 bg-amber-500 text-white rounded-xl font-bold text-sm">{saving ? "…" : "Pay"}</button>
              </div>
              <p className="text-[10px] text-slate-400">Monthly target: {fmt(selected.monthly_installment || 0)} · Pay any amount, meet target by month end</p>
            </div>
          )}

          {/* Repayment history */}
          {repayments.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Repayment History</p>
              <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
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

          <button onClick={closeSelected}
            className="w-full py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Close</button>
        </ModalWrap>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  BROADCAST STATION TAB (org dashboard)
// ═══════════════════════════════════════════════════
function BroadcastTab({ org, members }) {
  const [broadcasts,       setBroadcasts]       = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [filter,           setFilter]           = useState("all");
  const [showTypePicker,   setShowTypePicker]   = useState(false);
  const [createType,       setCreateType]       = useState(null);
  const [form,             setForm]             = useState({});
  const [saving,           setSaving]           = useState(false);
  const [error,            setError]            = useState("");
  const [attendanceTarget, setAttendanceTarget] = useState(null);
  const [present,          setPresent]          = useState(new Set());
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [pollOptions,      setPollOptions]      = useState(["", ""]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mtgR, annR, evtR, pollR] = await Promise.all([
        coopFn("get-meetings",      { org_id: org.id }),
        coopFn("get-announcements", { org_id: org.id }),
        coopFn("get-events",        { org_id: org.id }),
        coopFn("get-polls",         { org_id: org.id }),
      ]);
      const items = [
        ...(mtgR.meetings      || []).map(m => ({ ...m, _type: "meeting",      _date: m.scheduled_at })),
        ...(annR.announcements || []).map(a => ({ ...a, _type: "announcement", _date: a.created_at   })),
        ...(evtR.events        || []).map(e => ({ ...e, _type: "event",        _date: e.event_date   })),
        ...(pollR.polls        || []).map(p => ({ ...p, _type: "poll",         _date: p.created_at   })),
      ].sort((a, b) => new Date(b._date) - new Date(a._date));
      setBroadcasts(items);
    } finally { setLoading(false); }
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const setF = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const FILTER_TABS = [
    { id: "all",          label: "All"           },
    { id: "meeting",      label: "Meetings"      },
    { id: "announcement", label: "Announcements" },
    { id: "event",        label: "Events"        },
    { id: "poll",         label: "Polls"         },
  ];
  const TYPE_OPTIONS = [
    { id: "meeting",      label: "Meeting",      icon: "📅", desc: "Schedule a meeting"    },
    { id: "announcement", label: "Announcement", icon: "📢", desc: "Send an announcement"  },
    { id: "event",        label: "Event",        icon: "🎉", desc: "Create an event"       },
    { id: "poll",         label: "Poll",         icon: "📊", desc: "Run a poll"            },
  ];
  const TYPE_COLORS = {
    meeting:      { bg: "bg-[#0D2040]", text: "text-white", label: "Meeting"      },
    announcement: { bg: "bg-amber-500",  text: "text-white", label: "Announcement" },
    event:        { bg: "bg-[#00A651]",  text: "text-white", label: "Event"        },
    poll:         { bg: "bg-purple-600", text: "text-white", label: "Poll"         },
  };

  const openCreate = (type) => {
    setCreateType(type); setShowTypePicker(false); setError("");
    if (type === "meeting")      setForm({ title: "", description: "", meeting_type: "general", format: "physical", scheduled_at: "", location: "", meeting_link: "", agenda: "" });
    else if (type === "announcement") setForm({ type: "announcement", title: "", body: "" });
    else if (type === "event")   setForm({ title: "", description: "", event_type: "event", event_date: "", end_date: "", location: "", event_link: "" });
    else if (type === "poll")  { setForm({ question: "", closes_at: "" }); setPollOptions(["", ""]); }
  };

  const handleCreate = async () => {
    setSaving(true); setError("");
    try {
      if (createType === "meeting") {
        if (!form.title || !form.scheduled_at) { setError("Title and date required"); setSaving(false); return; }
        await coopFn("create-meeting", { org_id: org.id, ...form });
      } else if (createType === "announcement") {
        if (!form.title || !form.body) { setError("Title and content required"); setSaving(false); return; }
        await coopFn("send-announcement", { org_id: org.id, ...form });
      } else if (createType === "event") {
        if (!form.title || !form.event_date) { setError("Title and date required"); setSaving(false); return; }
        await coopFn("create-event", { org_id: org.id, ...form });
      } else if (createType === "poll") {
        const opts = pollOptions.filter(o => o.trim());
        if (!form.question || opts.length < 2) { setError("Question and at least 2 options required"); setSaving(false); return; }
        await coopFn("create-poll", { org_id: org.id, question: form.question, options: opts, closes_at: form.closes_at || null });
      }
      setCreateType(null); load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const openAttendance = async (meeting) => {
    setAttendanceTarget(meeting);
    const { attendance: att } = await coopFn("get-attendance", { meeting_id: meeting.id });
    setPresent(new Set((att || []).filter(a => a.status === "present").map(a => a.member_id)));
  };
  const togglePresence = id => setPresent(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const submitAttendance = async () => {
    setSavingAttendance(true);
    const activeIds = members.filter(m => m.status === "active").map(m => m.id);
    await coopFn("bulk-attendance", { meeting_id: attendanceTarget.id, org_id: org.id,
      present_ids: activeIds.filter(id =>  present.has(id)),
      absent_ids:  activeIds.filter(id => !present.has(id)) });
    setAttendanceTarget(null); load(); setSavingAttendance(false);
  };

  const activeMembers = members.filter(m => m.status === "active");
  const visible = filter === "all" ? broadcasts : broadcasts.filter(b => b._type === filter);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{visible.length} item{visible.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowTypePicker(true)} className="px-4 py-2.5 rounded-xl text-xs font-bold text-white" style={{ background: "#00A651" }}>+ Broadcast</button>
      </div>

      {/* Filter tabs */}
      <div className="px-4 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {FILTER_TABS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${filter === f.id ? "text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"}`}
            style={filter === f.id ? { background: "#0D2040" } : {}}>{f.label}</button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-t-transparent rounded-full animate-spin" style={{ borderColor: "#00A651", borderTopColor: "transparent" }} /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <span className="text-5xl mb-4">📡</span>
            <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">No broadcasts yet</p>
            <p className="text-sm text-slate-400">Tap "+ Broadcast" to publish something.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 pt-1">
            {visible.map(item => {
              const tc = TYPE_COLORS[item._type];
              return (
                <div key={item.id} className="bg-white dark:bg-slate-800 rounded-2xl p-3.5 border border-slate-100 dark:border-slate-700">
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`flex-shrink-0 text-[9px] font-extrabold px-2 py-0.5 rounded-full mt-0.5 ${tc.bg} ${tc.text}`}>{tc.label}</span>
                    <p className="text-sm font-bold text-slate-800 dark:text-white leading-snug">{item.title || item.question}</p>
                  </div>
                  <p className="text-[10px] text-slate-400 mb-1.5">{fmtDT(item._date)}</p>

                  {item._type === "meeting" && item.location    && <p className="text-[10px] text-slate-400">📍 {item.location}</p>}
                  {item._type === "meeting" && item.meeting_link && <p className="text-[10px] text-green-500">🔗 Virtual link</p>}
                  {item._type === "event"   && item.location    && <p className="text-[10px] text-slate-400">📍 {item.location}</p>}
                  {item._type === "event"   && item.end_date    && <p className="text-[10px] text-slate-400">Until {fmtDT(item.end_date)}</p>}
                  {item._type === "announcement" && item.body && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{item.body}</p>
                  )}

                  {item._type === "poll" && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      {(item.options || []).map((opt, i) => {
                        const votes = (item.vote_counts || {})[i] || 0;
                        const total = item.total_votes || 0;
                        const pct   = total > 0 ? Math.round(votes / total * 100) : 0;
                        return (
                          <div key={i} className="relative bg-slate-100 dark:bg-slate-700 rounded-lg overflow-hidden">
                            <div className="absolute inset-0 rounded-lg" style={{ width: `${pct}%`, background: "#00A65125" }} />
                            <div className="relative px-2.5 py-1.5 flex justify-between">
                              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{opt}</span>
                              <span className="text-[10px] text-slate-400">{pct}% ({votes})</span>
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-[10px] text-slate-400 mt-0.5">{item.total_votes || 0} votes · {item.is_active ? "Active" : "Closed"}</p>
                    </div>
                  )}

                  {item._type === "meeting" && (
                    <div className="mt-2.5 flex gap-2">
                      <button onClick={() => openAttendance(item)}
                        className="flex-1 py-1.5 rounded-xl text-[10px] font-bold text-white" style={{ background: "#0D2040" }}>
                        Mark Attendance
                      </button>
                      {item.meeting_link && (
                        <a href={item.meeting_link} target="_blank" rel="noreferrer"
                          className="px-3 py-1.5 rounded-xl text-[10px] font-bold text-white" style={{ background: "#00A651" }}>Join</a>
                      )}
                    </div>
                  )}
                  {item._type === "event" && (
                    <button onClick={async () => { try { await coopFn("delete-event", { org_id: org.id, event_id: item.id }); load(); } catch (e) { alert(e.message); } }}
                      className="mt-2 text-[10px] font-bold text-red-400">Delete event</button>
                  )}
                  {item._type === "poll" && (
                    <button onClick={async () => { try { await coopFn("delete-poll", { org_id: org.id, poll_id: item.id }); load(); } catch (e) { alert(e.message); } }}
                      className="mt-2 text-[10px] font-bold text-red-400">Delete poll</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Type picker sheet */}
      {showTypePicker && (
        <ModalWrap onClose={() => setShowTypePicker(false)}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">What would you like to broadcast?</h3>
          <div className="grid grid-cols-2 gap-3">
            {TYPE_OPTIONS.map(t => (
              <button key={t.id} onClick={() => openCreate(t.id)}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-slate-100 dark:border-slate-700 hover:border-green-400 transition">
                <span className="text-3xl">{t.icon}</span>
                <p className="text-sm font-extrabold text-slate-800 dark:text-white">{t.label}</p>
                <p className="text-[10px] text-slate-400 text-center">{t.desc}</p>
              </button>
            ))}
          </div>
        </ModalWrap>
      )}

      {/* Create form */}
      {createType && (
        <ModalWrap onClose={() => { setCreateType(null); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">
            {createType === "meeting" ? "Schedule Meeting" : createType === "announcement" ? "Send Announcement" : createType === "event" ? "Create Event" : "Create Poll"}
          </h3>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3 max-h-[55vh] overflow-y-auto">

            {createType === "meeting" && (<>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Title *</label>
                <input className={input} value={form.title||""} onChange={setF("title")} placeholder="Monthly General Meeting" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Type</label>
                  <select className={input} value={form.meeting_type||"general"} onChange={setF("meeting_type")}>
                    {["general","board","special","agm"].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Format</label>
                  <select className={input} value={form.format||"physical"} onChange={setF("format")}>
                    <option value="physical">Physical</option><option value="virtual">Virtual</option><option value="hybrid">Hybrid</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date & Time *</label>
                <input className={input} type="datetime-local" value={form.scheduled_at||""} onChange={setF("scheduled_at")} />
              </div>
              {(form.format==="physical"||form.format==="hybrid") && (
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Venue</label>
                  <input className={input} value={form.location||""} onChange={setF("location")} placeholder="Community Hall" />
                </div>
              )}
              {(form.format==="virtual"||form.format==="hybrid") && (
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Meeting Link</label>
                  <input className={input} type="url" value={form.meeting_link||""} onChange={setF("meeting_link")} placeholder="https://meet.google.com/..." />
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Agenda</label>
                <textarea className={input} rows={3} value={form.agenda||""} onChange={setF("agenda")} placeholder={"1. Call to order\n2. Review minutes\n3. New business"} />
              </div>
            </>)}

            {createType === "announcement" && (<>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Title *</label>
                <input className={input} value={form.title||""} onChange={setF("title")} placeholder="Important Notice" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Type</label>
                <select className={input} value={form.type||"announcement"} onChange={setF("type")}>
                  <option value="announcement">Announcement</option>
                  <option value="notice">Notice</option>
                  <option value="circular">Circular</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Content *</label>
                <textarea className={input} rows={4} value={form.body||""} onChange={setF("body")} placeholder="Write your announcement here..." />
              </div>
            </>)}

            {createType === "event" && (<>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Title *</label>
                <input className={input} value={form.title||""} onChange={setF("title")} placeholder="Annual General Meeting 2026" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Event Type</label>
                <select className={input} value={form.event_type||"event"} onChange={setF("event_type")}>
                  {["event","workshop","training","social","fundraiser"].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Description</label>
                <textarea className={input} rows={3} value={form.description||""} onChange={setF("description")} placeholder="Tell members what to expect..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Start Date *</label>
                  <input className={input} type="datetime-local" value={form.event_date||""} onChange={setF("event_date")} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">End Date</label>
                  <input className={input} type="datetime-local" value={form.end_date||""} onChange={setF("end_date")} />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Location</label>
                <input className={input} value={form.location||""} onChange={setF("location")} placeholder="Community Hall / Online" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Event Link</label>
                <input className={input} type="url" value={form.event_link||""} onChange={setF("event_link")} placeholder="https://..." />
              </div>
            </>)}

            {createType === "poll" && (<>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Question *</label>
                <input className={input} value={form.question||""} onChange={setF("question")} placeholder="What day works best for our meeting?" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Options (min 2) *</label>
                {pollOptions.map((opt, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input className={`${input} flex-1`} value={opt} onChange={e => { const a = [...pollOptions]; a[i] = e.target.value; setPollOptions(a); }} placeholder={`Option ${i+1}`} />
                    {pollOptions.length > 2 && (
                      <button onClick={() => setPollOptions(p => p.filter((_, j) => j !== i))} className="px-2 text-red-400 font-bold text-lg">×</button>
                    )}
                  </div>
                ))}
                {pollOptions.length < 6 && (
                  <button onClick={() => setPollOptions(p => [...p, ""])} className="text-[11px] font-bold text-green-600 mt-1">+ Add option</button>
                )}
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Closes At (optional)</label>
                <input className={input} type="datetime-local" value={form.closes_at||""} onChange={setF("closes_at")} />
              </div>
            </>)}

          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setCreateType(null); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="flex-1 py-3 text-white rounded-xl font-bold text-sm disabled:opacity-50" style={{ background: "#00A651" }}>
              {saving ? "Publishing…" : "Publish"}
            </button>
          </div>
        </ModalWrap>
      )}

      {/* Attendance sheet */}
      {attendanceTarget && (
        <div className="fixed inset-0 z-[75] bg-slate-900/80 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[90vh] flex flex-col">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <p className="text-base font-extrabold text-slate-800 dark:text-white mb-0.5">{attendanceTarget.title}</p>
            <p className="text-xs text-slate-400 mb-3">{fmtDT(attendanceTarget.scheduled_at)}</p>
            <p className="text-xs text-slate-400 mb-2">Tap to mark present/absent</p>
            <div className="flex-1 overflow-y-auto">
              {activeMembers.map(m => (
                <button key={m.id} onClick={() => togglePresence(m.id)}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl border-2 mb-1.5 transition ${present.has(m.id) ? "border-green-400 bg-green-50 dark:bg-green-900/20" : "border-slate-200 dark:border-slate-600"}`}>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${present.has(m.id) ? "bg-green-500 border-green-500" : "border-slate-300"}`}>
                    {present.has(m.id) && <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="white" strokeWidth={3} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </div>
                  <p className="flex-1 text-left text-sm font-semibold text-slate-800 dark:text-white">{m.full_name}</p>
                  <span className={`text-[10px] font-bold ${present.has(m.id) ? "text-green-600" : "text-slate-400"}`}>{present.has(m.id) ? "Present" : "Absent"}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
              <p className="text-xs text-slate-500">{present.size} present / {activeMembers.length - present.size} absent</p>
              <div className="flex gap-2">
                <button onClick={() => setAttendanceTarget(null)} className="px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
                <button onClick={submitAttendance} disabled={savingAttendance} className="px-4 py-2.5 text-white rounded-xl font-bold text-sm disabled:opacity-50" style={{ background: "#0D2040" }}>
                  {savingAttendance ? "Saving…" : "Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// ── Delete Org Button (confirm by typing name) ────────────────
function DeleteOrgButton({ org, onDeleted }) {
  const [confirm, setConfirm] = useState(false);
  const [typed,   setTyped]   = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error,   setError]   = useState("");

  const handleDelete = async () => {
    if (typed.trim().toLowerCase() !== org.name.trim().toLowerCase()) {
      setError("Organisation name does not match"); return;
    }
    setDeleting(true); setError("");
    try {
      await coopFn("delete-org", { org_id: org.id, owner_id: org.owner_id });
      onDeleted();
    } catch (e) { setError(e.message || "Delete failed"); setDeleting(false); }
  };

  if (!confirm) {
    return (
      <button onClick={() => setConfirm(true)}
        className="w-full py-3 border-2 border-red-300 text-red-600 rounded-xl font-bold text-sm hover:bg-red-50 transition-colors">
        Delete Organisation
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>}
      <p className="text-xs text-slate-600 dark:text-slate-300">
        Type <strong className="text-red-600">{org.name}</strong> to confirm deletion:
      </p>
      <input
        className="w-full px-3 py-2.5 rounded-xl border-2 border-red-300 bg-red-50 dark:bg-red-900/20 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        placeholder={org.name}
        value={typed}
        onChange={e => setTyped(e.target.value)}
      />
      <div className="flex gap-2">
        <button onClick={() => { setConfirm(false); setTyped(""); setError(""); }}
          className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
        <button onClick={handleDelete} disabled={deleting}
          className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
          {deleting ? "Deleting…" : "Confirm Delete"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  SETTINGS TAB
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
//  PAYSTACK BANK ACCOUNT SETUP (inside Settings)
// ═══════════════════════════════════════════════════
function OrgBankSetupSection({ org, onRefresh }) {
  const [banks,       setBanks]       = useState([]);
  const [bankForm,    setBankForm]    = useState({ bank_code: "", account_number: "" });
  const [verifying,   setVerifying]   = useState(false);
  const [resolvedName,setResolvedName]= useState("");
  const [creating,    setCreating]    = useState(false);
  const [bankError,   setBankError]   = useState("");
  const [bankSuccess, setBankSuccess] = useState("");
  const [showBankForm,setShowBankForm]= useState(false);

  useEffect(() => {
    coopFn("list-banks", {}).catch(() => null)
      .then(r => setBanks(r?.banks || [])).catch(() => null);
  }, []);

  const handleVerify = async () => {
    if (!bankForm.bank_code || bankForm.account_number.length !== 10) {
      setBankError("Select a bank and enter a 10-digit account number"); return;
    }
    setVerifying(true); setBankError(""); setResolvedName("");
    try {
      const r = await coopFn("resolve-bank-account", { bank_code: bankForm.bank_code, account_number: bankForm.account_number });
      setResolvedName(r.account_name || "");
      if (!r.account_name) setBankError("Account not found — check number and bank");
    } catch (e) { setBankError(e.message || "Could not verify account"); }
    finally { setVerifying(false); }
  };

  const handleSetupBank = async () => {
    if (!resolvedName) { setBankError("Verify your account first"); return; }
    setCreating(true); setBankError(""); setBankSuccess("");
    try {
      await coopFn("setup-org-bank", {
        org_id: org.id, owner_id: org.owner_id,
        bank_code: bankForm.bank_code, account_number: bankForm.account_number,
      });
      setBankSuccess("Bank account linked successfully!");
      setShowBankForm(false); setBankForm({ bank_code: "", account_number: "" }); setResolvedName("");
      onRefresh();
    } catch (e) { setBankError(e.message || "Failed to link bank account"); }
    finally { setCreating(false); }
  };

  const hasBank = !!org.paystack_subaccount_code;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
      <div className="flex justify-between items-center mb-1">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Paystack Bank Account</p>
        {hasBank && (
          <button onClick={() => { setShowBankForm(v => !v); setBankError(""); setBankSuccess(""); setResolvedName(""); }}
            className="text-[10px] font-bold text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-lg">
            {showBankForm ? "Cancel" : "Update"}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Link a bank account to receive member contributions directly via Paystack.
      </p>

      {bankError && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{bankError}</div>}
      {bankSuccess && <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3 text-xs text-green-700">✓ {bankSuccess}</div>}

      {hasBank && !showBankForm ? (
        <div className="space-y-1.5">
          <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-2 text-xs text-green-700 font-semibold">
            ✓ Paystack subaccount active — members can pay directly
          </div>
          {[["Account Name", org.account_name], ["Account Number", org.account_number],
            ["Subaccount Code", org.paystack_subaccount_code]].map(([k, v]) => (
            <div key={k} className="flex justify-between items-center py-1 border-b border-slate-50 dark:border-slate-700/50 last:border-0">
              <span className="text-[10px] text-slate-400">{k}</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 font-mono">{v || "—"}</span>
            </div>
          ))}
        </div>
      ) : (showBankForm || !hasBank) ? (
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Bank *</label>
            <select className={input} value={bankForm.bank_code}
              onChange={e => { setBankForm(p => ({ ...p, bank_code: e.target.value })); setResolvedName(""); setBankError(""); }}>
              <option value="">Select bank…</option>
              {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Account Number *</label>
            <div className="flex gap-2">
              <input className={input} value={bankForm.account_number} maxLength={10}
                onChange={e => { setBankForm(p => ({ ...p, account_number: e.target.value.replace(/\D/g,"") })); setResolvedName(""); setBankError(""); }}
                placeholder="10-digit account number" />
              <button onClick={handleVerify} disabled={verifying || bankForm.account_number.length !== 10}
                className="px-3 py-2.5 bg-slate-700 text-white rounded-xl text-xs font-bold whitespace-nowrap disabled:opacity-50">
                {verifying ? "…" : "Verify"}
              </button>
            </div>
          </div>
          {resolvedName && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs">
              <span className="text-slate-500">Account Name: </span>
              <strong className="text-green-700">{resolvedName}</strong>
            </div>
          )}
          <button onClick={handleSetupBank} disabled={creating || !resolvedName}
            className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {creating ? "Linking…" : hasBank ? "Update Bank Account" : "Link Bank Account"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const ORG_FAQS = [
  { q: "How do I add members to my organisation?", a: "Go to Members → tap the '+' button. You can invite members via phone number or email. They'll receive an OTP to join." },
  { q: "How do savings contributions work?", a: "Create a savings program under Programs. Members enrol and contribute on a schedule (daily/weekly/monthly). Contributions show in Finance → Savings." },
  { q: "How do loans work for my members?", a: "Members can request loans from the Loans section. You review and approve or reject each request. Repayments track automatically against the balance." },
  { q: "How do I set up Paystack for online payments?", a: "Go to Settings → scroll to Bank Account Setup. Enter your Paystack subaccount code. Members can then pay contributions and loan repayments online." },
  { q: "How can members access the member portal?", a: "In Settings, scroll to Member Portal Login and tap 'Setup Portal Login'. This creates a login for members to access their own portal via their phone/email." },
  { q: "How do I broadcast a message to all members?", a: "Use the Broadcast tab (More menu). Type your message and it's delivered to all active members in-app and optionally via email." },
  { q: "How do I manage loan applications?", a: "New loan requests appear in the Loans tab with a 'Pending' status. Tap a request to review details, then Approve or Reject. Members are notified instantly." },
  { q: "How do I create a savings program?", a: "Go to Programs → tap 'New Program'. Set the name, contribution amount, frequency, and duration. Members can then enrol from their portal." },
];

function OrgSupportSection({ org }) {
  const [view,       setView]    = useState("menu"); // menu | ticket | faq
  const [category,   setCategory]= useState("General");
  const [subject,    setSubject] = useState("");
  const [message,    setMessage] = useState("");
  const [saving,     setSaving]  = useState(false);
  const [ticketRef,  setTicketRef]= useState("");
  const [error,      setError]   = useState("");
  const [openFaq,    setOpenFaq] = useState(null);

  const CATEGORIES = ["General", "Billing", "Members", "Loans", "Technical"];

  const submit = async () => {
    if (!subject.trim() || !message.trim()) { setError("Please fill in subject and message"); return; }
    setSaving(true); setError("");
    try {
      const r = await coopFn("submit-org-support-ticket", { org_id: org.id, category, subject: subject.trim(), message: message.trim() });
      if (r.error) throw new Error(r.error);
      setTicketRef(r.ticket_ref);
      setView("done");
    } catch (e) { setError(e.message || "Failed to submit ticket"); }
    setSaving(false);
  };

  const reset = () => { setView("menu"); setSubject(""); setMessage(""); setCategory("General"); setTicketRef(""); setError(""); };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#f0fdf4" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#00A651" strokeWidth={2} strokeLinecap="round" className="w-4.5 h-4.5">
            <path d="M18 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zM9 9h6M9 13h6M9 17h4"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-slate-800 dark:text-white">Support & FAQ</p>
          <p className="text-[11px] text-slate-400">Get help or raise a ticket</p>
        </div>
        {view !== "menu" && (
          <button onClick={reset} className="text-[12px] font-bold text-[#00A651] active:opacity-70">Back</button>
        )}
      </div>

      {/* Menu */}
      {view === "menu" && (
        <div className="flex divide-x divide-slate-100 dark:divide-slate-700">
          <button onClick={() => setView("ticket")}
            className="flex-1 flex flex-col items-center gap-2 py-5 active:bg-slate-50 dark:active:bg-slate-700/50 transition-colors">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#dcfce7" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#00A651" strokeWidth={2} strokeLinecap="round" className="w-5 h-5">
                <path d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/>
              </svg>
            </div>
            <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200">Raise a Ticket</span>
          </button>
          <button onClick={() => setView("faq")}
            className="flex-1 flex flex-col items-center gap-2 py-5 active:bg-slate-50 dark:active:bg-slate-700/50 transition-colors">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#dbeafe" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" className="w-5 h-5">
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/>
              </svg>
            </div>
            <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200">FAQ</span>
          </button>
        </div>
      )}

      {/* Raise Ticket */}
      {view === "ticket" && (
        <div className="p-4 flex flex-col gap-3">
          {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 text-xs text-red-600 dark:text-red-400">{error}</div>}
          <div>
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${category === c ? "bg-[#00A651] text-white border-[#00A651]" : "bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-slate-600"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief description of your issue"
              className="w-full bg-slate-50 dark:bg-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-white outline-none border border-slate-200 dark:border-slate-600 focus:border-[#00A651]" />
          </div>
          <div>
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Describe your issue in detail…"
              className="w-full bg-slate-50 dark:bg-slate-700 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-white outline-none resize-none border border-slate-200 dark:border-slate-600 focus:border-[#00A651]" />
          </div>
          <button onClick={submit} disabled={saving || !subject.trim() || !message.trim()}
            className="w-full py-3 bg-[#00A651] text-white rounded-xl font-bold text-sm disabled:opacity-50 active:opacity-80">
            {saving ? "Submitting…" : "Submit Ticket"}
          </button>
        </div>
      )}

      {/* Success */}
      {view === "done" && (
        <div className="p-6 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "#dcfce7" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#00A651" strokeWidth={2.5} strokeLinecap="round" className="w-7 h-7"><path d="M5 13l4 4L19 7"/></svg>
          </div>
          <p className="text-base font-extrabold text-slate-800 dark:text-white">Ticket Submitted!</p>
          <div className="bg-slate-50 dark:bg-slate-700 rounded-xl px-4 py-2.5">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Reference</p>
            <p className="text-lg font-extrabold text-[#00A651] tracking-widest">{ticketRef}</p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">A confirmation has been sent to your email. Our support team will get back to you shortly.</p>
          <button onClick={reset} className="mt-1 px-5 py-2.5 bg-[#00A651] text-white rounded-xl font-bold text-sm active:opacity-80">Done</button>
        </div>
      )}

      {/* FAQ */}
      {view === "faq" && (
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {ORG_FAQS.map((item, i) => (
            <div key={i}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-slate-50 dark:active:bg-slate-700/50">
                <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 leading-snug">{item.q}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
                  className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform ${openFaq === i ? "rotate-180" : ""}`}>
                  <path d="M19 9l-7 7-7-7"/>
                </svg>
              </button>
              {openFaq === i && (
                <p className="px-4 pb-3.5 text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">{item.a}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab({ org, onRefresh, onOrgUpdate, onBack, isOrgPortal = false, isDark = false, onToggleDark }) {
  const [leaders,       setLeaders]       = useState([]);
  const [form,          setForm]          = useState({ name: org.name || "", email: org.email || "", phone: org.phone || "", address: org.address || "", state_name: org.state_name || "", lga: org.lga || "", purpose: org.purpose || "", vision: org.vision || "", mission: org.mission || "", website: org.website || "", social_instagram: org.social_instagram || "", social_facebook: org.social_facebook || "", social_twitter: org.social_twitter || "", date_established: org.date_established || "", logo_url: org.logo_url || "" });
  const [logoUploading, setLogoUploading] = useState(false);
  const logoFileRef                        = useRef(null);
  const [lForm,       setLForm]       = useState({ name: "", position: "", phone: "", email: "", sort_order: "0" });
  const [saving,      setSaving]      = useState(false);
  const [lSaving,     setLSaving]     = useState(false);
  const [editL,       setEditL]       = useState(null);
  const [showAddL,    setShowAddL]    = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [error,       setError]       = useState("");
  const [portalSaving, setPortalSaving] = useState(false);
  const [portalResult, setPortalResult] = useState(null);
  const [portalError,  setPortalError]  = useState("");

  const set  = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const setL = k => e => setLForm(p => ({ ...p, [k]: e.target.value }));

  const loadLeaders = useCallback(() => {
    coopFn("get-leaders", { org_id: org.id }).then(r => setLeaders(r.leaders || []));
  }, [org.id]);
  useEffect(() => { loadLeaders(); }, [loadLeaders]);

  const handleSaveOrg = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      const result = await coopFn("update-org", { org_id: org.id, ...form });
      if (result?.org) onOrgUpdate?.(result.org);
      setSaved(true); onRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleSaveLeader = async () => {
    if (!lForm.name.trim() || !lForm.position.trim()) { setError("Name and position required"); return; }
    setLSaving(true); setError("");
    try {
      if (editL) { await coopFn("update-leader", { leader_id: editL.id, ...lForm }); }
      else        { await coopFn("add-leader",    { org_id: org.id, ...lForm }); }
      setShowAddL(false); setEditL(null); setLForm({ name: "", position: "", phone: "", email: "", sort_order: "0" }); loadLeaders();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setLSaving(false); }
  };

  const handleDeleteLeader = async (l) => {
    if (!window.confirm(`Remove ${l.name}?`)) return;
    await coopFn("delete-leader", { leader_id: l.id }); loadLeaders();
  };

  const openEditLeader = (l) => {
    setLForm({ name: l.name, position: l.position, phone: l.phone || "", email: l.email || "", sort_order: String(l.sort_order || 0) });
    setEditL(l); setShowAddL(true);
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setLogoUploading(true);
    try {
      const ext  = file.name.split(".").pop() || "jpg";
      const path = `orgs/${org.id}/${Date.now()}.${ext}`;
      const { data, error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(data.path);
      setForm(p => ({ ...p, logo_url: publicUrl }));
    } catch (e) { setError(e.message || "Upload failed"); }
    setLogoUploading(false);
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24 flex flex-col gap-5">
      {/* Account */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 flex items-center gap-3">
        {(form.logo_url || org.logo_url)
          ? <img src={form.logo_url || org.logo_url} alt="" className="w-12 h-12 rounded-xl object-cover ring-2 ring-green-200 flex-shrink-0" />
          : <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: "linear-gradient(145deg,#00A651,#0D2040)" }}>
              <span>{org.type === "cooperative" ? "🤝" : "🏢"}</span>
            </div>
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{org.name}</p>
          <p className="text-[10px] text-slate-400 font-mono">{org.reg_number}</p>
        </div>
        <button onClick={onBack}
          className="flex-shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-red-500 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-xl active:opacity-75 transition-opacity">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign Out
        </button>
      </div>
      {/* Theme toggle */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: isDark ? "#0D2040" : "#f0fdf4" }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5" stroke={isDark ? "#00A651" : "#0D2040"} strokeWidth={2} strokeLinecap="round">
              {isDark
                ? <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                : <><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /></>
              }
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{isDark ? "Dark Mode" : "Light Mode"}</p>
            <p className="text-[10px] text-slate-400">Tap to switch</p>
          </div>
        </div>
        <button onClick={onToggleDark}
          className="w-12 h-6 rounded-full transition-all relative flex-shrink-0"
          style={{ background: isDark ? "#00A651" : "#e2e8f0" }}>
          <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform absolute top-0.5 ${isDark ? "translate-x-[26px]" : "translate-x-0.5"}`} />
        </button>
      </div>

      {/* Org Profile */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-4">Organisation Profile</p>
        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
        {saved && <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3 text-xs text-green-600">✓ Saved successfully</div>}
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Organisation Name</label>
            <input className={input} value={form.name} onChange={set("name")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Email</label>
              <input className={input} type="email" value={form.email} onChange={set("email")} placeholder="org@example.com" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Phone</label>
              <input className={input} type="tel" value={form.phone} onChange={set("phone")} placeholder="08000000000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">State</label>
              <input className={input} value={form.state_name} onChange={set("state_name")} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">LGA</label>
              <input className={input} value={form.lga} onChange={set("lga")} />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Address</label>
            <input className={input} value={form.address} onChange={set("address")} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Organisation Logo / Photo</label>
            <div className="flex items-center gap-4">
              {form.logo_url
                ? <img src={form.logo_url} alt="logo" className="w-16 h-16 rounded-xl object-cover border border-slate-200 flex-shrink-0" />
                : <div className="w-16 h-16 rounded-xl bg-green-50 border border-slate-200 flex items-center justify-center text-2xl flex-shrink-0">
                    {org.type === "cooperative" ? "🤝" : "🏢"}
                  </div>
              }
              <div className="flex flex-col gap-2">
                <button onClick={() => logoFileRef.current?.click()} disabled={logoUploading}
                  className="text-xs font-bold text-blue-600 border border-blue-200 bg-blue-50 px-3 py-2 rounded-xl active:bg-blue-100 disabled:opacity-50">
                  {logoUploading ? "Uploading…" : "Upload Photo"}
                </button>
                {form.logo_url && (
                  <button onClick={() => setForm(p => ({ ...p, logo_url: "" }))}
                    className="text-xs text-red-500 font-medium text-left">Remove photo</button>
                )}
              </div>
            </div>
            <input ref={logoFileRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Purpose</label>
            <textarea className={input} rows={2} value={form.purpose} onChange={set("purpose")} placeholder="What does this organisation do?" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vision Statement</label>
            <textarea className={input} rows={2} value={form.vision} onChange={set("vision")} placeholder="Our vision is…" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Mission Statement</label>
            <textarea className={input} rows={2} value={form.mission} onChange={set("mission")} placeholder="Our mission is…" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date Established</label>
            <input className={input} type="date" value={form.date_established} onChange={set("date_established")} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Website</label>
            <input className={input} value={form.website} onChange={set("website")} placeholder="https://..." type="url" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[["Instagram","social_instagram","@handle"],["Facebook","social_facebook","Page name"],["Twitter","social_twitter","@handle"]].map(([label,key,ph]) => (
              <div key={key}>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{label}</label>
                <input className={input} value={form[key]} onChange={set(key)} placeholder={ph} />
              </div>
            ))}
          </div>
        </div>
        <button onClick={handleSaveOrg} disabled={saving} className="w-full mt-4 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : "Save Profile"}</button>
      </div>

      {/* Key Leaders */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Key Leaders & Executives</p>
          <button onClick={() => { setLForm({ name: "", position: "", phone: "", email: "", sort_order: String(leaders.length) }); setEditL(null); setShowAddL(true); }}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold">+ Add</button>
        </div>
        {leaders.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No leaders added yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {leaders.map(l => (
              <div key={l.id} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
                <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center text-sm font-extrabold text-green-600 flex-shrink-0">{l.name?.charAt(0)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{l.name}</p>
                  <p className="text-[10px] text-slate-400">{l.position}</p>
                  {l.phone && <p className="text-[10px] text-slate-400">{l.phone}</p>}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => openEditLeader(l)} className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-lg">Edit</button>
                  <button onClick={() => handleDeleteLeader(l)} className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded-lg">Del</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Organisation Portal Login */}
      {!isOrgPortal && <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Organisation Portal Login</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Grant this organisation its own login so it can manage members and savings independently from this portal.
        </p>
        {portalError && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{portalError}</div>}

        {!org.email && !form.email.trim() ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 text-xs text-amber-700">
            ⚠ Please add an organisation email above and save the profile before setting up a portal login.
          </div>
        ) : (
          <>
            <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
              <span className="text-[10px] text-slate-400 uppercase font-bold w-14 flex-shrink-0">Email</span>
              <span className="text-xs text-slate-700 dark:text-slate-200 font-mono">{form.email || org.email}</span>
            </div>
            {org.portal_user_id && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3 text-xs text-green-700">
                ✓ Portal login is active. The organisation can sign in using their email.
              </div>
            )}
            {portalResult && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-3">
                <p className="text-[11px] font-bold text-green-400 uppercase tracking-wider mb-2">Portal Created ✓</p>
                <p className="text-xs text-slate-600 mb-1">Send these credentials to the organisation:</p>
                <div className="bg-white rounded-xl p-3 border border-green-100 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold w-20">Email</span>
                    <span className="text-xs font-mono text-slate-800">{portalResult.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold w-20">Temp Password</span>
                    <span className="text-xs font-mono font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-lg">{portalResult.temp_password}</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-2">A welcome email has been sent. They'll be prompted to change their password on first login.</p>
              </div>
            )}
            <button
              onClick={async () => {
                setPortalSaving(true); setPortalError(""); setPortalResult(null);
                try {
                  const r = await coopFn("setup-org-portal", { org_id: org.id, owner_id: org.owner_id });
                  setPortalResult(r); onRefresh();
                } catch (e) { setPortalError(e.message || "Setup failed"); }
                finally { setPortalSaving(false); }
              }}
              disabled={portalSaving}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50"
            >
              {portalSaving ? "Setting up…" : org.portal_user_id ? "Reset Portal Login" : "Setup Portal Login"}
            </button>
          </>
        )}
      </div>}

      {/* Paystack Bank Account */}
      <OrgBankSetupSection org={org} onRefresh={onRefresh} />

      {/* Support & FAQ */}
      <OrgSupportSection org={org} />

      {/* Danger Zone */}
      {!isOrgPortal && <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-red-100 dark:border-red-900/40">
        <p className="text-[11px] font-bold text-red-400 uppercase tracking-wider mb-1">Danger Zone</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Permanently delete this organisation and all its data — members, savings, loans, and meetings. This cannot be undone.
        </p>
        <DeleteOrgButton org={org} onDeleted={onBack} />
      </div>}

      {showAddL && (
        <ModalWrap onClose={() => { setShowAddL(false); setEditL(null); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">{editL ? "Edit Leader" : "Add Leader"}</h3>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            {[["Full Name *","name","text"],["Position *","position","text"],["Phone","phone","tel"],["Email","email","email"]].map(([label,key,type]) => (
              <div key={key}>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{label}</label>
                <input className={input} type={type} value={lForm[key]} onChange={setL(key)} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => { setShowAddL(false); setEditL(null); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleSaveLeader} disabled={lSaving} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{lSaving ? "Saving…" : editL ? "Save" : "Add Leader"}</button>
          </div>
        </ModalWrap>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  BILLS TAB (org portal only — no print services)
// ═══════════════════════════════════════════════════
function BillsTab({ org, autoService = null, onAutoOpened = null, adminEmail = null }) {
  const [bills, setBills] = useState([]);
  const [loadingBills, setLoadingBills] = useState(true);

  useEffect(() => {
    coopFn("get-org-bills", { org_id: org.id })
      .then(r => setBills(r.bills || []))
      .catch(() => setBills([]))
      .finally(() => setLoadingBills(false));
  }, [org.id]);

  const addTransaction = useCallback(async (payload) => {
    try {
      const r = await coopFn("add-org-bill", { org_id: org.id, ...payload });
      if (r.bill) setBills(prev => [r.bill, ...prev]);
    } catch (e) {
      console.error("Failed to save org bill:", e);
    }
  }, [org.id]);

  const store = useMemo(() => ({
    transactions: bills,
    addTransaction,
    profile: { email: org.email, owner_name: org.name, business_name: org.name, id: org.id },
  }), [bills, addTransaction, org.email, org.name, org.id]);

  if (loadingBills) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BillPayments
      store={store}
      plan=""
      markup={1.098}
      pointsEnabled
      excludeCats={["print-airtime", "print-data"]}
      businessName={org.name}
      staffEmail={adminEmail || undefined}
      autoService={autoService}
      onAutoOpened={onAutoOpened}
    />
  );
}

// ═══════════════════════════════════════════════════
//  ORG PROFILE TAB (org portal — replaces Settings)
// ═══════════════════════════════════════════════════
function OrgProfileTab({ org, onRefresh, onOrgUpdate }) {
  const [leaders,       setLeaders]       = useState([]);
  const [form,          setForm]          = useState({ name: org.name || "", email: org.email || "", phone: org.phone || "", address: org.address || "", state_name: org.state_name || "", lga: org.lga || "", purpose: org.purpose || "", vision: org.vision || "", mission: org.mission || "", website: org.website || "", social_instagram: org.social_instagram || "", social_facebook: org.social_facebook || "", social_twitter: org.social_twitter || "", date_established: org.date_established || "", logo_url: org.logo_url || "" });
  const [logoUploading, setLogoUploading] = useState(false);
  const logoFileRef                        = useRef(null);
  const [lForm,    setLForm]    = useState({ name: "", position: "", phone: "", email: "", sort_order: "0" });
  const [saving,   setSaving]   = useState(false);
  const [lSaving,  setLSaving]  = useState(false);
  const [editL,    setEditL]    = useState(null);
  const [showAddL, setShowAddL] = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState("");

  const set  = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const setL = k => e => setLForm(p => ({ ...p, [k]: e.target.value }));

  const loadLeaders = useCallback(() => {
    coopFn("get-leaders", { org_id: org.id }).then(r => setLeaders(r.leaders || []));
  }, [org.id]);
  useEffect(() => { loadLeaders(); }, [loadLeaders]);

  const handleSaveOrg = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      const result = await coopFn("update-org", { org_id: org.id, ...form });
      if (result?.org) onOrgUpdate?.(result.org);
      setSaved(true); onRefresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleSaveLeader = async () => {
    if (!lForm.name.trim() || !lForm.position.trim()) { setError("Name and position required"); return; }
    setLSaving(true); setError("");
    try {
      if (editL) { await coopFn("update-leader", { leader_id: editL.id, ...lForm }); }
      else        { await coopFn("add-leader",    { org_id: org.id, ...lForm }); }
      setShowAddL(false); setEditL(null); setLForm({ name: "", position: "", phone: "", email: "", sort_order: "0" }); loadLeaders();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setLSaving(false); }
  };

  const handleDeleteLeader = async (l) => {
    if (!window.confirm(`Remove ${l.name}?`)) return;
    await coopFn("delete-leader", { leader_id: l.id }); loadLeaders();
  };

  const openEditLeader = (l) => {
    setLForm({ name: l.name, position: l.position, phone: l.phone || "", email: l.email || "", sort_order: String(l.sort_order || 0) });
    setEditL(l); setShowAddL(true);
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setLogoUploading(true);
    try {
      const ext  = file.name.split(".").pop() || "jpg";
      const path = `orgs/${org.id}/${Date.now()}.${ext}`;
      const { data, error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(data.path);
      setForm(p => ({ ...p, logo_url: publicUrl }));
    } catch (e) { setError(e.message || "Upload failed"); }
    setLogoUploading(false);
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24 flex flex-col gap-5">
      {/* Org identity */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 flex items-center gap-3">
        {(form.logo_url || org.logo_url)
          ? <img src={form.logo_url || org.logo_url} alt="" className="w-12 h-12 rounded-xl object-cover ring-2 ring-green-200 flex-shrink-0" />
          : <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: "linear-gradient(145deg,#00A651,#0D2040)" }}>
              <span>{org.type === "cooperative" ? "🤝" : "🏢"}</span>
            </div>
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{org.name}</p>
          <p className="text-[10px] text-slate-400 font-mono">{org.reg_number}</p>
        </div>
      </div>

      {/* Org Profile */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-4">Organisation Profile</p>
        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
        {saved && <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-3 text-xs text-green-600">✓ Saved successfully</div>}
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Organisation Name</label>
            <input className={input} value={form.name} onChange={set("name")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Email</label>
              <input className={input} type="email" value={form.email} onChange={set("email")} placeholder="org@example.com" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Phone</label>
              <input className={input} type="tel" value={form.phone} onChange={set("phone")} placeholder="08000000000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">State</label>
              <input className={input} value={form.state_name} onChange={set("state_name")} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">LGA</label>
              <input className={input} value={form.lga} onChange={set("lga")} />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Address</label>
            <input className={input} value={form.address} onChange={set("address")} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Organisation Logo / Photo</label>
            <div className="flex items-center gap-4">
              {form.logo_url
                ? <img src={form.logo_url} alt="logo" className="w-16 h-16 rounded-xl object-cover border border-slate-200 flex-shrink-0" />
                : <div className="w-16 h-16 rounded-xl bg-green-50 border border-slate-200 flex items-center justify-center text-2xl flex-shrink-0">
                    {org.type === "cooperative" ? "🤝" : "🏢"}
                  </div>
              }
              <div className="flex flex-col gap-2">
                <button onClick={() => logoFileRef.current?.click()} disabled={logoUploading}
                  className="text-xs font-bold text-blue-600 border border-blue-200 bg-blue-50 px-3 py-2 rounded-xl active:bg-blue-100 disabled:opacity-50">
                  {logoUploading ? "Uploading…" : "Upload Photo"}
                </button>
                {form.logo_url && (
                  <button onClick={() => setForm(p => ({ ...p, logo_url: "" }))}
                    className="text-xs text-red-500 font-medium text-left">Remove photo</button>
                )}
              </div>
            </div>
            <input ref={logoFileRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Purpose</label>
            <textarea className={input} rows={2} value={form.purpose} onChange={set("purpose")} placeholder="What does this organisation do?" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vision Statement</label>
            <textarea className={input} rows={2} value={form.vision} onChange={set("vision")} placeholder="Our vision is…" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Mission Statement</label>
            <textarea className={input} rows={2} value={form.mission} onChange={set("mission")} placeholder="Our mission is…" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date Established</label>
            <input className={input} type="date" value={form.date_established} onChange={set("date_established")} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Website</label>
            <input className={input} value={form.website} onChange={set("website")} placeholder="https://..." type="url" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[["Instagram","social_instagram","@handle"],["Facebook","social_facebook","Page name"],["Twitter","social_twitter","@handle"]].map(([label,key,ph]) => (
              <div key={key}>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{label}</label>
                <input className={input} value={form[key]} onChange={set(key)} placeholder={ph} />
              </div>
            ))}
          </div>
        </div>
        <button onClick={handleSaveOrg} disabled={saving} className="w-full mt-4 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : "Save Profile"}</button>
      </div>

      {/* Key Leaders */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Key Leaders & Executives</p>
          <button onClick={() => { setLForm({ name: "", position: "", phone: "", email: "", sort_order: String(leaders.length) }); setEditL(null); setShowAddL(true); }}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold">+ Add</button>
        </div>
        {leaders.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No leaders added yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {leaders.map(l => (
              <div key={l.id} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
                <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center text-sm font-extrabold text-green-600 flex-shrink-0">{l.name?.charAt(0)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{l.name}</p>
                  <p className="text-[10px] text-slate-400">{l.position}</p>
                  {l.phone && <p className="text-[10px] text-slate-400">{l.phone}</p>}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => openEditLeader(l)} className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-lg">Edit</button>
                  <button onClick={() => handleDeleteLeader(l)} className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded-lg">Del</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Paystack Bank Account */}
      <OrgBankSetupSection org={org} onRefresh={onRefresh} />

      {showAddL && (
        <ModalWrap onClose={() => { setShowAddL(false); setEditL(null); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">{editL ? "Edit Leader" : "Add Leader"}</h3>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            {[["Full Name *","name","text"],["Position *","position","text"],["Phone","phone","tel"],["Email","email","email"]].map(([label,key,type]) => (
              <div key={key}>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{label}</label>
                <input className={input} type={type} value={lForm[key]} onChange={setL(key)} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => { setShowAddL(false); setEditL(null); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleSaveLeader} disabled={lSaving} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{lSaving ? "Saving…" : editL ? "Save" : "Add Leader"}</button>
          </div>
        </ModalWrap>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  ORG PORTAL SUPPORT TAB
// ═══════════════════════════════════════════════════
function OrgPortalSupportTab({ org }) {
  return (
    <div className="flex-1 overflow-y-auto pb-24">
      <div className="px-4 pt-5 pb-2">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Support & FAQ</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Get help or submit a support ticket</p>
      </div>
      <div className="px-4">
        <OrgSupportSection org={org} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  NAVIGATION STRUCTURE
// ═══════════════════════════════════════════════════

// Bottom nav (org portal) — labels injected via t() at render time
function makeMainTabs(t) {
  return [
    { id: "overview",  label: t("coop.overview"), icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { id: "members",   label: t("coop.members"),  icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
    { id: "finance",   label: t("coop.finance"),  icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "loans",     label: t("coop.loans"),    icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
    { id: "messages",  label: t("coop.chat"),     icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  ];
}

function makeMoreTabs(t) {
  return [
    { id: "programs",  label: t("coop.programs"),  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",          color: "#059669" },
    { id: "broadcast", label: t("coop.broadcast"), icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",                                                   color: "#0f766e" },
    { id: "bills",     label: t("coop.bills"),     icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",                                                   color: "#00A651", orgOnly: true },
    { id: "profile",   label: t("coop.profile"),   icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", color: "#0ea5e9" },
    { id: "support",   label: t("coop.support"),   icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "#7c3aed" },
  ];
}

function makeTabs(t) {
  return [
    { id: "overview",  label: t("coop.overview"),  icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { id: "members",   label: t("coop.members"),   icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
    { id: "programs",  label: t("coop.programs"),  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { id: "finance",   label: t("coop.finance"),   icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    { id: "loans",     label: t("coop.loans"),     icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
    { id: "broadcast", label: t("coop.broadcast"), icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
    { id: "messages",  label: t("coop.messages"),  icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
    { id: "settings",  label: t("coop.settings"),  icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
    { id: "bills",     label: t("coop.bills"),     icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 14l2 2 4-4", orgOnly: true },
  ];
}

const ORG_TYPE_ICONS = { cooperative:"🤝", market_association:"🏪", church:"⛪", ngo:"🌍", youth_group:"👥", savings_group:"💰", community_group:"🏘️", professional_association:"💼", savings_club:"🏦" };

// ═══════════════════════════════════════════════════
//  MAIN DASHBOARD
// ═══════════════════════════════════════════════════
export default function CoopDashboard({ org: initialOrg, onBack, isOrgPortal = false, adminEmail = null }) {
  const t = useT();
  const MAIN_TABS = useMemo(() => makeMainTabs(t), [t]);
  const MORE_TABS = useMemo(() => makeMoreTabs(t), [t]);
  const TABS      = useMemo(() => makeTabs(t),     [t]);

  const { isDark, toggle: toggleDark } = useTheme();
  const [tab,           setTab]           = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const ref = p.get("bill_ref") || p.get("trxref") || p.get("reference");
    if (ref && localStorage.getItem(`ck_bill_pending_${ref}`)) return "bills";
    if (Object.keys(localStorage).some(k => k.startsWith("ck_bill_pending_"))) return "bills";
    return "overview";
  });
  const [org,           setOrg]           = useState(initialOrg);
  const [members,       setMembers]       = useState([]);
  const [wallet,        setWallet]        = useState(null);
  const [programs,      setPrograms]      = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loans,         setLoans]         = useState([]);
  const [wdRequests,    setWdRequests]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [showMore,      setShowMore]      = useState(false);
  const [billsAutoSvc,  setBillsAutoSvc]  = useState(null);

  const { chatUnread, chatToasts, dismissChatToast } = useChatUnread({
    orgId: org.id,
    isActive: tab === "messages",
  });

  const loadAll = useCallback(() => {
    const orgId = org.id;
    const safe = fn => fn.catch(() => ({}));
    Promise.all([
      coopFn("get-org",           { org_id: orgId }),
      coopFn("get-members",       { org_id: orgId }),
      coopFn("get-wallet",        { org_id: orgId }),
      coopFn("get-programs",      { org_id: orgId }),
      coopFn("get-announcements", { org_id: orgId }),
      safe(coopFn("get-loans",    { org_id: orgId })),
      safe(coopFn("get-withdrawal-requests-admin", { org_id: orgId })),
    ]).then(([orgR, memR, walR, progR, annR, loanR, wdR]) => {
      setOrg(prev => orgR.org || prev);
      setMembers(memR.members || []);
      setWallet(walR);
      setPrograms(progR.programs || []);
      setAnnouncements(annR.announcements || []);
      setLoans(loanR.loans || []);
      setWdRequests(wdR.requests || wdR.withdrawals || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [org.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const navigateTo = useCallback((tabId) => {
    setTab(tabId);
    setShowMore(false);
  }, []);

  const openQuickService = useCallback((serviceId) => {
    setBillsAutoSvc(serviceId);
    setTab("bills");
    setShowMore(false);
  }, []);

  const tabContent = {
    overview: <OverviewTab
                org={org} wallet={wallet} programs={programs} announcements={announcements}
                members={members} loans={loans} wdRequests={wdRequests}
                onQuickService={isOrgPortal ? openQuickService : null}
                onNavigate={isOrgPortal ? navigateTo : null}
                adminEmail={adminEmail}
              />,
    members:  <MembersTab  org={org} members={members} onRefresh={loadAll} />,
    programs: <ProgramsTab org={org} onRefresh={loadAll} />,
    finance:  <FinanceTab  org={org} members={members} programs={programs} onRefresh={loadAll} />,
    loans:    <LoansTab    org={org} members={members} onRefresh={loadAll} />,
    broadcast: <BroadcastTab org={org} members={members} />,
    messages: <GroupChat orgId={org.id} myName={org.owner_name || "Admin"} myRole="admin" orgName={org.name} org={org} onBack={() => setTab("overview")} />,
    settings: <SettingsTab org={org} onRefresh={loadAll} onOrgUpdate={setOrg} onBack={onBack} isOrgPortal={isOrgPortal} isDark={isDark} onToggleDark={toggleDark} />,
    bills:    <BillsTab    org={org} autoService={billsAutoSvc} onAutoOpened={() => setBillsAutoSvc(null)} adminEmail={adminEmail} />,
    profile:  <OrgProfileTab  org={org} onRefresh={loadAll} onOrgUpdate={setOrg} />,
    support:  <OrgPortalSupportTab org={org} />,
  };

  const isMoreTab = MORE_TABS.some(t => t.id === tab);

  // ─── ORG PORTAL LAYOUT (staff-portal look & feel) ───
  if (isOrgPortal) {
    const visibleMoreTabs = MORE_TABS.filter(t => !t.orgOnly || isOrgPortal);
    return (
      <div className="h-[100dvh] bg-slate-50 dark:bg-slate-900 flex justify-center transition-colors duration-200">
        <div className="w-full max-w-md flex flex-col h-full relative">

          {/* ── Header ── */}
          <header className="flex-none z-30 h-14 flex items-center justify-between px-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
            <img src="/logo.png" alt="KudiAi" className="h-8 w-8 object-contain flex-shrink-0" />
            <div className="flex items-baseline gap-0.5 select-none">
              <span className="text-[17px] font-black tracking-tight text-slate-800 dark:text-white leading-none">Kudi</span>
              <span className="text-[17px] font-black tracking-tight leading-none"
                style={{ background: "linear-gradient(135deg,#00A651,#059669)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI</span>
              <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 tracking-widest uppercase leading-none ml-1">Track</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <CoopNotificationBell
                orgId={org.id}
                recipientType="org"
                onNavigate={navigateTo}
              />
              <button onClick={() => navigateTo("profile")}
                className="active:scale-90 transition-transform">
                {org.logo_url
                  ? <img src={org.logo_url} alt="" className="w-9 h-9 rounded-full object-cover border-2 border-slate-100 dark:border-slate-700 shadow-sm" />
                  : <div className="w-9 h-9 rounded-full flex items-center justify-center text-base border-2 border-slate-100 dark:border-slate-700 shadow-sm"
                      style={{ background: "linear-gradient(145deg,#00A651,#0D2040)" }}>
                      <span>{ORG_TYPE_ICONS[org.type] || "🏢"}</span>
                    </div>
                }
              </button>
            </div>
          </header>

          {/* ── Main Content ── */}
          <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {tabContent[tab]}
          </main>

          {/* ── Bottom Navigation ── */}
          <nav className="flex-none z-40 bg-white dark:bg-[#0f1117] border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-stretch h-[54px]">
              {MAIN_TABS.map(t => {
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => { setTab(t.id); setShowMore(false); }}
                    className="flex-1 flex items-center justify-center relative focus-visible:outline-none">
                    <div className="relative">
                      <svg viewBox="0 0 24 24" className="w-6 h-6 transition-all duration-150"
                        fill={active ? "#00A651" : "none"}
                        stroke={active ? "#00A651" : "#94a3b8"}
                        strokeWidth={active ? 2 : 1.75}
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d={t.icon} />
                      </svg>
                      {t.id === "messages" && chatUnread > 0 && !active && (
                        <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] bg-[#00A651] text-white text-[8px] font-extrabold rounded-full flex items-center justify-center px-0.5">
                          {chatUnread > 99 ? "99+" : chatUnread}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {/* Hamburger — opens Twitter-style left drawer */}
              <button onClick={() => setShowMore(p => !p)}
                className="flex-1 flex items-center justify-center relative focus-visible:outline-none">
                <svg viewBox="0 0 24 24" className="w-6 h-6 transition-all duration-150"
                  fill="none"
                  stroke={isMoreTab || showMore ? "#00A651" : "#94a3b8"}
                  strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="12" r="1.5" fill={isMoreTab || showMore ? "#00A651" : "#94a3b8"} stroke="none" />
                  <circle cx="12" cy="12" r="1.5" fill={isMoreTab || showMore ? "#00A651" : "#94a3b8"} stroke="none" />
                  <circle cx="19" cy="12" r="1.5" fill={isMoreTab || showMore ? "#00A651" : "#94a3b8"} stroke="none" />
                </svg>
              </button>
            </div>
            <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} className="bg-white dark:bg-[#0f1117]" />
          </nav>

          {/* ── Chat message drop-in toasts ── */}
          {chatToasts.length > 0 && (
            <div className="fixed top-[60px] inset-x-0 z-[185] flex flex-col items-center gap-2 px-4 pointer-events-none">
              {chatToasts.map(ct => (
                <ChatToast
                  key={ct._tid}
                  toast={ct}
                  orgName={org.name}
                  onNavigate={() => { setTab("messages"); setShowMore(false); dismissChatToast(ct._tid); }}
                  onDismiss={() => dismissChatToast(ct._tid)}
                />
              ))}
            </div>
          )}

          {/* ── Side Drawer (Twitter/X-style) ── */}
          {showMore && (
            <div className="fixed inset-0 z-[60] flex" onClick={() => setShowMore(false)}>
              <div className="absolute inset-0 bg-black/40" />
              <div
                className="relative flex flex-col h-full bg-white dark:bg-[#0f1117] shadow-2xl overflow-hidden"
                style={{ width: "78%", maxWidth: 300 }}
                onClick={e => e.stopPropagation()}
              >
                {/* ── Twitter-style profile header ── */}
                {/* Banner */}
                <div className="relative flex-shrink-0" style={{ height: 88 }}>
                  <div className="absolute inset-0"
                    style={{ background: "linear-gradient(135deg,#00A651 0%,#065f46 55%,#0D2040 100%)" }} />
                  {/* Avatar overlapping banner */}
                  <div className="absolute left-4" style={{ bottom: -22 }}>
                    {org.logo_url
                      ? <img src={org.logo_url} alt=""
                          className="w-14 h-14 rounded-full object-cover border-4 border-white dark:border-[#0f1117]" />
                      : <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-4 border-white dark:border-[#0f1117]"
                          style={{ background: "linear-gradient(145deg,#00A651,#0D2040)" }}>
                          <span>{ORG_TYPE_ICONS[org.type] || "🏢"}</span>
                        </div>
                    }
                  </div>
                </div>

                {/* Org identity */}
                <div className="pt-9 pb-4 px-4 flex-shrink-0">
                  <p className="font-black text-slate-900 dark:text-white text-sm leading-tight truncate">{org.name}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono leading-tight">
                    {org.reg_number ? `@${org.reg_number.toLowerCase().replace(/\s+/g, "")}` : org.type}
                  </p>
                  {/* Followers-style member count */}
                  <div className="flex items-center gap-1 mt-2">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">{org.member_count || 0}</span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">members</span>
                  </div>
                </div>

                <div className="mx-4 border-t border-slate-100 dark:border-slate-800 flex-shrink-0" />

                {/* Navigation list */}
                <div className="flex-1 overflow-y-auto py-2">
                  {MAIN_TABS.map(t => {
                    const active = tab === t.id;
                    return (
                      <button key={t.id} onClick={() => navigateTo(t.id)}
                        className={`w-full flex items-center gap-4 px-5 py-3.5 transition-colors active:bg-slate-50 dark:active:bg-slate-800/50 ${active ? "text-[#00A651]" : "text-slate-800 dark:text-slate-100"}`}>
                        <svg viewBox="0 0 24 24" fill="none" className="w-[22px] h-[22px] flex-shrink-0"
                          stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                          <path d={t.icon} />
                        </svg>
                        <span className={`text-[15px] leading-none ${active ? "font-black" : "font-semibold"}`}>{t.label}</span>
                      </button>
                    );
                  })}
                  <div className="mx-5 my-1.5 border-t border-slate-100 dark:border-slate-800" />
                  {visibleMoreTabs.map(t => {
                    const active = tab === t.id;
                    return (
                      <button key={t.id} onClick={() => navigateTo(t.id)}
                        className={`w-full flex items-center gap-4 px-5 py-3.5 transition-colors active:bg-slate-50 dark:active:bg-slate-800/50 ${active ? "text-[#00A651]" : "text-slate-800 dark:text-slate-100"}`}>
                        <svg viewBox="0 0 24 24" fill="none" className="w-[22px] h-[22px] flex-shrink-0"
                          stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                          {t.icon.split("|").map((p, i) => <path key={i} d={p} />)}
                        </svg>
                        <span className={`text-[15px] leading-none ${active ? "font-black" : "font-semibold"}`}>{t.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Bottom actions */}
                <div className="border-t border-slate-100 dark:border-slate-800 flex-shrink-0 px-5 py-3 flex items-center justify-between">
                  <button onClick={onBack}
                    className="flex items-center gap-3 text-slate-500 dark:text-slate-400 text-sm font-semibold active:opacity-70 transition-opacity">
                    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign Out
                  </button>
                  <button onClick={toggleDark}
                    className="w-10 h-[22px] rounded-full relative flex-shrink-0 transition-colors"
                    style={{ background: isDark ? "#00A651" : "#e2e8f0" }}>
                    <div className={`w-[16px] h-[16px] rounded-full bg-white shadow transition-transform absolute top-[3px] ${isDark ? "translate-x-[19px]" : "translate-x-[3px]"}`} />
                  </button>
                </div>
                <div style={{ height: "env(safe-area-inset-bottom, 8px)" }} />
              </div>
            </div>
          )}

          {/* ── KudiAI Gemini Assistant ── */}
          <AIChatWidget
            portalContext={buildCoopOrgContext(org, members, wallet, programs, loans, announcements)}
            greeting={`${t("greet.morning").split(" ")[0]}${org.owner_name ? ` ${org.owner_name.split(" ")[0]}` : ""}! I'm **KudiAI**, your cooperative assistant powered by Gemini.\n\nI know your members, savings, loans, programs, and wallet — ask me anything!`}
            quickChips={[
              { label: t("aiChip.memberSummary")   || "Member Summary",   q: "Give me a summary of all members and their savings balances" },
              { label: t("aiChip.activeLoans")     || "Active Loans",     q: "List all active loans and total outstanding amount" },
              { label: t("aiChip.walletBalance")   || "Wallet Balance",   q: "What is the current wallet balance and recent transactions?" },
              { label: t("aiChip.pendingRequests") || "Pending Requests", q: "Are there any pending withdrawal requests I need to action?" },
              { label: t("aiChip.savingsPrograms") || "Savings Programs", q: "What savings programs are active and how are they performing?" },
              { label: t("aiChip.monthlyReport")   || "Monthly Report",   q: "Give me a full monthly cooperative performance report" },
            ]}
            inputPlaceholder={t("aiChip.coopPlaceholder") || "Ask about your cooperative…"}
          />

        </div>
      </div>
    );
  }

  // ─── ADMIN / NON-ORG PORTAL LAYOUT (Twitter-style text tabs) ───
  return (
    <div className="fixed inset-0 z-[65] bg-white dark:bg-[#0f1117] flex justify-center">
      <div className="w-full max-w-md flex flex-col h-full">

        {/* ── Twitter-style profile header ── */}
        {/* Banner */}
        <div className="relative flex-shrink-0" style={{ height: 80 }}>
          <div className="absolute inset-0"
            style={{ background: "linear-gradient(135deg,#00A651 0%,#065f46 55%,#0D2040 100%)" }} />
          {/* Back button */}
          <button onClick={onBack}
            className="absolute left-3 top-3 w-8 h-8 flex items-center justify-center rounded-full bg-black/30 text-white active:bg-black/50 transition">
            <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          {loading && (
            <div className="absolute right-4 top-4 w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          )}
          {/* Avatar overlapping banner */}
          <div className="absolute left-4" style={{ bottom: -20 }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl border-3 border-white dark:border-[#0f1117]"
              style={{ background: "linear-gradient(145deg,#00A651,#0D2040)", borderWidth: 3 }}>
              <span>{ORG_TYPE_ICONS[org.type] || "🏢"}</span>
            </div>
          </div>
        </div>

        {/* Org identity */}
        <div className="px-4 pt-7 pb-3 flex-shrink-0 border-b border-slate-100 dark:border-slate-800">
          <p className="text-base font-black text-slate-900 dark:text-white leading-tight truncate">{org.name}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">
            {org.reg_number ? `@${org.reg_number.toLowerCase().replace(/\s+/g, "")}` : org.type}
          </p>
          <div className="flex items-center gap-1 mt-1.5">
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">{org.member_count || 0}</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">members</span>
          </div>
        </div>

        {/* ── Twitter-style text-only tab bar ── */}
        <div className="bg-white dark:bg-[#0f1117] border-b border-slate-100 dark:border-slate-800 overflow-x-auto flex-shrink-0">
          <div className="flex min-w-max">
            {TABS.filter(t => !t.orgOnly).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-3.5 border-b-2 transition-colors whitespace-nowrap text-sm leading-none ${
                  tab === t.id
                    ? "border-[#00A651] text-slate-900 dark:text-white font-black"
                    : "border-transparent text-slate-400 dark:text-slate-500 font-semibold"
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <main className="flex-1 overflow-y-auto">
          {tabContent[tab]}
        </main>
      </div>
    </div>
  );
}
