const slideUpCSS = `@keyframes ro-slide-up { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
const popCSS     = `@keyframes ro-pop { 0% { transform: scale(0.4); opacity: 0; } 65% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }`;

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width="44" height="44" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width="44" height="44" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

function fmtAmt(n) {
  return `₦${Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

/**
 * Full-screen result overlay for PIN-gated money actions.
 *
 * Props:
 *  type        "success" | "failure"
 *  title       string — e.g. "Withdrawal Approved"
 *  amount      number  — naira (not kobo), omit to hide
 *  counterparty string — client/member name, omit to hide
 *  note        string  — brief subtitle (success with caveat, e.g. "Verifying…")
 *  reason      string  — failure message shown in red box
 *  primaryLabel string — button label, default "Done"
 *  onPrimary   () => void
 *  onRetry     () => void — if provided, shows "Try Again" button
 */
export default function ResultOverlay({
  type = "success",
  title,
  amount,
  counterparty,
  note,
  reason,
  primaryLabel,
  onPrimary,
  onRetry,
}) {
  const ok    = type === "success";
  const label = primaryLabel ?? "Done";

  return (
    <>
      <style>{slideUpCSS}{popCSS}</style>

      {/* Scrim */}
      <div
        onClick={onPrimary}
        style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.55)" }}
      />

      {/* Bottom sheet */}
      <div
        className="bg-white dark:bg-slate-900"
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 321,
          borderRadius: "24px 24px 0 0",
          paddingBottom: "env(safe-area-inset-bottom, 20px)",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
          animation: "ro-slide-up 0.3s cubic-bezier(0.34,1.1,0.64,1)",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12, paddingBottom: 6 }}>
          <div className="bg-slate-200 dark:bg-slate-700" style={{ width: 40, height: 4, borderRadius: 2 }} />
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 24px 8px", gap: 14 }}>

          {/* Icon */}
          <div
            className={ok ? "bg-green-500" : "bg-red-500"}
            style={{
              width: 88, height: 88, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: ok
                ? "0 0 0 14px rgba(34,197,94,0.13), 0 0 0 28px rgba(34,197,94,0.06)"
                : "0 0 0 14px rgba(239,68,68,0.13), 0 0 0 28px rgba(239,68,68,0.06)",
              animation: "ro-pop 0.42s cubic-bezier(0.34,1.56,0.64,1) 0.12s both",
            }}
          >
            {ok ? <CheckIcon /> : <XIcon />}
          </div>

          {/* Title */}
          <p className="text-slate-900 dark:text-slate-50" style={{ fontSize: 20, fontWeight: 800, textAlign: "center", lineHeight: 1.2 }}>
            {title}
          </p>

          {/* Amount */}
          {amount != null && amount > 0 && (
            <p
              className={ok ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
              style={{ fontSize: 32, fontWeight: 900, textAlign: "center", letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums" }}
            >
              {fmtAmt(amount)}
            </p>
          )}

          {/* Counterparty */}
          {counterparty && (
            <p className="text-slate-500 dark:text-slate-400" style={{ fontSize: 14, textAlign: "center", fontWeight: 500 }}>
              {counterparty}
            </p>
          )}

          {/* Note */}
          {note && (
            <p className="text-slate-400 dark:text-slate-500" style={{ fontSize: 12, textAlign: "center", fontStyle: "italic" }}>
              {note}
            </p>
          )}

          {/* Failure reason */}
          {!ok && reason && (
            <div
              className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              style={{ borderRadius: 14, padding: "12px 16px", width: "100%" }}
            >
              <p className="text-red-700 dark:text-red-300" style={{ fontSize: 13, fontWeight: 600, textAlign: "center" }}>
                {reason}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ padding: "12px 24px 4px", display: "flex", flexDirection: "column", gap: 10 }}>
          {onRetry && !ok && (
            <button
              onClick={onRetry}
              className="w-full py-3.5 rounded-2xl text-white font-black text-sm active:scale-[0.98] transition-transform bg-red-500"
            >
              Try Again
            </button>
          )}
          <button
            onClick={onPrimary}
            className="w-full py-3.5 rounded-2xl font-bold text-sm active:scale-[0.98] transition-transform bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            {label}
          </button>
        </div>
      </div>
    </>
  );
}
