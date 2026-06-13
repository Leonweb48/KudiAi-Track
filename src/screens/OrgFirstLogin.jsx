import { useState } from "react";
import { supabase } from "../utils/supabase";

const ORG_TYPE_LABELS = {
  cooperative: "Cooperative Society", market_association: "Market Association",
  church: "Church / Religious Org", ngo: "NGO / Non-profit", youth_group: "Youth Group",
  savings_group: "Savings Group", community_group: "Community Group",
  professional_association: "Professional Association", savings_club: "Savings Club",
};

export default function OrgFirstLogin({ org }) {
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
      data: { must_change_password: false, account_type: "organisation" },
    });
    if (err) { setError(err.message); setSaving(false); return; }
    setSuccess(true);
    // onAuthStateChange fires → must_change_password: false → status "organisation" → OrgPortal
  };

  if (success) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-purple-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 mb-2">Password set!</h2>
        <p className="text-sm text-slate-500">Taking you to your organisation portal…</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b border-slate-100 px-5 pt-14 pb-5">
        <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900">Set Your Password</h1>
        <p className="text-sm text-slate-500 mt-1">
          Welcome, <strong>{org?.name || "Organisation"}</strong>! Choose a secure password for your portal.
        </p>
        {org?.type && (
          <span className="inline-block mt-2 text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2.5 py-0.5">
            {ORG_TYPE_LABELS[org.type] || org.type}
          </span>
        )}
      </div>

      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">New Password *</label>
          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Minimum 8 characters"
              className="w-full border border-slate-200 rounded-xl pl-4 pr-14 py-3 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-purple-600">
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>
          {password && (
            <div className="flex gap-1 mt-1.5">
              {[1,2,3,4].map(n => (
                <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= score ? colors[score] : "bg-slate-200"}`} />
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Confirm Password *</label>
          <input
            type={showPwd ? "text" : "password"}
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            placeholder="Repeat your password"
            className={`w-full border rounded-xl px-4 py-3 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 ${
              confirm && confirm !== password ? "border-red-400" : "border-slate-200"
            }`}
          />
          {confirm && confirm !== password && (
            <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={saving || password.length < 8 || password !== confirm}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition"
        >
          {saving ? "Saving…" : "Set Password & Enter Portal →"}
        </button>

        <button onClick={() => supabase.auth.signOut()}
          className="w-full text-xs text-slate-400 hover:text-slate-600 transition text-center">
          Sign out
        </button>
      </div>
    </div>
  );
}
