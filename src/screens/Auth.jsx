import { useState, useEffect, useRef } from "react";
import { supabase, supabaseConfigured, SUPABASE_DIRECT_URL, SUPABASE_PROXY_URL } from "../utils/supabase";
import { friendlyError } from "../utils/errorMessage";
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
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center px-4">
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

/* ── OTP verification screen ───────────────────────────────────────── */
function OtpScreen({ email, onBack, onVerified, otpType = "signup" }) {
  const t = useT();
  const [digits, setDigits]       = useState(["", "", "", "", "", ""]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [resent, setResent]       = useState(false);
  const [countdown, setCountdown] = useState(60);
  const inputRefs = useRef([]);

  useEffect(() => { inputRefs.current[0]?.focus(); }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleDigit = (idx, val) => {
    const v = val.replace(/\D/, "").slice(-1);
    const next = [...digits];
    next[idx] = v;
    setDigits(next);
    if (v && idx < 5) inputRefs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) inputRefs.current[idx - 1]?.focus();
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) { setDigits(text.split("")); inputRefs.current[5]?.focus(); }
  };

  const otp = digits.join("");

  const handleVerify = async () => {
    if (otp.length < 6) return;
    setError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: otpType });
      if (error) throw error;
      onVerified();
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
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
    if (resendError) setError(friendlyError(resendError));
    else { setResent(true); setCountdown(60); setDigits(["", "", "", "", "", ""]); inputRefs.current[0]?.focus(); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          <AppLogo className="h-14 w-auto mx-auto mb-4" />
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800">{t("auth.checkEmail")}</h2>
          <p className="text-sm text-gray-500 mt-1">We sent a 6-digit code to</p>
          <p className="text-sm font-semibold text-gray-700 mt-0.5">{email}</p>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">{error}</div>
        )}
        {resent && !error && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center">
            ✓ {t("auth.codeResent")}
          </div>
        )}

        {/* Digit boxes */}
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
              className="w-11 h-14 text-center text-[22px] font-bold rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-800 focus:outline-none focus:border-green-500 transition-colors caret-transparent"
            />
          ))}
        </div>

        <button
          onClick={handleVerify}
          disabled={loading || otp.length < 6}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
        >
          {loading ? t("auth.verifying") : t("auth.verifyCode")}
        </button>

        <div className="flex items-center justify-between mt-5 text-xs text-gray-500">
          <button onClick={onBack} className="hover:text-gray-700 underline">← {t("auth.back")}</button>
          {countdown > 0 ? (
            <span>Resend in {countdown}s</span>
          ) : (
            <button onClick={handleResend} className="text-green-600 font-medium hover:underline">{t("auth.resendCode")}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Eye icon ──────────────────────────────────────────────────────── */
function EyeIcon({ open }) {
  return open ? (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

/* ── Password strength ─────────────────────────────────────────────── */
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

/* ── Main Auth screen ──────────────────────────────────────────────── */
export default function Auth() {
  const t = useT();
  const [mode,          setMode]          = useState("login");
  const [email,         setEmail]         = useState("");
  const [password,      setPass]          = useState("");
  const [confirmPass,   setConfirmPass]   = useState("");
  const [name,          setName]          = useState("");
  const [showPw,        setShowPw]        = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(() => {
    const msg = sessionStorage.getItem("auth_block_reason");
    if (msg) sessionStorage.removeItem("auth_block_reason");
    return msg || "";
  });
  const [info,          setInfo]          = useState("");
  const [staffConfirm,  setStaffConfirm]  = useState(false);

  useEffect(() => {
    const handler = (e) => { setError(e.detail || "Login failed. Please try again."); setLoading(false); };
    window.addEventListener("kuditrack_auth_error", handler);
    return () => window.removeEventListener("kuditrack_auth_error", handler);
  }, []);

  useEffect(() => {
    if (isNative) return;
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    const oauthDesc  = params.get("error_description");
    if (oauthError) {
      setError(oauthDesc ? oauthDesc.replace(/\+/g, " ") : "Google sign-in failed. Please try again.");
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    if (params.has("code")) {
      const timer = setTimeout(() => {
        const still = new URLSearchParams(window.location.search);
        if (still.has("code")) {
          window.history.replaceState(null, "", window.location.pathname);
          setError("Google sign-in could not be completed. Please try again.");
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!supabaseConfigured) return <SetupNotice />;

  const clearMessages = () => { setError(""); setInfo(""); setShowPw(false); setShowConfirmPw(false); setConfirmPass(""); };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    let keepLoading = false;
    try {
      if (mode === "register" && password.length < 8) { setError("Password must be at least 8 characters."); return; }
      if (mode === "register" && password !== confirmPass) { setError("Passwords do not match."); return; }

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
            const { error: otpErr } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
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
        if (staffCheck) { setError("This email is registered as a staff member account and cannot be used to create a business account."); return; }
        if (ajoCheck)   { setError("This email is registered as a savings client account and cannot be used to create a business account."); return; }
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(), password, options: { data: { full_name: name } },
        });
        if (signUpErr) throw signUpErr;
        if (!signUpData?.session) setMode("otp");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setInfo("Password reset link sent — check your email.");
      }
    } catch (err) {
      setError(friendlyError(err));
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
        const authUrl = SUPABASE_DIRECT_URL && SUPABASE_PROXY_URL && data.url?.startsWith(SUPABASE_PROXY_URL)
          ? data.url.replace(SUPABASE_PROXY_URL, SUPABASE_DIRECT_URL) : data.url;
        let browserDoneListener = null;
        browserDoneListener = await Browser.addListener("browserFinished", async () => {
          browserDoneListener?.remove();
          let authResolved = false;
          const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") authResolved = true;
          });
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 500));
            if (authResolved) { authSub.unsubscribe(); return; }
            if (sessionStorage.getItem("kuditrack_oauth_exchange")) { authSub.unsubscribe(); return; }
            const { data: { session } } = await supabase.auth.getSession();
            if (session) { authSub.unsubscribe(); return; }
          }
          authSub.unsubscribe();
          window.dispatchEvent(new CustomEvent("kuditrack_auth_error", { detail: "Google sign-in was cancelled or failed. Please try again." }));
        });
        await Browser.open({ url: authUrl });
        return;
      } else {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
        });
        if (error) throw error;
        const authUrl = SUPABASE_DIRECT_URL && SUPABASE_PROXY_URL && data.url?.startsWith(SUPABASE_PROXY_URL)
          ? data.url.replace(SUPABASE_PROXY_URL, SUPABASE_DIRECT_URL) : data.url;
        window.location.href = authUrl;
      }
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  };

  if (mode === "otp") {
    return (
      <OtpScreen
        email={email}
        otpType={staffConfirm ? "email" : "signup"}
        onBack={() => { setMode(staffConfirm ? "login" : "register"); setStaffConfirm(false); clearMessages(); }}
        onVerified={() => {}}
      />
    );
  }

  const isForgot = mode === "forgot";

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">

        {/* Logo */}
        <div className="text-center mb-8">
          <AppLogo className="h-20 w-auto mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {mode === "login"    && "Welcome back"}
            {mode === "register" && t("auth.createAccount")}
            {mode === "forgot"   && t("auth.resetPassword")}
          </p>
        </div>

        {/* Back link for forgot */}
        {isForgot && (
          <button onClick={() => { setMode("login"); clearMessages(); }}
            className="text-sm text-green-600 font-medium flex items-center gap-1 hover:underline mb-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
            {t("auth.backToSignIn")}
          </button>
        )}

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}
        {info && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{info}</div>
        )}

        <form onSubmit={handleEmailAuth} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t("auth.fullName")}</label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)}
                placeholder="Adaeze Okonkwo"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t("auth.email")}</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          {!isForgot && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t("auth.password")}</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} required value={password}
                  onChange={e => setPass(e.target.value)}
                  placeholder={mode === "register" ? "Min. 8 characters" : "••••••••"}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                  className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-gray-400 hover:text-gray-600">
                  <EyeIcon open={showPw} />
                </button>
              </div>
              {mode === "register" && password.length > 0 && (() => {
                const s = getPasswordStrength(password);
                return (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">{[1,2,3,4].map(i => <div key={i} className={`h-1 flex-1 rounded-full ${i <= s.bars ? s.color : "bg-gray-200"}`} />)}</div>
                    <p className={`text-[11px] font-semibold ${s.text}`}>{s.label} password</p>
                  </div>
                );
              })()}
            </div>
          )}

          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t("auth.confirmPassword")}</label>
              <div className="relative">
                <input type={showConfirmPw ? "text" : "password"} required value={confirmPass}
                  onChange={e => setConfirmPass(e.target.value)}
                  placeholder="Re-enter your password"
                  className={`w-full border rounded-lg px-3 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 ${
                    confirmPass.length > 0
                      ? confirmPass === password ? "border-green-400 focus:ring-green-500" : "border-red-300 focus:ring-red-400"
                      : "border-gray-300 focus:ring-green-500"
                  }`} />
                <button type="button" onClick={() => setShowConfirmPw(v => !v)} tabIndex={-1}
                  className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-gray-400 hover:text-gray-600">
                  <EyeIcon open={showConfirmPw} />
                </button>
              </div>
              {confirmPass.length > 0 && (
                <p className={`mt-1.5 text-[11px] font-semibold ${confirmPass === password ? "text-green-600" : "text-red-500"}`}>
                  {confirmPass === password ? "✓ Passwords match" : "✗ Passwords do not match"}
                </p>
              )}
            </div>
          )}

          {mode === "login" && (
            <div className="text-right">
              <button type="button" onClick={() => { setMode("forgot"); clearMessages(); }}
                className="text-xs text-green-600 hover:underline">{t("auth.forgotPassword")}</button>
            </div>
          )}

          <button type="submit"
            disabled={loading || (mode === "register" && confirmPass.length > 0 && confirmPass !== password)}
            className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 disabled:opacity-60 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors">
            {loading
              ? t("auth.pleaseWait")
              : mode === "login"    ? t("auth.signIn")
              : mode === "register" ? t("auth.createAccount")
              : t("auth.sendResetLink")}
          </button>
        </form>

        {!isForgot && (
          <>
            <div className="flex items-center gap-2 my-5">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">{t("auth.or")}</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <button onClick={handleGoogle} disabled={loading}
              className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors">
              <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {t("auth.continueGoogle")}
            </button>
            <p className="text-center text-[11px] text-gray-400 mt-2">{t("auth.googleNote")}</p>
          </>
        )}

        <p className="text-center text-xs text-gray-500 mt-6">
          {mode === "login" ? (
            <>Don't have an account?{" "}
              <button onClick={() => { setMode("register"); clearMessages(); }} className="text-green-600 font-medium hover:underline">Sign up</button>
            </>
          ) : mode === "register" ? (
            <>Already have an account?{" "}
              <button onClick={() => { setMode("login"); clearMessages(); }} className="text-green-600 font-medium hover:underline">Sign in</button>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
