import { useState, useEffect } from "react";
import { supabase, supabaseConfigured } from "../utils/supabase";
import AppLogo from "../components/AppLogo";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { useT } from "../contexts/LanguageContext";

const isNative = Capacitor.isNativePlatform();
const OAUTH_REDIRECT = isNative
  ? "com.amayatechnologies.kuditrack://login-callback"
  : window.location.origin;

function SetupNotice() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8 text-center">
        <AppLogo className="h-16 w-auto mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-800 mb-2">Supabase not configured</h1>
        <p className="text-sm text-gray-500 mb-4">
          Create a <code className="bg-gray-100 px-1 rounded">.env</code> file with your Supabase credentials.
        </p>
        <div className="bg-gray-50 rounded-lg p-3 text-left text-xs font-mono text-gray-600 space-y-1">
          <div>REACT_APP_SUPABASE_URL=https://xxx.supabase.co</div>
          <div>REACT_APP_SUPABASE_ANON_KEY=your-anon-key</div>
        </div>
      </div>
    </div>
  );
}

/* ── 6-digit OTP input ─────────────────────────────────────────────── */
function OtpInput({ value, onChange }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={6}
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="6-digit code"
      className="w-full text-center text-2xl font-bold tracking-[0.5em] border-2 rounded-xl py-3
        border-slate-200 focus:border-emerald-500 focus:outline-none
        bg-slate-50 text-gray-900 transition-colors"
    />
  );
}

/* ── OTP verification screen ───────────────────────────────────────── */
function OtpScreen({ email, onBack, otpType = "signup" }) {
  const t = useT();
  const [otp, setOtp]         = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [resent, setResent]   = useState(false);

  const handleVerify = async () => {
    if (otp.length < 6) return;
    setError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: otpType });
      if (error) throw error;
      // Stay loading — component unmounts when auth status changes
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setResent(false);
    let resendError;
    if (otpType === "email") {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      resendError = error;
    } else {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      resendError = error;
    }
    if (resendError) setError(resendError.message);
    else setResent(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>

      {/* Header */}
      <div className="flex-shrink-0 px-5 py-5 flex items-center gap-3"
        style={{ background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)" }}>
        <div className="bg-white/15 rounded-xl p-2 flex-shrink-0">
          <AppLogo className="h-8 w-auto" />
        </div>
        <div>
          <p className="text-white font-extrabold text-base leading-tight">KudiAI Track</p>
          <p className="text-white/70 text-[11px] font-medium">Business · Savings · Bills</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center px-5 py-8 max-w-sm w-full mx-auto">
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: "linear-gradient(135deg,#ecfdf5,#d1fae5)" }}>
          <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        <h2 className="text-xl font-extrabold text-slate-800 text-center mb-1">{t("auth.checkEmail")}</h2>
        <p className="text-sm text-slate-500 text-center mb-1">{t("auth.codeSentTo")}</p>
        <p className="text-sm font-bold text-slate-700 text-center mb-6">{email}</p>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </div>
        )}
        {resent && (
          <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            {t("auth.codeResent")}
          </div>
        )}

        <div className="mb-5">
          <OtpInput value={otp} onChange={setOtp} />
        </div>

        <button
          onClick={handleVerify}
          disabled={loading || otp.length < 6}
          className="w-full text-white font-bold rounded-xl py-3.5 text-sm transition-all disabled:opacity-50 shadow-sm"
          style={{ background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)" }}
        >
          {loading ? t("auth.verifying") : t("auth.verifyCode")}
        </button>

        <div className="flex items-center justify-between mt-4 text-xs text-slate-500">
          <button onClick={onBack} className="hover:text-slate-700 underline">{t("auth.back")}</button>
          <button onClick={handleResend} className="text-emerald-600 font-semibold hover:underline">{t("auth.resendCode")}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Password strength helper ──────────────────────────────────────── */
function getPasswordStrength(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: "Weak",   color: "bg-red-500",    text: "text-red-600",    bars: 1 };
  if (score <= 3) return { label: "Fair",   color: "bg-yellow-400", text: "text-yellow-600", bars: 2 };
  if (score === 4) return { label: "Good",  color: "bg-blue-500",   text: "text-blue-600",   bars: 3 };
  return               { label: "Strong", color: "bg-emerald-500", text: "text-emerald-600", bars: 4 };
}

