import { useState } from "react";
import { friendlyError } from "../utils/errorMessage";
import { supabase } from "../utils/supabase";
import { AuthShell, AuthPageHeader } from "../components/AuthShell";
import PasswordInput from "../components/PasswordInput";

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

export default function StaffFirstLogin({ staff }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);

  const submit = async () => {
    if (password.length < 8)  { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm)  { setError("Passwords do not match"); return; }
    setSaving(true); setError("");

    const { error: err } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });

    if (err) { setError(friendlyError(err)); setSaving(false); return; }
    setSuccess(true);
    // onAuthStateChange fires → must_change_password: false → status "staff" or "branch_manager"
  };

  const firstName = staff?.full_name?.split(" ")[0] || "there";
  const role      = staff?.role === "manager" ? "Branch Manager" : "Staff Member";

  if (success) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="#6366f1" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">Password set!</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Taking you to your staff portal…</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">You'll review our terms before entering</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <AuthShell variant="page">
      <AuthPageHeader accent="indigo">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Set Your Password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Hi {firstName}! Choose a secure password to access your staff portal.
        </p>
        {staff?.full_name && (
          <div className="flex items-center gap-2 mt-3">
            <span className="inline-block text-xs font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl px-3 py-1.5">
              {staff.full_name}
            </span>
            <span className="inline-block text-xs font-semibold text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-xl px-3 py-1.5">
              {role}
            </span>
          </div>
        )}
      </AuthPageHeader>

      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-wide">
            New Password *
          </label>
          <PasswordInput
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            placeholder="Minimum 8 characters"
            borderClass="border-slate-200 dark:border-slate-700"
            className="bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
          />
          <StrengthBar password={password} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1 uppercase tracking-wide">
            Confirm Password *
          </label>
          <PasswordInput
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            placeholder="Repeat your password"
            borderClass={confirm && confirm !== password ? "border-red-400 dark:border-red-600" : "border-slate-200 dark:border-slate-700"}
            className="bg-white dark:bg-slate-800 text-slate-800 dark:text-white"
          />
          {confirm && confirm !== password && (
            <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>
          )}
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Requirements</p>
          {[
            { rule: "At least 8 characters", pass: password.length >= 8 },
            { rule: "One uppercase letter",   pass: /[A-Z]/.test(password) },
            { rule: "One number",             pass: /[0-9]/.test(password) },
          ].map(({ rule, pass }) => (
            <div key={rule} className="flex items-center gap-2">
              <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${pass ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-700"}`}>
                {pass && <svg viewBox="0 0 24 24" fill="none" className="w-2.5 h-2.5" stroke="white" strokeWidth={3} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>}
              </div>
              <p className={`text-[11px] font-medium ${pass ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`}>{rule}</p>
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
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition"
        >
          {saving ? "Saving…" : "Set Password & Enter Portal →"}
        </button>

        <button onClick={() => supabase.auth.signOut()}
          className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center">
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}
