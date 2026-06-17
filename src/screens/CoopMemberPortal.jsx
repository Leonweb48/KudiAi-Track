import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../utils/supabase";
import BillPayments from "./BillPayments";
import GroupChat from "./GroupChat";

const coopFn = async (action, body = {}) => {
  const r = await supabase.functions.invoke("coop-portal", { body: { action, ...body } });
  if (r.error) throw r.error;
  if (r.data?.error) throw new Error(r.data.error);
  return r.data;
};

const ORG_PAY_PREFIX = "org_member_pending_";

const fmt     = n => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT   = d => d ? new Date(d).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const ANN_COLORS = {
  announcement: "bg-blue-50 text-blue-700 border-blue-200",
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
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-blue-500", "bg-green-500"];

  const submit = async () => {
    if (password.length < 8) { setError("Minimum 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false, account_type: "org_member", email_verified: true },
    });
    if (err) { setError(err.message); setSaving(false); return; }
    setSuccess(true);
    // onAuthStateChange fires → must_change_password: false → org_member status → CoopMemberPortal
  };

  if (success) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-violet-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">Password set!</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Taking you to your portal…</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-14 pb-5">
        <div className="w-12 h-12 bg-violet-600 rounded-2xl flex items-center justify-center mb-4">
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
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-violet-600 dark:text-violet-400">
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
            className={`w-full border rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 ${confirm && confirm !== password ? "border-red-400 dark:border-red-600" : "border-slate-200 dark:border-slate-700"}`} />
          {confirm && confirm !== password && <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>}
        </div>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">{error}</p>}
        <button onClick={submit} disabled={saving || password.length < 8 || password !== confirm}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition">
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

function HomeTab({ member, org, announcements, loans = [], wdRequests = [], onQuickService, onNavigate }) {
  const activeLoans  = loans.filter(l => ["approved","disbursed","ongoing"].includes(l.status));
  const pendingWd    = wdRequests.filter(r => r.status === "pending");
  const pinnedAnns   = announcements.filter(a => a.is_pinned);
  const visibleAnns  = [...pinnedAnns.slice(0,1), ...announcements.filter(a => !a.is_pinned).slice(0,2)].slice(0,3);

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
      bg:"#2563eb", tab:"messages",
      icon:"M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  ];

  return (
    <div className="pb-8 space-y-6">

      {/* ── Hero Balance Card ── */}
      <div className="mx-4 mt-5 rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: "linear-gradient(145deg, #0a1628 0%, #1e3a5f 45%, #1d4ed8 100%)" }}>
        <div className="px-6 pt-7 pb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-xl font-extrabold text-white">
              {member.full_name?.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-white font-extrabold text-base leading-tight">{member.full_name}</p>
              <p className="text-blue-200 text-[10px] font-mono">{member.membership_id}</p>
              <p className="text-blue-200 text-[10px] capitalize">{member.role} · {org.name}</p>
            </div>
          </div>
          <p className="text-[10px] font-extrabold text-blue-300 uppercase tracking-[0.25em] mb-2">Savings Balance</p>
          <p className="text-[44px] font-black text-white leading-none tabular-nums">{fmt(member.savings_balance)}</p>
          <div className="flex items-center mt-5 pt-4 border-t border-white/10">
            <div className="flex-1">
              <p className="text-sm font-extrabold text-white">{fmtDate(member.joined_date)}</p>
              <p className="text-[10px] mt-0.5 text-blue-300">Member since</p>
            </div>
            <div className="border-l border-white/10 pl-4 ml-4 flex-1">
              <p className="text-sm font-extrabold text-white capitalize">{member.role}</p>
              <p className="text-[10px] mt-0.5 text-blue-300">Role</p>
            </div>
            <div className="border-l border-white/10 pl-4 ml-4 flex-1">
              <p className="text-sm font-extrabold text-white capitalize">{member.status || "active"}</p>
              <p className="text-[10px] mt-0.5 text-blue-300">Status</p>
            </div>
          </div>
        </div>
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #2563eb, #06b6d4, #8b5cf6)" }} />
      </div>

      {/* ── Quick Services ── */}
      <div className="px-4">
        <div className="flex justify-between items-center mb-4">
          <p className="text-[11px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-[0.15em]">Quick Services</p>
          {onNavigate && <button onClick={() => onNavigate("bills")} className="text-[10px] font-bold text-blue-600 dark:text-blue-400">View All →</button>}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {MBR_QUICK.map(s => (
            <button key={s.id} onClick={() => onQuickService?.(s.id)}
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
            <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center text-lg">
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
            {onNavigate && <button onClick={() => onNavigate("messages")} className="text-[10px] font-bold text-blue-600 dark:text-blue-400">View All →</button>}
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
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  PAY VIA PAYSTACK MODAL  (redirect-based)
// ═══════════════════════════════════════════════════
function PayOrgModal({ member, org, onClose }) {
  const [amount,    setAmount]    = useState("");
  const [programId, setProgramId] = useState("");
  const [programs,  setPrograms]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");

  useEffect(() => {
    coopFn("member-get-programs", { member_id: member.id, org_id: org.id })
      .then(r => setPrograms((r.programs || []).filter(p => p.status === "active")))
      .catch(() => null);
  }, [member.id, org.id]);

  const handlePay = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError("Enter a valid amount"); return; }
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
        <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Pay via Paystack</h3>
        <p className="text-xs text-slate-400 mb-4">Contribute directly to {org.name}</p>

        <div className="flex flex-col gap-3 mb-4">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦) *</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="Enter amount" disabled={loading}
              className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50" />
          </div>
          {programs.length > 0 && (
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Program (Optional)</label>
              <select value={programId} onChange={e => setProgramId(e.target.value)} disabled={loading}
                className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50">
                <option value="">— General contribution —</option>
                {programs.map(p => <option key={p.id} value={p.id}>{p.name}{p.contribution_type === "fixed" ? ` (${fmt(p.amount)})` : ""}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs px-3 py-2.5 rounded-xl mb-4 border bg-red-50 border-red-200 text-red-600">{error}</p>
        )}

        <button onClick={handlePay} disabled={loading || !amount}
          className="w-full py-4 bg-violet-600 text-white font-bold rounded-2xl text-sm disabled:opacity-60">
          {loading
            ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Preparing payment…</span>
            : "Pay with Paystack →"}
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
            <button onClick={onClose} className="w-full py-3 bg-violet-600 text-white font-bold rounded-2xl text-sm">Done</button>
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
                  className="w-full px-3 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Reason (Optional)</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why do you need this withdrawal?"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-400" />
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
  const [member,      setMember]      = useState(initialMember);
  const [programs,    setPrograms]    = useState([]);
  const [history,     setHistory]     = useState([]);
  const [wdRequests,  setWdRequests]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showPay,     setShowPay]     = useState(false);
  const [showWdReq,   setShowWdReq]   = useState(false);

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

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  const totalContributed = history.filter(h => h.type === "deposit").reduce((sum, h) => sum + Number(h.amount), 0);
  const hasPaystack = !!org.paystack_subaccount_code;
  const pendingWd = wdRequests.filter(r => r.status === "pending").length;

  return (
    <div className="p-4 pb-28 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center">
          <p className="text-lg font-extrabold text-green-600 tabular">{fmt(member.savings_balance)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Current Balance</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center">
          <p className="text-lg font-extrabold text-violet-600 tabular">{fmt(totalContributed)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Total Contributions</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {hasPaystack && (
          <button onClick={() => setShowPay(true)}
            className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5">
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
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Active Programs</p>
          {programs.filter(p => p.status === "active").map(p => (
            <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 mb-2 last:mb-0">
              <p className="text-sm font-extrabold text-slate-800 dark:text-white">{p.name}</p>
              {p.description && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{p.description}</p>}
              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[10px] bg-violet-50 dark:bg-violet-900/20 text-violet-600 px-2 py-0.5 rounded-lg">{FREQ_LABELS[p.frequency]}</span>
                {p.contribution_type === "fixed" && <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-lg">{fmt(p.amount)}</span>}
                {p.contribution_type === "voluntary" && <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded-lg">Voluntary</span>}
              </div>
            </div>
          ))}
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
                <span className={`text-[10px] font-bold capitalize px-2 py-0.5 rounded-full ${r.status === "pending" ? "bg-amber-50 text-amber-600" : r.status === "approved" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
                  {r.status}
                </span>
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
              <div key={h.id} className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-slate-700 flex justify-between items-start">
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200 capitalize">{h.type}</p>
                  {h.org_contribution_programs?.name && <p className="text-[10px] text-violet-500 font-semibold">{h.org_contribution_programs.name}</p>}
                  <p className="text-[10px] text-slate-400">{fmtDT(h.created_at)} · {h.payment_method}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-extrabold tabular ${h.type === "withdrawal" ? "text-red-500" : "text-green-600"}`}>
                    {h.type === "withdrawal" ? "−" : "+"}{fmt(h.amount)}
                  </p>
                  <p className="text-[10px] text-slate-400">Bal: {fmt(h.balance_after)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPay && (
        <PayOrgModal
          member={member} org={org}
          onClose={() => setShowPay(false)}
        />
      )}
      {showWdReq && (
        <RequestWithdrawalModal
          member={member} org={org}
          onClose={() => setShowWdReq(false)}
          onSuccess={() => { setShowWdReq(false); load(); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  LOANS TAB
// ═══════════════════════════════════════════════════
function LoansTab({ member, org }) {
  const [loans,   setLoans]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    coopFn("member-get-loans", { member_id: member.id, org_id: org.id })
      .then(r => setLoans(r.loans || []))
      .finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  const STATUS_COL = {
    pending: "text-amber-500", approved: "text-blue-600", disbursed: "text-violet-600",
    repaid: "text-green-600", rejected: "text-red-500", defaulted: "text-red-700",
  };

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 pb-28 flex flex-col gap-3">
      {loans.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <span className="text-5xl mb-4">🏦</span>
          <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">No Loans</p>
          <p className="text-sm text-slate-400">You don't have any loan applications yet. Contact your organisation admin to apply.</p>
        </div>
      ) : (
        loans.map(l => (
          <div key={l.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-sm font-extrabold text-slate-800 dark:text-white">{l.loan_purpose || "General Loan"}</p>
                <p className="text-[10px] text-slate-400">{fmtDate(l.applied_at)}</p>
                <span className={`text-xs font-bold capitalize ${STATUS_COL[l.status] || "text-slate-500"}`}>● {l.status}</span>
              </div>
              <div className="text-right">
                <p className="text-sm font-extrabold text-amber-600">{fmt(l.amount_requested)}</p>
                {l.outstanding_balance > 0 && <p className="text-xs text-red-500 font-bold">Owed: {fmt(l.outstanding_balance)}</p>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
              {[["Interest", `${l.interest_rate}%`], ["Months", l.repayment_months], ["Due", fmtDate(l.due_date)]].map(([k, v]) => (
                <div key={k}><p className="text-[10px] text-slate-400">{k}</p><p className="text-xs font-bold text-slate-700 dark:text-slate-200">{v || "—"}</p></div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MEETINGS TAB (with RSVP)
// ═══════════════════════════════════════════════════
function MeetingsTab({ member, org }) {
  const [meetings, setMeetings] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [rsvping,  setRsvping]  = useState(null);

  const load = useCallback(() => {
    coopFn("member-get-meetings", { member_id: member.id, org_id: org.id })
      .then(r => setMeetings(r.meetings || []))
      .finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  const handleRsvp = async (meetingId, status) => {
    setRsvping(meetingId);
    try {
      await coopFn("set-rsvp", { meeting_id: meetingId, member_id: member.id, org_id: org.id, status });
      load();
    } catch (e) { alert(e.message); }
    finally { setRsvping(null); }
  };

  const RSVP_OPTIONS = [
    { status: "attending",     label: "Attending",  color: "bg-green-500 text-white" },
    { status: "maybe",         label: "Maybe",      color: "bg-amber-400 text-white" },
    { status: "not_attending", label: "Can't Go",   color: "bg-slate-400 text-white" },
  ];
  const FORMAT_BADGE = { physical: "bg-green-100 text-green-700", virtual: "bg-blue-100 text-blue-700", hybrid: "bg-violet-100 text-violet-700" };

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 pb-28 flex flex-col gap-3">
      {meetings.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <span className="text-5xl mb-4">📅</span>
          <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">No Meetings</p>
          <p className="text-sm text-slate-400">No meetings have been scheduled yet.</p>
        </div>
      ) : (
        meetings.map(m => (
          <div key={m.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1 min-w-0 mr-2">
                <p className="text-sm font-extrabold text-slate-800 dark:text-white">{m.title}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{fmtDT(m.scheduled_at)}</p>
                {m.location && <p className="text-[11px] text-slate-400">📍 {m.location}</p>}
                {m.meeting_link && (
                  <a href={m.meeting_link} target="_blank" rel="noreferrer"
                    className="inline-block mt-1 text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-lg">🔗 Join Online</a>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${FORMAT_BADGE[m.format] || FORMAT_BADGE.physical}`}>{m.format}</span>
                {m.my_attendance && (
                  <p className={`text-[10px] font-bold mt-1 ${m.my_attendance === "present" ? "text-green-600" : "text-red-500"}`}>
                    {m.my_attendance === "present" ? "✓ Present" : "✗ Absent"}
                  </p>
                )}
              </div>
            </div>
            {m.agenda && (
              <div className="bg-slate-50 dark:bg-slate-700 rounded-xl px-3 py-2 mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Agenda</p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line line-clamp-4">{m.agenda}</p>
              </div>
            )}
            {m.rsvp_counts && (
              <div className="flex gap-2 text-[10px] text-slate-400 mb-3">
                <span className="text-green-600 font-bold">✓ {m.rsvp_counts.attending}</span>
                <span>·</span>
                <span className="text-amber-500 font-bold">? {m.rsvp_counts.maybe}</span>
                <span>·</span>
                <span className="text-slate-400 font-bold">✗ {m.rsvp_counts.not_attending}</span>
              </div>
            )}
            <div className="flex gap-1.5">
              {RSVP_OPTIONS.map(opt => {
                const isActive = m.my_rsvp === opt.status;
                return (
                  <button key={opt.status} onClick={() => handleRsvp(m.id, opt.status)} disabled={rsvping === m.id}
                    className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold border transition disabled:opacity-50 ${isActive ? opt.color + " border-transparent" : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 bg-transparent"}`}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  DIRECTORY TAB
// ═══════════════════════════════════════════════════
function DirectoryTab({ member: selfMember, org }) {
  const [directory, setDirectory] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [privacy,   setPrivacy]   = useState({
    privacy_balance:       selfMember.privacy_balance,
    privacy_contributions: selfMember.privacy_contributions,
    privacy_activities:    selfMember.privacy_activities,
  });
  const [savingP, setSavingP] = useState(false);

  const load = useCallback(() => {
    coopFn("member-get-directory", { member_id: selfMember.id, org_id: org.id })
      .then(r => setDirectory(r.members || []))
      .finally(() => setLoading(false));
  }, [selfMember.id, org.id]);
  useEffect(() => { load(); }, [load]);

  const handlePrivacy = async (key, val) => {
    const prev = privacy;
    const newPrivacy = { ...privacy, [key]: val };
    setPrivacy(newPrivacy);
    setSavingP(true);
    try { await coopFn("member-update-privacy", { member_id: selfMember.id, ...newPrivacy }); }
    catch (e) { setPrivacy(prev); }
    finally { setSavingP(false); }
  };

  const ROLE_COLORS = {
    admin: "bg-violet-100 text-violet-700", president: "bg-amber-100 text-amber-700",
    treasurer: "bg-green-100 text-green-700", secretary: "bg-blue-100 text-blue-700",
    officer: "bg-pink-100 text-pink-700", member: "bg-slate-100 text-slate-600",
  };

  const filtered = directory.filter(m =>
    m.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    m.role?.includes(search.toLowerCase())
  );

  return (
    <div className="p-4 pb-28 flex flex-col gap-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <div className="flex justify-between items-center mb-2">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">My Privacy Settings</p>
          {savingP && <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />}
        </div>
        {[
          ["privacy_balance",        "Hide my balance from directory"],
          ["privacy_contributions",  "Hide my contributions from directory"],
          ["privacy_activities",     "Hide my activities from directory"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center justify-between py-2 cursor-pointer">
            <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
            <div onClick={() => handlePrivacy(key, !privacy[key])}
              className={`w-10 h-6 rounded-full relative transition-colors cursor-pointer ${privacy[key] ? "bg-violet-500" : "bg-slate-200 dark:bg-slate-600"}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${privacy[key] ? "translate-x-5" : "translate-x-1"}`} />
            </div>
          </label>
        ))}
      </div>

      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map(m => (
            <div key={m.id} className="bg-white dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700">
              <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-base font-extrabold text-violet-600 mb-2">
                {m.full_name?.charAt(0).toUpperCase()}
              </div>
              <p className="text-xs font-extrabold text-slate-800 dark:text-white leading-tight mb-0.5">{m.full_name}</p>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${ROLE_COLORS[m.role] || ROLE_COLORS.member}`}>{m.role}</span>
              {m.phone && <p className="text-[10px] text-slate-400 mt-1.5">📞 {m.phone}</p>}
              {m.email && <p className="text-[10px] text-slate-400 truncate">✉ {m.email}</p>}
            </div>
          ))}
        </div>
      )}
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

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <BillPayments
      store={store}
      plan=""
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
  { id: "meetings",  label: "Meetings",  color:"#0f766e", icon:"M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "directory", label: "Directory", color:"#2563eb", icon:"M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
];

export default function CoopMemberPortal({ member: initialMember }) {
  const [member,        setMember]        = useState(initialMember);
  const [tab,           setTab]           = useState("home");
  const [announcements, setAnnouncements] = useState([]);
  const [loans,         setLoans]         = useState([]);
  const [wdRequests,    setWdRequests]    = useState([]);
  const [showMore,      setShowMore]      = useState(false);
  const [billsAutoSvc,  setBillsAutoSvc]  = useState(null);
  const [processingPayment, setProcessingPayment] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("trxref") || params.get("reference");
    if (!ref) return false;
    const stored = localStorage.getItem(ORG_PAY_PREFIX + ref);
    if (!stored) return false;
    try { return JSON.parse(stored).member_id === initialMember?.id; } catch { return false; }
  });
  const [paymentResult, setPaymentResult] = useState(null);

  useEffect(() => { setMember(initialMember); }, [initialMember]);

  const org = member?.org || member?.organizations || {};

  // Detect Paystack return for savings payment
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("trxref") || params.get("reference");
    if (!ref) return;
    const key = ORG_PAY_PREFIX + ref;
    const stored = localStorage.getItem(key);
    if (!stored) return;
    let pending;
    try { pending = JSON.parse(stored); } catch { return; }
    if (pending.member_id !== initialMember?.id) return;

    window.history.replaceState({}, "", window.location.pathname);
    localStorage.removeItem(key);
    setProcessingPayment(true);

    coopFn("confirm-member-payment", {
      member_id: pending.member_id, org_id: pending.org_id,
      reference: ref, program_id: pending.program_id || undefined,
    }).then(res => {
      if (res.member) setMember(prev => ({ ...prev, ...res.member }));
      setTab("contributions");
      setProcessingPayment(false);
      setPaymentResult({ ok: true, amount: res.amount || pending.amount, ref });
    }).catch(e => {
      setProcessingPayment(false);
      setPaymentResult({ ok: false, error: e.message || "Payment verification failed", ref });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect Paystack return for bill payment — switch to bills tab so BillPayments handles it
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billRef = params.get("bill_ref") || params.get("trxref");
    if (billRef && localStorage.getItem(`ck_bill_pending_${billRef}`)) {
      setTab("bills");
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
    ]).then(([annR, loanR, wdR]) => {
      setAnnouncements(annR.announcements || []);
      setLoans(loanR.loans || []);
      setWdRequests(wdR.requests || []);
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
    home:          <HomeTab member={member} org={org} announcements={announcements} loans={loans} wdRequests={wdRequests} onQuickService={openQuickService} onNavigate={navigateTo} />,
    contributions: <ContributionsTab member={member} org={org} onMemberUpdate={handleMemberUpdate} />,
    loans:         <LoansTab member={member} org={org} />,
    bills:         <MemberBillsTab member={member} org={org} autoService={billsAutoSvc} onAutoOpened={() => setBillsAutoSvc(null)} />,
    meetings:      <MeetingsTab member={member} org={org} />,
    directory:     <DirectoryTab member={member} org={org} />,
    messages:      <GroupChat orgId={org.id} myName={member.full_name} myRole="member" orgName={org.name} org={org} onBack={() => navigateTo("home")} />,
  };

  const isMoreTab = MORE_TABS.some(t => t.id === tab);
  const emergencyCount = announcements.filter(a => a.type === "emergency").length;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-50 dark:bg-slate-900 flex justify-center">
      <div className="w-full max-w-md flex flex-col h-full">

        {/* ── Top Header ── */}
        <div className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base font-extrabold text-white flex-shrink-0"
            style={{ background: "linear-gradient(145deg,#2563eb,#1e3a8a)" }}>
            {member.full_name?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate leading-tight">{member.full_name}</p>
            <p className="text-[9px] text-slate-400 font-mono tracking-wider">{member.membership_id} · {org?.name}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <p className="text-sm font-extrabold text-green-600">{fmt(member.savings_balance)}</p>
              <p className="text-[9px] text-slate-400">savings</p>
            </div>
            <button onClick={() => supabase.auth.signOut()}
              className="text-[10px] font-extrabold text-red-500 border border-red-200 dark:border-red-800 px-2.5 py-1 rounded-lg">
              Sign Out
            </button>
          </div>
        </div>

        {/* ── Main Content ── */}
        <main className="flex-1 overflow-y-auto pb-[68px]">
          {tabContent[tab]}
        </main>

        {/* ── Bottom Navigation ── */}
        <div className="fixed bottom-0 left-0 right-0 z-20 flex justify-center pointer-events-none">
          <div className="w-full max-w-md pointer-events-auto">
            <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 px-2 pt-2"
              style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
              <div className="flex items-end justify-around">
                {MAIN_TABS.map(t => {
                  const active = tab === t.id;
                  return (
                    <button key={t.id} onClick={() => { setTab(t.id); setShowMore(false); }}
                      className="flex flex-col items-center gap-1 px-3 py-1.5 min-w-[52px] relative">
                      {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-blue-600" />}
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"
                        stroke={active ? "#2563eb" : "#94a3b8"} strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                        <path d={t.icon} />
                      </svg>
                      <span className={`text-[9px] font-bold ${active ? "text-blue-600" : "text-slate-400 dark:text-slate-500"}`}>{t.label}</span>
                    </button>
                  );
                })}
                {/* More button */}
                <button onClick={() => setShowMore(p => !p)}
                  className="flex flex-col items-center gap-1 px-3 py-1.5 min-w-[52px] relative">
                  {isMoreTab && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-blue-600" />}
                  {emergencyCount > 0 && <span className="absolute top-1 right-2 w-2 h-2 bg-red-500 rounded-full" />}
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"
                    stroke={isMoreTab || showMore ? "#2563eb" : "#94a3b8"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h.01M12 12h.01M19 12h.01" />
                  </svg>
                  <span className={`text-[9px] font-bold ${isMoreTab || showMore ? "text-blue-600" : "text-slate-400 dark:text-slate-500"}`}>More</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── More Sheet ── */}
        {showMore && (
          <div className="fixed inset-0 z-30 flex justify-center items-end" onClick={() => setShowMore(false)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
            <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl overflow-hidden"
              style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
              onClick={e => e.stopPropagation()}>
              <div className="w-12 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 mb-5" />
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-[0.2em] px-5 mb-4">More</p>
              <div className="grid grid-cols-2 gap-3 px-4 pb-2">
                {MORE_TABS.map(t => {
                  const active = tab === t.id;
                  return (
                    <button key={t.id} onClick={() => navigateTo(t.id)}
                      className={`flex flex-col items-center gap-2.5 py-5 rounded-2xl transition-all active:scale-95 relative ${active ? "bg-blue-50 dark:bg-blue-900/30" : "bg-slate-50 dark:bg-slate-800"}`}>
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                        style={{ background: (t.color || "#64748b") + "18" }}>
                        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ stroke: active ? "#2563eb" : (t.color || "#64748b") }}>
                          {t.icon.split("|").map((p, i) => <path key={i} d={p} />)}
                        </svg>
                      </div>
                      {t.id === "messages" && emergencyCount > 0 && (
                        <span className="absolute top-3 right-3 w-2 h-2 bg-red-500 rounded-full" />
                      )}
                      <span className={`text-[11px] font-bold ${active ? "text-blue-600" : "text-slate-600 dark:text-slate-300"}`}>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Payment processing overlay */}
      {processingPayment && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center px-6">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 text-center max-w-xs w-full">
            <div className="w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
            <p className="text-base font-extrabold text-slate-800 dark:text-white">Verifying payment…</p>
            <p className="text-xs text-slate-400 mt-2">Please wait while we confirm your contribution</p>
          </div>
        </div>
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
                  className="w-full py-4 bg-violet-600 text-white font-bold rounded-2xl text-sm">
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
