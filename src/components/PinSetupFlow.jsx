import { useState, useCallback } from "react";
import PinDots from "./PinDots";
import { useT, tNow } from "../contexts/LanguageContext";

const BackspaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
    <line x1="18" y1="9" x2="13" y2="14" />
    <line x1="13" y1="9" x2="18" y2="14" />
  </svg>
);

function isWeakPin(pin) {
  const digits = pin.split("").map(Number);
  if (digits.every(d => d === digits[0])) return true; // all same
  const asc  = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const desc = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (asc || desc) return true;
  const weak6 = new Set(["123456","654321","112233","123123","121212","101010","102030"]);
  const weak4 = new Set(["1212","1122","1010","2580","0852"]);
  return pin.length === 6 ? weak6.has(pin) : weak4.has(pin);
}

function txnTooSimilarToApp(txnPin, appPin) {
  return appPin.startsWith(txnPin) || appPin.endsWith(txnPin);
}

const STEP_META = {
  app_enter:   { titleKey: "settings.pin.title.createApp",  descKey: "settings.pin.setup.appEnterDesc",   len: 6, phase: 1 },
  app_confirm: { titleKey: "settings.pin.title.confirmApp", descKey: "settings.pin.setup.appConfirmDesc", len: 6, phase: 1 },
  txn_enter:   { titleKey: "settings.pin.title.createTxn",  descKey: "settings.pin.setup.txnEnterDesc",   len: 4, phase: 2 },
  txn_confirm: { titleKey: "settings.pin.title.confirmTxn", descKey: "settings.pin.setup.txnConfirmDesc", len: 4, phase: 2 },
};

