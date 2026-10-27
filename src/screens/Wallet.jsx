import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import AmountDisplay from "../components/shared/AmountDisplay";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useWallet } from "../hooks/useWallet";
import { useBvnVerification } from "../hooks/useBvnVerification";
import {
  ActionButton, AccountCard, WalletTxRow,
  FundWalletSheet, TransferSheet, ReceivePaymentSheet,
} from "../components/WalletPanel";
import PosterStudio from "../components/PosterStudio";
import WalletMigrationCard from "../components/WalletMigrationCard";
import WalletIdFields, { walletIdErrorText } from "../components/WalletIdFields";
import { walletIdError } from "../utils/walletId";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { fmt } from "../utils/helpers";
import { bizFromProfile } from "../utils/receiptConfig";
import { useT } from "../contexts/LanguageContext";

// how often a repeat transfer runs (stored value → label key)
const FREQ_KEYS = { daily: "wallet.freq.daily", weekly: "wallet.freq.weekly", monthly: "wallet.freq.monthly" };

// Cut-out person on the balance card (hidden if the photo can't load).
function WalletHeroPhoto() {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img src="/img/people/wallet.webp" alt="" onError={() => setOk(false)}
      className="pointer-events-none absolute right-12 bottom-0 h-[132px] w-auto object-contain drop-shadow-[0_10px_16px_rgba(0,0,0,.35)]" />
  );
}

