import { useState, useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import AppLogo from "../components/AppLogo";

const coopFn = async (action, body = {}) => {
  const r = await supabase.functions.invoke("coop-portal", { body: { action, ...body } });
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

export default function OrgOtpVerify({ org }) {
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
    coopFn("resend-org-otp")
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
      await coopFn("verify-org-otp", { otp_code: otp });
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
      await coopFn("resend-org-otp");
      setResent(true);
      setCountdown(60);
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch (e) {
      setError(e.message || "Could not resend. Please try again.");
    }
  };

  const email = org?.email || "";

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center p-5"
      style={{ background: "linear-gradient(135deg, #060a08 0%, #0a110d 50%, #060a08 100%)" }}
    >
      <div className="w-full" style={{ maxWidth: 360 }}>

        {/* Header */}
        <div className="text-center mb-7">
          <div className="flex justify-center mb-4">
            <div className="bg-white/90 rounded-2xl p-2 shadow-lg">
              <AppLogo className="h-10 w-auto" />
            </div>
          </div>
          <div
            className="inline-flex items-center justify-center w-10 h-10 rounded-2xl mb-3"
            style={{
              background: "linear-gradient(135deg, rgba(0,166,81,0.2), rgba(5,150,105,0.2))",
              border: "1px solid rgba(0,166,81,0.3)",
            }}
          >
            <svg width="18" height="18" fill="none" stroke="rgb(52,211,153)" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold" style={{ color: "#fff" }}>
            Verify Your Email
          </h1>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: "#6b7a99" }}>
            {otpSending
              ? "Sending a verification code…"
              : <>
                  A 6-digit code was sent to<br />
                  <span className="font-semibold" style={{ color: "#6ee7b7" }}>{email}</span>
                </>
            }
          </p>
          {org?.name && (
            <p className="text-xs mt-1.5 font-bold" style={{ color: "#4b6e5a" }}>{org.name}</p>
          )}
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6"
          style={{ background: "#0b120e", border: "1px solid #162218", boxShadow: "0 25px 50px rgba(0,0,0,0.5)" }}
        >
          {/* Temp password reminder */}
          {tempPwd && (
            <div
              className="rounded-xl px-4 py-3 mb-5"
              style={{ background: "#101a13", border: "1px solid #162218" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#3a5040" }}>
                Your Temp Password
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold font-mono" style={{ color: showTempPwd ? "#6ee7b7" : "#3a5040" }}>
                  {showTempPwd ? tempPwd : "••••••••••"}
                </span>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => setShowTempPwd(v => !v)}
                    className="text-[10px] font-bold rounded-lg px-2 py-1 transition"
                    style={{ background: "#162218", border: "1px solid #1e3024", color: "#5a8a6a" }}
                  >
                    {showTempPwd ? "Hide" : "Show"}
                  </button>
                  <button
                    onClick={() => navigator.clipboard?.writeText(tempPwd)}
                    className="text-[10px] font-bold rounded-lg px-2 py-1 transition"
                    style={{ background: "rgba(0,166,81,0.15)", border: "1px solid rgba(0,166,81,0.3)", color: "#34d399" }}
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
                style={{
                  width: 44, height: 56,
                  textAlign: "center",
                  fontSize: 22,
                  fontWeight: 700,
                  borderRadius: 12,
                  border: `1px solid ${d ? "rgba(0,166,81,0.6)" : "#162218"}`,
                  background: "#101a13",
                  color: d ? "rgb(52,211,153)" : "#fff",
                  outline: "none",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                  boxShadow: d ? "0 0 0 3px rgba(0,166,81,0.15)" : "none",
                  caretColor: "transparent",
                }}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4 text-xs"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}
            >
              ⚠ {error}
            </div>
          )}

          {/* Resent confirmation */}
          {resent && !error && (
            <div
              className="rounded-xl px-4 py-3 mb-4 text-center text-xs"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "#34d399" }}
            >
              ✓ New code sent — check your inbox.
            </div>
          )}

          {/* Verify button */}
          <button
            onClick={verify}
            disabled={loading || otp.length < 6}
            className="w-full py-3 rounded-xl text-white font-bold text-sm transition-all"
            style={{
              background: loading || otp.length < 6 ? "rgba(0,166,81,0.4)" : "#00A651",
              border: "none",
              cursor: otp.length < 6 || loading ? "not-allowed" : "pointer",
              boxShadow: otp.length === 6 && !loading ? "0 4px 15px rgba(0,166,81,0.3)" : "none",
            }}
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
              <p className="text-xs" style={{ color: "#3a5040" }}>
                Resend code in {countdown}s
              </p>
            ) : (
              <button
                onClick={resend}
                className="text-xs inline-flex items-center gap-1.5 transition-colors"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#34d399" }}
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
        <p className="text-center text-xs mt-4" style={{ color: "#3a5040" }}>
          Check your spam folder if you don't see the email.
        </p>

        {/* Sign out */}
        <button
          onClick={() => supabase.auth.signOut()}
          className="w-full text-center text-xs mt-3 transition-colors"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#2a3a30" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
