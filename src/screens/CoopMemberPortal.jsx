import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { usePaystackPayment } from "react-paystack";

const coopFn = (action, body = {}) =>
  supabase.functions.invoke("coop-portal", { body: { action, ...body } })
    .then(r => { if (r.error) throw r.error; return r.data; });

const fmt     = n => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT   = d => d ? new Date(d).toLocaleString("en-NG",  { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS_COLORS = {
  active: "text-green-600", suspended: "text-amber-500", pending: "text-amber-500",
  approved: "text-blue-600", disbursed: "text-violet-600", repaid: "text-green-600",
  rejected: "text-red-500", defaulted: "text-red-700", scheduled: "text-blue-600",
  ongoing: "text-green-600", completed: "text-slate-500", cancelled: "text-red-500",
};

const ORG_TYPE_ICONS = {
  cooperative: "🤝", market_association: "🏪", church: "⛪",
  ngo: "🌍", youth_group: "👥", savings_group: "💰",
};

// ─────────────────────────────────────────────────────────
//  PAYSTACK SAVINGS BUTTON
// ─────────────────────────────────────────────────────────
function PaySavingsButton({ member, org, onSuccess }) {
  const [amount, setAmount] = useState("");
  const [show,   setShow]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [ref]    = useState(() => `KDT-COOP-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`);

  const config = {
    reference: ref,
    email: member.email || `${member.membership_id}@kuditrack.app`,
    amount: Math.round(parseFloat(amount || 0) * 100),
    publicKey: process.env.REACT_APP_PAYSTACK_PUBLIC_KEY || "",
    currency: "NGN",
  };

  const initPay = usePaystackPayment(config);

  const handlePay = () => {
    if (!amount || parseFloat(amount) <= 0) return;
    initPay(
      async (tx) => {
        setSaving(true);
        try {
          await coopFn("record-saving", {
            org_id: org.id, member_id: member.id,
            amount: parseFloat(amount), type: "deposit",
            payment_method: "paystack", paystack_ref: tx?.reference || ref,
          });
          setShow(false); setAmount("");
          onSuccess(parseFloat(amount));
        } catch (e) { alert(e.message); }
        finally { setSaving(false); }
      },
      () => {}
    );
  };

  const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";

  return (
    <>
      <button onClick={() => setShow(true)}
        className="w-full py-3 bg-violet-600 text-white rounded-xl font-bold text-sm">
        Pay Savings via Paystack
      </button>
      {show && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Pay Savings</h3>
            <div className="mb-4">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦)</label>
              <input className={input} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" autoFocus />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShow(false); setAmount(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={handlePay} disabled={!amount || saving} className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
                {saving ? "Recording…" : `Pay ${amount ? fmt(amount) : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────
//  SAVINGS TAB
// ─────────────────────────────────────────────────────────
function SavingsTab({ member, org, onBalanceUpdate }) {
  const [savings,  setSavings]  = useState([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(() => {
    coopFn("member-get-savings", { member_id: member.id, org_id: org.id })
      .then(r => setSavings(r.savings || []))
      .finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 pb-24 flex flex-col gap-4">
      {/* Balance card */}
      <div className="bg-gradient-to-br from-green-500 to-green-700 rounded-2xl p-4 text-white">
        <p className="text-xs font-bold text-green-100 uppercase tracking-wider mb-1">My Savings Balance</p>
        <p className="text-3xl font-black tabular">{fmt(member.savings_balance)}</p>
        <p className="text-xs text-green-100 mt-1">{savings.length} contribution{savings.length !== 1 ? "s" : ""}</p>
      </div>

      {/* Pay via Paystack */}
      <PaySavingsButton member={member} org={org} onSuccess={(amt) => { onBalanceUpdate(amt); load(); }} />

      {/* History */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Savings History</p>
        {loading ? (
          <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : savings.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No savings yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {savings.map(s => (
              <div key={s.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">{s.type}</p>
                  <p className="text-[10px] text-slate-400">{fmtDT(s.created_at)} · {s.payment_method}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-extrabold tabular ${s.type === "withdrawal" ? "text-red-500" : "text-green-600"}`}>
                    {s.type === "withdrawal" ? "−" : "+"}{fmt(s.amount)}
                  </p>
                  <p className="text-[10px] text-slate-400">Bal: {fmt(s.balance_after)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  LOANS TAB
// ─────────────────────────────────────────────────────────
function LoansTab({ member, org }) {
  const [loans,       setLoans]       = useState([]);
  const [repayments,  setRepayments]  = useState({});
  const [loading,     setLoading]     = useState(true);
  const [showApply,   setShowApply]   = useState(false);
  const [expanded,    setExpanded]    = useState(null);
  const [form,        setForm]        = useState({ amount_requested: "", loan_purpose: "", repayment_months: "1", notes: "" });
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");

  const load = useCallback(() => {
    coopFn("member-get-loans", { member_id: member.id, org_id: org.id })
      .then(r => setLoans(r.loans || [])).finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  const loadRepayments = async (loanId) => {
    if (repayments[loanId]) return;
    const r = await coopFn("get-repayments", { loan_id: loanId, org_id: org.id });
    setRepayments(p => ({ ...p, [loanId]: r.repayments || [] }));
  };

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleApply = async () => {
    if (!form.amount_requested) { setError("Amount required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("member-request-loan", { member_id: member.id, org_id: org.id, ...form });
      setShowApply(false); setForm({ amount_requested: "", loan_purpose: "", repayment_months: "1", notes: "" }); load();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";
  const activeLoans = loans.filter(l => l.status === "disbursed");
  const totalOut = activeLoans.reduce((s, l) => s + (l.outstanding_balance || 0), 0);

  return (
    <div className="p-4 pb-24 flex flex-col gap-4">
      {/* Summary card */}
      <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-4 text-white">
        <p className="text-xs font-bold text-amber-100 uppercase tracking-wider mb-1">Outstanding Loans</p>
        <p className="text-3xl font-black tabular">{fmt(totalOut)}</p>
        <p className="text-xs text-amber-100 mt-1">{activeLoans.length} active loan{activeLoans.length !== 1 ? "s" : ""}</p>
      </div>

      <button onClick={() => setShowApply(true)} className="w-full py-3 bg-amber-500 text-white rounded-xl font-bold text-sm">Apply for a Loan</button>

      {loading ? (
        <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : loans.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700 text-center text-slate-400 text-sm">No loan applications yet</div>
      ) : (
        loans.map(l => (
          <div key={l.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <button onClick={() => { setExpanded(expanded === l.id ? null : l.id); loadRepayments(l.id); }}
              className="w-full p-4 flex justify-between items-start text-left">
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-white">{fmt(l.amount_requested)}</p>
                <p className="text-[10px] text-slate-400">{l.loan_purpose || "General"} · {fmtDate(l.applied_at)}</p>
                <span className={`text-[10px] font-bold capitalize ${STATUS_COLORS[l.status]}`}>● {l.status}</span>
              </div>
              <div className="text-right">
                {l.outstanding_balance > 0 && <p className="text-xs font-extrabold text-red-500">Out: {fmt(l.outstanding_balance)}</p>}
                {l.due_date && <p className="text-[10px] text-slate-400">Due: {fmtDate(l.due_date)}</p>}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={`w-4 h-4 ml-auto mt-1 text-slate-400 transition-transform ${expanded === l.id ? "rotate-180" : ""}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </button>
            {expanded === l.id && (
              <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 pt-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Repayment History</p>
                {!repayments[l.id] ? (
                  <div className="flex justify-center py-3"><div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" /></div>
                ) : repayments[l.id].length === 0 ? (
                  <p className="text-xs text-slate-400">No repayments recorded</p>
                ) : (
                  repayments[l.id].map(r => (
                    <div key={r.id} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
                      <p className="text-xs text-slate-600 dark:text-slate-300">{fmtDate(r.created_at)} · {r.payment_method}</p>
                      <p className="text-xs font-bold text-green-600">{fmt(r.amount)}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))
      )}

      {showApply && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Apply for a Loan</h3>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Amount (₦) *</label>
                <input className={input} type="number" value={form.amount_requested} onChange={set("amount_requested")} placeholder="0" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Repay in (months)</label>
                  <input className={input} type="number" value={form.repayment_months} onChange={set("repayment_months")} placeholder="1" min="1" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Purpose</label>
                  <input className={input} value={form.loan_purpose} onChange={set("loan_purpose")} placeholder="Business…" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setShowApply(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={handleApply} disabled={saving} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Submitting…" : "Submit Application"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  MEETINGS TAB
// ─────────────────────────────────────────────────────────
function MeetingsTab({ member, org }) {
  const [meetings, setMeetings] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    coopFn("member-get-meetings", { member_id: member.id, org_id: org.id })
      .then(r => setMeetings(r.meetings || [])).finally(() => setLoading(false));
  }, [member.id, org.id]);

  return (
    <div className="p-4 pb-24 flex flex-col gap-3">
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : meetings.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-4xl mb-3">📅</span>
          <p className="text-sm text-slate-400">No meetings scheduled yet</p>
        </div>
      ) : (
        meetings.map(m => {
          const myAtt = m.my_attendance;
          return (
            <div key={m.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{m.title}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{fmtDT(m.scheduled_at)}</p>
                  {m.location && <p className="text-[10px] text-slate-400">📍 {m.location}</p>}
                </div>
                <span className={`text-[10px] font-bold capitalize ${STATUS_COLORS[m.status]}`}>{m.status}</span>
              </div>
              {myAtt && (
                <div className={`inline-flex items-center gap-1.5 mt-1 px-2 py-1 rounded-lg text-[10px] font-bold ${
                  myAtt === "present" ? "bg-green-50 text-green-600" :
                  myAtt === "absent"  ? "bg-red-50 text-red-500"     : "bg-amber-50 text-amber-600"
                }`}>
                  {myAtt === "present" ? "✓ Attended" : myAtt === "absent" ? "✗ Absent" : "Excused"}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  LOGIN SCREEN
// ─────────────────────────────────────────────────────────
function LoginScreen({ org, onLogin, onBack }) {
  const [membershipId, setMembershipId] = useState("");
  const [pin,          setPin]          = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  const handleLogin = async () => {
    if (!membershipId || !pin) { setError("Enter your Membership ID and PIN"); return; }
    setLoading(true); setError("");
    try {
      const result = await coopFn("member-auth", { org_id: org.id, membership_id: membershipId.toUpperCase().trim(), pin });
      onLogin(result.member);
    } catch (e) { setError(e.message || "Invalid credentials"); }
    finally { setLoading(false); }
  };

  const input = "w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex justify-center">
      <div className="w-full max-w-md flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 bg-violet-100 dark:bg-violet-900/30 rounded-2xl flex items-center justify-center text-4xl mb-4">
          {ORG_TYPE_ICONS[org.type] || "🏢"}
        </div>
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white text-center mb-1">{org.name}</h1>
        <p className="text-xs text-slate-400 mb-8 text-center">Member Portal · Sign in to continue</p>

        {error && <div className="w-full bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-4 text-xs text-red-600">{error}</div>}

        <div className="w-full flex flex-col gap-3 mb-6">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Membership ID</label>
            <input className={input} value={membershipId} onChange={e => setMembershipId(e.target.value)} placeholder="e.g. COOP-0001" autoCapitalize="characters" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">PIN</label>
            <input className={input} type="password" maxLength={6} value={pin} onChange={e => setPin(e.target.value)} placeholder="4–6 digit PIN"
              onKeyDown={e => e.key === "Enter" && handleLogin()} />
          </div>
        </div>

        <button onClick={handleLogin} disabled={loading}
          className="w-full py-3.5 bg-violet-600 text-white rounded-xl font-extrabold text-sm disabled:opacity-50">
          {loading ? "Signing in…" : "Sign In"}
        </button>

        <p className="text-[10px] text-slate-400 mt-6 text-center">Contact your organisation admin if you've forgotten your PIN</p>

        {onBack && (
          <button onClick={onBack} className="mt-4 text-xs text-violet-500 font-semibold">← Back to App</button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  MAIN PORTAL
// ─────────────────────────────────────────────────────────
const TABS = [
  { id: "overview", label: "Overview", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "savings",  label: "Savings",  icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "loans",    label: "Loans",    icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
  { id: "meetings", label: "Meetings", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
];

export default function CoopMemberPortal({ token, onBack }) {
  const [org,     setOrg]     = useState(null);
  const [member,  setMember]  = useState(null);
  const [tab,     setTab]     = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [loggedIn, setLoggedIn] = useState(false);

  // Load org from token
  useEffect(() => {
    if (!token) { setError("Invalid portal link"); setLoading(false); return; }
    coopFn("member-by-token", { portal_token: token })
      .then(r => {
        setOrg(r.org);
        setMember(r.member);
        setLoggedIn(true);
      })
      .catch(() => {
        // Token may be org-level (not member-level) — try get-org by slug
        setLoading(false);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleLogin = (m) => {
    setMember(m);
    setLoggedIn(true);
  };

  const handleBalanceUpdate = (amount) => {
    setMember(prev => prev ? {
      ...prev,
      savings_balance: (prev.savings_balance || 0) + amount,
    } : prev);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-6">
        <span className="text-5xl mb-4">🔒</span>
        <p className="text-base font-bold text-slate-800 dark:text-white mb-2">Invalid Portal Link</p>
        <p className="text-sm text-slate-400 text-center mb-6">{error}</p>
        {onBack && <button onClick={onBack} className="px-6 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm">Go Back</button>}
      </div>
    );
  }

  if (!loggedIn || !member) {
    return <LoginScreen org={org || {}} onLogin={handleLogin} onBack={onBack} />;
  }

  const overviewContent = (
    <div className="p-4 pb-24 flex flex-col gap-4">
      {/* Member card */}
      <div className="bg-gradient-to-br from-violet-600 to-violet-800 rounded-2xl p-4 text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl font-extrabold">
            {member.full_name?.charAt(0)}
          </div>
          <div>
            <p className="text-base font-extrabold">{member.full_name}</p>
            <p className="text-xs text-violet-200 font-mono">{member.membership_id}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/20">
          <div><p className="text-sm font-extrabold">{fmt(member.savings_balance)}</p><p className="text-[10px] text-violet-200">Savings</p></div>
          <div><p className="text-sm font-extrabold capitalize">{member.role}</p><p className="text-[10px] text-violet-200">Role</p></div>
          <div><p className={`text-sm font-extrabold capitalize ${member.status === "active" ? "text-green-300" : "text-amber-300"}`}>{member.status}</p><p className="text-[10px] text-violet-200">Status</p></div>
        </div>
      </div>

      {/* Org info */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Organisation</p>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{ORG_TYPE_ICONS[org?.type] || "🏢"}</span>
          <div>
            <p className="text-sm font-extrabold text-slate-800 dark:text-white">{org?.name}</p>
            <p className="text-[10px] text-slate-400 font-mono">{org?.reg_number}</p>
            <p className="text-[10px] text-slate-400 capitalize">{org?.type?.replace(/_/g, " ")}</p>
          </div>
        </div>
      </div>

      {/* Member details */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">My Details</p>
        {[["Phone", member.phone || "—"], ["Email", member.email || "—"], ["Address", member.address || "—"],
          ["Occupation", member.occupation || "—"], ["Joined", fmtDate(member.joined_date)]].map(([k, v]) => (
          <div key={k} className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
            <span className="text-xs text-slate-400">{k}</span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{v}</span>
          </div>
        ))}
      </div>

      <button onClick={() => { setLoggedIn(false); setMember(null); }}
        className="w-full py-3 border border-red-200 text-red-500 rounded-xl font-bold text-sm">Sign Out</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex justify-center">
      <div className="w-full max-w-md flex flex-col h-full">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
          )}
          <span className="text-xl">{ORG_TYPE_ICONS[org?.type] || "🏢"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{org?.name}</p>
            <p className="text-[10px] text-violet-500 font-bold">Member Portal</p>
          </div>
        </div>

        {/* Bottom nav */}
        <main className="flex-1 overflow-y-auto">
          {tab === "overview" ? overviewContent :
           tab === "savings"  ? <SavingsTab member={member} org={org} onBalanceUpdate={handleBalanceUpdate} /> :
           tab === "loans"    ? <LoansTab   member={member} org={org} /> :
           tab === "meetings" ? <MeetingsTab member={member} org={org} /> : null}
        </main>

        {/* Tab bar (fixed) */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-20 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors ${tab === t.id ? "text-violet-600" : "text-slate-400 dark:text-slate-500"}`}>
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d={t.icon} />
              </svg>
              <span className="text-[9px] font-bold">{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
