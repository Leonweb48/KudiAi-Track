import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import AmountDisplay from "../components/shared/AmountDisplay";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useWallet } from "../hooks/useWallet";
import {
  ActionButton, WalletTxRow, FundSheet, WithdrawSheet,
} from "../components/WalletPanel";

export default function Wallet({ session }) {
  const userId = session?.user?.id || null;
  const navigate = useNavigate();
  const { walletEnabled, walletTestMode, walletMaxWithdrawalKobo, configLoading } = usePlatformConfig();
  const w = useWallet(userId, walletEnabled);
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("kt_balance_hidden") === "1");
  const [sheet, setSheet] = useState(null);   // "fund" | "withdraw" | null
  const [err, setErr] = useState("");

  const toggleHidden = () => {
    const n = !hidden; sessionStorage.setItem("kt_balance_hidden", n ? "1" : "0"); setHidden(n);
  };
  const activate = async () => {
    setErr("");
    try { await w.provisionAccount(); } catch (e) { setErr(e.message || "Could not activate wallet"); }
  };

  if (configLoading || w.loading) {
    return <div className="p-6 text-center text-slate-400 text-sm">Loading wallet…</div>;
  }
  if (!walletEnabled) {
    return (
      <div className="p-8 text-center">
        <Icon name="wallet" size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">The wallet isn't available yet.</p>
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* ── header ── */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <button onClick={() => navigate(-1)} className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800">
          <Icon name="chevron-left" size={20} className="text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="text-[17px] font-bold text-slate-800 dark:text-slate-100">Wallet</h1>
        {walletTestMode && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">TEST MODE</span>
        )}
      </div>

      <div className="px-4 space-y-4">
        {/* ── balance card ── */}
        <div className="rounded-3xl p-5 text-white relative overflow-hidden shadow-hero"
          style={{ background: "linear-gradient(145deg,var(--navy) 0%,var(--navy-mid) 55%,var(--navy-dark) 100%)" }}>
          <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5" />
          <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Wallet balance</p>
              <button onClick={toggleHidden} className="w-8 h-8 -mr-1 flex items-center justify-center rounded-lg bg-white/10 active:bg-white/20">
                <Icon name="eye" size={13} className="text-white" />
              </button>
            </div>
            <AmountDisplay amount={w.balanceKobo} fromKobo size="hero" align="left" hidden={hidden} className="mt-1.5 text-white" />
            {w.hasAccount && (
              <div className="mt-3 inline-flex items-center gap-2 bg-white/10 rounded-lg px-2.5 py-1.5">
                <span className="text-[12px] font-semibold tracking-wide">{w.wallet.flw_account_number}</span>
                <span className="text-white/40 text-[11px]">·</span>
                <span className="text-[11px] text-white/70">{w.wallet.flw_account_bank}</span>
              </div>
            )}
          </div>
        </div>

        {err && <p className="text-[12px] text-red-500">{err}</p>}

        {/* ── not activated ── */}
        {!w.hasAccount ? (
          <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/50 p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-900/25 flex items-center justify-center mx-auto mb-3">
              <Icon name="wallet" size={22} className="text-brand-600 dark:text-brand-400" />
            </div>
            <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 mb-1">Activate your wallet</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-4">
              Get a dedicated account number. Fund it once, then pay bills with no card fees.
            </p>
            <button onClick={activate} disabled={w.busy}
              className="w-full bg-brand-600 disabled:opacity-40 text-white font-bold rounded-xl py-3.5">
              {w.busy ? "Activating…" : "Activate wallet"}
            </button>
          </div>
        ) : (
          <>
            {/* ── quick actions ── */}
            <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/50 p-4">
              <div className="flex items-start gap-2">
                <ActionButton icon="plus"        label="Add money" onClick={() => setSheet("fund")} />
                <ActionButton icon="bank"        label="Withdraw"  onClick={() => setSheet("withdraw")} />
                <ActionButton icon="bills"       label="Pay bills" onClick={() => navigate("/bills")} tone="slate" />
              </div>
            </div>

            {/* ── transactions ── */}
            <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-card border border-slate-100 dark:border-slate-700/50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Transactions</p>
              {w.ledger.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-6 text-center">No wallet activity yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {w.ledger.map(row => <WalletTxRow key={row.id} row={row} hidden={hidden} />)}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <FundSheet open={sheet === "fund"} onClose={() => setSheet(null)}
        wallet={w.wallet} testMode={walletTestMode} api={w} />
      <WithdrawSheet open={sheet === "withdraw"} onClose={() => setSheet(null)}
        balanceKobo={w.balanceKobo} maxKobo={walletMaxWithdrawalKobo} api={w} onSubmitted={w.refresh} />
    </div>
  );
}
