import { useState } from "react";
import Icon from "./Icon";
import { cleanBankName } from "./WalletPanel";
import WalletIdFields from "./WalletIdFields";
import { walletIdError } from "../utils/walletId";

const fmtDay = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Lagos" });

// Shown to a holder of an OLD wallet account number once the platform has moved to a new banking account:
//   migrate — the old number still credits the wallet until a deadline; a new number is available
//   retired — the deadline has passed; the old number no longer credits the wallet
// `api` is the useWallet() object. Renders nothing for anyone else, so screens can mount it unconditionally — it also
// keeps showing the "here is your new number" confirmation after the wallet flips to `active`.
export default function WalletMigrationCard({ api, testMode = false, className = "" }) {
  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);      // { number, bank } once the move has gone through

  const state = api?.accountState;
  const retired = state === "retired";

  const submit = async () => {
    setErr("");
    const idErr = walletIdError(bvn, nin, testMode);
    if (idErr) { setErr(idErr); return; }
    setBusy(true);
    try {
      const r = await api.migrateAccount(bvn, nin);
      setDone({ number: r?.account_number || "", bank: cleanBankName(r?.account_bank) });
      setBvn(""); setNin("");
    } catch (e) {
      setErr(e?.message || "Could not get your new number. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={`rounded-3xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-5 ${className}`}>
        <div className="flex items-center gap-2">
          <Icon name="check" size={16} className="text-emerald-600 dark:text-emerald-400" />
          <p className="text-[14px] font-extrabold text-emerald-800 dark:text-emerald-200">Your new account number is ready</p>
        </div>
        {done.number && (
          <p className="mt-2 text-[26px] leading-none font-extrabold tracking-[0.12em] text-slate-900 dark:text-slate-50 tabular-nums">{done.number}</p>
        )}
        {done.bank && <p className="mt-1.5 text-[13px] font-semibold text-slate-600 dark:text-slate-300">{done.bank}</p>}
        <p className="mt-3 text-[12px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
          Use this number from now on.
          {api.graceUntilMs && !retired ? ` Your old number keeps working until ${fmtDay(api.graceUntilMs)}.` : ""}
          {" "}Your balance and history haven't changed.
        </p>
        <button onClick={() => setDone(null)}
          className="mt-3 w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[13px]">
          Done
        </button>
      </div>
    );
  }

  if (state !== "migrate" && state !== "retired") return null;

  const tone = retired
    ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
    : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800";
  const head = retired ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-200";
  const body = retired ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300";
  const btn  = retired ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700";
  const input = "w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-50 text-[16px] font-semibold tracking-wider placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400";

  return (
    <div className={`rounded-3xl border p-5 ${tone} ${className}`}>
      <div className="flex items-center gap-2">
        <Icon name="wallet" size={16} className={head} />
        <p className={`text-[14px] font-extrabold ${head}`}>
          {retired ? "Your old account number has stopped working" : "Your wallet has a new account number"}
        </p>
      </div>
      <p className={`mt-1.5 text-[12px] leading-relaxed ${body}`}>
        {retired
          ? "Transfers to your old number no longer reach your wallet. Get your new number to receive money again — your balance and history are safe."
          : api.graceUntilMs
            ? `Your current number keeps working until ${fmtDay(api.graceUntilMs)}${api.graceDaysLeft ? ` (${api.graceDaysLeft} day${api.graceDaysLeft === 1 ? "" : "s"} left)` : ""}. Get your new number now — it takes a minute.`
            : "Your current number keeps working for a short while. Get your new number now — it takes a minute."}
      </p>

      {!testMode && (
        <div className="mt-3">
          <WalletIdFields bvn={bvn} nin={nin} onBvn={setBvn} onNin={setNin} inputClass={input} />
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Your BVN or NIN opens your new account with our banking partner and isn't stored by KudiAI. The name and date of birth on it
            must match your profile. Enter it only here in the app.
          </p>
        </div>
      )}
      {err && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{err}</p>}
      <button onClick={submit} disabled={busy || api?.busy}
        className={`mt-3 w-full py-3 rounded-2xl text-white font-bold text-[14px] disabled:opacity-50 transition-colors ${btn}`}>
        {busy ? "Getting your new number…" : "Get my new number"}
      </button>
    </div>
  );
}
