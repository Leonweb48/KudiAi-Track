import { useState } from "react";
import { AmountDisplay } from "./shared/AmountDisplay";
import TransactionDetailModal from "./shared/TransactionDetailModal";
import {
  BottomSheet, ActionButton, AccountCard, FundWalletSheet, TransferSheet, WalletTxRow,
} from "./WalletPanel";
import WalletMigrationCard from "./WalletMigrationCard";
import WalletIdFields, { walletIdErrorText } from "./WalletIdFields";
import { walletIdError } from "../utils/walletId";
import { useWallet } from "../hooks/useWallet";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useT } from "../contexts/LanguageContext";

// Staff/manager's own KudiAI Wallet — same generic wallet infrastructure as the
// owner's Wallet.jsx and the Ajo/Esusu client's MemberWalletSheet (AjoMemberPortal.jsx),
// keyed off the staff member's OWN Supabase Auth session rather than the owner's, since
// staff log in with a separate account (see resolveIdentity()'s "staff" branch in
// supabase/functions/flutterwave/index.ts). No Ajo-style mandatory KYC (address/next-of-
// kin) gate — provision-account itself only ever required a BVN.
// Mount/unmount this component itself to open/close it (same convention as
// MemberWalletSheet) — no internal `open` prop, since a wallet realtime
// subscription should only exist while the sheet is actually up.
export default function StaffWalletPanel({ onClose, session, staffName }) {
  const { walletEnabled, walletTestMode } = usePlatformConfig();
  const wallet = useWallet(session?.user?.id || null, walletEnabled);
  const t = useT();

  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [selfie, setSelfie] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [walletSheet, setWalletSheet] = useState(null); // null | "fund" | "transfer"
  const [receipt, setReceipt] = useState(null);

  const activate = async () => {
    setErr("");
    const idErr = walletIdError(bvn, nin, walletTestMode);
    if (idErr) { setErr(walletIdErrorText(idErr, t)); return; }
    setBusy(true);
    try {
      await wallet.provisionAccount(bvn, nin, selfie);
    } catch (e) {
      setErr(e.message || t("wallet.err.activateYour"));
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = (row) => setReceipt(wallet.receiptFor(row, staffName, staffName));

  return (
    <>
      <BottomSheet open onClose={onClose} title={t("wallet.staff.title")}>
        {!walletEnabled ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400">{t("wallet.staff.unavailable")}</p>
        ) : wallet.loading ? (
          <div className="h-40 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ) : !wallet.hasAccount ? (
          <div>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
              {t("wallet.staff.body")}
            </p>
            {!walletTestMode && (
              <div className="mb-4">
                <WalletIdFields bvn={bvn} nin={nin} onBvn={setBvn} onNin={setNin} selfie={selfie} onSelfie={setSelfie} />
                <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                  {t("wallet.staff.idNote")}
                </p>
              </div>
            )}
            {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}
            <button onClick={activate} disabled={busy || wallet.busy}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold rounded-2xl py-4 text-[15px] transition-colors">
              {busy || wallet.busy ? t("wallet.activating") : t("wallet.activateBtn")}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t("wallet.balance")}</p>
            <AmountDisplay amount={wallet.balanceKobo} fromKobo size="hero" align="left" className="mb-4" />
            <WalletMigrationCard api={wallet} testMode={walletTestMode} className="mb-4" />
            <AccountCard wallet={wallet.wallet} displayName={staffName} />

            <div className="flex items-center gap-2 mt-4 mb-2">
              <ActionButton icon="plus" label={t("wallet.action.fundShort")} onClick={() => setWalletSheet("fund")} />
              <ActionButton icon="send" label={t("wallet.action.transfer")} tone="slate" onClick={() => setWalletSheet("transfer")} />
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-1">{t("wallet.transactions")}</p>
              {wallet.ledger.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-8 text-center">{t("wallet.noActivity")}</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {wallet.ledger.map((row) => <WalletTxRow key={row.id} row={row} entry={wallet.entryFor(row)} onOpen={openReceipt} />)}
                </div>
              )}
            </div>
          </div>
        )}
      </BottomSheet>

      {wallet.hasAccount && (
        <>
          <FundWalletSheet open={walletSheet === "fund"} onClose={() => setWalletSheet(null)}
            wallet={wallet.wallet} testMode={walletTestMode} api={wallet} businessName={staffName} />
          <TransferSheet open={walletSheet === "transfer"} onClose={() => setWalletSheet(null)}
            balanceKobo={wallet.balanceKobo} maxKobo={wallet.limits.perTransferKobo} dailyCapKobo={wallet.limits.dailyKobo} dailyUsedKobo={wallet.dailyUsedKobo} banks={wallet.banks} api={wallet}
            businessName={staffName} onDone={wallet.refresh} />
        </>
      )}

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}
