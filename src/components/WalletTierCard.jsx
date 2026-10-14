import { useState } from "react";
import { BottomSheet } from "./WalletPanel";
import { useWalletTier } from "../hooks/useWalletTier";
import { TIER_INFO, formatKoboLimit } from "../utils/walletTier";
import { STATES, getLGAs } from "../utils/nigeriaData";
import { digits11 } from "../utils/walletId";
import KycConsent from "./KycConsent";
import SelfieCapture from "./SelfieCapture";
import { kycConsentGiven } from "../utils/kycConsent";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import Tier3Upgrade from "./Tier3Upgrade";
import { useT } from "../contexts/LanguageContext";

const FIELD = "w-full mt-1.5 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[15px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400";
const LABEL = "text-[12px] font-semibold text-slate-500 dark:text-slate-400";
const BTN = "w-full py-3.5 rounded-2xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold text-[14px] transition-colors";

// Colour per tier: Tier 1 slate, Tier 2 blue, Tier 3 gold.
const TONE = {
  1: "bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200",
  2: "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300",
  3: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
};

// formatKoboLimit() says "Unlimited" in English; show that word in the chosen language
const limitText = (kobo, tr) => (kobo === null || kobo === undefined ? tr("wallet.tier.unlimited") : formatKoboLimit(kobo));

function Limits({ limits }) {
  const tr = useT();
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-3.5 py-3">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{tr("wallet.tier.maxBalance")}</p>
        <p className="mt-0.5 text-[15px] font-extrabold text-slate-800 dark:text-slate-100">{limitText(limits.maxBalanceKobo, tr)}</p>
      </div>
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-3.5 py-3">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{tr("wallet.tier.dailyLimit")}</p>
        <p className="mt-0.5 text-[15px] font-extrabold text-slate-800 dark:text-slate-100">{limitText(limits.dailyKobo, tr)}</p>
      </div>
    </div>
  );
}

