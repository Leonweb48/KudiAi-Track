import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Icon from "./Icon";
import GlassIcon, { GLASS } from "./GlassIcon";
import TransactionPinModal from "./TransactionPinModal";
import BankSelect from "./shared/BankSelect";
import BankLogo from "./shared/BankLogo";
import NetworkBars from "./shared/NetworkBars";
import { displayBankName, cleanBankName } from "../utils/bankLogos";
import { parseCopiedAccount } from "../utils/accountDetect";
import { readClipboardText } from "../utils/clipboard";
import TransactionDetailModal from "./shared/TransactionDetailModal";
import { fmt } from "../utils/helpers";
import { WALLET_SOURCE } from "../utils/walletSources";
import { walletEntry } from "../utils/historyEntries";
import { formatWATStamp } from "../utils/wat";
import { HistoryAvatar, StatusPill } from "./shared/HistoryRow";
import { hapticSuccess } from "../utils/haptics";
import { supabase } from "../utils/supabase";
import SelfieCapture from "./SelfieCapture";
import { submitSecuritySelfie } from "../utils/securitySelfie";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { useT, tNow } from "../contexts/LanguageContext";
import {
  getBeneficiaries, saveBeneficiary, upsertRemote, syncLocalToRemote,
  fetchAllRemote, benDisplayName, benSubLabel, deleteBeneficiaryMatch, deleteRemote,
} from "../utils/billBeneficiaries";

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

// Flutterwave returns e.g. "Flutterwave MFB (Formerly OK MFB)" — the aside is dropped (utils/bankLogos.js).
export { cleanBankName };

// ── ledger row meta ────────────────────────────────────────────────────────
// The label / icon table lives in utils/walletSources.js (the history logic uses it too); re-exported for existing importers.
export { WALLET_SOURCE };

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

// Labels for the transfer review rows (the English row name stays the row's id)
const REVIEW_ROW_LABEL = {
  Recipient: "walletpanel.rowRecipient", Account: "walletpanel.rowAccount", Bank: "walletpanel.rowBank",
  Narration: "walletpanel.rowNarration", Fee: "walletpanel.rowFee", VAT: "walletpanel.rowVat", "Stamp duty": "walletpanel.rowStampDuty",
  "Total debit": "walletpanel.rowTotalDebit", Repeats: "walletpanel.rowRepeats",
};

const inputCls =
  "w-full mt-1.5 px-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-900 dark:text-slate-50 text-[16px] font-semibold placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:border-brand-400 focus:bg-white dark:focus:bg-slate-800";
const labelCls = "text-[12px] font-semibold text-slate-500 dark:text-slate-400";
const primaryBtn =
  "w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:hover:bg-brand-600 text-white font-bold rounded-2xl py-4 text-[15px] transition-colors active:scale-[0.99]";

// ── Raised "3D" mini-action button (Fund/Transfer/Receive/Bills on a wallet hero) ──
// Shared between the owner Home hero and the Ajo member portal hero.
function MiniSvg({ d, size = 14, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
export const WALLET_MINI_ICONS = {
  in:      "M12 19V5|M5 12l7-7 7 7",
  out:     "M12 5v14|M19 12l-7 7-7-7",
  invoice: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
};
export function WalletMiniAction({ onClick, d, label }) {
  return (
    <button onClick={onClick}
      className="flex-1 rounded-2xl py-2.5 flex flex-col items-center gap-1 border transition-all duration-100 active:translate-y-[1.5px]"
      style={{
        background: "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.10) 100%)",
        borderColor: "rgba(255,255,255,0.18)",
        boxShadow: "0 2px 0 rgba(0,0,0,0.20), 0 5px 10px -3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
      }}
      onMouseDown={(e) => { e.currentTarget.style.boxShadow = "0 0 0 rgba(0,0,0,0.2), inset 0 1px 3px rgba(0,0,0,0.25)"; }}
      onMouseUp={(e) => { e.currentTarget.style.boxShadow = "0 2px 0 rgba(0,0,0,0.20), 0 5px 10px -3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)"; }}
    >
      <MiniSvg d={d} size={14} color="white" />
      <span className="text-[9.5px] font-bold text-white/90">{label}</span>
    </button>
  );
}

// ── quick-action circle ────────────────────────────────────────────────────
// Each action keeps its own colour so the row reads at a glance (iOS-style glass tiles).
const ACTION_GLASS = { plus: GLASS.brand, send: GLASS.blue, "arrow-down": GLASS.teal, bills: GLASS.amber, card: GLASS.violet };

export function ActionButton({ icon, label, onClick, disabled, tone = "brand", badge }) {
  const colors = ACTION_GLASS[icon] || (tone === "brand" ? GLASS.brand : GLASS.slate);
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="relative flex flex-col items-center gap-1.5 flex-1 min-w-0 disabled:opacity-60 active:scale-95 transition-transform">
      {badge && (
        <span className="absolute z-10 -top-1 right-1.5 text-[8px] font-extrabold uppercase tracking-wide px-1.5 py-[1px] rounded-full bg-slate-700 dark:bg-slate-600 text-white">
          {badge}
        </span>
      )}
      <GlassIcon name={icon} colors={colors} size={52} iconSize={22} />
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate max-w-full">{label}</span>
    </button>
  );
}

// ── account details card ───────────────────────────────────────────────────
// Never render the raw bank-registered name (wallet.flw_account_name) —
// it's tied to BVN/KYC and Flutterwave/NIBSS don't reliably echo back what
// we submit at provisioning: some wallets come back as our own
// "KudiAI Wallet - {name}" narration, others come back as Flutterwave's own
// generated name (their "{merchant name}/{customer name}" convention),
// which can surface someone else's real name in our own UI. Always build
// the label ourselves from the current holder's own name instead, so every
// wallet is consistently branded regardless of what the processor stored.
export function AccountCard({ wallet, displayName }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const acct = wallet?.flw_account_number || "";
  const bank = cleanBankName(wallet?.flw_account_bank);
  const name = `KudiAI Wallet - ${displayName || "Account"}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(acct); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };
  const share = async () => {
    const text = `${name}\n${acct}\n${bank}`;
    try { if (navigator.share) await navigator.share({ title: "My account details", text }); else copy(); } catch {}
  };
  // The platform has moved to a new banking account and the grace period for this (old) number is over: deposits to it
  // no longer credit the wallet, so never present it as somewhere to send money (see utils/walletAccount.js).
  if (wallet?.account_state === "retired") {
    return (
      <div className="rounded-3xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-red-500">{t("walletpanel.accountNumber")}</p>
        <p className="mt-1.5 text-[13px] font-bold text-red-700 dark:text-red-300">{t("walletpanel.retiredTitle")}</p>
        <p className="mt-1 text-[12px] text-red-600 dark:text-red-400 leading-relaxed">{t("walletpanel.retiredBody")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("walletpanel.accountNumber")}</p>
        <span className="text-[10px] font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/30 px-2 py-0.5 rounded-full">NGN</span>
      </div>
      <p className="mt-1.5 text-[28px] leading-none font-extrabold tracking-[0.12em] text-slate-900 dark:text-slate-50 tabular-nums">{acct}</p>
      <p className="mt-2 text-[13px] font-semibold text-slate-600 dark:text-slate-300">{bank}</p>
      <p className="text-[12px] text-slate-400">{name}</p>
      <div className="mt-4 flex gap-2">
        <button onClick={copy}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-700/60 py-2.5 text-[13px] font-bold text-slate-700 dark:text-slate-200 active:scale-[0.98] transition-transform">
          <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? t("walletpanel.copied") : t("walletpanel.copy")}
        </button>
        <button onClick={share}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-700/60 py-2.5 text-[13px] font-bold text-slate-700 dark:text-slate-200 active:scale-[0.98] transition-transform">
          <Icon name="send" size={14} /> {t("walletpanel.share")}
        </button>
      </div>
    </div>
  );
}

// ── transaction row ────────────────────────────────────────────────────────
// OPay-style: the bank's / provider's logo (or an icon) on the left, "Transfer to NAME" and its time, the signed amount and a status pill.
// `entry` is the row's history entry from useWallet().entryFor(row) — it knows the recipient / sender and their bank. Without it the row
// still renders from the ledger row alone (a generic title and icon).
export function WalletTxRow({ row, hidden, onOpen, entry }) {
  const t = useT();
  const e = entry || walletEntry(row, {});
  const credit = row.direction === "credit";
  const reversed = row.status === "reversed";
  return (
    <button type="button" onClick={onOpen ? () => onOpen(row) : undefined}
      className={`w-full flex items-center gap-3 py-3 text-left ${onOpen ? "active:bg-slate-50 dark:active:bg-slate-800/60 -mx-2 px-2 rounded-xl transition-colors" : ""}`}>
      <HistoryAvatar avatar={e.avatar} />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 truncate">{txTitle(e.title, row.source, t)}</p>
        <p className="text-[11.5px] text-slate-400 mt-0.5">{formatWATStamp(row.created_at)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-[15px] font-bold tabular-nums ${credit ? "text-emerald-600 dark:text-emerald-400" : "text-slate-800 dark:text-slate-200"} ${reversed ? "line-through opacity-60" : ""}`}>
          {hidden ? "••••" : <>{credit ? "+" : "−"}{fmt(row.amount_kobo / 100)}</>}
        </p>
        <StatusPill status={e.status} className="mt-1" />
      </div>
    </button>
  );
}