/* ── Eye icon ──────────────────────────────────────────────────────── */
function EyeIcon({ open }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

/* ── Main Auth screen ──────────────────────────────────────────────── */
export default function Auth() {
  const t = useT();
  const [mode,          setMode]         = useState("login");
  const [email,         setEmail]        = useState("");
  const [password,      setPass]         = useState("");
  const [confirmPass,   setConfirmPass]  = useState("");
  const [name,          setName]         = useState("");
  const [showPw,        setShowPw]       = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading,       setLoading]      = useState(false);
  const [error,         setError]        = useState(() => {
    const msg = sessionStorage.getItem("auth_block_reason");
    if (msg) sessionStorage.removeItem("auth_block_reason");
    return msg || "";
  });
  const [info,          setInfo]         = useState("");
  const [staffConfirm,  setStaffConfirm] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      setError(e.detail || "Login failed. Please try again.");
      setLoading(false);
    };
    window.addEventListener("kuditrack_auth_error", handler);
    return () => window.removeEventListener("kuditrack_auth_error", handler);
  }, []);

  if (!supabaseConfigured) return <SetupNotice />;

  const clearMessages = () => {
    setError(""); setInfo("");
    setShowPw(false); setShowConfirmPw(false); setConfirmPass("");
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    let keepLoading = false;
    try {
      if (mode === "register" && password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (mode === "register" && password !== confirmPass) {
        setError("Passwords do not match. Please check and try again.");
        return;
      }
      if (mode === "login") {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          const msg = signInErr.message.toLowerCase();
          if (msg.includes("not confirmed") || msg.includes("email not confirmed")) {
            const { data: orgMemberCheck } = await supabase
              .from("org_members").select("id").eq("email", email.trim().toLowerCase()).maybeSingle();
            if (orgMemberCheck) {
              setError("Your account needs to be verified. Please log in with the temporary password your admin gave you.");
              return;
            }
            const { error: otpErr } = await supabase.auth.signInWithOtp({
              email,
              options: { shouldCreateUser: false },
            });
            if (otpErr) throw otpErr;
            setStaffConfirm(true);
            setMode("otp");
            return;
          }
          throw signInErr;
        }
        keepLoading = true;
        return;
      } else if (mode === "register") {
        const [{ data: staffCheck }, { data: ajoCheck }] = await Promise.all([
          supabase.from("staff").select("id").eq("email", email.trim().toLowerCase()).maybeSingle(),
          supabase.from("aso_clients").select("id").eq("email", email.trim().toLowerCase()).maybeSingle(),
        ]);
        if (staffCheck) {
          setError("This email is registered as a staff member account and cannot be used to create a business account.");
          return;
        }
        if (ajoCheck) {
          setError("This email is registered as a savings client account and cannot be used to create a business account.");
          return;
        }
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: name } },
        });
        if (signUpErr) throw signUpErr;
        if (!signUpData?.session) setMode("otp");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setInfo("Password reset link sent — check your email.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      if (!keepLoading) setLoading(false);
    }
  };

  const handleGoogle = async () => {
    clearMessages();
    setLoading(true);
    try {
      if (isNative) {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
        });
        if (error) throw error;
        await Browser.open({ url: data.url, windowName: "_self" });
        return;
      } else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: OAUTH_REDIRECT, queryParams: { prompt: "select_account" } },
        });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (mode === "otp") {
    return (
      <OtpScreen
        email={email}
        otpType={staffConfirm ? "email" : "signup"}
        onBack={() => { setMode(staffConfirm ? "login" : "register"); setStaffConfirm(false); clearMessages(); }}
      />
    );
  }

  const isForgot = mode === "forgot";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>

      {/* ── Brand header ── */}
      <div className="flex-shrink-0 px-5 py-5 flex items-center gap-3"
        style={{ background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)" }}>
        <div className="bg-white/15 rounded-xl p-2 flex-shrink-0">
          <AppLogo className="h-8 w-auto" />
        </div>
        <div>
          <p className="text-white font-extrabold text-base leading-tight">KudiAI Track</p>
          <p className="text-white/70 text-[11px] font-medium">Business · Savings · Bills</p>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-sm mx-auto px-5 py-7">

          {/* Page title */}
          {!isForgot ? (
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold text-slate-800 leading-tight">
                {mode === "login" ? "Welcome back" : "Create account"}
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {mode === "login"
                  ? "Sign in to your KudiAI Track account"
                  : "Join thousands of Nigerian businesses"}
              </p>
            </div>
          ) : (
            <div className="mb-6">
              <button
                onClick={() => { setMode("login"); clearMessages(); }}
                className="flex items-center gap-1.5 text-sm font-semibold mb-4"
                style={{ color: "#1B2A5E" }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
                </svg>
                Back to sign in
              </button>
              <h1 className="text-2xl font-extrabold text-slate-800 leading-tight">Reset password</h1>
              <p className="text-sm text-slate-500 mt-1">We'll send a reset link to your email.</p>
            </div>
          )}

          {/* Tab switcher */}
          {!isForgot && (
            <div className="flex rounded-xl p-1 mb-6 gap-1" style={{ background: "#e8edf8" }}>
              <button
                onClick={() => { setMode("login"); clearMessages(); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all"
                style={mode === "login"
                  ? { background: "#1B2A5E", color: "white", boxShadow: "0 2px 8px rgba(27,42,94,0.25)" }
                  : { background: "transparent", color: "#64748b" }}
              >
                {t("auth.signIn")}
              </button>
              <button
                onClick={() => { setMode("register"); clearMessages(); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all"
                style={mode === "register"
                  ? { background: "#1B2A5E", color: "white", boxShadow: "0 2px 8px rgba(27,42,94,0.25)" }
                  : { background: "transparent", color: "#64748b" }}
              >
                {t("auth.createAccount")}
              </button>
            </div>
          )}

          {/* Error / info banners */}
          {error && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          {info && (
            <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              {info}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">

            {mode === "register" && (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  {t("auth.fullName")}
                </label>
                <input
                  type="text" required value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Adaeze Okonkwo"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                  style={{ "--tw-ring-color": "#1B2A5E" }}
                  onFocus={e => e.target.style.boxShadow = "0 0 0 2px rgba(27,42,94,0.25)"}
                  onBlur={e => e.target.style.boxShadow = ""}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                {t("auth.email")}
              </label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 bg-white focus:outline-none transition-all"
                onFocus={e => e.target.style.boxShadow = "0 0 0 2px rgba(27,42,94,0.25)"}
                onBlur={e => e.target.style.boxShadow = ""}
              />
            </div>

            {!isForgot && (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  {t("auth.password")}
                </label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"} required value={password}
                    onChange={e => setPass(e.target.value)}
                    placeholder={mode === "register" ? "Min. 8 characters" : "••••••••"}
                    minLength={mode === "register" ? 8 : undefined}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 pr-11 text-sm text-slate-900 bg-white focus:outline-none transition-all"
                    onFocus={e => e.target.style.boxShadow = "0 0 0 2px rgba(27,42,94,0.25)"}
                    onBlur={e => e.target.style.boxShadow = ""}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5"
                    tabIndex={-1}
                  >
                    <EyeIcon open={showPw} />
                  </button>
                </div>

                {mode === "register" && password.length > 0 && (() => {
                  const s = getPasswordStrength(password);
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="flex gap-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= s.bars ? s.color : "bg-slate-200"}`} />
                        ))}
                      </div>
                      <p className={`text-[11px] font-semibold ${s.text}`}>{s.label} password</p>
                    </div>
                  );
                })()}

                {mode === "register" && password.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Use 8+ characters with uppercase, numbers & symbols.
                  </p>
                )}
              </div>
            )}

            {mode === "register" && (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                  {t("auth.confirmPassword")}
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPw ? "text" : "password"} required value={confirmPass}
                    onChange={e => setConfirmPass(e.target.value)}
                    placeholder="Re-enter your password"
                    className={`w-full border rounded-xl px-4 py-3 pr-11 text-sm text-slate-900 bg-white focus:outline-none transition-all ${
                      confirmPass.length > 0
                        ? confirmPass === password ? "border-emerald-400" : "border-red-300"
                        : "border-slate-200"
                    }`}
                    onFocus={e => e.target.style.boxShadow = "0 0 0 2px rgba(27,42,94,0.25)"}
                    onBlur={e => e.target.style.boxShadow = ""}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5"
                    tabIndex={-1}
                  >
                    <EyeIcon open={showConfirmPw} />
                  </button>
                </div>
                {confirmPass.length > 0 && (
                  <p className={`mt-1.5 text-[11px] font-semibold ${confirmPass === password ? "text-emerald-600" : "text-red-500"}`}>
                    {confirmPass === password ? "✓ Passwords match" : "✗ Passwords do not match"}
                  </p>
                )}
              </div>
            )}

            {mode === "login" && (
              <div className="text-right -mt-1">
                <button type="button"
                  onClick={() => { setMode("forgot"); clearMessages(); }}
                  className="text-xs font-semibold hover:underline"
                  style={{ color: "#1B2A5E" }}>
                  {t("auth.forgotPassword")}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (mode === "register" && confirmPass.length > 0 && confirmPass !== password)}
              className="w-full text-white font-extrabold rounded-xl py-3.5 text-sm transition-all disabled:opacity-50 shadow-md mt-2"
              style={{ background: "linear-gradient(135deg,#1B2A5E,#2d4a8a)" }}
            >
              {loading
                ? t("auth.pleaseWait")
                : mode === "login"    ? t("auth.signIn")
                : mode === "register" ? t("auth.createAccount")
                : t("auth.sendResetLink")}
            </button>
          </form>

          {/* Google sign-in */}
          {!isForgot && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">{t("auth.or")}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <button
                onClick={handleGoogle}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 border border-slate-200 bg-white rounded-xl py-3.5 text-sm font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60 transition-colors shadow-sm"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {t("auth.continueGoogle")}
              </button>

              <p className="text-center text-[11px] text-slate-400 mt-3 leading-snug">
                {t("auth.googleNote")}
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
