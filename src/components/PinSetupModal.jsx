import { useState } from "react";
import PinDots from "./PinDots";

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
  const w4 = new Set(["1212", "1122", "1010", "2580", "0852"]);
  return w4.has(pin);
}

export default function PinSetupModal({ lock }) {
  const [step,     setStep]     = useState("enter");   // "enter" | "confirm"
  const [firstPin, setFirstPin] = useState("");
  const [pin,      setPin]      = useState("");
  const [error,    setError]    = useState("");

  const PAD = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  const handleDigit = (d) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");

    if (next.length === 4) {
      if (step === "enter") {
        if (isWeakPin(next)) {
          setPin("");
          setError("PIN is too easy to guess. Try a different one.");
          return;
        }
        setFirstPin(next);
        setPin("");
        setStep("confirm");
      } else {
        if (next === firstPin) {
          lock.setupPIN(next);
        } else {
          setPin("");
          setError("PINs don't match. Try again.");
          setStep("enter");
          setFirstPin("");
        }
      }
    }
  };

  const handleDelete = () => {
    setPin(p => p.slice(0, -1));
    setError("");
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-white dark:bg-slate-900 flex flex-col items-center justify-between select-none"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Top */}
      <div className="flex flex-col items-center gap-3 pt-14">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg">
          <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-white"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>

        <div className="text-center px-6">
          <p className="text-xl font-extrabold text-slate-900 dark:text-white leading-tight">Secure Your Account</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {step === "enter"
              ? "Create a 4-digit PIN to protect your data"
              : "Re-enter your PIN to confirm"}
          </p>

          {/* Step indicator */}
          <div className="mt-3 flex items-center justify-center gap-2">
            <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-colors ${step === "enter" ? "bg-brand-600 text-white" : "bg-brand-600/30 text-brand-400"}`}>
              1
            </div>
            <div className="w-10 h-0.5 bg-slate-200 dark:bg-slate-700 rounded-full" />
            <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-colors ${step === "confirm" ? "bg-brand-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}>
              2
            </div>
          </div>
        </div>
      </div>

      {/* Middle: dots + pad */}
      <div className="flex flex-col items-center gap-8 w-full max-w-[280px] mx-auto">
        <PinDots filled={pin.length} />

        {/* Error */}
        <div className="h-4 -mt-4">
          {error && <p className="text-xs font-semibold text-red-500 dark:text-red-400 text-center">{error}</p>}
        </div>

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {PAD.map(n => (
            <button key={n} onClick={() => handleDigit(String(n))}
              className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-white text-xl font-bold transition-all focus-visible:outline-none">
              {n}
            </button>
          ))}

          {/* empty slot */}
          <div className="h-16" />

          <button onClick={() => handleDigit("0")}
            className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-900 dark:text-white text-xl font-bold transition-all focus-visible:outline-none">
            0
          </button>

          <button onClick={handleDelete}
            className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-all focus-visible:outline-none">
            <BackspaceIcon />
          </button>
        </div>
      </div>

      {/* Bottom */}
      <div className="pb-8 text-center px-6">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
          Your PIN is stored securely on this device and is never sent to our servers.
          You'll need it each time you open the app.
        </p>
      </div>
    </div>
  );
}