// ── Tier 2: self-service ───────────────────────────────────────────────────────────────────────────────────────────
function Tier2Sheet({ open, onClose, tierApi, prefill }) {
  const [f, setF] = useState({ full_name: prefill?.fullName || "", address: prefill?.address || "", state: prefill?.state || "", lga: prefill?.lga || "", bvn: "", nin: "", selfie: "" });
  const { kycSelfieRequired } = usePlatformConfig();
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const lgas = getLGAs(f.state) || [];

  const submit = async () => {
    setErr("");
    if (f.full_name.trim().split(/\s+/).length < 2) { setErr(tr("wallet.tier2.err.fullName")); return; }
    if (f.address.trim().length < 8) { setErr(tr("wallet.tier2.err.address")); return; }
    if (!f.state) { setErr(tr("wallet.tier2.err.state")); return; }
    if (!/^\d{11}$/.test(f.bvn)) { setErr(tr("wallet.id.err.bvn11")); return; }
    if (!/^\d{11}$/.test(f.nin)) { setErr(tr("wallet.id.err.nin11")); return; }
    if (f.bvn === f.nin) { setErr(tr("wallet.tier2.err.same")); return; }
    setBusy(true);
    try {
      await tierApi.upgradeToTier2({ ...f, full_name: f.full_name.trim(), address: f.address.trim(), consent: kycConsentGiven() });
      setDone(true);
    } catch (e) {
      setErr(e?.message || tr("wallet.tier2.err.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={done ? "" : tr("wallet.tier.upgradeTo2")}>
      {done ? (
        <div className="text-center py-3">
          <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">{tr("wallet.tier2.doneTitle")}</p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1.5">{tr("wallet.tier2.doneBody")}</p>
          <button onClick={onClose} className={BTN + " mt-5"}>{tr("common.done")}</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {tr("wallet.tier2.intro", { balance: limitText(tierApi.nextLimits?.maxBalanceKobo, tr), daily: limitText(tierApi.nextLimits?.dailyKobo, tr) })}
          </p>
          <div><label className={LABEL}>{tr("wallet.tier2.fullName")}</label>
            <input value={f.full_name} onChange={(e) => set("full_name")(e.target.value)} placeholder={tr("wallet.tier2.asOnId")} className={FIELD} /></div>
          <div><label className={LABEL}>{tr("wallet.tier2.address")}</label>
            <input value={f.address} onChange={(e) => set("address")(e.target.value)} placeholder={tr("wallet.tier2.addressPh")} className={FIELD} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={LABEL}>{tr("wallet.tier2.state")}</label>
              <select value={f.state} onChange={(e) => { set("state")(e.target.value); set("lga")(""); }} className={FIELD}>
                <option value="">{tr("wallet.tier2.select")}</option>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div><label className={LABEL}>{tr("wallet.tier2.lga")}</label>
              <select value={f.lga} disabled={!f.state} onChange={(e) => set("lga")(e.target.value)} className={FIELD + " disabled:opacity-50"}>
                <option value="">{f.state ? tr("wallet.tier2.select") : tr("wallet.tier2.stateFirst")}</option>
                {lgas.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></div>
          </div>
          <div><label className={LABEL}>BVN</label>
            <input inputMode="numeric" value={f.bvn} onChange={(e) => set("bvn")(digits11(e.target.value))} placeholder={tr("wallet.id.bvnPlaceholder")} className={FIELD + " tracking-wider"} /></div>
          <div><label className={LABEL}>NIN</label>
            <input inputMode="numeric" value={f.nin} onChange={(e) => set("nin")(digits11(e.target.value))} placeholder={tr("wallet.id.ninPlaceholder")} className={FIELD + " tracking-wider"} /></div>
          <KycConsent />
          {kycSelfieRequired && <SelfieCapture value={f.selfie} onCapture={set("selfie")} onClear={() => set("selfie")("")} />}
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {tr("wallet.tier2.note")}
          </p>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <button onClick={submit} disabled={busy} className={BTN}>{busy ? tr("wallet.tier2.upgrading") : tr("wallet.tier.upgradeTo2")}</button>
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * The wallet TIER card for a profile screen: which tier the holder is on, what it allows, and how to reach the next one.
 * Everyone starts at Tier 1. Shown to owners, Ajo/Esusu clients, staff and managers (anyone who can hold a wallet).
 * `prefill` = { fullName, address, state, lga } to pre-fill the Tier 2 form; `onOpenWallet` (optional) is offered when they have no wallet yet.
 */
export default function WalletTierCard({ userId, enabled = true, prefill, onOpenWallet, className = "" }) {
  const t = useWalletTier(userId, enabled);
  const tr = useT();
  const [sheet, setSheet] = useState(null);       // "t2" | "t3"
  if (!enabled) return null;
  if (t.loading) return <div className={`h-40 rounded-3xl bg-slate-100 dark:bg-slate-800 animate-pulse ${className}`} />;

  const info = TIER_INFO[t.tier];
  return (
    <>
      <div className={`rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-card p-5 ${className}`}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{tr("wallet.tier.accountTier")}</p>
          <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full ${TONE[t.tier]}`}>{tr("wallet.tier.tierN", { n: t.tier })}</span>
        </div>
        <p className="mt-1.5 text-[19px] font-extrabold text-slate-900 dark:text-slate-50">{tr(info.nameKey)}</p>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {[1, 2, 3].map((n) => <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= t.tier ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />)}
        </div>

        {!t.hasWallet ? (
          <p className="mt-3 text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {onOpenWallet ? tr("wallet.tier.openToStart") : tr("wallet.tier.openToStartFind")}
          </p>
        ) : (
          <div className="mt-3"><Limits limits={t.limits} /></div>
        )}
        {!t.hasWallet && onOpenWallet && (
          <button onClick={onOpenWallet} className={BTN + " mt-3"}>{tr("wallet.tier.openMyWallet")}</button>
        )}

        {t.hasWallet && t.next === 2 && (
          <div className="mt-4 rounded-2xl bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-900/40 p-4">
            <p className="text-[13.5px] font-extrabold text-sky-800 dark:text-sky-200">{tr("wallet.tier.upgradeToNamed", { n: 2, name: tr(TIER_INFO[2].nameKey) })}</p>
            <p className="mt-0.5 text-[12px] text-sky-700 dark:text-sky-300 leading-relaxed">
              {tr("wallet.tier.raiseTo", { balance: limitText(t.nextLimits.maxBalanceKobo, tr), daily: limitText(t.nextLimits.dailyKobo, tr) })}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {TIER_INFO[2].requirements.map((r, i) => <li key={r} className="text-[12px] text-sky-800 dark:text-sky-200">• {tr(TIER_INFO[2].requirementKeys[i])}</li>)}
            </ul>
            <button onClick={() => setSheet("t2")} className={BTN + " mt-3"}>{tr("wallet.tier.upgradeTo2")}</button>
          </div>
        )}

        {t.hasWallet && t.next === 3 && (
          <div className="mt-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 p-4">
            <p className="text-[13.5px] font-extrabold text-amber-800 dark:text-amber-200">{tr("wallet.tier.upgradeToNamed", { n: 3, name: tr(TIER_INFO[3].nameKey) })}</p>
            <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-300 leading-relaxed">
              {tr("wallet.tier.unlock", { balance: limitText(t.nextLimits.maxBalanceKobo, tr), daily: limitText(t.nextLimits.dailyKobo, tr) })}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {TIER_INFO[3].requirements.map((r, i) => <li key={r} className="text-[12px] text-amber-800 dark:text-amber-200">• {tr(TIER_INFO[3].requirementKeys[i])}</li>)}
            </ul>
            {t.pending && t.t3?.hasDocs ? (
              <div className="mt-3 rounded-xl bg-white/70 dark:bg-slate-900/40 px-3 py-2.5">
                <p className="text-[12.5px] font-extrabold text-amber-900 dark:text-amber-100">{tr("wallet.tier.underReview")}</p>
                <p className="text-[12px] text-amber-800 dark:text-amber-200 leading-relaxed">
                  {tr("wallet.tier.submittedOn", { date: t.t3.submittedAt ? new Date(t.t3.submittedAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : tr("wallet.tier.recently") })}
                </p>
              </div>
            ) : t.pending ? (
              <>
                <p className="mt-3 text-[12.5px] font-bold text-amber-900 dark:text-amber-100">{tr("wallet.tier.waitingDocs")}</p>
                <button onClick={() => setSheet("t3")} className={BTN + " mt-2"}>{tr("wallet.tier.uploadDocs")}</button>
              </>
            ) : (
              <>
                {t.t3?.status === "rejected" && (
                  <div className="mt-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/40 px-3 py-2.5">
                    <p className="text-[12.5px] font-extrabold text-rose-800 dark:text-rose-200">{tr("wallet.tier.notApproved")}</p>
                    {t.t3.reviewNote && <p className="text-[12px] text-rose-700 dark:text-rose-300 leading-relaxed">{tr("wallet.tier.reason", { note: t.t3.reviewNote })}</p>}
                  </div>
                )}
                <button onClick={() => setSheet("t3")} className={BTN + " mt-3"}>{t.t3?.status === "rejected" ? tr("common.retry") : tr("wallet.tier.upgradeTo3")}</button>
              </>
            )}
          </div>
        )}

        {t.hasWallet && t.next === null && (
          <p className="mt-4 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400">{tr("wallet.tier.highest")}</p>
        )}
      </div>

      {sheet === "t2" && <Tier2Sheet open onClose={() => setSheet(null)} tierApi={t} prefill={prefill} />}
      {sheet === "t3" && <Tier3Upgrade onClose={() => setSheet(null)} tierApi={t} prefill={prefill} />}
    </>
  );
}
