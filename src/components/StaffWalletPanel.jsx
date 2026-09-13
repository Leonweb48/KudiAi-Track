import { useState } from "react";
import { AmountDisplay } from "./shared/AmountDisplay";
import TransactionDetailModal from "./shared/TransactionDetailModal";
import {
  BottomSheet, ActionButton, AccountCard, FundWalletSheet, TransferSheet, WalletTxRow,
} from "./WalletPanel";
import { useWallet } from "../hooks/useWallet";
import { usePlatformConfig } from "../hooks/usePlatformConfig";

// Staff/manager's own KudiAI Wallet — same generic wallet infrastructure as the
// owner's Wallet.jsx and the Ajo/Esusu client's MemberWalletSheet (AjoMemberPortal.jsx),
// keyed off the staff member's OWN Supabase Auth session rather than the owner's, since
// staff log in with a separate account (see resolveIdentity()'s "staff" branch in
// supabase/functions/flutterwave/index.ts). No Ajo-style mandatory KYC (address/next-of-
// kin) gate — provision-account itself only ever required a BVN.
export default function StaffWalletPanel({ open, onClose, session, staffName }) {
  const { walletEnabled, walletTestMode, walletMaxWithdrawalKobo } = usePlatformConfig();
  const wallet = useWallet(open ? (session?.user?.id || null) : null, walletEnabled);

  const [bvn, setBvn] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [walletSheet, setWalletSheet] = useState(null); // null | "fund" | "transfer"
  const [receipt, setReceipt] = useState(null);

  const activate = async () => {
    setErr("");
    if (!walletTestMode && !/^\d{11}$/.test(bvn)) { setErr("Enter your 11-digit BVN"); return; }
    setBusy(true);
    try {
      await wallet.provisionAccount(bvn, "");
    } catch (e) {
      setErr(e.message || "Could not activate your wallet");
    } finally {
      setBusy(false);
    }
  };

  const openReceipt = (row) => setReceipt(wallet.receiptFor(row, staffName, staffName));

  if (!open) return null;

  return (
    <>
      <BottomSheet open onClose={onClose} title="My KudiAI Wallet">
        {!walletEnabled ? (
          <p className="text-[13px] text-slate-500 dark:text-slate-400">Wallets aren't available right now.</p>
        ) : wallet.loading ? (
          <div className="h-40 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        ) : !wallet.hasAccount ? (
          <div>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
              Get your own dedicated account number. Fund it and pay for customers' bills straight from it — no
              Paystack, no card fees.
            </p>
            {!walletTestMode && (
              <div className="mb-4">
                <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">BVN</label>
                <input inputMode="numeric" value={bvn} onChange={e => setBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="11-digit BVN"
                  className="w-full mt-1.5 px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[16px] font-semibold tracking-wider placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400" />
                <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                  Your BVN is required by the Central Bank of Nigeria to open any bank-linked account. It isn't
                  stored by KudiAI; the name on it must match your staff profile.
                </p>
              </div>
            )}
            {err && <p className="text-[12px] text-red-500 mb-3">{err}</p>}
            <button onClick={activate} disabled={busy || wallet.busy}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold rounded-2xl py-4 text-[15px] transition-colors">
              {busy || wallet.busy ? "Activating…" : "Activate wallet"}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Balance</p>
            <AmountDisplay amount={wallet.balanceKobo} fromKobo size="hero" align="left" className="mb-4" />
            <AccountCard wallet={wallet.wallet} displayName={staffName} />

            <div className="flex items-center gap-2 mt-4 mb-2">
              <ActionButton icon="plus" label="Fund" onClick={() => setWalletSheet("fund")} />
              <ActionButton icon="send" label="Transfer" tone="slate" onClick={() => setWalletSheet("transfer")} />
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-1">Transactions</p>
              {wallet.ledger.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-8 text-center">No wallet activity yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {wallet.ledger.map((row) => <WalletTxRow key={row.id} row={row} onOpen={openReceipt} />)}
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
            balanceKobo={wallet.balanceKobo} maxKobo={walletMaxWithdrawalKobo} banks={wallet.banks} api={wallet}
            businessName={staffName} onDone={wallet.refresh} />
        </>
      )}

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}
