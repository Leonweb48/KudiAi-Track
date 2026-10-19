import { useState, useEffect, useRef, Fragment } from "react";
import { canSellPlans } from "../utils/platform";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import Field  from "../components/shared/Field";
import Badge  from "../components/shared/Badge";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildAsoContributionReceipt, buildAsoClientReceipt, bizFromProfile } from "../utils/receiptConfig";
import { ClientProfile } from "../components/shared/ClientProfile";
import { supabase } from "../utils/supabase";
import { bankLookup } from "../utils/bankLookup";
import { cleanRegFee, MAX_REG_FEE } from "../utils/registrationFee";
import { canDo, featureLimit, upgradeLabel, planRequiredLabel, planAvailableText } from "../utils/plans";
import { fmt, today, applyPeriodFilter } from "../utils/helpers";
import PeriodFilter from "../components/shared/PeriodFilter";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { createReportPdf, fmtCurrency as pdfFmt, fmtDate as pdfFmtDate } from "../utils/generateReportPdf";
import { spanDays } from "../utils/statementPeriod";
import { buildAjoStatementCSV, ajoCSVFilename, shareCSV } from "../utils/exportCSV";
import ContributionCard from "../components/ContributionCard";
import EsusuRotationDashboard from "../components/EsusuRotationDashboard";
import TodaysCollection from "../components/TodaysCollection";
import { useT } from "../contexts/LanguageContext";
import { usePlatformConfig } from "../hooks/usePlatformConfig";
import { getLang, speakConfirmation } from "../utils/i18n";
import AssignRecordModal from "../components/AssignRecordModal";
import TransactionPinModal from "../components/TransactionPinModal";
import ResultOverlay from "../components/ResultOverlay";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { InAppBrowser, ToolBarType } from "@capgo/capacitor-inappbrowser";
import { friendlyError } from "../utils/errorMessage";
import { useToast } from "../components/Toast";
import { overdueEligible, countingStart, effectiveNextDue, isCounting } from "../utils/asoOverdue";
import { daysDiff } from "../utils/localDays";

const BLANK = {
  full_name: "", contribution_frequency: "daily", contribution_amount: "",
  registration_charge: "", notes: "",
  phone: "", email: "",
  staff_id: "", ajo_group_id: null,
  bank_code: "", account_number: "", account_name: "", bank_name: "",
  commission_model: "none", commission_percent: "",
};

const BLANK_GROUP = {
  name: "", description: "", contribution_amount: "", contribution_frequency: "monthly", custom_interval_days: "",
  group_mode: "savings", privacy_show_names: true, privacy_show_amounts: false,
};

const FREQ_DAYS = { daily: 1, weekly: 7, monthly: 30 };

// Translation keys for the stored type / payment method (the stored values never change; text is looked up at render)
const TX_TYPE_KEY = {
  contribution:    "ajo.txContribution",
  withdrawal:      "ajo.txWithdrawal",
  reversal:        "ajo.txReversal",
  disbursement:    "ajo.txDisbursement",
  withdrawal_fee:  "ajo.txWithdrawalFee",
  registration_fee:"ajo.txRegistrationFee",
  commission:      "ajo.txCommission",
};
const METHOD_KEY = {
  cash:            "ajo.methodCash",
  manual_transfer: "ajo.methodBankTransfer",
  bank_transfer:   "ajo.methodBankTransfer",
  paystack:        "ajo.methodPaystack",
  online:          "ajo.methodOnline",
};
// Lower-case method names as shown on pending deposits (raw stored value with "_" → " "), translated at render
const PM_LOWER_KEY = {
  cash:            "ajo.pmCash",
  wallet:          "ajo.pmWallet",
  bank_transfer:   "ajo.pmBankTransfer",
  online:          "ajo.pmOnline",
  paystack:        "ajo.pmPaystack",
};
// Stored contribution_context → label key (staff collections queue)
const CTX_KEY = {
  group_savings:   "ajo.groupSavings",
  esusu_rotation:  "ajo.esusuRotation",
};
// Stored contribution_frequency → label key
const FREQ_KEY = {
  daily:   "ajo.freqDaily",
  weekly:  "ajo.freqWeekly",
  monthly: "ajo.freqMonthly",
};
// Same, lower-case (where the stored value used to be shown as-is)
const FREQ_LOWER_KEY = {
  daily:   "ajo.freqDailyLower",
  weekly:  "ajo.freqWeeklyLower",
  monthly: "ajo.freqMonthlyLower",
  custom:  "ajo.freqCustomLower",
};

// Fills {slot} markers in an already-translated sentence with React nodes (bold names / amounts), so each
// language keeps its own word order around them.
function fillNodes(text, nodes) {
  return String(text).split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return <Fragment key={i}>{m && nodes[m[1]] !== undefined ? nodes[m[1]] : part}</Fragment>;
  });
}

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-5 mb-2">
      {children}
    </p>
  );
}

