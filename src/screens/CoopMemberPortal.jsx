import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

const coopFn = (action, body = {}) =>
  supabase.functions.invoke("coop-portal", { body: { action, ...body } })
    .then(r => { if (r.error) throw r.error; return r.data; });

const fmt     = n => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT   = d => d ? new Date(d).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const inp = "w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";

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
//  CHANGE-PIN SCREEN
// ═══════════════════════════════════════════════════
function ChangePinScreen({ member, onDone }) {
  const [current, setCurrent]   = useState("");
  const [next,    setNext]      = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error,   setError]     = useState("");

  const handleSubmit = async () => {
    if (next.length !== 4 || !/^\d{4}$/.test(next)) { setError("New PIN must be exactly 4 digits"); return; }
    if (next !== confirm) { setError("PINs do not match"); return; }
    setLoading(true); setError("");
    try {
      await coopFn("change-member-pin", { member_id: member.id, current_pin: current, new_pin: next });
      onDone();
    } catch (e) { setError(e.message || "Failed to change PIN"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="w-16 h-16 bg-amber-100 rounded-3xl flex items-center justify-center text-3xl mb-5">🔐</div>
      <h2 className="text-xl font-extrabold text-white mb-1">Change Your PIN</h2>
      <p className="text-sm text-slate-400 text-center mb-8">For your security, please set a new 4-digit PIN before you continue.</p>
      {error && <div className="w-full max-w-xs bg-red-900/40 border border-red-500/40 rounded-2xl px-4 py-3 mb-4 text-sm text-red-300 text-center">{error}</div>}
      <div className="w-full max-w-xs flex flex-col gap-4 mb-8">
        <div>
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Current PIN</label>
          <input className={inp} type="password" inputMode="numeric" pattern="\d*" maxLength={4}
            value={current} onChange={e => setCurrent(e.target.value.replace(/\D/g, ""))} placeholder="• • • •" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">New PIN (4 digits)</label>
          <input className={inp} type="password" inputMode="numeric" pattern="\d*" maxLength={4}
            value={next} onChange={e => setNext(e.target.value.replace(/\D/g, ""))} placeholder="• • • •" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Confirm New PIN</label>
          <input className={inp} type="password" inputMode="numeric" pattern="\d*" maxLength={4}
            value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, ""))} placeholder="• • • •" />
        </div>
      </div>
      <button onClick={handleSubmit} disabled={loading}
        className="w-full max-w-xs py-4 bg-violet-600 text-white rounded-2xl font-extrabold text-base disabled:opacity-50">
        {loading ? "Saving…" : "Set New PIN"}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  LOGIN SCREEN
