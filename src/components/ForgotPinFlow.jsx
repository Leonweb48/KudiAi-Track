import { useState, useCallback, useEffect } from "react";
import { supabase } from "../utils/supabase";

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
    <line x1="18" y1="9" x2="13" y2="14" />
    <line x1="13" y1="9" x2="18" y2="14" />
  </svg>
);

function isWeakPin(pin) {
  const d = pin.split("").map(Number);
  if (d.every(x => x === d[0])) return true;
  if (d.every((x, i) => i === 0 || x === d[i - 1] + 1)) return true;
  if (d.every((x, i) => i === 0 || x === d[i - 1] - 1)) return true;
  const w6 = new Set(["123456","654321","112233","123123","121212","101010","102030"]);
  const w4 = new Set(["1212","1122","1010","2580","0852"]);
  return pin.length === 6 ? w6.has(pin) : w4.has(pin);
}

const STEP_META = {
  verify:          { title: "Enter Verification Code", desc: "Check your email for the 6-digit code", len: 6 },
  new_app:         { title: "New App Lock PIN",        desc: "Choose a new 6-digit app lock PIN",     len: 6 },
  new_app_confirm: { title: "Confirm App Lock PIN",    desc: "Re-enter your new 6-digit PIN",         len: 6 },
  new_txn:         { title: "New Transaction PIN",     desc: "Choose a new 4-digit payment PIN",      len: 4 },
  new_txn_confirm: { title: "Confirm Transaction PIN", desc: "Re-enter your new 4-digit PIN",         len: 4 },
};