export default function PinSetupFlow({ pinLock }) {
  const t = useT();
  const initialStep = !pinLock.appPinSet ? "app_enter" : "txn_enter";

  const [step,       setStep]       = useState(initialStep);
  const [appPin,     setAppPin]     = useState("");
  const [txnPin,     setTxnPin]     = useState("");
  const [pin,        setPin]        = useState("");
  const [error,      setError]      = useState("");
  const [saving,     setSaving]     = useState(false);
  const [showWhy,    setShowWhy]    = useState(false);

  const meta   = STEP_META[step];
  const maxLen = meta.len;
  const PAD    = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  const handleDigit = useCallback(async (d) => {
    if (pin.length >= maxLen || saving) return;
    const next = pin + d;
    setPin(next);
    setError("");

    if (next.length < maxLen) return;

    // Auto-process after short delay
    setTimeout(async () => {
      if (step === "app_enter") {
        if (isWeakPin(next)) {
          setPin("");
          setError(tNow("settings.pin.setup.weak"));
          return;
        }
        setAppPin(next);
        setPin("");
        setStep("app_confirm");
        return;
      }

      if (step === "app_confirm") {
        if (next !== appPin) {
          setPin("");
          setError(tNow("settings.pin.setup.mismatch"));
          setStep("app_enter");
          setAppPin("");
          return;
        }
        // Save app PIN
        setSaving(true);
        try {
          await pinLock.setupAppPin(appPin);
        } catch (err) {
          setPin("");
          setError(err?.message || tNow("settings.pin.setup.saveFailed"));
          setStep("app_enter");
          setAppPin("");
          setSaving(false);
          return;
        }
        setSaving(false);
        setPin("");
        setStep("txn_enter");
        return;
      }

      if (step === "txn_enter") {
        if (isWeakPin(next)) {
          setPin("");
          setError(tNow("settings.pin.setup.weak"));
          return;
        }
        if (txnTooSimilarToApp(next, appPin)) {
          setPin("");
          setError(tNow("settings.pin.setup.tooSimilar"));
          return;
        }
        setTxnPin(next);
        setPin("");
        setStep("txn_confirm");
        return;
      }

      if (step === "txn_confirm") {
        if (next !== txnPin) {
          setPin("");
          setError(tNow("settings.pin.setup.mismatch"));
          setStep("txn_enter");
          setTxnPin("");
          return;
        }
        // Save txn PIN — setupTxnPin already calls refetch() internally
        setSaving(true);
        try {
          await pinLock.setupTxnPin(txnPin);
        } catch (err) {
          setPin("");
          setError(err?.message || tNow("settings.pin.setup.saveFailed"));
          setStep("txn_enter");
          setTxnPin("");
          setSaving(false);
          return;
        }
        setSaving(false);
        // Done — refetch will cause appPinSet+txnPinSet = true → App unmounts this flow
      }
    }, 150);
  }, [pin, maxLen, saving, step, appPin, txnPin, pinLock]);

  const handleDelete = useCallback(() => {
    setPin(p => p.slice(0, -1));
    setError("");
  }, []);

  return (
    <div className="fixed inset-0 z-[200] bg-white dark:bg-slate-900 flex flex-col items-center justify-between select-none"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>

      {/* Progress */}
      <div className="flex flex-col items-center gap-3 pt-14 w-full px-6">
        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 mb-2">
          {[1, 2].map(n => (
            <div key={n} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                meta.phase === n
                  ? "bg-brand-600 text-white"
                  : meta.phase > n
                    ? "bg-brand-200 dark:bg-brand-800 text-brand-700 dark:text-brand-300"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-400"
              }`}>{n}</div>
              {n < 2 && (
                <div className={`w-12 h-0.5 rounded-full transition-colors ${meta.phase > 1 ? "bg-brand-400" : "bg-slate-200 dark:bg-slate-700"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-xl font-extrabold text-slate-900 dark:text-white leading-tight">{t(meta.titleKey)}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t(meta.descKey)}</p>
        </div>
      </div>

      {/* Middle: dots + pad */}
      <div className="flex flex-col items-center gap-8 w-full max-w-[280px] mx-auto">
        {/* PIN dots */}
        <PinDots count={maxLen} filled={pin.length} />

        {/* Error */}
        <div className="h-5 -mt-4">
          {error && <p className="text-xs font-semibold text-red-500 text-center">{error}</p>}
          {saving && <p className="text-xs text-slate-400 text-center">{t("common.saving")}</p>}
        </div>

        {/* Spinner overlay when saving */}
        {saving && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-slate-900/60 z-10 rounded-3xl">
            <div className="w-8 h-8 border-[3px] border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {PAD.map(n => (
            <button key={n} onClick={() => handleDigit(String(n))} disabled={saving}
              className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-xl font-bold transition-all active:scale-95 focus-visible:outline-none disabled:opacity-50">
              {n}
            </button>
          ))}

          <div className="h-16" />

          <button onClick={() => handleDigit("0")} disabled={saving}
            className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-xl font-bold transition-all active:scale-95 focus-visible:outline-none disabled:opacity-50">
            0
          </button>

          <button onClick={handleDelete} disabled={saving}
            className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-all active:scale-95 focus-visible:outline-none disabled:opacity-50">
            <BackspaceIcon />
          </button>
        </div>
      </div>

      {/* Bottom: why link */}
      <div className="pb-8 flex flex-col items-center gap-3 px-6">
        <button onClick={() => setShowWhy(v => !v)}
          className="text-[12px] text-slate-400 dark:text-slate-500 underline underline-offset-2">
          {t("settings.pin.setup.why")}
        </button>
        {showWhy && (
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-[12px] text-slate-500 dark:text-slate-400 text-center leading-relaxed max-w-xs">
            <strong className="text-slate-700 dark:text-slate-200">{t("settings.pin.setup.whyAppName")}</strong> {t("settings.pin.setup.whyAppText")}
            <br /><br />
            <strong className="text-slate-700 dark:text-slate-200">{t("settings.pin.setup.whyTxnName")}</strong> {t("settings.pin.setup.whyTxnText")}
          </div>
        )}
      </div>
    </div>
  );
}
