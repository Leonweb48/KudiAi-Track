import { useState, useRef } from "react";
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

/* ── 6-digit OTP input ─────────────────────────────────────────────── */
function OtpInput({ value, onChange }) {
  const inputs = useRef([]);
  const digits = value.split("").concat(Array(6).fill("")).slice(0, 6);

  const handleKey = (i, e) => {
    if (e.key === "Backspace") {
      const next = value.slice(0, i) + value.slice(i + 1);
      onChange(next);
      if (i > 0) inputs.current[i - 1]?.focus();
      return;
    }
    if (!/^\d$/.test(e.key)) return;
    const next = value.slice(0, i) + e.key + value.slice(i + 1);
    onChange(next.slice(0, 6));
    if (i < 5) inputs.current[i + 1]?.focus();
  };

  return (
    <div className="flex justify-center gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (inputs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          onChange={() => {}}
          onKeyDown={(e) => handleKey(i, e)}
          onFocus={(e) => e.target.select()}
          className="w-11 h-12 text-center text-lg font-bold border-2 rounded-xl
            border-gray-300 focus:border-green-500 focus:outline-none
            bg-white text-gray-800 transition-colors"
        />
      ))}
    </div>
  );
}

/* ── OTP verification screen ───────────────────────────────────────── */
function OtpScreen({ email, onBack, onVerified }) {
  const [otp, setOtp]         = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [resent, setResent]   = useState(false);

  const handleVerify = async () => {
    if (otp.length < 6) return;
    setError("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "signup",
      });
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
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) setError(error.message);
    else setResent(true);
  };

  return (
    <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-800">Check your email</h2>
        <p className="text-sm text-gray-500 mt-1">
          We sent a 6-digit code to
        </p>
        <p className="text-sm font-semibold text-gray-700 mt-0.5">{email}</p>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
          {error}
        </div>
      )}
      {resent && (
        <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center">
          Code resent — check your inbox.
        </div>
      )}

      <div className="mb-6">
        <OtpInput value={otp} onChange={setOtp} />
      </div>

      <button
        onClick={handleVerify}
        disabled={loading || otp.length < 6}
        className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
      >
        {loading ? "Verifying…" : "Verify Code"}
      </button>

      <div className="flex items-center justify-between mt-5 text-xs text-gray-500">
        <button onClick={onBack} className="hover:text-gray-700 underline">
          ← Back
        </button>
        <button onClick={handleResend} className="text-green-600 font-medium hover:underline">
          Resend code
        </button>
      </div>
    </div>
  );
}

/* ── Main Auth screen ──────────────────────────────────────────────── */
export default function Auth() {
  const [mode, setMode]       = useState("login"); // "login" | "register" | "forgot" | "otp"
  const [email, setEmail]     = useState("");
  const [password, setPass]   = useState("");
  const [name, setName]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [info, setInfo]       = useState("");

  if (!supabaseConfigured) return <SetupNotice />;

  const clearMessages = () => { setError(""); setInfo(""); };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    clearMessages();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "register") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
        if (error) throw error;
        setMode("otp");
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
          options: {
            redirectTo: OAUTH_REDIRECT,
            skipBrowserRedirect: true,
            queryParams: { prompt: "select_account" },
          },
        });
        if (error) throw error;
        await Browser.open({ url: data.url, windowName: "_self" });
      } else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: OAUTH_REDIRECT,
            queryParams: { prompt: "select_account" },
          },
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
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center px-4">
        <OtpScreen
          email={email}
          onBack={() => { setMode("register"); clearMessages(); }}
          onVerified={() => { /* useAuth picks up the session automatically */ }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">

        <div className="text-center mb-8">
          <AppLogo className="h-20 w-auto mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {mode === "login"    && "Welcome back"}
            {mode === "register" && "Create your account"}
            {mode === "forgot"   && "Reset your password"}
          </p>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {info}
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
              <input
                type="text" required value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Adaeze Okonkwo"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {mode !== "forgot" && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password" required value={password}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          )}

          {mode === "login" && (
            <div className="text-right">
              <button type="button"
                onClick={() => { setMode("forgot"); clearMessages(); }}
                className="text-xs text-green-600 hover:underline">
                Forgot password?
              </button>
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors">
            {loading
              ? "Please wait…"
              : mode === "login"    ? "Sign In"
              : mode === "register" ? "Create Account"
              : "Send Reset Link"}
          </button>
        </form>

        {mode !== "forgot" && (
          <>
            <div className="flex items-center gap-2 my-5">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <button onClick={handleGoogle} disabled={loading}
              className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors">
              <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          </>
        )}

        <p className="text-center text-xs text-gray-500 mt-6">
          {mode === "login" ? (
            <>Don't have an account?{" "}
              <button onClick={() => { setMode("register"); clearMessages(); }} className="text-green-600 font-medium hover:underline">
                Sign up
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button onClick={() => { setMode("login"); clearMessages(); }} className="text-green-600 font-medium hover:underline">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