// ═══════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [membershipId, setMembershipId] = useState("");
  const [pin,          setPin]          = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  const handleLogin = async () => {
    if (!membershipId.trim() || !pin.trim()) { setError("Enter your membership ID and PIN"); return; }
    setLoading(true); setError("");
    try {
      const result = await coopFn("member-auth", { membership_id: membershipId.trim().toUpperCase(), pin });
      onLogin(result.member, result.org);
    } catch (e) { setError(e.message || "Invalid credentials"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900 flex flex-col items-center justify-center px-6">
      <div className="text-6xl mb-6">🏛️</div>
      <h2 className="text-2xl font-extrabold text-white mb-1">Member Portal</h2>
      <p className="text-sm text-slate-400 mb-10">Sign in with your membership credentials</p>
      {error && <div className="w-full max-w-xs bg-red-900/40 border border-red-500/40 rounded-2xl px-4 py-3 mb-5 text-sm text-red-300 text-center">{error}</div>}
      <div className="w-full max-w-xs flex flex-col gap-4 mb-6">
        <div>
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Membership ID</label>
          <input className={inp} type="text" value={membershipId} onChange={e => setMembershipId(e.target.value)}
            placeholder="e.g. COOP-0001" autoCapitalize="characters" autoComplete="username" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">PIN</label>
          <input className={inp} type="password" inputMode="numeric" pattern="\d*" maxLength={4}
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} placeholder="• • • •" autoComplete="current-password" />
        </div>
      </div>
      <button onClick={handleLogin} disabled={loading}
        className="w-full max-w-xs py-4 bg-violet-600 text-white rounded-2xl font-extrabold text-base mb-4 disabled:opacity-50">
        {loading ? "Signing in…" : "Sign In"}
      </button>
      <p className="text-xs text-slate-500 text-center max-w-xs">Lost your PIN or ID? Contact your organisation administrator to reset your access.</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  HOME TAB
// ═══════════════════════════════════════════════════
function HomeTab({ member, org, announcements, onSignOut }) {
  return (
    <div className="p-4 pb-28 flex flex-col gap-4">
      <div className="bg-gradient-to-br from-violet-600 to-violet-800 rounded-3xl p-5 text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-extrabold">
            {member.full_name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-extrabold text-base">{member.full_name}</p>
            <p className="text-xs text-violet-200 font-mono">{member.membership_id}</p>
            <p className="text-[10px] text-violet-200 capitalize">{member.role}</p>
          </div>
        </div>
        <div className="flex justify-between items-end">
          <div>
            <p className="text-xs text-violet-200 mb-0.5">Your Savings Balance</p>
            <p className="text-3xl font-black tabular">{fmt(member.savings_balance)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-violet-200 mb-0.5">Member since</p>
            <p className="text-sm font-bold">{fmtDate(member.joined_date)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
          {ORG_TYPE_ICONS[org.type] || "🏢"} {org.name}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[["Total Funds", org.total_savings, "text-green-600"],
            ["Active Loans", org.total_loans_out, "text-amber-600"],
            ["Members", org.member_count, "text-violet-600"]].map(([label, val, color]) => (
            <div key={label} className="text-center bg-slate-50 dark:bg-slate-700 rounded-xl p-2">
              <p className={`text-sm font-extrabold tabular ${color}`}>{label === "Members" ? val : fmt(val)}</p>
              <p className="text-[9px] text-slate-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {announcements.filter(a => a.is_pinned).length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">📌 Pinned</p>
          {announcements.filter(a => a.is_pinned).map(a => (
            <div key={a.id} className={`rounded-2xl p-3 border mb-2 last:mb-0 ${ANN_COLORS[a.type] || ANN_COLORS.announcement}`}>
              <p className="text-xs font-extrabold">{ANN_ICONS[a.type]} {a.title}</p>
              <p className="text-[11px] mt-1 opacity-80 line-clamp-2">{a.body}</p>
            </div>
          ))}
        </div>
      )}

      {announcements.filter(a => !a.is_pinned).length > 0 && (
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Recent</p>
          {announcements.filter(a => !a.is_pinned).slice(0, 3).map(a => (
            <div key={a.id} className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-slate-700 mb-1.5 last:mb-0">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{ANN_ICONS[a.type]} {a.title}</p>
              <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{a.body}</p>
            </div>
          ))}
        </div>
      )}

      <button onClick={onSignOut} className="w-full py-3 border border-red-200 text-red-500 rounded-2xl font-bold text-sm mt-2">Sign Out</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  CONTRIBUTIONS TAB
// ═══════════════════════════════════════════════════
function ContributionsTab({ member, org }) {
  const [programs, setPrograms] = useState([]);
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(() => {
    Promise.all([
      coopFn("member-get-programs", { member_id: member.id, org_id: org.id }),
      coopFn("member-get-savings",  { member_id: member.id }),
    ]).then(([pr, sr]) => {
      setPrograms(pr.programs || []);
      setHistory(sr.savings || []);
    }).finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;

  const totalContributed = history.filter(h => h.type === "deposit").reduce((sum, h) => sum + Number(h.amount), 0);

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
                  <p className={`text-[10px] font-bold mt-1 ${m.my_attendance.status === "present" ? "text-green-600" : "text-red-500"}`}>
                    {m.my_attendance.status === "present" ? "✓ Present" : "✗ Absent"}
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
                const isActive = m.my_rsvp?.status === opt.status;
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
    privacy_balance:      selfMember.privacy_balance,
    privacy_contributions: selfMember.privacy_contributions,
    privacy_activities:   selfMember.privacy_activities,
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
//  MESSAGES TAB
// ═══════════════════════════════════════════════════
function MessagesTab({ member, org }) {
  const [announcements, setAnnouncements] = useState([]);
  const [loading,       setLoading]       = useState(true);

  const load = useCallback(() => {
    coopFn("member-get-announcements", { member_id: member.id, org_id: org.id })
      .then(r => setAnnouncements(r.announcements || []))
      .finally(() => setLoading(false));
  }, [member.id, org.id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-16"><div className="w-8 h-8 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 pb-28 flex flex-col gap-3">
      {announcements.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <span className="text-5xl mb-4">📭</span>
          <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">No Messages</p>
          <p className="text-sm text-slate-400">No announcements from your organisation yet.</p>
        </div>
      ) : (
        <>
          {announcements.filter(a => a.type === "emergency").map(a => (
            <div key={a.id} className="rounded-2xl p-4 border-2 border-red-400 bg-red-50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🚨</span>
                <p className="text-sm font-extrabold text-red-700">EMERGENCY NOTICE</p>
              </div>
              <p className="text-sm font-bold text-red-800 mb-1">{a.title}</p>
              <p className="text-xs text-red-700 leading-relaxed">{a.body}</p>
              <p className="text-[10px] text-red-500 mt-2">{a.author_name} · {fmtDate(a.created_at)}</p>
            </div>
          ))}
          {announcements.filter(a => a.type !== "emergency").map(a => (
            <div key={a.id} className={`rounded-2xl p-4 border ${ANN_COLORS[a.type] || ANN_COLORS.announcement}`}>
              <div className="flex justify-between items-start gap-2 mb-1">
                <p className="text-sm font-extrabold flex-1">{ANN_ICONS[a.type]} {a.title}</p>
                {a.is_pinned && <span className="text-[9px] font-bold bg-white/60 px-1.5 py-0.5 rounded-full flex-shrink-0">📌 Pinned</span>}
              </div>
              <p className="text-xs opacity-80 leading-relaxed mb-2">{a.body}</p>
              <p className="text-[10px] opacity-60">{a.author_name} · {fmtDate(a.created_at)}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MAIN PORTAL
// ═══════════════════════════════════════════════════
const PORTAL_TABS = [
  { id: "home",          label: "Home",     icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "contributions", label: "Savings",  icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "loans",         label: "Loans",    icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
  { id: "meetings",      label: "Meetings", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "directory",     label: "Directory",icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "messages",      label: "Messages", icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
];

export default function CoopMemberPortal({ coopToken }) {
  const [member,        setMember]        = useState(null);
  const [org,           setOrg]           = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [tab,           setTab]           = useState("home");
  const [initializing,  setInitializing]  = useState(true);
  const [changingPin,   setChangingPin]   = useState(false);

  useEffect(() => {
    if (!coopToken) { setInitializing(false); return; }
    coopFn("member-by-token", { portal_token: coopToken })
      .then(r => {
        if (r?.member) {
          setMember(r.member);
          setOrg(r.org);
          if (r.member.must_change_pin) { setChangingPin(true); }
          return coopFn("member-get-announcements", { member_id: r.member.id, org_id: r.org.id });
        }
        return null;
      })
      .then(r => { if (r) setAnnouncements(r.announcements || []); })
      .catch(console.error)
      .finally(() => setInitializing(false));
  }, [coopToken]);

  const handleLogin = (m, o) => {
    setMember(m);
    setOrg(o);
    if (m.must_change_pin) { setChangingPin(true); return; }
    coopFn("member-get-announcements", { member_id: m.id, org_id: o.id })
      .then(r => setAnnouncements(r.announcements || [])).catch(console.error);
  };

  const handleSignOut = () => { setMember(null); setOrg(null); setAnnouncements([]); setTab("home"); };

  const handlePinChanged = () => {
    setChangingPin(false);
    setMember(prev => ({ ...prev, must_change_pin: false }));
    if (org && member) {
      coopFn("member-get-announcements", { member_id: member.id, org_id: org.id })
        .then(r => setAnnouncements(r.announcements || [])).catch(console.error);
    }
  };

  if (initializing) return (
    <div className="fixed inset-0 z-[70] bg-slate-900 flex flex-col items-center justify-center">
      <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-slate-400 text-sm">Loading portal…</p>
    </div>
  );

  if (!member) return <LoginScreen onLogin={handleLogin} />;
  if (changingPin) return <ChangePinScreen member={member} onDone={handlePinChanged} />;

  const tabContent = {
    home:          <HomeTab member={member} org={org} announcements={announcements} onSignOut={handleSignOut} />,
    contributions: <ContributionsTab member={member} org={org} />,
    loans:         <LoansTab member={member} org={org} />,
    meetings:      <MeetingsTab member={member} org={org} />,
    directory:     <DirectoryTab member={member} org={org} />,
    messages:      <MessagesTab member={member} org={org} />,
  };

  const emergencyCount = announcements.filter(a => a.type === "emergency").length;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-50 dark:bg-slate-900 flex justify-center">
      <div className="w-full max-w-md flex flex-col h-full">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center font-extrabold text-violet-600 flex-shrink-0">
            {member.full_name?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{member.full_name}</p>
            <p className="text-[10px] text-slate-400">{org?.name}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-extrabold text-green-600">{fmt(member.savings_balance)}</p>
            <p className="text-[9px] text-slate-400">savings</p>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto">
          {tabContent[tab]}
        </main>

        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 pb-safe">
          <div className="flex">
            {PORTAL_TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors relative ${tab === t.id ? "text-violet-600" : "text-slate-400 dark:text-slate-500"}`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d={t.icon} />
                </svg>
                <span className="text-[9px] font-bold">{t.label}</span>
                {t.id === "messages" && emergencyCount > 0 && (
                  <span className="absolute top-1.5 right-1/2 translate-x-3 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