const PAD = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function ForgotPinFlow({ pinLock, onCancel }) {
  const [email,     setEmail]     = useState("");
  const [step,      setStep]      = useState("send");
  const [pin,       setPin]       = useState("");
  const [newAppPin, setNewAppPin] = useState("");
  const [newTxnPin, setNewTxnPin] = useState("");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);

  useEffect(() => {
    supabase?.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user?.email || "");
    });
  }, []);

  const meta   = step !== "send" ? STEP_META[step] : null;
  const maxLen = meta?.len ?? 6;

  // ── Send OTP ───────────────────────────────────────────────────────────────
  const sendOtp = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      const { error: sendErr } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (sendErr) throw sendErr;
      setStep("verify");
    } catch (err) {
      setError(err.message || "Failed to send code. Try again.");
    } finally {
      setLoading(false);
    }
  }, [email]);

  // ── Keypad digit handler ───────────────────────────────────────────────────
  const handleDigit = useCallback(async (d) => {
    if (step === "send" || loading) return;
    if (pin.length >= maxLen) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length < maxLen) return;

    setTimeout(async () => {
      // Verify OTP
      if (step === "verify") {
        setLoading(true);
        try {
          const { error: vErr } = await supabase.auth.verifyOtp({
            email,
            token: next,
            type: "email",
          });
          if (vErr) throw vErr;
          setPin("");
          setStep("new_app");
        } catch (err) {
          setPin("");
          setError(err.message || "Invalid or expired code.");
        } finally {
          setLoading(false);
        }
        return;
      }

      if (step === "new_app") {
        if (isWeakPin(next)) { setPin(""); setError("PIN is too easy to guess."); return; }
        setNewAppPin(next); setPin(""); setStep("new_app_confirm");
        return;
      }

      if (step === "new_app_confirm") {
        if (next !== newAppPin) {
          setPin(""); setError("PINs don't match."); setStep("new_app"); setNewAppPin(""); return;
        }
        setLoading(true);
        try {
          await pinLock.resetAppPin(newAppPin);
        } catch (err) {
          setPin(""); setError(err.message || "Failed to save. Try again.");
          setStep("new_app"); setNewAppPin(""); setLoading(false); return;
        }
        setLoading(false); setPin(""); setStep("new_txn");
        return;
      }

      if (step === "new_txn") {
        if (isWeakPin(next)) { setPin(""); setError("PIN is too easy to guess."); return; }
        setNewTxnPin(next); setPin(""); setStep("new_txn_confirm");
        return;
      }

      if (step === "new_txn_confirm") {
        if (next !== newTxnPin) {
          setPin(""); setError("PINs don't match."); setStep("new_txn"); setNewTxnPin(""); return;
        }
        setLoading(true);
        try {
          await pinLock.resetTxnPin(newTxnPin);
          // Mark this device as txn-verified (OTP already proved identity)
          // so the device-verify gate doesn't show after unlocking
          pinLock.completeDeviceVerification();
          await pinLock.refetch();
          pinLock.unlock();
        } catch (err) {
          setPin(""); setError(err.message || "Failed to save. Try again.");
          setStep("new_txn"); setNewTxnPin(""); setLoading(false);
        }
      }
    }, 150);
  }, [pin, maxLen, loading, step, email, newAppPin, newTxnPin, pinLock]);

  const handleDelete = useCallback(() => {
    setPin(p => p.slice(0, -1));
    setError("");
  }, []);

  // ── Send screen ────────────────────────────────────────────────────────────
  if (step === "send") {
    return (
      <div className="fixed inset-0 z-[210] bg-[#0f1c45] flex flex-col items-center justify-center px-6 gap-6 select-none"
        style={{ paddingTop: "env(safe-area-inset-top,0px)", paddingBottom: "env(safe-area-inset-bottom,0px)" }}>

        {/* Icon */}
        <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-[#3DA829]"
            stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 7l-10 7L2 7" />
          </svg>
        </div>

        <div className="text-center">
          <p className="text-xl font-extrabold text-white">Forgot your PIN?</p>
          <p className="text-sm text-white/60 mt-2 leading-relaxed max-w-xs">
            We'll send a one-time code to
            <br />
            <span className="text-white/90 font-semibold">{email || "your registered email"}</span>
          </p>
        </div>

        {error && <p className="text-xs font-semibold text-red-400 text-center">{error}</p>}

        <button
          onClick={sendOtp}
          disabled={loading || !email}
          className="w-full max-w-[280px] py-4 rounded-2xl bg-[#3DA829] hover:bg-[#34961f] active:scale-95 text-white font-bold text-base transition-all disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send Verification Code"}
        </button>

        <button onClick={onCancel}
          className="text-sm text-white/40 underline underline-offset-2">
          Back to lock screen
        </button>
      </div>
    );
  }

  // ── OTP / PIN keypad screens ───────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[210] bg-[#0f1c45] flex flex-col items-center justify-between select-none"
      style={{ paddingTop: "env(safe-area-inset-top,0px)", paddingBottom: "env(safe-area-inset-bottom,0px)" }}>

      {/* Header */}
      <div className="flex flex-col items-center gap-3 pt-14 w-full px-6">
        <p className="text-xl font-extrabold text-white text-center">{meta.title}</p>
        <p className="text-sm text-white/60 text-center">{meta.desc}</p>
      </div>

      {/* Middle */}
      <div className="flex flex-col items-center gap-8 w-full max-w-[280px] mx-auto">

        {/* Dots */}
        <div className="flex gap-4 justify-center">
          {Array.from({ length: maxLen }).map((_, i) => (
            <div key={i} style={{
              width: maxLen === 6 ? 12 : 16,
              height: maxLen === 6 ? 12 : 16,
              borderRadius: "50%",
              border: "2px solid",
              borderColor: pin.length > i ? "#3DA829" : "rgba(255,255,255,0.2)",
              background: pin.length > i ? "#3DA829" : "transparent",
              transition: "all 0.15s",
              transform: pin.length > i ? "scale(1.1)" : "scale(1)",
            }} />
          ))}
        </div>

        <div style={{ height: 18, marginTop: -20 }}>
          {error && <p className="text-xs font-semibold text-red-400 text-center">{error}</p>}
          {loading && <p className="text-xs text-white/40 text-center">Verifying…</p>}
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0f1c45]/70 z-10">
            <div className="w-8 h-8 border-[3px] border-[#3DA829] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Keypad */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, width: "100%" }}>
          {PAD.map(n => (
            <button key={n} onClick={() => handleDigit(String(n))} disabled={loading}
              style={{
                height: 64, borderRadius: 18,
                background: "rgba(255,255,255,0.08)", border: "none",
                color: "white", fontSize: 20, fontWeight: 700,
                cursor: "pointer", opacity: loading ? 0.5 : 1,
              }}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
              onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
              onTouchStart={e => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
              onTouchEnd={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            >
              {n}
            </button>
          ))}

          <div style={{ height: 64 }} />

          <button onClick={() => handleDigit("0")} disabled={loading}
            style={{
              height: 64, borderRadius: 18,
              background: "rgba(255,255,255,0.08)", border: "none",
              color: "white", fontSize: 20, fontWeight: 700,
              cursor: "pointer", opacity: loading ? 0.5 : 1,
            }}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
          >
            0
          </button>

          <button onClick={handleDelete} disabled={loading}
            style={{
              height: 64, borderRadius: 18,
              background: "rgba(255,255,255,0.08)", border: "none",
              color: "white", cursor: "pointer", opacity: loading ? 0.5 : 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
          >
            <BackspaceIcon />
          </button>
        </div>
      </div>

      {/* Bottom */}
      <div className="pb-8 flex flex-col items-center gap-3">
        {step === "verify" && (
          <button
            onClick={async () => { setPin(""); await sendOtp(); }}
            disabled={loading}
            className="text-xs text-white/40 underline underline-offset-2"
          >
            Didn't receive it? Resend code
          </button>
        )}
        <button onClick={onCancel} className="text-xs text-white/30 underline underline-offset-2">
          Cancel
        </button>
      </div>
    </div>
  );
}
