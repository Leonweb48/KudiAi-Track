import { useState } from "react";
import { supabase } from "../utils/supabase";
import { useTheme } from "../hooks/useTheme";

/* ── Sun / Moon icons ────────────────────────────────── */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

/* ── KudiAI Track logo mark (inline SVG) ────────────── */
function KudiLogoIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mlg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#mlg)" />
      <line x1="10" y1="8.5" x2="10" y2="23.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="10.5" y1="15.5" x2="20.5" y2="8.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="10.5" y1="15.5" x2="20.5" y2="23.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="23" cy="9" r="2" fill="rgba(255,255,255,0.75)" />
    </svg>
  );
}

function StrengthBar({ password }) {
  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-blue-500", "bg-green-500"];
  if (!password) return null;
  return (
    <div className="mt-1.5">
      <div className="flex gap-1 mb-1">
        {[1, 2, 3, 4].map(n => (
          <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= score ? colors[score] : "bg-slate-200 dark:bg-slate-700"}`} />
        ))}
      </div>
    </div>
  );
}

export default function MarketerFirstLogin({ marketer }) {
  const { isDark, toggle }      = useTheme();
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
      data: { must_change_password: false },
    });

    if (err) { setError(err.message); setSaving(false); return; }
    setSuccess(true);
  };

  if (success) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="flex justify-center mb-4"><KudiLogoIcon size={56} /></div>
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">Password set!</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Logging you into your dashboard…</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">You'll review our terms before entering</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Header with KudiAI Track branding */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pb-5" style={{ paddingTop: "max(56px, env(safe-area-inset-top, 56px))" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <KudiLogoIcon size={40} />
            <div>
              <p className="text-base font-extrabold text-slate-900 dark:text-white leading-tight">
                KudiAI <span className="font-light text-indigo-500">Track</span>
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Marketer Portal</p>
            </div>
          </div>
          <button onClick={toggle}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 transition-colors"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Set Your Password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Choose a secure password for your marketer account
        </p>
      </div>

      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">New Password *</label>
          <div className="relative">
            <input type={showPwd ? "text" : "password"} value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Minimum 8 characters"
              className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-indigo-600 dark:text-indigo-400">
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>
          <StrengthBar password={password} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Confirm Password *</label>
          <input type={showPwd ? "text" : "password"} value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            placeholder="Repeat your password"
            className={`w-full border rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${
              confirm && confirm !== password ? "border-red-400 dark:border-red-600" : "border-slate-200 dark:border-slate-700"
            }`}
          />
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Requirements</p>
          {[
            { rule: "At least 8 characters", pass: password.length >= 8 },
            { rule: "One uppercase letter",  pass: /[A-Z]/.test(password) },
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
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">{error}</p>
        )}

        <button onClick={submit} disabled={saving || password.length < 8 || password !== confirm}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition-colors">
          {saving ? "Saving…" : "Set Password & Enter Dashboard →"}
        </button>

        {marketer && (
          <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700">
            <KudiLogoIcon size={32} />
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{marketer.full_name}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">Marketer · {marketer.territory || "No territory set"}</p>
            </div>
            <button onClick={() => supabase.auth.signOut()} className="ml-auto text-[10px] font-semibold text-red-400 flex-shrink-0">Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
