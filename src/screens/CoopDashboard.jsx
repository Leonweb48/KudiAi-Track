import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabaseClient";
import AppLogo from "../components/AppLogo";

const coopFn = (action, body = {}) =>
  supabase.functions.invoke("coop-portal", { body: { action, ...body } })
    .then(r => { if (r.error) throw r.error; return r.data; });

const fmt    = n  => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT   = d => d ? new Date(d).toLocaleString("en-NG",  { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const ROLE_COLORS = {
  admin: "bg-violet-100 text-violet-700", president: "bg-amber-100 text-amber-700",
  treasurer: "bg-green-100 text-green-700", secretary: "bg-blue-100 text-blue-700",
  officer: "bg-pink-100 text-pink-700", member: "bg-slate-100 text-slate-600",
};
const STATUS_COLORS = {
  active: "text-green-600", suspended: "text-amber-500", removed: "text-red-500",
  pending: "text-amber-500", approved: "text-blue-600", disbursed: "text-violet-600",
  repaid: "text-green-600", rejected: "text-red-500", defaulted: "text-red-700",
  scheduled: "text-blue-600", ongoing: "text-green-600", completed: "text-slate-500", cancelled: "text-red-500",
};

// ═══════════════════════════════════════════════════
//  OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ org, wallet, onRefresh }) {
  const recentTxns = (wallet?.transactions || []).slice(0, 8);
  return (
    <div className="p-4 pb-24 flex flex-col gap-4">
      {/* Wallet card */}
      <div className="bg-gradient-to-br from-violet-600 to-violet-800 rounded-2xl p-4 text-white">
        <p className="text-xs font-bold text-violet-200 uppercase tracking-wider mb-1">Wallet Balance</p>
        <p className="text-3xl font-black tabular">{fmt(org.wallet_balance)}</p>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/20">
          <div><p className="text-sm font-extrabold text-white">{fmt(org.total_savings)}</p><p className="text-[10px] text-violet-200">Total Savings</p></div>
          <div><p className="text-sm font-extrabold text-white">{fmt(org.total_loans_out)}</p><p className="text-[10px] text-violet-200">Loans Out</p></div>
          <div><p className="text-sm font-extrabold text-white">{org.member_count || 0}</p><p className="text-[10px] text-violet-200">Members</p></div>
        </div>
      </div>

      {/* Org details */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Organisation Details</p>
        <div className="flex flex-col gap-2">
          {[
            ["Reg. Number", org.reg_number],
            ["Type", org.type?.replace(/_/g," ")],
            ["Phone", org.phone || "—"],
            ["Email", org.email || "—"],
            ["Address", org.address || "—"],
            ["State / LGA", [org.state_name, org.lga].filter(Boolean).join(" / ") || "—"],
            ["Registered", fmtDate(org.created_at)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between items-start gap-4">
              <span className="text-xs text-slate-400 flex-shrink-0">{k}</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-right capitalize">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent wallet activity */}
      {recentTxns.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</p>
          <div className="flex flex-col gap-2">
            {recentTxns.map(t => (
              <div key={t.id} className="flex justify-between items-center">
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">{t.type.replace(/_/g, " ")}</p>
                  <p className="text-[10px] text-slate-400">{fmtDT(t.created_at)}</p>
                </div>
                <p className={`text-xs font-extrabold tabular ${t.type.includes("withdrawal") || t.type.includes("disbursement") ? "text-red-500" : "text-green-600"}`}>
                  {t.type.includes("withdrawal") || t.type.includes("disbursement") ? "−" : "+"}{fmt(t.amount)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MEMBERS TAB
// ═══════════════════════════════════════════════════
function MembersTab({ org, members, onRefresh }) {
  const [showAdd,   setShowAdd]   = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [search,    setSearch]    = useState("");
  const [form,      setForm]      = useState({ full_name: "", email: "", phone: "", role: "member", address: "", occupation: "" });
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [saving,    setSaving]    = useState(false);

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const filtered = members.filter(m =>
    m.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    m.membership_id?.toLowerCase().includes(search.toLowerCase()) ||
    m.phone?.includes(search)
  );

  const handleAdd = async () => {
    if (!form.full_name.trim()) { setError("Full name required"); return; }
    setLoading(true); setError("");
    try {
      await coopFn("add-member", { org_id: org.id, ...form });
      setShowAdd(false);
      setForm({ full_name: "", email: "", phone: "", role: "member", address: "", occupation: "" });
      onRefresh();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setLoading(false); }
  };

  const handleStatus = async (member, status, reason = "") => {
    setSaving(true);
    try {
      await coopFn("update-member", { member_id: member.id, org_id: org.id, status, suspension_reason: reason });
      setSelected(null); onRefresh();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";

  return (
    <div className="flex flex-col h-full">
      {/* Search + Add bar */}
      <div className="px-4 pt-4 pb-2 flex gap-2">
        <div className="flex-1 relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <button onClick={() => setShowAdd(true)}
          className="px-4 py-2.5 bg-violet-600 text-white rounded-xl text-xs font-bold flex-shrink-0">+ Add</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No members found</div>
        ) : (
          <div className="flex flex-col gap-2 mt-2">
            {filtered.map(m => (
              <button key={m.id} onClick={() => setSelected(m)}
                className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex items-center gap-3 text-left w-full">
                <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-sm font-extrabold text-violet-600 flex-shrink-0">
                  {m.full_name?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{m.full_name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{m.membership_id}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${ROLE_COLORS[m.role] || ROLE_COLORS.member}`}>{m.role}</span>
                    <span className={`text-[9px] font-bold capitalize ${STATUS_COLORS[m.status]}`}>● {m.status}</span>
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

      {/* Add member modal */}
      {showAdd && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[90vh] overflow-y-auto">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Add Member</h3>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
            <div className="flex flex-col gap-3">
              {[["Full Name *", "full_name", "text", "John Adeyemi"], ["Phone", "phone", "tel", "08012345678"],
                ["Email", "email", "email", "john@email.com"], ["Address", "address", "text", "Street address"],
                ["Occupation", "occupation", "text", "Trader"]].map(([label, key, type, ph]) => (
                <div key={key}>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">{label}</label>
                  <input className={input} type={type} value={form[key]} onChange={set(key)} placeholder={ph} />
                </div>
              ))}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Role</label>
                <select className={input} value={form.role} onChange={set("role")}>
                  {["member","officer","secretary","treasurer","president","admin"].map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => { setShowAdd(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={handleAdd} disabled={loading} className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{loading ? "Adding…" : "Add Member"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Member detail modal */}
      {selected && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[85vh] overflow-y-auto">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center text-xl font-extrabold text-violet-600">{selected.full_name?.charAt(0)}</div>
              <div>
                <p className="text-base font-extrabold text-slate-800 dark:text-white">{selected.full_name}</p>
                <p className="text-xs text-slate-400 font-mono">{selected.membership_id}</p>
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-3 mb-4 grid grid-cols-2 gap-2">
              {[["Role", selected.role], ["Status", selected.status], ["Phone", selected.phone || "—"],
                ["Email", selected.email || "—"], ["Joined", fmtDate(selected.joined_date)],
                ["Savings", fmt(selected.savings_balance)]].map(([k, v]) => (
                <div key={k}><p className="text-[10px] text-slate-400">{k}</p><p className="text-xs font-bold text-slate-800 dark:text-white capitalize">{v}</p></div>
              ))}
            </div>
            {/* Portal link */}
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3 mb-4">
              <p className="text-[11px] font-bold text-violet-600 mb-1">Member Portal Link</p>
              <p className="text-[10px] text-slate-500 break-all">
                {window.location.origin}/?coop_token={selected.portal_token}
              </p>
              <button onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/?coop_token=${selected.portal_token}`)}
                className="mt-2 text-[10px] font-bold text-violet-600 bg-violet-100 px-2 py-1 rounded-lg">Copy Link</button>
            </div>
            <div className="flex flex-col gap-2">
              {selected.status !== "suspended" && selected.status !== "removed" && (
                <button onClick={() => { const r = prompt("Reason for suspension?"); if (r !== null) handleStatus(selected, "suspended", r); }}
                  disabled={saving} className="w-full py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-bold text-sm">Suspend Member</button>
              )}
              {selected.status === "suspended" && (
                <button onClick={() => handleStatus(selected, "active")} disabled={saving}
                  className="w-full py-2.5 bg-green-50 text-green-700 border border-green-200 rounded-xl font-bold text-sm">Reactivate Member</button>
              )}
              {selected.status !== "removed" && (
                <button onClick={() => { if (window.confirm("Remove this member?")) handleStatus(selected, "removed"); }}
                  disabled={saving} className="w-full py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-sm">Remove Member</button>
              )}
              <button onClick={() => setSelected(null)} className="w-full py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  SAVINGS TAB
// ═══════════════════════════════════════════════════
function SavingsTab({ org, members, onRefresh }) {
  const [savings,    setSavings]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showRecord, setShowRecord] = useState(false);
  const [form,       setForm]       = useState({ member_id: "", amount: "", type: "deposit", payment_method: "cash", notes: "" });
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");

  const load = useCallback(() => {
    coopFn("get-savings", { org_id: org.id }).then(r => setSavings(r.savings || [])).finally(() => setLoading(false));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleRecord = async () => {
    if (!form.member_id || !form.amount) { setError("Member and amount required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("record-saving", { org_id: org.id, ...form, amount: parseFloat(form.amount) });
      setShowRecord(false); setForm({ member_id: "", amount: "", type: "deposit", payment_method: "cash", notes: "" });
      load(); onRefresh();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const activeMembers = members.filter(m => m.status === "active");
  const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{savings.length} record{savings.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowRecord(true)} className="px-4 py-2.5 bg-green-600 text-white rounded-xl text-xs font-bold">+ Record</button>
      </div>

      {/* Member savings summary */}
      <div className="px-4 pb-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {activeMembers.slice(0, 8).map(m => (
            <div key={m.id} className="flex-shrink-0 bg-white dark:bg-slate-800 rounded-xl p-2.5 border border-slate-100 dark:border-slate-700 text-center min-w-[80px]">
              <p className="text-xs font-extrabold text-green-600">{fmt(m.savings_balance)}</p>
              <p className="text-[9px] text-slate-400 truncate mt-0.5 max-w-[76px]">{m.full_name?.split(" ")[0]}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : savings.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No savings recorded yet</div>
        ) : (
          <div className="flex flex-col gap-2">
            {savings.map(s => (
              <div key={s.id} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-white">{s.org_members?.full_name || "—"}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{s.org_members?.membership_id}</p>
                  <p className="text-[10px] text-slate-400">{fmtDT(s.created_at)} · {s.payment_method}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-extrabold ${s.type === "withdrawal" ? "text-red-500" : "text-green-600"}`}>
                    {s.type === "withdrawal" ? "−" : "+"}{fmt(s.amount)}
                  </p>
                  <p className="text-[10px] text-slate-400">Bal: {fmt(s.balance_after)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showRecord && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Record Savings</h3>
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
                  {["cash","transfer","paystack"].map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase()+m.slice(1)}</option>)}
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
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  LOANS TAB
// ═══════════════════════════════════════════════════
function LoansTab({ org, members, onRefresh }) {
  const [loans,     setLoans]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showApply, setShowApply] = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [repayForm, setRepayForm] = useState({ amount: "", payment_method: "cash", notes: "" });
  const [form,      setForm]      = useState({ member_id: "", amount_requested: "", interest_rate: "0", loan_purpose: "", repayment_months: "1", notes: "" });
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");

  const load = useCallback(() => {
    coopFn("get-loans", { org_id: org.id }).then(r => setLoans(r.loans || [])).finally(() => setLoading(false));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const setR = k => e => setRepayForm(p => ({ ...p, [k]: e.target.value }));

  const handleApply = async () => {
    if (!form.member_id || !form.amount_requested) { setError("Member and amount required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("apply-loan", { org_id: org.id, ...form });
      setShowApply(false);
      setForm({ member_id: "", amount_requested: "", interest_rate: "0", loan_purpose: "", repayment_months: "1", notes: "" });
      load();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleLoanAction = async (loan, newStatus, extra = {}) => {
    setSaving(true);
    try {
      await coopFn("update-loan", { loan_id: loan.id, org_id: org.id, status: newStatus, amount_approved: loan.amount_approved || loan.amount_requested, ...extra });
      setSelected(null); load(); onRefresh();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleRepay = async () => {
    if (!repayForm.amount) { setError("Amount required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("record-repayment", { org_id: org.id, loan_id: selected.id, member_id: selected.member_id, ...repayForm, amount: parseFloat(repayForm.amount) });
      setSelected(null); load(); onRefresh();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const activeMembers = members.filter(m => m.status === "active");
  const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <div>
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{loans.filter(l => l.status === "pending").length} pending · {loans.filter(l => l.status === "disbursed").length} active</p>
        </div>
        <button onClick={() => setShowApply(true)} className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-bold">+ New Loan</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : loans.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">No loans yet</div>
        ) : (
          <div className="flex flex-col gap-2">
            {loans.map(l => (
              <button key={l.id} onClick={() => setSelected(l)}
                className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex justify-between items-start text-left w-full">
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-white">{l.org_members?.full_name || "—"}</p>
                  <p className="text-[10px] text-slate-400">{l.loan_purpose || "General loan"} · {fmtDate(l.applied_at)}</p>
                  <span className={`text-[10px] font-bold capitalize ${STATUS_COLORS[l.status]}`}>● {l.status}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold text-amber-600">{fmt(l.amount_requested)}</p>
                  {l.outstanding_balance > 0 && <p className="text-[10px] text-red-500">Out: {fmt(l.outstanding_balance)}</p>}
                  {l.due_date && <p className="text-[10px] text-slate-400">Due: {fmtDate(l.due_date)}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Apply loan modal */}
      {showApply && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[90vh] overflow-y-auto">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
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
                  <input className={input} type="number" value={form.interest_rate} onChange={set("interest_rate")} placeholder="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Repay Months</label>
                  <input className={input} type="number" value={form.repayment_months} onChange={set("repayment_months")} placeholder="1" min="1" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Purpose</label>
                  <input className={input} value={form.loan_purpose} onChange={set("loan_purpose")} placeholder="Business, Medical…" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setShowApply(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={handleApply} disabled={saving} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Creating…" : "Submit"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Loan detail modal */}
      {selected && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[88vh] overflow-y-auto">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <div className="flex justify-between mb-3">
              <div>
                <p className="text-base font-extrabold text-slate-800 dark:text-white">{selected.org_members?.full_name}</p>
                <p className="text-xs text-slate-400">{selected.loan_purpose || "General loan"}</p>
              </div>
              <span className={`text-xs font-bold capitalize ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-3 mb-4 grid grid-cols-2 gap-2">
              {[["Requested", fmt(selected.amount_requested)], ["Approved", fmt(selected.amount_approved || selected.amount_requested)],
                ["Outstanding", fmt(selected.outstanding_balance)], ["Interest", `${selected.interest_rate}%`],
                ["Applied", fmtDate(selected.applied_at)], ["Due Date", fmtDate(selected.due_date)]].map(([k, v]) => (
                <div key={k}><p className="text-[10px] text-slate-400">{k}</p><p className="text-xs font-bold text-slate-800 dark:text-white">{v}</p></div>
              ))}
            </div>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}

            {selected.status === "pending" && (
              <div className="flex gap-2 mb-3">
                <button onClick={() => handleLoanAction(selected, "approved", { approved_by_name: "Admin" })} disabled={saving}
                  className="flex-1 py-2.5 bg-green-50 text-green-700 border border-green-200 rounded-xl font-bold text-sm">Approve</button>
                <button onClick={() => handleLoanAction(selected, "rejected")} disabled={saving}
                  className="flex-1 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-sm">Reject</button>
              </div>
            )}
            {selected.status === "approved" && (
              <button onClick={() => handleLoanAction(selected, "disbursed", { repayment_months: selected.repayment_months })} disabled={saving}
                className="w-full py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm mb-3">Disburse Loan</button>
            )}
            {selected.status === "disbursed" && selected.outstanding_balance > 0 && (
              <div className="mb-3">
                <p className="text-xs font-bold text-slate-500 mb-2">Record Repayment</p>
                <div className="flex gap-2">
                  <input value={repayForm.amount} onChange={setR("amount")} type="number" placeholder="Amount" className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                  <button onClick={handleRepay} disabled={saving} className="px-4 py-2 bg-amber-500 text-white rounded-xl font-bold text-sm">{saving ? "…" : "Pay"}</button>
                </div>
              </div>
            )}
            <button onClick={() => { setSelected(null); setError(""); setRepayForm({ amount: "", payment_method: "cash", notes: "" }); }}
              className="w-full py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MEETINGS TAB
// ═══════════════════════════════════════════════════
function MeetingsTab({ org, members }) {
  const [meetings,    setMeetings]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [attendance,  setAttendance]  = useState([]);
  const [present,     setPresent]     = useState(new Set());
  const [saving,      setSaving]      = useState(false);
  const [form,        setForm]        = useState({ title: "", description: "", meeting_type: "general", scheduled_at: "", location: "" });
  const [error,       setError]       = useState("");

  const load = useCallback(() => {
    coopFn("get-meetings", { org_id: org.id }).then(r => setMeetings(r.meetings || [])).finally(() => setLoading(false));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleCreate = async () => {
    if (!form.title || !form.scheduled_at) { setError("Title and date are required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("create-meeting", { org_id: org.id, ...form });
      setShowCreate(false); setForm({ title: "", description: "", meeting_type: "general", scheduled_at: "", location: "" }); load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const openMeeting = async (meeting) => {
    setSelected(meeting);
    const { attendance: att } = await coopFn("get-attendance", { meeting_id: meeting.id });
    setAttendance(att || []);
    const presentSet = new Set((att || []).filter(a => a.status === "present").map(a => a.member_id));
    // Pre-mark all active members as absent; check present ones
    const allActive = members.filter(m => m.status === "active").map(m => m.id);
    allActive.forEach(id => { if (!presentSet.has(id)) presentSet.delete(id); });
    setPresent(presentSet);
  };

  const togglePresence = (id) => setPresent(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submitAttendance = async () => {
    setSaving(true);
    const activeIds = members.filter(m => m.status === "active").map(m => m.id);
    const present_ids = activeIds.filter(id => present.has(id));
    const absent_ids  = activeIds.filter(id => !present.has(id));
    try {
      await coopFn("bulk-attendance", { meeting_id: selected.id, org_id: org.id, present_ids, absent_ids });
      setSelected(null); load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";
  const activeMembers = members.filter(m => m.status === "active");

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{meetings.length} meeting{meetings.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold">+ Schedule</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          : meetings.length === 0 ? <div className="text-center py-12 text-slate-400 text-sm">No meetings scheduled yet</div>
          : (
            <div className="flex flex-col gap-2">
              {meetings.map(m => (
                <button key={m.id} onClick={() => openMeeting(m)}
                  className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-left w-full">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{m.title}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{fmtDT(m.scheduled_at)}</p>
                      {m.location && <p className="text-[10px] text-slate-400">📍 {m.location}</p>}
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-bold capitalize ${STATUS_COLORS[m.status]}`}>{m.status}</span>
                      <p className="text-[10px] text-slate-400 mt-0.5 capitalize">{m.meeting_type}</p>
                    </div>
                  </div>
                  {/* QR token hint */}
                  <div className="mt-2 bg-slate-50 dark:bg-slate-700 rounded-lg px-2 py-1">
                    <p className="text-[10px] text-slate-400 font-mono truncate">QR: {window.location.origin}/?coop_qr={m.qr_token}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Schedule Meeting</h3>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Title *</label>
                <input className={input} value={form.title} onChange={set("title")} placeholder="Monthly General Meeting" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Type</label>
                  <select className={input} value={form.meeting_type} onChange={set("meeting_type")}>
                    {["general","board","special","agm"].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date & Time *</label>
                  <input className={input} type="datetime-local" value={form.scheduled_at} onChange={set("scheduled_at")} />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Location</label>
                <input className={input} value={form.location} onChange={set("location")} placeholder="Community Hall" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setShowCreate(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Creating…" : "Schedule"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance modal */}
      {selected && (
        <div className="fixed inset-0 z-[75] bg-slate-900/80 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[90vh] flex flex-col">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <p className="text-base font-extrabold text-slate-800 dark:text-white mb-1">{selected.title}</p>
            <p className="text-xs text-slate-400 mb-4">{fmtDT(selected.scheduled_at)} · Tap to mark present/absent</p>
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col gap-2">
                {activeMembers.map(m => (
                  <button key={m.id} onClick={() => togglePresence(m.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition ${present.has(m.id) ? "border-green-400 bg-green-50 dark:bg-green-900/20" : "border-slate-200 dark:border-slate-600"}`}>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${present.has(m.id) ? "bg-green-500 border-green-500" : "border-slate-300"}`}>
                      {present.has(m.id) && <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="white" strokeWidth={3} strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-slate-800 dark:text-white">{m.full_name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{m.membership_id}</p>
                    </div>
                    <span className={`text-[10px] font-bold ${present.has(m.id) ? "text-green-600" : "text-slate-400"}`}>{present.has(m.id) ? "Present" : "Absent"}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
              <p className="text-xs text-slate-500">{present.size} present / {activeMembers.length - present.size} absent</p>
              <div className="flex gap-2">
                <button onClick={() => setSelected(null)} className="px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
                <button onClick={submitAttendance} disabled={saving} className="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : "Submit"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  WALLET TAB
// ═══════════════════════════════════════════════════
function WalletTab({ org, wallet, onRefresh }) {
  const txns = wallet?.transactions || [];
  const byMonth = {};
  txns.forEach(t => {
    const key = new Date(t.created_at).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
    if (!byMonth[key]) byMonth[key] = { in: 0, out: 0 };
    if (t.type.includes("withdrawal") || t.type.includes("disbursement")) byMonth[key].out += t.amount;
    else byMonth[key].in += t.amount;
  });
  const months = Object.entries(byMonth).slice(0, 3);

  return (
    <div className="p-4 pb-24 flex flex-col gap-4">
      {/* Balance card */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 text-white">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Community Wallet</p>
        <p className="text-3xl font-black tabular">{fmt(org.wallet_balance)}</p>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/10">
          <div><p className="text-sm font-extrabold text-green-400">{fmt(org.total_savings)}</p><p className="text-[10px] text-slate-400">Savings Pool</p></div>
          <div><p className="text-sm font-extrabold text-amber-400">{fmt(org.total_loans_out)}</p><p className="text-[10px] text-slate-400">Loans Out</p></div>
          <div><p className="text-sm font-extrabold text-blue-400">{txns.length}</p><p className="text-[10px] text-slate-400">Transactions</p></div>
        </div>
      </div>

      {/* Monthly summary */}
      {months.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Monthly Summary</p>
          {months.map(([month, data]) => (
            <div key={month} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{month}</p>
              <div className="flex gap-3">
                <span className="text-xs font-bold text-green-600">+{fmt(data.in)}</span>
                <span className="text-xs font-bold text-red-500">−{fmt(data.out)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Transaction history */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Transaction History</p>
        {txns.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No transactions yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {txns.map(t => (
              <div key={t.id} className="flex justify-between items-start py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">{t.type.replace(/_/g, " ")}</p>
                  <p className="text-[10px] text-slate-400">{fmtDT(t.created_at)}</p>
                  {t.description && <p className="text-[10px] text-slate-400 truncate max-w-[180px]">{t.description}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-extrabold tabular ${t.type.includes("withdrawal") || t.type.includes("disbursement") ? "text-red-500" : "text-green-600"}`}>
                    {t.type.includes("withdrawal") || t.type.includes("disbursement") ? "−" : "+"}{fmt(t.amount)}
                  </p>
                  <p className="text-[10px] text-slate-400">Bal: {fmt(t.balance_after)}</p>
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
//  MAIN DASHBOARD
// ═══════════════════════════════════════════════════
const TABS = [
  { id: "overview",  label: "Overview", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "members",   label: "Members",  icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "savings",   label: "Savings",  icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "loans",     label: "Loans",    icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
  { id: "meetings",  label: "Meetings", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "wallet",    label: "Wallet",   icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
];

export default function CoopDashboard({ org: initialOrg, onBack }) {
  const [tab,      setTab]      = useState("overview");
  const [org,      setOrg]      = useState(initialOrg);
  const [members,  setMembers]  = useState([]);
  const [wallet,   setWallet]   = useState(null);
  const [loading,  setLoading]  = useState(true);

  const loadAll = useCallback(() => {
    Promise.all([
      coopFn("get-org",     { org_id: org.id }),
      coopFn("get-members", { org_id: org.id }),
      coopFn("get-wallet",  { org_id: org.id }),
    ]).then(([orgR, memR, walR]) => {
      setOrg(orgR.org || org);
      setMembers(memR.members || []);
      setWallet(walR);
    }).catch(console.error).finally(() => setLoading(false));
  }, [org.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const tabContent = {
    overview: <OverviewTab org={org} wallet={wallet} onRefresh={loadAll} />,
    members:  <MembersTab  org={org} members={members} onRefresh={loadAll} />,
    savings:  <SavingsTab  org={org} members={members} onRefresh={loadAll} />,
    loans:    <LoansTab    org={org} members={members} onRefresh={loadAll} />,
    meetings: <MeetingsTab org={org} members={members} />,
    wallet:   <WalletTab   org={org} wallet={wallet}  onRefresh={loadAll} />,
  };

  const ORG_TYPES = { cooperative: "🤝", market_association: "🏪", church: "⛪", ngo: "🌍", youth_group: "👥", savings_group: "💰" };

  return (
    <div className="fixed inset-0 z-[65] bg-slate-50 dark:bg-slate-900 flex justify-center">
      <div className="w-full max-w-md flex flex-col h-full">

        {/* Header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <span className="text-xl">{ORG_TYPES[org.type] || "🏢"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{org.name}</p>
            <p className="text-[10px] text-slate-400 font-mono">{org.reg_number}</p>
          </div>
          {loading && <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
        </div>

        {/* Tab bar */}
        <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
          <div className="flex min-w-max">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex flex-col items-center gap-0.5 px-4 py-2.5 border-b-2 transition-colors ${tab === t.id ? "border-violet-600 text-violet-600" : "border-transparent text-slate-400 dark:text-slate-500"}`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d={t.icon} />
                </svg>
                <span className="text-[9px] font-bold whitespace-nowrap">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <main className="flex-1 overflow-y-auto">
          {tabContent[tab]}
        </main>
      </div>
    </div>
  );
}