// The row title, in the chosen language. walletEntry builds it in English (the stored source's label, or
// "Transfer to NAME" etc.); only those known shapes are translated — anything else (a bill narration) is shown as-is.
function txTitle(title, source, t) {
  const label = WALLET_SOURCE[source]?.label;
  if (label && title === label) {
    const key = `walletpanel.source.${source}`;
    const v = t(key);
    return v === key ? title : v;
  }
  let m;
  if (source === "withdrawal" && (m = /^Transfer to (.+)$/.exec(title || ""))) return t("walletpanel.txTransferTo", { name: m[1] });
  if (source === "sale" && (m = /^Payment from (.+)$/.exec(title || ""))) return t("walletpanel.txPaymentFrom", { name: m[1] });
  if (source === "topup" && (m = /^Transfer from (.+)$/.exec(title || ""))) return t("walletpanel.txTransferFrom", { name: m[1] });
  if (source === "bill_reversal" && (m = /^Refund: (.+)$/.exec(title || ""))) return t("walletpanel.txRefund", { name: m[1] });
  return title;
}

// ── searchable bank picker ─────────────────────────────────────────────────
export function BankPickerSheet({ open, onClose, banks, onPick }) {
  const t = useT();
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
    <BottomSheet open={open} onClose={onClose} title={t("walletpanel.selectBank")}>
      <div className="relative mb-2">
        <Icon name="eye" size={0} className="hidden" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("walletpanel.searchBanks")}
          className={inputCls + " mt-0 pl-11"} />
        <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
        </svg>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-1">
        {list.length === 0 && <p className="text-[13px] text-slate-400 py-8 text-center">{t("walletpanel.noBankMatch", { q })}</p>}
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
// A poster on a wall: the icon for the business-poster maker (Home, Finance Tools and here)
export const POSTER_ICON = "M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z|M8 7h8|M8 11h8|M8 15h4|M15 15h1";
// The business deposit fee (Terms 4.10(a), every business plan since 19 Oct 2026): shown where a business shares its account number. Nothing for
// Ajo clients or personal wallets (their deposits are free) — the server decides (wallet_deposit_fee_quote).
const longDate = (d) => { try { return new Date(`${d}T12:00:00`).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }); } catch { return d; } };
export function DepositFeeNote({ open }) {
  const t = useT();
  const [rule, setRule] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    supabase.rpc("wallet_deposit_fee_quote").then(({ data, error }) => { if (live && !error && data) setRule(data); });
    return () => { live = false; };
  }, [open]);
  const pct = Number(rule?.pct || 0), cap = Number(rule?.cap_kobo || 0);
  if (!rule || rule.tier === "personal" || pct <= 0 || cap <= 0) return null;
  const fee = t("walletpanel.depositFeeAmount", { pct, max: (cap / 100).toLocaleString("en-NG") });
  return (
    <p className="mt-3 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
      {rule.active
        ? <>{t("walletpanel.depositFeeActivePre")}<b>{fee}</b>{t("walletpanel.depositFeeActivePost")}</>
        : <>{t("walletpanel.depositFeeFuturePre")}<b>{longDate(rule.starts)}</b>{t("walletpanel.depositFeeFutureMid")}<b>{fee}</b>{t("walletpanel.depositFeeFuturePost")}</>}
    </p>
  );
}

