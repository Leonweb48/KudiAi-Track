import { useState, useEffect, useCallback } from "react";
import Icon from "../components/Icon";
import Modal from "../components/shared/Modal";
import AmountDisplay from "../components/shared/AmountDisplay";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useWallet } from "../hooks/useWallet";
import { fmt, fmtDateTime } from "../utils/helpers";

const SOURCE_LABEL = {
  topup:                "Top-up",
  bill_spend:           "Bill payment",
  bill_reversal:        "Bill refund",
  withdrawal:           "Withdrawal",
  withdrawal_reversal:  "Withdrawal refund",
  adjustment:           "Adjustment",
};

function LedgerRow({ row }) {
  const credit = row.direction === "credit";
  const pending = row.status === "pending";
  const reversed = row.status === "reversed";
  return (
    <div className="flex items-center gap-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
        credit ? "bg-green-100 dark:bg-green-900/30" : "bg-slate-100 dark:bg-slate-800"}`}>
        <Icon name={credit ? "download" : "arrow"} size={16}
          className={credit ? "text-green-600 dark:text-green-400" : "text-slate-500 dark:text-slate-400"} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
          {SOURCE_LABEL[row.source] || row.source}
          {row.narration ? <span className="font-normal text-slate-400"> · {row.narration}</span> : null}
        </p>
        <p className="text-[11px] text-slate-400">{fmtDateTime(row.created_at)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-sm font-bold ${credit ? "text-green-600 dark:text-green-400" : "text-slate-700 dark:text-slate-200"} ${reversed ? "line-through opacity-60" : ""}`}>
          {credit ? "+" : "−"}{fmt(row.amount_kobo / 100)}
        </p>
        {pending  && <p className="text-[10px] font-semibold text-amber-500">Pending</p>}
        {reversed && <p className="text-[10px] font-semibold text-slate-400">Reversed</p>}
      </div>
    </div>
  );
}

