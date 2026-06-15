import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

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
  admin: "bg-violet-100 text-violet-700", president: "bg-amber-100 text-amber-700",
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
  pending: "text-amber-500", approved: "text-blue-600", disbursed: "text-violet-600",
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

const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-400";
const ModalWrap = ({ children, onClose }) => (
  <div className="fixed inset-0 z-[75] bg-black/60 flex items-end justify-center" onClick={onClose}>
    <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-5" />
      {children}
    </div>
  </div>
);

// ═══════════════════════════════════════════════════
//  OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ org, wallet, programs, announcements }) {
  const recentTxns = (wallet?.transactions || []).slice(0, 6);
  return (
    <div className="p-4 pb-24 flex flex-col gap-4">
      <div className="bg-gradient-to-br from-violet-600 to-violet-800 rounded-2xl p-4 text-white">
        <p className="text-xs font-bold text-violet-200 uppercase tracking-wider mb-1">Organisation Wallet</p>
        <p className="text-3xl font-black tabular">{fmt(org.wallet_balance)}</p>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/20">
          <div><p className="text-sm font-extrabold">{fmt(org.total_savings)}</p><p className="text-[10px] text-violet-200">Total Savings</p></div>
          <div><p className="text-sm font-extrabold">{fmt(org.total_loans_out)}</p><p className="text-[10px] text-violet-200">Loans Out</p></div>
          <div><p className="text-sm font-extrabold">{org.member_count || 0}</p><p className="text-[10px] text-violet-200">Members</p></div>
        </div>
      </div>

      {programs.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Active Programs</p>
          {programs.filter(p => p.status === "active").slice(0, 4).map(p => (
            <div key={p.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
              <div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{p.name}</p>
                <p className="text-[10px] text-slate-400 capitalize">{FREQ_LABELS[p.frequency]} · {p.contribution_type === "fixed" ? fmt(p.amount) : "Voluntary"}</p>
              </div>
              <p className="text-xs font-extrabold text-green-600">{fmt(p.total_collected)}</p>
            </div>
          ))}
        </div>
      )}

      {announcements.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Latest Announcements</p>
          {announcements.slice(0, 3).map(a => (
            <div key={a.id} className={`px-3 py-2 rounded-xl border text-xs mb-2 last:mb-0 ${ANN_COLORS[a.type] || ANN_COLORS.announcement}`}>
              <div className="flex justify-between items-start">
                <p className="font-bold">{a.title}</p>
                {a.is_pinned && <span className="text-[9px] font-bold uppercase">📌 Pinned</span>}
              </div>
              <p className="opacity-80 mt-0.5 line-clamp-2">{a.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Organisation Details</p>
        {[["Reg. Number", org.reg_number], ["Type", org.type?.replace(/_/g," ")],
          ["Phone", org.phone || "—"], ["Email", org.email || "—"],
          ["Address", org.address || "—"],
          ...(org.date_established ? [["Established", fmtDate(org.date_established)]] : []),
          ...(org.website ? [["Website", org.website]] : []),
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between items-start gap-4 py-1 border-b border-slate-50 dark:border-slate-700/50 last:border-0">
            <span className="text-xs text-slate-400 flex-shrink-0">{k}</span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-right capitalize">{v}</span>
          </div>
        ))}
      </div>

      {recentTxns.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</p>
          {recentTxns.map(t => (
            <div key={t.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
              <div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">{t.type.replace(/_/g," ")}</p>
                <p className="text-[10px] text-slate-400">{fmtDT(t.created_at)}</p>
              </div>
              <p className={`text-xs font-extrabold tabular ${t.type.includes("withdrawal")||t.type.includes("disbursement") ? "text-red-500" : "text-green-600"}`}>
                {t.type.includes("withdrawal")||t.type.includes("disbursement") ? "−" : "+"}{fmt(t.amount)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MEMBERS TAB
// ═══════════════════════════════════════════════════
function MembersTab({ org, members, onRefresh }) {
  const [showAdd,  setShowAdd]  = useState(false);
  const [selected, setSelected] = useState(null);
  const [editing,  setEditing]  = useState(false);
  const [creds,    setCreds]    = useState(null); // { email, temp_password, name, isReset? }
  const [search,   setSearch]   = useState("");
  const [form,     setForm]     = useState({
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

  const handleAdd = async () => {
    if (!form.full_name.trim()) { setError("Full name required"); return; }
    if (!form.email.trim()) { setError("Email address required"); return; }
    setLoading(true); setError("");
    try {
      const result = await coopFn("add-member", { org_id: org.id, ...form });
      setShowAdd(false);
      setForm(EMPTY_FORM);
      setCreds({ email: result.member.email, temp_password: result.temp_password, otp_code: result.member.otp_code || "", name: result.member.full_name });
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
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <button onClick={() => setShowAdd(true)} className="px-4 py-2.5 bg-violet-600 text-white rounded-xl text-xs font-bold flex-shrink-0">+ Add</button>
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

      {/* Add member modal */}
      {showAdd && (
        <ModalWrap onClose={() => { setShowAdd(false); setError(""); setForm(EMPTY_FORM); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">Register Member</h3>
          <p className="text-xs text-slate-400 mb-4">Credentials &amp; a verification code will be emailed to the member</p>
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
            <button onClick={() => { setShowAdd(false); setError(""); setForm(EMPTY_FORM); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleAdd} disabled={loading} className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{loading ? "Registering…" : "Register Member"}</button>
          </div>
        </ModalWrap>
      )}

      {/* Credentials modal — shown after registration or password reset */}
      {creds && (
        <ModalWrap onClose={() => setCreds(null)}>
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-1">
              {creds.isReset ? "Password Reset!" : "Member Registered!"}
            </h3>
            <p className="text-xs text-slate-400 mb-5">
              {creds.isReset
                ? `Share these new credentials with ${creds.name}`
                : `Share these credentials with ${creds.name} — they will verify their email and set a new password on first login`}
            </p>
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-2xl p-4 mb-3 text-left">
              <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider mb-3">Login Credentials</p>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">Email</span>
                <span className="text-xs font-bold text-slate-800 dark:text-white break-all text-right max-w-[65%]">{creds.email}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Temp Password</span>
                <span className="text-base font-extrabold text-violet-600 font-mono tracking-wider">{creds.temp_password}</span>
              </div>
              {!creds.isReset && creds.otp_code && (
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-violet-100 dark:border-violet-800/40">
                  <span className="text-xs text-slate-400">Email OTP Code</span>
                  <span className="text-base font-extrabold text-amber-600 font-mono tracking-wider">{creds.otp_code}</span>
                </div>
              )}
            </div>
            {!creds.isReset && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 rounded-xl px-3 py-2.5 mb-3 text-left">
                <p className="text-[11px] text-blue-700 dark:text-blue-400 font-medium">
                  Share both the password and the OTP code with the member. They log in with the password, then enter the OTP code to verify their email, then set their own password.
                </p>
              </div>
            )}
            <button onClick={() => navigator.clipboard?.writeText(`Email: ${creds.email}\nPassword: ${creds.temp_password}${creds.otp_code ? `\nVerification Code: ${creds.otp_code}` : ""}`)}
              className="w-full py-2.5 border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 rounded-xl font-bold text-sm mb-2">
              Copy Credentials
            </button>
            <button onClick={() => setCreds(null)} className="w-full py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm">Done</button>
          </div>
        </ModalWrap>
      )}

      {/* Member detail modal */}
      {selected && !editing && (
        <ModalWrap onClose={() => { setSelected(null); setError(""); }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center text-xl font-extrabold text-violet-600">{selected.full_name?.charAt(0)}</div>
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
            <button onClick={handleEdit} disabled={saving} className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : "Save Changes"}</button>
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
          className="px-4 py-2.5 bg-violet-600 text-white rounded-xl text-xs font-bold">+ New Program</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : programs.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center px-6">
            <span className="text-4xl mb-3">📋</span>
            <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">No Programs Yet</p>
            <p className="text-sm text-slate-400 mb-5">Create contribution programs like Welfare Fund, Development Levy, Building Fund etc.</p>
            <button onClick={() => setShowAdd(true)} className="px-5 py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm">Create Program</button>
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
                      {p.contribution_type === "fixed" && <span className="text-[10px] bg-violet-50 text-violet-600 px-2 py-0.5 rounded-lg">{fmt(p.amount)}</span>}
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
            <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : editing ? "Save Changes" : "Create Program"}</button>
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
              <span className={`flex-1 block py-2 px-2 rounded-xl text-xs font-bold transition ${subTab === id ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
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
                  <div key={s.id} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex justify-between items-start">
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-white">{s.org_members?.full_name || "—"}</p>
                      {s.org_contribution_programs?.name && <p className="text-[10px] text-violet-500 font-semibold">{s.org_contribution_programs.name}</p>}
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
                  <div key={w.id} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-xs font-bold text-slate-800 dark:text-white">{w.purpose}</p>
                        <p className="text-[10px] text-slate-400 capitalize">{w.method} · {w.member_count} members · {fmtDate(w.created_at)}</p>
                        {w.authorized_by && <p className="text-[10px] text-slate-400">Auth: {w.authorized_by}</p>}
                      </div>
                      <p className="text-sm font-extrabold text-red-500">−{fmt(w.total_amount)}</p>
                    </div>
                  </div>
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
                  {r.status === "pending" && (
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
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  LOANS TAB (unchanged)
// ═══════════════════════════════════════════════════
function LoansTab({ org, members, onRefresh }) {
  const [loans,     setLoans]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showApply, setShowApply] = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [repayForm, setRepayForm] = useState({ amount: "", payment_method: "cash" });
  const [form,      setForm]      = useState({ member_id: "", amount_requested: "", interest_rate: "0", loan_purpose: "", repayment_months: "1" });
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
      setShowApply(false); setForm({ member_id: "", amount_requested: "", interest_rate: "0", loan_purpose: "", repayment_months: "1" });
      load();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleLoanAction = async (loan, newStatus, extra = {}) => {
    setSaving(true);
    try {
      await coopFn("update-loan", { loan_id: loan.id, org_id: org.id, status: newStatus,
        amount_approved: loan.amount_approved || loan.amount_requested, ...extra });
      setSelected(null); load(); onRefresh();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleRepay = async () => {
    if (!repayForm.amount) { setError("Amount required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("record-repayment", { org_id: org.id, loan_id: selected.id, member_id: selected.member_id,
        amount: parseFloat(repayForm.amount), payment_method: repayForm.payment_method });
      setSelected(null); load(); onRefresh();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const activeMembers = members.filter(m => m.status === "active");

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{loans.filter(l => l.status === "pending").length} pending · {loans.filter(l => l.status === "disbursed").length} active</p>
        <button onClick={() => setShowApply(true)} className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-bold">+ New Loan</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
          : loans.length === 0 ? <div className="text-center py-12 text-slate-400 text-sm">No loans yet</div>
          : (
            <div className="flex flex-col gap-2">
              {loans.map(l => (
                <button key={l.id} onClick={() => setSelected(l)}
                  className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 flex justify-between items-start text-left w-full">
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-white">{l.org_members?.full_name || "—"}</p>
                    <p className="text-[10px] text-slate-400">{l.loan_purpose || "General"} · {fmtDate(l.applied_at)}</p>
                    <span className={`text-[10px] font-bold capitalize ${STATUS_COL[l.status]}`}>● {l.status}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold text-amber-600">{fmt(l.amount_requested)}</p>
                    {l.outstanding_balance > 0 && <p className="text-[10px] text-red-500">Out: {fmt(l.outstanding_balance)}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
      </div>

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
                <input className={input} value={form.loan_purpose} onChange={set("loan_purpose")} placeholder="Business…" />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setShowApply(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleApply} disabled={saving} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Creating…" : "Submit"}</button>
          </div>
        </ModalWrap>
      )}

      {selected && (
        <ModalWrap onClose={() => { setSelected(null); setError(""); setRepayForm({ amount: "", payment_method: "cash" }); }}>
          <div className="flex justify-between mb-3">
            <div>
              <p className="text-base font-extrabold text-slate-800 dark:text-white">{selected.org_members?.full_name}</p>
              <p className="text-xs text-slate-400">{selected.loan_purpose || "General loan"}</p>
            </div>
            <span className={`text-xs font-bold capitalize ${STATUS_COL[selected.status]}`}>{selected.status}</span>
          </div>
          <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-3 mb-4 grid grid-cols-2 gap-2">
            {[["Requested", fmt(selected.amount_requested)], ["Outstanding", fmt(selected.outstanding_balance)],
              ["Interest", `${selected.interest_rate}%`], ["Due Date", fmtDate(selected.due_date)]].map(([k, v]) => (
              <div key={k}><p className="text-[10px] text-slate-400">{k}</p><p className="text-xs font-bold text-slate-800 dark:text-white">{v}</p></div>
            ))}
          </div>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          {selected.status === "pending" && (
            <div className="flex gap-2 mb-3">
              <button onClick={() => handleLoanAction(selected, "approved", { approved_by_name: "Admin" })} disabled={saving} className="flex-1 py-2.5 bg-green-50 text-green-700 border border-green-200 rounded-xl font-bold text-sm">Approve</button>
              <button onClick={() => handleLoanAction(selected, "rejected")} disabled={saving} className="flex-1 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-sm">Reject</button>
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
          <button onClick={() => { setSelected(null); setError(""); setRepayForm({ amount: "", payment_method: "cash" }); }}
            className="w-full py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Close</button>
        </ModalWrap>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MEETINGS TAB (enhanced)
// ═══════════════════════════════════════════════════
function MeetingsTab({ org, members }) {
  const [meetings,   setMeetings]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [present,    setPresent]    = useState(new Set());
  const [saving,     setSaving]     = useState(false);
  const [form,       setForm]       = useState({ title: "", description: "", meeting_type: "general", format: "physical", scheduled_at: "", location: "", meeting_link: "", agenda: "" });
  const [error,      setError]      = useState("");

  const load = useCallback(() => {
    coopFn("get-meetings", { org_id: org.id }).then(r => setMeetings(r.meetings || [])).finally(() => setLoading(false));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleCreate = async () => {
    if (!form.title || !form.scheduled_at) { setError("Title and date required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("create-meeting", { org_id: org.id, ...form });
      setShowCreate(false); setForm({ title: "", description: "", meeting_type: "general", format: "physical", scheduled_at: "", location: "", meeting_link: "", agenda: "" }); load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const openMeeting = async (meeting) => {
    setSelected(meeting);
    const { attendance: att } = await coopFn("get-attendance", { meeting_id: meeting.id });
    const presentSet = new Set((att || []).filter(a => a.status === "present").map(a => a.member_id));
    setPresent(presentSet);
  };

  const togglePresence = (id) => setPresent(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submitAttendance = async () => {
    setSaving(true);
    const activeIds = members.filter(m => m.status === "active").map(m => m.id);
    await coopFn("bulk-attendance", { meeting_id: selected.id, org_id: org.id,
      present_ids: activeIds.filter(id => present.has(id)), absent_ids: activeIds.filter(id => !present.has(id)) });
    setSelected(null); load();
    setSaving(false);
  };

  const FORMAT_BADGE = { physical: "bg-green-100 text-green-700", virtual: "bg-blue-100 text-blue-700", hybrid: "bg-violet-100 text-violet-700" };
  const activeMembers = members.filter(m => m.status === "active");

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{meetings.length} meeting{meetings.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold">+ Schedule</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          : meetings.length === 0 ? <div className="text-center py-12 text-slate-400 text-sm">No meetings yet</div>
          : (
            <div className="flex flex-col gap-2">
              {meetings.map(m => (
                <button key={m.id} onClick={() => openMeeting(m)}
                  className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-left w-full">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{m.title}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{fmtDT(m.scheduled_at)}</p>
                      {m.location && <p className="text-[10px] text-slate-400">📍 {m.location}</p>}
                      {m.meeting_link && <p className="text-[10px] text-blue-500">🔗 Virtual link available</p>}
                    </div>
                    <div className="text-right ml-2 flex-shrink-0">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize ${FORMAT_BADGE[m.format] || FORMAT_BADGE.physical}`}>{m.format}</span>
                      <p className="text-[9px] text-slate-400 mt-1 capitalize">{STATUS_COL[m.status] ? m.status : m.status}</p>
                      {m.rsvp_counts && (
                        <p className="text-[9px] text-green-600 mt-0.5">✓ {m.rsvp_counts.attending}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
      </div>

      {showCreate && (
        <ModalWrap onClose={() => { setShowCreate(false); setError(""); }}>
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
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Format</label>
                <select className={input} value={form.format} onChange={set("format")}>
                  <option value="physical">Physical</option>
                  <option value="virtual">Virtual</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Date & Time *</label>
              <input className={input} type="datetime-local" value={form.scheduled_at} onChange={set("scheduled_at")} />
            </div>
            {(form.format === "physical" || form.format === "hybrid") && (
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Venue</label>
                <input className={input} value={form.location} onChange={set("location")} placeholder="Community Hall" />
              </div>
            )}
            {(form.format === "virtual" || form.format === "hybrid") && (
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Meeting Link</label>
                <input className={input} value={form.meeting_link} onChange={set("meeting_link")} placeholder="https://meet.google.com/..." type="url" />
              </div>
            )}
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Agenda</label>
              <textarea className={input} rows={3} value={form.agenda} onChange={set("agenda")} placeholder="1. Call to order&#10;2. Review of last minutes&#10;3. New business" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setShowCreate(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Creating…" : "Schedule"}</button>
          </div>
        </ModalWrap>
      )}

      {selected && (
        <div className="fixed inset-0 z-[75] bg-slate-900/80 flex items-end justify-center">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl px-5 py-6 max-h-[90vh] flex flex-col">
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <p className="text-base font-extrabold text-slate-800 dark:text-white mb-0.5">{selected.title}</p>
            <p className="text-xs text-slate-400 mb-1">{fmtDT(selected.scheduled_at)}</p>
            {selected.agenda && (
              <div className="bg-slate-50 dark:bg-slate-700 rounded-xl px-3 py-2 mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Agenda</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line">{selected.agenda}</p>
              </div>
            )}
            {selected.meeting_link && (
              <a href={selected.meeting_link} target="_blank" rel="noreferrer"
                className="block mb-3 px-3 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold text-center">🔗 Join Virtual Meeting</a>
            )}
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
//  MESSAGES TAB (Announcements)
// ═══════════════════════════════════════════════════
function MessagesTab({ org }) {
  const [announcements, setAnnouncements] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [showCreate,    setShowCreate]    = useState(false);
  const [form,          setForm]          = useState({ type: "announcement", title: "", body: "", is_pinned: false });
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState("");

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const load = useCallback(() => {
    coopFn("get-announcements", { org_id: org.id })
      .then(r => setAnnouncements(r.announcements || []))
      .finally(() => setLoading(false));
  }, [org.id]);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.body.trim()) { setError("Title and message required"); return; }
    setSaving(true); setError("");
    try {
      await coopFn("send-announcement", { org_id: org.id, ...form });
      setShowCreate(false); setForm({ type: "announcement", title: "", body: "", is_pinned: false }); load();
    } catch (e) { setError(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handlePin = async (ann) => {
    await coopFn("pin-announcement", { announcement_id: ann.id, is_pinned: !ann.is_pinned });
    load();
  };

  const handleDelete = async (ann) => {
    if (!window.confirm("Delete this announcement?")) return;
    await coopFn("delete-announcement", { announcement_id: ann.id });
    load();
  };

  const TYPE_ICONS = { announcement: "📢", notice: "📋", circular: "📄", emergency: "🚨" };
  const TYPE_LABELS = { announcement: "Announcement", notice: "Notice", circular: "Circular", emergency: "Emergency" };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex justify-between items-center">
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{announcements.length} messages</p>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold">+ New Message</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : announcements.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <span className="text-4xl mb-3">📣</span>
            <p className="text-base font-extrabold text-slate-700 dark:text-slate-200 mb-2">No Messages Yet</p>
            <p className="text-sm text-slate-400 mb-5">Send announcements, notices, and circulars to all members.</p>
            <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm">Send Message</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mt-2">
            {announcements.map(a => (
              <div key={a.id} className={`rounded-2xl p-4 border ${ANN_COLORS[a.type] || ANN_COLORS.announcement}`}>
                <div className="flex justify-between items-start gap-2 mb-1">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-sm">{TYPE_ICONS[a.type]}</span>
                    <p className="text-sm font-extrabold truncate">{a.title}</p>
                    {a.is_pinned && <span className="text-[9px] font-bold bg-white/60 px-1.5 py-0.5 rounded-full flex-shrink-0">📌</span>}
                  </div>
                  <span className="text-[9px] font-bold uppercase flex-shrink-0 opacity-60">{TYPE_LABELS[a.type]}</span>
                </div>
                <p className="text-xs opacity-80 mb-2 leading-relaxed">{a.body}</p>
                <div className="flex justify-between items-center">
                  <p className="text-[10px] opacity-60">{a.author_name} · {fmtDate(a.created_at)}</p>
                  <div className="flex gap-2">
                    <button onClick={() => handlePin(a)} className="text-[10px] font-bold opacity-70 hover:opacity-100">{a.is_pinned ? "Unpin" : "Pin"}</button>
                    <button onClick={() => handleDelete(a)} className="text-[10px] font-bold opacity-70 hover:opacity-100 text-red-600">Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <ModalWrap onClose={() => { setShowCreate(false); setError(""); }}>
          <h3 className="text-base font-extrabold text-slate-800 dark:text-white mb-4">Send Message to Members</h3>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3 text-xs text-red-600">{error}</div>}
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Message Type</label>
              <div className="grid grid-cols-2 gap-2">
                {["announcement","notice","circular","emergency"].map(t => (
                  <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))}
                    className={`py-2 rounded-xl border-2 text-xs font-bold capitalize transition ${form.type === t ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600" : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"}`}>
                    {TYPE_ICONS[t]} {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Title *</label>
              <input className={input} value={form.title} onChange={set("title")} placeholder="Message subject" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Message Body *</label>
              <textarea className={input} rows={4} value={form.body} onChange={set("body")} placeholder="Write your message here…" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_pinned} onChange={e => setForm(p => ({ ...p, is_pinned: e.target.checked }))}
                className="w-4 h-4 rounded accent-blue-600" />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Pin this message to top</span>
            </label>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={() => { setShowCreate(false); setError(""); }} className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Sending…" : "Send Message"}</button>
          </div>
        </ModalWrap>
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
            className="text-[10px] font-bold text-violet-600 bg-violet-50 dark:bg-violet-900/20 px-2 py-1 rounded-lg">
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
            className="w-full py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {creating ? "Linking…" : hasBank ? "Update Bank Account" : "Link Bank Account"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SettingsTab({ org, onRefresh, onBack, isOrgPortal = false }) {
  const [leaders,     setLeaders]     = useState([]);
  const [form,        setForm]        = useState({ name: org.name || "", email: org.email || "", phone: org.phone || "", address: org.address || "", state_name: org.state_name || "", lga: org.lga || "", purpose: org.purpose || "", vision: org.vision || "", mission: org.mission || "", website: org.website || "", social_instagram: org.social_instagram || "", social_facebook: org.social_facebook || "", social_twitter: org.social_twitter || "", date_established: org.date_established || "", logo_url: org.logo_url || "" });
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
      await coopFn("update-org", { org_id: org.id, ...form });
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

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24 flex flex-col gap-5">
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
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Logo URL</label>
            <input className={input} value={form.logo_url} onChange={set("logo_url")} placeholder="https://..." type="url" />
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
        <button onClick={handleSaveOrg} disabled={saving} className="w-full mt-4 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? "Saving…" : "Save Profile"}</button>
      </div>

      {/* Key Leaders */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Key Leaders & Executives</p>
          <button onClick={() => { setLForm({ name: "", position: "", phone: "", email: "", sort_order: String(leaders.length) }); setEditL(null); setShowAddL(true); }}
            className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-bold">+ Add</button>
        </div>
        {leaders.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No leaders added yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {leaders.map(l => (
              <div key={l.id} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
                <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center text-sm font-extrabold text-violet-600 flex-shrink-0">{l.name?.charAt(0)}</div>
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
              <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 mb-3">
                <p className="text-[11px] font-bold text-violet-400 uppercase tracking-wider mb-2">Portal Created ✓</p>
                <p className="text-xs text-slate-600 mb-1">Send these credentials to the organisation:</p>
                <div className="bg-white rounded-xl p-3 border border-violet-100 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold w-20">Email</span>
                    <span className="text-xs font-mono text-slate-800">{portalResult.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold w-20">Temp Password</span>
                    <span className="text-xs font-mono font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-lg">{portalResult.temp_password}</span>
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
              className="w-full py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50"
            >
              {portalSaving ? "Setting up…" : org.portal_user_id ? "Reset Portal Login" : "Setup Portal Login"}
            </button>
          </>
        )}
      </div>}

      {/* Paystack Bank Account */}
      <OrgBankSetupSection org={org} onRefresh={onRefresh} />

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
            <button onClick={handleSaveLeader} disabled={lSaving} className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{lSaving ? "Saving…" : editL ? "Save" : "Add Leader"}</button>
          </div>
        </ModalWrap>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MAIN DASHBOARD
// ═══════════════════════════════════════════════════
const TABS = [
  { id: "overview",  label: "Overview",  icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "members",   label: "Members",   icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "programs",  label: "Programs",  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { id: "finance",   label: "Finance",   icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "loans",     label: "Loans",     icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" },
  { id: "meetings",  label: "Meetings",  icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "messages",  label: "Messages",  icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
  { id: "settings",  label: "Settings",  icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

const ORG_TYPE_ICONS = { cooperative:"🤝", market_association:"🏪", church:"⛪", ngo:"🌍", youth_group:"👥", savings_group:"💰", community_group:"🏘️", professional_association:"💼", savings_club:"🏦" };

export default function CoopDashboard({ org: initialOrg, onBack, isOrgPortal = false }) {
  const [tab,          setTab]          = useState("overview");
  const [org,          setOrg]          = useState(initialOrg);
  const [members,      setMembers]      = useState([]);
  const [wallet,       setWallet]       = useState(null);
  const [programs,     setPrograms]     = useState([]);
  const [announcements,setAnnouncements]= useState([]);
  const [loading,      setLoading]      = useState(true);

  const loadAll = useCallback(() => {
    const orgId = org.id;
    Promise.all([
      coopFn("get-org",           { org_id: orgId }),
      coopFn("get-members",       { org_id: orgId }),
      coopFn("get-wallet",        { org_id: orgId }),
      coopFn("get-programs",      { org_id: orgId }),
      coopFn("get-announcements", { org_id: orgId }),
    ]).then(([orgR, memR, walR, progR, annR]) => {
      setOrg(prev => orgR.org || prev);
      setMembers(memR.members || []);
      setWallet(walR);
      setPrograms(progR.programs || []);
      setAnnouncements(annR.announcements || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [org.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const tabContent = {
    overview: <OverviewTab org={org} wallet={wallet} programs={programs} announcements={announcements} />,
    members:  <MembersTab  org={org} members={members} onRefresh={loadAll} />,
    programs: <ProgramsTab org={org} onRefresh={loadAll} />,
    finance:  <FinanceTab  org={org} members={members} programs={programs} onRefresh={loadAll} />,
    loans:    <LoansTab    org={org} members={members} onRefresh={loadAll} />,
    meetings: <MeetingsTab org={org} members={members} />,
    messages: <MessagesTab org={org} />,
    settings: <SettingsTab org={org} onRefresh={loadAll} onBack={onBack} isOrgPortal={isOrgPortal} />,
  };

  return (
    <div className="fixed inset-0 z-[65] bg-slate-50 dark:bg-slate-900 flex justify-center">
      <div className="w-full max-w-md flex flex-col h-full">
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
          {isOrgPortal ? (
            <button onClick={onBack} className="text-[11px] font-bold text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
              Sign Out
            </button>
          ) : (
            <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
          )}
          <span className="text-xl">{ORG_TYPE_ICONS[org.type] || "🏢"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{org.name}</p>
            <p className="text-[10px] text-slate-400 font-mono">{org.reg_number}</p>
          </div>
          {loading && <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
        </div>

        <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
          <div className="flex min-w-max">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex flex-col items-center gap-0.5 px-3.5 py-2.5 border-b-2 transition-colors ${tab === t.id ? "border-violet-600 text-violet-600" : "border-transparent text-slate-400 dark:text-slate-500"}`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d={t.icon} />
                </svg>
                <span className="text-[9px] font-bold whitespace-nowrap">{t.label}</span>
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
