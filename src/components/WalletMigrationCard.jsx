import { useState } from "react";
import Icon from "./Icon";
import { cleanBankName } from "./WalletPanel";
import WalletIdFields, { walletIdErrorText } from "./WalletIdFields";
import { walletIdError } from "../utils/walletId";
import { useT } from "../contexts/LanguageContext";

const fmtDay = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Lagos" });

// Shown to a holder of an OLD wallet account number once the platform has moved to a new banking account:
//   migrate — the old number still credits the wallet until a deadline; a new number is available
//   retired — the deadline has passed; the old number no longer credits the wallet
// `api` is the useWallet() object. Renders nothing for anyone else, so screens can mount it unconditionally — it also
// keeps showing the "here is your new number" confirmation after the wallet flips to `active`.
export default function WalletMigrationCard({ api, testMode = false, className = "", onDone }) {
  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [selfie, setSelfie] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);      // { number, bank } once the move has gone through
  const t = useT();

  const state = api?.accountState;
  const retired = state === "retired";

  const submit = async () => {
    setErr("");
    const idErr = walletIdError(bvn, nin, testMode);
    if (idErr) { setErr(walletIdErrorText(idErr, t)); return; }
    setBusy(true);
    try {
      const r = await api.migrateAccount(bvn, nin, selfie);
      // Only a wallet the server actually MOVED has a new number. If it answered with the existing one (the platform
      // switched back to the old account since this screen loaded), say so instead of calling that number "new".
      if (r?.migrated !== true && r?.account !== "business") {
        setErr(t("wallet.migrate.notYet"));
        api.refresh?.();
        return;
      }
      setDone({ number: r?.account_number || "", bank: cleanBankName(r?.account_bank) });
      setBvn(""); setNin("");
    } catch (e) {
      setErr(e?.message || t("wallet.migrate.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={`rounded-3xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-5 ${className}`}>
        <div className="flex items-center gap-2">
          <Icon name="check" size={16} className="text-emerald-600 dark:text-emerald-400" />
          <p className="text-[14px] font-extrabold text-emerald-800 dark:text-emerald-200">{t("wallet.migrate.ready")}</p>
        </div>
        {done.number && (
          <p className="mt-2 text-[26px] leading-none font-extrabold tracking-[0.12em] text-slate-900 dark:text-slate-50 tabular-nums">{done.number}</p>
        )}
        {done.bank && <p className="mt-1.5 text-[13px] font-semibold text-slate-600 dark:text-slate-300">{done.bank}</p>}
        <p className="mt-3 text-[12px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
          {t("wallet.migrate.useFromNow")}
          {api.graceUntilMs && !retired ? t("wallet.migrate.oldWorksUntil", { date: fmtDay(api.graceUntilMs) }) : ""}
          {" "}{t("wallet.migrate.unchanged")}
        </p>
        <button onClick={() => { setDone(null); onDone?.(); }}
          className="mt-3 w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[13px]">
          {t("common.done")}
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
          {retired ? t("wallet.migrate.stoppedTitle") : t("wallet.migrate.newTitle")}
        </p>
      </div>
      <p className={`mt-1.5 text-[12px] leading-relaxed ${body}`}>
        {retired
          ? t("wallet.migrate.stoppedBody")
          : api.graceUntilMs
            ? t("wallet.migrate.graceUntil", { date: fmtDay(api.graceUntilMs), left: api.graceDaysLeft ? (api.graceDaysLeft === 1 ? t("wallet.migrate.dayLeft") : t("wallet.migrate.daysLeft", { n: api.graceDaysLeft })) : "" })
            : t("wallet.migrate.graceShort")}
      </p>

      {!testMode && (
        <div className="mt-3">
          <WalletIdFields bvn={bvn} nin={nin} onBvn={setBvn} onNin={setNin} selfie={selfie} onSelfie={setSelfie} inputClass={input} />
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {t("wallet.migrate.idNote")}
          </p>
        </div>
      )}
      {err && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{err}</p>}
      <button onClick={submit} disabled={busy || api?.busy}
        className={`mt-3 w-full py-3 rounded-2xl text-white font-bold text-[14px] disabled:opacity-50 transition-colors ${btn}`}>
        {busy ? t("wallet.migrate.getting") : t("wallet.migrate.get")}
      </button>
    </div>
  );
}
