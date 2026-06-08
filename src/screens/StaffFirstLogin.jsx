import { useState, useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";

/* ── Password strength bar ───────────────────────────────────────── */
function StrengthBar({ password }) {
  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length;
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-blue-500", "bg-green-500"];
  if (!password) return null;
  return (
    <div className="mt-1.5">
      <div className="flex gap-1 mb-1">
        {[1, 2, 3, 4].map(n => (
          <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${n <= score ? colors[score] : "bg-slate-200 dark:bg-slate-700"}`} />
        ))}
      </div>
      <p className={`text-[10px] font-semibold ${score <= 1 ? "text-red-500" : score === 2 ? "text-amber-500" : score === 3 ? "text-blue-500" : "text-green-600"}`}>
        {labels[score]}
      </p>
    </div>
  );
}

/* ── OTP digit input ─────────────────────────────────────────────── */
function OtpInput({ value, onChange }) {
  const refs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];
  const digits = (value + "      ").slice(0, 6).split("");

  const handleKey = (i, e) => {
    if (e.key === "Backspace") {
      const prev = value.slice(0, Math.max(0, i));
      onChange(prev);
      if (i > 0) refs[i - 1].current?.focus();
      return;
    }
    if (!/^\d$/.test(e.key)) return;
    const next = digits.map((d, idx) => (idx === i ? e.key : d)).join("").replace(/ /g, "").slice(0, 6);
    onChange(next);
    if (i < 5) refs[i + 1].current?.focus();
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted);
    refs[Math.min(pasted.length, 5)].current?.focus();
    e.preventDefault();
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {refs.map((ref, i) => (
        <input
          key={i}
          ref={ref}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i] === " " ? "" : digits[i]}
          onChange={() => {}}
          onKeyDown={e => handleKey(i, e)}
          className={`w-12 h-14 text-center text-xl font-extrabold rounded-2xl border-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none transition-colors ${
            digits[i] && digits[i] !== " "
              ? "border-green-500 bg-green-50 dark:bg-green-900/20"
              : "border-slate-200 dark:border-slate-700"
          }`}
        />
      ))}
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function StaffFirstLogin({ session, staff }) {
  const email = staff?.email || session?.user?.email || "";

  const [step,      setStep]      = useState("password"); // "password" | "otp"
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [showPwd,   setShowPwd]   = useState(false);
  const [saving,    setSaving]    = useState(false);

  const [otp,       setOtp]       = useState("");
  const [verifying, setVerifying] = useState(false);
  const [cooldown,  setCooldown]  = useState(0);

  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState(false);

  // Countdown for OTP resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  /* ── Step 1: set new password ──────────────────────────────────── */
  const submitPassword = async () => {
    if (password.length < 8)  { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm)  { setError("Passwords do not match"); return; }
    setSaving(true);
    setError("");

    // Save the new password (must_change_password stays true until OTP is done)
    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) { setError(pwErr.message); setSaving(false); return; }

    // Send OTP to their email for confirmation
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (otpErr) {
      setError("Password saved but could not send verification code: " + otpErr.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setCooldown(60);
    setStep("otp");
  };

  /* ── Step 2: OTP verify ────────────────────────────────────────── */
  const resendOtp = async () => {
    if (cooldown > 0) return;
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (err) { setError("Could not resend: " + err.message); return; }
    setCooldown(60);
  };

  const verifyOtp = async () => {
    if (otp.length < 6) { setError("Enter the full 6-digit code"); return; }
    setVerifying(true);
    setError("");

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    if (verifyErr) {
      setError("Invalid or expired code — try again");
      setOtp("");
      setVerifying(false);
      return;
    }

    // Clear must_change_password → onAuthStateChange → StaffDashboard
    await supabase.auth.updateUser({ data: { must_change_password: false } });
    setVerifying(false);
    setSuccess(true);
  };

  const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, (_, a, b, c) =>
    a + "*".repeat(Math.min(b.length, 5)) + c
  );

  /* ── Success ──────────────────────────────────────────────────── */
  if (success) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-green-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">All done!</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Taking you to your dashboard…</p>
        <div className="mt-6 w-8 h-8 border-[3px] border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">

      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-14 pb-5">
        <div className="w-12 h-12 bg-green-600 rounded-2xl flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
          {step === "password" ? "Set Your Password" : "Confirm Your Email"}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {step === "password"
            ? "Choose a password you'll use to log in from now on"
            : `Enter the 6-digit code sent to ${maskedEmail}`}
        </p>
      </div>

      <div className="flex-1 px-5 pt-8 pb-10 space-y-6">

        {/* Progress pills */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-green-500" />
          <div className={`flex-1 h-1.5 rounded-full transition-colors ${step === "otp" ? "bg-green-500" : "bg-slate-200 dark:bg-slate-700"}`} />
          <p className="text-[11px] text-slate-400 font-semibold ml-1">
            {step === "password" ? "Step 1 of 2" : "Step 2 of 2"}
          </p>
        </div>

        {/* ── STEP 1 ─────────────────────────────────────────────── */}
        {step === "password" && (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  New Password *
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    placeholder="Minimum 8 characters"
                    className="w-full border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-green-600 dark:text-green-400"
                  >
                    {showPwd ? "Hide" : "Show"}
                  </button>
                </div>
                <StrengthBar password={password} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Confirm Password *
                </label>
                <input
                  type={showPwd ? "text" : "password"}
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); setError(""); }}
                  placeholder="Repeat your password"
                  className={`w-full border rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500 transition-colors ${
                    confirm && confirm !== password
                      ? "border-red-400 dark:border-red-600"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                />
                {confirm && confirm !== password && (
                  <p className="text-[10px] text-red-500 mt-1 font-medium">Passwords don't match</p>
                )}
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl px-4 py-3 space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Requirements</p>
                {[
                  { rule: "At least 8 characters", pass: password.length >= 8 },
                  { rule: "One uppercase letter",  pass: /[A-Z]/.test(password) },
                  { rule: "One number",             pass: /[0-9]/.test(password) },
                ].map(({ rule, pass }) => (
                  <div key={rule} className="flex items-center gap-2">
                    <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 ${pass ? "bg-green-500" : "bg-slate-200 dark:bg-slate-700"}`}>
                      {pass && (
                        <svg viewBox="0 0 24 24" fill="none" className="w-2.5 h-2.5" stroke="white" strokeWidth={3} strokeLinecap="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                    <p className={`text-[11px] font-medium ${pass ? "text-green-600 dark:text-green-400" : "text-slate-400 dark:text-slate-500"}`}>
                      {rule}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">
                {error}
              </p>
            )}

            <button
              onClick={submitPassword}
              disabled={saving || password.length < 8 || password !== confirm}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition-colors"
            >
              {saving ? "Saving…" : "Save Password & Continue →"}
            </button>
          </>
        )}

        {/* ── STEP 2 ─────────────────────────────────────────────── */}
        {step === "otp" && (
          <>
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
              <p className="text-xs text-green-700 dark:text-green-300 font-medium">
                ✓ Password saved — check your email inbox (and spam folder)
              </p>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 text-center">
                Enter the 6-digit verification code
              </label>
              <OtpInput value={otp} onChange={v => { setOtp(v); setError(""); }} />
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">
                {error}
              </p>
            )}

            <button
              onClick={verifyOtp}
              disabled={otp.length < 6 || verifying}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition-colors"
            >
              {verifying ? "Verifying…" : "Confirm & Enter Dashboard →"}
            </button>

            <div className="text-center">
              <button
                onClick={resendOtp}
                disabled={cooldown > 0}
                className="text-xs font-semibold text-green-600 dark:text-green-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Didn't get the code? Resend"}
              </button>
            </div>
          </>
        )}

        {/* Staff info footer */}
        {staff && (
          <div className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-700 font-bold text-xs flex-shrink-0">
              {(staff.full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{staff.full_name}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 capitalize truncate">
                {staff.role?.replace(/_/g, " ")}
              </p>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="ml-auto text-[10px] font-semibold text-red-400 flex-shrink-0"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