// onPoster (business owners only): a button under the account card that opens the payment-poster maker (PosterStudio).
export function FundWalletSheet({ open, onClose, wallet, testMode, api, businessName, ownerName, onPoster }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const simulate = async () => {
    setBusy(true); setMsg("");
    try { await api.simulateTopup(2000); setMsg(t("walletpanel.testTopupSent")); }
    catch (e) { setMsg(e.message || t("walletpanel.failed")); } finally { setBusy(false); }
  };
  return (
    <BottomSheet open={open} onClose={onClose} title={t("walletpanel.fundWallet")}>
      {wallet?.account_state !== "retired" && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-4">
          {t("walletpanel.fundIntro")}
        </p>
      )}
      <AccountCard wallet={wallet} displayName={businessName || ownerName} />
      {onPoster && wallet?.account_state !== "retired" && wallet?.flw_account_number && (
        <button onClick={onPoster}
          className="w-full mt-3 flex items-center gap-3 rounded-2xl border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/20 px-4 py-3 text-left active:scale-[0.99] transition-transform">
          <GlassIcon d={POSTER_ICON} colors={GLASS.brand} size={36} iconSize={16} />
          <span className="flex-1 min-w-0">
            <span className="block text-[13.5px] font-extrabold text-brand-800 dark:text-brand-200">{t("posters.fundBtn")}</span>
            <span className="block text-[11.5px] text-brand-700/80 dark:text-brand-300/80">{t("posters.homeSub")}</span>
          </span>
          <Icon name="chevron-right" size={16} className="text-brand-600" />
        </button>
      )}
      {wallet?.account_state !== "retired" && <DepositFeeNote open={open} />}
      {testMode && wallet?.account_state !== "retired" && (
        <button onClick={simulate} disabled={busy}
          className="w-full mt-4 rounded-2xl border border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 text-[13px] font-bold py-3.5 disabled:opacity-40">
          {busy ? t("walletpanel.sending") : t("walletpanel.simulateTopup")}
        </button>
      )}
      {msg && <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-2 text-center">{msg}</p>}
    </BottomSheet>
  );
}

