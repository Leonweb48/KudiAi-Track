import { useState, useEffect, useCallback, useRef } from "react";
import Icon from "./Icon";
import { fmt, fmtDateTime } from "../utils/helpers";

// ── shared labels / helpers ─────────────────────────────────────────────────
export const WALLET_SOURCE = {
  topup:               { label: "Money in",          icon: "arrow-down", credit: true },
  sale:                { label: "Sale payment",      icon: "arrow-down", credit: true },
  bill_reversal:       { label: "Bill refund",       icon: "arrow-down", credit: true },
  withdrawal_reversal: { label: "Withdrawal refund", icon: "arrow-down", credit: true },
  bill_spend:          { label: "Bill payment",      icon: "bills",      credit: false },
  withdrawal:          { label: "Withdrawal",        icon: "bank",       credit: false },
  adjustment:          { label: "Adjustment",        icon: "wallet",     credit: false },
};

// ── generic slide-up sheet ─────────────────────────────────────────────────
export function BottomSheet({ open, onClose, title, children }) {
  const [show, setShow] = useState(false);
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    let r1, tid;
    if (open) { setShow(true); r1 = requestAnimationFrame(() => r1 = requestAnimationFrame(() => setAnim(true))); }
    else { setAnim(false); tid = setTimeout(() => setShow(false), 260); }
    return () => { cancelAnimationFrame(r1); clearTimeout(tid); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!show) return null;
  return (
    <>
      <div onClick={onClose} aria-hidden
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-[260ms] ${anim ? "opacity-100" : "opacity-0"}`} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-50 bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl border-t border-slate-100 dark:border-slate-800 px-5 pt-3 pb-[calc(28px+env(safe-area-inset-bottom,0px))] transition-transform duration-[260ms] ease-out ${anim ? "translate-y-0" : "translate-y-full"} max-h-[88vh] overflow-y-auto`}>
        <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700 mx-auto mb-4" />
        {title && <h3 className="text-[15px] font-bold text-slate-800 dark:text-slate-100 mb-4">{title}</h3>}
        {children}
      </div>
    </>
  );
}

// ── quick-action circle ────────────────────────────────────────────────────
export function ActionButton({ icon, label, onClick, disabled, tone = "brand" }) {
  const bg = tone === "brand"
    ? "bg-brand-50 dark:bg-brand-900/25 text-brand-600 dark:text-brand-400"
    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex flex-col items-center gap-1.5 flex-1 min-w-0 disabled:opacity-40 active:scale-95 transition-transform">
      <span className={`w-12 h-12 rounded-full flex items-center justify-center ${bg}`}>
        <Icon name={icon} size={20} />
      </span>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate max-w-full">{label}</span>
    </button>
  );
}

