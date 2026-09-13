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
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { fmt } from "../utils/helpers";

export default function Wallet({ session, store }) {
  const userId = session?.user?.id || null;
  const navigate = useNavigate();
  const { walletEnabled, walletTestMode, walletMaxWithdrawalKobo, configLoading } = usePlatformConfig();
  const w = useWallet(userId, walletEnabled);
  const bvnVerify = useBvnVerification(w);
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("kt_balance_hidden") === "1");
  const [sheet, setSheet] = useState(null);   // fund | transfer | receive
  const [receipt, setReceipt] = useState(null);
  const [err, setErr] = useState("");
  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [activating, setActivating] = useState(false);
  const [showReverify, setShowReverify] = useState(false);
  const [reverifyBvn, setReverifyBvn] = useState("");
  const [reverifyBusy, setReverifyBusy] = useState(false);
  const [reverifyErr, setReverifyErr] = useState("");

  const openReceipt = (row) => setReceipt(w.receiptFor(row, store?.profile?.business_name, store?.profile?.owner_name));

  const toggleHidden = () => {
    const n = !hidden; sessionStorage.setItem("kt_balance_hidden", n ? "1" : "0"); setHidden(n);
  };
  const activate = async () => {
    setErr("");
    if (!walletTestMode && !/^\d{11}$/.test(bvn)) { setErr("Enter your 11-digit BVN"); return; }
    setActivating(true);
    try {
      if (!walletTestMode) {
        const status = bvnVerify.pending ? await bvnVerify.checkAgain() : await bvnVerify.verify(bvn);
        if (!status.verified) {
          setErr(status.error || (status.pending
            ? "Still processing — tap Activate wallet again in a moment."
            : "BVN verification did not complete. Please try again."));
          return;
        }
      }
      await w.provisionAccount(bvn, nin);
    } catch (e) {
      setErr(e.message || "Could not activate wallet");
    } finally {
      setActivating(false);
    }
  };

  // Re-verifying an already-activated wallet — never touches provisionAccount,
  // just runs the BVN consent flow again and refreshes bvn_verified.
  const doReverify = async () => {
    setReverifyErr("");
    if (!/^\d{11}$/.test(reverifyBvn)) { setReverifyErr("Enter your 11-digit BVN"); return; }
    setReverifyBusy(true);
    try {
      const status = bvnVerify.pending ? await bvnVerify.checkAgain() : await bvnVerify.verify(reverifyBvn);
      if (!status.verified) {
        setReverifyErr(status.error || (status.pending
          ? "Still processing — tap Reverify again in a moment."
          : "BVN verification did not complete. Please try again."));
        return;
      }
      await w.refresh();
      setShowReverify(false);
      setReverifyBvn("");
    } catch (e) {
      setReverifyErr(e.message || "Could not verify your BVN");
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
          <h1 className="text-[17px] font-bold text-slate-800 dark:text-slate-100">Wallet</h1>
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
        <p className="text-sm text-slate-500 dark:text-slate-400">The wallet isn't available yet.</p>
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
        <h1 className="text-[18px] font-extrabold text-slate-900 dark:text-slate-50">Wallet</h1>
        {walletTestMode && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">TEST</span>
        )}
      </div>

      <div className="px-4 space-y-4">
        {/* balance */}
        <div className="rounded-[28px] p-6 text-white relative overflow-hidden shadow-hero"
          style={{ background: "linear-gradient(150deg,var(--navy) 0%,var(--navy-mid) 50%,var(--navy-dark) 100%)" }}>
          <div className="absolute -top-16 -right-12 w-48 h-48 rounded-full bg-white/[0.06]" />
          <div className="absolute -bottom-16 -left-10 w-52 h-52 rounded-full bg-white/[0.05]" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">Available balance</p>
              <button onClick={toggleHidden} className="w-9 h-9 -mr-1.5 -mt-1 flex items-center justify-center rounded-xl bg-white/10 active:bg-white/20">
                <Icon name="eye" size={14} className="text-white" />
              </button>
            </div>
            <AmountDisplay amount={w.balanceKobo} fromKobo size="hero" align="left" hidden={hidden} className="mt-2 text-white" />
            {w.hasAccount && (
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
            <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50 mb-1 text-center">Activate your wallet</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-5 text-center leading-relaxed">
              Get a dedicated account number. Fund it, get paid into it, transfer out, and pay bills — all fee-free.
            </p>
            {!walletTestMode && (
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">BVN</label>
                  <input inputMode="numeric" value={bvn} onChange={(e) => setBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    placeholder="11-digit BVN" className={idInput} />
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">NIN <span className="text-slate-300 font-normal">optional</span></label>
                  <input inputMode="numeric" value={nin} onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    placeholder="11-digit NIN" className={idInput} />
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Your BVN opens your account with our banking partner and isn't stored by KudiAI.
                  The name and date of birth on it must match your profile.
                </p>
              </div>
            )}
            <button onClick={activate} disabled={activating || w.busy}
              className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-bold rounded-2xl py-4 text-[15px] transition-colors">
              {activating || w.busy ? "Activating…" : "Activate wallet"}
            </button>
          </div>
        ) : (
          <>
            <AccountCard wallet={w.wallet} displayName={store?.profile?.business_name || store?.profile?.owner_name} />

            {!w.bvnVerified && !walletTestMode && (
              <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3.5">
                <p className="text-[12.5px] font-bold text-amber-700 dark:text-amber-300">Please reverify your BVN</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 leading-relaxed">
                  We've added real BVN verification for wallet security. Your wallet keeps working normally, but please reverify to stay in good standing.
                </p>
                {!showReverify ? (
                  <button onClick={() => setShowReverify(true)}
                    className="mt-2.5 w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-[12.5px] transition active:scale-[0.99]">
                    Reverify now
                  </button>
                ) : (
                  <div className="mt-3 space-y-2">
                    <input inputMode="numeric" value={reverifyBvn}
                      onChange={(e) => setReverifyBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
                      placeholder="11-digit BVN" className={idInput} />
                    {reverifyErr && <p className="text-[11px] text-red-500">{reverifyErr}</p>}
                    <button onClick={doReverify} disabled={reverifyBusy}
                      className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl font-bold text-[12.5px] transition active:scale-[0.99]">
                      {reverifyBusy ? "Verifying…" : "Submit"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* quick actions */}
            <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
              <div className="flex items-start gap-1">
                <ActionButton icon="plus"       label="Fund wallet" onClick={() => setSheet("fund")} />
                <ActionButton icon="send"       label="Transfer"    onClick={() => setSheet("transfer")} />
                <ActionButton icon="arrow-down" label="Receive"     onClick={() => setSheet("receive")} />
                <ActionButton icon="bills"      label="Pay bills"   onClick={() => navigate("/bills")} tone="slate" />
              </div>
            </div>

            {w.payRequest && (
              <button onClick={() => setSheet("receive")}
                className="w-full flex items-center gap-2.5 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-left">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                <span className="text-[12px] text-amber-700 dark:text-amber-400 flex-1">
                  Awaiting a <b>{fmt(w.payRequest.amount_kobo / 100)}</b> payment{w.payRequest.customer_name ? ` from ${w.payRequest.customer_name}` : ""}
                </span>
                <Icon name="chevron-right" size={14} className="text-amber-400" />
              </button>
            )}

            {/* transactions */}
            <div className="rounded-3xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/60 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-1">Transactions</p>
              {w.ledger.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-8 text-center">No wallet activity yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {w.ledger.map((row) => <WalletTxRow key={row.id} row={row} hidden={hidden} onOpen={openReceipt} />)}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <FundWalletSheet open={sheet === "fund"} onClose={() => setSheet(null)}
        wallet={w.wallet} testMode={walletTestMode} api={w}
        businessName={store?.profile?.business_name} ownerName={store?.profile?.owner_name} />
      <TransferSheet open={sheet === "transfer"} onClose={() => setSheet(null)}
        balanceKobo={w.balanceKobo} maxKobo={walletMaxWithdrawalKobo} banks={w.banks} api={w} onDone={w.refresh}
        businessName={store?.profile?.business_name} ownerName={store?.profile?.owner_name} />
      <ReceivePaymentSheet open={sheet === "receive"} onClose={() => setSheet(null)}
        wallet={w.wallet} payRequest={w.payRequest} testMode={walletTestMode} api={w}
        businessName={store?.profile?.business_name} ownerName={store?.profile?.owner_name} />

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