function WithdrawModal({ onClose, balanceKobo, maxKobo, api, onSubmitted }) {
  const [step, setStep] = useState("form");           // form | done
  const [amount, setAmount] = useState("");
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState("");
  const [acctNo, setAcctNo] = useState("");
  const [acctName, setAcctName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { api.listBanks().then(d => setBanks(d?.banks || [])).catch(() => {}); }, []); // eslint-disable-line

  const resolve = useCallback(async () => {
    setAcctName(""); setErr("");
    if (!bankCode || acctNo.replace(/\D/g, "").length < 10) return;
    setResolving(true);
    try {
      const d = await api.resolveAccount(bankCode, acctNo.trim());
      setAcctName(d?.account_name || "");
      if (!d?.account_name) setErr("Could not verify that account");
    } catch (e) { setErr(e.message); } finally { setResolving(false); }
  }, [api, bankCode, acctNo]);

  const kobo = Math.round((parseFloat(amount) || 0) * 100);
  const canSubmit = kobo >= 10000 && kobo <= Math.min(balanceKobo, maxKobo) && bankCode && acctName && !busy;

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      await api.submitWithdrawal(kobo, bankCode, acctNo.trim());
      setStep("done");
      onSubmitted?.();
    } catch (e) { setErr(e.message || "Could not submit"); } finally { setBusy(false); }
  };

  return (
    <Modal title={step === "done" ? "Withdrawal submitted" : "Withdraw to bank"} onClose={onClose}>
      {step === "done" ? (
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-3">
            <Icon name="lock" size={24} className="text-amber-500" />
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Your withdrawal of <b>{fmt(kobo / 100)}</b> is awaiting admin approval. The funds are
            held and will be sent to <b>{acctName}</b> once approved — or returned to your wallet if declined.
          </p>
          <button onClick={onClose} className="mt-4 w-full bg-brand-600 text-white font-semibold rounded-xl py-3">Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">Amount</label>
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0" className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100" />
            <p className="text-[11px] text-slate-400 mt-1">
              Balance {fmt(balanceKobo / 100)} · max {fmt(Math.min(balanceKobo, maxKobo) / 100)} per withdrawal
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400">Bank</label>
            <select value={bankCode} onChange={e => { setBankCode(e.target.value); setAcctName(""); }}
              className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
              <option value="">Select bank…</option>
              {banks.map(b => <option key={b.id || b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Account number</label>
            <input inputMode="numeric" value={acctNo} onBlur={resolve}
              onChange={e => { setAcctNo(e.target.value.replace(/\D/g, "").slice(0, 10)); setAcctName(""); }}
              placeholder="0123456789" className="w-full mt-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100" />
            {resolving && <p className="text-[11px] text-slate-400 mt-1">Checking account…</p>}
            {acctName && <p className="text-[12px] font-semibold text-green-600 dark:text-green-400 mt-1">{acctName}</p>}
          </div>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <button onClick={submit} disabled={!canSubmit}
            className="w-full bg-brand-600 disabled:opacity-40 text-white font-semibold rounded-xl py-3">
            {busy ? "Submitting…" : "Submit withdrawal"}
          </button>
        </div>
      )}
    </Modal>
  );
}

export default function Wallet({ session }) {
  const userId = session?.user?.id || null;
  const { walletEnabled, walletTestMode, walletMaxWithdrawalKobo, configLoading } = usePlatformConfig();
  const w = useWallet(userId, walletEnabled);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  const doProvision = async () => {
    setErr("");
    try { await w.provisionAccount(); } catch (e) { setErr(e.message || "Could not activate wallet"); }
  };
  const doSimulate = async () => {
    setErr("");
    try { await w.simulateTopup(2000); } catch (e) { setErr(e.message || "Simulation failed"); }
  };
  const copy = () => {
    try { navigator.clipboard.writeText(w.wallet?.flw_account_number || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  if (configLoading || w.loading) {
    return <div className="p-6 text-center text-slate-400 text-sm">Loading wallet…</div>;
  }
  if (!walletEnabled) {
    return (
      <div className="p-6 text-center">
        <Icon name="wallet" size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">The wallet isn't available yet.</p>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 space-y-4">
      <div className="flex items-center gap-2">
        <Icon name="wallet" size={22} className="text-brand-600 dark:text-brand-400" />
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Wallet</h1>
      </div>

      {walletTestMode && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">⚠️ Test mode</p>
          <p className="text-[11px] text-amber-600 dark:text-amber-300/90 mt-0.5">
            This wallet is connected to a test system. <b>Do not transfer real money</b> to the account
            number below — a real transfer will bounce.
          </p>
        </div>
      )}

      {/* Balance */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white p-5 shadow-lg">
        <p className="text-[11px] uppercase tracking-widest text-white/60">Wallet balance</p>
        <AmountDisplay amount={w.balanceKobo} fromKobo size="hero" className="text-white mt-1" />
        {w.hasAccount && (
          <button onClick={() => setShowWithdraw(true)}
            className="mt-3 text-[12px] font-semibold bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5 transition-colors">
            Withdraw to bank
          </button>
        )}
      </div>

      {err && <p className="text-[12px] text-red-500">{err}</p>}

      {/* Fund / account details */}
      {!w.hasAccount ? (
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm p-4 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
            Activate your wallet to get a dedicated account number for funding.
          </p>
          <button onClick={doProvision} disabled={w.busy}
            className="w-full bg-brand-600 disabled:opacity-40 text-white font-semibold rounded-xl py-3">
            {w.busy ? "Activating…" : "Activate wallet"}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-widest text-slate-400">Fund your wallet</p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            Transfer to this account — it credits your wallet automatically.
          </p>
          <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900 rounded-xl px-3 py-2.5">
            <div>
              <p className="text-lg font-extrabold tracking-wide text-slate-800 dark:text-slate-100">{w.wallet.flw_account_number}</p>
              <p className="text-[11px] text-slate-400">{w.wallet.flw_account_bank} · {w.wallet.flw_account_name}</p>
            </div>
            <button onClick={copy} className="text-[12px] font-semibold text-brand-600 dark:text-brand-400">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {walletTestMode && (
            <button onClick={doSimulate} disabled={w.busy}
              className="w-full mt-1 text-[12px] font-semibold border border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 rounded-xl py-2.5 disabled:opacity-40">
              {w.busy ? "Simulating…" : "Simulate a ₦2,000 top-up"}
            </button>
          )}
        </div>
      )}

      {/* Ledger */}
      <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm p-4">
        <p className="text-[11px] uppercase tracking-widest text-slate-400 mb-1">Activity</p>
        {w.ledger.length === 0 ? (
          <p className="text-[13px] text-slate-400 py-4 text-center">No wallet activity yet.</p>
        ) : (
          w.ledger.map(row => <LedgerRow key={row.id} row={row} />)
        )}
      </div>

      {showWithdraw && (
        <WithdrawModal
          onClose={() => setShowWithdraw(false)}
          balanceKobo={w.balanceKobo}
          maxKobo={walletMaxWithdrawalKobo}
          api={w}
          onSubmitted={w.refresh}
        />
      )}
    </div>
  );
}
