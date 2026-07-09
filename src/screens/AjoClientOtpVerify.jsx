import { useState, useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";

const ajoClientFn = async (action, body = {}) => {
  const r = await supabase.functions.invoke("manage-ajo-client-account", { body: { action, ...body } });
  if (r.error) {
    let msg = r.error.message;
    try {
      const errBody = r.data?.error
        ? r.data
        : (r.error.context ? await r.error.context.clone().json() : null);
      if (errBody?.error) msg = errBody.error;
    } catch { /* keep original */ }
    throw new Error(msg);
  }
  if (r.data?.error) throw new Error(r.data.error);
  return r.data;
};

export default function AjoClientOtpVerify({ ajoClient }) {
  const [otp,         setOtp]         = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [resending,   setResending]   = useState(false);
  const [resent,      setResent]      = useState(false);
  const [tempPwd,     setTempPwd]     = useState("");
  const [showTempPwd, setShowTempPwd] = useState(false);
  const [otpSending,  setOtpSending]  = useState(true);
  const sentRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const tp = data?.user?.user_metadata?.temp_password;
      if (tp) setTempPwd(tp);
    });
  }, []);

  // Auto-send OTP on first login — fires when this screen mounts
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    ajoClientFn("resend-otp")
      .catch(() => null)
      .finally(() => setOtpSending(false));
  }, []);

  const verify = async () => {
    if (otp.trim().length < 6) { setError("Please enter the 6-digit code"); return; }
    setLoading(true); setError("");
    try {
      await ajoClientFn("verify-otp", { otp_code: otp.trim() });
      await supabase.auth.refreshSession();
    } catch (e) {
      setError(e.message || "Invalid code. Please try again.");
      setLoading(false);
    }
  };

  const resend = async () => {
    setResending(true); setError(""); setResent(false);
    try {
      await ajoClientFn("resend-otp");
      setResent(true);
    } catch (e) {
      setError(e.message || "Could not resend. Please try again.");
    } finally {
      setResending(false);
    }
  };

  const firstName = ajoClient?.full_name?.split(" ")[0] || "there";
  const email     = ajoClient?.email || "";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pb-6" style={{ paddingTop: "max(56px, env(safe-area-inset-top, 56px))" }}>
        <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Verify Your Email</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {otpSending
            ? "Sending a verification code to your email…"
            : `Hi ${firstName}! A 6-digit verification code has been sent to your email.`}
        </p>
        {email && (
          <span className="inline-block mt-2 text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-1.5">
            {email}
          </span>
        )}
      </div>

      <div className="flex-1 px-5 pt-8 pb-10 space-y-5">
        {tempPwd && (
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Your Login Credentials</p>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Email</span>
              <span className="text-xs font-bold text-slate-800 dark:text-white">{email}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500 dark:text-slate-400">Temp Password</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                  {showTempPwd ? tempPwd : "••••••••••"}
                </span>
                <button onClick={() => setShowTempPwd(v => !v)}
                  className="text-[10px] font-bold text-slate-400 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 active:scale-95 transition-transform">
                  {showTempPwd ? "Hide" : "Show"}
                </button>
                <button onClick={() => navigator.clipboard?.writeText(tempPwd)}
                  className="text-[10px] font-bold text-emerald-600 border border-emerald-200 dark:border-emerald-700 rounded-lg px-2 py-1 active:scale-95 transition-transform">
                  Copy
                </button>
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 uppercase tracking-wide">
            Verification Code
          </label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={otp}
            onChange={e => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
            placeholder="000000"
            className="w-full text-center text-4xl font-mono font-extrabold tracking-[0.6em] py-5 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:focus:ring-emerald-900/40 transition"
          />
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {resent && (
          <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/40 rounded-xl px-4 py-2.5">
            <p className="text-xs text-green-700 dark:text-green-400 font-medium">New code sent — check your email inbox.</p>
          </div>
        )}

        <button
          onClick={verify}
          disabled={loading || otp.length < 6}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-2xl py-4 text-sm transition"
        >
          {loading ? "Verifying…" : "Verify & Continue →"}
        </button>

        <button
          onClick={resend}
          disabled={resending}
          className="w-full py-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-2xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 transition"
        >
          {resending ? "Sending…" : "Resend verification code"}
        </button>

        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {otpSending
              ? "Please wait — sending your verification code…"
              : "Check your email inbox (and spam folder) for the code. It expires in 30 minutes."}
          </p>
        </div>

        <button onClick={() => supabase.auth.signOut()}
          className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition text-center">
          Sign out
        </button>
      </div>
    </div>
  );
}