// ── Transfer — bank-transfer style, PIN-confirmed, instant ─────────────────
export function TransferSheet({ open, onClose, balanceKobo, maxKobo, dailyCapKobo = 0, dailyUsedKobo = 0, banks, api, businessName, ownerName, ownerId, onDone }) {
  const t = useT();
  const { largeTransferSelfieThresholdKobo, securitySelfieEnabled } = usePlatformConfig();
  const [step, setStep] = useState("to");     // to | amount | review | pin | selfie | done
  const [pendingPin, setPendingPin] = useState("");   // held between the PIN step and a required selfie step, for a large transfer
  const [selfie, setSelfie] = useState("");
  const [selfieBusy, setSelfieBusy] = useState(false);
  const [selfieErr, setSelfieErr] = useState("");
  const [acctNo, setAcctNo] = useState("");
  const [bank, setBank] = useState(null);
  const [name, setName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [manual, setManual] = useState(false);       // name service down → owner types the name
  const [manualName, setManualName] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");
  const [bookExpense, setBookExpense] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState("monthly");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fee, setFee] = useState(0);
  const [wdId, setWdId] = useState("");
  const [savedRecipients, setSavedRecipients] = useState(() => getBeneficiaries("bank_transfer"));
  // Saving a recipient is the person's choice (2026-10-14) — never automatic. Ticked on the review step (with an
  // optional nickname) or saved afterwards from the success screen; removable from the list.
  const [saveBen, setSaveBen] = useState(false);
  const [benNick, setBenNick] = useState("");
  const [benSaved, setBenSaved] = useState(false);
  const [manageBens, setManageBens] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const reqRef = useRef(0);       // guards against a stale lookup clobbering a newer one
  const doneKeyRef = useRef("");  // one lookup per unique (bank, account) pair
  // Copied account number + bank suggestions + bank network strength (2026-10-02)
  const [clip, setClip] = useState(null);             // { text, account } — an account number found on the clipboard, offered once
  const [suggests, setSuggests] = useState(null);     // banks where this account exists: [{ code, bank_name, account_name }]
  const [suggesting, setSuggesting] = useState(false);
  const [network, setNetwork] = useState({ banks: {}, overall: "unknown" });
  const suggestReqRef = useRef(0);

  useEffect(() => {
    if (open) return;
    setStep("to"); setAcctNo(""); setBank(null); setName(""); setAmount(""); setManual(false); setManualName("");
    setNarration(""); setBookExpense(false); setRepeat(false); setFrequency("monthly"); setErr(""); setFee(0); setResolving(false);
    setWdId(""); setReceipt(null); setReceiptLoading(false);
    setSaveBen(false); setBenNick(""); setBenSaved(false); setManageBens(false);
    setPendingPin(""); setSelfie(""); setSelfieBusy(false); setSelfieErr("");
    setClip(null); setSuggests(null); setSuggesting(false); suggestReqRef.current++;
    doneKeyRef.current = "";
  }, [open]);

  // Saved recipients — same offline-first + remote-sync mechanism Bills
  // already uses, just a different category. Refresh whenever the sheet
  // opens so a recipient saved on another device shows up too.
  useEffect(() => {
    if (!open || !ownerId) return;
    syncLocalToRemote(supabase, ownerId).then(() => fetchAllRemote(supabase, ownerId)).then((all) => {
      setSavedRecipients(all.filter((b) => b.cat === "bank_transfer"));
    });
  }, [open, ownerId]);

  const saveRecipient = () => {
    const benForm = { accountNo: acctNo.trim(), bankCode: bank.code, bankName: bank.name, nickname: benNick.trim() };
    saveBeneficiary("bank_transfer", benForm, recipientName);
    if (ownerId) upsertRemote(supabase, ownerId, "bank_transfer", benForm, recipientName).catch(() => {});
    setSavedRecipients((list) => [
      { id: `local-${benForm.bankCode}-${benForm.accountNo}`, cat: "bank_transfer", ...benForm, verifyName: recipientName },
      ...list.filter((b) => !(b.bankCode === benForm.bankCode && b.accountNo === benForm.accountNo)),
    ]);
    setBenSaved(true);
  };

  const removeRecipient = (ben) => {
    deleteBeneficiaryMatch("bank_transfer", ben);
    if (ownerId && ben.id && !String(ben.id).startsWith("local-") && !String(ben.id).startsWith("ben_")) deleteRemote(supabase, ben.id).catch(() => {});
    setSavedRecipients((list) => list.filter((b) => b !== ben));
  };

  const pickSavedRecipient = (ben) => {
    setAcctNo(ben.accountNo);
    setBank({ code: ben.bankCode, name: ben.bankName });
    setName(ben.verifyName || "");
    setManual(false);
    doneKeyRef.current = ""; // force the auto-verify effect to re-resolve, never trust a stored name
  };

  // Transfers post their ledger row before the edge call even returns
  // (the funds hold commits, then Flutterwave is called) — so realtime has
  // normally already delivered it. Retry a few times to cover the rare lag.
  const viewReceipt = async () => {
    setReceiptLoading(true);
    for (let i = 0; i < 6; i++) {
      const row = findWithdrawalRow(api, wdId);
      if (row) { setReceipt(api.receiptFor(row, businessName, ownerName)); setReceiptLoading(false); return; }
      if (i === 2) api.refresh();
      await new Promise((r) => setTimeout(r, 500));
    }
    setReceiptLoading(false);
    setErr(t("walletpanel.receiptNotReady"));
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
      else setErr(e.message || tNow("walletpanel.couldNotVerify"));
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

  // Network strength per bank (signal bars + warnings), fetched each time the sheet opens. The two lookups are stable
  // callbacks — depend on them, not on `api`, which changes with every balance update.
  const { bankNetwork, suggestBanks } = api;
  useEffect(() => {
    if (!open || !bankNetwork) return;
    let cancelled = false;
    bankNetwork().then((d) => { if (!cancelled && d) setNetwork({ banks: d.banks || {}, overall: d.overall || "unknown" }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, bankNetwork]);
  const netByCode = useMemo(() => Object.fromEntries(Object.entries(network.banks || {}).map(([c, v]) => [c, v?.status])), [network]);

  // Copied an account number before opening the sheet? Offer it once (per copied number, per session).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    readClipboardText().then((text) => {
      if (cancelled || !text) return;
      const { account } = parseCopiedAccount(text, []);
      if (!account) return;
      let seen = "";
      try { seen = sessionStorage.getItem("kdt_clip_offered") || ""; } catch { /* storage blocked */ }
      if (seen === account) return;
      try { sessionStorage.setItem("kdt_clip_offered", account); } catch { /* storage blocked */ }
      setClip({ text, account });
    });
    return () => { cancelled = true; };
  }, [open]);
  const clipBank = useMemo(() => (clip ? parseCopiedAccount(clip.text, bankList).bank : null), [clip, bankList]);

  // Put an account number (and the bank, when the text names one) from copied / pasted text into the form.
  const applyAccount = (text) => {
    const { account, bank: named } = parseCopiedAccount(text, bankList);
    if (!account) return false;
    setClip(null); setErr(""); setName(""); setManual(false); setSuggests(null);
    setAcctNo(account);
    if (named) { setBank(named); doneKeyRef.current = ""; }
    return true;
  };
  const pasteFromClipboard = async () => {
    const text = await readClipboardText({ userGesture: true });
    if (!text) { setErr(t("walletpanel.pasteUnreadable")); return; }
    if (!applyAccount(text)) setErr(t("walletpanel.pasteNoAccount"));
  };

  // No bank chosen yet for a full account number → a saved recipient with that number picks its bank straight away;
  // otherwise ask the server which banks have this account (it checks the name at each likely bank).
  useEffect(() => {
    const digits = acctNo.replace(/\D/g, "");
    if (!open || step !== "to" || bank?.code || digits.length !== 10 || !suggestBanks) {
      suggestReqRef.current++; setSuggesting(false);
      return;
    }
    const saved = savedRecipients.find((b) => b.accountNo === digits && b.bankCode);
    if (saved) { doneKeyRef.current = ""; setBank({ code: saved.bankCode, name: saved.bankName }); return; }
    const id = ++suggestReqRef.current;
    setSuggesting(true); setSuggests(null);
    const t = setTimeout(() => {
      suggestBanks(digits)
        .then((d) => { if (id === suggestReqRef.current) setSuggests(d?.matches || []); })
        .catch(() => { if (id === suggestReqRef.current) setSuggests([]); })
        .finally(() => { if (id === suggestReqRef.current) setSuggesting(false); });
    }, 350);
    return () => clearTimeout(t);
  }, [open, step, bank?.code, acctNo, suggestBanks, savedRecipients]);

  const pickSuggestion = (m) => {
    const digits = acctNo.replace(/\D/g, "");
    const b = bankList.find((x) => x.code === m.code) || { code: m.code, name: m.bank_name };
    doneKeyRef.current = `${b.code}:${digits}`;   // the server has just checked this name at this bank
    setBank(b); setName(m.account_name); setManual(false); setErr(""); setSuggests(null);
  };

  const isFirstTimeRecipient = !!(bank?.code && acctNo.length === 10) &&
    !savedRecipients.some((b) => b.bankCode === bank.code && b.accountNo === acctNo);

  const kobo = Math.round((parseFloat(amount) || 0) * 100);
  const dailyLeftKobo = Math.max(0, dailyCapKobo - dailyUsedKobo);
  const cap = Math.min(balanceKobo, maxKobo, dailyCapKobo > 0 ? dailyLeftKobo : Infinity);

  // The fee for THIS transfer, shown before the customer confirms (wallet_bank_transfer_quote: the price for the amount,
  // or free within their allowance — businesses by plan a month; clients/personal wallets pay Flutterwave's own fee on every
  // bank transfer, no free ones, since 2026-10-18). The server decides
  // the actual charge the same way when the bank accepts the transfer.
  const [quote, setQuote] = useState(null);
  useEffect(() => {
    if (step !== "review" || !kobo) return;
    let live = true;
    setQuote(null);
    supabase.rpc("wallet_bank_transfer_quote", { p_amount_kobo: kobo })
      .then(({ data, error }) => { if (live && !error && data) setQuote(data); });
    return () => { live = false; };
  }, [step, kobo]);
  const quoteFee = Number(quote?.fee_kobo || 0);
  // ₦50 stamp duty on bank transfers of ₦10,000 or more (Nigeria Tax Act 2025), as every bank charges — even when our fee is free
  const quoteDuty = Number(quote?.stamp_duty_kobo || 0);
  // 7.5% VAT on our fee (not on the amount, not on stamp duty) — its own row, its own line in the history (2026-10-23)
  const quoteVat = Number(quote?.vat_kobo || 0);
  const charges = quoteFee + quoteVat + quoteDuty;
  const shortForFee = !!quote && charges > 0 && kobo + charges > balanceKobo;
  const freeNote = quote
    ? (quote.free
        ? t(quote.period === "day" ? "walletpanel.freeNoteDay" : "walletpanel.freeNoteMonth", { left: Math.max(Number(quote.free_left) - 1, 0), allowance: quote.allowance })
        : `${quote.allowance > 0 ? t(quote.period === "day" ? "walletpanel.freeUsedDay" : "walletpanel.freeUsedMonth", { allowance: quote.allowance }) : ""}${t(quote.tier === "personal" ? "walletpanel.priceListPersonal" : "walletpanel.priceList")}`)
    : "";

  const doTransfer = async (pin) => {
    setBusy(true); setErr("");
    try {
      if (repeat) {
        await api.scheduleTransfer(kobo, bank.code, acctNo.trim(), pin, frequency, narration.trim(), bookExpense, recipientName);
      } else {
        const r = await api.transfer(kobo, bank.code, acctNo.trim(), pin, narration.trim(), bookExpense, recipientName);
        setFee(Number(r?.fee_kobo || 0));
        setWdId(r?.withdrawal_id || "");
      }
      setStep("done");
      hapticSuccess();
      if (saveBen) saveRecipient();
      onDone?.();
    } catch (e) {
      setErr(e.message || (repeat ? t("walletpanel.repeatFailed") : t("walletpanel.transferFailed")));
      setStep("review");
    } finally { setBusy(false); }
  };

  // A large transfer asks for a quick security selfie first — evidence only, never a match/verdict (see
  // utils/securitySelfie.js) — right after the PIN is approved and before the money actually moves.
  const handlePinApproved = (pin) => {
    if (securitySelfieEnabled && largeTransferSelfieThresholdKobo > 0 && kobo >= largeTransferSelfieThresholdKobo) {
      setPendingPin(pin); setSelfieErr(""); setStep("selfie");
    } else {
      doTransfer(pin);
    }
  };

  const submitTransferSelfie = async (dataUrl) => {
    setSelfie(dataUrl); setSelfieBusy(true); setSelfieErr("");
    const r = await submitSecuritySelfie("large_transfer", dataUrl, {
      amountKobo: kobo, recipientName, bankName: bank?.name, acctLast4: acctNo,
    });
    setSelfieBusy(false);
    if (!r.ok) { setSelfie(""); setSelfieErr(r.error); return; }
    doTransfer(pendingPin);
  };

  return (
    <>
      <BottomSheet open={open && step !== "pin" && step !== "selfie"} onClose={onClose}
        title={step === "done" ? "" : step === "review" ? t("walletpanel.confirmTransfer") : t("walletpanel.transfer")}
        back={step === "amount" ? () => setStep("to") : step === "review" ? () => setStep("amount") : undefined}>

        {step === "done" ? (
          <div className="text-center py-3">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
              <Icon name={repeat ? "clock" : "check"} size={30} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            {repeat ? (
              <>
                <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">{t("walletpanel.repeatSetUp")}</p>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">
                  {t("walletpanel.amountTo", { amount: fmt(kobo / 100) })} <b>{recipientName}</b> · {bank?.name}, {t(`walletpanel.freqLower.${frequency}`)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">{t("walletpanel.amountSent", { amount: fmt(kobo / 100) })}</p>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">
                  {t("walletpanel.to")} <b>{recipientName}</b> · {bank?.name}
                  {fee > 0 ? <><br />{t("walletpanel.feeAmount", { amount: fmt(fee / 100) })}</> : null}
                </p>
              </>
            )}
            {err && <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-3">{err}</p>}
            {(benSaved || (isFirstTimeRecipient && !saveBen)) && (
              benSaved
                ? <p className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400 mt-3">{t("walletpanel.savedAsBen")}</p>
                : <button onClick={saveRecipient}
                    className="w-full mt-4 rounded-2xl border border-brand-200 dark:border-brand-800/60 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-bold py-3 text-[13px]">
                    {t("walletpanel.saveAsBenName", { name: recipientName ? recipientName.split(" ")[0] : t("walletpanel.thisAccount") })}
                  </button>
            )}
            {!repeat && (
              <button onClick={viewReceipt} disabled={receiptLoading}
                className="w-full mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3.5 text-[14px] disabled:opacity-50">
                {receiptLoading ? t("walletpanel.preparingReceipt") : t("walletpanel.viewReceipt")}
              </button>
            )}
            <button onClick={onClose} className={primaryBtn + (repeat ? " mt-5" : " mt-2.5")}>{t("common.done")}</button>
          </div>
        ) : step === "review" ? (
          <div>
            <div className="rounded-3xl bg-navy-500 text-white p-5 text-center"
              style={{ background: "linear-gradient(145deg,var(--navy) 0%,var(--navy-dark) 100%)" }}>
              <p className="text-[11px] uppercase tracking-widest text-white/50">{repeat ? t("walletpanel.youreSettingUp") : t("walletpanel.youreSending")}</p>
              <p className="text-[34px] font-extrabold mt-1 tabular-nums">{fmt(kobo / 100)}</p>
              {repeat && <p className="text-[12px] text-white/60 mt-1 capitalize">{t(`walletpanel.freqLower.${frequency}`)}</p>}
            </div>
            <div className="mt-4 rounded-2xl border border-slate-100 dark:border-slate-700/60 divide-y divide-slate-100 dark:divide-slate-800">
              {[["Recipient", recipientName], ["Account", acctNo], ["Bank", bank?.name],
                ["Narration", narration || "—"],
                ["Fee", !quote ? "…" : quote.free ? t("walletpanel.free") : fmt(quoteFee / 100)],
                ...(quoteVat > 0 ? [["VAT", fmt(quoteVat / 100)]] : []),
                ...(quoteDuty > 0 ? [["Stamp duty", fmt(quoteDuty / 100)]] : []),
                ...(charges > 0 ? [["Total debit", fmt((kobo + charges) / 100)]] : []),
                ...(repeat ? [["Repeats", t(`walletpanel.freq.${frequency}`)]] : [])].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-4 py-3">
                  <span className="text-[12px] text-slate-400">{t(REVIEW_ROW_LABEL[k])}</span>
                  {k === "Bank" ? (
                    <span className="flex items-center gap-2 min-w-0 max-w-[62%]">
                      <BankLogo code={bank?.code} name={bank?.name} size={26} radius={8} />
                      <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 text-right truncate">{v}</span>
                    </span>
                  ) : (
                    <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 text-right max-w-[62%] truncate">{v}</span>
                  )}
                </div>
              ))}
            </div>
            {freeNote && <p className="text-[11px] text-slate-400 mt-2 px-1">{freeNote}</p>}
            {isFirstTimeRecipient && saveBen && (
              <p className="mt-3 text-[12px] font-semibold text-brand-700 dark:text-brand-300">
                {t("walletpanel.willSaveAsBen", { name: (benNick.trim() || (recipientName || "").split(" ")[0]) || t("walletpanel.thisAccount") })}
              </p>
            )}
            {shortForFee && (
              <p className="text-[12px] text-red-500 mt-2">
                {t("walletpanel.shortForFee", { charges: fmt(charges / 100), amount: fmt(kobo / 100), max: fmt(Math.max(balanceKobo - charges, 0) / 100) })}
              </p>
            )}
            {err && <p className="text-[12px] text-red-500 mt-3">{err}</p>}
            <button onClick={() => setStep("pin")} disabled={busy || shortForFee} className={primaryBtn + " mt-4"}>
              {repeat ? t("walletpanel.confirmRepeatBtn", { amount: fmt(kobo / 100), frequency: t(`walletpanel.freqLower.${frequency}`) }) : t("walletpanel.transferAmountBtn", { amount: fmt(kobo / 100) })}
            </button>
          </div>
        ) : step === "amount" ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 flex items-center gap-3">
              <BankLogo code={bank?.code} name={bank?.name} size={40} />
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate">{recipientName}</p>
                <p className="text-[11px] text-slate-400">{acctNo} · {bank?.name}</p>
              </div>
            </div>
            <div>
              <label className={labelCls}>{t("common.amount")}</label>
              <input inputMode="decimal" autoFocus value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
              <p className="text-[11px] text-slate-400 mt-1.5">
                {t("walletpanel.availableLine", { available: fmt(balanceKobo / 100), max: fmt(Math.min(balanceKobo, maxKobo) / 100) })}
                {dailyCapKobo > 0 && <> · {t("walletpanel.leftToday", { amount: fmt(dailyLeftKobo / 100) })}</>}
              </p>
            </div>
            <div>
              <label className={labelCls}>{t("walletpanel.narration")} <span className="text-slate-300 font-normal">{t("common.optional")}</span></label>
              <input value={narration} onChange={(e) => setNarration(e.target.value.slice(0, 100))} placeholder={t("walletpanel.whatsItFor")} className={inputCls} />
            </div>
            {/* No "record as a business expense" / "repeat this transfer" here (owner, 2026-10-22) — a new recipient is
                offered to be saved as a beneficiary instead, so the next transfer to them is one tap. */}
            {isFirstTimeRecipient && (
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5">
                <label className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={saveBen} onChange={(e) => setSaveBen(e.target.checked)} className="w-[18px] h-[18px] rounded-md accent-brand-600" />
                  {t("walletpanel.saveAsBen")} <span className="font-normal text-slate-400">· {t("common.optional")}</span>
                </label>
                <p className="text-[11px] text-slate-400 mt-1 ml-[28px]">{t("walletpanel.saveAsBenHint")}</p>
                {saveBen && (
                  <input value={benNick} onChange={(e) => setBenNick(e.target.value.slice(0, 40))}
                    placeholder={t("walletpanel.nicknamePh", { name: (recipientName || "").split(" ")[0] || t("walletpanel.supplier") })}
                    className={inputCls + " mt-2.5"} />
                )}
              </div>
            )}
            {err && <p className="text-[12px] text-red-500">{err}</p>}
            <button disabled={kobo < 10000 || kobo > cap}
              onClick={() => { setErr(""); setStep("review"); }} className={primaryBtn}>
              {t("common.continue")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {savedRecipients.length > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <label className={labelCls}>{t("walletpanel.savedBens")}</label>
                  <button type="button" onClick={() => setManageBens((v) => !v)} className="text-[11px] font-bold text-brand-600 dark:text-brand-400">
                    {manageBens ? t("common.done") : t("walletpanel.manage")}
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 mt-1.5 -mx-1 px-1">
                  {savedRecipients.slice(0, manageBens ? 50 : 12).map((b) => (
                    <div key={b.id} className="relative flex-shrink-0">
                      <button onClick={() => (manageBens ? null : pickSavedRecipient(b))}
                        className={`flex flex-col items-start rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-left active:scale-[0.97] transition-transform ${manageBens ? "pr-8" : ""}`}>
                        <span className="text-[12px] font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">{benDisplayName(b)}</span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">{benSubLabel(b)}</span>
                      </button>
                      {manageBens && (
                        <button type="button" aria-label={t("walletpanel.removeBen", { name: benDisplayName(b) })} onClick={() => removeRecipient(b)}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 flex items-center justify-center">
                          <Icon name="x" size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {clip && !acctNo && (
              <div className="rounded-2xl border border-brand-200 dark:border-brand-800/60 bg-brand-50 dark:bg-brand-900/20 px-3 py-2.5 flex items-center gap-3">
                <Icon name="copy" size={18} className="text-brand-600 dark:text-brand-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-brand-700 dark:text-brand-300">{t("walletpanel.useCopied")}</p>
                  <p className="text-[14px] font-extrabold tracking-[0.12em] text-slate-800 dark:text-white truncate">
                    {clip.account}
                    {clipBank && <span className="ml-1.5 text-[11px] font-semibold tracking-normal text-slate-500 dark:text-slate-400">· {displayBankName(clipBank)}</span>}
                  </p>
                </div>
                <button onClick={() => applyAccount(clip.text)}
                  className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-[12px] font-bold active:scale-[0.97]">{t("walletpanel.use")}</button>
                <button aria-label={t("walletpanel.dismiss")} onClick={() => setClip(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}
            <div>
              <label className={labelCls}>{t("walletpanel.accountNumber")}</label>
              <div className="relative">
                <input inputMode="numeric" autoFocus value={acctNo}
                  onChange={(e) => { setAcctNo(e.target.value.replace(/\D/g, "").slice(0, 10)); setName(""); setManual(false); setSuggests(null); }}
                  onPaste={(e) => { const t = e.clipboardData?.getData("text") || ""; if (applyAccount(t)) e.preventDefault(); }}
                  placeholder="0123456789" className={inputCls + " tracking-[0.15em] pr-20"} />
                {!acctNo && (
                  <button type="button" onClick={pasteFromClipboard}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 mt-[3px] px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-[12px] font-bold text-brand-600 dark:text-brand-400 active:scale-[0.97]">
                    {t("walletpanel.paste")}
                  </button>
                )}
              </div>
            </div>
            {!bank?.code && acctNo.length === 10 && (suggesting || suggests) && (
              <div>
                {suggesting ? (
                  <p className="text-[12px] text-slate-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" /> {t("walletpanel.findingBank")}
                  </p>
                ) : suggests.length > 0 ? (
                  <>
                    <label className={labelCls}>{suggests.length === 1 ? t("walletpanel.foundOne") : t("walletpanel.foundMany")}</label>
                    <div className="mt-1.5 space-y-2">
                      {suggests.map((m) => (
                        <button key={m.code} type="button" onClick={() => pickSuggestion(m)}
                          className="w-full flex items-center gap-3 rounded-2xl border border-emerald-200/70 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2.5 text-left active:scale-[0.98] transition-transform">
                          <BankLogo code={m.code} name={m.bank_name} size={40} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-extrabold text-emerald-800 dark:text-emerald-300 break-words">{m.account_name}</p>
                            <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70 truncate">{displayBankName({ code: m.code, name: m.bank_name })}</p>
                          </div>
                          <NetworkBars status={netByCode[m.code]} />
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">{t("walletpanel.tapRightOne")}</p>
                  </>
                ) : (
                  <p className="text-[12px] text-slate-400">{t("walletpanel.noBankAuto")}</p>
                )}
              </div>
            )}
            <div>
              <label className={labelCls}>{t("walletpanel.bank")}</label>
              <BankSelect
                banks={bankList}
                value={bank?.code || ""}
                onChange={(code, b) => { setBank(b); setName(""); setManual(false); setErr(""); doneKeyRef.current = ""; }}
                placeholder={t("walletpanel.selectBank")}
                className="h-[52px] mt-1.5"
                network={netByCode}
              />
              {(netByCode[bank?.code] === "poor" || netByCode[bank?.code] === "fair") && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1 mt-1.5">
                  <Icon name="warn" size={12} className="mt-0.5 flex-shrink-0" />
                  {netByCode[bank.code] === "poor"
                    ? t("walletpanel.bankPoor", { bank: displayBankName(bank) })
                    : t("walletpanel.bankSlow", { bank: displayBankName(bank) })}
                </p>
              )}
            </div>
            {resolving && (
              <p className="text-[12px] text-slate-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" /> {t("walletpanel.verifyingAccount")}
              </p>
            )}
            {name && (
              <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/70 dark:border-emerald-800/50 px-4 py-3 flex items-center gap-3">
                <BankLogo code={bank?.code} name={bank?.name} size={46} />
                <div className="min-w-0">
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide">{t("walletpanel.accountName")}</p>
                  <p className="text-[15px] font-extrabold text-emerald-800 dark:text-emerald-300 break-words">{name}</p>
                  {bank?.name && <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70 mt-0.5 truncate">{bank.name}</p>}
                </div>
              </div>
            )}
            {name && isFirstTimeRecipient && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Icon name="warn" size={12} /> {t("walletpanel.firstTime")}
              </p>
            )}
            {manual && !name && (
              <div>
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 mb-2">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    {t("walletpanel.manualNotice")}
                  </p>
                </div>
                <label className={labelCls}>{t("walletpanel.accountHolder")}</label>
                <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder={t("walletpanel.fullNameOnAcct")} className={inputCls} />
                <button onClick={retryResolve} className="text-[12px] font-bold text-brand-600 dark:text-brand-400 mt-2">{t("walletpanel.tryVerifyAgain")}</button>
              </div>
            )}
            {err && <p className="text-[12px] text-red-500">{err}</p>}
            {err && /doesn't exist at this bank/i.test(err) && suggestBanks && (
              <button type="button" onClick={() => { setErr(""); setName(""); doneKeyRef.current = ""; setBank(null); }}
                className="text-[12px] font-bold text-brand-600 dark:text-brand-400 -mt-2">
                {t("walletpanel.findRightBank")}
              </button>
            )}
            <button disabled={!recipientName || (manual && !name && manualName.trim().length < 3)}
              onClick={() => { setErr(""); setStep("amount"); }} className={primaryBtn}>
              {t("common.continue")}
            </button>
          </div>
        )}
      </BottomSheet>

      {open && step === "pin" && (
        <TransactionPinModal
          title={t("walletpanel.confirmTransfer")}
          amount={kobo}
          recipient={`${recipientName} · ${bank?.name}`}
          onApprove={handlePinApproved}
          onCancel={() => setStep("review")}
        />
      )}

      {open && step === "selfie" && (
        <div className="fixed inset-0 z-[210] bg-[#0f1c45] flex flex-col items-center justify-center px-6 gap-6 select-none"
          style={{ paddingTop: "env(safe-area-inset-top,0px)", paddingBottom: "env(safe-area-inset-bottom,0px)" }}>
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-brand-500" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-xl font-extrabold text-white">{t("walletpanel.oneMoreStep")}</p>
            <p className="text-sm text-white/60 mt-2 leading-relaxed max-w-xs">
              {t("walletpanel.selfieExplain", { amount: fmt(kobo / 100) })}
            </p>
          </div>
          {selfieErr && <p className="text-xs font-semibold text-red-400 text-center">{selfieErr}</p>}
          <div className="w-full max-w-[280px]">
            <SelfieCapture value={selfie} onCapture={submitTransferSelfie} onClear={() => setSelfie("")} label={t("walletpanel.takeSelfie")} />
          </div>
          {selfieBusy && <p className="text-xs text-white/40">{t("common.saving")}</p>}
          <button onClick={() => { setPendingPin(""); setStep("review"); }} className="py-3 px-4 text-sm text-white/40 underline underline-offset-2">
            {t("common.cancel")}
          </button>
        </div>
      )}

      {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

// ── Receive payment (customer pays into the wallet, booked as a sale) ──────
export function ReceivePaymentSheet({ open, onClose, wallet, payRequest, testMode, api, businessName, ownerName }) {
  const t = useT();
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
      if (row) { setReceipt(api.receiptFor(row, businessName, ownerName)); setReceiptLoading(false); return; }
      if (i === 2) api.refresh();
      await new Promise((r) => setTimeout(r, 500));
    }
    setReceiptLoading(false);
    setErr(t("walletpanel.receiptNotReady"));
  };

  const acct = wallet?.flw_account_number || "";
  const bank = cleanBankName(wallet?.flw_account_bank);
  const copy = () => { try { navigator.clipboard.writeText(acct); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  const reqAmt = payRequest ? payRequest.amount_kobo / 100 : 0;

  const create = async () => {
    setErr(""); setBusy(true);
    try { await api.createPaymentRequest(Math.round((parseFloat(amount) || 0) * 100), customer.trim(), note.trim()); }
    catch (e) { setErr(e.message || t("walletpanel.couldNotCreateRequest")); } finally { setBusy(false); }
  };
  const cancel = async () => { if (payRequest) await api.cancelPaymentRequest(payRequest.id); onClose(); };
  const simulate = async () => {
    setBusy(true);
    try { await api.simulateTopup(payRequest.amount_kobo / 100); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
    <BottomSheet open={open} onClose={onClose} title={paid ? "" : payRequest ? t("walletpanel.awaitingPayment") : t("walletpanel.receivePayment")}>
      {wallet?.account_state === "retired" && !paid ? (
        // the old number no longer credits the wallet — never ask a customer to pay into it
        <div className="text-center py-3">
          <p className="text-[15px] font-extrabold text-slate-900 dark:text-slate-50">{t("walletpanel.getNewNumberFirst")}</p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            {t("walletpanel.oldNumberBody")}
          </p>
          <button onClick={onClose} className={primaryBtn + " mt-5"}>{t("common.close")}</button>
        </div>
      ) : paid ? (
        <div className="text-center py-3">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <Icon name="check" size={30} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-[17px] font-extrabold text-slate-900 dark:text-slate-50">{t("walletpanel.paymentReceived")}</p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">{t("walletpanel.inWalletAsSale")}</p>
          {err && <p className="text-[12px] text-amber-600 dark:text-amber-400 mt-3">{err}</p>}
          <button onClick={viewReceipt} disabled={receiptLoading}
            className="w-full mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3.5 text-[14px] disabled:opacity-50">
            {receiptLoading ? t("walletpanel.preparingReceipt") : t("walletpanel.viewReceipt")}
          </button>
          <button onClick={onClose} className={primaryBtn + " mt-2.5"}>{t("common.done")}</button>
        </div>
      ) : payRequest ? (
        <div>
          <div className="rounded-3xl bg-slate-50 dark:bg-slate-800 p-5 text-center">
            <p className="text-[11px] uppercase tracking-widest text-slate-400">{t("walletpanel.askExactly")}</p>
            <p className="text-[32px] font-extrabold text-slate-900 dark:text-slate-50 mt-1 tabular-nums">{fmt(reqAmt)}</p>
            <div className="mt-3 inline-flex items-center gap-2 bg-white dark:bg-slate-900 rounded-xl px-3 py-2">
              <span className="text-[15px] font-extrabold tracking-wider text-slate-800 dark:text-slate-100">{acct}</span>
              <button onClick={copy} className="text-[12px] font-bold text-brand-600 dark:text-brand-400">{copied ? t("walletpanel.copied") : t("walletpanel.copy")}</button>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1.5">{bank} · {businessName || ownerName || wallet?.flw_account_name}</p>
            {payRequest.customer_name ? <p className="text-[12px] text-slate-400 mt-1">{t("walletpanel.fromName", { name: payRequest.customer_name })}</p> : null}
          </div>
          <div className="flex items-center justify-center gap-2 mt-4 text-[12px] text-slate-400">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> {t("walletpanel.waitingPayment")}
          </div>
          {testMode && (
            <button onClick={simulate} disabled={busy}
              className="w-full mt-3 rounded-2xl border border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 text-[13px] font-bold py-3.5 disabled:opacity-40">
              {busy ? t("walletpanel.simulating") : t("walletpanel.simulateCustomer")}
            </button>
          )}
          {err && <p className="text-[12px] text-red-500 mt-2 text-center">{err}</p>}
          <button onClick={cancel} className="w-full mt-3 text-[13px] font-semibold text-slate-400 py-2">{t("walletpanel.cancelRequest")}</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            {t("walletpanel.receiveIntro")}
          </p>
          <div>
            <label className={labelCls}>{t("common.amount")}</label>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("walletpanel.customer")} <span className="text-slate-300 font-normal">{t("common.optional")}</span></label>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={t("common.name")} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("common.note")} <span className="text-slate-300 font-normal">{t("common.optional")}</span></label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("walletpanel.whatsItFor")} className={inputCls} />
          </div>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
          <button onClick={create} disabled={busy || (parseFloat(amount) || 0) < 100} className={primaryBtn}>
            {busy ? t("walletpanel.creating") : t("walletpanel.requestPayment")}
          </button>
        </div>
      )}
      {!paid && wallet?.account_state !== "retired" && <DepositFeeNote open={open} />}
    </BottomSheet>
    {receipt && <TransactionDetailModal data={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}
