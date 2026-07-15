import { useState, useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import AppLogo from "../components/AppLogo";

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
  const [digits,      setDigits]      = useState(["", "", "", "", "", ""]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [resent,      setResent]      = useState(false);
  const [countdown,   setCountdown]   = useState(60);
  const [otpSending,  setOtpSending]  = useState(true);
  const [tempPwd,     setTempPwd]     = useState("");
  const [showTempPwd, setShowTempPwd] = useState(false);
  const inputRefs = useRef([]);
  const sentRef   = useRef(false);

  // Read temp password from user metadata
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const tp = data?.user?.user_metadata?.temp_password;
      if (tp) setTempPwd(tp);
    });
  }, []);

  // Auto-focus first digit box
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Auto-send OTP on mount
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    ajoClientFn("resend-otp")
      .catch(() => null)
      .finally(() => setOtpSending(false));
  }, []);

  // Resend countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const handleDigit = (idx, val) => {
    const v = val.replace(/\D/, "").slice(-1);
    const next = [...digits];
    next[idx] = v;
    setDigits(next);
    setError("");
    if (v && idx < 5) inputRefs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      setDigits(text.split(""));
      inputRefs.current[5]?.focus();
    }
  };

  const otp = digits.join("");

  const verify = async () => {
    if (otp.length < 6) return;
    setLoading(true); setError("");
    try {
      await ajoClientFn("verify-otp", { otp_code: otp });
      await supabase.auth.refreshSession();
    } catch (e) {
      setError(e.message || "Invalid code. Please try again.");
      setLoading(false);
    }
  };

  const resend = async () => {
    if (countdown > 0) return;
    setError(""); setResent(false);
    try {
      await ajoClientFn("resend-otp");
      setResent(true);
      setCountdown(60);
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch (e) {
      setError(e.message || "Could not resend. Please try again.");
    }
  };

  const firstName = ajoClient?.full_name?.split(" ")[0] || "there";
  const email     = ajoClient?.email || "";

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center p-5 bg-slate-50 dark:bg-slate-950"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="w-full" style={{ maxWidth: 360 }}>

        {/* Header */}
        <div className="text-center mb-7">
          <div className="flex justify-center mb-4">
            <div className="bg-white/90 rounded-2xl p-2 shadow-lg">
              <AppLogo className="h-10 w-auto" />
            </div>
          </div>
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl mb-3 bg-indigo-500/20 border border-indigo-500/30">
            <svg width="18" height="18" fill="none" stroke="rgb(129,140,248)" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
            Check Your Email
          </h1>
          <p className="text-sm mt-2 leading-relaxed text-slate-500">
            {otpSending
              ? "Sending a verification code…"
              : <>Hi {firstName}! We sent a 6-digit code to<br />
                  <span className="font-semibold text-indigo-400 dark:text-indigo-300">{email}</span>
                </>
            }
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6 bg-white dark:bg-[#0e1117] border border-slate-200 dark:border-[#1e2433] shadow-2xl dark:shadow-[0_25px_50px_rgba(0,0,0,0.5)]"
        >
          {/* Temp password reminder */}
          {tempPwd && (
            <div className="rounded-xl px-4 py-3 mb-5 bg-slate-100 dark:bg-[#141820] border border-slate-200 dark:border-[#1e2433]">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2 text-slate-400">
                Your Temp Password
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold font-mono text-slate-400 dark:text-slate-500" style={{ color: showTempPwd ? "#a5b4fc" : undefined }}>
                  {showTempPwd ? tempPwd : "••••••••••"}
                </span>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => setShowTempPwd(v => !v)}
                    className="text-[10px] font-bold rounded-lg px-2 py-1 transition bg-slate-200 dark:bg-[#1e2433] border border-slate-300 dark:border-[#2a3347] text-slate-500"
                  >
                    {showTempPwd ? "Hide" : "Show"}
                  </button>
                  <button
                    onClick={() => navigator.clipboard?.writeText(tempPwd)}
                    className="text-[10px] font-bold rounded-lg px-2 py-1 transition bg-indigo-500/15 border border-indigo-500/30 text-indigo-400"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 6 digit boxes */}
          <div className="flex gap-2 justify-center mb-6" onPaste={handlePaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={e => handleDigit(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                className="w-11 h-14 text-center text-[22px] font-bold rounded-xl outline-none transition-[border-color,box-shadow] duration-150 caret-transparent text-slate-800 dark:text-white border border-slate-300 dark:border-[#1e2433] bg-slate-100 dark:bg-[#141820]"
                style={{
                  border: d ? "1px solid rgba(99,102,241,0.6)" : undefined,
                  color: d ? "rgb(165,180,252)" : undefined,
                  boxShadow: d ? "0 0 0 3px rgba(99,102,241,0.15)" : "none",
                }}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4 text-xs bg-red-500/10 border border-red-500/20 text-red-400">
              ⚠ {error}
            </div>
          )}

          {/* Resent confirmation */}
          {resent && !error && (
            <div className="rounded-xl px-4 py-3 mb-4 text-center text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              ✓ New code sent — check your inbox.
            </div>
          )}

          {/* Verify button */}
          <button
            onClick={verify}
            disabled={loading || otp.length < 6}
            className="w-full py-3 rounded-xl text-white font-bold text-sm transition-all bg-indigo-600 border-0 cursor-pointer shadow-[0_4px_15px_rgba(79,70,229,0.35)] disabled:bg-indigo-600/50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {loading
              ? <span className="inline-flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Verifying…
                </span>
              : "Verify & Continue →"}
          </button>

          {/* Resend / countdown */}
          <div className="mt-4 text-center">
            {countdown > 0 ? (
              <p className="text-xs text-slate-500">
                Resend code in {countdown}s
              </p>
            ) : (
              <button
                onClick={resend}
                className="text-xs inline-flex items-center gap-1.5 transition-colors text-indigo-400 bg-transparent border-0 cursor-pointer"
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114.93-2M20 15a8 8 0 01-14.93 2" />
                </svg>
                Resend verification code
              </button>
            )}
          </div>
        </div>

        {/* Tip */}
        <p className="text-center text-xs mt-4 text-slate-500">
          Check your spam folder if you don't see the email.
        </p>

        {/* Sign out */}
        <button
          onClick={() => supabase.auth.signOut()}
          className="w-full text-center text-xs mt-3 transition-colors text-slate-500 dark:text-slate-400 bg-transparent border-0 cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
