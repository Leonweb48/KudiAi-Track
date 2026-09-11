import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Icon from "./Icon";
import TransactionPinModal from "./TransactionPinModal";
import BankSelect from "./shared/BankSelect";
import TransactionDetailModal from "./shared/TransactionDetailModal";
import { fmt, fmtDateTime } from "../utils/helpers";

// Locates the just-completed ledger row (by the withdrawal id the transfer
// action returns, or the payment-request id a "receive" resolved to) so the
// done/paid screen can open its receipt without leaving the sheet. Returns
// null while the row hasn't landed yet (realtime is normally instant, but
// this covers the gap) — callers retry a few times before giving up.
function findWithdrawalRow(api, withdrawalId) {
  const wd = api.withdrawals.find((w) => w.id === withdrawalId);
  if (!wd?.ledger_id) return null;
  return api.ledger.find((l) => l.id === wd.ledger_id) || null;
}
function findSaleRow(api, requestId) {
  const rq = api.requests.find((r) => r.id === requestId);
  if (!rq?.ledger_id) return null;
  return api.ledger.find((l) => l.id === rq.ledger_id) || null;
}

// Flutterwave returns e.g. "Flutterwave MFB (Formerly OK MFB)" — drop the aside.
export const cleanBankName = (n) =>
  String(n || "").replace(/\s*\((?:formerly|former|prev\.?|previously)[^)]*\)/i, "").trim() || "Flutterwave MFB";

// ── ledger row meta ────────────────────────────────────────────────────────
export const WALLET_SOURCE = {
  topup:               { label: "Wallet funding",     icon: "arrow-down", credit: true },
  sale:                { label: "Payment received",   icon: "arrow-down", credit: true },
  bill_reversal:       { label: "Bill refund",        icon: "arrow-down", credit: true },
  withdrawal_reversal: { label: "Transfer refund",    icon: "arrow-down", credit: true },
  bill_spend:          { label: "Bill payment",       icon: "bills",      credit: false },
  withdrawal:          { label: "Transfer",           icon: "send",       credit: false },
  adjustment:          { label: "Adjustment",         icon: "wallet",     credit: false },
};