export default function Wallet({ session, store }) {
  const userId = session?.user?.id || null;
  const navigate = useNavigate();
  const t = useT();
  const { walletEnabled, walletTestMode, configLoading, bvnVerificationEnabled } = usePlatformConfig();
  const w = useWallet(userId, walletEnabled);
  const bvnVerify = useBvnVerification(w);
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("kt_balance_hidden") === "1");
  const [sheet, setSheet] = useState(null);   // fund | transfer | receive | poster
  const [receipt, setReceipt] = useState(null);
  const [err, setErr] = useState("");
  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [selfie, setSelfie] = useState("");
  const [activating, setActivating] = useState(false);
  const [showReverify, setShowReverify] = useState(false);
  const [reverifyBvn, setReverifyBvn] = useState("");
  const [reverifyBusy, setReverifyBusy] = useState(false);
  const [reverifyErr, setReverifyErr] = useState("");

  const openReceipt = (row) => setReceipt(w.receiptFor(row, store?.profile?.business_name, store?.profile?.owner_name, bizFromProfile(store?.profile)));

  const toggleHidden = () => {
    const n = !hidden; sessionStorage.setItem("kt_balance_hidden", n ? "1" : "0"); setHidden(n);
  };
  const activate = async () => {
    setErr("");
    const idErr = walletIdError(bvn, nin, walletTestMode);
    if (idErr) { setErr(walletIdErrorText(idErr, t)); return; }
    setActivating(true);
    try {
      // Real BVN verification (bvnVerify) is temporarily not required before
      // activation — Flutterwave has BVN Verification disabled on this
      // merchant account ("Merchant is not enabled to use BVN service"),
      // which would otherwise hard-block every activation. Re-add once
      // Flutterwave confirms the product is enabled. The reverify banner
      // below still uses bvnVerify directly, for anyone who wants to try.
      await w.provisionAccount(bvn, nin, selfie);
    } catch (e) {
      setErr(e.message || t("wallet.err.activate"));
    } finally {
      setActivating(false);
    }
  };

  // Re-verifying an already-activated wallet — never touches provisionAccount,
  // just runs the BVN consent flow again and refreshes bvn_verified.
  const doReverify = async () => {
    setReverifyErr("");
    if (!/^\d{11}$/.test(reverifyBvn)) { setReverifyErr(t("wallet.reverify.enterBvn")); return; }
    setReverifyBusy(true);
    try {
      const status = bvnVerify.pending ? await bvnVerify.checkAgain() : await bvnVerify.verify(reverifyBvn);
      if (!status.verified) {
        setReverifyErr(status.error || (status.pending
          ? t("wallet.reverify.stillProcessing")
          : t("wallet.reverify.incomplete")));
        return;
      }
      await w.refresh();
      setShowReverify(false);
      setReverifyBvn("");
    } catch (e) {
      setReverifyErr(e.message || t("wallet.reverify.failed"));
    } finally {
      setReverifyBusy(false);
    }
  };

  if (configLoading || w.loading) {
    return (
      <div className="pb-28">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <button onClick={() => navigate(-1)} className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full">
            <Icon name="chevron-left" size={20} className="text-slate-500 dark:text-slate-400" />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800 dark:text-slate-100">{t("wallet.title")}</h1>
        </div>
        <div className="px-4 space-y-4">
          <div className="h-[168px] rounded-3xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div className="h-[92px] rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div className="h-[220px] rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        </div>
      </div>
    );
  }
  if (!walletEnabled) {
    return (
      <div className="p-8 text-center">
        <Icon name="wallet" size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("wallet.unavailable")}</p>
      </div>
    );
  }

  const idInput = "w-full mt-1.5 px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[16px] font-semibold tracking-wider placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400";

  return (
    <div className="pb-28">
      {/* header */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <button onClick={() => navigate(-1)} className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800">
          <Icon name="chevron-left" size={20} className="text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="text-[18px] font-extrabold text-slate-900 dark:text-slate-50">{t("wallet.title")}</h1>
        {walletTestMode && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">{t("wallet.testBadge")}</span>
        )}
      </div>

      <div className="px-4 space-y-4">
        {/* balance */}
        <div className="rounded-[28px] p-6 min-h-[172px] text-white relative overflow-hidden shadow-hero"
          style={{ background: "linear-gradient(150deg,var(--navy) 0%,var(--navy-mid) 50%,var(--navy-dark) 100%)" }}>
          <div className="absolute -top-16 -right-12 w-48 h-48 rounded-full bg-white/[0.06]" />
          <div className="absolute -bottom-16 -left-10 w-52 h-52 rounded-full bg-white/[0.05]" />
          <WalletHeroPhoto />
          <div className="relative pr-[96px]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">{t("wallet.availableBalance")}</p>
              <button onClick={toggleHidden} className="w-9 h-9 -mr-[96px] -mt-1 relative z-10 flex items-center justify-center rounded-xl bg-white/10 active:bg-white/20">
                <Icon name="eye" size={14} className="text-white" />
              </button>
            </div>
            <AmountDisplay amount={w.balanceKobo} fromKobo size="hero" align="left" hidden={hidden} className="mt-2 text-white" />
            {w.hasAccount && w.accountState !== "retired" && (
              <p className="mt-2 text-[12px] text-white/60">
                {w.wallet.flw_account_number} · KudiAI Wallet
              </p>
            )}
          </div>
        </div>

        {err && <p className="text-[12px] text-red-500">{err}</p>}

        {!w.hasAccount ? (
          <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-6">
            <div className="w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mx-auto mb-3">
              <Icon name="wallet" size={24} className="text-brand-600 dark:text-brand-400" />
            </div>
            <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50 mb-1 text-center">{t("wallet.activate.title")}</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-5 text-center leading-relaxed">
              {t("wallet.activate.body")}
            </p>
            {!walletTestMode && (
              <div className="space-y-3 mb-4">
                <WalletIdFields bvn={bvn} nin={nin} onBvn={setBvn} onNin={setNin} selfie={selfie} onSelfie={setSelfie} inputClass={idInput} />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {t("wallet.activate.idNote")}
                </p>
              </div>
            )}
            <button onClick={activate} disabled={activating || w.busy}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold rounded-2xl py-4 text-[15px] transition-colors">
              {activating || w.busy ? t("wallet.activating") : t("wallet.activateBtn")}
            </button>
          </div>
        ) : (
          <>
            <WalletMigrationCard api={w} testMode={walletTestMode} />
            <AccountCard wallet={w.wallet} displayName={store?.profile?.business_name || store?.profile?.owner_name} />

            {bvnVerificationEnabled && !w.bvnVerified && !walletTestMode && (
              <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3.5">
                <p className="text-[12.5px] font-bold text-amber-700 dark:text-amber-300">{t("wallet.reverify.title")}</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 leading-relaxed">
                  {t("wallet.reverify.body")}
                </p>
                {!showReverify ? (
                  <button onClick={() => setShowReverify(true)}
                    className="mt-2.5 w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-[12.5px] transition active:scale-[0.99]">
                    {t("wallet.reverify.now")}
                  </button>
                ) : (
                  <div className="mt-3 space-y-2">
                    <input inputMode="numeric" value={reverifyBvn}
                      onChange={(e) => setReverifyBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                      placeholder={t("wallet.id.bvnPlaceholder")} className={idInput} />
                    {reverifyErr && <p className="text-[11px] text-red-500">{reverifyErr}</p>}
                    <button onClick={doReverify} disabled={reverifyBusy}
                      className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl font-bold text-[12.5px] transition active:scale-[0.99]">
                      {reverifyBusy ? t("wallet.verifying") : t("wallet.submit")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* quick actions */}
            <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
              <div className="flex items-start gap-1">
                <ActionButton icon="plus"       label={t("wallet.action.fund")} onClick={() => setSheet("fund")} />
                <ActionButton icon="send"       label={t("wallet.action.transfer")}onClick={() => setSheet("transfer")} />
                <ActionButton icon="arrow-down" label={t("wallet.action.receive")}onClick={() => setSheet("receive")} />
                <ActionButton icon="bills"      label={t("wallet.action.payBills")}onClick={() => navigate("/bills")} tone="slate" />
                <ActionButton icon="card"       label={t("wallet.action.cards")} tone="slate" disabled badge={t("wallet.action.soon")} />
              </div>
            </div>

            {w.payRequest && (
              <button onClick={() => setSheet("receive")}
                className="w-full flex items-center gap-2.5 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-left">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                <span className="text-[12px] text-amber-700 dark:text-amber-400 flex-1">
                  {t("wallet.awaitingA")} <b>{fmt(w.payRequest.amount_kobo / 100)}</b> {t("wallet.awaitingB")}{w.payRequest.customer_name ? t("wallet.awaitingFrom", { name: w.payRequest.customer_name }) : ""}
                </span>
                <Icon name="chevron-right" size={14} className="text-amber-400" />
              </button>
            )}

            {/* scheduled transfers */}
            {w.scheduledTransfers.length > 0 && (
              <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">{t("wallet.repeatTransfers")}</p>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {w.scheduledTransfers.filter(s => s.status !== "cancelled").map((s) => (
                    <div key={s.id} className="py-3 flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center flex-shrink-0">
                        <Icon name="clock" size={16} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate">{s.account_name}</p>
                        <p className="text-[11px] text-slate-400 capitalize">
                          {fmt(s.amount_kobo / 100)} · {FREQ_KEYS[s.frequency] ? t(FREQ_KEYS[s.frequency]) : s.frequency}
                          {s.status === "paused" && <span className="text-amber-500 font-bold"> · {t("wallet.paused")}</span>}
                        </p>
                        {s.status === "paused" && s.last_run_error && (
                          <p className="text-[10px] text-red-500 mt-0.5 truncate">{s.last_run_error}</p>
                        )}
                        {s.status === "active" && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {t("wallet.nextRun", { date: new Date(s.next_run_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) })}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => w.setScheduledTransferStatus(s.id, s.status === "active" ? "paused" : "active")}
                          className="text-[11px] font-bold text-brand-600 dark:text-brand-400 px-2 py-1">
                          {s.status === "active" ? t("wallet.pause") : t("wallet.resume")}
                        </button>
                        <button
                          onClick={() => { if (window.confirm(t("wallet.cancelRepeatConfirm", { name: s.account_name }))) w.setScheduledTransferStatus(s.id, "cancelled"); }}
                          className="text-[11px] font-bold text-red-500 px-2 py-1">
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* transactions */}
            <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("wallet.transactions")}</p>
                {w.ledger.length > 0 && (
                  <button onClick={() => navigate("/wallet/statement")} className="text-[11px] font-bold text-brand-600 dark:text-brand-400">
                    {t("wallet.statementLink")}
                  </button>
                )}
              </div>
              {w.ledger.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-8 text-center">{t("wallet.noActivity")}</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {w.ledger.map((row) => <WalletTxRow key={row.id} row={row} entry={w.entryFor(row)} hidden={hidden} onOpen={openReceipt} />)}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <FundWalletSheet open={sheet === "fund"} onClose={() => setSheet(null)}
        wallet={w.wallet} testMode={walletTestMode} api={w}
        businessName={store?.profile?.business_name} ownerName={store?.profile?.owner_name}
        onPoster={() => setSheet("poster")} />
      <PosterStudio open={sheet === "poster"} onClose={() => setSheet(null)} profile={store?.profile} initialType="pay" />
      <TransferSheet open={sheet === "transfer"} onClose={() => setSheet(null)}
        balanceKobo={w.balanceKobo} maxKobo={w.limits.perTransferKobo}
        dailyCapKobo={w.limits.dailyKobo} dailyUsedKobo={w.dailyUsedKobo}
        banks={w.banks} api={w} onDone={w.refresh} ownerId={userId}
        businessName={store?.profile?.business_name} ownerName={store?.profile?.owner_name} />
      <ReceivePaymentSheet open={sheet === "receive"} onClose={() => setSheet(null)}
        wallet={w.wallet} payRequest={w.payRequest} testMode={walletTestMode} api={w}
        businessName={store?.profile?.business_name} ownerName={store?.profile?.owner_name} />

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