// ── transaction row ────────────────────────────────────────────────────────
export function WalletTxRow({ row, hidden }) {
  const cfg = WALLET_SOURCE[row.source] || { label: row.source, icon: "wallet", credit: row.direction === "credit" };
  const credit = row.direction === "credit";
  const pending = row.status === "pending";
  const reversed = row.status === "reversed";
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
        credit ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
               : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"}`}>
        <Icon name={cfg.icon} size={15} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{cfg.label}</p>
        <p className="text-[11px] text-slate-400">{fmtDateTime(row.created_at)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-[13px] font-bold ${credit ? "text-green-600 dark:text-green-400" : "text-slate-700 dark:text-slate-200"} ${reversed ? "line-through opacity-60" : ""}`}>
          {hidden ? "••••" : <>{credit ? "+" : "−"}{fmt(row.amount_kobo / 100)}</>}
        </p>
        {pending  && <p className="text-[10px] font-semibold text-amber-500">Pending</p>}
        {reversed && <p className="text-[10px] font-semibold text-slate-400">Reversed</p>}
      </div>
    </div>
  );
}

// ── Fund sheet — show the account to transfer into ─────────────────────────
export function FundSheet({ open, onClose, wallet, testMode, api }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const acct = wallet?.flw_account_number || "";
  const copy = () => { try { navigator.clipboard.writeText(acct); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  const simulate = async () => {
    setBusy(true); setMsg("");
    try { await api.simulateTopup(2000); setMsg("Test top-up sent — your balance updates in a few seconds."); }
    catch (e) { setMsg(e.message || "Simulation failed"); }
    finally { setBusy(false); }
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Add money">
      <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-3">
        Transfer to this account from any bank — your wallet is credited automatically.
      </p>
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Account number</p>
        <div className="flex items-center justify-between">
          <p className="text-2xl font-extrabold tracking-wider text-slate-800 dark:text-slate-100">{acct || "—"}</p>
          <button onClick={copy} className="flex items-center gap-1 text-[12px] font-bold text-brand-600 dark:text-brand-400">
            <Icon name="copy" size={13} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">
          {wallet?.flw_account_bank || "Bank"} · {wallet?.flw_account_name || ""}
        </p>
      </div>
      {testMode && (
        <>
          <button onClick={simulate} disabled={busy}
            className="w-full mt-3 rounded-xl border border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 text-[13px] font-bold py-3 disabled:opacity-40">
            {busy ? "Sending…" : "Simulate a ₦2,000 top-up (test)"}
          </button>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 text-center">
            Test mode — do not send real money to the number above.
          </p>
        </>
      )}
      {msg && <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-2 text-center">{msg}</p>}
    </BottomSheet>
  );
}

// ── Receive payment sheet — customer pays into the wallet, booked as a sale ─
export function ReceivePaymentSheet({ open, onClose, wallet, payRequest, testMode, api }) {
  const [amount, setAmount] = useState("");
  const [customer, setCustomer] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [paid, setPaid] = useState(false);
  const hadReq = useRef(false);

  useEffect(() => {
    if (!open) { setAmount(""); setCustomer(""); setNote(""); setErr(""); setPaid(false); hadReq.current = false; return; }
  }, [open]);

  // request appeared → remember it; request vanished while we had one → it was paid
  useEffect(() => {
    if (!open) return;
    if (payRequest) hadReq.current = true;
    else if (hadReq.current) { setPaid(true); hadReq.current = false; }
  }, [payRequest, open]);

  const acct = wallet?.flw_account_number || "";
  const copy = () => { try { navigator.clipboard.writeText(acct); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };

  const create = async () => {
    setErr(""); setBusy(true);
    try { await api.createPaymentRequest(Math.round((parseFloat(amount) || 0) * 100), customer.trim(), note.trim()); }
    catch (e) { setErr(e.message || "Could not create request"); }
    finally { setBusy(false); }
  };
  const cancel = async () => { if (payRequest) await api.cancelPaymentRequest(payRequest.id); onClose(); };
  const simulate = async () => {
    setBusy(true);
    try { await api.simulateTopup(payRequest.amount_kobo / 100); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const inputCls = "w-full mt-1 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[15px]";
  const reqAmt = payRequest ? payRequest.amount_kobo / 100 : 0;

  return (
    <BottomSheet open={open} onClose={onClose} title={paid ? "" : payRequest ? "Waiting for payment" : "Receive payment"}>
      {paid ? (
        <div className="text-center py-2">
          <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
            <Icon name="check" size={26} className="text-green-600 dark:text-green-400" />
          </div>
          <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100 mb-1">Payment received</p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            It's in your wallet and recorded as a sale in your books.
          </p>
          <button onClick={onClose} className="mt-4 w-full bg-brand-600 text-white font-bold rounded-xl py-3">Done</button>
        </div>
      ) : payRequest ? (
        <div>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-3">
            Ask the customer to transfer <b>exactly {fmt(reqAmt)}</b> to your wallet account.
            It's booked as a sale the moment it lands.
          </p>
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 p-4 text-center">
            <p className="text-3xl font-extrabold text-slate-800 dark:text-slate-100">{fmt(reqAmt)}</p>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="text-[15px] font-bold tracking-wider text-slate-700 dark:text-slate-200">{acct}</span>
              <button onClick={copy} className="flex items-center gap-1 text-[12px] font-bold text-brand-600 dark:text-brand-400">
                <Icon name="copy" size={12} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
              {wallet?.flw_account_bank} · {wallet?.flw_account_name}
            </p>
            {payRequest.customer_name ? <p className="text-[12px] text-slate-400 mt-1">From {payRequest.customer_name}</p> : null}
          </div>
          <div className="flex items-center justify-center gap-2 mt-4 text-[12px] text-slate-400">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> Waiting for payment…
          </div>
          {testMode && (
            <button onClick={simulate} disabled={busy}
              className="w-full mt-3 rounded-xl border border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 text-[13px] font-bold py-3 disabled:opacity-40">
              {busy ? "Simulating…" : "Simulate the customer's payment (test)"}
            </button>
          )}
          {err && <p className="text-[12px] text-red-500 mt-2 text-center">{err}</p>}
          <button onClick={cancel} className="w-full mt-3 text-[13px] font-semibold text-slate-400 py-2">Cancel request</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Create a request; the customer transfers the amount to your wallet account and it's recorded as a sale.
          </p>
          <div>
            <label className="text-[12px] text-slate-400">Amount</label>
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="text-[12px] text-slate-400">Customer <span className="text-slate-300">(optional)</span></label>
            <input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Name" className={inputCls} />
          </div>
          <div>
            <label className="text-[12px] text-slate-400">Note <span className="text-slate-300">(optional)</span></label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="What's it for?" className={inputCls} />
          </div>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <button onClick={create} disabled={busy || (parseFloat(amount) || 0) < 100}
            className="w-full bg-brand-600 disabled:opacity-40 text-white font-bold rounded-xl py-3.5">
            {busy ? "Creating…" : "Request payment"}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

// ── Withdraw sheet ────────────────────────────────────────────────────────
export function WithdrawSheet({ open, onClose, balanceKobo, maxKobo, api, onSubmitted }) {
  const [step, setStep] = useState("form");
  const [amount, setAmount] = useState("");
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState("");
  const [acctNo, setAcctNo] = useState("");
  const [acctName, setAcctName] = useState("");
  const [narration, setNarration] = useState("");
  const [bookExpense, setBookExpense] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    api.listBanks().then(d => setBanks(d?.banks || [])).catch(() => {});
  }, [open, api]);

  useEffect(() => { if (!open) { setStep("form"); setAmount(""); setBankCode(""); setAcctNo(""); setAcctName(""); setNarration(""); setBookExpense(false); setErr(""); } }, [open]);

  const resolve = useCallback(async () => {
    setAcctName(""); setErr("");
    if (!bankCode || acctNo.replace(/\D/g, "").length < 10) return;
    setResolving(true);
    try {
      const d = await api.resolveAccount(bankCode, acctNo.trim());
      setAcctName(d?.account_name || "");
      if (!d?.account_name) setErr("Couldn't verify that account number");
    } catch (e) { setErr(e.message); } finally { setResolving(false); }
  }, [api, bankCode, acctNo]);

  const kobo = Math.round((parseFloat(amount) || 0) * 100);
  const cap = Math.min(balanceKobo, maxKobo);
  const canSubmit = kobo >= 10000 && kobo <= cap && bankCode && acctName && !busy;

  const submit = async () => {
    setErr(""); setBusy(true);
    try { await api.submitWithdrawal(kobo, bankCode, acctNo.trim(), narration.trim(), bookExpense); setStep("done"); onSubmitted?.(); }
    catch (e) { setErr(e.message || "Could not submit"); }
    finally { setBusy(false); }
  };

  const inputCls = "w-full mt-1 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[15px]";

  return (
    <BottomSheet open={open} onClose={onClose} title={step === "done" ? "" : "Send money"}>
      {step === "done" ? (
        <div className="text-center py-2">
          <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-3">
            <Icon name="clock" size={24} className="text-amber-500" />
          </div>
          <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100 mb-1">Transfer submitted</p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            {fmt(kobo / 100)} to <b>{acctName}</b> is awaiting admin approval. The amount is held and
            will be sent once approved — or returned to your wallet if declined.
          </p>
          <button onClick={onClose} className="mt-4 w-full bg-brand-600 text-white font-bold rounded-xl py-3">Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Send to any Nigerian bank account. Every transfer is confirmed by an admin before it goes out.
          </p>
          <div>
            <label className="text-[12px] text-slate-400">Amount</label>
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
            <p className="text-[11px] text-slate-400 mt-1">Balance {fmt(balanceKobo / 100)} · up to {fmt(cap / 100)} per transfer</p>
          </div>
          <div>
            <label className="text-[12px] text-slate-400">Bank</label>
            <select value={bankCode} onChange={e => { setBankCode(e.target.value); setAcctName(""); }} className={inputCls}>
              <option value="">Select bank…</option>
              {banks.map(b => <option key={b.id || b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[12px] text-slate-400">Account number</label>
            <input inputMode="numeric" value={acctNo} onBlur={resolve}
              onChange={e => { setAcctNo(e.target.value.replace(/\D/g, "").slice(0, 10)); setAcctName(""); }}
              placeholder="0123456789" className={inputCls} />
            {resolving && <p className="text-[11px] text-slate-400 mt-1">Checking…</p>}
            {acctName && <p className="text-[13px] font-bold text-green-600 dark:text-green-400 mt-1">{acctName}</p>}
          </div>
          <div>
            <label className="text-[12px] text-slate-400">Narration <span className="text-slate-300">(optional)</span></label>
            <input value={narration} onChange={e => setNarration(e.target.value.slice(0, 100))} placeholder="What's it for?" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={bookExpense} onChange={e => setBookExpense(e.target.checked)} className="w-4 h-4 rounded" />
            Record this as a business expense
          </label>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <button onClick={submit} disabled={!canSubmit} className="w-full bg-brand-600 disabled:opacity-40 text-white font-bold rounded-xl py-3.5">
            {busy ? "Submitting…" : "Send money"}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