// ── generic slide-up sheet ─────────────────────────────────────────────────
export function BottomSheet({ open, onClose, title, back, children }) {
  const [show, setShow] = useState(false);
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    let r1, tid;
    if (open) { setShow(true); r1 = requestAnimationFrame(() => (r1 = requestAnimationFrame(() => setAnim(true)))); }
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
        className={`fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[2px] transition-opacity duration-[260ms] ${anim ? "opacity-100" : "opacity-0"}`} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-50 bg-white dark:bg-slate-900 rounded-t-[28px] shadow-2xl border-t border-slate-100 dark:border-slate-800 px-5 pt-2.5 pb-[calc(28px+env(safe-area-inset-bottom,0px))] transition-transform duration-[260ms] ease-out ${anim ? "translate-y-0" : "translate-y-full"} max-h-[90vh] overflow-y-auto`}>
        <div className="w-9 h-1 rounded-full bg-slate-200 dark:bg-slate-700 mx-auto mb-3" />
        {(title || back) && (
          <div className="flex items-center gap-2 mb-4">
            {back && (
              <button onClick={back} className="w-8 h-8 -ml-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-800">
                <Icon name="chevron-left" size={18} className="text-slate-500 dark:text-slate-400" />
              </button>
            )}
            {title && <h3 className="text-[16px] font-extrabold text-slate-900 dark:text-slate-50">{title}</h3>}
          </div>
        )}
        {children}
      </div>
    </>
  );
}

const inputCls =
  "w-full mt-1.5 px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[16px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:bg-white dark:focus:bg-slate-800";
const labelCls = "text-[12px] font-semibold text-slate-500 dark:text-slate-400";
const primaryBtn =
  "w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:hover:bg-brand-600 text-white font-bold rounded-2xl py-4 text-[15px] transition-colors active:scale-[0.99]";

// ── quick-action circle ────────────────────────────────────────────────────
export function ActionButton({ icon, label, onClick, disabled, tone = "brand" }) {
  const ring = tone === "brand"
    ? "bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400"
    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex flex-col items-center gap-1.5 flex-1 min-w-0 disabled:opacity-40 active:scale-95 transition-transform">
      <span className={`w-[52px] h-[52px] rounded-2xl flex items-center justify-center ${ring}`}>
        <Icon name={icon} size={21} />
      </span>
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate max-w-full">{label}</span>
    </button>
  );
}

// ── account details card ───────────────────────────────────────────────────
export function AccountCard({ wallet }) {
  const [copied, setCopied] = useState(false);
  const acct = wallet?.flw_account_number || "";
  const bank = cleanBankName(wallet?.flw_account_bank);
  const copy = async () => {
    try { await navigator.clipboard.writeText(acct); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };
  const share = async () => {
    const text = `${wallet?.flw_account_name || "KudiAI Wallet"}\n${acct}\n${bank}`;
    try { if (navigator.share) await navigator.share({ title: "My account details", text }); else copy(); } catch {}
  };
  return (
    <div className="rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Account number</p>
        <span className="text-[10px] font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/30 px-2 py-0.5 rounded-full">NGN</span>
      </div>
      <p className="mt-1.5 text-[28px] leading-none font-extrabold tracking-[0.12em] text-slate-900 dark:text-slate-50 tabular-nums">{acct}</p>
      <p className="mt-2 text-[13px] font-semibold text-slate-600 dark:text-slate-300">{bank}</p>
      <p className="text-[12px] text-slate-400">{wallet?.flw_account_name}</p>
      <div className="mt-4 flex gap-2">
        <button onClick={copy}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-700/60 py-2.5 text-[13px] font-bold text-slate-700 dark:text-slate-200 active:scale-[0.98] transition-transform">
          <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
        </button>
        <button onClick={share}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-700/60 py-2.5 text-[13px] font-bold text-slate-700 dark:text-slate-200 active:scale-[0.98] transition-transform">
          <Icon name="send" size={14} /> Share
        </button>
      </div>
    </div>
  );
}

// ── transaction row ────────────────────────────────────────────────────────
export function WalletTxRow({ row, hidden, onOpen }) {
  const cfg = WALLET_SOURCE[row.source] || { label: row.source, icon: "wallet", credit: row.direction === "credit" };
  const credit = row.direction === "credit";
  const pending = row.status === "pending";
  const reversed = row.status === "reversed";
  return (
    <button type="button" onClick={onOpen ? () => onOpen(row) : undefined}
      className={`w-full flex items-center gap-3 py-3.5 text-left ${onOpen ? "active:bg-slate-50 dark:active:bg-slate-800/60 -mx-2 px-2 rounded-xl transition-colors" : ""}`}>
      <span className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
        credit ? "bg-emerald-50 dark:bg-emerald-900/25 text-emerald-600 dark:text-emerald-400"
               : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"}`}>
        <Icon name={cfg.icon} size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100 truncate">{cfg.label}</p>
        <p className="text-[11px] text-slate-400">{fmtDateTime(row.created_at)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-[14px] font-extrabold tabular-nums ${credit ? "text-emerald-600 dark:text-emerald-400" : "text-slate-800 dark:text-slate-200"} ${reversed ? "line-through opacity-60" : ""}`}>
          {hidden ? "••••" : <>{credit ? "+" : "−"}{fmt(row.amount_kobo / 100)}</>}
        </p>
        {pending && <p className="text-[10px] font-bold text-amber-500">Processing</p>}
        {reversed && <p className="text-[10px] font-bold text-slate-400">Reversed</p>}
      </div>
    </button>
  );
}

// ── searchable bank picker ─────────────────────────────────────────────────
export function BankPickerSheet({ open, onClose, banks, onPick }) {
  const [q, setQ] = useState("");
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const deduped = useMemo(() => {
    const seen = new Set();
    return [...banks]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((b) => { const k = b.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [banks]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return deduped.slice(0, 60);
    return deduped.filter((b) => b.name.toLowerCase().includes(s)).slice(0, 80);
  }, [deduped, q]);
  return (
    <BottomSheet open={open} onClose={onClose} title="Select bank">
      <div className="relative mb-2">
        <Icon name="eye" size={0} className="hidden" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search banks"
          className={inputCls + " mt-0 pl-11"} />
        <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
        </svg>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-1">
        {list.length === 0 && <p className="text-[13px] text-slate-400 py-8 text-center">No bank matches “{q}”.</p>}
        {list.map((b) => (
          <button key={b.id || b.code} onClick={() => { onPick(b); onClose(); }}
            className="w-full flex items-center gap-3 px-1 py-3.5 text-left active:bg-slate-50 dark:active:bg-slate-800 rounded-xl">
            <span className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 text-[12px] font-bold text-slate-500">
              {b.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="text-[14px] font-semibold text-slate-800 dark:text-slate-100 flex-1 truncate">{b.name}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

// ── Fund wallet ────────────────────────────────────────────────────────────
export function FundWalletSheet({ open, onClose, wallet, testMode, api }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const simulate = async () => {
    setBusy(true); setMsg("");
    try { await api.simulateTopup(2000); setMsg("Test top-up sent — your balance updates shortly."); }
    catch (e) { setMsg(e.message || "Failed"); } finally { setBusy(false); }
  };
  return (
    <BottomSheet open={open} onClose={onClose} title="Fund wallet">
      <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-4">
        Transfer from any bank to the account below. Your wallet is credited automatically —
        usually within a minute.
      </p>
      <AccountCard wallet={wallet} />
      {testMode && (
        <button onClick={simulate} disabled={busy}
          className="w-full mt-4 rounded-2xl border border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 text-[13px] font-bold py-3.5 disabled:opacity-40">
          {busy ? "Sending…" : "Simulate a ₦2,000 top-up (test)"}
        </button>
      )}
      {msg && <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-2 text-center">{msg}</p>}
    </BottomSheet>
  );
}

// ── Transfer — bank-transfer style, PIN-confirmed, instant ─────────────────
export function TransferSheet({ open, onClose, balanceKobo, maxKobo, banks, api, businessName, onDone }) {
  const [step, setStep] = useState("to");     // to | amount | review | pin | done
  const [acctNo, setAcctNo] = useState("");
  const [bank, setBank] = useState(null);
  const [name, setName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [manual, setManual] = useState(false);       // name service down → owner types the name
  const [manualName, setManualName] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [bookExpense, setBookExpense] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fee, setFee] = useState(0);
  const [wdId, setWdId] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const reqRef = useRef(0);       // guards against a stale lookup clobbering a newer one
  const doneKeyRef = useRef("");  // one lookup per unique (bank, account) pair

  useEffect(() => {
    if (open) return;
    setStep("to"); setAcctNo(""); setBank(null); setName(""); setAmount(""); setManual(false); setManualName("");
    setNarration(""); setBookExpense(false); setErr(""); setFee(0); setResolving(false);
    setWdId(""); setReceipt(null); setReceiptLoading(false);
    doneKeyRef.current = "";
  }, [open]);

  // Transfers post their ledger row before the edge call even returns
  // (the funds hold commits, then Flutterwave is called) — so realtime has
  // normally already delivered it. Retry a few times to cover the rare lag.
  const viewReceipt = async () => {
    setReceiptLoading(true);
    for (let i = 0; i < 6; i++) {
      const row = findWithdrawalRow(api, wdId);
      if (row) { setReceipt(api.receiptFor(row, businessName)); setReceiptLoading(false); return; }
      if (i === 2) api.refresh();
      await new Promise((r) => setTimeout(r, 500));
    }
    setReceiptLoading(false);
    setErr("Receipt isn't ready yet — find it in your wallet history in a moment.");
  };

  const runResolve = useCallback(async (code, acct) => {
    const id = ++reqRef.current;
    setName(""); setErr(""); setManual(false); setResolving(true);
    try {
      const d = await api.resolveAccount(code, acct);
      if (id !== reqRef.current) return;                 // a newer lookup started
      if (d?.account_name) setName(d.account_name);
      else setManual(true);
    } catch (e) {
      if (id !== reqRef.current) return;
      if (/verify right now|confirm the name|try again in a moment/i.test(e.message || "")) setManual(true);
      else setErr(e.message || "Couldn't verify that account");
    } finally {
      if (id === reqRef.current) setResolving(false);
    }
  }, [api]);

  // Auto-verify once per unique bank+account. Deps are primitives only, so this
  // never re-fires on an unrelated re-render.
  useEffect(() => {
    const digits = acctNo.replace(/\D/g, "");
    const key = bank?.code && digits.length === 10 ? `${bank.code}:${digits}` : "";
    if (!key || key === doneKeyRef.current) return;
    doneKeyRef.current = key;
    runResolve(bank.code, digits);
  }, [bank?.code, acctNo, runResolve]);

  const retryResolve = () => {
    const digits = acctNo.replace(/\D/g, "");
    if (bank?.code && digits.length === 10) { doneKeyRef.current = `${bank.code}:${digits}`; runResolve(bank.code, digits); }
  };

  const recipientName = name || (manual ? manualName.trim() : "");

  // Flutterwave ships the 700-bank list with several codes per bank (old CBN +
  // new NIP), and the "0000xx" ones don't resolve. Collapse to one entry per
  // bank, preferring a code that works.
  const bankList = useMemo(() => {
    const by = new Map();
    for (const b of banks || []) {
      if (!b?.code || !b?.name) continue;
      const k = b.name.trim().toLowerCase();
      const cur = by.get(k);
      const bad = /^0000\d\d$/.test(b.code);
      if (!cur || (/^0000\d\d$/.test(cur.code) && !bad)) by.set(k, b);
    }
    return [...by.values()];
  }, [banks]);

  const kobo = Math.round((parseFloat(amount) || 0) * 100);
  const cap = Math.min(balanceKobo, maxKobo);

  const doTransfer = async (pin) => {
    setBusy(true); setErr("");
    try {
      const r = await api.transfer(kobo, bank.code, acctNo.trim(), pin, narration.trim(), bookExpense, recipientName);
      setFee(Number(r?.fee_kobo || 0));
      setWdId(r?.withdrawal_id || "");
      setStep("done");
      onDone?.();
    } catch (e) {
      setErr(e.message || "Transfer failed");
      setStep("review");
    } finally { setBusy(false); }
  };

  return (
    <>
      <BottomSheet open={open && step !== "pin"} onClose={onClose}
        title={step === "done" ? "" : step === "review" ? "Confirm transfer" : "Transfer"}
        back={step === "amount" ? () => setStep("to") : step === "review" ? () => setStep("amount") : undefined}>

        {step === "done" ? (
          <div className="text-center py-3">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
              <Icon name="check" size={30} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">{fmt(kobo / 100)} sent</p>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">
              to <b>{recipientName}</b> · {bank?.name}
              {fee > 0 ? <><br />Fee {fmt(fee / 100)}</> : null}
            </p>
            {err && <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-3">{err}</p>}
            <button onClick={viewReceipt} disabled={receiptLoading}
              className="w-full mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3.5 text-[14px] disabled:opacity-50">
              {receiptLoading ? "Preparing receipt…" : "View receipt"}
            </button>
            <button onClick={onClose} className={primaryBtn + " mt-2.5"}>Done</button>
          </div>
        ) : step === "review" ? (
          <div>
            <div className="rounded-3xl bg-navy-500 text-white p-5 text-center"
              style={{ background: "linear-gradient(145deg,var(--navy) 0%,var(--navy-dark) 100%)" }}>
              <p className="text-[11px] uppercase tracking-widest text-white/50">You're sending</p>
              <p className="text-[34px] font-extrabold mt-1 tabular-nums">{fmt(kobo / 100)}</p>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 divide-y divide-slate-100 dark:divide-slate-800">
              {[["Recipient", recipientName], ["Account", acctNo], ["Bank", bank?.name],
                ["Narration", narration || "—"]].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-4 py-3">
                  <span className="text-[12px] text-slate-400">{k}</span>
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 text-right max-w-[62%] truncate">{v}</span>
                </div>
              ))}
            </div>
            {err && <p className="text-[12px] text-red-500 mt-3">{err}</p>}
            <button onClick={() => setStep("pin")} disabled={busy} className={primaryBtn + " mt-4"}>
              Transfer {fmt(kobo / 100)}
            </button>
          </div>
        ) : step === "amount" ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 flex items-center gap-3">
              <span className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 flex items-center justify-center text-[12px] font-bold">
                {(recipientName||"?").slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate">{recipientName}</p>
                <p className="text-[11px] text-slate-400">{acctNo} · {bank?.name}</p>
              </div>
            </div>
            <div>
              <label className={labelCls}>Amount</label>
              <input inputMode="decimal" autoFocus value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
              <p className="text-[11px] text-slate-400 mt-1.5">Available {fmt(balanceKobo / 100)} · up to {fmt(cap / 100)} per transfer</p>
            </div>
            <div>
              <label className={labelCls}>Narration <span className="text-slate-300 font-normal">optional</span></label>
              <input value={narration} onChange={(e) => setNarration(e.target.value.slice(0, 100))} placeholder="What's it for?" className={inputCls} />
            </div>
            <label className="flex items-center gap-2.5 text-[13px] font-medium text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={bookExpense} onChange={(e) => setBookExpense(e.target.checked)} className="w-[18px] h-[18px] rounded-md accent-brand-600" />
              Record as a business expense
            </label>
            {err && <p className="text-[12px] text-red-500">{err}</p>}
            <button disabled={kobo < 10000 || kobo > cap}
              onClick={() => { setErr(""); setStep("review"); }} className={primaryBtn}>
              Continue
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Account number</label>
              <input inputMode="numeric" autoFocus value={acctNo}
                onChange={(e) => { setAcctNo(e.target.value.replace(/\D/g, "").slice(0, 10)); setName(""); setManual(false); }}
                placeholder="0123456789" className={inputCls + " tracking-[0.15em]"} />
            </div>
            <div>
              <label className={labelCls}>Bank</label>
              <BankSelect
                banks={bankList}
                value={bank?.code || ""}
                onChange={(code, b) => { setBank(b); setName(""); setManual(false); setErr(""); doneKeyRef.current = ""; }}
                placeholder="Select bank"
                className="h-[52px] mt-1.5"
              />
            </div>
            {resolving && (
              <p className="text-[12px] text-slate-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" /> Verifying account…
              </p>
            )}
            {name && (
              <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/70 dark:border-emerald-800/50 px-4 py-3">
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide">Account name</p>
                <p className="text-[15px] font-extrabold text-emerald-800 dark:text-emerald-300">{name}</p>
              </div>
            )}
            {manual && !name && (
              <div>
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 mb-2">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Couldn't auto-verify the name right now. Enter the account holder's name — you're responsible for it being correct.
                  </p>
                </div>
                <label className={labelCls}>Account holder name</label>
                <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Full name on the account" className={inputCls} />
                <button onClick={retryResolve} className="text-[12px] font-bold text-brand-600 dark:text-brand-400 mt-2">Try verifying again</button>
              </div>
            )}
            {err && <p className="text-[12px] text-red-500">{err}</p>}
            <button disabled={!recipientName || (manual && !name && manualName.trim().length < 3)}
              onClick={() => { setErr(""); setStep("amount"); }} className={primaryBtn}>
              Continue
            </button>
          </div>
        )}
      </BottomSheet>

      {open && step === "pin" && (
        <TransactionPinModal
          title="Confirm transfer"
          amount={kobo}
          recipient={`${recipientName} · ${bank?.name}`}
          onApprove={(pin) => doTransfer(pin)}
          onCancel={() => setStep("review")}
        />
      )}

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

// ── Receive payment (customer pays into the wallet, booked as a sale) ──────
export function ReceivePaymentSheet({ open, onClose, wallet, payRequest, testMode, api, businessName }) {
  const [amount, setAmount] = useState("");
  const [customer, setCustomer] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [paid, setPaid] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const hadReq = useRef(false);
  const lastReqIdRef = useRef("");

  useEffect(() => {
    if (!open) { setAmount(""); setCustomer(""); setNote(""); setErr(""); setPaid(false); setReceipt(null); setReceiptLoading(false); hadReq.current = false; }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (payRequest) { hadReq.current = true; lastReqIdRef.current = payRequest.id; }
    else if (hadReq.current) { setPaid(true); hadReq.current = false; }
  }, [payRequest, open]);

  const viewReceipt = async () => {
    setReceiptLoading(true);
    for (let i = 0; i < 6; i++) {
      const row = findSaleRow(api, lastReqIdRef.current);
      if (row) { setReceipt(api.receiptFor(row, businessName)); setReceiptLoading(false); return; }
      if (i === 2) api.refresh();
      await new Promise((r) => setTimeout(r, 500));
    }
    setReceiptLoading(false);
    setErr("Receipt isn't ready yet — find it in your wallet history in a moment.");
  };

  const acct = wallet?.flw_account_number || "";
  const bank = cleanBankName(wallet?.flw_account_bank);
  const copy = () => { try { navigator.clipboard.writeText(acct); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  const reqAmt = payRequest ? payRequest.amount_kobo / 100 : 0;

  const create = async () => {
    setErr(""); setBusy(true);
    try { await api.createPaymentRequest(Math.round((parseFloat(amount) || 0) * 100), customer.trim(), note.trim()); }
    catch (e) { setErr(e.message || "Could not create request"); } finally { setBusy(false); }
  };
  const cancel = async () => { if (payRequest) await api.cancelPaymentRequest(payRequest.id); onClose(); };
  const simulate = async () => {
    setBusy(true);
    try { await api.simulateTopup(payRequest.amount_kobo / 100); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
    <BottomSheet open={open} onClose={onClose} title={paid ? "" : payRequest ? "Awaiting payment" : "Receive payment"}>
      {paid ? (
        <div className="text-center py-3">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <Icon name="check" size={30} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">Payment received</p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">In your wallet and recorded as a sale.</p>
          {err && <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-3">{err}</p>}
          <button onClick={viewReceipt} disabled={receiptLoading}
            className="w-full mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3.5 text-[14px] disabled:opacity-50">
            {receiptLoading ? "Preparing receipt…" : "View receipt"}
          </button>
          <button onClick={onClose} className={primaryBtn + " mt-2.5"}>Done</button>
        </div>
      ) : payRequest ? (
        <div>
          <div className="rounded-3xl bg-slate-50 dark:bg-slate-800 p-5 text-center">
            <p className="text-[11px] uppercase tracking-widest text-slate-400">Ask the customer to send exactly</p>
            <p className="text-[32px] font-extrabold text-slate-900 dark:text-slate-50 mt-1 tabular-nums">{fmt(reqAmt)}</p>
            <div className="mt-3 inline-flex items-center gap-2 bg-white dark:bg-slate-900 rounded-xl px-3 py-2">
              <span className="text-[15px] font-extrabold tracking-wider text-slate-800 dark:text-slate-100">{acct}</span>
              <button onClick={copy} className="text-[12px] font-bold text-brand-600 dark:text-brand-400">{copied ? "Copied" : "Copy"}</button>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1.5">{bank} · {wallet?.flw_account_name}</p>
            {payRequest.customer_name ? <p className="text-[12px] text-slate-400 mt-1">From {payRequest.customer_name}</p> : null}
          </div>
          <div className="flex items-center justify-center gap-2 mt-4 text-[12px] text-slate-400">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> Waiting for payment…
          </div>
          {testMode && (
            <button onClick={simulate} disabled={busy}
              className="w-full mt-3 rounded-2xl border border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 text-[13px] font-bold py-3.5 disabled:opacity-40">
              {busy ? "Simulating…" : "Simulate the customer's payment (test)"}
            </button>
          )}
          {err && <p className="text-[12px] text-red-500 mt-2 text-center">{err}</p>}
          <button onClick={cancel} className="w-full mt-3 text-[13px] font-semibold text-slate-400 py-2">Cancel request</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Create a request; when the customer pays it lands in your wallet and is booked as a sale.
          </p>
          <div>
            <label className={labelCls}>Amount</label>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Customer <span className="text-slate-300 font-normal">optional</span></label>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Note <span className="text-slate-300 font-normal">optional</span></label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's it for?" className={inputCls} />
          </div>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <button onClick={create} disabled={busy || (parseFloat(amount) || 0) < 100} className={primaryBtn}>
            {busy ? "Creating…" : "Request payment"}
          </button>
        </div>
      )}
    </BottomSheet>
    {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}
