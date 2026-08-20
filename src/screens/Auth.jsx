import { useState, useEffect, useRef } from "react";
import { supabase, supabaseConfigured, SUPABASE_DIRECT_URL, SUPABASE_PROXY_URL } from "../utils/supabase";
import { friendlyError } from "../utils/errorMessage";
import AppLogo from "../components/AppLogo";
import { AuthShell, AuthCard } from "../components/AuthShell";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { useT } from "../contexts/LanguageContext";

const isNative = Capacitor.isNativePlatform();
const OAUTH_REDIRECT = isNative
  ? "com.amayatechnologies.kuditrack://login-callback"
  : window.location.origin;

// ── OTP lockout helpers ────────────────────────────────────────────────
function getLockoutState(email) {
  try {
    const raw = localStorage.getItem(`kt_otp_lockout_${email}`);
    return raw ? JSON.parse(raw) : { attempts: 0, lockedUntil: null };
  } catch { return { attempts: 0, lockedUntil: null }; }
}
function saveLockoutState(email, state) {
  localStorage.setItem(`kt_otp_lockout_${email}`, JSON.stringify(state));
}
function clearLockoutState(email) {
  localStorage.removeItem(`kt_otp_lockout_${email}`);
}

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

/* ── Full-screen photo background wrapper ─────────────────────────── */
function BgLayout({ children, center = false }) {
  const t = useT();
  return (
    <div className="fixed inset-0 flex flex-col">
      {/* Portrait photo — fills entire screen, anchored top to show face */}
      <img
        src="/login-bg.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-top"
        draggable={false}
      />
      {/* Gradient: stronger overlay so all text is clearly readable */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/20 to-black/90" />

      {/* KudiAI Track brand — top, safe area aware */}
      <div className="relative z-10 flex-shrink-0 px-5 pb-2 flex items-center gap-3"
        style={{ paddingTop: "max(40px, env(safe-area-inset-top, 40px))" }}>
        <div className="bg-white/90 rounded-xl p-2 shadow-lg flex-shrink-0">
          <img src="/logo-tp.png" alt="KudiAI Track" className="h-12 w-12 object-contain" />
        </div>
        <div>
          <p className="text-white font-extrabold text-lg leading-tight tracking-wide drop-shadow-lg">KudiAI Track</p>
          <p className="text-white/80 text-[11px] leading-tight font-medium">Business · Savings · Bills</p>
        </div>
      </div>

      {center ? (
        /* OTP screen — card at bottom */
        <div className="relative z-10 flex-1 min-h-0 flex items-end justify-center px-4 pb-6">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 overflow-y-auto" style={{ maxHeight: "80dvh" }}>
            {children}
          </div>
        </div>
      ) : (
        <>
          {/* Hero tagline — takes available space, pinned to bottom of its area */}
          <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-end px-6 pb-4">
            <p className="text-white font-extrabold text-2xl leading-snug mb-1"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>
              {t("auth.tagline")}
            </p>
            <p className="text-white/90 text-sm font-medium" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>
              {t("auth.designed")}
            </p>
          </div>

          {/* Bottom sheet — fixed height cap, scrolls internally if form is long */}
          <div className="relative z-10 flex-shrink-0 bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl w-full max-w-md mx-auto overflow-y-auto"
            style={{ maxHeight: "62dvh" }}>
            <div className="px-6 pt-5 pb-8">
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── OTP verification screen — dark design matching marketer/admin ──── */
function OtpScreen({ email, onBack, onVerified, otpType = "signup", onSubmit, initialError = "", onFail }) {
  const t = useT();
  const [digits, setDigits]       = useState(["", "", "", "", "", ""]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(initialError);
  const [resent, setResent]       = useState(false);
  const [countdown, setCountdown] = useState(60);
  const inputRefs = useRef([]);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleDigit = (idx, val) => {
    const v = val.replace(/\D/, "").slice(-1);
    const next = [...digits];
    next[idx] = v;
    setDigits(next);
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

  const handleVerify = async () => {
    if (otp.length < 6) return;
    setError("");
    setLoading(true);
    try {
      if (onSubmit) {
        onSubmit(otp);
        return; // caller handles mode switch; loading stays true until component unmounts
      }
      const { error: verifyErr } = await supabase.auth.verifyOtp({ email, token: otp, type: otpType });
      if (verifyErr) {
        // Distinguish expired OTP from wrong OTP — Supabase can return similar errors for both.
        // Any message mentioning "expired" → code timed out; anything else → code is wrong.
        const msg = (verifyErr.message || "").toLowerCase();
        const errMsg = (msg.includes("token has expired") || msg.includes("otp expired") || msg.includes("expired"))
          ? "This code has expired — request a new one"
          : "Incorrect code — please check and try again";
        if (isMounted.current) { setError(errMsg); onFail?.(); setLoading(false); }
        return;
      }
      // verifyOtp succeeded. Await onVerified so updateUser runs in the same async chain
      // with no gap — prevents session-expiry races for the reset flow.
      // If onVerified throws (e.g. updateUser failed), it surfaces in the catch below.
      await onVerified?.();
      if (isMounted.current) setLoading(false);
    } catch (err) {
      if (isMounted.current) {
        setError(err.__friendly || friendlyError(err));
        onFail?.();
        setLoading(false);
      }
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
    if (resendError) {
      setError(friendlyError(resendError));
    } else {
      setResent(true);
      setCountdown(60);
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    }
  };

  return (
    <AuthShell variant="card">

      {/* Header */}
      <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <AppLogo className="h-10 w-auto" />
          </div>
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl mb-3 bg-indigo-500/20 border border-indigo-500/30">
            <svg width="18" height="18" fill="none" stroke="rgb(129,140,248)" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white m-0">
            {t("auth.checkEmail")}
          </h1>
          <p className="text-sm mt-2 leading-relaxed text-slate-500">
            We sent a 6-digit code to<br />
            <span className="font-semibold text-indigo-400 dark:text-indigo-300">{email}</span>
          </p>
        </div>

      {/* Card */}
      <AuthCard>

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

          {/* Code resent confirmation */}
          {resent && !error && (
            <div className="rounded-xl px-4 py-3 mb-4 text-center text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              ✓ {t("auth.codeResent")}
            </div>
          )}

          {/* Verify button */}
          <button
            onClick={handleVerify}
            disabled={loading || otp.length < 6}
            className="w-full py-3 rounded-xl text-white font-bold text-sm transition-all bg-indigo-600 border-0 cursor-pointer shadow-[0_4px_15px_rgba(79,70,229,0.35)] disabled:bg-indigo-600/50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {loading
              ? <span className="inline-flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {t("auth.verifying")}
                </span>
              : t("auth.verifyCode")}
          </button>

          {/* Resend / countdown */}
          <div className="mt-4 text-center">
            {countdown > 0 ? (
              <p className="text-xs text-slate-500">Resend code in {countdown}s</p>
            ) : (
              <button
                onClick={handleResend}
                className="text-xs inline-flex items-center gap-1.5 transition-colors text-indigo-400 bg-transparent border-0 cursor-pointer"
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114.93-2M20 15a8 8 0 01-14.93 2" />
                </svg>
                {t("auth.resendCode")}
              </button>
            )}
          </div>
      </AuthCard>

      {/* Back link */}
      <button
        onClick={onBack}
        className="w-full text-center text-xs mt-4 transition-colors text-slate-500 dark:text-slate-400 bg-transparent border-0 cursor-pointer"
      >
        ← {t("auth.back")}
      </button>

      <p className="text-center text-xs mt-4 text-slate-400 dark:text-slate-600">
        © Amaya &amp; Co. Technologies. All Rights Reserved.
      </p>
    </AuthShell>
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
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

/* ── Main Auth screen ──────────────────────────────────────────────── */
export default function Auth() {
  const t = useT();
  const [mode,          setMode]         = useState("login"); // "login" | "register" | "forgot" | "otp" | "reset_otp"
  const [email,         setEmail]        = useState("");
  const [password,      setPass]         = useState("");
  const [confirmPass,   setConfirmPass]  = useState("");
  const [name,          setName]         = useState("");
  const [showPw,        setShowPw]       = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading,       setLoading]      = useState(false);
  const [error,        setError]        = useState(() => {
    const msg = sessionStorage.getItem("auth_block_reason");
    if (msg) sessionStorage.removeItem("auth_block_reason");
    return msg || "";
  });

  // Listen for auth errors dispatched by useAuth while this component is already mounted
  useEffect(() => {
    const handler = (e) => {
      setError(e.detail || "Login failed. Please try again.");
      setLoading(false); // Reset so user can retry after a routing error
    };
    window.addEventListener("kuditrack_auth_error", handler);
    return () => window.removeEventListener("kuditrack_auth_error", handler);
  }, []);

  // Web: surface OAuth errors that Google/Supabase puts in the URL (?error=access_denied etc.)
  // Also detect silent PKCE exchange failure: if Auth is still mounted after 3 s and ?code=
  // is still in the URL, the exchange failed without dispatching an error event.
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
      // A ?code= means we just came back from OAuth. Auth should unmount quickly if the
      // exchange succeeds. If we're still here after 3 s, the exchange silently failed.
      const t = setTimeout(() => {
        const still = new URLSearchParams(window.location.search);
        if (still.has("code")) {
          window.history.replaceState(null, "", window.location.pathname);
          setError("Google sign-in could not be completed. Please try again.");
        }
      }, 3000);
      return () => clearTimeout(t);
    }
  }, []);

  const [info,         setInfo]         = useState("");
  const [staffConfirm, setStaffConfirm] = useState(false);

  // Password reset OTP flow state
  const [resetTrigger,     setResetTrigger]     = useState(0); // bumped to force re-render after localStorage lockout changes
  const [newPassword,      setNewPassword]      = useState("");
  const [newConfirmPass,   setNewConfirmPass]   = useState("");
  const [showNewPw,        setShowNewPw]        = useState(false);
  const [showNewConfirmPw, setShowNewConfirmPw] = useState(false);
  const [resetOtpError,    setResetOtpError]    = useState("");

  // Countdown tick for the OTP lockout screen — wakes every minute (or when lockout expires)
  // so the remaining-time display updates without a manual refresh.
  useEffect(() => {
    if (mode !== "reset_otp") return;
    const ld = getLockoutState(email);
    if (!ld.lockedUntil || Date.now() >= ld.lockedUntil) return;
    const remaining = ld.lockedUntil - Date.now();
    const timer = setTimeout(() => setResetTrigger(t => t + 1), Math.min(remaining + 100, 60000));
    return () => clearTimeout(timer);
  }, [mode, email, resetTrigger]);

  if (!supabaseConfigured) return <SetupNotice />;

  const clearMessages = () => { setError(""); setInfo(""); setShowPw(false); setShowConfirmPw(false); setConfirmPass(""); };

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
            // Check if this is an org member — they must use their temp password + custom OTP flow,
            // not the Supabase magic link. If so, surface a clear error instead.
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
        // Login succeeded — stay in loading state while useAuth routes the user.
        // Component will unmount once status changes; if routing fails, useAuth
        // fires kuditrack_auth_error and sets status "unauthenticated" which
        // remounts Auth and resets loading automatically.
        keepLoading = true;
        return;
      } else if (mode === "register") {
        const [{ data: staffCheck }, { data: ajoCheck }] = await Promise.all([
          supabase.from("staff").select("id").eq("email", email.trim().toLowerCase()).maybeSingle(),
          supabase.from("aso_clients").select("id").eq("email", email.trim().toLowerCase()).maybeSingle(),
        ]);
        if (staffCheck) {
          setError("This email is registered as a staff member account and cannot be used to create a business account.");
          setLoading(false);
          return;
        }
        if (ajoCheck) {
          setError("This email is registered as a savings client account and cannot be used to create a business account.");
          setLoading(false);
          return;
        }
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: name } },
        });
        if (signUpErr) throw signUpErr;

        if (signUpData?.session) {
          // Email confirmation is disabled — user is immediately signed in
          // useAuth picks up the session automatically
        } else {
          // Email confirmation required — show OTP verification screen
          setMode("otp");
        }
      } else {
        // Validate the new password fields (collected on the forgot form)
        if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
        if (newPassword !== newConfirmPass) { setError("Passwords do not match."); return; }

        // Respect localStorage lockout — user may have hit 3 wrong OTPs in a previous attempt
        const ld = getLockoutState(email);
        if (ld.lockedUntil && Date.now() < ld.lockedUntil) {
          const minLeft = Math.ceil((ld.lockedUntil - Date.now()) / 60000);
          setError(`Too many failed attempts. Please wait ${minLeft} minute${minLeft !== 1 ? "s" : ""} before trying again.`);
          return;
        }

        // Same-password pre-check: signInWithPassword succeeds ⟹ new password == current password
        const { error: sameCheckErr } = await supabase.auth.signInWithPassword({ email, password: newPassword });
        if (!sameCheckErr) {
          // Matches the current password — sign out the temporary session and reject
          await supabase.auth.signOut({ scope: "local" }).catch(() => {});
          setError("Your new password must be different from your current password.");
          return;
        }

        // Send OTP
        const { error: otpErr } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        if (otpErr) throw otpErr;
        sessionStorage.setItem("kuditrack_password_reset", "1");
        setResetOtpError("");
        setMode("reset_otp");
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

        // Same proxy bypass as the web path — the Vercel /sb proxy mangles the 302
        // redirect chain from the authorize endpoint to Google. Without this, the
        // Chrome Custom Tab ends up loading kudiai.app instead of triggering the
        // custom-scheme deep link back into the app.
        const authUrl = SUPABASE_DIRECT_URL && SUPABASE_PROXY_URL && data.url?.startsWith(SUPABASE_PROXY_URL)
          ? data.url.replace(SUPABASE_PROXY_URL, SUPABASE_DIRECT_URL)
          : data.url;

        // Safety valve: Chrome Custom Tab sometimes blocks custom-scheme redirects,
        // causing appUrlOpen to never fire and the loading spinner to freeze.
        //
        // On some Android devices appUrlOpen arrives >5 s after browserFinished
        // (OS URL routing latency + first-time registration DB overhead).
        // The original 5 s window produced a false "cancelled" error even though
        // the exchange completed shortly after.  Extended to 15 s (30 × 500 ms).
        //
        // Three exit conditions (any one is enough to abort the error):
        //   1. onAuthStateChange SIGNED_IN — instant detection when session lands
        //   2. sessionStorage flag set     — appUrlOpen fired, exchange in flight
        //   3. getSession() returns a session — exchange completed between ticks
        let browserDoneListener = null;
        browserDoneListener = await Browser.addListener("browserFinished", async () => {
          browserDoneListener?.remove();

          let authResolved = false;
          const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
              authResolved = true;
            }
          });

          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 500));
            if (authResolved) { authSub.unsubscribe(); return; }
            if (sessionStorage.getItem("kuditrack_oauth_exchange")) { authSub.unsubscribe(); return; }
            const { data: { session } } = await supabase.auth.getSession();
            if (session) { authSub.unsubscribe(); return; }
          }

          authSub.unsubscribe();
          window.dispatchEvent(new CustomEvent("kuditrack_auth_error", {
            detail: "Google sign-in was cancelled or failed. Please try again.",
          }));
        });

        await Browser.open({ url: authUrl });
        // Stay loading — browser is open. Either appUrlOpen fires (success) or
        // browserFinished fires (cancel/failure) — both paths eventually reset loading.
        return;
      } else {
        // Use skipBrowserRedirect so we receive the URL and can navigate to the
        // DIRECT Supabase URL, bypassing the Vercel proxy. Vercel's proxy rewrites
        // can interfere with the 302 redirect chain to Google (the authorize endpoint
        // returns a redirect, not data — proxying it can mangle the Location header).
        // The PKCE code exchange after the callback still goes through the proxy (fine).
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
        });
        if (error) throw error;
        const authUrl = SUPABASE_DIRECT_URL && SUPABASE_PROXY_URL && data.url?.startsWith(SUPABASE_PROXY_URL)
          ? data.url.replace(SUPABASE_PROXY_URL, SUPABASE_DIRECT_URL)
          : data.url;
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
        onVerified={() => { /* useAuth picks up the session automatically */ }}
      />
    );
  }

  if (mode === "reset_otp") {
    // Read lockout state fresh from localStorage every render (Bug 4 — survives app refresh)
    const ld = getLockoutState(email);
    const isLocked = ld.lockedUntil && Date.now() < ld.lockedUntil;

    if (isLocked) {
      const minLeft = Math.ceil((ld.lockedUntil - Date.now()) / 60000);
      return (
        <BgLayout center>
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4 bg-red-100">
              <svg width="24" height="24" fill="none" stroke="#ef4444" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Too Many Attempts</h2>
            <p className="text-sm text-gray-500 mb-6">
              You entered the wrong code 3 times.<br />
              Please wait <span className="font-semibold text-red-600">{minLeft} minute{minLeft !== 1 ? "s" : ""}</span> before trying again.
            </p>
            <button
              onClick={() => {
                sessionStorage.removeItem("kuditrack_password_reset");
                supabase.auth.signOut({ scope: "global" }).catch(() => {});
                setResetOtpError(""); clearMessages();
                setNewPassword(""); setNewConfirmPass("");
                setMode("login");
              }}
              className="w-full py-3 rounded-xl text-white font-bold text-sm bg-gray-800 border-0 cursor-pointer"
            >
              Back to Sign In
            </button>
          </div>
        </BgLayout>
      );
    }

    return (
      <OtpScreen
        email={email}
        otpType="email"
        initialError={resetOtpError}
        onBack={() => {
          sessionStorage.removeItem("kuditrack_password_reset");
          supabase.auth.signOut({ scope: "global" }).catch(() => {});
          setResetOtpError(""); clearMessages();
          setNewPassword(""); setNewConfirmPass("");
          setMode("forgot");
        }}
        onVerified={async () => {
          // verifyOtp just succeeded — run updateUser immediately in the same async chain.
          // No mode switch or user interaction in between: eliminates session-expiry window.
          clearLockoutState(email);
          const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
          if (updateErr) {
            // Supabase natively rejects same-password updates on some plan configs.
            // Surface a clear message rather than the raw error.
            const msg = (updateErr.message || "").toLowerCase();
            const friendlyMsg = (msg.includes("different") || msg.includes("same") || msg.includes("password"))
              ? "Your new password must be different from your current password."
              : friendlyError(updateErr);
            const err = new Error(friendlyMsg);
            err.__friendly = friendlyMsg;
            throw err;
          }
          // Success — force sign-out of all devices (app lock regardless of user setting)
          sessionStorage.removeItem("kuditrack_password_reset");
          await supabase.auth.signOut({ scope: "global" });
          setNewPassword(""); setNewConfirmPass(""); setResetOtpError("");
          setMode("login");
          setInfo("Password updated successfully. Please sign in with your new password.");
        }}
        onFail={() => {
          // Increment attempt count in localStorage so lockout survives app refresh (Bug 4)
          const current = getLockoutState(email);
          const next = (current.attempts || 0) + 1;
          saveLockoutState(email, {
            attempts: next,
            lockedUntil: next >= 3 ? Date.now() + 30 * 60 * 1000 : (current.lockedUntil || null),
          });
          setResetTrigger(t => t + 1); // trigger re-render so lockout screen shows immediately
        }}
      />
    );
  }

  const isForgot = mode === "forgot";

  return (
    <BgLayout>
      {/* Tab switcher — Sign In / Create Account */}
      {!isForgot && (
        <div className="flex bg-gray-100 dark:bg-slate-800 rounded-xl p-1 mb-5">
          <button
            onClick={() => { setMode("login"); clearMessages(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === "login"
                ? "bg-white dark:bg-slate-700 text-gray-800 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
            }`}
          >
            {t("auth.signIn")}
          </button>
          <button
            onClick={() => { setMode("register"); clearMessages(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === "register"
                ? "bg-white dark:bg-slate-700 text-gray-800 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
            }`}
          >
            {t("auth.createAccount")}
          </button>
        </div>
      )}

      {isForgot && (
        <div className="mb-5">
          <button
            onClick={() => { setMode("login"); clearMessages(); }}
            className="text-sm text-emerald-600 font-medium flex items-center gap-1 hover:underline"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
            {t("auth.backToSignIn")}
          </button>
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mt-2">{t("auth.resetPassword")}</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">Enter your new password, then we'll send a 6-digit verification code to your email.</p>
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-4 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2.5">
          {info}
        </div>
      )}

      <form onSubmit={handleEmailAuth} className="space-y-3.5">
        {mode === "register" && (
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">{t("auth.fullName")}</label>
            <input
              type="text" required value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Adaeze Okonkwo"
              className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">{t("auth.email")}</label>
          <input
            type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
          />
        </div>

        {!isForgot && (
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">{t("auth.password")}</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"} required value={password}
                onChange={(e) => setPass(e.target.value)}
                placeholder={mode === "register" ? "Min. 8 characters" : "••••••••"}
                minLength={mode === "register" ? 8 : undefined}
                className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-brand-500/40 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                tabIndex={-1}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                <EyeIcon open={showPw} />
              </button>
            </div>

            {/* Strength meter — only on register */}
            {mode === "register" && password.length > 0 && (() => {
              const s = getPasswordStrength(password);
              return (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-1">
                    {[1,2,3,4].map(i => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= s.bars ? s.color : "bg-gray-200"}`} />
                    ))}
                  </div>
                  <p className={`text-[11px] font-semibold ${s.text}`}>{s.label} password</p>
                </div>
              );
            })()}

            {/* Hint — only on register, before typing */}
            {mode === "register" && password.length === 0 && (
              <p className="mt-1.5 text-[11px] text-gray-400">
                Use 8+ characters with uppercase, numbers & symbols for a strong password.
              </p>
            )}
          </div>
        )}

        {/* Confirm password — register only */}
        {mode === "register" && (
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">{t("auth.confirmPassword")}</label>
            <div className="relative">
              <input
                type={showConfirmPw ? "text" : "password"} required value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                placeholder="Re-enter your password"
                className={`w-full border rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${
                  confirmPass.length > 0
                    ? confirmPass === password
                      ? "border-emerald-400 focus:ring-emerald-500"
                      : "border-red-300 focus:ring-red-400"
                    : "border-gray-200 dark:border-slate-600 focus:ring-emerald-500"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw(v => !v)}
                className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                tabIndex={-1}
                aria-label={showConfirmPw ? "Hide password" : "Show password"}
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

        {/* New password + confirm — only on the forgot form */}
        {isForgot && (
          <>
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">New Password</label>
              <div className="relative">
                <input
                  type={showNewPw ? "text" : "password"} required value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters" minLength={8}
                  className="w-full border border-gray-200 dark:border-slate-600 rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
                <button type="button" onClick={() => setShowNewPw(v => !v)}
                  className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" tabIndex={-1}>
                  <EyeIcon open={showNewPw} />
                </button>
              </div>
              {newPassword.length > 0 && (() => {
                const s = getPasswordStrength(newPassword);
                return (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex gap-0.5 flex-1">
                      {[1,2,3,4].map(b => (
                        <div key={b} className={`h-1 flex-1 rounded-full transition-all duration-300 ${b <= s.bars ? s.color : "bg-gray-200"}`} />
                      ))}
                    </div>
                    <span className={`text-[11px] font-semibold ${s.text}`}>{s.label}</span>
                  </div>
                );
              })()}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showNewConfirmPw ? "text" : "password"} required value={newConfirmPass}
                  onChange={(e) => setNewConfirmPass(e.target.value)}
                  placeholder="Repeat new password" minLength={8}
                  className={`w-full border rounded-xl px-4 py-3 pr-11 text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${
                    newConfirmPass.length > 0
                      ? newConfirmPass === newPassword ? "border-emerald-400 focus:ring-emerald-500" : "border-red-300 focus:ring-red-400"
                      : "border-gray-200 dark:border-slate-600 focus:ring-emerald-500"
                  }`}
                />
                <button type="button" onClick={() => setShowNewConfirmPw(v => !v)}
                  className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" tabIndex={-1}>
                  <EyeIcon open={showNewConfirmPw} />
                </button>
              </div>
              {newConfirmPass.length > 0 && (
                <p className={`mt-1.5 text-[11px] font-semibold ${newConfirmPass === newPassword ? "text-emerald-600" : "text-red-500"}`}>
                  {newConfirmPass === newPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
                </p>
              )}
            </div>
          </>
        )}

        {mode === "login" && (
          <div className="text-right">
            <button type="button"
              onClick={() => { setMode("forgot"); clearMessages(); }}
              className="text-xs text-emerald-600 hover:underline font-medium">
              {t("auth.forgotPassword")}
            </button>
          </div>
        )}

        <button type="submit"
          disabled={loading || (mode === "register" && confirmPass.length > 0 && confirmPass !== password)}
          className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white font-bold rounded-xl py-3.5 text-sm transition-colors shadow-sm">
          {loading
            ? t("auth.pleaseWait")
            : mode === "login"    ? t("auth.signIn")
            : mode === "register" ? t("auth.createAccount")
            : "Send Reset Code"}
        </button>
      </form>

      {!isForgot && (
        <>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
            <span className="text-xs text-gray-400 font-medium">{t("auth.or")}</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
          </div>

          <button onClick={handleGoogle} disabled={loading}
            className="w-full flex items-center justify-center gap-3 border border-gray-200 dark:border-slate-600 rounded-xl py-3 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 active:bg-gray-100 dark:active:bg-slate-700 disabled:opacity-60 transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {t("auth.continueGoogle")}
          </button>
          <p className="text-center text-[11px] text-gray-400 dark:text-slate-500 mt-2 leading-snug">
            {t("auth.googleNote")}
          </p>
        </>
      )}

    </BgLayout>
  );
}
