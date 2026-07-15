mport { useState } from "react";
import { friendlyError } from "../utils/errorMessage";
import { supabase } from "../utils/supabase";
import AppLogo from "../components/AppLogo";

const ORG_TYPE_LABELS = {
  cooperative: "Cooperative Society", market_association: "Market Association",
  church: "Church / Religious Org", ngo: "NGO / Non-profit", youth_group: "Youth Group",
  savings_group: "Savings Group", community_group: "Community Group",
  professional_association: "Professional Association", savings_club: "Savings Club",
};

function StrengthBar({ password }) {
  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-blue-500", "bg-green-500"];
  if (!password) return null;
  return (
    <div className="flex gap-1 mt-1.5">
      {[1, 2, 3, 4].map(n => (
        <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= score ? colors[score] : "bg-slate-200 dark:bg-slate-700"}`} />
      ))}
    </div>
  );
}

export default function OrgFirstLogin({ org }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);

  const submit = async () => {
    if (password.length < 8)  { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm)  { setError("Passwords do not match"); return; }
    setSaving(true); setError("");

    const { error: err } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false, account_type: "organisation" },
    });

    if (err) { setError(friendlyError(err)); setSaving(false); return; }
    setSuccess(true);
  };

  if (success) return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#060a08] flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: "rgba(0,166,81,0.15)" }}>
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="#3DA829" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">Password set!</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Taking you to your organisation portal…</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-t-transparent rounded-full animate-spin mx-auto"
          style={{ borderColor: "#3DA829", borderTopColor: "transparent" }} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#060a08] flex flex-col">

      {/* Header */}
      <div className="bg-white dark:bg-[#0b120e] border-b border-slate-100 dark:border-[#162218] px-5 pb-6" style={{ paddingTop: "max(56px, env(safe-area-inset-top, 56px))" }}>
        <div className="flex justify-center mb-5">
          <div className="bg-white/90 dark:bg-white/10 rounded-2xl p-2 shadow">
            <AppLogo className="h-9 w-auto" />
          </div>
        </div>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "linear-gradient(135deg,#3DA829,#065f46)" }}>
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Set Your Password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Welcome, <strong className="text-slate-700 dark:text-slate-200">{org?.name || "Organisation"}</strong>! Choose a secure password to access your portal.
        </p>
        {org?.type && (
          <span className="inline-block mt-2 text-[11px] font-semibold rounded-full px-2.5 py-0.5 border"
            style={{ color: "#3DA829", borderColor: "#3DA829", background: "rgba(0,166,81,0.08)" }}>
            {ORG_TYPE_LABELS[org.type] || org.type}
          </span>
        )}
      </div>

      {/* Form */}
      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-wide">
            New Password *
          </label>
          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Minimum 8 characters"
              className="w-full border border-slate-200 dark:border-[#1e3024] rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-[#101a13] text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400/40 transition"
            />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold"
              style={{ color: "#3DA829" }}>
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>
          <StrengthBar password={password} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-wide">
            Confirm Password *
          </label>
          <input
            type={showPwd ? "text" : "password"}
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            placeholder="Repeat your password"
            className={`w-full border rounded-xl px-4 py-3 text-sm bg-white dark:bg-[#101a13] text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400/40 transition ${
              confirm && confirm !== password
                ? "border-red-400 dark:border-red-600"
                : "border-slate-200 dark:border-[#1e3024]"
            }`}
          />
          {confirm && confirm !== password && (
            <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>
          )}
        </div>

        {/* Requirements */}
        <div className="bg-slate-50 dark:bg-[#0b120e] border border-slate-100 dark:border-[#162218] rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Requirements</p>
          {[
            { rule: "At least 8 characters", pass: password.length >= 8 },
            { rule: "One uppercase letter",   pass: /[A-Z]/.test(password) },
            { rule: "One number",             pass: /[0-9]/.test(password) },
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

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <button
          onClick={submit}
          disabled={saving || password.length < 8 || password !== confirm}
          className="w-full text-white font-bold rounded-2xl py-4 text-sm transition disabled:opacity-50"
          style={{ background: "#3DA829" }}
        >
          {saving ? "Saving…" : "Set Password & Enter Portal →"}
        </button>

        <button onClick={() => supabase.auth.signOut()}
          className="w-full text-xs text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 transition text-center">
          Sign out
        </button>
      </div>
    </div>
  );
}
