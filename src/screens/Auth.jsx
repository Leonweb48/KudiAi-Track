import { useState } from "react";
import { supabase, supabaseConfigured } from "../utils/supabase";
import AppLogo from "../components/AppLogo";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

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

/* ── Full-screen photo background wrapper ─────────────────────────── */
function BgLayout({ children, center = false }) {
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
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
        {/* Actual KudiAI Track logo */}
        <div className="bg-white/90 rounded-xl p-1.5 shadow-lg flex-shrink-0">
          <AppLogo className="h-9 w-auto" />
        </div>
        <div>
          <p className="text-white font-extrabold text-lg leading-tight tracking-wide drop-shadow-lg">KudiAI Track</p>
          <p className="text-white/80 text-[11px] leading-tight font-medium">Business · Savings · Bills</p>
        </div>
      </div>

      {center ? (
        /* OTP screen — card at bottom */
        <div className="relative z-10 flex-1 min-h-0 flex items-end justify-center px-4 pb-6">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 overflow-y-auto" style={{ maxHeight: "80vh" }}>
            {children}
          </div>
        </div>
      ) : (
        <>
          {/* Hero tagline — takes available space, pinned to bottom of its area */}
          <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-end px-6 pb-4">
            <p className="text-white font-extrabold text-2xl leading-snug mb-1"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>
              Track your business.<br />Grow your savings.
            </p>
            <p className="text-white/90 text-sm font-medium" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>
              Designed for Nigerian entrepreneurs.
            </p>
          </div>

          {/* Bottom sheet — fixed height cap, scrolls internally if form is long */}
          <div className="relative z-10 flex-shrink-0 bg-white rounded-t-3xl shadow-2xl w-full max-w-md mx-auto overflow-y-auto"
            style={{ maxHeight: "62vh" }}>
            <div className="px-6 pt-5 pb-8">
              {children}
            </div>
          </div>
        </>
      )}
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
        border-gray-200 focus:border-emerald-500 focus:outline-none
        bg-gray-50 text-gray-900 transition-colors"
    />
  );
}

/* ── OTP verification screen ───────────────────────────────────────── */
function OtpScreen({ email, onBack, onVerified, otpType = "signup" }) {
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
      onVerified();
    } catch (err) {
      setError(err.message);
    } finally {
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
    <BgLayout center>
      <div className="text-center mb-5">
        <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-800">Check your email</h2>
        <p className="text-sm text-gray-500 mt-0.5">We sent a 6-digit code to</p>
        <p className="text-sm font-semibold text-gray-700">{email}</p>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-center">
          {error}
        </div>
      )}
      {resent && (
        <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-center">
          Code resent — check your inbox.
        </div>
      )}

      <div className="mb-5">
        <OtpInput value={otp} onChange={setOtp} />
      </div>

      <button
        onClick={handleVerify}
        disabled={loading || otp.length < 6}
        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl py-3 text-sm transition-colors"
      >
        {loading ? "Verifying…" : "Verify Code"}
      </button>

      <div className="flex items-center justify-between mt-4 text-xs text-gray-500">
        <button onClick={onBack} className="hover:text-gray-700 underline">← Back</button>
        <button onClick={handleResend} className="text-emerald-600 font-medium hover:underline">Resend code</button>
      </div>
    </BgLayout>
  );
}

/* ── Main Auth screen ──────────────────────────────────────────────── */
export default function Auth() {
  const [mode,         setMode]         = useState("login"); // "login" | "register" | "forgot" | "otp"
  const [email,        setEmail]        = useState("");
  const [password,     setPass]         = useState("");
  const [name,         setName]         = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(() => {
    const msg = sessionStorage.getItem("auth_block_reason");
    if (msg) sessionStorage.removeItem("auth_block_reason");
    return msg || "";
  });
  const [info,         setInfo]         = useState("");
  const [staffConfirm, setStaffConfirm] = useState(false);

  if (!supabaseConfigured) return <SetupNotice />;

  const clearMessages = () => { setError(""); setInfo(""); };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          const msg = signInErr.message.toLowerCase();
          if (msg.includes("not confirmed") || msg.includes("email not confirmed")) {
            const { error: otpErr } = await supabase.auth.signInWithOtp({
              email,
              options: { shouldCreateUser: false },
            });
            if (otpErr) throw otpErr;
            setStaffConfirm(true);
            setMode("otp");
            setLoading(false);
            return;
          }
          throw signInErr;
        }
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
        // Use custom registration API — avoids Supabase's broken confirmation email
        const regRes = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim().toLowerCase(), password, full_name: name }),
        });
        const regData = await regRes.json();
        if (!regRes.ok) throw new Error(regData.error || "Registration failed");

        // User is auto-confirmed — sign them in immediately
        const { error: signInErr2 } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr2) {
          // If sign-in fails (unlikely), show success and let them try logging in
          setInfo("Account created! Please sign in with your credentials.");
          setMode("login");
        }
        // useAuth picks up the new session automatically — no OTP screen needed
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
      setLoading(false);
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
      } else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: OAUTH_REDIRECT, queryParams: { prompt: "select_account" } },
        });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message);
    } finally {
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

  const isForgot = mode === "forgot";

  return (
    <BgLayout>
      {/* Tab switcher — Sign In / Create Account */}
      {!isForgot && (
        <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
          <button
            onClick={() => { setMode("login"); clearMessages(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === "login"
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setMode("register"); clearMessages(); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === "register"
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Create Account
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
            Back to Sign In
          </button>
          <h2 className="text-lg font-bold text-gray-800 mt-2">Reset password</h2>
          <p className="text-xs text-gray-500">We'll send a reset link to your email.</p>
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
          {info}
        </div>
      )}

      <form onSubmit={handleEmailAuth} className="space-y-3.5">
        {mode === "register" && (
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Full Name</label>
            <input
              type="text" required value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Adaeze Okonkwo"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Email</label>
          <input
            type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
          />
        </div>

        {!isForgot && (
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Password</label>
            <input
              type="password" required value={password}
              onChange={(e) => setPass(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            />
          </div>
        )}

        {mode === "login" && (
          <div className="text-right">
            <button type="button"
              onClick={() => { setMode("forgot"); clearMessages(); }}
              className="text-xs text-emerald-600 hover:underline font-medium">
              Forgot password?
            </button>
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white font-bold rounded-xl py-3.5 text-sm transition-colors shadow-sm">
          {loading
            ? "Please wait…"
            : mode === "login"    ? "Sign In"
            : mode === "register" ? "Create Account"
            : "Send Reset Link"}
        </button>
      </form>

      {!isForgot && (
        <>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <button onClick={handleGoogle} disabled={loading}
            className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-60 transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
          <p className="text-center text-[11px] text-gray-400 mt-2 leading-snug">
            Google login is for business accounts only.<br />Staff and savings clients must use email &amp; password.
          </p>
        </>
      )}
    </BgLayout>
  );
}
