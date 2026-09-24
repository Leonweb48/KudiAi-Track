import { useMemo, useState } from "react";
import { AuthShell } from "./AuthShell";
import WalletMigrationCard from "./WalletMigrationCard";

// Full-screen step shown at login (and when the app is reopened) to anyone whose wallet still has a number on the OLD bank
// account: they get their new number before using the app. `gate` is useWalletMigrationGate()'s result.
//
// It cannot be dismissed on purpose — EXCEPT after an attempt fails ("Continue for now"), so a technical problem (their ID
// not matching, the bank partner being down) can never lock someone out of their business. It comes back next time.
export default function WalletMigrationGate({ gate, testMode = false, onLogout }) {
  const [failed, setFailed] = useState(false);

  // watch the card's attempts so we can offer the way out after one that did not work
  const api = useMemo(() => ({
    ...gate,
    migrateAccount: async (bvn, nin) => {
      try {
        const r = await gate.migrateAccount(bvn, nin);
        if (r?.migrated !== true && r?.account !== "business") setFailed(true);
        return r;
      } catch (e) {
        setFailed(true);
        throw e;
      }
    },
  }), [gate]);

  const retired = gate.accountState === "retired";

  return (
    <AuthShell variant="page">
      <div className="w-full max-w-md mx-auto flex flex-col min-h-[100dvh] px-5 pb-10"
        style={{ paddingTop: "max(40px, env(safe-area-inset-top, 40px))" }}>
        {!gate.holding && (
          <div className="mb-5">
            <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
              retired ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300" : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"}`}>
              Action needed
            </span>
            <h1 className="mt-3 text-[22px] leading-tight font-extrabold text-slate-900 dark:text-slate-50">
              One quick step to keep your wallet working
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
              We've moved to a new banking partner account. Get your new wallet account number to continue — your balance and
              history stay exactly as they are.
            </p>
          </div>
        )}

        <WalletMigrationCard api={api} testMode={testMode} onDone={gate.release} />

        {!gate.holding && failed && (
          <div className="mt-4 text-center">
            <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Having trouble? You can carry on for now — we'll ask again the next time you open the app.
            </p>
            <button type="button" onClick={gate.skip}
              className="mt-2.5 w-full py-3 rounded-2xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold text-[14px] active:scale-[0.99]">
              Continue for now
            </button>
          </div>
        )}

        {!gate.holding && onLogout && (
          <button type="button" onClick={onLogout}
            className="mt-6 mx-auto text-[12px] font-semibold text-slate-400 dark:text-slate-500 underline underline-offset-2">
            Log out
          </button>
        )}
      </div>
    </AuthShell>
  );
}
