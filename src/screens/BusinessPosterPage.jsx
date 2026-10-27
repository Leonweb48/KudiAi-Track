import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { useLanguage, useT } from "../contexts/LanguageContext";
import { LANGUAGES } from "../utils/i18n";
import { bankLogoUrl, cleanBankName, displayBankName } from "../utils/bankLogos";
import { parsePosterPath, setPendingJoin, PLAY_STORE_URL } from "../utils/posterJoin";

/**
 * Public pages behind the business-poster QR codes (2026-10-27), reached with no session:
 *   /pay/<code>   the business's LIVE payment account (number, bank, the account name Flutterwave registered), so a payer
 *                 can check the number on a poster really is this business's — or learn it has no active account.
 *   /join/<code>  "Save with <business>": opens wallet sign-up with that business already chosen (posterJoin.js).
 * Everything comes from business_poster_lookup, which returns only the business name, its published registration fee
 * and an account that can receive money.
 */
const groupNumber = (n) => {
  const d = String(n || "").replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(n || "");
};

export default function BusinessPosterPage() {
  const t = useT();
  const { lang, changeLang } = useLanguage();
  const target = parsePosterPath(window.location.pathname);
  const [state, setState] = useState(target ? "loading" : "notFound");   // loading | ready | notFound | error
  const [biz, setBiz] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!target) return undefined;
    let live = true;
    setState("loading");
    supabase.rpc("business_poster_lookup", { p_code: target.code }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setState("error"); return; }
      if (!data?.ok) { setState("notFound"); return; }
      setBiz(data); setState("ready");
    });
    return () => { live = false; };
  }, [tries]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try { await navigator.clipboard.writeText(String(biz.account.number)); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* no clipboard */ }
  };
  const join = () => {
    setPendingJoin(biz.business_id, biz.business_name);
    window.location.assign("/?signup=1");
  };

  const name = biz?.business_name || "";
  const acct = biz?.account;
  const bank = acct ? displayBankName({ name: cleanBankName(acct.bank) }) : "";
  const logo = acct ? bankLogoUrl({ name: acct.bank }) : null;
  const fee = Number(biz?.registration_fee || 0);

  return (
    <div className="min-h-[100dvh] px-4 py-6 flex flex-col items-center" style={{ background: "linear-gradient(180deg,#0E4A2F,#05241A)" }}>
      <div className="w-full max-w-md flex items-center justify-between">
        <a href="/home" className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl bg-white flex items-center justify-center"><img src="/logo-tp.png" alt="" className="w-8 h-8" /></span>
          <span className="text-white font-black text-[17px]">KudiAI Track</span>
        </a>
        <select value={lang} onChange={(e) => changeLang(e.target.value)} aria-label="Language"
          className="bg-white/10 text-white text-[12px] font-bold rounded-full px-3 py-1.5 border border-white/20">
          {LANGUAGES.map((l) => <option key={l.code} value={l.code} className="text-slate-900">{l.native}</option>)}
        </select>
      </div>

      <div className="w-full max-w-md mt-6 rounded-3xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="h-2" style={{ background: "linear-gradient(90deg,#3DA829,#A6F08A)" }} />
        <div className="p-5">
          {state === "loading" && <p className="text-[14px] text-slate-500 py-10 text-center">{t("posters.pg.checking")}</p>}
          {state === "notFound" && <p className="text-[14px] text-slate-700 dark:text-slate-300 py-8 text-center">{t("posters.pg.notFound")}</p>}
          {state === "error" && (
            <div className="py-8 text-center">
              <p className="text-[14px] text-slate-700 dark:text-slate-300">{t("posters.pg.loadFailed")}</p>
              <button onClick={() => setTries((n) => n + 1)} className="mt-3 text-[13px] font-bold text-brand-600 underline">{t("posters.retry")}</button>
            </div>
          )}

          {state === "ready" && target.kind === "pay" && (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-[11px] font-extrabold px-2.5 py-1">
                ✓ {t("posters.pg.verified")}
              </span>
              <h1 className="mt-2 text-[24px] font-black text-slate-900 dark:text-white leading-tight">{name}</h1>
              {acct ? (
                <>
                  <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">{t("posters.pg.payIntro", { biz: name })}</p>
                  <div className="mt-4 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-brand-700 dark:text-brand-400">{t("posters.p.accountNumber")}</p>
                    <p className="mt-1 text-[32px] font-black tracking-wide text-[#0B3B26] dark:text-white tabular-nums">{groupNumber(acct.number)}</p>
                    <div className="mt-3 flex items-center gap-2.5">
                      {logo
                        ? <img src={logo} alt="" className="w-9 h-9 rounded-full object-cover border border-slate-100" />
                        : <span className="w-9 h-9 rounded-full bg-slate-100" />}
                      <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{bank}</p>
                    </div>
                    <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">{t("posters.p.accountName")}</p>
                    <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{acct.name || name}</p>
                    <button onClick={copy}
                      className="mt-4 w-full rounded-xl bg-brand-600 text-white font-bold py-3 text-[14px] active:scale-[0.99]">
                      {copied ? t("posters.pg.copied") : t("posters.pg.copy")}
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-[13.5px] text-amber-800 dark:text-amber-200 leading-relaxed">
                  {t("posters.pg.noAccount", { biz: name })}
                </p>
              )}
            </>
          )}

          {state === "ready" && target.kind === "join" && (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-[11px] font-extrabold px-2.5 py-1">
                KudiAI Ajo · Esusu
              </span>
              <h1 className="mt-2 text-[24px] font-black text-slate-900 dark:text-white leading-tight">{t("posters.pg.joinTitle", { biz: name })}</h1>
              <p className="mt-1.5 text-[13.5px] text-slate-600 dark:text-slate-300 leading-relaxed">{t("posters.pg.joinIntro", { biz: name })}</p>
              <p className="mt-3 text-[12.5px] font-bold text-slate-700 dark:text-slate-200">
                {fee > 0 ? t("posters.pg.fee", { fee: `₦${fee.toLocaleString("en-NG")}` }) : t("posters.pg.noFee")}
              </p>
              <button onClick={join} className="mt-5 w-full rounded-2xl bg-brand-600 text-white font-bold py-3.5 text-[15px] active:scale-[0.99]">
                {t("posters.pg.join")}
              </button>
              <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer"
                className="mt-2 block w-full text-center rounded-2xl bg-slate-900 text-white font-bold py-3.5 text-[14px]">
                {t("posters.pg.getApp")}
              </a>
              <p className="mt-3 text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed">{t("posters.pg.appHint", { biz: name })}</p>
            </>
          )}
        </div>
      </div>

      <p className="mt-6 text-[11px] text-white/60 text-center">
        kudiai.app · support@kudiai.app<br />KudiAI Track is a product of Amaya &amp; Co. Technologies · RC 9587896
      </p>
    </div>
  );
}