async function uploadPhoto(file, id) {
  const path = `clients/aso/${id}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}


// Expected / missed count from when the client started counting — their first active card, esusu round or savings
// group (utils/asoOverdue) — never from registration alone. Nothing active = nothing expected, nothing missed.
function getMissedPayments(c) {
  const start = countingStart(c);
  if (!start || !c.contribution_amount || c.contribution_amount <= 0) return 0;
  const days = FREQ_DAYS[c.contribution_frequency] || 30;
  const since = Math.max(0, daysDiff(start));
  const expected = Math.floor(since / days);
  const actual   = Math.floor((c.total_saved || 0) / c.contribution_amount);
  return Math.max(0, expected - actual);
}

function getContribsMade(c) {
  if (!c.contribution_amount || c.contribution_amount <= 0) return 0;
  return Math.floor((c.total_saved || 0) / c.contribution_amount);
}

function getExpectedContribs(c) {
  const start = countingStart(c);
  if (!start || !c.contribution_amount || c.contribution_amount <= 0) return 0;
  const days  = FREQ_DAYS[c.contribution_frequency] || 30;
  const since = Math.max(0, daysDiff(start));
  return Math.floor(since / days);
}

// Overdue = active client, past their due date, who still has something ACTIVE to be overdue on (an active card,
// savings group or esusu round — see utils/asoOverdue). Settled cards / unstarted or closed groups don't count, and
// the due date never falls before counting started (a stale date from before their first card isn't overdue).
function isOverdue(c) {
  const due = effectiveNextDue(c);
  return c.status === "active" && overdueEligible(c) && !!due && daysDiff(due) > 0;
}

function buildReminderMsg(c, businessName) {
  const missed  = getMissedPayments(c);
  const freqMap = { daily: "daily", weekly: "weekly", monthly: "monthly" };
  const missedLine = missed > 0
    ? `\n⚠ Missed payments: ${missed}`
    : "";
  const biz = businessName ? `\nBusiness: ${businessName}` : "";
  return `Dear ${c.full_name},\n\nThis is a friendly reminder about your Aso savings contribution.${missedLine}\n\nFrequency: ${freqMap[c.contribution_frequency] || c.contribution_frequency}\nContribution Amount: ${fmt(c.contribution_amount)}\nNext Due Date: ${effectiveNextDue(c) || "N/A"}\nCurrent Balance: ${fmt(c.current_balance)}\nTotal Contributed: ${fmt(c.total_saved)}${biz}\n\nPlease keep your contributions up to date. Thank you!`;
}

function isGroupAccount(c) {
  const keywords = ["cooperative", "group", "association", "union", "society", "club", "community", "women", "men", "market", "traders"];
  const name = (c.full_name || "").toLowerCase();
  return keywords.some(k => name.includes(k));
}

/* ── Per-client Ajo Contribution History Modal ─────────────────────────── */
function AsoClientHistoryModal({ client, contributions, cycles = [], businessName, biz, staffMap = {}, onClose, onOpenCycle, onCloseCycle, onExecuteCommission, onReverseContrib }) {
  const t = useT();
  // Derived from props — computed before state so they can seed initial values
  // Name map over ALL cycles (active + closed) — used to label history rows
  const cycleNameMap = Object.fromEntries(cycles.map(c => [c.id, c.label || t("ajo.personalSavings")]));
  // Card tab renders active AND completed (matured) cycles — settled/closed go to history only
  const activeCycles = cycles.filter(c => c.status === "active" || c.status === "completed");

  const [tab,           setTab]           = useState(activeCycles.length > 0 ? "card" : "history");
  const [historyResult, setHistoryResult] = useState(null);
  const [showNewCycle,  setShowNewCycle]  = useState(false);
  const [newCycleForm, setNewCycleForm] = useState({
    purpose:   "",
    amount:    client.contribution_amount ?? "",
    frequency: client.contribution_frequency || "monthly",
    length:    "",
    model:     client.commission_model === "first_period" ? "percent" : (client.commission_model || "none"),   // first-period cards are no longer opened
    percent:   client.commission_percent ?? "",
  });
  // Auto-switch to card tab when an active cycle is added
  useEffect(() => { if (activeCycles.length > 0) setTab("card"); }, [activeCycles.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [typeFilter,    setTypeFilter]    = useState("all");
  const [period,        setPeriod]        = useState("all");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");
  const [receipt,       setReceipt]       = useState(null);
  const [clearedIds,    setClearedIds]    = useState(() => new Set());
  const [reverseFor,    setReverseFor]    = useState(null);   // tx being reversed
  const [reverseReason, setReverseReason] = useState("");
  const [reverseStep,   setReverseStep]   = useState("reason"); // "reason" | "pin"
  const [reverseError,  setReverseError]  = useState("");

  const filtered = applyPeriodFilter(
    typeFilter === "all" ? contributions : contributions.filter(c => c.type === typeFilter),
    period, dateFrom, dateTo, c => c.created_at
  );

  const handleExportPdf = async () => {
    const sorted = [...contributions].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    let runBal = 0;
    const rows = sorted.map(c => {
      const amt   = parseFloat(c.amount) || 0;
      const isFee = c.type === "withdrawal_fee" || c.type === "registration_fee";
      const isWd  = c.type === "withdrawal" || isFee || c.type === "commission" || (c.type || "").startsWith("reversal_");
      const desc  = isFee
        ? (c.type === "withdrawal_fee" ? "Withdrawal Fee" : "Registration Fee")
        : c.type === "withdrawal" ? "Withdrawal"
        : c.type === "commission" ? "Commission"
        : (c.type || "").startsWith("reversal_") ? "Reversal"
        : "Contribution";
      if (isWd) runBal -= amt; else runBal += amt;
      return {
        date:        pdfFmtDate(c.created_at),
        description: desc,
        reference:   c.payment_method || "—",
        debit:       isWd ? pdfFmt(amt) : "",
        credit:      isWd ? "" : pdfFmt(amt),
        balance:     pdfFmt(runBal),
      };
    });
    const totContrib = contributions.filter(c => c.type === "contribution").reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
    const totWd      = contributions.filter(c => c.type === "withdrawal" || c.type === "withdrawal_fee" || c.type === "registration_fee" || c.type === "commission").reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
    const pdf = await createReportPdf({
      title: "Ajo Statement", businessName: businessName || "My Business",
      period: client.full_name,
      // verifiable: kudiai.app/verify shows these figures, as printed
      docNoun: "statement",
      verify: {
        type: "savings_statement", holderName: client.full_name,
        ...spanDays(sorted.map(c => c.created_at), { toToday: true }),
        summary: [
          { label: "Client",            value: client.full_name },
          { label: "Business",          value: businessName || "My Business" },
          { label: "Total contributed", value: pdfFmt(totContrib) },
          { label: "Total withdrawn",   value: pdfFmt(totWd) },
          { label: "Current balance",   value: pdfFmt(client.current_balance || 0) },
          { label: "Records",           value: String(contributions.length) },
        ],
      },
      headerRight: [
        { value: businessName || "My Business" },
        { value: client.full_name, sub: true },
      ].filter(item => item.value),
      entityDetails: [
        { label: "Client Name", value: client.full_name },
        { label: "Current Balance", value: pdfFmt(client.current_balance || 0) },
        { label: "Total Contributed", value: pdfFmt(client.total_saved || totContrib) },
        { label: "Records", value: String(contributions.length) },
      ],
    });
    pdf.addStats([
      { label: "Total Contributed", value: pdfFmt(totContrib), color: "#3DA829" },
      { label: "Total Withdrawn",   value: pdfFmt(totWd),      color: "#ef4444" },
      { label: "Current Balance",   value: pdfFmt(client.current_balance || 0) },
      { label: "Records",           value: String(contributions.length) },
    ]);
    pdf.addStatement(rows, { openingBalance: 0, totalDebits: totWd, totalCredits: totContrib });
    await pdf.save(`Ajo_Statement_${client.full_name.replace(/\s+/g, "_")}.pdf`);
  };

  const handleExportCsv = async () => {
    const csv = buildAjoStatementCSV(contributions, client);
    await shareCSV(csv, ajoCSVFilename(client.full_name));
  };

  const FILTERS = [
    { id: "all", label: t("ajo.filterAll") },
    { id: "contribution", label: t("ajo.contributions") },
    { id: "withdrawal", label: t("ajo.withdrawals") },
  ];

  return (
    <div className="fixed inset-0 z-sheet bg-black/60 flex flex-col">
      {receipt && (
        <TransactionDetailModal
          data={buildAsoContributionReceipt(receipt, client.full_name, businessName, receipt.recorded_by ? staffMap[receipt.recorded_by] : undefined, biz)}
          onClose={() => setReceipt(null)}
        />
      )}

      {/* Reverse entry — reason step */}
      {reverseFor && reverseStep === "reason" && (
        <div className="fixed inset-0 z-sub-sheet bg-black/60 flex items-end justify-center">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl w-full max-w-lg p-5 pb-8">
            <h3 className="text-base font-black text-slate-800 dark:text-white mb-1">{t("ajo.reverseEntryTitle")}</h3>
            <p className="text-xs text-slate-400 mb-4">
              {t("ajo.reverseContribFrom", { amount: Number(reverseFor.amount || 0).toLocaleString("en-NG"), date: new Date(reverseFor.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) })}
            </p>
            {reverseFor.payment_method === "wallet" && (
              <div className="-mt-2 mb-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                {t("ajo.reverseWalletNoteA", { name: client.full_name || t("ajo.theClient") })} <b>₦{Number(reverseFor.amount || 0).toLocaleString("en-NG")}</b> {t("ajo.reverseWalletNoteB")}
              </div>
            )}
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">{t("ajo.reasonRequired")}</label>
            <textarea
              value={reverseReason}
              onChange={e => setReverseReason(e.target.value)}
              placeholder={t("ajo.reverseReasonPlaceholder")}
              rows={3}
              className="w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            {reverseError && <p className="text-xs text-red-500 mt-2">{reverseError}</p>}
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setReverseFor(null); setReverseReason(""); setReverseError(""); }}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-slate-500 bg-slate-100 dark:bg-slate-800 active:scale-[0.98] transition">
                {t("common.cancel")}
              </button>
              <button onClick={() => {
                if (reverseReason.trim().length < 5) { setReverseError(t("ajo.reasonMin5")); return; }
                setReverseError("");
                setReverseStep("pin");
              }}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-amber-500 active:scale-[0.98] transition">
                {t("common.continue")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse entry — PIN step */}
      {reverseFor && reverseStep === "pin" && (
        <TransactionPinModal
          title={t("ajo.confirmReversal")}
          amount={Math.round((reverseFor.amount || 0) * 100)}
          recipient={client.full_name}
          description={t("ajo.reverseAmountDesc", { amount: Number(reverseFor.amount || 0).toLocaleString("en-NG"), reason: reverseReason })}
          onCancel={() => { setReverseStep("reason"); setReverseError(""); }}
          onApprove={async (pin) => {
            const amt  = reverseFor.amount;
            const name = client.full_name;
            const result = await onReverseContrib(reverseFor, reverseReason.trim(), pin);
            if (result?.error) {
              setReverseStep("reason");
              setReverseError(result.error);
            } else {
              setReverseFor(null);
              setReverseReason("");
              setReverseStep("reason");
              setReverseError("");
              const refundKobo = Number(result?.data?.wallet_refund_kobo || 0);
              setHistoryResult({
                type: "success", title: t("ajo.contributionReversed"), amount: amt, counterparty: name,
                note: refundKobo > 0 ? t("ajo.refundReturnedToWallet", { amount: (refundKobo / 100).toLocaleString("en-NG"), name }) : undefined,
              });
            }
          }}
        />
      )}

      <div className="bg-white dark:bg-slate-900 flex flex-col h-full max-w-lg w-full mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-slate-100 dark:border-slate-800" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
          <div className="min-w-0 flex-1 mr-2">
            <h2 className="text-base font-black text-slate-800 dark:text-white truncate">{client.full_name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tab === "card" ? t("ajo.contributionCard") : t("ajo.ajoTxHistory")}</p>
          </div>
          <div className="flex items-center gap-2">
            {tab === "history" && contributions.length > 0 && (
              <button onClick={handleExportPdf}
                className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-90 transition">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 15V3m0 12l-4-4m4 4l4-4"/><path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"/>
                </svg>
              </button>
            )}
            {tab === "history" && contributions.length > 0 && (
              <button onClick={handleExportCsv} title={t("ajo.exportCsv")}
                className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-90 transition">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </button>
            )}
            <button onClick={onClose}
              className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-90 transition">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Tab row */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 gap-4">
          <button
            onClick={() => setTab("card")}
            className={`pb-2 pt-2 text-xs font-bold transition-colors border-b-2 ${tab === "card" ? "border-brand-600 text-brand-600" : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
          >
            {t("ajo.tabCard")}
          </button>
          <button
            onClick={() => setTab("history")}
            className={`pb-2 pt-2 text-xs font-bold transition-colors border-b-2 ${tab === "history" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
          >
            {t("ajo.tabHistory")}
          </button>
        </div>

        {/* Card tab */}
        {tab === "card" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {activeCycles.map((cyc, idx) => (
              <ContributionCard
                key={cyc.id}
                cycle={cyc}
                contributions={contributions}
                frequency={client.contribution_frequency}
                clientName={client.full_name}
                businessName={businessName}
                registrationCharge={client.registration_charge || 0}
                isLegacyCycle={idx === 0}
                onCloseCycle={onCloseCycle ? () => onCloseCycle(cyc) : undefined}
                onExecuteCommission={cyc.status !== "active" ? ((amt, pin) => onExecuteCommission(amt, pin, cyc)) : undefined}
              />
            ))}
            {activeCycles.length === 0 && (
              <ContributionCard
                cycle={null}
                contributions={contributions}
                frequency={client.contribution_frequency}
                clientName={client.full_name}
                businessName={businessName}
                registrationCharge={client.registration_charge || 0}
                isLegacyCycle={true}
              />
            )}
            {onOpenCycle && (
              showNewCycle ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                  <p className="text-sm font-bold text-slate-700 dark:text-white">{t("ajo.newSavingCycle")}</p>

                  {/* Purpose — required; must be unique among active cycles for this client */}
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("ajo.purpose")} <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      placeholder={t("ajo.purposePlaceholder")}
                      value={newCycleForm.purpose}
                      onChange={e => setNewCycleForm(f => ({ ...f, purpose: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {/* Amount + Frequency */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("ajo.amountPerPeriod")}</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="0"
                        value={newCycleForm.amount}
                        onChange={e => setNewCycleForm(f => ({ ...f, amount: e.target.value }))}
                        className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("ajo.frequency")}</label>
                      <select
                        value={newCycleForm.frequency}
                        onChange={e => setNewCycleForm(f => ({ ...f, frequency: e.target.value }))}
                        className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                        <option value="daily">{t("ajo.freqDaily")}</option>
                        <option value="weekly">{t("ajo.freqWeekly")}</option>
                        <option value="monthly">{t("ajo.freqMonthly")}</option>
                      </select>
                    </div>
                  </div>

                  {/* Length (optional) */}
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("ajo.lengthPeriodsOptional")}</label>
                    <input
                      type="number"
                      min="1"
                      placeholder={t("ajo.leaveBlankDefault")}
                      value={newCycleForm.length}
                      onChange={e => setNewCycleForm(f => ({ ...f, length: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {/* Fee model */}
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("ajo.feeModel")}</label>
                    <select
                      value={newCycleForm.model}
                      onChange={e => setNewCycleForm(f => ({ ...f, model: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                      <option value="none">{t("ajo.feeNone")}</option>
                      <option value="percent">{t("ajo.feePercentOnWithdrawals")}</option>
                    </select>
                    {newCycleForm.model === "percent" && <p className="text-[10px] text-slate-400 mt-1">{t("ajo.pctCardsOnly")}</p>}
                  </div>

                  {/* Fee % — only when model is percent */}
                  {newCycleForm.model === "percent" && (
                    <div>
                      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("ajo.feePercent")}</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        placeholder={t("ajo.egValue", { v: "5" })}
                        value={newCycleForm.percent}
                        onChange={e => setNewCycleForm(f => ({ ...f, percent: e.target.value }))}
                        className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowNewCycle(false); setNewCycleForm(f => ({ ...f, purpose: "" })); }}
                      className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-bold">
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={() => {
                        if (!newCycleForm.purpose.trim()) return;
                        onOpenCycle({ ...newCycleForm });
                        setShowNewCycle(false);
                        setNewCycleForm(f => ({ ...f, purpose: "" }));
                      }}
                      className="flex-1 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-bold">
                      {t("ajo.openCycle")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewCycle(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 rounded-2xl text-sm font-bold active:scale-[0.98] transition">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  {t("ajo.openNewSavingCycle")}
                </button>
              )
            )}
          </div>
        )}

        {/* History tab */}
        {tab === "history" && <>
        {/* Type + date filters */}
        <div className="px-4 pt-3 pb-1 space-y-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {FILTERS.map(f => (
              <button key={f.id}
                onClick={() => setTypeFilter(f.id)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold flex-shrink-0 transition-colors
                  ${typeFilter === f.id
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"}`}>
                {f.label}
              </button>
            ))}
          </div>
          <PeriodFilter period={period} setPeriod={setPeriod} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-slate-400 text-sm font-semibold">{t("ajo.noRecordsFound")}</p>
            </div>
          ) : filtered.map(tx => {
            const isWithdraw = tx.type === "withdrawal";
            const dateStr = tx.created_at
              ? new Date(tx.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
              : tx.date || "";
            return (
              <button key={tx.id} onClick={() => setReceipt(tx)}
                className="w-full text-left bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-700 active:scale-[0.98] transition-transform">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isWithdraw ? "bg-red-50 dark:bg-red-900/20" : "bg-green-50 dark:bg-green-900/20"}`}>
                    <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${isWithdraw ? "text-red-500" : "text-green-600 dark:text-green-400"}`}
                      stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      {isWithdraw ? <path d="M12 19V5M5 12l7 7 7-7"/> : <path d="M12 5v14M5 12l7-7 7 7"/>}
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-extrabold tabular ${isWithdraw ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
                        {isWithdraw ? "−" : "+"}{fmt(tx.amount)}
                      </span>
                      <Badge status={tx.status || "completed"} />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {TX_TYPE_KEY[tx.type] ? t(TX_TYPE_KEY[tx.type]) : tx.type}
                      {tx.cycle_id && cycleNameMap[tx.cycle_id] ? ` — ${cycleNameMap[tx.cycle_id]}` : ""}
                      {" · "}{METHOD_KEY[tx.payment_method] ? t(METHOD_KEY[tx.payment_method]) : t("ajo.methodCash")}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{dateStr}</p>
                    {tx.recorded_by && staffMap[tx.recorded_by] && (
                      <p className="text-[10px] text-brand-600 dark:text-brand-400 mt-0.5">{t("ajo.byStaff", { name: staffMap[tx.recorded_by] })}</p>
                    )}
                    {tx.notes && <p className="text-[10px] text-slate-400 italic mt-0.5">"{tx.notes}"</p>}
                    {onReverseContrib && tx.type === "contribution" && (tx.status === "completed" || tx.status === "approved") && (
                      <button onClick={e => {
                        e.stopPropagation();
                        setReverseFor(tx);
                        setReverseReason("");
                        setReverseStep("reason");
                        setReverseError("");
                      }}
                        className="mt-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full active:scale-95 transition">
                        {t("ajo.reverseEntry")}
                      </button>
                    )}
                    {tx.dispute_ticket_no && !clearedIds.has(tx.id) && (
                      <div className="flex items-center justify-between mt-1">
                        <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                          <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>
                          {tx.dispute_ticket_no}
                        </span>
                        <button onClick={async e => {
                          e.stopPropagation();
                          const { error } = await supabase.functions.invoke("ajo-write", {
                            body: { action: "resolve_dispute", contribution_id: tx.id },
                          });
                          if (!error) setClearedIds(prev => new Set([...prev, tx.id]));
                        }} className="text-[10px] text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 underline ml-2 flex-shrink-0">
                          {t("ajo.clearFlag")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        </>}
      </div>
      {historyResult && (
        <ResultOverlay
          type={historyResult.type}
          title={historyResult.title}
          amount={historyResult.amount}
          counterparty={historyResult.counterparty}
          note={historyResult.note}
          reason={historyResult.reason}
          onPrimary={() => setHistoryResult(null)}
        />
      )}
    </div>
  );
}

// Owner-only: the business's default card fee % (profiles.ajo_default_commission_percent). Savings cards are percentage
// cards only (2026-10-14): a new card for a client with no % of their own uses this; with none set, the card is refused.
function DefaultCardFeeSetting({ ownerId }) {
  const t = useT();
  const [pct,     setPct]     = useState(null);   // null = loading, or the column isn't there yet
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState("");
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState("");

  useEffect(() => {
    if (!ownerId) return undefined;
    let live = true;
    supabase.from("profiles").select("ajo_default_commission_percent").eq("id", ownerId).maybeSingle()
      .then(({ data, error }) => { if (live && !error) setPct(Number(data?.ajo_default_commission_percent) || 0); });
    return () => { live = false; };
  }, [ownerId]);

  if (pct === null) return null;

  const save = async () => {
    const raw = draft.trim();
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) { setErr(t("ajo.defaultPctRange")); return; }
    const v = Math.round(n * 100) / 100;
    setSaving(true); setErr("");
    const { error } = await supabase.from("profiles").update({ ajo_default_commission_percent: v }).eq("id", ownerId);
    setSaving(false);
    if (error) { setErr(t("ajo.defaultPctFailed")); return; }
    setPct(v); setEditing(false);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 mb-4 shadow-card border border-slate-100 dark:border-slate-700/60">
      {editing ? (
        <>
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">{t("ajo.defaultPctTitle")}</p>
          <div className="flex gap-2">
            <input type="number" min="0" max="100" step="0.1" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} placeholder={t("ajo.egValue", { v: "5" })}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100" />
            <button onClick={save} disabled={saving}
              className="px-4 rounded-xl bg-brand-600 text-white text-xs font-bold disabled:opacity-50 active:scale-95 transition-transform">{saving ? "…" : t("common.save")}</button>
            <button onClick={() => { setEditing(false); setErr(""); }} disabled={saving}
              className="px-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">{t("common.cancel")}</button>
          </div>
          {err && <p className="text-[11px] text-red-500 mt-1.5">{err}</p>}
          <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">{t("ajo.defaultPctHelp")}</p>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{t("ajo.defaultPctTitle")}</p>
            <p className={`text-[11px] mt-0.5 ${pct > 0 ? "text-slate-500 dark:text-slate-400" : "text-amber-600 dark:text-amber-400"}`}>
              {pct > 0 ? t("ajo.defaultPctSet", { pct }) : t("ajo.defaultPctNone")}
            </p>
          </div>
          <button onClick={() => { setDraft(pct > 0 ? String(pct) : ""); setErr(""); setEditing(true); }}
            className="text-xs font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-3 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition-transform">
            {pct > 0 ? t("ajo.change") : t("ajo.setFee")}
          </button>
        </div>
      )}
    </div>
  );
}

// Owner-only: the registration fee a new client sees on the signup page and is charged from their first deposit.
// Self-contained (its own read/write of profiles.ajo_registration_fee) so a not-yet-migrated database just hides it.
function RegistrationFeeSetting({ ownerId, onChange }) {
  const t = useT();
  const [fee,     setFee]     = useState(null);   // null = loading, or the column isn't there yet
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState("");
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState("");

  useEffect(() => {
    if (!ownerId) return undefined;
    let live = true;
    supabase.from("profiles").select("ajo_registration_fee").eq("id", ownerId).maybeSingle()
      .then(({ data, error }) => {
        if (!live || error) return;
        const v = cleanRegFee(data?.ajo_registration_fee);
        setFee(v); onChange?.(v);
      });
    return () => { live = false; };
  }, [ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fee === null) return null;

  const save = async () => {
    const raw = draft.trim();
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > MAX_REG_FEE) { setErr(t("ajo.regFeeRange", { max: MAX_REG_FEE.toLocaleString("en-NG") })); return; }
    setSaving(true); setErr("");
    const v = cleanRegFee(n);
    const { error } = await supabase.from("profiles").update({ ajo_registration_fee: v }).eq("id", ownerId);
    setSaving(false);
    if (error) { setErr(friendlyError(error, t("ajo.regFeeSaveFailed"))); return; }
    setFee(v); onChange?.(v); setEditing(false);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 mb-4 shadow-card border border-slate-100 dark:border-slate-700/60">
      {editing ? (
        <>
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">{t("ajo.regFeeForNewClients")}</p>
          <div className="flex gap-2">
            <input type="number" min="0" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} placeholder={t("ajo.regFeeZeroForNone")}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100" />
            <button onClick={save} disabled={saving}
              className="px-4 rounded-xl bg-brand-600 text-white text-xs font-bold disabled:opacity-50 active:scale-95 transition-transform">{saving ? "…" : t("common.save")}</button>
            <button onClick={() => { setEditing(false); setErr(""); }} disabled={saving}
              className="px-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">{t("common.cancel")}</button>
          </div>
          {err && <p className="text-[11px] text-red-500 mt-1.5">{err}</p>}
          <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">{t("ajo.regFeeHelp")}</p>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{t("ajo.regFeeForNewClients")}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {fee > 0 ? t("ajo.regFeeTakenOnce", { amount: fmt(fee) }) : t("ajo.regFeeNoneSet")}
            </p>
          </div>
          <button onClick={() => { setDraft(fee > 0 ? String(fee) : ""); setErr(""); setEditing(true); }}
            className="text-xs font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-3 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition-transform">
            {fee > 0 ? t("ajo.change") : t("ajo.setFee")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Aso({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade, staffId = null, embedded, deepLink = null, onDeepLinkHandled = null }) {
  const t = useT();
  const toast = useToast();
  const { walletEnabled, walletMoveFeeKobo } = usePlatformConfig();
  const [showAdd,      setShowAdd]      = useState(false);
  const [selected,              setSelected]             = useState(null);
  const [action,                setAction]               = useState(null);
  const [amt,                   setAmt]                  = useState("");
  const [contributeCtx,         setContributeCtx]        = useState("personal_savings");
  const [contributeGroupId,     setContributeGroupId]    = useState(null);
  const [contributeCycleId,     setContributeCycleId]    = useState(null);
  const [selectedCycles,        setSelectedCycles]       = useState([]); // active personal_savings cycles for selected client
  const [selectedClientMems,    setSelectedClientMems]   = useState([]); // group memberships for selected client
  const [activeEsusuRoundIds,   setActiveEsusuRoundIds]  = useState(() => new Set()); // group_ids with a currently-active rotation round
  const [fundPayErr,            setFundPayErr]           = useState("");
  const [receipt,      setReceipt]      = useState(null);
  const [historyFor,   setHistoryFor]   = useState(null); // { client, contributions, cycle }
  const [historyErr,   setHistoryErr]   = useState("");
  const [historyNote,  setHistoryNote]  = useState("");
  const [cycleConfirm, setCycleConfirm] = useState(null); // { title, msg, confirmLabel, onConfirm }
  const [histLoading,  setHistLoading]  = useState(false);
  const [clientProf,   setClientProf]   = useState(null);
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [adding,       setAdding]       = useState(false);
  const [reminderFor,  setReminderFor]  = useState(null);
  const [copied,       setCopied]       = useState(false);
  const [showPins,      setShowPins]      = useState({});
  const [createdClient, setCreatedClient] = useState(null);
  const [copiedField,   setCopiedField]   = useState(null);

  // Registration — form state
  const [addError,        setAddError]        = useState("");
  const [addedClientEmail, setAddedClientEmail] = useState("");
  const [clientSubAcctErr, setClientSubAcctErr] = useState("");

  // Filters
  const [search,         setSearch]         = useState("");
  const [filter,         setFilter]         = useState("all");
  const [showDateFilter,  setShowDateFilter]  = useState(false);
  const [dueBefore,       setDueBefore]       = useState("");
  const [showCollection,  setShowCollection]  = useState(false);
  const [collectionCycles, setCollectionCycles] = useState({}); // clientId → cycles[]

  const { asoClients, addAsoClient, asoContribute, asoCollectionRecord, asoWithdraw, asoFundWallet, asoReverseContribution, updateAsoClient, requestAsoClientArchive, cancelAsoClientArchive, profile, staffMap = {} } = store;
  const staffOptions = Object.entries(staffMap).map(([id, name]) => ({ id, name }));

  const [withdrawalRequests,  setWithdrawalRequests]  = useState([]);
  const [stuckPayouts,        setStuckPayouts]        = useState([]);
  const [retryingPayoutId,    setRetryingPayoutId]    = useState(null);
  const [processingId,        setProcessingId]        = useState(null);
  const [cancellingArchiveId, setCancellingArchiveId] = useState(null);
  const [approveError,        setApproveError]        = useState({ id: null, text: "" });
  const [txnPin,              setTxnPin]              = useState(null);
  const [actionResult,        setActionResult]        = useState(null); // { type, title, amount, counterparty, reason }
  const [contribSuccess,      setContribSuccess]      = useState(null); // { client, amount, showShare }
  const [contribError,        setContribError]        = useState(null); // error string
  const [wdError,             setWdError]             = useState(null);

  const [pendingDeposits,     setPendingDeposits]     = useState([]);
  const [processingDepositId, setProcessingDepositId] = useState(null);
  const [rejectingDeposit,    setRejectingDeposit]    = useState(null);
  const [rejectReason,        setRejectReason]        = useState("");
  const [rejectingHeld,       setRejectingHeld]       = useState(null);
  const [heldRejectReason,    setHeldRejectReason]    = useState("");
  const [heldRejectBusy,      setHeldRejectBusy]      = useState(false);
  const [depositFeedback,     setDepositFeedback]     = useState(null); // { type:"ok"|"err", msg:string }
  const [depError,            setDepError]            = useState(null);

  // Per-staff Ajo capability flags — null means owner (full access)
  const [staffAjoPerms, setStaffAjoPerms] = useState(null);
  const [assigningClient, setAssigningClient] = useState(null);

  // Staff Collections queue (owner-only review of staff-recorded pending contributions)
  const [pendingStaffContribs,     setPendingStaffContribs]     = useState([]);
  const [rejectingStaffContrib,    setRejectingStaffContrib]    = useState(null);
  const [staffContribRejectReason, setStaffContribRejectReason] = useState("");
  const [processingStaffContribId, setProcessingStaffContribId] = useState(null);
  const [staffContribFeedback,     setStaffContribFeedback]     = useState(null);


  // Notification deep link ({ sub?, id? }, handed down by Finance):
  //   id (a client)      → open that client's profile
  //   sub withdrawals / deposits / collections / payouts → scroll to that queue
  //   no sub, no id      → jump to stuck payouts if there are any (that's what the
  //                        payout-failed / balance-shortfall alerts point at)
  // The queues load asynchronously, so retry as they arrive and give up after a
  // few seconds instead of waiting forever on something that isn't there.
  useEffect(() => {
    if (!deepLink) return;
    let done = false;
    const anchors = { withdrawals: "aso-withdrawals", deposits: "aso-deposits", collections: "aso-collections", payouts: "aso-payouts" };

    if (deepLink.id) {
      const cl = (asoClients || []).find(c => c.id === deepLink.id);
      if (cl) { setClientProf(cl); done = true; }
    } else {
      const target = anchors[deepLink.sub] || (!deepLink.sub && stuckPayouts.length > 0 ? "aso-payouts" : null);
      if (!target) {
        done = true; // e.g. {tab:"aso", sub:"clients"} — the client list is already the page
      } else {
        const el = document.getElementById(target);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.classList.add("ring-2", "ring-brand-400");
          setTimeout(() => el.classList.remove("ring-2", "ring-brand-400"), 2200);
          done = true;
        }
      }
    }

    if (done) { onDeepLinkHandled?.(); return; }
    const giveUp = setTimeout(() => onDeepLinkHandled?.(), 6000);
    return () => clearTimeout(giveUp);
  }, [deepLink, asoClients, stuckPayouts, withdrawalRequests, pendingDeposits, pendingStaffContribs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ajo Groups management
  const [showGroups,           setShowGroups]           = useState(false);
  const groupsBackdropDown     = useRef(false);
  const [groups,               setGroups]               = useState([]);
  const [groupsLoading,        setGroupsLoading]        = useState(false);
  const [showGroupAdd,         setShowGroupAdd]         = useState(false);
  const [gf,                   setGf]                   = useState(BLANK_GROUP);
  const setG = (k, v) => setGf(p => ({ ...p, [k]: v }));
  const [groupSaving,          setGroupSaving]          = useState(false);
  const [groupError,           setGroupError]           = useState("");
  // Group approval requests
  const [editingGroup,         setEditingGroup]         = useState(null); // grp.id
  const [editGf,               setEditGf]               = useState({});
  const setEG = (k, v) => setEditGf(p => ({ ...p, [k]: v }));
  const [deletingGroup,        setDeletingGroup]        = useState(null); // grp.id
  const [groupApprReason,      setGroupApprReason]      = useState("");
  const [groupApprSubmitting,  setGroupApprSubmitting]  = useState(false);
  const [groupApprMsg,         setGroupApprMsg]         = useState({ id: null, text: "", ok: false });
  const [groupApprovals,       setGroupApprovals]       = useState([]); // pending requests
  const [directEditGroup,      setDirectEditGroup]      = useState(null); // grp.id
  const [directEditGf,         setDirectEditGf]         = useState({});
  const setDEG = (k, v) => setDirectEditGf(p => ({ ...p, [k]: v }));
  const [directEditSaving,     setDirectEditSaving]     = useState(false);
  const [directEditMsg,        setDirectEditMsg]        = useState({ id: null, text: "", ok: false });
  const [archiveSafety,        setArchiveSafety]        = useState({}); // { [grpId]: {safe,activeRound,unsettledMembers} }
  // Savings lifecycle state
  const [startRoundGid,        setStartRoundGid]        = useState(null);  // group id for start-round modal
  const [startRoundTarget,     setStartRoundTarget]     = useState("");
  const [startRoundDeadline,   setStartRoundDeadline]   = useState("");
  const [startRoundMsg,        setStartRoundMsg]        = useState({ id: null, text: "", ok: false });
  const [startRoundSaving,     setStartRoundSaving]     = useState(false);
  const [closingRoundGid,      setClosingRoundGid]      = useState(null);  // eslint-disable-line no-unused-vars
  const [savingsDetails,       setSavingsDetails]       = useState({});    // { [grpId]: { loading, pot, members } }
  const [expandedSavingsGid,   setExpandedSavingsGid]  = useState(null);  // group id with expanded member list
  const [savingsDashGid,       setSavingsDashGid]       = useState(null);  // group id for savings dashboard view
  const [archiveSafetyLoading, setArchiveSafetyLoading] = useState(null); // grp.id being checked
  // Rotation management
  const [showRotation,   setShowRotation]   = useState(null); // group object
  const [rotationData,   setRotationData]   = useState(null);
  const [rotationLoading, setRotationLoading] = useState(false);

  const [banks,               setBanks]               = useState([]);
  const [clientBankResolving, setClientBankResolving] = useState(false);
  const [clientResolvedName,  setClientResolvedName]  = useState("");
  const [clientBankErr,       setClientBankErr]       = useState("");

  // Reactivation requests — pending client account reactivation from archived state
  const [reactivationRequests, setReactivationRequests] = useState([]);
  const [reactivationBusy,     setReactivationBusy]     = useState(null); // request id being processed
  const [reactivationMsg,      setReactivationMsg]      = useState({ id: null, text: "", ok: false });
  const [rejectingReactivation, setRejectingReactivation] = useState(null); // request id
  const [rejectReactivationNote, setRejectReactivationNote] = useState("");

  const [f, setF] = useState(BLANK);
  // The business's default registration fee pre-fills a new client's fee (the owner can still change or clear it)
  const [defaultRegFee, setDefaultRegFee] = useState(0);
  useEffect(() => {
    if (showAdd && defaultRegFee > 0) setF(p => (p.registration_charge === "" ? { ...p, registration_charge: String(defaultRegFee) } : p));
  }, [showAdd, defaultRegFee]);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (autoOpen && canDo(plan, "aso")) {
      setShowAdd(true);
      onAutoOpened?.();
    } else if (autoOpen) {
      onAutoOpened?.();
    }
  }, [autoOpen, onAutoOpened, plan]);

  useEffect(() => {
    if ((!showAdd && !showGroupAdd && !editingGroup) || banks.length > 0) return;
    bankLookup("list-banks")
      .then(({ data }) => { if (data?.data) setBanks(data.data); })
      .catch(() => {});
  }, [showAdd, showGroupAdd, editingGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch active cycles for all clients when Today's Collection opens
  useEffect(() => {
    if (!showCollection || asoClients.length === 0) return;
    const activeClientIds = asoClients.filter(c => c.status === "active").map(c => c.id);
    if (activeClientIds.length === 0) return;
    supabase.from("ajo_cycles")
      .select("id, client_id, label, commission_model")
      .in("client_id", activeClientIds)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const map = {};
        for (const cyc of (data || [])) {
          if (!map[cyc.client_id]) map[cyc.client_id] = [];
          map[cyc.client_id].push(cyc);
        }
        setCollectionCycles(map);
      })
      .catch(() => {});
  }, [showCollection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch group memberships and cycles for the selected client when the
  // Fund/Pay modal opens — needed for the target picker in BOTH modes.
  // Withdraw mode also needs COMPLETED cycles (that's exactly when a
  // first_period cycle becomes withdrawable), so the status filter is wider
  // than contribute mode's active-only list.
  useEffect(() => {
    if (!selected?.id || (action !== "contribute" && action !== "withdraw")) {
      setSelectedClientMems([]); setContributeGroupId(null);
      setSelectedCycles([]); setContributeCycleId(null);
      setActiveEsusuRoundIds(new Set());
      return;
    }
    // Resolve which of the fetched memberships' esusu (rotating) groups
    // currently have an active rotation round — a group with none has
    // nothing to contribute to or withdraw from right now, so it shouldn't
    // be offered as a target at all. One extra batched query, not N+1.
    const resolveActiveRounds = async (mems) => {
      const rotatingIds = (mems || [])
        .filter(m => m.ajo_groups?.group_mode === "rotating")
        .map(m => m.group_id);
      if (rotatingIds.length === 0) { setActiveEsusuRoundIds(new Set()); return; }
      const { data: rounds } = await supabase.from("ajo_group_rounds")
        .select("group_id").in("group_id", rotatingIds).eq("status", "active");
      setActiveEsusuRoundIds(new Set((rounds || []).map(r => r.group_id)));
    };
    supabase.from("aso_client_group_memberships")
      .select("group_id, status, ajo_groups(id, name, group_mode, round_status)")
      .eq("client_id", selected.id)
      .eq("status", "active")
      .then(({ data }) => {
        setSelectedClientMems(data || []);
        resolveActiveRounds(data);
        // Backwards compat: if junction table is empty, fall back to ajo_group_id
        if ((!data || data.length === 0) && selected.ajo_group_id) {
          const sg = groups.find(g => g.id === selected.ajo_group_id);
          if (sg) {
            const mems = [{ group_id: sg.id, status: "active", ajo_groups: sg }];
            setSelectedClientMems(mems);
            resolveActiveRounds(mems);
          }
        }
      })
      .catch(() => {
        if (selected.ajo_group_id) {
          const sg = groups.find(g => g.id === selected.ajo_group_id);
          if (sg) {
            const mems = [{ group_id: sg.id, status: "active", ajo_groups: sg }];
            setSelectedClientMems(mems);
            resolveActiveRounds(mems);
          }
        }
      });
    supabase.from("ajo_cycles")
      .select("id, label, commission_model, status")
      .eq("client_id", selected.id)
      .in("status", action === "withdraw" ? ["active", "completed"] : ["active"])
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const cycs = data || [];
        setSelectedCycles(cycs);
        setContributeCycleId(cycs.length === 1 ? cycs[0].id : null);
      })
      .catch(() => {});
  }, [selected?.id, action]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live saved/withdrawn/available/locked for whatever target is currently
  // selected in the Fund/Pay modal — same ajo_entity_stats RPC the client
  // portal uses, so the owner sees identical numbers.
  const [targetStats,        setTargetStats]        = useState(null);
  const [targetStatsLoading, setTargetStatsLoading]  = useState(false);
  const targetStatsReqRef = useRef(0);
  useEffect(() => {
    const cid = contributeCtx === "personal_savings" ? contributeCycleId : null;
    const gid = contributeCtx !== "personal_savings" ? contributeGroupId : null;
    const reqId = ++targetStatsReqRef.current;
    if (!selected?.id || (!cid && !gid)) { setTargetStats(null); return; }
    setTargetStatsLoading(true);
    supabase.functions.invoke("ajo-portal", {
      body: { action: "get-entity-stats", client_id: selected.id, cycle_id: cid, group_id: gid },
    }).then(({ data }) => { if (targetStatsReqRef.current === reqId) setTargetStats(data?.stats || null); })
      .catch(() => { if (targetStatsReqRef.current === reqId) setTargetStats(null); })
      .finally(() => { if (targetStatsReqRef.current === reqId) setTargetStatsLoading(false); });
  }, [selected?.id, contributeCtx, contributeGroupId, contributeCycleId]);

  const resolveClientAccount = async () => {
    if (!f.account_number || !f.bank_code) return;
    setClientBankResolving(true); setClientBankErr(""); setClientResolvedName("");
    try {
      const { data, error } = await bankLookup("resolve-account", { account_number: f.account_number, bank_code: f.bank_code });
      if (error || !data?.status) throw new Error(data?.message || t("ajo.couldNotVerifyAccount"));
      const name = data.data?.account_name || "";
      setClientResolvedName(name);
      set("account_name", name);
    } catch (e) {
      setClientBankErr(e.message || t("ajo.accountVerificationFailed"));
    } finally {
      setClientBankResolving(false);
    }
  };

  const reloadWithdrawalRequests = async () => {
    try {
      const { data, error } = await supabase
        .from("ajo_withdrawal_requests")
        .select("*, aso_clients(full_name, email, membership_number, current_balance, total_withdrawn, bank_code, account_number, account_name, bank_name, withdrawal_bank_code, withdrawal_account_number, withdrawal_bank_name, withdrawal_account_name, commission_model, commission_percent), ajo_cycles(label), ajo_groups(name, group_mode)")
        .in("status", ["pending", "held_24h"])
        .order("requested_at", { ascending: false });
      if (error) throw error;
      setWithdrawalRequests(data || []);
      setWdError(null);
    } catch {
      setWdError(t("ajo.couldntRefreshTapRetry"));
    }
  };

  // Approved withdrawals whose actual wallet transfer never landed — either
  // failed at settlement (e.g. wallet balance was short that morning) or the
  // cron's scheduled date has already passed with nothing settling it. The
  // settlement cron only ever looks at status='pending' rows, so a 'failed'
  // row is otherwise stuck forever with zero visibility.
  const reloadStuckPayouts = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("ajo_wallet_payouts")
        .select("id, amount_kobo, status, scheduled_date, failure_reason, client_id, aso_clients(full_name)")
        .or(`status.eq.failed,and(status.eq.pending,scheduled_date.lt.${today})`)
        .order("scheduled_date", { ascending: true });
      if (error) throw error;
      setStuckPayouts(data || []);
    } catch {
      // Non-critical — silently skip, the withdrawal-requests list still works.
    }
  };

  const handleRetryPayout = async (payoutId) => {
    setRetryingPayoutId(payoutId);
    try {
      const { data, error } = await supabase.functions.invoke("ajo-write", {
        body: { action: "retry_wallet_payout", payout_id: payoutId },
      });
      if (error || !data?.ok) throw new Error(data?.error || t("ajo.retryFailedTryAgain"));
      await reloadStuckPayouts();
    } catch (e) {
      setApproveError({ id: payoutId, text: e.message || t("ajo.retryFailedTryAgain") });
    } finally {
      setRetryingPayoutId(null);
    }
  };

  const reloadPendingDeposits = async () => {
    try {
      const { data, error } = await supabase
        .from("ajo_contributions")
        .select("id, aso_client_id, owner_id, amount, type, status, created_at, payment_method, notes, proof_url, contribution_context, recorded_by, cycle_id, contribution_source, receipt_ref, balance_after, aso_clients(full_name, email, membership_number)")
        .eq("status", "pending")
        .eq("type", "contribution")
        .or("contribution_source.neq.staff_collection,contribution_source.is.null")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setPendingDeposits(data || []);
      setDepError(null);
    } catch {
      setDepError(t("ajo.couldntRefreshTapRetry"));
    }
  };

  const reloadPendingStaffContribs = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from("ajo_contributions")
      .select("id, aso_client_id, amount, created_at, recorded_by, contribution_context, aso_clients(full_name, membership_number)")
      .eq("owner_id", profile.id)
      .eq("status", "pending")
      .eq("contribution_source", "staff_collection")
      .order("created_at", { ascending: true });
    setPendingStaffContribs(data || []);
  };

  const loadGroups = async ({ silent = false } = {}) => {
    if (!profile?.id) return;
    if (!silent) setGroupsLoading(true);
    try {
      const BASE_SELECT = "id, owner_id, name, description, is_active, group_mode, contribution_amount, contribution_frequency, percentage_charge, privacy_show_names, privacy_show_amounts, created_at";
      const LIFECYCLE   = ", round_status, target_amount, target_deadline, started_at, closed_at";
      const { data: grps, error } = await supabase
        .from("ajo_groups")
        .select(BASE_SELECT + LIFECYCLE)
        .eq("owner_id", profile.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) {
        console.error("loadGroups (full):", error);
        // Lifecycle columns may not be in schema cache yet — fall back to base columns
        const { data: fallback, error: e2 } = await supabase
          .from("ajo_groups")
          .select(BASE_SELECT)
          .eq("owner_id", profile.id)
          .eq("is_active", true)
          .order("created_at", { ascending: true });
        if (e2) console.error("loadGroups (fallback):", e2);
        setGroups(fallback || []);
      } else {
        setGroups(grps || []);
      }
    } catch (e) {
      console.error("loadGroups:", e);
    } finally {
      setGroupsLoading(false);
    }
  };

  // AJ-PIN-01: Group financial edits/deletes require admin approval via submit_approval_request RPC
  // (stronger than PIN — async external gate). Non-financial fields (name/description/privacy) go
  // through submitDirectEdit — no approval needed. PIN boundary is satisfied; no PIN change required.
  const loadGroupApprovals = async () => {
    try {
      const { data } = await supabase
        .from("admin_approval_requests")
        .select("id, request_type, target_id, status, requested_at")
        .in("request_type", ["group_edit", "group_delete"])
        .eq("status", "pending");
      setGroupApprovals(data || []);
    } catch (e) {
      console.error("loadGroupApprovals:", e);
    }
  };

  const loadReactivationRequests = async () => {
    if (!profile?.id) return;
    try {
      const { data } = await supabase
        .from("ajo_reactivation_requests")
        .select("id, client_id, client_name, reason, status, created_at")
        .eq("owner_id", profile.id)
        .in("status", ["pending", "owner_approved"])
        .order("created_at", { ascending: false });
      setReactivationRequests(data || []);
    } catch (e) {
      console.error("loadReactivationRequests:", e);
    }
  };

  const submitGroupEditRequest = async (grp) => {
    if (!groupApprReason.trim()) return;
    setGroupApprSubmitting(true);
    try {
      const payload = {
        old: {
          contribution_amount:    grp.contribution_amount,
          contribution_frequency: grp.contribution_frequency,
          group_mode:             grp.group_mode,
          percentage_charge:      grp.percentage_charge,
        },
        new: {
          contribution_amount:    editGf.contribution_amount != null ? Number(editGf.contribution_amount) : grp.contribution_amount,
          contribution_frequency: editGf.contribution_frequency || grp.contribution_frequency,
          group_mode:             editGf.group_mode             || grp.group_mode,
          percentage_charge:      editGf.percentage_charge != null ? Number(editGf.percentage_charge) : grp.percentage_charge,
        },
      };
      const { error } = await supabase.rpc("submit_approval_request", {
        p_type:      "group_edit",
        p_target_id: grp.id,
        p_payload:   payload,
        p_reason:    groupApprReason.trim(),
      });
      if (error) throw error;
      setGroupApprMsg({ id: grp.id, text: t("ajo.requestSubmittedEmail"), ok: true });
      setEditingGroup(null);
      setGroupApprReason("");
      loadGroupApprovals();
    } catch (e) {
      setGroupApprMsg({ id: grp.id, text: e?.message || t("ajo.failedSubmitRequest"), ok: false });
    } finally {
      setGroupApprSubmitting(false);
    }
  };

  const submitGroupDeleteRequest = async (grp) => {
    if (!groupApprReason.trim()) return;
    setGroupApprSubmitting(true);
    const clientCount = asoClients.filter(c => c.ajo_group_id === grp.id).length;
    try {
      const payload = {
        name:                  grp.name,
        description:           grp.description || "",
        group_mode:            grp.group_mode,
        contribution_amount:   grp.contribution_amount,
        contribution_frequency:grp.contribution_frequency,
        member_count:          clientCount,
      };
      const { error } = await supabase.rpc("submit_approval_request", {
        p_type:      "group_delete",
        p_target_id: grp.id,
        p_payload:   payload,
        p_reason:    groupApprReason.trim(),
      });
      if (error) throw error;
      setGroupApprMsg({ id: grp.id, text: t("ajo.archiveRequestSubmittedEmail"), ok: true });
      setDeletingGroup(null);
      setGroupApprReason("");
      loadGroupApprovals();
    } catch (e) {
      setGroupApprMsg({ id: grp.id, text: e?.message || t("ajo.failedSubmitRequest"), ok: false });
    } finally {
      setGroupApprSubmitting(false);
    }
  };

  const cancelGroupRequest = async (requestId, grpId) => {
    try {
      const { error } = await supabase.rpc("cancel_approval_request", { p_request_id: requestId });
      if (error) throw error;
      setGroupApprMsg({ id: grpId, text: t("ajo.requestCancelled"), ok: true });
      loadGroupApprovals();
    } catch (e) {
      setGroupApprMsg({ id: grpId, text: e?.message || t("ajo.failedToCancel"), ok: false });
    }
  };

  const submitDirectEdit = async (grp) => {
    setDirectEditSaving(true);
    setDirectEditMsg({ id: null, text: "", ok: false });
    try {
      const { error } = await supabase
        .from("ajo_groups")
        .update({
          name:                 directEditGf.name?.trim()         || grp.name,
          description:          directEditGf.description?.trim()  ?? grp.description ?? "",
          privacy_show_names:   directEditGf.privacy_show_names   ?? grp.privacy_show_names,
          privacy_show_amounts: directEditGf.privacy_show_amounts ?? grp.privacy_show_amounts,
          updated_at:           new Date().toISOString(),
        })
        .eq("id", grp.id);
      if (error) throw error;
      setDirectEditMsg({ id: grp.id, text: t("ajo.groupDetailsUpdated"), ok: true });
      setDirectEditGroup(null);
      loadGroups();
    } catch (e) {
      setDirectEditMsg({ id: grp.id, text: e?.message || t("ajo.failedToSave"), ok: false });
    } finally {
      setDirectEditSaving(false);
    }
  };

  const openArchiveRequest = async (grp) => {
    setDeletingGroup(grp.id);
    setGroupApprReason("");
    setGroupApprMsg({ id: null, text: "", ok: false });
    setArchiveSafetyLoading(grp.id);
    try {
      const [roundRes, clientsRes] = await Promise.all([
        grp.group_mode === "rotating"
          ? supabase.from("ajo_group_rounds").select("id").eq("group_id", grp.id).eq("status", "active").limit(1)
          : Promise.resolve({ data: [] }),
        supabase.from("aso_clients").select("id, full_name, current_balance").eq("ajo_group_id", grp.id).gt("current_balance", 0),
      ]);
      const activeRound      = (roundRes.data?.length ?? 0) > 0;
      const unsettledMembers = clientsRes.data || [];
      setArchiveSafety(prev => ({
        ...prev,
        [grp.id]: { safe: !activeRound && unsettledMembers.length === 0, activeRound, unsettledMembers },
      }));
    } catch (e) {
      console.error("archiveSafety:", e);
      setArchiveSafety(prev => ({ ...prev, [grp.id]: { safe: false, activeRound: false, unsettledMembers: [], error: true } }));
    } finally {
      setArchiveSafetyLoading(null);
    }
  };

  const loadRotation = async (groupId) => {
    setRotationLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ajo-portal", {
        body: { action: "get-rotation", group_id: groupId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Failed to load rotation");
      setRotationData(data);
    } catch (e) {
      console.error("loadRotation:", e);
      setRotationData(null);
    } finally {
      setRotationLoading(false);
    }
  };

  const openRotation = (grp) => {
    setShowRotation(grp);
    setRotationData(null);
    loadRotation(grp.id);
  };

  const loadSavingsDetails = async (grpId, startedAt) => {
    setSavingsDetails(p => ({ ...p, [grpId]: { ...(p[grpId] || {}), loading: true } }));
    const since = startedAt || "1970-01-01";
    const { data: rows } = await supabase
      .from("aso_client_group_memberships")
      .select("client_id, status, aso_clients(id, full_name, current_balance)")
      .eq("group_id", grpId)
      .eq("status", "active");
    const members = rows || [];
    const { data: contribRows } = await supabase
      .from("ajo_contributions")
      .select("aso_client_id, amount")
      .eq("group_id", grpId)
      .eq("contribution_context", "group_savings")
      .eq("type", "contribution")
      .eq("status", "completed")
      .gte("created_at", since);
    const totByClient = {};
    (contribRows || []).forEach(r => {
      totByClient[r.aso_client_id] = (totByClient[r.aso_client_id] || 0) + Number(r.amount);
    });
    const pot = Object.values(totByClient).reduce((s, v) => s + v, 0);
    const memberList = members.map(m => ({
      client_id:   m.client_id,
      full_name:   m.aso_clients?.full_name || "—",
      contributed: totByClient[m.client_id] || 0,
    }));
    setSavingsDetails(p => ({ ...p, [grpId]: { loading: false, pot, members: memberList } }));
  };

  const handleStartSavingsRound = async (grpId) => {
    const target   = parseFloat(startRoundTarget);
    const deadline = startRoundDeadline;
    if (!target || target <= 0) { setStartRoundMsg({ id: grpId, text: t("ajo.enterValidTarget"), ok: false }); return; }
    if (!deadline)              { setStartRoundMsg({ id: grpId, text: t("ajo.selectDeadlineDate"), ok: false }); return; }
    setStartRoundSaving(true);
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "start_savings_round", group_id: grpId, target_amount: target, target_deadline: deadline },
    });
    setStartRoundSaving(false);
    if (error || !data?.ok) {
      let msg = data?.error || error?.message || t("ajo.failedStartRound");
      if (!data?.error && error?.context) {
        try { const b = await error.context.json(); msg = b?.error || msg; } catch {}
      }
      setStartRoundMsg({ id: grpId, text: msg, ok: false });
      return;
    }
    setStartRoundGid(null);
    setStartRoundTarget(""); setStartRoundDeadline("");
    setStartRoundMsg({ id: grpId, text: t("ajo.savingsRoundStarted"), ok: true });
    setTimeout(() => setStartRoundMsg({ id: null, text: "", ok: false }), 4000);
    await loadGroups();
    loadSavingsDetails(grpId, data?.started_at);
  };

  const handleCloseSavingsRound = (grpId) => {
    setClosingRoundGid(null);
    setTxnPin({
      title: t("ajo.confirmGroupClose"),
      description: t("ajo.confirmGroupCloseDesc"),
      onApprove: async (pin) => {
        const { data, error } = await supabase.functions.invoke("ajo-write", {
          body: { action: "close_savings_round", group_id: grpId, pin },
        });
        setTxnPin(null);
        if (error || !data?.ok) {
          setActionResult({ type: "failure", title: t("ajo.closeRoundFailed"), reason: data?.error || error?.message || t("ajo.couldntCloseRound") });
          return;
        }
        setActionResult({ type: "success", title: t("ajo.savingsRoundClosed") });
        await loadGroups();
        setSavingsDetails(p => ({ ...p, [grpId]: undefined }));
      },
    });
  };

  const handleReleaseSavingsMember = (grpId, clientId, clientName) => {
    setTxnPin({
      title: t("ajo.releaseMember"),
      description: t("ajo.releaseMemberDesc", { name: clientName }),
      onApprove: async (pin) => {
        const { data, error } = await supabase.functions.invoke("ajo-write", {
          body: { action: "release_savings_member", group_id: grpId, client_id: clientId, pin },
        });
        setTxnPin(null);
        if (error || !data?.ok) {
          setActionResult({ type: "failure", title: t("ajo.releaseFailed"), counterparty: clientName, reason: data?.error || error?.message || t("ajo.couldntReleaseMember") });
          return;
        }
        setActionResult({ type: "success", title: t("ajo.memberReleased"), counterparty: clientName });
        const grp = groups.find(g => g.id === grpId);
        loadSavingsDetails(grpId, grp?.started_at);
      },
    });
  };

  const handleStartRound = async (turns, payoutSlotsPerRound) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "start_round", group_id: showRotation.id, turns, payout_slots_per_round: payoutSlotsPerRound || 1 },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || t("ajo.failedStartRound"));
    await loadRotation(showRotation.id);
  };

  const handleExecutePayout = async (turnId, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "execute_payout", turn_id: turnId, pin },
    });
    if (error) {
      let msg = error?.message || t("ajo.payoutFailed");
      if (error?.context) { try { const b = await error.context.json(); msg = b?.error || msg; } catch {} }
      throw new Error(msg);
    }
    return data; // caller checks data.ok — blocked payouts return ok:false with details
  };

  const handleSkipTurn = async (turnId, reason, moveToEnd, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "skip_turn", turn_id: turnId, reason, move_to_end: moveToEnd, pin },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || t("ajo.skipFailed"));
  };

  const handleReorderTurns = async (roundId, newOrder, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "reorder_turns", round_id: roundId, new_order: newOrder, pin },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || t("ajo.reorderFailed"));
  };

  const handleCloseRound = async (roundId) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "close_round", round_id: roundId },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || t("ajo.failedCloseRound"));
    return data;
  };

  const saveGroup = async () => {
    if (!gf.name) { setGroupError(t("ajo.groupNameRequired")); return; }
    if (gf.contribution_frequency === "custom" && !(Number(gf.custom_interval_days) > 0)) {
      setGroupError(t("ajo.enterDaysBetween"));
      return;
    }
    if (!profile?.id) return;
    const asoLimit = featureLimit(plan, "aso");
    if (asoLimit !== Infinity && groups.length >= asoLimit) {
      setGroupError(`${t(asoLimit !== 1 ? "ajo.planGroupLimitMany" : "ajo.planGroupLimitOne", { n: asoLimit })}${canSellPlans() ? " " + t("ajo.upgradeCreateMore") : ""}`);
      onUpgrade?.();
      return;
    }
    setGroupSaving(true); setGroupError("");
    try {
      const { data, error } = await supabase.functions.invoke("ajo-portal", {
        body: {
          action: "create-group",
          owner_id: profile.id,
          name: gf.name.trim(),
          description: gf.description || null,
          contribution_amount: gf.contribution_amount ? Number(gf.contribution_amount) : null,
          contribution_frequency: gf.contribution_frequency || "monthly",
          custom_interval_days: gf.contribution_frequency === "custom" ? Number(gf.custom_interval_days) : null,
          group_mode: gf.group_mode || "savings",
          privacy_show_names:   gf.privacy_show_names  !== false,
          privacy_show_amounts: gf.privacy_show_amounts === true,
        },
      });
      if (error || data?.error) {
        let msg = data?.error || error?.message || t("ajo.failedCreateGroup");
        if (!data?.error && error?.context) {
          try { const b = await error.context.json(); msg = b?.error || msg; } catch {}
        }
        throw new Error(msg);
      }
      const newGroup = data.group;
      if (newGroup) {
        setGroups(prev => [...prev, newGroup]);
      } else {
        loadGroups(); // edge fn returned no row — fetch from DB to recover
      }
      toast({ type: "success", title: t("ajo.groupCreated"), body: gf.name.trim() });
      setShowGroupAdd(false);
      setGf(BLANK_GROUP);
    } catch (e) {
      setGroupError(e.message || t("ajo.failedSaveGroup"));
    } finally {
      setGroupSaving(false);
    }
  };

  useEffect(() => {
    if (!canDo(plan, "aso")) return;
    reloadWithdrawalRequests();
    reloadStuckPayouts();
    reloadPendingDeposits();
    loadGroups();
    loadGroupApprovals();
    loadReactivationRequests();
  }, [plan, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load granular ajo permissions when rendering in a staff context
  useEffect(() => {
    if (!staffId) {
      setStaffAjoPerms(null);
      reloadPendingStaffContribs();
      return;
    }
    supabase
      .from("staff_permissions")
      .select("can_view, can_create, ajo_manage_clients")
      .eq("staff_id", staffId)
      .eq("module", "aso")
      .maybeSingle()
      .then(({ data }) => setStaffAjoPerms(data || { can_view: false, can_create: false, ajo_manage_clients: false }));
  }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: new withdrawal requests from clients ─────────────────────
  useEffect(() => {
    if (!canDo(plan, "aso")) return;
    let rtReady = false;
    const channel = supabase.channel("ajo_withdrawal_requests_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ajo_withdrawal_requests" },
        () => reloadWithdrawalRequests())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (rtReady) reloadWithdrawalRequests();
          else rtReady = true;
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: new deposit claims / owner-recorded pending contributions ──
  useEffect(() => {
    if (!canDo(plan, "aso")) return;
    let rtReady = false;
    const channel = supabase.channel("ajo_pending_deposits_rt")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "ajo_contributions",
      }, () => reloadPendingDeposits())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (rtReady) reloadPendingDeposits();
          else rtReady = true;
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume-on-foreground — reload active queues after backgrounding so approval/reject
  // lists are always fresh without polling. 10 s debounce prevents double-fire.
  const lastAsoResumeRef = useRef(0);
  useEffect(() => {
    const onResume = () => {
      if (Date.now() - lastAsoResumeRef.current < 10_000) return;
      lastAsoResumeRef.current = Date.now();
      reloadWithdrawalRequests();
      reloadPendingDeposits();
    };
    const onVisibility = () => { if (!document.hidden) onResume(); };
    document.addEventListener("visibilitychange", onVisibility);
    let appListener;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener("appStateChange", ({ isActive }) => { if (isActive) onResume(); })
        .then(l => { appListener = l; });
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      appListener?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-action capability flags (null staffAjoPerms = owner = all true)
  const canContribute     = !staffAjoPerms || staffAjoPerms.can_create;
  const canWithdraw       = !staffAjoPerms;  // owner-only
  const canConfirmDeposit = !staffAjoPerms;  // owner-only
  const canManageClients  = !staffAjoPerms || staffAjoPerms.ajo_manage_clients;
  const isOwner           = !staffAjoPerms;

  // Aggregate stats
  const totalBal      = asoClients.reduce((s, c) => s + (c.current_balance || 0), 0);
  const totalSaved    = asoClients.reduce((s, c) => s + (c.total_saved     || 0), 0);
  const overdueList   = asoClients.filter(isOverdue);
  const groupClients  = asoClients.filter(isGroupAccount);
  const indivClients  = asoClients.filter(c => !isGroupAccount(c));

  // Filtered list
  const filtered = asoClients
    .filter(c => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (c.full_name || "").toLowerCase().includes(q) || (c.phone || "").includes(q);
    })
    .filter(c => {
      if (filter === "pending")  return c.status === "pending_approval";
      if (filter === "active")   return c.status === "active" && !isOverdue(c);
      if (filter === "overdue")  return isOverdue(c);
      if (filter === "inactive") return c.status !== "active" && c.status !== "pending_approval";
      if (filter === "groups")   return isGroupAccount(c);
      return true;
    })
    .filter(c => { if (!dueBefore) return true; const due = effectiveNextDue(c); return !!due && due <= dueBefore; });

  const pendingRegList = asoClients.filter(c => c.status === "pending_approval");

  const CHIPS = [
    { key: "all",      label: t("ajo.filterAll"),      count: asoClients.length },
    { key: "pending",  label: t("ajo.chipNew"),        count: pendingRegList.length },
    { key: "active",   label: t("ajo.chipActive"),     count: asoClients.filter(c => c.status === "active" && !isOverdue(c)).length },
    { key: "overdue",  label: t("ajo.chipOverdue"),    count: overdueList.length },
    { key: "inactive", label: t("ajo.chipInactive"),   count: asoClients.filter(c => c.status !== "active" && c.status !== "pending_approval").length },
    { key: "groups",   label: t("ajo.groups"),         count: groupClients.length },
  ].filter(ch => ch.key === "all" || ch.count > 0);

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const genClientPwd = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
    const vals  = new Uint32Array(12);
    crypto.getRandomValues(vals);
    return Array.from(vals, n => chars[n % chars.length]).join("");
  };

  const provisionClientLogin = async (clientRecord, password = null) => {
    // Only include password when explicitly provided (password resets)
    // For new accounts, edge function generates the password internally
    const fnBody = { clientId: clientRecord.id };
    if (password) fnBody.password = password;

    const { data, error: fnError } = await supabase.functions.invoke(
      "manage-ajo-client-account",
      { body: fnBody },
    );
    if (!fnError) {
      if (data?.error) throw new Error(data.error);
      return data;
    }
    const notDeployed =
      fnError.name === "FunctionsFetchError" ||
      (fnError.message || "").toLowerCase().includes("failed to send") ||
      (fnError.message || "").toLowerCase().includes("unreachable");
    if (!notDeployed) {
      let msg = fnError.message;
      try {
        if (fnError.name === "FunctionsHttpError") {
          const body = await fnError.context.json();
          if (body?.error) msg = body.error;
        }
      } catch (_) {}
      throw new Error(msg);
    }
    // Fallback: signUp if edge function not yet deployed
    const fallbackPwd = password || genClientPwd();
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: clientRecord.email,
      password: fallbackPwd,
      options: {
        data: {
          full_name:            clientRecord.full_name,
          account_type:         "ajo_client",
          aso_client_id:        clientRecord.id,
          owner_id:             clientRecord.user_id,
          must_change_password: true,
          email_verified:       false,
        },
      },
    });
    if (signUpErr) throw signUpErr;
    if (signUpData.user?.id) {
      await supabase.from("aso_clients").update({ client_user_id: signUpData.user.id }).eq("id", clientRecord.id);
    }
    return { success: true, created: true };
  };

  const closeClientCredentials = () => {
    setCreatedClient(null);
    setCopiedField(null);
  };

  const resetAdd = () => {
    setShowAdd(false); setF(BLANK);
    setPhotoFile(null); setPhotoPreview(null);
    setAddError("");
    setClientResolvedName(""); setClientBankErr("");
  };

  const handleAdd = async () => {
    if (!f.full_name) { setAddError(t("ajo.fullNameRequired")); return; }
    if (!f.email)     { setAddError(t("ajo.emailRequiredPortal")); return; }
    setAddError("");
    setAdding(true);
    const { data, error } = await addAsoClient({
      ...f,
      contribution_amount:    parseFloat(f.contribution_amount    || 0),
      registration_charge:    parseFloat(f.registration_charge    || 0),
      withdrawal_fee_percent: 0,
      commission_model:       f.commission_model   || "none",
      commission_percent:     f.commission_model === "percent" ? parseFloat(f.commission_percent || 0) || null : null,
      status:                 "active",
      next_contribution_date: today(),
    });
    if (!error && data && photoFile) {
      try {
        const url = await uploadPhoto(photoFile, data.id);
        await updateAsoClient(data.id, { profile_image_url: url });
      } catch {
        setClientSubAcctErr(t("ajo.clientCreatedPhotoFailed"));
      }
    }
    if (!error && data) {
      try {
        await provisionClientLogin(data);
        resetAdd();
        setAddedClientEmail(data.email);
      } catch (provErr) {
        await supabase.from("aso_clients").delete().eq("id", data.id);
        setAddError(provErr.message || t("ajo.failedCreateClientLogin"));
      }
    } else {
      setAddError(error?.message || t("ajo.failedAddClient"));
    }
    setAdding(false);
  };

  const copyField = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const handleCopy = (msg) => {
    navigator.clipboard.writeText(msg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleResetPwd = async (clientRecord) => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
    const vals  = new Uint32Array(12);
    crypto.getRandomValues(vals);
    const newPwd = Array.from(vals, n => chars[n % chars.length]).join("");
    try {
      await provisionClientLogin(clientRecord, newPwd);
      setClientProf(null);
      setCreatedClient({ ...clientRecord, _password: newPwd, _isReset: true });
      return {};
    } catch (err) {
      return { error: err.message || t("ajo.failedResetPassword") };
    }
  };

  // Detects the Supabase JS SDK's FunctionsFetchError — thrown when the Android
  // WebView 10 s fetch timeout fires before the edge function responds.  The DB
  // write has already committed at this point, so this is NOT a real failure.
  const isFetchTimeout = (err) =>
    !!err && (
      err.name === "FunctionsFetchError" ||
      (typeof err.message === "string" && err.message.includes("Failed to send a request"))
    );

  const handleApproveRequest = async (req, pin, onResult) => {
    setProcessingId(req.id);
    const clientName = req.aso_clients?.full_name;
    try {
      const { data: writeData, error: writeErr } = await supabase.functions.invoke("ajo-write", {
        body: {
          action:       "record_withdrawal",
          client_id:    req.aso_client_id,
          gross_amount: req.amount,
          pin,
          request_id:   req.id,
        },
      });
      if (isFetchTimeout(writeErr)) {
        setApproveError({ id: null, text: "" });
        onResult?.({ type: "success", title: t("ajo.withdrawalApproved"), amount: req.net_amount || req.amount, counterparty: clientName, note: t("ajo.verifyingConfirmWithClient") });
        return;
      }
      if (writeErr || !writeData?.ok) {
        const errMsg = writeData?.error || writeErr?.message || t("ajo.approvalFailedMsg");
        setApproveError({ id: req.id, text: errMsg });
        onResult?.({ type: "failure", title: t("ajo.approvalFailed"), reason: errMsg });
        return;
      }
      setApproveError({ id: null, text: "" });
      onResult?.({ type: "success", title: t("ajo.withdrawalApproved"), amount: req.net_amount || req.amount, counterparty: clientName });
    } catch (e) {
      if (isFetchTimeout(e)) {
        onResult?.({ type: "success", title: t("ajo.withdrawalApproved"), amount: req.net_amount || req.amount, counterparty: clientName, note: t("ajo.verifyingConfirmWithClient") });
      } else {
        setApproveError({ id: req.id, text: e?.message || t("ajo.approvalFailedMsg") });
        onResult?.({ type: "failure", title: t("ajo.approvalFailed"), reason: e?.message || t("ajo.approvalFailedTryAgain") });
      }
    } finally {
      reloadWithdrawalRequests();
      setProcessingId(null);
    }
  };

  const handleRejectRequest = async (req, reason) => {
    setProcessingId(req.id);
    try {
      const { data: rwData, error: rwErr } = await supabase.functions.invoke("ajo-write", {
        body: { action: "reject_withdrawal_request", request_id: req.id, reason: reason || undefined },
      });
      if (!isFetchTimeout(rwErr) && (rwErr || !rwData?.ok)) {
        const msg = rwData?.error || rwErr?.message || t("ajo.rejectionFailedTryAgain");
        console.error("Reject failed:", msg);
        flashDeposit("err", msg);
      } else {
        flashDeposit("ok", t("ajo.withdrawalRejectedNotified"));
      }
    } catch (e) {
      if (isFetchTimeout(e)) {
        flashDeposit("ok", t("ajo.rejectedReloading"));
      } else {
        console.error("Reject failed:", e);
        flashDeposit("err", e?.message || t("ajo.rejectionFailedTryAgain"));
      }
    } finally {
      reloadWithdrawalRequests();
      setProcessingId(null);
    }
  };

  const flashDeposit = (type, msg) => {
    setDepositFeedback({ type, msg });
    setTimeout(() => setDepositFeedback(null), type === "err" ? 6000 : 4000);
  };

  const handleConfirmDeposit = async (claim, pin, onResult) => {
    setProcessingDepositId(claim.id);
    const clientName = claim.aso_clients?.full_name;
    try {
      const { data, error } = await supabase.functions.invoke("ajo-write", {
        body: { action: "confirm_manual_deposit", claim_id: claim.id, pin },
      });
      const amt = data?.amount || claim.amount;
      if (isFetchTimeout(error)) {
        onResult?.({ type: "success", title: t("ajo.depositConfirmed"), amount: amt, counterparty: clientName, note: t("ajo.verifyingBalanceUpdating") });
        return;
      }
      if (error || !data?.ok) throw new Error(data?.error || error?.message || t("ajo.confirmFailedMsg"));
      onResult?.({ type: "success", title: t("ajo.depositConfirmed"), amount: amt, counterparty: clientName });
    } catch (e) {
      if (isFetchTimeout(e)) {
        onResult?.({ type: "success", title: t("ajo.depositConfirmed"), counterparty: clientName, note: t("ajo.verifyingBalanceUpdating") });
      } else {
        onResult?.({ type: "failure", title: t("ajo.confirmFailed"), reason: e.message || t("ajo.couldntConfirmDeposit") });
      }
    } finally {
      reloadPendingDeposits();
      setProcessingDepositId(null);
    }
  };

  const handleRejectDeposit = async (claim, reason) => {
    setProcessingDepositId(claim.id);
    try {
      const { data, error } = await supabase.functions.invoke("ajo-write", {
        body: { action: "reject_manual_claim", claim_id: claim.id, reason },
      });
      if (isFetchTimeout(error)) {
        setRejectingDeposit(null);
        setRejectReason("");
        flashDeposit("ok", t("ajo.rejectedReloading"));
        return;
      }
      if (error || !data?.ok) throw new Error(data?.error || error?.message || t("ajo.rejectFailed"));
      setRejectingDeposit(null);
      setRejectReason("");
      flashDeposit("ok", t("ajo.depositClaimRejectedNotified"));
    } catch (e) {
      if (isFetchTimeout(e)) { setRejectingDeposit(null); setRejectReason(""); flashDeposit("ok", t("ajo.rejectedReloading")); }
      else flashDeposit("err", e.message || t("ajo.rejectFailed"));
    } finally {
      reloadPendingDeposits();
      setProcessingDepositId(null);
    }
  };

  const handleApproveContribution = async (dep, pin, onResult) => {
    setProcessingDepositId(dep.id);
    const clientName = dep.aso_clients?.full_name;
    try {
      const { data, error } = await supabase.functions.invoke("ajo-write", {
        body: { action: "approve_contribution", contribution_id: dep.id, owner_id: profile?.id, pin },
      });
      const amt = data?.amount || dep.amount;
      if (isFetchTimeout(error)) {
        onResult?.({ type: "success", title: t("ajo.contributionApproved"), amount: amt, counterparty: clientName, note: t("ajo.verifyingBalanceUpdating") });
        return;
      }
      if (error || !data?.ok) throw new Error(data?.error || error?.message || t("ajo.approveFailedMsg"));
      onResult?.({ type: "success", title: t("ajo.contributionApproved"), amount: amt, counterparty: clientName });
    } catch (e) {
      if (isFetchTimeout(e)) {
        onResult?.({ type: "success", title: t("ajo.contributionApproved"), counterparty: clientName, note: t("ajo.verifyingBalanceUpdating") });
      } else {
        onResult?.({ type: "failure", title: t("ajo.approveFailed"), reason: e.message || t("ajo.couldntApprove") });
      }
    } finally {
      reloadPendingDeposits();
      setProcessingDepositId(null);
    }
  };

  const reminderMsg = reminderFor ? buildReminderMsg(reminderFor, profile?.business_name) : "";
  const waLink = reminderFor?.phone
    ? `https://wa.me/${reminderFor.phone.replace(/\D/g, "")}?text=${encodeURIComponent(reminderMsg)}`
    : null;

  if (!canDo(plan, "aso")) {
    return (
      <div className="px-4 pt-20 pb-28 flex flex-col items-center text-center screen-enter">
        <div className="w-24 h-24 bg-brand-50 dark:bg-brand-900/20 rounded-full flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-brand-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{planRequiredLabel("aso")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 max-w-xs leading-relaxed">
          {t("ajo.planLockedIntro", { text: planAvailableText("aso") })}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">{t("ajo.planLockedSub")}</p>
        {canSellPlans() && (
          <button onClick={onUpgrade}
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition-all shadow-md">
            {upgradeLabel("aso")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-28 screen-enter">

      {/* Header */}
      <div className={`${embedded ? "" : "sticky top-0 z-10"} bg-white dark:bg-slate-900 -mx-4 px-4 py-3 mb-4 border-b border-slate-100 dark:border-slate-700/60 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">{t("aso.title")}</h1>
          {pendingDeposits.length > 0 && (
            <span className="bg-brand-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full leading-none">
              {pendingDeposits.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Today's Collection */}
          <button
            onClick={() => { if (!showCollection) loadGroups(); setShowCollection(v => !v); }}
            title={t("ajo.todaysCollection")}
            className={`w-11 h-11 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-all ${
              showCollection
                ? "bg-brand-600 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            }`}>
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </button>
          {isOwner && (
            <button
              onClick={() => { loadGroups(); setShowGroups(true); }}
              title={t("ajo.manageAjoGroups")}
              className="w-11 h-11 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </button>
          )}
          {canManageClients && (
            <button onClick={() => setShowAdd(true)}
              className="w-11 h-11 bg-brand-600 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
              <Icon name="plus" size={18} className="text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="rounded-3xl px-5 py-5 mb-4 text-white relative overflow-hidden shadow-hero bg-gradient-to-br from-navy-400 via-navy-600 to-navy-800">
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">{t("ajo.totalBalance")}</p>
          <AmountDisplay amount={totalBal} size="hero" align="left" className="text-white mb-4" />
          <div className="grid grid-cols-3 divide-x divide-white/20">
            <div className="pr-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">{t("ajo.totalSaved")}</p>
              <AmountDisplay amount={totalSaved} size="small" align="left" className="text-green-200" />
            </div>
            <div className="px-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">{t("ajo.clients")}</p>
              <p className="text-sm font-extrabold tabular">
                {asoClients.length}
                {overdueList.length > 0 && (
                  <span className="ml-1 text-red-200 inline-flex items-center gap-0.5">
                    · <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 inline" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>{overdueList.length}
                  </span>
                )}
              </p>
            </div>
            <div className="pl-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">{t("ajo.groups")}</p>
              <p className="text-sm font-extrabold tabular">{groupClients.length} <span className="text-white/40 font-normal text-[10px]">{t("ajo.nIndividualShort", { n: indivClients.length })}</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* Stuck wallet payouts — approved withdrawals whose wallet transfer never landed */}
      {stuckPayouts.length > 0 && (
        <div id="aso-payouts" className="mb-3 rounded-2xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 px-4 py-3.5">
          <p className="text-xs font-bold text-red-700 dark:text-red-400 mb-2">
            {t(stuckPayouts.length !== 1 ? "ajo.stuckPayoutsMany" : "ajo.stuckPayoutsOne", { n: stuckPayouts.length })}
          </p>
          <div className="space-y-2">
            {stuckPayouts.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-2 bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {p.aso_clients?.full_name || t("ajo.client")} · ₦{(p.amount_kobo / 100).toLocaleString("en-NG")}
                  </p>
                  <p className="text-[10px] text-red-500 dark:text-red-400 mt-0.5">
                    {p.status === "failed" ? (p.failure_reason || t("ajo.failedAtSettlement")) : t("ajo.wasDueNeverSettled", { date: p.scheduled_date })}
                  </p>
                </div>
                <button onClick={() => handleRetryPayout(p.id)} disabled={retryingPayoutId === p.id}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold disabled:opacity-50 active:scale-95 transition">
                  {retryingPayoutId === p.id ? t("ajo.retrying") : t("ajo.retry")}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-red-500/80 dark:text-red-400/70 mt-2">
            {t("ajo.stuckPayoutsHint")}
          </p>
        </div>
      )}

      {/* Withdrawal requests panel */}
      {wdError && (
        <button onClick={reloadWithdrawalRequests}
          className="w-full flex items-center justify-between px-3 py-2 mb-2 rounded-xl text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 active:opacity-60">
          <span>{wdError}</span>
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0 ml-2" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" />
          </svg>
        </button>
      )}
      {withdrawalRequests.length > 0 && (() => {
        const heldReqs    = withdrawalRequests.filter(r => r.status === "held_24h");
        const pendingReqs = withdrawalRequests.filter(r => r.status === "pending");
        const WithdrawCard = ({ req, isHeld }) => {
          const cl       = req.aso_clients || {};
          const isProc   = processingId === req.id;
          const effectivePct = req.fee_amount > 0 && req.amount > 0 ? ((req.fee_amount / req.amount) * 100).toFixed(1) : null;
          const feeLabel = req.fee_type === "registration_fee" ? t("ajo.regFeeShort") : effectivePct ? t("ajo.pctFee", { pct: effectivePct }) : t("ajo.feeWord");
          return (
            <div key={req.id} className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border shadow-sm ${isHeld ? "border-orange-300 dark:border-orange-700/60" : "border-amber-200 dark:border-amber-800/60"}`}>
              {isHeld && (
                <div className="flex items-center gap-1.5 mb-2.5 px-2 py-1.5 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                  <p className="text-[10px] font-bold text-orange-700 dark:text-orange-400">{t("ajo.securityHoldPinChanged")}</p>
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isHeld ? "bg-orange-100 dark:bg-orange-900/40" : "bg-amber-100 dark:bg-amber-900/40"}`}>
                  <svg viewBox="0 0 24 24" fill="none" className={`w-5 h-5 ${isHeld ? "text-orange-600 dark:text-orange-400" : "text-amber-600 dark:text-amber-400"}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M12 19V5M5 12l7 7 7-7" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{cl.full_name || "—"}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{cl.membership_number || ""}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs font-bold ${isHeld ? "text-orange-700 dark:text-orange-300" : "text-amber-700 dark:text-amber-300"}`}>
                      {t("ajo.requestsAmount", { amount: fmt(req.amount) })}
                    </span>
                    {req.fee_amount > 0 && (
                      <span className="text-[10px] text-slate-400">
                        − {fmt(req.fee_amount)} {feeLabel} = <strong className="text-green-600 dark:text-green-400">{fmt(req.net_amount)}</strong>
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{req.requested_at ? new Date(req.requested_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : ""}</p>
                  {(req.ajo_cycles?.label || req.ajo_groups?.name) && (
                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                      {t("ajo.fromLabel", { label: req.ajo_cycles?.label
                        ? req.ajo_cycles.label
                        : `${req.ajo_groups?.group_mode === "rotating" ? "Esusu" : t("ajo.savingsGroup")} — ${req.ajo_groups?.name}` })}
                    </p>
                  )}
                  {req.fee_type !== "registration_fee" && req.fee_amount > 0 && cl.commission_model === "percent" &&
                   cl.commission_percent !== undefined && effectivePct !== null &&
                   Math.abs(parseFloat(effectivePct) - (cl.commission_percent || 0)) > 0.05 && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-lg">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                      <span>{t("ajo.feeAtRequest", { pct: effectivePct })}</span>
                      <span>·</span>
                      <span className="font-bold">{t("ajo.currentFee", { pct: cl.commission_percent })}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2 flex items-start gap-2">
                <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-brand-500 dark:text-brand-400 flex-shrink-0 mt-0.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4M4 6v12a2 2 0 002 2h14v-4M18 12a2 2 0 00-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
                </svg>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t("ajo.autoPaysA")} <strong className="text-slate-700 dark:text-slate-200">KudiAI Wallet</strong> {t("ajo.autoPaysB")}
                </p>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setTxnPin({
                    title: isHeld ? t("ajo.releaseApproveWithdrawal") : t("ajo.approveWithdrawal"),
                    amount: Math.round((req.net_amount || 0) * 100),
                    recipient: cl.full_name,
                    fee: walletMoveFeeKobo,
                    description: isHeld ? t("ajo.securityHoldReleaseDesc") : t("ajo.savingsWithdrawalApproval"),
                    onApprove: (pin) => { setTxnPin(null); handleApproveRequest(req, pin, r => setActionResult(r)); },
                  })}
                  disabled={isProc}
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] disabled:opacity-50">
                  {isProc ? "…" : isHeld ? t("ajo.releaseApprove") : t("ajo.approve")}
                </button>
                <button
                  onClick={() => isHeld
                    ? (setRejectingHeld(req), setHeldRejectReason(""))
                    : handleRejectRequest(req)}
                  disabled={isProc}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 rounded-xl font-bold text-xs transition active:scale-[0.99] disabled:opacity-50 border border-slate-200 dark:border-slate-600">
                  {isProc ? "…" : t("ajo.reject")}
                </button>
              </div>
              {approveError.id === req.id && (
                <p className="mt-2 text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2 leading-relaxed">
                  {approveError.text}
                </p>
              )}
            </div>
          );
        };
        return (
          <div id="aso-withdrawals" className="mb-4 space-y-4">
            {heldReqs.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  {t("ajo.securityHolds")}
                  <span className="ml-1 bg-orange-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">{heldReqs.length}</span>
                </p>
                <div className="space-y-2">{heldReqs.map(r => <WithdrawCard key={r.id} req={r} isHeld />)}</div>
              </div>
            )}
            {pendingReqs.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                  {t("ajo.withdrawalRequests")}
                  <span className="ml-2 bg-brand-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">{pendingReqs.length}</span>
                </p>
                <div className="space-y-2">{pendingReqs.map(r => <WithdrawCard key={r.id} req={r} isHeld={false} />)}</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Pending deposits panel */}
      {depError && (
        <button onClick={reloadPendingDeposits}
          className="w-full flex items-center justify-between px-3 py-2 mb-2 rounded-xl text-xs text-brand-700 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800/30 active:opacity-60">
          <span>{depError}</span>
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0 ml-2" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" />
          </svg>
        </button>
      )}
      {depositFeedback && (
        <div className={`mb-3 px-4 py-3 rounded-xl border text-sm font-semibold ${
          depositFeedback.type === "ok"
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/60 text-green-700 dark:text-green-300"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400"
        }`}>
          {depositFeedback.msg}
        </div>
      )}
      {/* Reactivation requests — archived clients requesting account restoration */}
      {reactivationRequests.length > 0 && !staffId && (
        <div className="mb-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
            {t("ajo.reactivationRequests")}
            <span className="ml-2 bg-brand-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">{reactivationRequests.length}</span>
          </p>
          <div className="space-y-3">
            {reactivationRequests.map(req => {
              const isBusy          = reactivationBusy === req.id;
              const msg             = reactivationMsg.id === req.id ? reactivationMsg : null;
              const isOwnerApproved = req.status === "owner_approved";
              return (
                <div key={req.id} className={`border rounded-xl p-3 ${isOwnerApproved ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/40" : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40"}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{req.client_name || t("ajo.client")}</p>
                      <p className={`text-[10px] font-semibold ${isOwnerApproved ? "text-blue-600 dark:text-blue-400" : "text-amber-700 dark:text-amber-400"}`}>
                        {isOwnerApproved ? t("ajo.forwardedToAdmin") : t("ajo.accountReactivationRequest")}
                      </p>
                    </div>
                    <p className="text-[10px] text-slate-400 whitespace-nowrap">{new Date(req.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</p>
                  </div>
                  {req.reason && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mb-2 bg-white/50 dark:bg-white/5 rounded-lg px-2 py-1">
                      &ldquo;{req.reason}&rdquo;
                    </p>
                  )}
                  {msg && (
                    <p className={`text-xs mb-2 font-medium ${msg.ok ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{msg.text}</p>
                  )}
                  {isOwnerApproved ? (
                    <div>
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium mb-2">{t("ajo.awaitingAdminReviewResend")}</p>
                      <button
                        disabled={isBusy}
                        className="w-full py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white disabled:opacity-50"
                        onClick={async () => {
                          setReactivationBusy(req.id);
                          const { data } = await supabase.functions.invoke("ajo-write", {
                            body: { action: "resend_reactivation", reactivation_request_id: req.id },
                          });
                          setReactivationBusy(null);
                          if (data?.ok) {
                            setReactivationMsg({ id: req.id, text: data.note || t("ajo.sentToAdmin"), ok: true });
                          } else {
                            setReactivationMsg({ id: req.id, text: data?.error || t("ajo.failedToResend"), ok: false });
                          }
                        }}
                      >
                        {isBusy ? "…" : t("ajo.resendToAdmin")}
                      </button>
                    </div>
                  ) : rejectingReactivation === req.id ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        value={rejectReactivationNote}
                        onChange={e => setRejectReactivationNote(e.target.value)}
                        placeholder={t("ajo.rejectionReasonRequired")}
                        className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1.5"
                      />
                      <div className="flex gap-2">
                        <button
                          disabled={isBusy || !rejectReactivationNote.trim()}
                          onClick={async () => {
                            setReactivationBusy(req.id);
                            const { data } = await supabase.functions.invoke("ajo-write", {
                              body: { action: "reject_reactivation", reactivation_request_id: req.id, note: rejectReactivationNote.trim() },
                            });
                            setReactivationBusy(null);
                            if (data?.ok) {
                              setReactivationMsg({ id: req.id, text: t("ajo.requestRejected"), ok: true });
                              setRejectingReactivation(null);
                              setRejectReactivationNote("");
                              setReactivationRequests(p => p.filter(r => r.id !== req.id));
                            } else {
                              setReactivationMsg({ id: req.id, text: data?.error || t("ajo.failed"), ok: false });
                            }
                          }}
                          className="flex-1 py-1.5 text-xs font-bold rounded-lg bg-red-500 text-white disabled:opacity-50"
                        >
                          {isBusy ? "…" : t("ajo.confirmReject")}
                        </button>
                        <button
                          onClick={() => { setRejectingReactivation(null); setRejectReactivationNote(""); }}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        disabled={isBusy}
                        className="flex-1 py-1.5 text-xs font-bold rounded-lg bg-green-600 text-white disabled:opacity-50"
                        onClick={() => setTxnPin({
                          title: t("ajo.approveReactivation"),
                          description: t("ajo.approveReactivationFor", { name: req.client_name || t("ajo.clientLower") }),
                          onApprove: async (pin) => {
                            setTxnPin(null);
                            setReactivationBusy(req.id);
                            const { data } = await supabase.functions.invoke("ajo-write", {
                              body: { action: "approve_reactivation", reactivation_request_id: req.id, pin },
                            });
                            setReactivationBusy(null);
                            if (data?.ok) {
                              setReactivationMsg({ id: req.id, text: t("ajo.approvedAdminWillFinalise"), ok: true });
                              setReactivationRequests(p => p.map(r => r.id === req.id ? { ...r, status: "owner_approved" } : r));
                            } else {
                              setReactivationMsg({ id: req.id, text: data?.error || t("ajo.failedToApprove"), ok: false });
                            }
                          },
                        })}
                      >
                        {isBusy ? "…" : t("ajo.approveSendToAdmin")}
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => { setRejectingReactivation(req.id); setRejectReactivationNote(""); }}
                        className="flex-1 py-1.5 text-xs font-bold rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 disabled:opacity-50"
                      >
                        {t("ajo.reject")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Staff Collections Queue (owner-only) ──────────────────────────── */}
      {isOwner && pendingStaffContribs.length > 0 && (
        <div id="aso-collections" className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              {t("ajo.staffCollections")}
              <span className="bg-orange-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">{pendingStaffContribs.length}</span>
            </p>
            <button
              onClick={() => setTxnPin({
                title: t("ajo.approveAllNCollections", { n: pendingStaffContribs.length }),
                amount: pendingStaffContribs.reduce((s, c) => s + (c.amount || 0), 0) * 100,
                recipient: t("ajo.staffCollections"),
                description: t("ajo.batchApproveDesc"),
                onApprove: async (pin) => {
                  setTxnPin(null);
                  const { data, error } = await supabase.functions.invoke("ajo-write", {
                    body: { action: "batch_approve_contributions", pin, contribution_ids: pendingStaffContribs.map(c => c.id) },
                  });
                  if (error || !data?.ok) {
                    setStaffContribFeedback({ ok: false, msg: t("ajo.partialNFailed", { n: data?.failed || 0 }) });
                  } else {
                    setStaffContribFeedback({ ok: true, msg: t("ajo.allNApproved", { n: data.approved }) });
                  }
                  reloadPendingStaffContribs();
                  setTimeout(() => setStaffContribFeedback(null), 3000);
                },
              })}
              className="text-[10px] font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2.5 py-1 rounded-lg active:scale-95 transition">
              {t("ajo.approveAll")}
            </button>
          </div>
          {staffContribFeedback && (
            <div className={`mb-2 px-3 py-2 rounded-xl text-xs font-bold ${staffContribFeedback.ok ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"}`}>
              {staffContribFeedback.msg}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {pendingStaffContribs.map(item => {
              const isStale = Date.now() - new Date(item.created_at).getTime() > 48 * 3600 * 1000;
              const isProc  = processingStaffContribId === item.id;
              const cl      = item.aso_clients || {};
              return (
                <div key={item.id} className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 border shadow-sm ${isStale ? "border-orange-300 dark:border-orange-700/60" : "border-indigo-200 dark:border-indigo-800/60"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isStale ? "bg-orange-100 dark:bg-orange-900/40" : "bg-indigo-100 dark:bg-indigo-900/40"}`}>
                      <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${isStale ? "text-orange-600 dark:text-orange-400" : "text-indigo-600 dark:text-indigo-400"}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="2"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{cl.full_name || "—"}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{cl.membership_number || ""}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{fmt(item.amount)}</span>
                        {item.contribution_context && item.contribution_context !== "personal_savings" && (
                          <span className="text-[10px] text-slate-400 capitalize">{CTX_KEY[item.contribution_context] ? t(CTX_KEY[item.contribution_context]) : item.contribution_context.replace(/_/g, " ")}</span>
                        )}
                        {isStale && <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400">{t("ajo.stale48h")}</span>}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{item.created_at ? new Date(item.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : ""}</p>
                    </div>
                  </div>
                  {rejectingStaffContrib === item.id ? (
                    <div className="mt-3">
                      <input
                        autoFocus
                        value={staffContribRejectReason}
                        onChange={e => setStaffContribRejectReason(e.target.value)}
                        placeholder={t("ajo.rejectionReasonPlaceholder")}
                        className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-slate-800 dark:text-white mb-2 outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          disabled={isProc || !staffContribRejectReason.trim()}
                          onClick={async () => {
                            setProcessingStaffContribId(item.id);
                            const { data } = await supabase.functions.invoke("ajo-write", { body: { action: "reject_contribution", contribution_id: item.id, reason: staffContribRejectReason } });
                            setProcessingStaffContribId(null);
                            if (data?.ok) { setRejectingStaffContrib(null); setStaffContribRejectReason(""); }
                            reloadPendingStaffContribs();
                          }}
                          className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold text-xs disabled:opacity-50 active:scale-[0.99] transition">
                          {isProc ? "…" : t("ajo.confirmReject")}
                        </button>
                        <button onClick={() => { setRejectingStaffContrib(null); setStaffContribRejectReason(""); }}
                          className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs active:scale-[0.99] transition">
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3">
                      <button
                        disabled={isProc}
                        onClick={() => setTxnPin({
                          title: t("ajo.approveCollection"),
                          amount: Math.round((item.amount || 0) * 100),
                          recipient: cl.full_name || t("ajo.client"),
                          description: t("ajo.staffRecordedContribution"),
                          onApprove: async (pin) => {
                            setTxnPin(null);
                            setProcessingStaffContribId(item.id);
                            const { data } = await supabase.functions.invoke("ajo-write", { body: { action: "approve_contribution", contribution_id: item.id, owner_id: profile?.id, pin } });
                            setProcessingStaffContribId(null);
                            reloadPendingStaffContribs();
                            if (!data?.ok) {
                              setStaffContribFeedback({ ok: false, msg: data?.error || t("ajo.approveFailedMsg") });
                              setActionResult({ type: "failure", title: t("ajo.approveFailed"), reason: data?.error || t("ajo.couldntApprove") });
                            } else {
                              setActionResult({ type: "success", title: t("ajo.collectionApproved"), amount: item.amount, counterparty: cl.full_name || t("ajo.client") });
                            }
                          },
                        })}
                        className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-bold text-xs disabled:opacity-50 active:scale-[0.99] transition">
                        {isProc ? "…" : t("ajo.approve")}
                      </button>
                      <button
                        disabled={isProc}
                        onClick={() => { setRejectingStaffContrib(item.id); setStaffContribRejectReason(""); }}
                        className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs active:scale-[0.99] transition">
                        {t("ajo.reject")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingDeposits.length > 0 && (
        <div id="aso-deposits" className="mb-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
            {t("ajo.pendingDeposits")}
            <span className="ml-2 bg-brand-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">{pendingDeposits.length}</span>
          </p>
          <div className="space-y-2">
            {pendingDeposits.map(dep => {
              const cl             = dep.aso_clients || {};
              const isProc         = processingDepositId === dep.id;
              const isManualClaim  = dep.payment_method === "manual_transfer";
              const daysOld        = Math.floor((Date.now() - new Date(dep.created_at).getTime()) / 86400000);
              const isStale        = daysOld >= 7;
              const dateStr        = dep.created_at
                ? new Date(dep.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
                : "";
              const pmRaw          = dep.payment_method || "cash";
              const methodLabel    = isManualClaim ? t("ajo.methodBankTransfer") : (PM_LOWER_KEY[pmRaw] ? t(PM_LOWER_KEY[pmRaw]) : pmRaw.replace(/_/g, " "));
              const ctxLabel       = dep.contribution_context === "esusu_rotation" ? "Esusu"
                                   : dep.contribution_context === "group_savings"  ? t("ajo.groupSavings")
                                   : t("ajo.personalSavings");
              return (
                <div key={dep.id} className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border shadow-sm ${isStale ? "border-red-200 dark:border-red-800/60" : "border-brand-200 dark:border-brand-800/60"}`}>
                  {isStale && (
                    <p className="text-[10px] font-bold text-red-500 dark:text-red-400 mb-2">{t("ajo.awaitingConfirmationDays", { n: daysOld })}</p>
                  )}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-600 dark:text-brand-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M12 5v14M5 12l7-7 7 7" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{cl.full_name || "—"}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{cl.membership_number || ""}</p>
                      <p className="text-xs font-bold text-brand-700 dark:text-brand-300 mt-1">
                        {t(isManualClaim ? "ajo.claimsAmount" : "ajo.recordedAmount", { amount: Number(dep.amount).toLocaleString("en-NG") })}
                        <span className="ml-1.5 font-normal text-slate-400 text-[10px]">{methodLabel} · {ctxLabel}</span>
                      </p>
                      {dep.payer_name  && <p className="text-[10px] text-slate-400 mt-0.5">{t("ajo.paidBy", { name: dep.payer_name })}</p>}
                      {dep.claim_notes && <p className="text-[10px] text-slate-400 italic mt-0.5">"{dep.claim_notes}"</p>}
                      {dep.notes       && !isManualClaim && <p className="text-[10px] text-slate-400 italic mt-0.5">"{dep.notes}"</p>}
                      <p className="text-[10px] text-slate-400 mt-0.5">{dateStr}</p>
                      {dep.proof_url && (() => {
                        const proofHref = dep.proof_url.replace(
                          /^https:\/\/kudiai\.app\/sb\//,
                          `${process.env.REACT_APP_SUPABASE_URL}/`
                        );
                        const openProof = () => {
                          if (Capacitor.isNativePlatform()) {
                            InAppBrowser.openWebView({
                              url: proofHref,
                              toolbarType: ToolBarType.COMPACT,
                              title: t("ajo.paymentProof"),
                            }).catch(() => window.open(proofHref, "_blank"));
                          } else {
                            window.open(proofHref, "_blank");
                          }
                        };
                        return (
                          <button onClick={openProof} className="mt-2 block w-full active:opacity-75 transition rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600">
                            <img
                              src={proofHref}
                              alt={t("ajo.paymentProofAlt")}
                              className="w-full max-h-36 object-cover"
                              onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextElementSibling.style.display = "flex"; }}
                            />
                            <span style={{display:"none"}} className="items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-brand-600 dark:text-brand-400">
                              <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
                              </svg>
                              {t("ajo.viewProof")}
                            </span>
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                  {canConfirmDeposit ? (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => setTxnPin({
                          title:       isManualClaim ? t("ajo.confirmDeposit") : t("ajo.approveContribution"),
                          amount:      Math.round((dep.amount || 0) * 100),
                          recipient:   cl.full_name || t("ajo.clientLower"),
                          description: `${isManualClaim ? t("ajo.bankTransferClaim") : t("ajo.recordedContribution")} · ₦${Number(dep.amount).toLocaleString("en-NG")}`,
                          onApprove:   (pin) => {
                            setTxnPin(null);
                            const onR = r => setActionResult(r);
                            if (isManualClaim) handleConfirmDeposit(dep, pin, onR);
                            else handleApproveContribution(dep, pin, onR);
                          },
                        })}
                        disabled={isProc}
                        className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] disabled:opacity-50">
                        {isProc && processingDepositId === dep.id && !rejectingDeposit ? "…" : isManualClaim ? t("common.confirm") : t("ajo.approve")}
                      </button>
                      <button
                        onClick={() => { setRejectingDeposit(dep); setRejectReason(""); }}
                        disabled={isProc}
                        className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 rounded-xl font-bold text-xs transition active:scale-[0.99] disabled:opacity-50 border border-slate-200 dark:border-slate-600">
                        {t("ajo.reject")}
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-3 text-center">{t("ajo.contactManagerDeposits")}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isOwner && <RegistrationFeeSetting ownerId={profile?.id} onChange={setDefaultRegFee} />}
      {isOwner && <DefaultCardFeeSetting ownerId={profile?.id} />}

      {/* Overdue alert */}
      {overdueList.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 rounded-2xl px-4 py-3 mb-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-red-500 dark:text-red-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">
              {t(overdueList.length === 1 ? "ajo.nOverdueAccountOne" : "ajo.nOverdueAccountsMany", { n: overdueList.length })}
            </p>
            <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{t("ajo.contributionsPastDue")}</p>
          </div>
          <button onClick={() => setFilter("overdue")}
            className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-3 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition-transform">
            {t("ajo.viewAll")}
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-2">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t("ajo.searchNamePhone")}
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/60 transition" />
        {search && (
          <button onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Filter chips + date toggle */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {CHIPS.map(({ key, label, count }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`flex items-center gap-1 px-3 min-h-[44px] rounded-full text-xs font-bold transition-all active:scale-95 ${
              filter === key
                ? key === "overdue"  ? "bg-red-500 text-white shadow-sm"
                  : key === "groups" ? "bg-blue-500 text-white shadow-sm"
                  : "bg-brand-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
            }`}>
            {label}
            {count > 0 && (
              <span className={`text-[10px] font-black ${filter === key ? "opacity-80" : "opacity-50"}`}>{count}</span>
            )}
          </button>
        ))}
        <button onClick={() => setShowDateFilter(v => !v)}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
            dueBefore ? "bg-blue-500 text-white shadow-sm" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
          }`}>
          <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {dueBefore || t("common.date")}
        </button>
      </div>

      {/* Date filter panel */}
      {showDateFilter && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 mb-2 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">{t("ajo.nextDueOnOrBefore")}</p>
            <input type="date" value={dueBefore} onChange={e => setDueBefore(e.target.value)}
              className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none" />
          </div>
          {dueBefore && (
            <button onClick={() => setDueBefore("")}
              className="text-xs font-bold text-red-400 hover:text-red-600 transition">
              {t("ajo.clear")}
            </button>
          )}
        </div>
      )}

      {/* Result count */}
      {(search || filter !== "all" || dueBefore) && asoClients.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3 font-medium">
          {t(filtered.length === 1 ? "ajo.nResultOne" : "ajo.nResultsMany", { n: filtered.length })}
          {search && t("ajo.forSearch", { q: search })}
        </p>
      )}

      {/* Empty states */}
      {asoClients.length === 0 ? (
        <div className="text-center py-14 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <div className="w-16 h-16 bg-brand-50 dark:bg-brand-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-brand-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">{t("ajo.noSavingsClientsYet")}</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">{t("ajo.tapPlusEnroll")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">{t("aso.noMatches")}</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">{t("ajo.tryDifferentSearch")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const initials       = (c.full_name || "?")[0].toUpperCase();
            const overdue        = isOverdue(c);
            const missed         = getMissedPayments(c);
            const made           = getContribsMade(c);
            const expected       = getExpectedContribs(c);
            const isGroup        = isGroupAccount(c);
            const nextDue        = effectiveNextDue(c);           // null = no active card/group, so nothing is due
            const nextDaysDiff   = nextDue ? daysDiff(nextDue) : 0;
            const nextIsToday    = !!nextDue && nextDue === today();
            const nextIsSoon     = !!nextDue && nextDaysDiff > -3 && nextDaysDiff <= 0;

            return (
              <div key={c.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border ${
                  overdue ? "border-red-200 dark:border-red-800/50" : "border-slate-100 dark:border-slate-700/60"
                }`}>

                {/* New self-registration — needs terms + approval */}
                {c.status === "pending_approval" && (
                  <button onClick={() => setClientProf(c)}
                    className="w-full flex items-center justify-between mb-3 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-700/40 text-left">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
                      <p className="text-[10px] font-bold text-blue-700 dark:text-blue-400">{t("ajo.newRegistrationSetTerms")}</p>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                )}

                {/* Pending archive banner */}
                {c.pending_archive && (
                  <div className="flex items-center justify-between mb-3 px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-700/40">
                    <div className="flex items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                      </svg>
                      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">{t("ajo.archivePendingAdmin")}</p>
                    </div>
                    <button
                      disabled={cancellingArchiveId === c.id}
                      onClick={async () => {
                        setCancellingArchiveId(c.id);
                        await cancelAsoClientArchive(c.id);
                        setCancellingArchiveId(null);
                      }}
                      className="text-[10px] font-bold text-amber-700 dark:text-amber-400 underline underline-offset-2 flex-shrink-0 ml-2 disabled:opacity-40">
                      {cancellingArchiveId === c.id ? "…" : t("common.cancel")}
                    </button>
                  </div>
                )}

                {/* Card header — avatar opens profile */}
                <div className="flex items-start gap-3 mb-3">
                  <button onClick={() => setClientProf(c)}
                    className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 active:scale-95 transition-transform">
                    {c.profile_image_url
                      ? <img src={c.profile_image_url} alt={c.full_name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-navy-400 to-navy-700 flex items-center justify-center text-white font-black text-base">{initials}</div>
                    }
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{c.full_name}</p>
                      {isGroup && (
                        <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">{t("ajo.groupBadge")}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {c.phone && <span className="text-xs text-slate-400 dark:text-slate-500">{c.phone}</span>}
                      {c.phone && <span className="text-slate-300 dark:text-slate-600 text-xs">·</span>}
                      <span className="text-xs text-slate-400 dark:text-slate-500 capitalize">{FREQ_KEY[c.contribution_frequency] ? t(FREQ_KEY[c.contribution_frequency]) : c.contribution_frequency} · {fmt(c.contribution_amount)}</span>
                    </div>
                    {staffMap[c.staff_id] && (
                      <span className="inline-block text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full font-semibold mt-1">
                        {staffMap[c.staff_id]}
                      </span>
                    )}
                    {c.membership_number && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <span className="text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                          {c.membership_number}
                        </span>
                        {c.portal_pin && (
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            PIN: {showPins[c.id] ? c.portal_pin : "••••"}
                            <button
                              onClick={() => setShowPins(p => ({ ...p, [c.id]: !p[c.id] }))}
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition">
                              <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                {showPins[c.id]
                                  ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
                                  : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                                }
                              </svg>
                            </button>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge status={overdue ? "overdue" : c.status} />
                    {missed > 0 && (
                      <span className="text-[10px] font-bold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full">
                        {t("ajo.nMissed", { n: missed })}
                      </span>
                    )}
                    {overdue && nextDaysDiff >= 7 && (
                      <span className="text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">
                        {t("ajo.nDaysOverdue", { n: nextDaysDiff })}
                      </span>
                    )}
                    {overdue && nextDaysDiff >= 3 && nextDaysDiff < 7 && (
                      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">
                        {t("ajo.nDaysOverdue", { n: nextDaysDiff })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-2 mb-3">
                  {[
                    { label: t("ajo.balance"),   value: c.current_balance, color: "text-brand-700 dark:text-brand-400", bg: "bg-brand-50 dark:bg-brand-900/20" },
                    { label: t("ajo.deposited"), value: c.total_saved,     color: "text-green-700 dark:text-green-400",  bg: "bg-green-50 dark:bg-green-900/20"   },
                    { label: t("ajo.withdrawn"), value: c.total_withdrawn,  color: "text-red-600 dark:text-red-400",      bg: "bg-red-50 dark:bg-red-900/20"       },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} className={`flex-1 ${bg} rounded-xl p-2.5`}>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                      <p className={`text-sm font-extrabold tabular ${color}`}>{fmt(value)}</p>
                    </div>
                  ))}
                </div>

                {/* Contribution tracking row */}
                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2.5 mb-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">{t("ajo.contributionTracking")}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${missed > 0 ? "bg-red-400" : "bg-brand-500"}`}
                          style={{ width: expected > 0 ? `${Math.min(100, (made / expected) * 100)}%` : "0%" }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {made}/{expected > 0 ? expected : "—"}
                      </span>
                    </div>
                    {missed > 0 && (
                      <p className="text-[10px] font-bold text-red-500 dark:text-red-400 mt-1">{t(missed !== 1 ? "ajo.nPaymentsOverdueMany" : "ajo.nPaymentOverdueOne", { n: missed })}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{t("ajo.nextDue")}</p>
                    <p className={`text-xs font-extrabold mt-0.5 ${
                      overdue ? "text-red-500 dark:text-red-400"
                        : nextIsToday || nextIsSoon ? "text-amber-500 dark:text-amber-400"
                        : "text-slate-700 dark:text-slate-200"
                    }`}>
                      {nextDue || (isCounting(c) ? "—" : t("ajo.notStarted"))}
                    </p>
                    {nextIsToday && <p className="text-[9px] text-amber-500 font-bold">{t("ajo.todayExclaim")}</p>}
                    {overdue && <p className="text-[9px] text-red-500 font-bold">{t("ajo.nDaysLate", { n: nextDaysDiff })}</p>}
                  </div>
                </div>

                {c.notes && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-3">"{c.notes}"</p>}

                {/* Actions — icon grid */}
                <div className="flex gap-1.5 pt-3 border-t border-slate-100 dark:border-slate-700/60">

                  {/* Contribute */}
                  {canContribute && !c.pending_archive && (
                    <button onClick={() => { setSelected(c); setAction("contribute"); }}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 active:scale-95 transition"
                      title={t("ajo.contribute")}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                      </svg>
                      <span className="text-[9px] font-black text-green-700 dark:text-green-400 uppercase tracking-wide leading-none">{t("ajo.fund")}</span>
                    </button>
                  )}

                  {/* Withdraw */}
                  {canWithdraw && !c.pending_archive && (
                    <button onClick={() => { setSelected(c); setAction("withdraw"); }}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 active:scale-95 transition"
                      title={t("ajo.withdraw")}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-red-600 dark:text-red-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/>
                      </svg>
                      <span className="text-[9px] font-black text-red-600 dark:text-red-400 uppercase tracking-wide leading-none">{t("ajo.pay")}</span>
                    </button>
                  )}

                  {/* Reminder */}
                  <button onClick={() => { setReminderFor(c); setCopied(false); }}
                    className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border active:scale-95 transition ${
                      overdue || missed > 0
                        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                        : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                    }`}
                    title={t("ajo.sendReminder")}>
                    <svg viewBox="0 0 24 24" fill="none" className={`w-5 h-5 ${overdue || missed > 0 ? "text-red-500 dark:text-red-400" : "text-amber-500 dark:text-amber-400"}`} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
                    </svg>
                    <span className={`text-[9px] font-black uppercase tracking-wide leading-none ${overdue || missed > 0 ? "text-red-500 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>{t("ajo.alert")}</span>
                  </button>

                  {/* Statement */}
                  <button onClick={() => setReceipt(c)}
                    className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-brand-50 dark:bg-brand-900/20 rounded-xl border border-brand-200 dark:border-brand-800 active:scale-95 transition"
                    title={t("ajo.viewStatement")}>
                    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-600 dark:text-brand-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <span className="text-[9px] font-black text-brand-600 dark:text-brand-400 uppercase tracking-wide leading-none">{t("ajo.stmtShort")}</span>
                  </button>

                  {/* History + Card */}
                  <button onClick={async () => {
                    setHistLoading(true);
                    const [contribRes, cycleRes] = await Promise.all([
                      supabase
                        .from("ajo_contributions")
                        .select("id, aso_client_id, owner_id, amount, type, status, created_at, payment_method, contribution_context, cycle_id, group_id, reverses_contribution_id, fee_for_contribution_id, notes, recorded_by, paystack_ref, paystack_status, paid_at, approved_at, approved_by, confirmed_at, confirmed_by, initiated_by, payment_channel, proof_url, contribution_source, receipt_ref, balance_after, ajo_groups(name)")
                        .eq("aso_client_id", c.id)
                        .order("created_at", { ascending: false }),
                      supabase
                        .from("ajo_cycles")
                        .select("id, client_id, label, status, commission_model, commission_balance, expected_amount_per_period, frequency, length_periods, start_date, created_at, commission_percent")
                        .eq("client_id", c.id)
                        .order("created_at", { ascending: true }),
                    ]);
                    setHistoryFor({ client: c, contributions: contribRes.data || [], cycles: cycleRes.data || [] });
                    setHistLoading(false);
                  }}
                    className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 active:scale-95 transition"
                    title={t("ajo.viewHistory")}>
                    {histLoading ? (
                      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-blue-600 dark:text-blue-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 0 .5-4.5"/>
                        <polyline points="3 3 3 7 7 7"/>
                      </svg>
                    )}
                    <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-wide leading-none">{t("ajo.histShort")}</span>
                  </button>

                  {/* Edit */}
                  <button onClick={() => setClientProf(c)}
                    className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-slate-50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600 active:scale-95 transition"
                    title={t("ajo.editProfile")}>
                    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide leading-none">{t("common.edit")}</span>
                  </button>

                  {/* Assign — owner only */}
                  {!staffAjoPerms && (
                    <button onClick={() => setAssigningClient(c)}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-violet-50 dark:bg-violet-900/20 rounded-xl border border-violet-200 dark:border-violet-800 active:scale-95 transition"
                      title={t("ajo.assignToBranchStaff")}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-violet-600 dark:text-violet-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                      </svg>
                      <span className="text-[9px] font-black text-violet-600 dark:text-violet-400 uppercase tracking-wide leading-none">{t("ajo.assign")}</span>
                    </button>
                  )}

                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Aso Client Sheet ─────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-sheet flex flex-col justify-end bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[92dvh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-800 dark:text-white">{t("ajo.newAjoClient")}</h2>
              <button onClick={resetAdd} className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">

          <div className="flex flex-col items-center mb-2 pt-1">
            <div className="relative">
              <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 flex items-center justify-center shadow-sm">
                {photoPreview
                  ? <img src={photoPreview} alt={t("ajo.preview")} className="w-full h-full object-cover" />
                  : <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-slate-300 dark:text-slate-500" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8" />
                    </svg>
                }
              </div>
              <label className="absolute -bottom-2 -right-2 w-8 h-8 bg-brand-600 hover:bg-brand-700 rounded-full flex items-center justify-center cursor-pointer shadow-md transition active:scale-95">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" />
                </svg>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">{t("ajo.tapCameraAddPhoto")}</p>
          </div>

          <SectionLabel>{t("ajo.savingsSettings")}</SectionLabel>
          <Field label={t("ajo.fullNameGroupNameReq")} value={f.full_name}
            onChange={e => set("full_name", e.target.value)} placeholder={t("ajo.fullNamePlaceholder")} />
          <Field label={t("ajo.contributionFrequency")} as="select" value={f.contribution_frequency}
            onChange={e => set("contribution_frequency", e.target.value)}>
            {["daily", "weekly", "monthly"].map(o => (
              <option key={o} value={o}>{t(FREQ_KEY[o])}</option>
            ))}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("ajo.contributionNaira")} type="number" value={f.contribution_amount}
              onChange={e => set("contribution_amount", e.target.value)} placeholder="0.00" />
            <Field label={t("ajo.regFeeNaira")} type="number" value={f.registration_charge}
              onChange={e => set("registration_charge", e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">{t("ajo.withdrawalFeeCommission")}</p>
            <select value={f.commission_model}
              onChange={e => set("commission_model", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-800 dark:text-white">
              <option value="none">{t("ajo.noFee")}</option>
              {f.commission_model === "first_period" && <option value="first_period" disabled>{t("ajo.firstPeriodRetired")}</option>}
              <option value="percent">{t("ajo.percentOfEachWithdrawal")}</option>
            </select>
            {f.commission_model === "percent" && (
              <div className="mt-2">
                <Field label={t("ajo.feePercent")} type="number" value={f.commission_percent}
                  onChange={e => set("commission_percent", e.target.value)} placeholder={t("ajo.egValue", { v: "5" })} />
              </div>
            )}
          </div>

          <SectionLabel>{t("ajo.contactIdentity")}</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("ajo.phone")} type="tel" value={f.phone}
              onChange={e => set("phone", e.target.value)} placeholder="08012345678" />
            <Field label={t("ajo.emailReq")} type="email" value={f.email}
              onChange={e => set("email", e.target.value)} placeholder="client@email.com" />
          </div>

          {walletEnabled && (
            <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 px-3.5 py-3 mt-2 flex items-start gap-2.5">
              <span className="text-base flex-shrink-0">🏦</span>
              <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                {t("ajo.clientOpensOwnWallet")}
              </p>
            </div>
          )}

          {!staffId && (
            <>
              <SectionLabel>{t("ajo.payoutAccountOptional")}</SectionLabel>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-1 mb-1">
                {t("ajo.payoutAccountHelp")}
              </p>
              <Field label={t("ajo.bank")} as="select" value={f.bank_code}
                onChange={e => {
                  const b = banks.find(bk => bk.code === e.target.value);
                  set("bank_code", e.target.value);
                  set("bank_name", b?.name || "");
                  set("account_name", "");
                  setClientResolvedName(""); setClientBankErr("");
                }}>
                <option value="">{t("ajo.selectBank")}</option>
                {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </Field>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Field label={t("ajo.accountNumber")} inputMode="numeric" value={f.account_number}
                    onChange={e => { set("account_number", e.target.value.replace(/\D/g, "").slice(0, 10)); set("account_name", ""); setClientResolvedName(""); setClientBankErr(""); }}
                    placeholder={t("ajo.tenDigitNuban")} />
                </div>
                <button type="button" onClick={resolveClientAccount}
                  disabled={clientBankResolving || f.account_number.length < 10 || !f.bank_code}
                  className="mb-0.5 px-3 py-2.5 rounded-xl bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-xs font-bold disabled:opacity-40 transition whitespace-nowrap active:scale-95">
                  {clientBankResolving ? t("ajo.checking") : t("ajo.verify")}
                </button>
              </div>
              {clientResolvedName && (
                <p className="text-xs text-green-600 dark:text-green-400 font-semibold -mt-1 flex items-center gap-1">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  {clientResolvedName}
                </p>
              )}
              {clientBankErr && (
                <p className="text-xs text-red-500 -mt-1">{clientBankErr}</p>
              )}
            </>
          )}

          {staffOptions.length > 0 && (
            <>
              <SectionLabel>{t("ajo.staffAssignment")}</SectionLabel>
              <Field label={t("ajo.assignStaff")} as="select" value={f.staff_id}
                onChange={e => set("staff_id", e.target.value)}>
                <option value="">{t("ajo.noStaffAssigned")}</option>
                {staffOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Field>
            </>
          )}

          {groups.length > 0 && (
            <>
              <SectionLabel>{t("ajo.groupMembership")}</SectionLabel>
              <Field label={t("ajo.ajoGroup")} as="select" value={f.ajo_group_id || ""}
                onChange={e => set("ajo_group_id", e.target.value || null)}>
                <option value="">{t("ajo.noGroup")}</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name}{g.group_mode === "rotating" ? t("ajo.rotatingSuffix") : ""}
                  </option>
                ))}
              </Field>
            </>
          )}

          <SectionLabel>{t("ajo.notes")}</SectionLabel>
          <Field as="textarea" value={f.notes}
            onChange={e => set("notes", e.target.value)} placeholder={t("ajo.optionalNotesClient")} />

          {addError && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-xl px-3 py-2">{addError}</p>
          )}

              <div className="pb-6">
                <button onClick={handleAdd}
                  disabled={!f.full_name || adding}
                  className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-2xl font-bold text-sm transition active:scale-[0.99]">
                  {adding ? t("ajo.creatingAccount") : t("ajo.addAjoClient")}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Contribute / Withdraw modal */}
      {selected && action && (
        <Modal
          title={`${action === "contribute" ? t("ajo.recordContribution") : t("ajo.processWithdrawal")} — ${selected.full_name}`}
          onClose={() => { setSelected(null); setAction(null); setAmt(""); setContributeCtx("personal_savings"); setFundPayErr(""); }}>

          <div className="bg-brand-50 dark:bg-brand-900/20 rounded-xl px-4 py-3 mb-3 border border-brand-100 dark:border-brand-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("ajo.currentBalance")}</p>
            <AmountDisplay amount={selected.current_balance} size="stat" align="left" className="text-brand-700 dark:text-brand-400" />
          </div>

          {/* Contribution stats in modal */}
          {action === "contribute" && contributeCtx !== "wallet" && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: t("ajo.made"),     value: getContribsMade(selected),    color: "text-green-600 dark:text-green-400" },
                { label: t("ajo.expected"), value: getExpectedContribs(selected), color: "text-slate-700 dark:text-slate-200" },
                { label: t("ajo.missed"),   value: getMissedPayments(selected),   color: getMissedPayments(selected) > 0 ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-2.5 text-center">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                  <p className={`text-base font-extrabold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {action === "contribute" && contributeCtx !== "wallet" &&
           (selected.total_saved || 0) === 0 &&
           !pendingDeposits.some(d => d.aso_client_id === selected.id) &&
           (() => {
            const regCharge = Number(selected.registration_charge || 0);
            const expected  = Number(selected.contribution_amount || 0);
            const minReq    = expected + regCharge;
            if (minReq <= 0 || (regCharge === 0 && selected.commission_model !== "first_period")) return null;
            return (
              <p className="text-xs text-blue-600 dark:text-blue-400 mb-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/60 rounded-xl px-3 py-2">
                {t("ajo.firstDepositBreakdown", { total: fmt(minReq), contribution: fmt(expected), registration: fmt(regCharge) })}
              </p>
            );
          })()}

          {(action === "contribute" || action === "withdraw") && (() => {
            const isWithdraw = action === "withdraw";
            const hasCycles  = selectedCycles.length > 0;
            const opts = [
              // Withdraw mode only offers Personal Savings as a target once a cycle actually exists —
              // there's nothing to pick from otherwise (prompt below handles that case).
              ...(!isWithdraw || hasCycles
                ? [{ key: "personal_savings", label: t("ajo.personalSavings"), desc: isWithdraw ? t("ajo.withdrawFromPersonalSavings") : t("ajo.addToPersonalSavings"), gid: null }]
                : []),
              // A group with nothing actionable right now — an esusu group with no
              // active rotation round, or a savings group that's never been
              // started — isn't offered as a target at all, for either mode.
              ...selectedClientMems.map(m => {
                const sg = m.ajo_groups;
                if (!sg) return null;
                if (sg.group_mode === "rotating") {
                  if (!activeEsusuRoundIds.has(sg.id)) return null;
                  return { key: "esusu_rotation", label: sg.name, desc: isWithdraw ? t("ajo.esusuRotation") : t("ajo.esusuRotationAddPot"), gid: sg.id };
                }
                if (sg.round_status === "not_started") return null;
                return { key: "group_savings", label: sg.name || t("ajo.savingsGroup"), desc: isWithdraw ? t("ajo.savingsGroup") : t("ajo.savingsGroupAddPool"), gid: sg.id };
              }).filter(Boolean),
              ...(!isWithdraw && selected.client_user_id
                ? [{ key: "wallet", label: "KudiAI Wallet", desc: t("ajo.creditWalletDirectly"), gid: null }]
                : []),
            ];
            if (opts.length === 0) return null;
            return (
              <div className="mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  {isWithdraw ? t("ajo.withdrawFrom") : t("ajo.fund")}
                </p>
                <div className="space-y-1.5">
                  {opts.map(opt => (
                    <button key={`${opt.key}:${opt.gid || "x"}`} type="button"
                      onClick={() => { setContributeCtx(opt.key); setContributeGroupId(opt.gid); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition ${
                        contributeCtx === opt.key && contributeGroupId === opt.gid
                          ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
                          : "border-slate-200 dark:border-slate-700"
                      }`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{opt.label}</p>
                        <p className="text-[10px] text-slate-400">{opt.desc}</p>
                      </div>
                      <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        contributeCtx === opt.key && contributeGroupId === opt.gid ? "border-brand-500 bg-brand-500" : "border-slate-300 dark:border-slate-600"
                      }`}>
                        {contributeCtx === opt.key && contributeGroupId === opt.gid && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* No savings card yet — prompt to create one (either mode). Only
              counts group memberships that are actually actionable right now
              (esusu with an active round, or a savings group that's started) —
              a membership with nothing to do doesn't count as an alternative. */}
          {contributeCtx === "personal_savings" && selectedCycles.length === 0 &&
           !selectedClientMems.some(m => {
             const sg = m.ajo_groups;
             if (!sg) return false;
             return sg.group_mode === "rotating" ? activeEsusuRoundIds.has(sg.id) : sg.round_status !== "not_started";
           }) && (
            <div className="mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-3 text-center">
              <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-2">{t("ajo.noSavingsCardYet")}</p>
              <button
                type="button"
                onClick={async () => {
                  const c = selected;
                  setSelected(null); setAction(null); setAmt(""); setContributeCtx("personal_savings");
                  setHistLoading(true);
                  const [contribRes, cycleRes] = await Promise.all([
                    supabase.from("ajo_contributions")
                      .select("id, aso_client_id, owner_id, amount, type, status, created_at, payment_method, contribution_context, cycle_id, group_id, reverses_contribution_id, fee_for_contribution_id, notes, recorded_by, paystack_ref, paystack_status, paid_at, approved_at, approved_by, confirmed_at, confirmed_by, initiated_by, payment_channel, proof_url, contribution_source, receipt_ref, balance_after, ajo_groups(name)")
                      .eq("aso_client_id", c.id).order("created_at", { ascending: false }),
                    supabase.from("ajo_cycles")
                      .select("id, client_id, label, status, commission_model, commission_balance, expected_amount_per_period, frequency, length_periods, start_date, created_at, commission_percent")
                      .eq("client_id", c.id).order("created_at", { ascending: true }),
                  ]);
                  setHistoryFor({ client: c, contributions: contribRes.data || [], cycles: cycleRes.data || [] });
                  setHistLoading(false);
                }}
                className="text-xs font-bold text-brand-600 dark:text-brand-400 underline underline-offset-2">
                {t("ajo.createSavingsCard")}
              </button>
            </div>
          )}

          {contributeCtx === "personal_savings" && selectedCycles.length > 1 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{t("ajo.whichSavingsCycle")}</p>
              <div className="space-y-1.5">
                {selectedCycles.map(cyc => (
                  <button key={cyc.id} type="button"
                    onClick={() => setContributeCycleId(cyc.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border-2 text-left text-sm transition ${
                      contributeCycleId === cyc.id
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                    }`}>
                    <span>{cyc.label || t("ajo.savings")}{cyc.status === "completed" ? t("ajo.completeSuffix") : ""}</span>
                    {contributeCycleId === cyc.id && <div className="w-3.5 h-3.5 rounded-full bg-brand-500 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Target stats — saved / withdrawn / available / locked for whatever's selected */}
          {(contributeCycleId || contributeGroupId) && (
            <div className="mb-3 bg-slate-50 dark:bg-slate-800 rounded-xl p-3">
              {targetStatsLoading ? (
                <p className="text-[11px] text-slate-400 text-center py-1">{t("common.loading")}</p>
              ) : targetStats ? (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: t("ajo.totalSaved"),     value: targetStats.total_saved },
                    ...(targetStats.total_received > 0 ? [{ label: t("ajo.payoutReceived"), value: targetStats.total_received }] : []),
                    { label: t("ajo.totalWithdrawn"), value: targetStats.total_withdrawn },
                    { label: t("ajo.available"),       value: targetStats.available, bold: true },
                    ...(targetStats.locked > 0 ? [{ label: t("ajo.locked"), value: targetStats.locked, amber: true }] : []),
                  ].map(({ label, value, bold, amber }) => (
                    <div key={label}>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">{label}</p>
                      <p className={`text-sm tabular-nums ${bold ? "font-extrabold text-green-600 dark:text-green-400" : amber ? "font-bold text-amber-600 dark:text-amber-400" : "font-semibold text-slate-700 dark:text-slate-200"}`}>
                        {fmt(value)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {action === "withdraw" && (() => {
            // card withdrawals only: esusu / savings-group withdrawals carry no fee (owner's rule 2026-10-18)
            const wFeePercent = contributeCtx === "personal_savings" && selected.commission_model === "percent" ? (selected.commission_percent || 0) : 0;
            return (
              <div className="mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-2 space-y-0.5">
                <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  {wFeePercent > 0 ? t("ajo.withdrawalFeeDeducted", { pct: wFeePercent }) : t("ajo.feeNone")}
                </p>
                {wFeePercent > 0 && amt && parseFloat(amt) > 0 && (
                  <p className="text-xs text-amber-500 dark:text-amber-400">
                    {t("ajo.feeClientReceives", { fee: fmt(parseFloat(amt) * (wFeePercent / 100)), net: fmt(parseFloat(amt) * (1 - wFeePercent / 100)) })}
                  </p>
                )}
              </div>
            );
          })()}

          <Field label={t("ajo.amountSuggested", { amount: fmt(selected.contribution_amount) })}
            type="number" inputMode="decimal" value={amt}
            onChange={e => setAmt(e.target.value)} placeholder={t("ajo.enterAmount")} />

          {action === "contribute" && selected.contribution_amount > 0 && (
            <button onClick={() => setAmt(String(selected.contribution_amount))}
              className="text-xs text-brand-600 dark:text-brand-400 font-bold mb-3 -mt-1 block hover:underline">
              {t("ajo.useContributionAmount", { amount: fmt(selected.contribution_amount) })}
            </button>
          )}

          {/* Owner-recorded withdrawals are cash (2026-10-14): no wallet money moves — see migration 20270332000000. */}
          {action === "withdraw" && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2 mb-3 leading-snug">
              {t("ajo.cashWithdrawalNote")}
            </p>
          )}

          {fundPayErr && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-xl mb-3">{fundPayErr}</p>
          )}

          <button
            onClick={async () => {
              if (!amt) return;
              const a = parseFloat(amt);
              setFundPayErr("");

              if (action === "contribute" && contributeCtx === "wallet") {
                const savedClient = selected;
                setSelected(null); setAction(null); setAmt(""); setContributeCtx("personal_savings");
                setTxnPin({
                  title: t("ajo.confirmWalletFunding"),
                  amount: Math.round(a * 100),
                  recipient: savedClient.full_name,
                  description: t("ajo.creditsKudiWalletDirectly"),
                  onApprove: async (pin) => {
                    setTxnPin(null);
                    const result = await asoFundWallet(savedClient.id, a, pin);
                    if (result?.error) {
                      const msg = typeof result.error === "string" ? result.error : (result.error?.message || t("ajo.couldntFundWallet"));
                      setActionResult({ type: "failure", title: t("ajo.walletFundingFailed"), amount: a, counterparty: savedClient.full_name, reason: msg });
                    } else {
                      speakConfirmation("ajoDeposit", getLang());
                      setActionResult({ type: "success", title: t("ajo.walletFunded"), amount: a, counterparty: savedClient.full_name });
                    }
                  },
                });
                return;
              }

              if (action === "contribute") {
                if (contributeCtx === "personal_savings" && selectedCycles.length > 1 && !contributeCycleId) return;
                const savedClient = selected;
                const savedCtx = contributeCtx;
                const savedCycleId = contributeCycleId;
                const savedGroupId = contributeGroupId;
                setSelected(null); setAction(null); setAmt(""); setContributeCtx("personal_savings"); setContributeCycleId(null); setContributeGroupId(null);
                const result = await asoContribute(savedClient.id, a, savedCtx, savedCtx === "personal_savings" ? savedCycleId : null, savedCtx !== "personal_savings" ? savedGroupId : null);
                if (!result?.error) {
                  speakConfirmation("ajoDeposit", getLang());
                  // The stored row carries the database-issued reference, server time and balance.
                  let storedRow = null;
                  try {
                    const cid = result.data?.contribution_id;
                    if (cid) {
                      const { data: r } = await supabase.from("ajo_contributions")
                        .select("id, status, created_at, receipt_ref, balance_after").eq("id", cid).maybeSingle();
                      storedRow = r || null;
                    }
                  } catch (_) { /* receipt falls back to "Assigned on sync" */ }
                  setContribSuccess({ client: savedClient, amount: a, showShare: false, row: storedRow });
                } else {
                  setContribError(result.error);
                }
              } else {
                // Same limits as client self-service: cap to the selected entity's
                // own available balance (ajo_entity_stats) before ever opening the
                // PIN sheet.
                if ((contributeCycleId || contributeGroupId) && targetStats && a > Number(targetStats.available || 0)) {
                  setFundPayErr(t(contributeCycleId ? "ajo.onlyAvailableFromCard" : "ajo.onlyAvailableFromGroup", { amount: fmt(targetStats.available) }));
                  return;
                }
                // Clear modal first so it unmounts before PIN sheet opens
                const savedClient = selected;
                const savedAmt = a;
                const savedCycleId = contributeCtx === "personal_savings" ? contributeCycleId : null;
                const savedGroupId = contributeCtx !== "personal_savings" ? contributeGroupId : null;
                setSelected(null); setAction(null); setAmt(""); setContributeCtx("personal_savings");
                setTxnPin({
                  title: t("ajo.confirmWithdrawal"),
                  amount: Math.round(savedAmt * 100),
                  recipient: savedClient.full_name,
                  description: t("ajo.grossWithdrawalBalanceAfter", { balance: savedClient.current_balance - savedAmt >= 0 ? `₦${(savedClient.current_balance - savedAmt).toLocaleString()}` : t("ajo.pendingLower") }),
                  onApprove: async (pin) => {
                    setTxnPin(null);
                    const result = await asoWithdraw(savedClient.id, savedAmt, pin, savedCycleId, savedGroupId);
                    if (result?.error) {
                      const msg = typeof result.error === "string" ? result.error : (result.error?.message || t("ajo.couldntCompleteWithdrawal"));
                      setActionResult({ type: "failure", title: t("ajo.withdrawalFailed"), amount: savedAmt, counterparty: savedClient.full_name, reason: msg });
                    } else {
                      speakConfirmation("ajoWithdraw", getLang());
                      setActionResult({ type: "success", title: t("ajo.withdrawalRecorded"), amount: savedAmt, counterparty: savedClient.full_name });
                    }
                  },
                });
              }
            }}
            className={`w-full py-3.5 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm ${
              action === "contribute" ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"
            }`}>
            {action === "contribute" ? (contributeCtx === "wallet" ? t("ajo.confirmWalletFunding") : t("ajo.confirmContribution")) : t("ajo.confirmWithdrawal")}
          </button>
        </Modal>
      )}

      {/* Reminder modal */}
      {reminderFor && (
        <Modal title={t("ajo.sendPaymentReminder")} onClose={() => setReminderFor(null)}>
          <div className="flex items-center gap-3 mb-4 p-3 bg-brand-50 dark:bg-brand-900/20 rounded-xl border border-brand-200 dark:border-brand-800/60">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
              {reminderFor.profile_image_url
                ? <img src={reminderFor.profile_image_url} alt={reminderFor.full_name} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-gradient-to-br from-navy-400 to-navy-700 flex items-center justify-center text-white font-black text-base">
                    {(reminderFor.full_name || "?")[0].toUpperCase()}
                  </div>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{reminderFor.full_name}</p>
              <p className="text-xs text-brand-600 dark:text-brand-400 font-semibold capitalize">{FREQ_KEY[reminderFor.contribution_frequency] ? t(FREQ_KEY[reminderFor.contribution_frequency]) : reminderFor.contribution_frequency} · {fmt(reminderFor.contribution_amount)}</p>
            </div>
            {getMissedPayments(reminderFor) > 0 && (
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-2 py-1 rounded-full flex-shrink-0">
                {t("ajo.nMissed", { n: getMissedPayments(reminderFor) })}
              </span>
            )}
          </div>

          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{t("ajo.messagePreview")}</p>
          <div className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-4 mb-4 border border-slate-200 dark:border-slate-600 max-h-52 overflow-y-auto">
            <pre className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">{reminderMsg}</pre>
          </div>

          <div className="flex gap-2">
            <button onClick={() => handleCopy(reminderMsg)}
              className={`flex-1 py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 active:scale-[0.99] border ${
                copied
                  ? "bg-green-500 text-white border-green-500"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600"
              }`}>
              {copied ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {t("ajo.copied")}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  {t("ajo.copy")}
                </>
              )}
            </button>
            {waLink && (
              <a href={waLink} target="_blank" rel="noopener noreferrer"
                className="flex-1 py-3 bg-[#25D366] hover:bg-[#1fba59] text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 active:scale-[0.99]">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp
              </a>
            )}
          </div>
        </Modal>
      )}

      {receipt && (
        <TransactionDetailModal
          data={buildAsoClientReceipt(receipt, profile?.business_name || profile?.owner_name || "My Business", bizFromProfile(profile))}
          onClose={() => setReceipt(null)}
        />
      )}

      {/* ── Cash contribution success screen (Gate 4: WhatsApp share) ── */}
      {contribSuccess && (() => {
        const bizName = profile?.business_name || "My Business";
        const receiptData = buildAsoContributionReceipt(
          {
            id:             contribSuccess.row?.id || `CS-${Date.now()}`,
            type:           "contribution",
            status:         contribSuccess.row?.status === "pending" ? "pending" : "completed",
            amount:         contribSuccess.amount,
            created_at:     contribSuccess.row?.created_at || new Date().toISOString(),
            payment_method: "cash",
            receipt_ref:    contribSuccess.row?.receipt_ref,
            balance_after:  contribSuccess.row?.balance_after,
          },
          contribSuccess.client?.full_name || "Client",
          bizName
        );
        if (contribSuccess.showShare) {
          return (
            <TransactionDetailModal
              data={receiptData}
              onClose={() => setContribSuccess(s => ({ ...s, showShare: false }))}
            />
          );
        }
        return (
          <div className="fixed inset-0 z-sheet bg-white dark:bg-slate-900 flex flex-col">
            <div className="h-1 w-full bg-gradient-to-r from-brand-600 to-emerald-500" />
            <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
              <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-5 shadow-md">
                <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-green-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">{t("ajo.contributionRecorded")}</p>
              <p className="text-3xl font-black text-slate-800 dark:text-white mb-1">
                ₦{Number(contribSuccess.amount).toLocaleString("en-NG")}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {contribSuccess.client?.full_name} · {t("ajo.methodCash")}
              </p>
            </div>
            <div className="flex-none px-5 pb-10 pt-3 space-y-3">
              <button
                onClick={() => setContribSuccess(s => ({ ...s, showShare: true }))}
                className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] shadow-md">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                {t("ajo.shareReceipt")}
              </button>
              <button
                onClick={() => setContribSuccess(null)}
                className="w-full py-3.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-sm transition active:scale-[0.99]">
                {t("common.done")}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Contribution error overlay ───────────────────────────── */}
      {contribError && (
        <div className="fixed inset-0 z-sheet bg-white dark:bg-slate-900 flex flex-col">
          <div className="h-1 w-full bg-red-500" />
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-5 shadow-md">
              <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-red-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">{t("ajo.contributionFailed")}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-xs">{contribError}</p>
          </div>
          <div className="flex-none px-5 pb-10 pt-3">
            <button
              onClick={() => setContribError(null)}
              className="w-full py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl font-bold text-sm transition active:scale-[0.99]">
              {t("ajo.ok")}
            </button>
          </div>
        </div>
      )}

      {/* ── Per-client Contribution History Modal ────────────────── */}
      {historyFor && (() => {
        const { client: hc, contributions: hcons, cycles: hcycles } = historyFor;
        const bizName = profile?.business_name || profile?.owner_name || "My Business";

        const handleOpenCycle = async (form = {}) => {
          const body = {
            action: "open_cycle",
            client_id: hc.id,
            // start_date omitted — RPC defaults to CURRENT_DATE, never registration_date
            expected_amount_per_period: form.amount ? Number(form.amount) : hc.contribution_amount,
            commission_model: form.model || hc.commission_model || "none",
            commission_percent: form.model === "percent" ? (Number(form.percent) || null) : null,
            label: form.purpose?.trim() || undefined,
            frequency: form.frequency || hc.contribution_frequency || "monthly",
            ...(form.length ? { length_periods: Number(form.length) } : {}),
            force: false,
          };
          const { data, error } = await supabase.functions.invoke("ajo-write", { body });
          if (error) { setHistoryErr(friendlyError(error, t("ajo.failedOpenCycle"))); return; }

          if (!data?.ok) { setHistoryErr(data?.error || t("ajo.failedOpenCycleTryAgain")); return; }
          const { data: newCycle } = await supabase.from("ajo_cycles").select("*").eq("id", data.cycle_id).maybeSingle();
          if (newCycle) setHistoryFor(prev => ({ ...prev, cycles: [...(prev.cycles || []), newCycle] }));

          // Informational notice: first_period + reg fee both apply — client will carry both on day 1.
          // This is allowed by design; no action required from the owner.
          if (data?.conflict_notice === "REG_FEE_AND_FIRST_PERIOD") {
            setHistoryNote(t("ajo.cycleOpenedRegFeeFirstPeriod"));
          }
        };

        const handleCloseCycle = (cyc) => {
          if (!cyc) return;
          setCycleConfirm({
            title: t("ajo.closeCycle"),
            msg: t("ajo.markCycleCompleted", { label: cyc.label || t("ajo.thisCycle") }),
            confirmLabel: t("ajo.completeCycle"),
            onConfirm: async () => {
              const { data, error } = await supabase.functions.invoke("ajo-write", {
                body: { action: "close_cycle", cycle_id: cyc.id, status: "completed" },
              });
              if (error || !data?.ok) {
                setHistoryErr(data?.error || friendlyError(error, t("ajo.failedCloseCycle")));
                return;
              }
              const { data: updatedCycle } = await supabase.from("ajo_cycles").select("*").eq("id", cyc.id).maybeSingle();
              setHistoryFor(prev => ({
                ...prev,
                cycles: (prev.cycles || []).map(c => c.id === cyc.id ? (updatedCycle || c) : c),
              }));
            },
          });
        };

        const handleExecuteCommission = async (amount, pin, cyc) => {
          if (!cyc) return;
          const { data, error } = await supabase.functions.invoke("ajo-write", {
            body: { action: "execute_commission", cycle_id: cyc.id, amount, pin },
          });
          if (error || !data?.ok) {
            // Throw so ContributionCard's try/catch shows failure, not the unconditional success path.
            throw new Error(data?.error || friendlyError(error, t("ajo.commissionExecutionFailed")));
          }
          const { data: freshContribs } = await supabase
            .from("ajo_contributions")
            .select("*")
            .eq("aso_client_id", hc.id)
            .order("created_at", { ascending: false });
          setHistoryFor(prev => ({ ...prev, contributions: freshContribs || prev.contributions }));
        };

        const handleReverseContrib = async (tx, reason, pin) => {
          const result = await asoReverseContribution(tx.id, reason, pin);
          if (result.error) return result;
          const [{ data: freshContribs }, { data: freshClient }] = await Promise.all([
            supabase.from("ajo_contributions").select("*").eq("aso_client_id", hc.id).order("created_at", { ascending: false }),
            supabase.from("aso_clients").select("current_balance, total_saved, total_withdrawn").eq("id", hc.id).maybeSingle(),
          ]);
          setHistoryFor(prev => ({
            ...prev,
            contributions: freshContribs || prev.contributions,
            client: freshClient ? { ...prev.client, ...freshClient } : prev.client,
          }));
          return result;
        };

        return (
          <>
            {historyErr && (
              <div className="fixed inset-x-0 top-0 z-sub-sheet flex justify-center pt-safe pointer-events-none">
                <div className="pointer-events-auto bg-red-600 text-white text-xs font-semibold px-4 py-2 rounded-b-2xl shadow-lg flex items-center gap-2 max-w-xs">
                  <span>{historyErr}</span>
                  <button onClick={() => setHistoryErr("")} className="ml-auto font-bold">✕</button>
                </div>
              </div>
            )}
            {historyNote && (
              <div className="fixed inset-x-0 top-0 z-sub-sheet flex justify-center pt-safe pointer-events-none">
                <div className="pointer-events-auto bg-blue-600 text-white text-xs font-semibold px-4 py-2 rounded-b-2xl shadow-lg flex items-center gap-2 max-w-sm">
                  <span>{historyNote}</span>
                  <button onClick={() => setHistoryNote("")} className="ml-auto font-bold flex-shrink-0">✕</button>
                </div>
              </div>
            )}
            <AsoClientHistoryModal
              client={hc}
              contributions={hcons}
              cycles={hcycles}
              businessName={bizName}
              biz={bizFromProfile(profile)}
              staffMap={store.staffMap || {}}
              onClose={() => { setHistoryFor(null); setHistoryErr(""); setHistoryNote(""); }}
              onOpenCycle={isOwner ? handleOpenCycle : undefined}
              onCloseCycle={isOwner ? handleCloseCycle : undefined}
              onExecuteCommission={isOwner ? handleExecuteCommission : undefined}
              onReverseContrib={isOwner ? handleReverseContrib : undefined}
            />
          </>
        );
      })()}

      {clientProf && (
        <ClientProfile
          record={clientProf}
          type="aso"
          onSave={updateAsoClient}
          onClose={() => setClientProf(null)}
          staffList={staffOptions}
          groups={groups}
          onResetPwd={handleResetPwd}
          onRequestArchive={requestAsoClientArchive}
          canEditBank={!staffId}
          businessName={profile?.business_name || profile?.owner_name || ""}
        />
      )}

      {/* ── Ajo Client Registration Success Banner ───────────────── */}
      {addedClientEmail && (
        <div className="fixed inset-0 z-sheet flex items-center justify-center bg-black/50 px-5">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-extrabold text-slate-800 dark:text-white">{t("ajo.clientAccountCreated")}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{t("ajo.loginCredentialsSentAuto")}</p>
              </div>
            </div>
            <div className="bg-brand-50 dark:bg-brand-950/20 border border-brand-200 dark:border-brand-900/40 rounded-2xl px-4 py-3 mb-5">
              <p className="text-[11px] text-brand-800 dark:text-brand-300 font-medium leading-relaxed">
                {fillNodes(t("ajo.loginEmailSentTo"), { email: <span className="font-bold">{addedClientEmail}</span> })}
              </p>
            </div>
            {clientSubAcctErr && (
              <div className="mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl px-4 py-3 flex items-start gap-2">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                </svg>
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">{clientSubAcctErr}</p>
              </div>
            )}
            <button
              onClick={() => { setAddedClientEmail(""); setClientSubAcctErr(""); }}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl py-3.5 text-sm transition-colors">
              {t("common.done")}
            </button>
          </div>
        </div>
      )}

      {/* ── Client Password Reset Modal ───────────────────────────── */}
      {createdClient && (
        <div className="fixed inset-0 z-sheet flex items-center justify-center bg-black/50 px-5">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl max-h-[90dvh] flex flex-col">
            <div className="overflow-y-auto flex-1 p-6">

              {/* Header */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-600" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-extrabold text-slate-800 dark:text-white">{t("ajo.passwordReset")}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{t("ajo.newCredentialsFor", { name: createdClient.full_name.split(" ")[0] })}</p>
                </div>
              </div>

              {/* Credential cards */}
              <div className="space-y-3 mb-5">
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.emailLogin")}</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{createdClient.email}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.temporaryPassword")}</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-white font-mono">{createdClient._password}</p>
                    </div>
                    <button onClick={() => copyField(createdClient._password, "password")}
                      className="ml-3 text-[11px] font-bold text-brand-600 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 px-2.5 py-1.5 rounded-lg flex-shrink-0">
                      {copiedField === "password" ? t("ajo.copied") : t("ajo.copy")}
                    </button>
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.membershipNo")}</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-white font-mono">{createdClient.membership_number}</p>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl px-4 py-3 mb-4">
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
                  {t("ajo.shareNewCredentials")}
                </p>
              </div>

              <button onClick={closeClientCredentials}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl py-3.5 text-sm transition">
                {t("common.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Security Hold Reject Modal ──────────────────────────────────── */}
      {rejectingHeld && (
        <Modal title={t("ajo.rejectSecurityHeldWithdrawal")} onClose={() => { setRejectingHeld(null); setHeldRejectReason(""); }}>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {fillNodes(t("ajo.rejectingRequestOf"), {
              name: <strong className="text-slate-700 dark:text-slate-200">{rejectingHeld.aso_clients?.full_name || t("ajo.clientLower")}</strong>,
              amount: <strong className="text-orange-700 dark:text-orange-300">{fmt(rejectingHeld.amount)}</strong>,
            })}
          </p>
          <Field as="textarea" label={t("ajo.reasonRequired")} value={heldRejectReason}
            onChange={e => setHeldRejectReason(e.target.value)}
            placeholder={t("ajo.heldRejectPlaceholder")} />
          <button
            onClick={async () => {
              setHeldRejectBusy(true);
              await handleRejectRequest(rejectingHeld, heldRejectReason);
              setRejectingHeld(null);
              setHeldRejectReason("");
              setHeldRejectBusy(false);
            }}
            disabled={!heldRejectReason.trim() || heldRejectBusy}
            className="w-full py-3.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] mt-1">
            {heldRejectBusy ? t("ajo.rejecting") : t("ajo.rejectNotifyClient")}
          </button>
        </Modal>
      )}

      {/* ── Manual Deposit Reject Reason Modal ──────────────────────────── */}
      {rejectingDeposit && (
        <Modal title={t("ajo.rejectDepositClaim")} onClose={() => { setRejectingDeposit(null); setRejectReason(""); }}>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {fillNodes(t("ajo.rejectingClaimOf"), {
              name: <strong className="text-slate-700 dark:text-slate-200">{rejectingDeposit.aso_clients?.full_name || t("ajo.clientLower")}</strong>,
              amount: <strong className="text-brand-700 dark:text-brand-300">₦{Number(rejectingDeposit.amount).toLocaleString("en-NG")}</strong>,
            })}
          </p>
          <Field as="textarea" label={t("ajo.reasonRequired")} value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder={t("ajo.depositRejectPlaceholder")} />
          <button
            onClick={() => handleRejectDeposit(rejectingDeposit, rejectReason)}
            disabled={!rejectReason.trim() || processingDepositId === rejectingDeposit.id}
            className="w-full py-3.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] mt-1">
            {processingDepositId === rejectingDeposit.id ? t("ajo.rejecting") : t("ajo.rejectNotifyClient")}
          </button>
        </Modal>
      )}

      {/* ── Today's Collection overlay ──────────────────────────────────── */}
      {showCollection && (
        <div className="fixed inset-0 z-sub-sheet flex flex-col bg-white dark:bg-slate-900">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 pb-3 border-b border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-900 flex-shrink-0" style={{ paddingTop: "calc(12px + env(safe-area-inset-top))" }}>
            <button
              onClick={() => setShowCollection(false)}
              className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 active:scale-95 transition-transform">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="flex-1">
              <p className="font-extrabold text-slate-800 dark:text-white text-base">{t("ajo.todaysCollection")}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {t("ajo.nClientsDue", { n: asoClients.filter(c => { const due = effectiveNextDue(c); return c.status === "active" && !!due && due <= today(); }).length })}
              </p>
            </div>
          </div>
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <TodaysCollection
              clients={asoClients}
              groups={groups}
              onRecord={isOwner
                ? asoCollectionRecord
                : (clientId, amount, context, pin, cycleId) => asoContribute(clientId, amount, context, cycleId)}
              staffCanRecord={canContribute}
              clientCycles={collectionCycles}
            />
          </div>
        </div>
      )}

      {/* ── Ajo Groups Management Modal ─────────────────────────────────── */}
      {showGroups && isOwner && (
        <div className="fixed inset-0 z-sub-sheet bg-black/50 flex items-end justify-center"
          onPointerDown={e => { groupsBackdropDown.current = (e.target === e.currentTarget); }}
          onClick={e => { if (e.target === e.currentTarget && groupsBackdropDown.current) { groupsBackdropDown.current = false; setShowGroups(false); } }}>
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl flex flex-col" style={{ maxHeight: "90dvh" }}>
            {/* Header */}
            {savingsDashGid ? (() => {
              const dhGrp = groups.find(g => g.id === savingsDashGid);
              const dhRs  = dhGrp?.round_status || "not_started";
              return (
                <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setSavingsDashGid(null)}
                    className="w-9 h-9 bg-slate-100 dark:bg-slate-700 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-95 transition">
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-slate-800 dark:text-white text-sm truncate">{dhGrp?.name || t("ajo.savingsGroup")}</p>
                    <span className={`inline-block text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide mt-0.5 ${
                      dhRs === "active" ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
                      : dhRs === "target_met" ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                      : dhRs === "closed" ? "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                      : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                    }`}>
                      {dhRs === "not_started" ? t("ajo.statusNotStarted") : dhRs === "target_met" ? t("ajo.statusTargetMet") : dhRs === "closed" ? t("ajo.statusClosed") : t("ajo.chipActive")}
                    </span>
                  </div>
                  <button onClick={() => { setSavingsDashGid(null); setShowGroups(false); }} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              );
            })() : (
              <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
                <div className="w-9 h-9 bg-brand-100 dark:bg-brand-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5 text-brand-600 dark:text-brand-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-extrabold text-slate-800 dark:text-white text-sm">{t("ajo.ajoGroups")}</p>
                  <p className="text-[10px] text-slate-400">{t("ajo.manageSavingsGroups")}</p>
                </div>
                <button onClick={() => setShowGroups(false)} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}

            <div className={savingsDashGid ? "flex-1 overflow-y-auto" : "flex-1 overflow-y-auto px-5 py-4 space-y-4"}>

              {/* ── Savings group dashboard ── */}
              {savingsDashGid && (() => {
                const dashGrp = groups.find(g => g.id === savingsDashGid);
                if (!dashGrp) return null;
                const det     = savingsDetails[savingsDashGid] || { loading: true, pot: 0, members: [] };
                const rs      = dashGrp.round_status || "not_started";
                const target  = Number(dashGrp.target_amount || 0);
                const pot     = det.pot || 0;
                const pct     = target > 0 ? Math.min(100, (pot / target) * 100) : 0;
                const daysLeft = dashGrp.target_deadline
                  ? Math.ceil((new Date(dashGrp.target_deadline) - new Date()) / 86400000)
                  : null;
                const sortedMembers = [...(det.members || [])].sort((a, b) => b.contributed - a.contributed);
                const maxContrib    = Math.max(...sortedMembers.map(m => m.contributed), 1);
                const isActive      = rs === "active" || rs === "target_met";
                const isPendingGrp  = Boolean(groupApprovals.find(r => r.target_id === dashGrp.id));
                return (
                  <div className="px-4 py-4 space-y-4">
                    {det.loading ? (
                      <div className="flex justify-center py-12">
                        <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : (
                      <>
                        {/* Hero */}
                        <div className="bg-gradient-to-br from-slate-800 to-slate-900 dark:from-slate-700 dark:to-slate-800 rounded-2xl p-5 text-white">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t("ajo.totalSaved")}</p>
                          <p className="text-3xl font-extrabold tabular-nums leading-none">{fmt(pot)}</p>
                          {target > 0 && (
                            <p className="text-[11px] text-slate-400 mt-1">{fillNodes(t("ajo.ofTargetPct"), { target: fmt(target), pct: <span className="text-white font-bold">{Math.round(pct)}%</span> })}</p>
                          )}
                          {rs === "active" && daysLeft !== null && daysLeft >= 0 && (
                            <div className="flex items-center gap-1.5 mt-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                              <span className="text-[10px] text-green-400 font-bold">{t("ajo.nDaysRemaining", { n: daysLeft })}</span>
                            </div>
                          )}
                          {daysLeft !== null && daysLeft < 0 && isActive && (
                            <div className="flex items-center gap-1.5 mt-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              <span className="text-[10px] text-amber-400 font-bold">{t("ajo.deadlinePassedReadyClose")}</span>
                            </div>
                          )}
                        </div>

                        {/* Progress bar */}
                        {target > 0 && (
                          <div>
                            <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${rs === "target_met" ? "bg-gradient-to-r from-blue-400 to-blue-600" : "bg-gradient-to-r from-green-400 to-green-600"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{t("ajo.amountRaised", { amount: fmt(pot) })}</span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{t("ajo.amountToGo", { amount: fmt(Math.max(0, target - pot)) })}</span>
                            </div>
                          </div>
                        )}

                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { label: t("ajo.members"), value: String((det.members || []).length) },
                            { label: t("ajo.daysLeft"), value: daysLeft !== null ? (daysLeft >= 0 ? t("ajo.nDaysShort", { n: daysLeft }) : t("ajo.chipOverdue")) : "—" },
                            { label: t("ajo.txContribution"), value: dashGrp.contribution_amount ? fmt(dashGrp.contribution_amount) : "—" },
                            { label: t("ajo.frequency"), value: FREQ_LOWER_KEY[dashGrp.contribution_frequency] ? t(FREQ_LOWER_KEY[dashGrp.contribution_frequency]) : (dashGrp.contribution_frequency || "—") },
                          ].map(({ label, value }) => (
                            <div key={label} className="bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-slate-700">
                              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
                              <p className="text-sm font-extrabold text-slate-800 dark:text-white mt-0.5 capitalize tabular-nums">{value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Saving strength */}
                        <div>
                          <p className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">{t("ajo.savingStrength")}</p>
                          {sortedMembers.length === 0 ? (
                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 text-center border border-slate-100 dark:border-slate-700">
                              <p className="text-[11px] text-slate-400">{t("ajo.noContributionsYet")}</p>
                              {rs === "not_started" && <p className="text-[10px] text-slate-400 mt-0.5">{t("ajo.startRoundToTrack")}</p>}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {sortedMembers.map((m, idx) => {
                                const barPct    = maxContrib > 0 ? (m.contributed / maxContrib) * 100 : 0;
                                const sharePct  = pot > 0 ? Math.round((m.contributed / pot) * 100) : 0;
                                const barColor  = idx === 0
                                  ? "bg-gradient-to-r from-amber-400 to-amber-500"
                                  : idx === 1
                                    ? "bg-gradient-to-r from-slate-400 to-slate-500 dark:from-slate-300 dark:to-slate-400"
                                    : "bg-gradient-to-r from-green-400 to-green-500";
                                return (
                                  <div key={m.client_id} className="bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-slate-700">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <span className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 tabular-nums flex-shrink-0 w-5">#{idx + 1}</span>
                                        <p className="text-[11px] font-extrabold text-slate-800 dark:text-white truncate">{m.full_name}</p>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <span className="text-[10px] font-extrabold text-slate-600 dark:text-slate-300 tabular-nums">{fmt(m.contributed)}</span>
                                        <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{sharePct}%</span>
                                        {isActive && (
                                          <button
                                            type="button"
                                            onClick={() => handleReleaseSavingsMember(dashGrp.id, m.client_id, m.full_name)}
                                            className="text-[9px] font-bold text-red-500 dark:text-red-400 hover:underline ml-0.5">
                                            {t("ajo.release")}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${barPct}%` }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        {!isPendingGrp && (
                          <div className="space-y-2">
                            {(rs === "not_started" || rs === "closed") && (
                              <button
                                type="button"
                                onClick={() => { setStartRoundGid(dashGrp.id); setStartRoundTarget(""); setStartRoundDeadline(""); setStartRoundMsg({ id: null, text: "", ok: false }); }}
                                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] flex items-center justify-center gap-2">
                                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="10 8 16 12 10 16"/></svg>
                                {t("ajo.startSavingsRound")}
                              </button>
                            )}
                            {startRoundGid === dashGrp.id && (
                              <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3 space-y-2.5 border border-slate-200 dark:border-slate-600">
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{t("ajo.configureRound")}</p>
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.targetAmountNaira")}</p>
                                  <input type="number" min="1" placeholder={t("ajo.egValue", { v: "500000" })} value={startRoundTarget} onChange={e => setStartRoundTarget(e.target.value)}
                                    className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.targetDeadline")}</p>
                                  <input type="date" min={new Date(Date.now() + 86400000).toISOString().split("T")[0]} value={startRoundDeadline} onChange={e => setStartRoundDeadline(e.target.value)}
                                    className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                                </div>
                                {startRoundMsg.id === dashGrp.id && (
                                  <p className={`text-[10px] font-semibold ${startRoundMsg.ok ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>{startRoundMsg.text}</p>
                                )}
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => setStartRoundGid(null)} className="flex-1 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition">{t("common.cancel")}</button>
                                  <button type="button" onClick={() => handleStartSavingsRound(dashGrp.id)} disabled={startRoundSaving} className="flex-1 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 rounded-xl transition flex items-center justify-center gap-1">
                                    {startRoundSaving ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : t("ajo.startRound")}
                                  </button>
                                </div>
                              </div>
                            )}
                            {isActive && (
                              <button
                                type="button"
                                onClick={() => handleCloseSavingsRound(dashGrp.id)}
                                className="w-full py-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl font-bold text-sm border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition active:scale-[0.99]">
                                {t("ajo.closeGroupReleaseAll")}
                              </button>
                            )}
                          </div>
                        )}

                        {dashGrp.started_at && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
                            {t("ajo.roundStartedOn", { date: new Date(dashGrp.started_at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) })}
                          </p>
                        )}
                        <div className="h-6" />
                      </>
                    )}
                  </div>
                );
              })()}

              {!savingsDashGid && (<>
              {/* Groups list */}
              {groupsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : groups.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-500 dark:text-slate-400">{t("ajo.noGroupsYetCreate")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {groups.map(grp => {
                    const clientCount = asoClients.filter(c => c.ajo_group_id === grp.id).length;
                    const isRotating  = grp.group_mode === "rotating";
                    const pendingAppr      = groupApprovals.find(r => r.target_id === grp.id);
                    const isPendingEdit    = pendingAppr?.request_type === "group_edit";
                    const isLocked         = Boolean(pendingAppr);
                    const approvalMsg      = groupApprMsg.id === grp.id ? groupApprMsg : null;
                    const isEditOpen       = editingGroup === grp.id;
                    const isDeleteOpen     = deletingGroup === grp.id;
                    const isDirectEditOpen = directEditGroup === grp.id;

                    return (
                      <div key={grp.id} className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border shadow-sm ${isLocked ? "border-amber-200 dark:border-amber-700/50" : "border-slate-100 dark:border-slate-700"}`}>
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-700">
                            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                              <rect x="2" y="5" width="20" height="14" rx="2" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{grp.name}</p>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              <span className="text-[10px] text-slate-400">{t(clientCount !== 1 ? "ajo.nClientsLowerMany" : "ajo.nClientLowerOne", { n: clientCount })}</span>
                              {grp.contribution_frequency && <span className="text-[10px] text-slate-400">· {FREQ_LOWER_KEY[grp.contribution_frequency] ? t(FREQ_LOWER_KEY[grp.contribution_frequency]) : grp.contribution_frequency}</span>}
                              {grp.contribution_amount   && <span className="text-[10px] text-slate-400">· {fmt(grp.contribution_amount)}</span>}
                              {isRotating && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">{t("ajo.rotating")}</span>}
                            </div>
                          </div>
                        </div>
                        {isRotating && (
                          <button
                            onClick={() => { setShowGroups(false); openRotation(grp); }}
                            className="w-full mt-2 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                            </svg>
                            {t("ajo.manageRotation")}
                          </button>
                        )}

                        {/* ── Savings dashboard entry ── */}
                        {!isRotating && (
                          <button
                            type="button"
                            onClick={() => {
                              setSavingsDashGid(grp.id);
                              const det = savingsDetails[grp.id];
                              if (!det || det.loading) loadSavingsDetails(grp.id, grp.started_at);
                            }}
                            className="w-full mt-2 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                            </svg>
                            {t("ajo.savingsDashboard")}
                          </button>
                        )}

                        {/* ── Savings lifecycle panel ── */}
                        {!isRotating && (() => {
                          const rs     = grp.round_status || "not_started";
                          const target = Number(grp.target_amount || 0);
                          const det    = savingsDetails[grp.id];
                          const pot    = det?.pot || 0;
                          const pct    = target > 0 ? Math.min(100, Math.round((pot / target) * 100)) : 0;
                          const daysLeft = grp.target_deadline
                            ? Math.ceil((new Date(grp.target_deadline) - new Date()) / 86400000)
                            : null;
                          const deadlinePassed = daysLeft !== null && daysLeft < 0;

                          return (
                            <div className="mt-3 space-y-2">
                              {/* Status badge row */}
                              <div className="flex items-center justify-between">
                                <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                                  rs === "active"     ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
                                  : rs === "target_met" ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                                  : rs === "closed"   ? "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                                  : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                                }`}>
                                  {rs === "not_started" ? t("ajo.notStarted") : rs === "target_met" ? t("ajo.targetMetLower") : rs === "closed" ? t("ajo.statusClosed") : t("ajo.chipActive")}
                                </span>
                                {(rs === "active" || rs === "target_met") && target > 0 && (
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums font-semibold">
                                    {fmt(pot)} / {fmt(target)}
                                  </span>
                                )}
                              </div>

                              {/* Deadline passed prompt */}
                              {deadlinePassed && (rs === "active" || rs === "target_met") && (
                                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl px-3 py-2">
                                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                    {t("ajo.targetDeadlineReached", { pot: fmt(pot), target: fmt(target) })}
                                  </p>
                                </div>
                              )}

                              {/* Progress bar */}
                              {(rs === "active" || rs === "target_met") && target > 0 && (
                                <div>
                                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${rs === "target_met" ? "bg-blue-500" : "bg-green-500"}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{t("ajo.pctOfTarget", { pct })}</span>
                                    {daysLeft !== null && daysLeft >= 0 && (
                                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{t("ajo.nDaysLeft", { n: daysLeft })}</span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Member breakdown toggle */}
                              {(rs === "active" || rs === "target_met") && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (expandedSavingsGid === grp.id) {
                                      setExpandedSavingsGid(null);
                                    } else {
                                      setExpandedSavingsGid(grp.id);
                                      if (!det || !det.members) loadSavingsDetails(grp.id, grp.started_at);
                                    }
                                  }}
                                  className="w-full flex items-center justify-between px-2.5 py-1.5 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-200 dark:border-slate-600 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                  <span>{t("ajo.memberBreakdown")}</span>
                                  <svg viewBox="0 0 24 24" fill="none" className={`w-3 h-3 transition-transform ${expandedSavingsGid === grp.id ? "rotate-180" : ""}`} stroke="currentColor" strokeWidth={2.5}><polyline points="6 9 12 15 18 9"/></svg>
                                </button>
                              )}

                              {/* Member list */}
                              {expandedSavingsGid === grp.id && (
                                <div className="space-y-1 bg-slate-50 dark:bg-slate-700/30 rounded-xl p-2">
                                  {det?.loading && (
                                    <div className="flex justify-center py-2">
                                      <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                  )}
                                  {!det?.loading && (det?.members || []).map(m => (
                                    <div key={m.client_id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                                      <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate flex-1">{m.full_name}</p>
                                      <span className="text-[10px] font-extrabold text-slate-600 dark:text-slate-300 tabular-nums flex-shrink-0">{fmt(m.contributed)}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleReleaseSavingsMember(grp.id, m.client_id, m.full_name)}
                                        className="text-[9px] font-bold text-red-500 dark:text-red-400 hover:underline flex-shrink-0 ml-1">
                                        {t("ajo.release")}
                                      </button>
                                    </div>
                                  ))}
                                  {!det?.loading && (det?.members || []).length === 0 && (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center py-1">{t("ajo.noActiveMembers")}</p>
                                  )}
                                </div>
                              )}

                              {/* Start round button */}
                              {(rs === "not_started" || rs === "closed") && !isLocked && (
                                <button
                                  type="button"
                                  onClick={() => { setStartRoundGid(grp.id); setStartRoundTarget(""); setStartRoundDeadline(""); setStartRoundMsg({ id: null, text: "", ok: false }); }}
                                  className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                                  {t("ajo.startSavingsRoundLower")}
                                </button>
                              )}

                              {/* Start round modal */}
                              {startRoundGid === grp.id && (
                                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3 space-y-2.5 border border-slate-200 dark:border-slate-600">
                                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{t("ajo.startSavingsRound")}</p>
                                  <div>
                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.targetAmountNaira")}</p>
                                    <input type="number" min="1" placeholder={t("ajo.egValue", { v: "500000" })} value={startRoundTarget} onChange={e => setStartRoundTarget(e.target.value)}
                                      className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.targetDeadline")}</p>
                                    <input type="date" min={new Date(Date.now() + 86400000).toISOString().split("T")[0]} value={startRoundDeadline} onChange={e => setStartRoundDeadline(e.target.value)}
                                      className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                                  </div>
                                  {startRoundMsg.id === grp.id && (
                                    <p className={`text-[10px] font-semibold ${startRoundMsg.ok ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>{startRoundMsg.text}</p>
                                  )}
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setStartRoundGid(null)} className="flex-1 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition">{t("common.cancel")}</button>
                                    <button type="button" onClick={() => handleStartSavingsRound(grp.id)} disabled={startRoundSaving} className="flex-1 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 rounded-xl transition flex items-center justify-center gap-1">
                                      {startRoundSaving ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : t("ajo.startRound")}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Close group button */}
                              {(rs === "active" || rs === "target_met") && !isLocked && (
                                <button
                                  type="button"
                                  onClick={() => handleCloseSavingsRound(grp.id)}
                                  className="w-full py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl font-bold text-xs border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition active:scale-[0.99]">
                                  {t("ajo.closeGroupReleaseFunds")}
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {/* ── Pending approval badge ── */}
                        {isLocked && !approvalMsg && (
                          <div className="mt-3 flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                              </svg>
                              <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                {t(isPendingEdit ? "ajo.pendingAdminEditRequest" : "ajo.pendingAdminArchiveRequest")}
                              </p>
                            </div>
                            <button
                              onClick={() => cancelGroupRequest(pendingAppr.id, grp.id)}
                              className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline flex-shrink-0">
                              {t("common.cancel")}
                            </button>
                          </div>
                        )}

                        {/* ── Direct-edit result ── */}
                        {directEditMsg.id === grp.id && (
                          <p className={`mt-3 text-[10px] font-semibold px-3 py-2 rounded-xl ${directEditMsg.ok ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"}`}>
                            {directEditMsg.text}
                          </p>
                        )}

                        {/* ── Approval action result ── */}
                        {approvalMsg && (
                          <p className={`mt-3 text-[10px] font-semibold px-3 py-2 rounded-xl ${approvalMsg.ok ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"}`}>
                            {approvalMsg.text}
                          </p>
                        )}

                        {/* ── Action buttons ── */}
                        {!isLocked && !isEditOpen && !isDeleteOpen && !isDirectEditOpen && (
                          <div className="mt-3 grid grid-cols-3 gap-1.5">
                            <button
                              onClick={() => { setDirectEditGroup(grp.id); setDirectEditGf({ name: grp.name, description: grp.description || "", privacy_show_names: grp.privacy_show_names, privacy_show_amounts: grp.privacy_show_amounts }); setDirectEditMsg({ id: null, text: "", ok: false }); }}
                              className="py-2 bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-[10px] border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition active:scale-[0.99]">
                              {t("ajo.editDetails")}
                            </button>
                            <button
                              onClick={() => { setEditingGroup(grp.id); setEditGf({ contribution_amount: grp.contribution_amount ?? "", contribution_frequency: grp.contribution_frequency || "monthly", group_mode: grp.group_mode || "savings", percentage_charge: grp.percentage_charge ?? 100 }); setGroupApprReason(""); setGroupApprMsg({ id: null, text: "", ok: false }); }}
                              className="py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-xl font-bold text-[10px] border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition active:scale-[0.99]">
                              {t("ajo.settings")}
                            </button>
                            <button
                              onClick={() => openArchiveRequest(grp)}
                              className="py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl font-bold text-[10px] border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition active:scale-[0.99]">
                              {t("ajo.archive")}
                            </button>
                          </div>
                        )}

                        {/* ── Direct-edit panel — name, description, privacy (no approval needed) ── */}
                        {isDirectEditOpen && (
                          <div className="mt-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3 space-y-2.5 border border-slate-200 dark:border-slate-600">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">{t("ajo.editGroupDetails")}</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">{t("ajo.nameDescApplyImmediately")}</p>
                            {[
                              { label: t("ajo.groupName"), key: "name", type: "text" },
                              { label: t("ajo.description"), key: "description", type: "text" },
                            ].map(({ label, key, type }) => (
                              <div key={key}>
                                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
                                <input type={type} value={directEditGf[key] ?? ""} onChange={e => setDEG(key, e.target.value)}
                                  className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </div>
                            ))}
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">{t("ajo.privacy")}</p>
                              <div className="flex flex-col gap-1.5">
                                {[
                                  { label: t("ajo.showMemberNamesToMembers"), key: "privacy_show_names" },
                                  { label: t("ajo.showContribAmountsToMembers"), key: "privacy_show_amounts" },
                                ].map(({ label, key }) => (
                                  <button key={key} type="button"
                                    onClick={() => setDEG(key, !(directEditGf[key] ?? false))}
                                    className={`flex items-center gap-2 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition text-left ${(directEditGf[key] ?? false) ? "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400" : "bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"}`}>
                                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${(directEditGf[key] ?? false) ? "bg-green-500" : "bg-slate-300 dark:bg-slate-500"}`} />
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => submitDirectEdit(grp)}
                                disabled={directEditSaving}
                                className="flex-1 py-2 bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                                {directEditSaving ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />{t("common.saving")}</> : t("ajo.saveChanges")}
                              </button>
                              <button onClick={() => setDirectEditGroup(null)}
                                className="px-4 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                                {t("common.cancel")}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ── Settings change panel — financial fields (approval required) ── */}
                        {isEditOpen && (
                          <div className="mt-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 space-y-2.5 border border-blue-200 dark:border-blue-800">
                            <p className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">{t("ajo.requestSettingsChange")}</p>
                            <p className="text-[10px] text-blue-600 dark:text-blue-400">{t("ajo.financialChangesNeedApproval")}</p>
                            {[
                              { label: t("ajo.contributionAmountNaira"), key: "contribution_amount", type: "number" },
                            ].map(({ label, key, type }) => (
                              <div key={key}>
                                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
                                <input type={type} value={editGf[key] ?? ""} onChange={e => setEG(key, e.target.value)}
                                  className="w-full text-sm bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              </div>
                            ))}
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.frequency")}</p>
                              <select value={editGf.contribution_frequency || "monthly"} onChange={e => setEG("contribution_frequency", e.target.value)}
                                className="w-full text-sm bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none">
                                {["daily","weekly","monthly"].map(fr => <option key={fr} value={fr}>{t(FREQ_KEY[fr])}</option>)}
                              </select>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{t("ajo.groupMode")}</p>
                              <select value={editGf.group_mode || "savings"} onChange={e => setEG("group_mode", e.target.value)}
                                className="w-full text-sm bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none">
                                <option value="savings">{t("ajo.savings")}</option>
                                <option value="rotating">{t("ajo.rotatingEsusu")}</option>
                              </select>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-0.5">{t("ajo.reasonForChangeReq")}</p>
                              <textarea rows={2} value={groupApprReason} onChange={e => setGroupApprReason(e.target.value)} placeholder={t("ajo.whyChangeSettings")}
                                className="w-full text-sm bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none resize-none" />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => submitGroupEditRequest(grp)}
                                disabled={groupApprSubmitting || !groupApprReason.trim()}
                                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                                {groupApprSubmitting ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />{t("ajo.submitting")}</> : t("ajo.submitRequest")}
                              </button>
                              <button onClick={() => { setEditingGroup(null); setGroupApprReason(""); }}
                                className="px-4 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                                {t("common.cancel")}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ── Archive panel — safety-gated ── */}
                        {isDeleteOpen && (
                          <div className="mt-3 bg-red-50 dark:bg-red-900/20 rounded-xl p-3 space-y-2.5 border border-red-200 dark:border-red-800">
                            <p className="text-xs font-bold text-red-700 dark:text-red-300 uppercase tracking-wider">{t("ajo.requestGroupArchive")}</p>
                            {archiveSafetyLoading === grp.id ? (
                              <div className="flex items-center gap-2 py-1">
                                <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                                <p className="text-[10px] text-red-600 dark:text-red-400">{t("ajo.checkingGroupStatus")}</p>
                              </div>
                            ) : archiveSafety[grp.id] ? (
                              archiveSafety[grp.id].safe ? (
                                <div className="space-y-2.5">
                                  <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
                                    {fillNodes(t(clientCount !== 1 ? "ajo.archivingGroupWarnMany" : "ajo.archivingGroupWarnOne", { n: clientCount }), { name: <strong>{grp.name}</strong> })}
                                  </p>
                                  <div>
                                    <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-0.5">{t("ajo.reasonForArchiveReq")}</p>
                                    <textarea rows={2} value={groupApprReason} onChange={e => setGroupApprReason(e.target.value)} placeholder={t("ajo.whyArchiveGroup")}
                                      className="w-full text-sm bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none resize-none" />
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      onClick={() => submitGroupDeleteRequest(grp)}
                                      disabled={groupApprSubmitting || !groupApprReason.trim()}
                                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                                      {groupApprSubmitting ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />{t("ajo.submitting")}</> : t("ajo.submitArchiveRequest")}
                                    </button>
                                    <button onClick={() => { setDeletingGroup(null); setGroupApprReason(""); }}
                                      className="px-4 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                                      {t("common.cancel")}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <p className="text-[10px] font-semibold text-red-700 dark:text-red-300">{t("ajo.groupCannotArchiveYet")}</p>
                                  {archiveSafety[grp.id].activeRound && (
                                    <div className="bg-red-100 dark:bg-red-900/30 rounded-lg px-3 py-2">
                                      <p className="text-[10px] font-bold text-red-700 dark:text-red-300">{t("ajo.activeRotationInProgress")}</p>
                                      <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{t("ajo.closeRoundBeforeArchive")}</p>
                                    </div>
                                  )}
                                  {archiveSafety[grp.id].unsettledMembers.length > 0 && (
                                    <div className="bg-red-100 dark:bg-red-900/30 rounded-lg px-3 py-2 space-y-1">
                                      <p className="text-[10px] font-bold text-red-700 dark:text-red-300">
                                        {t(archiveSafety[grp.id].unsettledMembers.length !== 1 ? "ajo.nMembersUnsettledMany" : "ajo.nMemberUnsettledOne", { n: archiveSafety[grp.id].unsettledMembers.length })}
                                      </p>
                                      <ul className="space-y-0.5">
                                        {archiveSafety[grp.id].unsettledMembers.map(m => (
                                          <li key={m.id} className="text-[10px] text-red-600 dark:text-red-400 flex justify-between">
                                            <span>{m.full_name}</span>
                                            <span className="font-mono font-bold">{fmt(m.current_balance)}</span>
                                          </li>
                                        ))}
                                      </ul>
                                      <p className="text-[10px] text-red-600 dark:text-red-400">{t("ajo.allBalancesWithdrawnFirst")}</p>
                                    </div>
                                  )}
                                  <button
                                    onClick={() => { setDeletingGroup(null); setArchiveSafety(prev => { const n = { ...prev }; delete n[grp.id]; return n; }); }}
                                    className="w-full mt-1 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                                    {t("common.close")}
                                  </button>
                                </div>
                              )
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add group form */}
              {showGroupAdd ? (
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 space-y-3 border border-slate-200 dark:border-slate-700">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">{t("ajo.newAjoGroup")}</p>
                  {groupError && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-xl">{groupError}</p>}
                  <Field label={t("ajo.groupNameReq")} value={gf.name} onChange={e => setG("name", e.target.value)} placeholder={t("ajo.groupNamePlaceholder")} />

                  {/* Group mode toggle */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{t("ajo.groupType")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[["savings", t("ajo.savingsGroup")], ["rotating", t("ajo.rotatingEsusu")]].map(([val, label]) => (
                        <button key={val} type="button" onClick={() => setG("group_mode", val)}
                          className={`py-2.5 rounded-xl text-xs font-bold border transition
                            ${gf.group_mode === val
                              ? "bg-brand-600 border-brand-600 text-white"
                              : "bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Privacy toggles for rotating groups */}
                  {gf.group_mode === "rotating" && (
                    <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl p-3 space-y-2.5">
                      <p className="text-[10px] font-bold text-brand-600 dark:text-brand-400 uppercase tracking-wider">{t("ajo.memberPrivacy")}</p>
                      {[
                        { key: "privacy_show_names",   label: t("ajo.showFullNamesToMembers") },
                        { key: "privacy_show_amounts", label: t("ajo.showOthersAmountsToMembers") },
                      ].map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-3 cursor-pointer">
                          <div className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 relative ${gf[key] ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"}`}
                            onClick={() => setG(key, !gf[key])}>
                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${gf[key] ? "left-4" : "left-0.5"}`} />
                          </div>
                          <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t("ajo.monthlyAmountNaira")} type="number" value={gf.contribution_amount} onChange={e => setG("contribution_amount", e.target.value)} placeholder="0" />
                    <Field label={t("ajo.frequency")} as="select" value={gf.contribution_frequency} onChange={e => setG("contribution_frequency", e.target.value)}>
                      <option value="daily">{t("ajo.freqDaily")}</option>
                      <option value="weekly">{t("ajo.freqWeekly")}</option>
                      <option value="monthly">{t("ajo.freqMonthly")}</option>
                      <option value="custom">{t("ajo.customDays")}</option>
                    </Field>
                  </div>

                  {gf.contribution_frequency === "custom" && (
                    <Field label={t("ajo.everyHowManyDaysReq")} type="number" min={1} value={gf.custom_interval_days}
                      onChange={e => setG("custom_interval_days", e.target.value)} placeholder={t("ajo.egValue", { v: "3" })} />
                  )}

                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setShowGroupAdd(false); setGf(BLANK_GROUP); setGroupError(""); }}
                      className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs transition">
                      {t("common.cancel")}
                    </button>
                    <button onClick={saveGroup} disabled={groupSaving || !gf.name}
                      className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition active:scale-[0.99]">
                      {groupSaving ? t("common.saving") : t("ajo.createGroup")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setShowGroupAdd(true); setGroupError(""); setGf(BLANK_GROUP); }}
                  className="w-full py-3.5 border-2 border-dashed border-brand-200 dark:border-brand-800 text-brand-600 dark:text-brand-400 rounded-2xl font-bold text-sm transition hover:bg-brand-50 dark:hover:bg-brand-900/20 active:scale-[0.99]">
                  {t("ajo.createNewGroupPlus")}
                </button>
              )}

              <div className="h-4" />
              </>)}
            </div>
          </div>
        </div>
      )}
      {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}
      {actionResult && (
        <ResultOverlay
          type={actionResult.type}
          title={actionResult.title}
          amount={actionResult.amount}
          counterparty={actionResult.counterparty}
          note={actionResult.note}
          reason={actionResult.reason}
          onPrimary={() => setActionResult(null)}
        />
      )}

      {/* ── Cycle open/close confirm strip ──── */}
      {cycleConfirm && (
        <div className="fixed inset-0 z-modal bg-black/50 flex items-end justify-center px-4 pb-6">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-xl">
            <p className="font-extrabold text-slate-800 dark:text-white text-sm mb-2">{cycleConfirm.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-5">{cycleConfirm.msg}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setCycleConfirm(null)}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs transition active:scale-95">
                {t("common.cancel")}
              </button>
              <button
                onClick={async () => { const fn = cycleConfirm.onConfirm; setCycleConfirm(null); await fn(); }}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-xs transition active:scale-95">
                {cycleConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Esusu Rotation Dashboard Modal ──────────────────────────────────── */}
      {showRotation && (
        <div className="fixed inset-0 z-modal bg-black/50 flex items-end justify-center" onClick={e => { if (e.target === e.currentTarget) setShowRotation(null); }}>
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl flex flex-col" style={{ maxHeight: "92dvh" }}>
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
              <div className="w-9 h-9 bg-navy-100 dark:bg-navy-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5 text-navy-600 dark:text-navy-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-extrabold text-slate-800 dark:text-white text-sm">{showRotation.name}</p>
                <p className="text-[10px] text-slate-400">{t("ajo.esusuRotation")}</p>
              </div>
              <button onClick={() => setShowRotation(null)} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <EsusuRotationDashboard
                data={rotationData}
                loading={rotationLoading}
                isOwner={isOwner}
                myClientId={null}
                onRefresh={() => loadRotation(showRotation.id)}
                onStartRound={handleStartRound}
                onExecutePayout={handleExecutePayout}
                onSkipTurn={handleSkipTurn}
                onReorderTurns={handleReorderTurns}
                onCloseRound={handleCloseRound}
              />
              <div className="h-4" />
            </div>
          </div>
        </div>
      )}
      {assigningClient && (
        <AssignRecordModal
          type="aso"
          record={assigningClient}
          branchList={store.branchList || []}
          staffList={store.staffList  || []}
          onSave={async (brId, stId) => {
            await store.updateAsoClient(assigningClient.id, { branch_id: brId, staff_id: stId });
          }}
          onClose={() => setAssigningClient(null)}
        />
      )}
    </div>
  );
}
