import { useState, useEffect, useRef } from "react";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import Field  from "../components/shared/Field";
import Badge  from "../components/shared/Badge";
import TransactionDetailModal from "../components/shared/TransactionDetailModal";
import { buildAsoContributionReceipt, buildAsoClientReceipt } from "../utils/receiptConfig";
import { ClientProfile } from "../components/shared/ClientProfile";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { supabase } from "../utils/supabase";
import { canDo, featureLimit, upgradeLabel, planRequiredLabel, planAvailableText } from "../utils/plans";
import { fmt, today, applyPeriodFilter } from "../utils/helpers";
import PeriodFilter from "../components/shared/PeriodFilter";
import { AmountDisplay } from "../components/shared/AmountDisplay";
import { createReportPdf, fmtCurrency as pdfFmt, fmtDate as pdfFmtDate } from "../utils/generateReportPdf";
import { buildAjoStatementCSV, ajoCSVFilename, shareCSV } from "../utils/exportCSV";
import ContributionCard from "../components/ContributionCard";
import EsusuRotationDashboard from "../components/EsusuRotationDashboard";
import TodaysCollection from "../components/TodaysCollection";
import { useT } from "../contexts/LanguageContext";
import { getLang, speakConfirmation } from "../utils/i18n";
import AssignRecordModal from "../components/AssignRecordModal";
import TransactionPinModal from "../components/TransactionPinModal";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { InAppBrowser, ToolBarType } from "@capgo/capacitor-inappbrowser";
import { friendlyError } from "../utils/errorMessage";

const BLANK = {
  full_name: "", contribution_frequency: "daily", contribution_amount: "",
  registration_charge: "", notes: "",
  phone: "", email: "", nin: "",
  address: "", state: "", lga: "", ward: "",
  next_of_kin: "", next_of_kin_phone: "", next_of_kin_email: "", next_of_kin_address: "",
  staff_id: "", ajo_group_id: null,
  bank_code: "", account_number: "", account_name: "", bank_name: "",
  commission_model: "none", commission_percent: "",
};

const BLANK_GROUP = {
  name: "", description: "", contribution_amount: "", contribution_frequency: "monthly",
  bank_code: "", account_number: "", account_name: "",
  group_mode: "savings", privacy_show_names: true, privacy_show_amounts: false,
};

const FREQ_DAYS = { daily: 1, weekly: 7, monthly: 30 };

const TX_TYPE_LABEL = {
  contribution:    "Contribution",
  withdrawal:      "Withdrawal",
  reversal:        "Reversal",
  disbursement:    "Disbursement",
  withdrawal_fee:  "Withdrawal Fee",
  registration_fee:"Registration Fee",
  commission:      "Commission",
};
const METHOD_LABEL = {
  cash:            "Cash",
  manual_transfer: "Bank Transfer",
  bank_transfer:   "Bank Transfer",
  paystack:        "Paystack",
  online:          "Online",
};

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-5 mb-2">
      {children}
    </p>
  );
}

async function uploadPhoto(file, id) {
  const path = `clients/aso/${id}`;
  await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

function daysDiff(dateStr) {
  if (!dateStr) return 0;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  return Math.floor((t - d) / 86400000);
}

function getMissedPayments(c) {
  if (!c.registration_date || !c.contribution_amount || c.contribution_amount <= 0) return 0;
  const days = FREQ_DAYS[c.contribution_frequency] || 30;
  const since = daysDiff(c.registration_date);
  const expected = Math.floor(since / days);
  const actual   = Math.floor((c.total_saved || 0) / c.contribution_amount);
  return Math.max(0, expected - actual);
}

function getContribsMade(c) {
  if (!c.contribution_amount || c.contribution_amount <= 0) return 0;
  return Math.floor((c.total_saved || 0) / c.contribution_amount);
}

function getExpectedContribs(c) {
  if (!c.registration_date || !c.contribution_amount || c.contribution_amount <= 0) return 0;
  const days  = FREQ_DAYS[c.contribution_frequency] || 30;
  const since = daysDiff(c.registration_date);
  return Math.floor(since / days);
}

function isOverdue(c) {
  return c.status === "active" && c.next_contribution_date && daysDiff(c.next_contribution_date) > 0;
}

function buildReminderMsg(c, businessName) {
  const missed  = getMissedPayments(c);
  const freqMap = { daily: "daily", weekly: "weekly", monthly: "monthly" };
  const missedLine = missed > 0
    ? `\n⚠ Missed payments: ${missed}`
    : "";
  const biz = businessName ? `\nBusiness: ${businessName}` : "";
  return `Dear ${c.full_name},\n\nThis is a friendly reminder about your Aso savings contribution.${missedLine}\n\nFrequency: ${freqMap[c.contribution_frequency] || c.contribution_frequency}\nContribution Amount: ${fmt(c.contribution_amount)}\nNext Due Date: ${c.next_contribution_date || "N/A"}\nCurrent Balance: ${fmt(c.current_balance)}\nTotal Contributed: ${fmt(c.total_saved)}${biz}\n\nPlease keep your contributions up to date. Thank you!`;
}

function isGroupAccount(c) {
  const keywords = ["cooperative", "group", "association", "union", "society", "club", "community", "women", "men", "market", "traders"];
  const name = (c.full_name || "").toLowerCase();
  return keywords.some(k => name.includes(k));
}

/* ── Per-client Ajo Contribution History Modal ─────────────────────────── */
function AsoClientHistoryModal({ client, contributions, cycles = [], businessName, staffMap = {}, onClose, onOpenCycle, onCloseCycle, onExecuteCommission, onReverseContrib }) {
  const [tab,          setTab]          = useState(cycles.length > 0 ? "card" : "history");
  const [showNewCycle, setShowNewCycle] = useState(false);
  const [newCycleForm, setNewCycleForm] = useState({
    purpose:   "",
    amount:    client.contribution_amount ?? "",
    frequency: client.contribution_frequency || "monthly",
    length:    "",
    model:     client.commission_model || "none",
    percent:   client.commission_percent ?? "",
  });
  // Auto-switch to card tab when a cycle is added
  useEffect(() => { if (cycles.length > 0) setTab("card"); }, [cycles.length]);
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
    { id: "all", label: "All" },
    { id: "contribution", label: "Contributions" },
    { id: "withdrawal", label: "Withdrawals" },
  ];

  return (
    <div className="fixed inset-0 z-sheet bg-black/60 flex flex-col">
      {receipt && (
        <TransactionDetailModal
          data={buildAsoContributionReceipt(receipt, client.full_name, businessName)}
          onClose={() => setReceipt(null)}
        />
      )}

      {/* Reverse entry — reason step */}
      {reverseFor && reverseStep === "reason" && (
        <div className="fixed inset-0 z-sub-sheet bg-black/60 flex items-end justify-center">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl w-full max-w-lg p-5 pb-8">
            <h3 className="text-base font-black text-slate-800 dark:text-white mb-1">Reverse Entry</h3>
            <p className="text-xs text-slate-400 mb-4">
              Reverse ₦{Number(reverseFor.amount || 0).toLocaleString("en-NG")} contribution
              from {new Date(reverseFor.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
            </p>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">Reason (required)</label>
            <textarea
              value={reverseReason}
              onChange={e => setReverseReason(e.target.value)}
              placeholder="e.g. Entered by mistake, wrong amount, duplicate..."
              rows={3}
              className="w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-white rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            {reverseError && <p className="text-xs text-red-500 mt-2">{reverseError}</p>}
            <div className="flex gap-3 mt-4">
              <button onClick={() => { setReverseFor(null); setReverseReason(""); setReverseError(""); }}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-slate-500 bg-slate-100 dark:bg-slate-800 active:scale-[0.98] transition">
                Cancel
              </button>
              <button onClick={() => {
                if (!reverseReason.trim()) { setReverseError("Please enter a reason."); return; }
                setReverseError("");
                setReverseStep("pin");
              }}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-amber-500 active:scale-[0.98] transition">
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse entry — PIN step */}
      {reverseFor && reverseStep === "pin" && (
        <TransactionPinModal
          title="Confirm Reversal"
          amount={Math.round((reverseFor.amount || 0) * 100)}
          recipient={client.full_name}
          description={`Reverse ₦${Number(reverseFor.amount || 0).toLocaleString("en-NG")} · ${reverseReason}`}
          onCancel={() => { setReverseStep("reason"); setReverseError(""); }}
          onApprove={async (pin) => {
            const result = await onReverseContrib(reverseFor, reverseReason.trim(), pin);
            if (result?.error) {
              setReverseStep("reason");
              setReverseError(result.error);
            } else {
              setReverseFor(null);
              setReverseReason("");
              setReverseStep("reason");
              setReverseError("");
            }
          }}
        />
      )}

      <div className="bg-white dark:bg-slate-900 flex flex-col h-full max-w-lg w-full mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-slate-100 dark:border-slate-800" style={{ paddingTop: "max(16px, env(safe-area-inset-top, 16px))" }}>
          <div className="min-w-0 flex-1 mr-2">
            <h2 className="text-base font-black text-slate-800 dark:text-white truncate">{client.full_name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tab === "card" ? "Contribution Card" : "Ajo Transaction History"}</p>
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
              <button onClick={handleExportCsv} title="Export CSV"
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
            Card
          </button>
          <button
            onClick={() => setTab("history")}
            className={`pb-2 pt-2 text-xs font-bold transition-colors border-b-2 ${tab === "history" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`}
          >
            History
          </button>
        </div>

        {/* Card tab */}
        {tab === "card" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {cycles.map((cyc, idx) => (
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
            {cycles.length === 0 && (
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
                  <p className="text-sm font-bold text-slate-700 dark:text-white">New Saving Cycle</p>

                  {/* Purpose — required; must be unique among active cycles for this client */}
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Purpose <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      placeholder="e.g. House Fund, School Fees…"
                      value={newCycleForm.purpose}
                      onChange={e => setNewCycleForm(f => ({ ...f, purpose: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {/* Amount + Frequency */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Amount / period (₦)</label>
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
                      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Frequency</label>
                      <select
                        value={newCycleForm.frequency}
                        onChange={e => setNewCycleForm(f => ({ ...f, frequency: e.target.value }))}
                        className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                  </div>

                  {/* Length (optional) */}
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Length (periods) — optional</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Leave blank for default"
                      value={newCycleForm.length}
                      onChange={e => setNewCycleForm(f => ({ ...f, length: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {/* Fee model */}
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Fee model</label>
                    <select
                      value={newCycleForm.model}
                      onChange={e => setNewCycleForm(f => ({ ...f, model: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                      <option value="none">No withdrawal fee</option>
                      <option value="percent">% on withdrawals</option>
                      <option value="first_period">First deposit (collector&apos;s day 1)</option>
                    </select>
                  </div>

                  {/* Fee % — only when model is percent */}
                  {newCycleForm.model === "percent" && (
                    <div>
                      <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Fee %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        placeholder="e.g. 5"
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
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!newCycleForm.purpose.trim()) return;
                        onOpenCycle({ ...newCycleForm });
                        setShowNewCycle(false);
                        setNewCycleForm(f => ({ ...f, purpose: "" }));
                      }}
                      className="flex-1 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-bold">
                      Open Cycle
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewCycle(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-400 rounded-2xl text-sm font-bold active:scale-[0.98] transition">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Open New Saving Cycle
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
              <p className="text-slate-400 text-sm font-semibold">No records found</p>
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
                      {TX_TYPE_LABEL[tx.type] ?? tx.type} · {METHOD_LABEL[tx.payment_method] ?? "Cash"}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{dateStr}</p>
                    {tx.recorded_by && staffMap[tx.recorded_by] && (
                      <p className="text-[10px] text-brand-600 dark:text-brand-400 mt-0.5">by: {staffMap[tx.recorded_by]}</p>
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
                        Reverse entry
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
                          Clear flag
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
    </div>
  );
}

export default function Aso({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade, staffId = null, embedded }) {
  const t = useT();
  const [showAdd,      setShowAdd]      = useState(false);
  const [selected,              setSelected]             = useState(null);
  const [action,                setAction]               = useState(null);
  const [amt,                   setAmt]                  = useState("");
  const [contributeCtx,         setContributeCtx]        = useState("personal_savings");
  const [contributeGroupId,     setContributeGroupId]    = useState(null);
  const [contributeCycleId,     setContributeCycleId]    = useState(null);
  const [selectedCycles,        setSelectedCycles]       = useState([]); // active personal_savings cycles for selected client
  const [selectedClientMems,    setSelectedClientMems]   = useState([]); // group memberships for selected client
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

  const { asoClients, addAsoClient, asoContribute, asoCollectionRecord, asoWithdraw, asoReverseContribution, updateAsoClient, requestAsoClientArchive, cancelAsoClientArchive, profile, staffMap = {} } = store;
  const staffOptions = Object.entries(staffMap).map(([id, name]) => ({ id, name }));

  const [withdrawalRequests,  setWithdrawalRequests]  = useState([]);
  const [processingId,        setProcessingId]        = useState(null);
  const [cancellingArchiveId, setCancellingArchiveId] = useState(null);
  const [approveError,        setApproveError]        = useState({ id: null, text: "" });
  const [txnPin,              setTxnPin]              = useState(null);
  const [contribSuccess,      setContribSuccess]      = useState(null); // { client, amount, showShare }
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


  // Ajo Groups management
  const [showGroups,           setShowGroups]           = useState(false);
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
  const [archiveSafetyLoading, setArchiveSafetyLoading] = useState(null); // grp.id being checked
  // Rotation management
  const [showRotation,   setShowRotation]   = useState(null); // group object
  const [rotationData,   setRotationData]   = useState(null);
  const [rotationLoading, setRotationLoading] = useState(false);
  const [resolving,      setResolving]      = useState(false);
  const [resolvedName,   setResolvedName]   = useState("");
  const [subAcctCreating, setSubAcctCreating] = useState(null); // group id
  const [subAcctMsg,     setSubAcctMsg]     = useState("");

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
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const lgas  = getLGAs(f.state);
  const wards = getWards(f.state, f.lga);

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
    supabase.functions.invoke("paystack", { body: { action: "list-banks" } })
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

  // Fetch group memberships and active cycles for the selected client when contribute modal opens
  useEffect(() => {
    if (!selected?.id || action !== "contribute") {
      setSelectedClientMems([]); setContributeGroupId(null);
      setSelectedCycles([]); setContributeCycleId(null);
      return;
    }
    supabase.from("aso_client_group_memberships")
      .select("group_id, status, ajo_groups(id, name, group_mode)")
      .eq("client_id", selected.id)
      .eq("status", "active")
      .then(({ data }) => {
        setSelectedClientMems(data || []);
        // Backwards compat: if junction table is empty, fall back to ajo_group_id
        if ((!data || data.length === 0) && selected.ajo_group_id) {
          const sg = groups.find(g => g.id === selected.ajo_group_id);
          if (sg) setSelectedClientMems([{ group_id: sg.id, status: "active", ajo_groups: sg }]);
        }
      })
      .catch(() => {
        if (selected.ajo_group_id) {
          const sg = groups.find(g => g.id === selected.ajo_group_id);
          if (sg) setSelectedClientMems([{ group_id: sg.id, status: "active", ajo_groups: sg }]);
        }
      });
    supabase.from("ajo_cycles")
      .select("id, label, commission_model")
      .eq("client_id", selected.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const cycs = data || [];
        setSelectedCycles(cycs);
        setContributeCycleId(cycs.length === 1 ? cycs[0].id : null);
      })
      .catch(() => {});
  }, [selected?.id, action]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveClientAccount = async () => {
    if (!f.account_number || !f.bank_code) return;
    setClientBankResolving(true); setClientBankErr(""); setClientResolvedName("");
    try {
      const { data, error } = await supabase.functions.invoke("paystack", {
        body: { action: "resolve-account", account_number: f.account_number, bank_code: f.bank_code },
      });
      if (error || !data?.status) throw new Error(data?.message || "Could not verify account");
      const name = data.data?.account_name || "";
      setClientResolvedName(name);
      set("account_name", name);
    } catch (e) {
      setClientBankErr(e.message || "Account verification failed");
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
      setWdError("Couldn't refresh — tap to retry");
    }
  };

  const reloadPendingDeposits = async () => {
    try {
      const { data, error } = await supabase
        .from("ajo_contributions")
        .select("id, aso_client_id, owner_id, amount, type, status, created_at, payment_method, notes, proof_url, contribution_context, recorded_by, cycle_id, contribution_source, aso_clients(full_name, email, membership_number)")
        .eq("status", "pending")
        .eq("type", "contribution")
        .or("contribution_source.neq.staff_collection,contribution_source.is.null")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setPendingDeposits(data || []);
      setDepError(null);
    } catch {
      setDepError("Couldn't refresh — tap to retry");
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

  const loadGroups = async () => {
    if (!profile?.id) return;
    setGroupsLoading(true);
    try {
      const BASE_SELECT = "id, owner_id, name, description, is_active, group_mode, contribution_amount, contribution_frequency, percentage_charge, bank_code, account_number, account_name, bank_name, paystack_subaccount_code, privacy_show_names, privacy_show_amounts, created_at";
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
          bank_code:              grp.bank_code      || "",
          account_number:         grp.account_number || "",
          account_name:           grp.account_name   || "",
        },
        new: {
          contribution_amount:    editGf.contribution_amount != null ? Number(editGf.contribution_amount) : grp.contribution_amount,
          contribution_frequency: editGf.contribution_frequency || grp.contribution_frequency,
          group_mode:             editGf.group_mode             || grp.group_mode,
          percentage_charge:      editGf.percentage_charge != null ? Number(editGf.percentage_charge) : grp.percentage_charge,
          bank_code:              editGf.bank_code?.trim()      || grp.bank_code      || "",
          account_number:         editGf.account_number?.trim() || grp.account_number || "",
          account_name:           editGf.account_name?.trim()   || grp.account_name   || "",
        },
      };
      const { error } = await supabase.rpc("submit_approval_request", {
        p_type:      "group_edit",
        p_target_id: grp.id,
        p_payload:   payload,
        p_reason:    groupApprReason.trim(),
      });
      if (error) throw error;
      setGroupApprMsg({ id: grp.id, text: "Request submitted. You'll be notified by email when an admin decides.", ok: true });
      setEditingGroup(null);
      setGroupApprReason("");
      loadGroupApprovals();
    } catch (e) {
      setGroupApprMsg({ id: grp.id, text: e?.message || "Failed to submit request", ok: false });
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
      setGroupApprMsg({ id: grp.id, text: "Archive request submitted. You'll be notified by email when an admin decides.", ok: true });
      setDeletingGroup(null);
      setGroupApprReason("");
      loadGroupApprovals();
    } catch (e) {
      setGroupApprMsg({ id: grp.id, text: e?.message || "Failed to submit request", ok: false });
    } finally {
      setGroupApprSubmitting(false);
    }
  };

  const cancelGroupRequest = async (requestId, grpId) => {
    try {
      const { error } = await supabase.rpc("cancel_approval_request", { p_request_id: requestId });
      if (error) throw error;
      setGroupApprMsg({ id: grpId, text: "Request cancelled.", ok: true });
      loadGroupApprovals();
    } catch (e) {
      setGroupApprMsg({ id: grpId, text: e?.message || "Failed to cancel", ok: false });
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
      setDirectEditMsg({ id: grp.id, text: "Group details updated.", ok: true });
      setDirectEditGroup(null);
      loadGroups();
    } catch (e) {
      setDirectEditMsg({ id: grp.id, text: e?.message || "Failed to save", ok: false });
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
    if (!target || target <= 0) { setStartRoundMsg({ id: grpId, text: "Enter a valid target amount", ok: false }); return; }
    if (!deadline)              { setStartRoundMsg({ id: grpId, text: "Select a deadline date", ok: false }); return; }
    setStartRoundSaving(true);
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "start_savings_round", group_id: grpId, target_amount: target, target_deadline: deadline },
    });
    setStartRoundSaving(false);
    if (error || !data?.ok) {
      setStartRoundMsg({ id: grpId, text: data?.error || error?.message || "Failed to start round", ok: false });
      return;
    }
    setStartRoundGid(null);
    setStartRoundTarget(""); setStartRoundDeadline("");
    setStartRoundMsg({ id: null, text: "", ok: false });
    await loadGroups();
    loadSavingsDetails(grpId, data?.started_at);
  };

  const handleCloseSavingsRound = (grpId) => {
    setClosingRoundGid(null);
    setTxnPin({
      title: "Confirm Group Close",
      description: "Enter your PIN to close this savings round and release all member funds.",
      onConfirm: async () => {
        const { data, error } = await supabase.functions.invoke("ajo-write", {
          body: { action: "close_savings_round", group_id: grpId },
        });
        if (error || !data?.ok) throw new Error(data?.error || error?.message || "Failed to close round");
        await loadGroups();
        setSavingsDetails(p => ({ ...p, [grpId]: undefined }));
      },
    });
  };

  const handleReleaseSavingsMember = (grpId, clientId, clientName) => {
    setTxnPin({
      title: "Release Member",
      description: `Release ${clientName} from the savings group? Their contributions will unlock into their withdrawable balance.`,
      onConfirm: async () => {
        const { data, error } = await supabase.functions.invoke("ajo-write", {
          body: { action: "release_savings_member", group_id: grpId, client_id: clientId },
        });
        if (error || !data?.ok) throw new Error(data?.error || error?.message || "Failed to release member");
        const grp = groups.find(g => g.id === grpId);
        loadSavingsDetails(grpId, grp?.started_at);
      },
    });
  };

  const handleStartRound = async (turns) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "start_round", group_id: showRotation.id, turns },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || "Failed to start round");
    await loadRotation(showRotation.id);
  };

  const handleExecutePayout = async (turnId, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "execute_payout", turn_id: turnId, pin },
    });
    if (error) throw new Error(error.message || "Payout failed");
    return data; // caller checks data.ok — blocked payouts return ok:false with details
  };

  const handleSkipTurn = async (turnId, reason, moveToEnd, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "skip_turn", turn_id: turnId, reason, move_to_end: moveToEnd, pin },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || "Skip failed");
  };

  const handleReorderTurns = async (roundId, newOrder, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "reorder_turns", round_id: roundId, new_order: newOrder, pin },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || "Reorder failed");
  };

  const handleCloseRound = async (roundId) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "close_round", round_id: roundId },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || "Failed to close round");
    return data;
  };

  const resolveAccount = async () => {
    if (!gf.account_number || !gf.bank_code) { setGroupError("Select a bank and enter the account number first"); return; }
    setResolving(true); setGroupError(""); setResolvedName("");
    try {
      const { data, error } = await supabase.functions.invoke("paystack", {
        body: { action: "resolve-account", account_number: gf.account_number, bank_code: gf.bank_code },
      });
      if (error || !data?.status) throw new Error(data?.message || "Could not verify account");
      setResolvedName(data.data?.account_name || "");
      setG("account_name", data.data?.account_name || "");
    } catch (e) {
      setGroupError(e.message || "Account verification failed");
    } finally {
      setResolving(false);
    }
  };

  const saveGroup = async () => {
    if (!gf.name) { setGroupError("Group name is required"); return; }
    if (!profile?.id) return;
    const asoLimit = featureLimit(plan, "aso");
    if (asoLimit !== Infinity && groups.length >= asoLimit) {
      setGroupError(`Your plan allows up to ${asoLimit} Ajo group${asoLimit !== 1 ? "s" : ""}. Upgrade to create more.`);
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
          bank_code: gf.bank_code || null,
          account_number: gf.account_number || null,
          account_name: gf.account_name || null,
          group_mode: gf.group_mode || "savings",
          privacy_show_names:   gf.privacy_show_names  !== false,
          privacy_show_amounts: gf.privacy_show_amounts === true,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Failed to create group");
      const newGroup = data.group;
      // Auto-create Paystack subaccount if bank details provided
      if (gf.bank_code && gf.account_number && newGroup?.id) {
        const { data: sData, error: subErr } = await supabase.functions.invoke("paystack", {
          body: {
            action: "create-subaccount",
            group_id: newGroup.id,
            business_name: profile.business_name || gf.name,
            bank_code: gf.bank_code,
            account_number: gf.account_number,
            percentage_charge: 100,
          },
        }).catch(e => ({ data: null, error: e }));
        if (sData?.subaccount_code) {
          newGroup.paystack_subaccount_code = sData.subaccount_code;
        } else {
          let msg = sData?.error || "";
          if (!msg && subErr) {
            try { const b = await subErr.context?.json?.(); msg = b?.error || b?.message || ""; } catch {}
            if (!msg) msg = "Failed to link bank account";
          }
          console.error("Subaccount creation failed (group saved):", msg);
          setSubAcctMsg(`Group saved. Bank account link failed: ${msg} — use 'Create Subaccount' to retry.`);
        }
      }
      if (newGroup) setGroups(prev => [...prev, newGroup]);
      setShowGroupAdd(false);
      setGf(BLANK_GROUP);
      setResolvedName("");
      loadGroups();
    } catch (e) {
      setGroupError(e.message || "Failed to save group");
    } finally {
      setGroupSaving(false);
    }
  };

  const createSubaccount = async (grp) => {
    if (!grp.bank_code || !grp.account_number) {
      setSubAcctMsg("Add bank details to this group first by editing it.");
      return;
    }
    setSubAcctCreating(grp.id); setSubAcctMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("paystack", {
        body: {
          action: "create-subaccount",
          group_id: grp.id,
          business_name: profile?.business_name || grp.name,
          bank_code: grp.bank_code,
          account_number: grp.account_number,
          percentage_charge: 100,
        },
      });
      if (error || !data?.subaccount_code) throw new Error(data?.error || "Failed to create subaccount");
      setGroups(prev => prev.map(g => g.id === grp.id
        ? { ...g, paystack_subaccount_code: data.subaccount_code }
        : g));
      setSubAcctMsg(`Subaccount created: ${data.subaccount_code}`);
    } catch (e) {
      setSubAcctMsg(e.message || "Subaccount creation failed");
    } finally {
      setSubAcctCreating(null);
    }
  };

  useEffect(() => {
    if (!canDo(plan, "aso")) return;
    reloadWithdrawalRequests();
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
      if (filter === "active")   return c.status === "active" && !isOverdue(c);
      if (filter === "overdue")  return isOverdue(c);
      if (filter === "inactive") return c.status !== "active";
      if (filter === "groups")   return isGroupAccount(c);
      return true;
    })
    .filter(c => !dueBefore || (c.next_contribution_date && c.next_contribution_date <= dueBefore));

  const CHIPS = [
    { key: "all",      label: "All",      count: asoClients.length },
    { key: "active",   label: "Active",   count: asoClients.filter(c => c.status === "active" && !isOverdue(c)).length },
    { key: "overdue",  label: "Overdue",  count: overdueList.length },
    { key: "inactive", label: "Inactive", count: asoClients.filter(c => c.status !== "active").length },
    { key: "groups",   label: "Groups",   count: groupClients.length },
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
    if (!f.full_name) { setAddError("Full name is required"); return; }
    if (!f.email)     { setAddError("Email is required for portal access"); return; }
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
      } catch (err) {
        console.error("Photo upload:", err);
      }
    }
    if (!error && data) {
      // Auto-create Paystack subaccount if bank details were verified
      if (f.bank_code && f.account_number && f.account_name) {
        const { data: sData, error: subErr } = await supabase.functions.invoke("paystack", {
          body: {
            action: "create-subaccount",
            client_id: data.id,
            business_name: f.full_name,
            bank_code: f.bank_code,
            account_number: f.account_number,
            percentage_charge: 100,
            bank_name: f.bank_name || "",
          },
        }).catch(e => ({ data: null, error: e }));
        if (!sData?.subaccount_code) {
          let msg = sData?.error || "";
          if (!msg && subErr) {
            try { const b = await subErr.context?.json?.(); msg = b?.error || b?.message || ""; } catch {}
            if (!msg) msg = "Failed to link bank account";
          }
          console.error("Subaccount creation failed (client saved):", msg);
          setClientSubAcctErr(`Client saved. Bank account link failed: ${msg} — edit the client profile to retry.`);
        }
      }
      try {
        await provisionClientLogin(data);
        resetAdd();
        setAddedClientEmail(data.email);
      } catch (provErr) {
        await supabase.from("aso_clients").delete().eq("id", data.id);
        setAddError(provErr.message || "Failed to create client login account. Please try again.");
      }
    } else {
      setAddError(error?.message || "Failed to add client. Please try again.");
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
      return { error: err.message || "Failed to reset password" };
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

  const handleApproveRequest = async (req, pin) => {
    setProcessingId(req.id);
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
        // DB committed; reloadWithdrawalRequests() in finally confirms state.
        setApproveError({ id: null, text: "" });
        return;
      }
      if (writeErr || !writeData?.ok) {
        const errMsg = writeData?.error || writeErr?.message || "Approval failed";
        setApproveError({ id: req.id, text: errMsg });
        return;
      }
      setApproveError({ id: null, text: "" });
    } catch (e) {
      if (!isFetchTimeout(e)) setApproveError({ id: req.id, text: e?.message || "Approval failed" });
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
        console.error("Reject failed:", rwErr?.message || rwData?.error);
      }
    } catch (e) {
      if (!isFetchTimeout(e)) console.error("Reject failed:", e);
    } finally {
      reloadWithdrawalRequests();
      setProcessingId(null);
    }
  };

  const flashDeposit = (type, msg) => {
    setDepositFeedback({ type, msg });
    setTimeout(() => setDepositFeedback(null), type === "err" ? 6000 : 4000);
  };

  const handleConfirmDeposit = async (claim, pin) => {
    setProcessingDepositId(claim.id);
    try {
      const { data, error } = await supabase.functions.invoke("ajo-write", {
        body: { action: "confirm_manual_deposit", claim_id: claim.id, pin },
      });
      if (isFetchTimeout(error)) {
        flashDeposit("ok", "Confirmed — reloading to verify…");
        return;
      }
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Confirm failed");
      flashDeposit("ok", `₦${Number(data.amount || claim.amount).toLocaleString("en-NG")} confirmed — client balance updated.`);
    } catch (e) {
      if (isFetchTimeout(e)) flashDeposit("ok", "Confirmed — reloading to verify…");
      else flashDeposit("err", e.message || "Confirm failed");
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
        flashDeposit("ok", "Rejected — reloading to verify…");
        return;
      }
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Reject failed");
      setRejectingDeposit(null);
      setRejectReason("");
      flashDeposit("ok", "Deposit claim rejected — client has been notified.");
    } catch (e) {
      if (isFetchTimeout(e)) { setRejectingDeposit(null); setRejectReason(""); flashDeposit("ok", "Rejected — reloading to verify…"); }
      else flashDeposit("err", e.message || "Reject failed");
    } finally {
      reloadPendingDeposits();
      setProcessingDepositId(null);
    }
  };

  const handleApproveContribution = async (dep, pin) => {
    setProcessingDepositId(dep.id);
    try {
      const { data, error } = await supabase.functions.invoke("ajo-write", {
        body: { action: "approve_contribution", contribution_id: dep.id, owner_id: profile?.id, pin },
      });
      if (isFetchTimeout(error)) {
        flashDeposit("ok", "Approved — reloading to verify…");
        return;
      }
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Approve failed");
      flashDeposit("ok", `₦${Number(data.amount || dep.amount).toLocaleString("en-NG")} approved — client balance updated.`);
    } catch (e) {
      if (isFetchTimeout(e)) flashDeposit("ok", "Approved — reloading to verify…");
      else flashDeposit("err", e.message || "Approve failed");
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
          Aso savings management is {planAvailableText("aso")}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">Manage client contributions, withdrawals & statements.</p>
        <button onClick={onUpgrade}
          className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition-all shadow-md">
          {upgradeLabel("aso")}
        </button>
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
            title="Today's Collection"
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
              title="Manage Ajo Groups & Paystack Subaccounts"
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
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-0.5">Total Balance</p>
          <AmountDisplay amount={totalBal} size="hero" align="left" className="text-white mb-4" />
          <div className="grid grid-cols-3 divide-x divide-white/20">
            <div className="pr-3 min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Total Saved</p>
              <AmountDisplay amount={totalSaved} size="small" align="left" className="text-green-200" />
            </div>
            <div className="px-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Clients</p>
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
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Groups</p>
              <p className="text-sm font-extrabold tabular">{groupClients.length} <span className="text-white/40 font-normal text-[10px]">/ {indivClients.length} ind.</span></p>
            </div>
          </div>
        </div>
      </div>

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
          const feeLabel = req.fee_type === "registration_fee" ? "Reg fee" : effectivePct ? `${effectivePct}% fee` : "fee";
          const [acctVerifying, setAcctVerifying] = useState(false);
          const [acctResult,    setAcctResult]    = useState(null); // null | { ok, name?, err? }
          const verifyAcct = async () => {
            if (!cl.withdrawal_account_number || !cl.withdrawal_bank_code) return;
            setAcctVerifying(true); setAcctResult(null);
            try {
              const { data, error } = await supabase.functions.invoke("paystack", {
                body: { action: "resolve-account", account_number: cl.withdrawal_account_number, bank_code: cl.withdrawal_bank_code },
              });
              if (error || !data?.status) throw new Error(data?.message || "Could not verify account");
              setAcctResult({ ok: true, name: data.data?.account_name || "" });
            } catch (e) {
              setAcctResult({ ok: false, err: e.message || "Verification failed" });
            } finally {
              setAcctVerifying(false);
            }
          };
          return (
            <div key={req.id} className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border shadow-sm ${isHeld ? "border-orange-300 dark:border-orange-700/60" : "border-amber-200 dark:border-amber-800/60"}`}>
              {isHeld && (
                <div className="flex items-center gap-1.5 mb-2.5 px-2 py-1.5 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                  <p className="text-[10px] font-bold text-orange-700 dark:text-orange-400">Security hold — PIN recently changed</p>
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
                      Requests {fmt(req.amount)}
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
                      From: {req.ajo_cycles?.label
                        ? req.ajo_cycles.label
                        : `${req.ajo_groups?.group_mode === "rotating" ? "Esusu" : "Savings Group"} — ${req.ajo_groups?.name}`}
                    </p>
                  )}
                  {req.fee_type !== "registration_fee" && req.fee_amount > 0 && cl.commission_model === "percent" &&
                   cl.commission_percent !== undefined && effectivePct !== null &&
                   Math.abs(parseFloat(effectivePct) - (cl.commission_percent || 0)) > 0.05 && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-lg">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                      <span>Fee at request: {effectivePct}%</span>
                      <span>·</span>
                      <span className="font-bold">Current fee: {cl.commission_percent}%</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Pay to</p>
                  {cl.withdrawal_account_number && cl.withdrawal_bank_code && (
                    <button
                      onClick={verifyAcct}
                      disabled={acctVerifying}
                      className="text-[9px] font-bold text-blue-600 dark:text-blue-400 disabled:opacity-50 transition">
                      {acctVerifying ? "Verifying…" : acctResult ? "Re-verify" : "Verify"}
                    </button>
                  )}
                </div>
                {(cl.withdrawal_account_number || cl.withdrawal_account_name) ? (
                  <>
                    {cl.withdrawal_bank_name && <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{cl.withdrawal_bank_name}</p>}
                    {cl.withdrawal_account_number && <p className="text-[11px] font-mono text-slate-700 dark:text-slate-200 tracking-widest">{cl.withdrawal_account_number}</p>}
                    {cl.withdrawal_account_name && <p className="text-[10px] text-slate-500 dark:text-slate-400">{cl.withdrawal_account_name}</p>}
                    {acctResult?.ok && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 text-green-600 dark:text-green-400 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        <p className="text-[10px] font-bold text-green-700 dark:text-green-400">{acctResult.name}</p>
                      </div>
                    )}
                    {acctResult?.ok === false && (
                      <p className="text-[10px] font-bold text-red-600 dark:text-red-400 mt-1.5">{acctResult.err}</p>
                    )}
                  </>
                ) : (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">No payout account on file — set one in client profile.</p>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setTxnPin({
                    title: isHeld ? "Release & Approve Withdrawal" : "Approve Withdrawal",
                    amount: Math.round((req.net_amount || 0) * 100),
                    recipient: cl.full_name,
                    description: isHeld ? "Security hold release — savings withdrawal" : "Savings withdrawal approval",
                    onApprove: (pin) => { setTxnPin(null); handleApproveRequest(req, pin); },
                  })}
                  disabled={isProc}
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] disabled:opacity-50">
                  {isProc ? "…" : isHeld ? "Release & Approve" : "Approve"}
                </button>
                <button
                  onClick={() => isHeld
                    ? (setRejectingHeld(req), setHeldRejectReason(""))
                    : handleRejectRequest(req)}
                  disabled={isProc}
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 rounded-xl font-bold text-xs transition active:scale-[0.99] disabled:opacity-50 border border-slate-200 dark:border-slate-600">
                  {isProc ? "…" : "Reject"}
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
          <div className="mb-4 space-y-4">
            {heldReqs.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  Security Holds
                  <span className="ml-1 bg-orange-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">{heldReqs.length}</span>
                </p>
                <div className="space-y-2">{heldReqs.map(r => <WithdrawCard key={r.id} req={r} isHeld />)}</div>
              </div>
            )}
            {pendingReqs.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                  Withdrawal Requests
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
            Reactivation Requests
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
                      <p className="text-sm font-bold text-slate-800 dark:text-white">{req.client_name || "Client"}</p>
                      <p className={`text-[10px] font-semibold ${isOwnerApproved ? "text-blue-600 dark:text-blue-400" : "text-amber-700 dark:text-amber-400"}`}>
                        {isOwnerApproved ? "Forwarded to Admin" : "Account Reactivation Request"}
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
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium mb-2">Awaiting admin review. If it hasn&apos;t appeared in the admin portal, tap Resend.</p>
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
                            setReactivationMsg({ id: req.id, text: data.note || "Sent to admin.", ok: true });
                          } else {
                            setReactivationMsg({ id: req.id, text: data?.error || "Failed to resend", ok: false });
                          }
                        }}
                      >
                        {isBusy ? "…" : "Resend to Admin"}
                      </button>
                    </div>
                  ) : rejectingReactivation === req.id ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        value={rejectReactivationNote}
                        onChange={e => setRejectReactivationNote(e.target.value)}
                        placeholder="Reason for rejection (required)"
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
                              setReactivationMsg({ id: req.id, text: "Request rejected.", ok: true });
                              setRejectingReactivation(null);
                              setRejectReactivationNote("");
                              setReactivationRequests(p => p.filter(r => r.id !== req.id));
                            } else {
                              setReactivationMsg({ id: req.id, text: data?.error || "Failed", ok: false });
                            }
                          }}
                          className="flex-1 py-1.5 text-xs font-bold rounded-lg bg-red-500 text-white disabled:opacity-50"
                        >
                          {isBusy ? "…" : "Confirm Reject"}
                        </button>
                        <button
                          onClick={() => { setRejectingReactivation(null); setRejectReactivationNote(""); }}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        disabled={isBusy}
                        className="flex-1 py-1.5 text-xs font-bold rounded-lg bg-green-600 text-white disabled:opacity-50"
                        onClick={() => setTxnPin({
                          title: "Approve Reactivation",
                          description: `Approve reactivation for ${req.client_name || "client"}`,
                          onApprove: async (pin) => {
                            setTxnPin(null);
                            setReactivationBusy(req.id);
                            const { data } = await supabase.functions.invoke("ajo-write", {
                              body: { action: "approve_reactivation", reactivation_request_id: req.id, pin },
                            });
                            setReactivationBusy(null);
                            if (data?.ok) {
                              setReactivationMsg({ id: req.id, text: "Approved — admin will finalise the reactivation.", ok: true });
                              setReactivationRequests(p => p.map(r => r.id === req.id ? { ...r, status: "owner_approved" } : r));
                            } else {
                              setReactivationMsg({ id: req.id, text: data?.error || "Failed to approve", ok: false });
                            }
                          },
                        })}
                      >
                        {isBusy ? "…" : "Approve & Send to Admin"}
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => { setRejectingReactivation(req.id); setRejectReactivationNote(""); }}
                        className="flex-1 py-1.5 text-xs font-bold rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 disabled:opacity-50"
                      >
                        Reject
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
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              Staff Collections
              <span className="bg-orange-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">{pendingStaffContribs.length}</span>
            </p>
            <button
              onClick={() => setTxnPin({
                title: `Approve All ${pendingStaffContribs.length} Collections`,
                amount: pendingStaffContribs.reduce((s, c) => s + (c.amount || 0), 0) * 100,
                recipient: "Staff Collections",
                description: "Batch approve all pending staff-recorded contributions",
                onApprove: async (pin) => {
                  setTxnPin(null);
                  const { data, error } = await supabase.functions.invoke("ajo-write", {
                    body: { action: "batch_approve_contributions", pin, contribution_ids: pendingStaffContribs.map(c => c.id) },
                  });
                  if (error || !data?.ok) {
                    setStaffContribFeedback({ ok: false, msg: `Partial: ${data?.failed || 0} failed` });
                  } else {
                    setStaffContribFeedback({ ok: true, msg: `All ${data.approved} approved` });
                  }
                  reloadPendingStaffContribs();
                  setTimeout(() => setStaffContribFeedback(null), 3000);
                },
              })}
              className="text-[10px] font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2.5 py-1 rounded-lg active:scale-95 transition">
              Approve All
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
                          <span className="text-[10px] text-slate-400 capitalize">{item.contribution_context.replace(/_/g, " ")}</span>
                        )}
                        {isStale && <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400">Stale &gt;48h</span>}
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
                        placeholder="Rejection reason…"
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
                          {isProc ? "…" : "Confirm Reject"}
                        </button>
                        <button onClick={() => { setRejectingStaffContrib(null); setStaffContribRejectReason(""); }}
                          className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs active:scale-[0.99] transition">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3">
                      <button
                        disabled={isProc}
                        onClick={() => setTxnPin({
                          title: "Approve Collection",
                          amount: Math.round((item.amount || 0) * 100),
                          recipient: cl.full_name || "Client",
                          description: "Staff-recorded savings contribution",
                          onApprove: async (pin) => {
                            setTxnPin(null);
                            setProcessingStaffContribId(item.id);
                            const { data } = await supabase.functions.invoke("ajo-write", { body: { action: "approve_contribution", contribution_id: item.id, owner_id: profile?.id, pin } });
                            setProcessingStaffContribId(null);
                            reloadPendingStaffContribs();
                            if (!data?.ok) setStaffContribFeedback({ ok: false, msg: data?.error || "Approve failed" });
                          },
                        })}
                        className="flex-1 py-2.5 bg-green-600 text-white rounded-xl font-bold text-xs disabled:opacity-50 active:scale-[0.99] transition">
                        {isProc ? "…" : "Approve"}
                      </button>
                      <button
                        disabled={isProc}
                        onClick={() => { setRejectingStaffContrib(item.id); setStaffContribRejectReason(""); }}
                        className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs active:scale-[0.99] transition">
                        Reject
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
        <div className="mb-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
            Pending Deposits
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
              const methodLabel    = isManualClaim ? "Bank Transfer" : (dep.payment_method || "cash").replace(/_/g, " ");
              const ctxLabel       = dep.contribution_context === "esusu_rotation" ? "Esusu"
                                   : dep.contribution_context === "group_savings"  ? "Group Savings"
                                   : "Personal Savings";
              return (
                <div key={dep.id} className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 border shadow-sm ${isStale ? "border-red-200 dark:border-red-800/60" : "border-brand-200 dark:border-brand-800/60"}`}>
                  {isStale && (
                    <p className="text-[10px] font-bold text-red-500 dark:text-red-400 mb-2">Awaiting confirmation for {daysOld}+ days</p>
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
                        {isManualClaim ? "Claims" : "Recorded"} ₦{Number(dep.amount).toLocaleString("en-NG")}
                        <span className="ml-1.5 font-normal text-slate-400 text-[10px]">{methodLabel} · {ctxLabel}</span>
                      </p>
                      {dep.payer_name  && <p className="text-[10px] text-slate-400 mt-0.5">Paid by: {dep.payer_name}</p>}
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
                              title: "Payment Proof",
                            }).catch(() => window.open(proofHref, "_blank"));
                          } else {
                            window.open(proofHref, "_blank");
                          }
                        };
                        return (
                          <button onClick={openProof} className="mt-2 block w-full active:opacity-75 transition rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600">
                            <img
                              src={proofHref}
                              alt="Payment proof"
                              className="w-full max-h-36 object-cover"
                              onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextElementSibling.style.display = "flex"; }}
                            />
                            <span style={{display:"none"}} className="items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-brand-600 dark:text-brand-400">
                              <svg viewBox="0 0 24 24" fill="none" className="w-3 h-3 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
                              </svg>
                              View Proof
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
                          title:       isManualClaim ? "Confirm Deposit" : "Approve Contribution",
                          amount:      Math.round((dep.amount || 0) * 100),
                          recipient:   cl.full_name || "client",
                          description: `${isManualClaim ? "Bank transfer claim" : "Recorded contribution"} · ₦${Number(dep.amount).toLocaleString("en-NG")}`,
                          onApprove:   (pin) => {
                            setTxnPin(null);
                            if (isManualClaim) handleConfirmDeposit(dep, pin);
                            else handleApproveContribution(dep, pin);
                          },
                        })}
                        disabled={isProc}
                        className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] disabled:opacity-50">
                        {isProc && processingDepositId === dep.id && !rejectingDeposit ? "…" : isManualClaim ? "Confirm" : "Approve"}
                      </button>
                      <button
                        onClick={() => { setRejectingDeposit(dep); setRejectReason(""); }}
                        disabled={isProc}
                        className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 rounded-xl font-bold text-xs transition active:scale-[0.99] disabled:opacity-50 border border-slate-200 dark:border-slate-600">
                        Reject
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-3 text-center">Contact your manager to confirm or reject deposits</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
              {overdueList.length} overdue {overdueList.length === 1 ? "account" : "accounts"}
            </p>
            <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">Contributions past due date</p>
          </div>
          <button onClick={() => setFilter("overdue")}
            className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-3 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition-transform">
            View All
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
          placeholder="Search by name or phone…"
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
          {dueBefore || "Date"}
        </button>
      </div>

      {/* Date filter panel */}
      {showDateFilter && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 mb-2 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Next payment due on or before</p>
            <input type="date" value={dueBefore} onChange={e => setDueBefore(e.target.value)}
              className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none" />
          </div>
          {dueBefore && (
            <button onClick={() => setDueBefore("")}
              className="text-xs font-bold text-red-400 hover:text-red-600 transition">
              Clear
            </button>
          )}
        </div>
      )}

      {/* Result count */}
      {(search || filter !== "all" || dueBefore) && asoClients.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3 font-medium">
          {filtered.length} {filtered.length === 1 ? "result" : "results"}
          {search && ` for "${search}"`}
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
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No savings clients yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Tap + to enroll your first client</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No matches found</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Try a different search or filter</p>
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
            const nextDaysDiff   = daysDiff(c.next_contribution_date);
            const nextIsToday    = c.next_contribution_date === today();
            const nextIsSoon     = nextDaysDiff > -3 && nextDaysDiff <= 0;

            return (
              <div key={c.id}
                className={`bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border ${
                  overdue ? "border-red-200 dark:border-red-800/50" : "border-slate-100 dark:border-slate-700/60"
                }`}>

                {/* Pending archive banner */}
                {c.pending_archive && (
                  <div className="flex items-center justify-between mb-3 px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-700/40">
                    <div className="flex items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                      </svg>
                      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">Archive pending admin approval</p>
                    </div>
                    <button
                      disabled={cancellingArchiveId === c.id}
                      onClick={async () => {
                        setCancellingArchiveId(c.id);
                        await cancelAsoClientArchive(c.id);
                        setCancellingArchiveId(null);
                      }}
                      className="text-[10px] font-bold text-amber-700 dark:text-amber-400 underline underline-offset-2 flex-shrink-0 ml-2 disabled:opacity-40">
                      {cancellingArchiveId === c.id ? "…" : "Cancel"}
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
                        <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Group</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {c.phone && <span className="text-xs text-slate-400 dark:text-slate-500">{c.phone}</span>}
                      {c.phone && <span className="text-slate-300 dark:text-slate-600 text-xs">·</span>}
                      <span className="text-xs text-slate-400 dark:text-slate-500 capitalize">{c.contribution_frequency} · {fmt(c.contribution_amount)}</span>
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
                        {missed} missed
                      </span>
                    )}
                    {nextDaysDiff >= 7 && (
                      <span className="text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded-full">
                        {nextDaysDiff}d overdue
                      </span>
                    )}
                    {nextDaysDiff >= 3 && nextDaysDiff < 7 && (
                      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">
                        {nextDaysDiff}d overdue
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-2 mb-3">
                  {[
                    { label: "Balance",   value: c.current_balance, color: "text-brand-700 dark:text-brand-400", bg: "bg-brand-50 dark:bg-brand-900/20" },
                    { label: "Deposited", value: c.total_saved,     color: "text-green-700 dark:text-green-400",  bg: "bg-green-50 dark:bg-green-900/20"   },
                    { label: "Withdrawn", value: c.total_withdrawn,  color: "text-red-600 dark:text-red-400",      bg: "bg-red-50 dark:bg-red-900/20"       },
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
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Contribution Tracking</p>
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
                      <p className="text-[10px] font-bold text-red-500 dark:text-red-400 mt-1">{missed} payment{missed !== 1 ? "s" : ""} overdue</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Next Due</p>
                    <p className={`text-xs font-extrabold mt-0.5 ${
                      overdue ? "text-red-500 dark:text-red-400"
                        : nextIsToday || nextIsSoon ? "text-amber-500 dark:text-amber-400"
                        : "text-slate-700 dark:text-slate-200"
                    }`}>
                      {c.next_contribution_date || "—"}
                    </p>
                    {nextIsToday && <p className="text-[9px] text-amber-500 font-bold">Today!</p>}
                    {overdue && <p className="text-[9px] text-red-500 font-bold">{nextDaysDiff}d late</p>}
                  </div>
                </div>

                {c.notes && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-3">"{c.notes}"</p>}

                {/* Actions — icon grid */}
                <div className="flex gap-1.5 pt-3 border-t border-slate-100 dark:border-slate-700/60">

                  {/* Contribute */}
                  {canContribute && !c.pending_archive && (
                    <button onClick={() => { setSelected(c); setAction("contribute"); }}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 active:scale-95 transition"
                      title="Contribute">
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                      </svg>
                      <span className="text-[9px] font-black text-green-700 dark:text-green-400 uppercase tracking-wide leading-none">Fund</span>
                    </button>
                  )}

                  {/* Withdraw */}
                  {canWithdraw && !c.pending_archive && (
                    <button onClick={() => { setSelected(c); setAction("withdraw"); }}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 active:scale-95 transition"
                      title="Withdraw">
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-red-600 dark:text-red-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/>
                      </svg>
                      <span className="text-[9px] font-black text-red-600 dark:text-red-400 uppercase tracking-wide leading-none">Pay</span>
                    </button>
                  )}

                  {/* Reminder */}
                  <button onClick={() => { setReminderFor(c); setCopied(false); }}
                    className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border active:scale-95 transition ${
                      overdue || missed > 0
                        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                        : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                    }`}
                    title="Send Reminder">
                    <svg viewBox="0 0 24 24" fill="none" className={`w-5 h-5 ${overdue || missed > 0 ? "text-red-500 dark:text-red-400" : "text-amber-500 dark:text-amber-400"}`} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
                    </svg>
                    <span className={`text-[9px] font-black uppercase tracking-wide leading-none ${overdue || missed > 0 ? "text-red-500 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>Alert</span>
                  </button>

                  {/* Statement */}
                  <button onClick={() => setReceipt(c)}
                    className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-brand-50 dark:bg-brand-900/20 rounded-xl border border-brand-200 dark:border-brand-800 active:scale-95 transition"
                    title="View Statement">
                    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-600 dark:text-brand-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <span className="text-[9px] font-black text-brand-600 dark:text-brand-400 uppercase tracking-wide leading-none">Stmt</span>
                  </button>

                  {/* History + Card */}
                  <button onClick={async () => {
                    setHistLoading(true);
                    const [contribRes, cycleRes] = await Promise.all([
                      supabase
                        .from("ajo_contributions")
                        .select("id, aso_client_id, owner_id, amount, type, status, created_at, payment_method, contribution_context, cycle_id, reverses_contribution_id, fee_for_contribution_id, notes, recorded_by, paystack_ref, paystack_status, paid_at, approved_at, approved_by, confirmed_at, confirmed_by, initiated_by, payment_channel, proof_url, contribution_source")
                        .eq("aso_client_id", c.id)
                        .order("created_at", { ascending: false }),
                      supabase
                        .from("ajo_cycles")
                        .select("id, client_id, label, status, commission_model, commission_balance, expected_amount_per_period, frequency, length_periods, start_date, created_at, commission_percent")
                        .eq("client_id", c.id)
                        .eq("status", "active")
                        .order("created_at", { ascending: true }),
                    ]);
                    setHistoryFor({ client: c, contributions: contribRes.data || [], cycles: cycleRes.data || [] });
                    setHistLoading(false);
                  }}
                    className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 active:scale-95 transition"
                    title="View History">
                    {histLoading ? (
                      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-blue-600 dark:text-blue-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 0 .5-4.5"/>
                        <polyline points="3 3 3 7 7 7"/>
                      </svg>
                    )}
                    <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-wide leading-none">Hist</span>
                  </button>

                  {/* Edit */}
                  <button onClick={() => setClientProf(c)}
                    className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-slate-50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600 active:scale-95 transition"
                    title="Edit Profile">
                    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-slate-600 dark:text-slate-300" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide leading-none">Edit</span>
                  </button>

                  {/* Assign — owner only */}
                  {!staffAjoPerms && (
                    <button onClick={() => setAssigningClient(c)}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 bg-violet-50 dark:bg-violet-900/20 rounded-xl border border-violet-200 dark:border-violet-800 active:scale-95 transition"
                      title="Assign to branch/staff">
                      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-violet-600 dark:text-violet-400" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                      </svg>
                      <span className="text-[9px] font-black text-violet-600 dark:text-violet-400 uppercase tracking-wide leading-none">Assign</span>
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
              <h2 className="text-base font-bold text-slate-800 dark:text-white">New Ajo Client</h2>
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
                  ? <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
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
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">Tap camera to add photo</p>
          </div>

          <SectionLabel>Savings Settings</SectionLabel>
          <Field label="Full Name / Group Name *" value={f.full_name}
            onChange={e => set("full_name", e.target.value)} placeholder="e.g. Mama Ngozi Cooperative" />
          <Field label="Contribution Frequency" as="select" value={f.contribution_frequency}
            onChange={e => set("contribution_frequency", e.target.value)}>
            {["daily", "weekly", "monthly"].map(o => (
              <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
            ))}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Contribution (₦)" type="number" value={f.contribution_amount}
              onChange={e => set("contribution_amount", e.target.value)} placeholder="0.00" />
            <Field label="Reg. Fee (₦)" type="number" value={f.registration_charge}
              onChange={e => set("registration_charge", e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Withdrawal Fee / Commission</p>
            <select value={f.commission_model}
              onChange={e => set("commission_model", e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-800 dark:text-white">
              <option value="none">No fee</option>
              {!f.ajo_group_id && <option value="first_period">First period — owner keeps first cycle contribution</option>}
              <option value="percent">Percentage of each withdrawal</option>
            </select>
            {f.commission_model === "percent" && (
              <div className="mt-2">
                <Field label="Fee %" type="number" value={f.commission_percent}
                  onChange={e => set("commission_percent", e.target.value)} placeholder="e.g. 5" />
              </div>
            )}
          </div>

          <SectionLabel>Contact & Identity</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone" type="tel" value={f.phone}
              onChange={e => set("phone", e.target.value)} placeholder="08012345678" />
            <Field label="Email *" type="email" value={f.email}
              onChange={e => set("email", e.target.value)} placeholder="client@email.com" />
          </div>

          {!staffId && (
            <>
              <SectionLabel>Deposit Subaccount (Owner Only)</SectionLabel>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-1 mb-1">
                A dedicated account the owner sets for this client — all manual and Paystack contributions route here. Only the owner can set or change this.
              </p>
              <Field label="Bank" as="select" value={f.bank_code}
                onChange={e => {
                  const b = banks.find(bk => bk.code === e.target.value);
                  set("bank_code", e.target.value);
                  set("bank_name", b?.name || "");
                  set("account_name", "");
                  setClientResolvedName(""); setClientBankErr("");
                }}>
                <option value="">Select bank…</option>
                {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </Field>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Field label="Account Number" inputMode="numeric" value={f.account_number}
                    onChange={e => { set("account_number", e.target.value.replace(/\D/g, "").slice(0, 10)); set("account_name", ""); setClientResolvedName(""); setClientBankErr(""); }}
                    placeholder="10-digit NUBAN" />
                </div>
                <button type="button" onClick={resolveClientAccount}
                  disabled={clientBankResolving || f.account_number.length < 10 || !f.bank_code}
                  className="mb-0.5 px-3 py-2.5 rounded-xl bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-xs font-bold disabled:opacity-40 transition whitespace-nowrap active:scale-95">
                  {clientBankResolving ? "Checking…" : "Verify"}
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

          <Field label="NIN" inputMode="numeric" value={f.nin}
            onChange={e => set("nin", e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder="11-digit National ID Number" />

          <SectionLabel>Address</SectionLabel>
          <Field label="Street Address" value={f.address}
            onChange={e => set("address", e.target.value)} placeholder="12 Market Road, Onitsha" />
          <Field label="State" as="select" value={f.state}
            onChange={e => { set("state", e.target.value); set("lga", ""); set("ward", ""); }}>
            <option value="">Select State…</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="LGA" as="select" value={f.lga} disabled={!f.state}
              onChange={e => { set("lga", e.target.value); set("ward", ""); }}>
              <option value="">{f.state ? "Select LGA…" : "State first"}</option>
              {lgas.map(l => <option key={l} value={l}>{l}</option>)}
            </Field>
            <Field label="Ward" as="select" value={f.ward} disabled={!f.lga}
              onChange={e => set("ward", e.target.value)}>
              <option value="">{f.lga ? "Select Ward…" : "LGA first"}</option>
              {wards.map(w => <option key={w} value={w}>{w}</option>)}
            </Field>
          </div>

          <SectionLabel>Next of Kin</SectionLabel>
          <Field label="Full Name" value={f.next_of_kin}
            onChange={e => set("next_of_kin", e.target.value)} placeholder="Next of kin name" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone" type="tel" value={f.next_of_kin_phone}
              onChange={e => set("next_of_kin_phone", e.target.value)} placeholder="08012345678" />
            <Field label="Email" type="email" value={f.next_of_kin_email}
              onChange={e => set("next_of_kin_email", e.target.value)} placeholder="email@example.com" />
          </div>
          <Field label="Address" value={f.next_of_kin_address}
            onChange={e => set("next_of_kin_address", e.target.value)} placeholder="Next of kin address" />

          {staffOptions.length > 0 && (
            <>
              <SectionLabel>Staff Assignment</SectionLabel>
              <Field label="Assign Staff" as="select" value={f.staff_id}
                onChange={e => set("staff_id", e.target.value)}>
                <option value="">No staff assigned</option>
                {staffOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Field>
            </>
          )}

          {groups.length > 0 && (
            <>
              <SectionLabel>Group Membership</SectionLabel>
              <Field label="Ajo Group" as="select" value={f.ajo_group_id || ""}
                onChange={e => set("ajo_group_id", e.target.value || null)}>
                <option value="">No group</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name}{g.group_mode === "rotating" ? " (Rotating)" : ""}
                  </option>
                ))}
              </Field>
            </>
          )}

          <SectionLabel>Notes</SectionLabel>
          <Field as="textarea" value={f.notes}
            onChange={e => set("notes", e.target.value)} placeholder="Optional notes about this client…" />

          {addError && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-xl px-3 py-2">{addError}</p>
          )}

              <div className="pb-6">
                <button onClick={handleAdd}
                  disabled={!f.full_name || adding}
                  className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-2xl font-bold text-sm transition active:scale-[0.99]">
                  {adding ? "Creating account…" : "Add Ajo Client"}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Contribute / Withdraw modal */}
      {selected && action && (
        <Modal
          title={`${action === "contribute" ? "Record Contribution" : "Process Withdrawal"} — ${selected.full_name}`}
          onClose={() => { setSelected(null); setAction(null); setAmt(""); setContributeCtx("personal_savings"); }}>

          <div className="bg-brand-50 dark:bg-brand-900/20 rounded-xl px-4 py-3 mb-3 border border-brand-100 dark:border-brand-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Current balance</p>
            <AmountDisplay amount={selected.current_balance} size="stat" align="left" className="text-brand-700 dark:text-brand-400" />
          </div>

          {/* Contribution stats in modal */}
          {action === "contribute" && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: "Made",     value: getContribsMade(selected),    color: "text-green-600 dark:text-green-400" },
                { label: "Expected", value: getExpectedContribs(selected), color: "text-slate-700 dark:text-slate-200" },
                { label: "Missed",   value: getMissedPayments(selected),   color: getMissedPayments(selected) > 0 ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-2.5 text-center">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                  <p className={`text-base font-extrabold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {action === "contribute" &&
           (selected.total_saved || 0) === 0 &&
           !pendingDeposits.some(d => d.aso_client_id === selected.id) &&
           (() => {
            const regCharge = Number(selected.registration_charge || 0);
            const expected  = Number(selected.contribution_amount || 0);
            const minReq    = expected + regCharge;
            if (minReq <= 0 || (regCharge === 0 && selected.commission_model !== "first_period")) return null;
            return (
              <p className="text-xs text-blue-600 dark:text-blue-400 mb-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/60 rounded-xl px-3 py-2">
                First deposit: {fmt(minReq)} = {fmt(expected)} contribution + {fmt(regCharge)} registration
              </p>
            );
          })()}

          {action === "contribute" && selectedClientMems.length > 0 && (() => {
            const opts = [
              { key: "personal_savings", label: "Personal Savings", desc: "Add to client's personal savings", gid: null },
              ...selectedClientMems.map(m => {
                const sg = m.ajo_groups;
                return sg?.group_mode === "rotating"
                  ? { key: "esusu_rotation", label: sg.name, desc: "Esusu Rotation — add to the pot", gid: sg.id }
                  : { key: "group_savings",  label: sg?.name || "Savings Group", desc: "Savings Group — add to group pool", gid: sg?.id };
              }),
            ];
            return (
              <div className="mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Contributing to</p>
                <div className="space-y-1.5">
                  {opts.map(opt => (
                    <button key={`${opt.key}:${opt.gid || "personal"}`} type="button"
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

          {action === "contribute" && contributeCtx === "personal_savings" && selectedCycles.length > 1 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Which savings cycle?</p>
              <div className="space-y-1.5">
                {selectedCycles.map(cyc => (
                  <button key={cyc.id} type="button"
                    onClick={() => setContributeCycleId(cyc.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border-2 text-left text-sm transition ${
                      contributeCycleId === cyc.id
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
                        : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                    }`}>
                    <span>{cyc.label || "Savings"}</span>
                    {contributeCycleId === cyc.id && <div className="w-3.5 h-3.5 rounded-full bg-brand-500 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {action === "withdraw" && (() => {
            const wFeePercent = selected.commission_model === "percent" ? (selected.commission_percent || 0) : 0;
            return (
              <div className="mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-2 space-y-0.5">
                <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  {wFeePercent > 0 ? `Withdrawal fee: ${wFeePercent}% will be deducted from balance` : "No withdrawal fee"}
                </p>
                {wFeePercent > 0 && amt && parseFloat(amt) > 0 && (
                  <p className="text-xs text-amber-500 dark:text-amber-400">
                    Fee: {fmt(parseFloat(amt) * (wFeePercent / 100))} · Client receives: {fmt(parseFloat(amt) * (1 - wFeePercent / 100))}
                  </p>
                )}
              </div>
            );
          })()}

          <Field label={`Amount (₦) — suggested: ${fmt(selected.contribution_amount)}`}
            type="number" inputMode="decimal" value={amt}
            onChange={e => setAmt(e.target.value)} placeholder="Enter amount" />

          {action === "contribute" && selected.contribution_amount > 0 && (
            <button onClick={() => setAmt(String(selected.contribution_amount))}
              className="text-xs text-brand-600 dark:text-brand-400 font-bold mb-3 -mt-1 block hover:underline">
              Use contribution amount ({fmt(selected.contribution_amount)})
            </button>
          )}

          <button
            onClick={async () => {
              if (!amt) return;
              const a = parseFloat(amt);
              if (action === "contribute") {
                if (contributeCtx === "personal_savings" && selectedCycles.length > 1 && !contributeCycleId) return;
                const savedClient = selected;
                const savedCtx = contributeCtx;
                const savedCycleId = contributeCycleId;
                setSelected(null); setAction(null); setAmt(""); setContributeCtx("personal_savings"); setContributeCycleId(null);
                const result = await asoContribute(savedClient.id, a, savedCtx, savedCtx === "personal_savings" ? savedCycleId : null);
                if (!result?.error) {
                  speakConfirmation("ajoDeposit", getLang());
                  setContribSuccess({ client: savedClient, amount: a, showShare: false });
                }
              } else {
                // Clear modal first so it unmounts before PIN sheet opens
                const savedClient = selected;
                const savedAmt = a;
                setSelected(null); setAction(null); setAmt(""); setContributeCtx("personal_savings");
                setTxnPin({
                  title: "Confirm Withdrawal",
                  amount: Math.round(savedAmt * 100),
                  recipient: savedClient.full_name,
                  description: `Gross withdrawal · balance after: ${savedClient.current_balance - savedAmt >= 0 ? `₦${(savedClient.current_balance - savedAmt).toLocaleString()}` : "pending"}`,
                  onApprove: (pin) => {
                    setTxnPin(null);
                    asoWithdraw(savedClient.id, savedAmt, pin);
                    speakConfirmation("ajoWithdraw", getLang());
                  },
                });
              }
            }}
            className={`w-full py-3.5 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm ${
              action === "contribute" ? "bg-green-600 hover:bg-green-700" : "bg-red-500 hover:bg-red-600"
            }`}>
            Confirm {action === "contribute" ? "Contribution" : "Withdrawal"}
          </button>
        </Modal>
      )}

      {/* Reminder modal */}
      {reminderFor && (
        <Modal title="Send Payment Reminder" onClose={() => setReminderFor(null)}>
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
              <p className="text-xs text-brand-600 dark:text-brand-400 font-semibold capitalize">{reminderFor.contribution_frequency} · {fmt(reminderFor.contribution_amount)}</p>
            </div>
            {getMissedPayments(reminderFor) > 0 && (
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-2 py-1 rounded-full flex-shrink-0">
                {getMissedPayments(reminderFor)} missed
              </span>
            )}
          </div>

          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Message Preview</p>
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
                  Copied!
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy
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
          data={buildAsoClientReceipt(receipt, profile?.business_name || profile?.owner_name || "My Business")}
          onClose={() => setReceipt(null)}
        />
      )}

      {/* ── Cash contribution success screen (Gate 4: WhatsApp share) ── */}
      {contribSuccess && (() => {
        const bizName = profile?.business_name || "My Business";
        const receiptData = buildAsoContributionReceipt(
          {
            id:             `CS-${Date.now()}`,
            type:           "contribution",
            status:         "completed",
            amount:         contribSuccess.amount,
            created_at:     new Date().toISOString(),
            payment_method: "cash",
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
              <p className="text-[10px] font-bold text-green-500 uppercase tracking-widest mb-1">Contribution Recorded</p>
              <p className="text-3xl font-black text-slate-800 dark:text-white mb-1">
                ₦{Number(contribSuccess.amount).toLocaleString("en-NG")}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {contribSuccess.client?.full_name} · Cash
              </p>
            </div>
            <div className="flex-none px-5 pb-10 pt-3 space-y-3">
              <button
                onClick={() => setContribSuccess(s => ({ ...s, showShare: true }))}
                className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-extrabold text-sm transition active:scale-[0.99] shadow-md">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                Share Receipt
              </button>
              <button
                onClick={() => setContribSuccess(null)}
                className="w-full py-3.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-2xl font-bold text-sm transition active:scale-[0.99]">
                Done
              </button>
            </div>
          </div>
        );
      })()}

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
          if (error) { setHistoryErr(friendlyError(error, "Failed to open cycle.")); return; }

          if (!data?.ok) { setHistoryErr(data?.error || "Failed to open cycle. Please try again."); return; }
          const { data: newCycle } = await supabase.from("ajo_cycles").select("*").eq("id", data.cycle_id).maybeSingle();
          if (newCycle) setHistoryFor(prev => ({ ...prev, cycles: [...(prev.cycles || []), newCycle] }));

          // Informational notice: first_period + reg fee both apply — client will carry both on day 1.
          // This is allowed by design; no action required from the owner.
          if (data?.conflict_notice === "REG_FEE_AND_FIRST_PERIOD") {
            setHistoryNote(
              "Cycle opened. Note: this client has a registration fee + first-period commission — " +
              "their first deposit covers both. Savings start from deposit 2."
            );
          }
        };

        const handleCloseCycle = (cyc) => {
          if (!cyc) return;
          setCycleConfirm({
            title: "Close Cycle",
            msg: `Mark "${cyc.label || "this cycle"}" as completed?`,
            confirmLabel: "Complete Cycle",
            onConfirm: async () => {
              const { data, error } = await supabase.functions.invoke("ajo-write", {
                body: { action: "close_cycle", cycle_id: cyc.id, status: "completed" },
              });
              if (error || !data?.ok) {
                setHistoryErr(data?.error || friendlyError(error, "Failed to close cycle."));
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
            setHistoryErr(data?.error || friendlyError(error, "Commission execution failed."));
            return;
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
          const { data: freshContribs } = await supabase
            .from("ajo_contributions")
            .select("*")
            .eq("aso_client_id", hc.id)
            .order("created_at", { ascending: false });
          setHistoryFor(prev => ({ ...prev, contributions: freshContribs || prev.contributions }));
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
                <p className="text-sm font-extrabold text-slate-800 dark:text-white">Client Account Created</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Login credentials sent automatically</p>
              </div>
            </div>
            <div className="bg-brand-50 dark:bg-brand-950/20 border border-brand-200 dark:border-brand-900/40 rounded-2xl px-4 py-3 mb-5">
              <p className="text-[11px] text-brand-800 dark:text-brand-300 font-medium leading-relaxed">
                An email with login credentials has been sent to{" "}
                <span className="font-bold">{addedClientEmail}</span>. The client can log in at kudiai.app and will set a permanent password on first login.
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
              Done
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
                  <p className="text-sm font-extrabold text-slate-800 dark:text-white">Password Reset</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">New credentials for {createdClient.full_name.split(" ")[0]}</p>
                </div>
              </div>

              {/* Credential cards */}
              <div className="space-y-3 mb-5">
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Email (Login)</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{createdClient.email}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Temporary Password</p>
                      <p className="text-sm font-bold text-slate-800 dark:text-white font-mono">{createdClient._password}</p>
                    </div>
                    <button onClick={() => copyField(createdClient._password, "password")}
                      className="ml-3 text-[11px] font-bold text-brand-600 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 px-2.5 py-1.5 rounded-lg flex-shrink-0">
                      {copiedField === "password" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Membership No.</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-white font-mono">{createdClient.membership_number}</p>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl px-4 py-3 mb-4">
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
                  Share these new credentials with the client. They can log in at kudiai.app and will set a permanent password on first login.
                </p>
              </div>

              <button onClick={closeClientCredentials}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl py-3.5 text-sm transition">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Security Hold Reject Modal ──────────────────────────────────── */}
      {rejectingHeld && (
        <Modal title="Reject Security-Held Withdrawal" onClose={() => { setRejectingHeld(null); setHeldRejectReason(""); }}>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Rejecting <strong className="text-slate-700 dark:text-slate-200">{rejectingHeld.aso_clients?.full_name || "client"}</strong>&apos;s request of{" "}
            <strong className="text-orange-700 dark:text-orange-300">{fmt(rejectingHeld.amount)}</strong>.
            The client will be notified with your reason.
          </p>
          <Field as="textarea" label="Reason (required)" value={heldRejectReason}
            onChange={e => setHeldRejectReason(e.target.value)}
            placeholder="e.g. Security review period has not elapsed — please retry in 24h…" />
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
            {heldRejectBusy ? "Rejecting…" : "Reject & Notify Client"}
          </button>
        </Modal>
      )}

      {/* ── Manual Deposit Reject Reason Modal ──────────────────────────── */}
      {rejectingDeposit && (
        <Modal title="Reject Deposit Claim" onClose={() => { setRejectingDeposit(null); setRejectReason(""); }}>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Rejecting <strong className="text-slate-700 dark:text-slate-200">{rejectingDeposit.aso_clients?.full_name || "client"}</strong>'s claim of{" "}
            <strong className="text-brand-700 dark:text-brand-300">₦{Number(rejectingDeposit.amount).toLocaleString("en-NG")}</strong>.
            The client will be notified with your reason.
          </p>
          <Field as="textarea" label="Reason (required)" value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="e.g. We did not receive this transfer in our account…" />
          <button
            onClick={() => handleRejectDeposit(rejectingDeposit, rejectReason)}
            disabled={!rejectReason.trim() || processingDepositId === rejectingDeposit.id}
            className="w-full py-3.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] mt-1">
            {processingDepositId === rejectingDeposit.id ? "Rejecting…" : "Reject & Notify Client"}
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
              <p className="font-extrabold text-slate-800 dark:text-white text-base">Today's Collection</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {asoClients.filter(c => c.status === "active" && c.next_contribution_date && c.next_contribution_date <= today()).length} clients due
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
        <div className="fixed inset-0 z-sub-sheet bg-black/50 flex items-end justify-center" onClick={e => { if (e.target === e.currentTarget) setShowGroups(false); }}>
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl flex flex-col" style={{ maxHeight: "90dvh" }}>
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
              <div className="w-9 h-9 bg-brand-100 dark:bg-brand-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5 text-brand-600 dark:text-brand-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-extrabold text-slate-800 dark:text-white text-sm">Ajo Groups</p>
                <p className="text-[10px] text-slate-400">Manage Paystack subaccounts per group</p>
              </div>
              <button onClick={() => setShowGroups(false)} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3.5 h-3.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Explainer */}
              <div className="bg-brand-50 dark:bg-brand-900/20 rounded-2xl px-4 py-3 border border-brand-100 dark:border-brand-800/60">
                <p className="text-[11px] text-brand-700 dark:text-brand-300 font-medium leading-relaxed">
                  Each group is linked to a <strong>Paystack Subaccount</strong>. When a client pays online, 100% of their contribution routes directly to that group's bank account — the platform holds no funds.
                </p>
              </div>

              {/* Subaccount message */}
              {subAcctMsg && (
                <p className={`text-xs px-3 py-2.5 rounded-xl ${subAcctMsg.includes("failed") || subAcctMsg.includes("Add bank") ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" : "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400"}`}>
                  {subAcctMsg}
                </p>
              )}

              {/* Groups list */}
              {groupsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : groups.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-500 dark:text-slate-400">No groups yet. Create your first group below.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {groups.map(grp => {
                    const clientCount = asoClients.filter(c => c.ajo_group_id === grp.id).length;
                    const hasSubacct  = Boolean(grp.paystack_subaccount_code);
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
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${hasSubacct ? "bg-green-100 dark:bg-green-900/30" : "bg-slate-100 dark:bg-slate-700"}`}>
                            <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 ${hasSubacct ? "text-green-600 dark:text-green-400" : "text-slate-400"}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                              {hasSubacct
                                ? <><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></>
                                : <rect x="2" y="5" width="20" height="14" rx="2" />
                              }
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-extrabold text-slate-800 dark:text-white truncate">{grp.name}</p>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              <span className="text-[10px] text-slate-400">{clientCount} client{clientCount !== 1 ? "s" : ""}</span>
                              {grp.contribution_frequency && <span className="text-[10px] text-slate-400">· {grp.contribution_frequency}</span>}
                              {grp.contribution_amount   && <span className="text-[10px] text-slate-400">· ₦{fmt(grp.contribution_amount)}</span>}
                              {isRotating && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">Rotating</span>}
                            </div>
                            {grp.account_number && (
                              <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                {grp.account_name ? `${grp.account_name} · ` : ""}
                                {grp.account_number}
                                {grp.bank_code && banks.length > 0 && (() => { const b = banks.find(x => x.code === grp.bank_code); return b ? ` · ${b.name}` : ""; })()}
                              </p>
                            )}
                            {hasSubacct ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600 dark:text-green-400 mt-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                {grp.paystack_subaccount_code}
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-500 dark:text-amber-400 font-semibold mt-1 block">No Paystack subaccount yet</span>
                            )}
                          </div>
                        </div>
                        {!hasSubacct && grp.bank_code && grp.account_number && (
                          <button
                            onClick={() => createSubaccount(grp)}
                            disabled={subAcctCreating === grp.id}
                            className="w-full mt-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                            {subAcctCreating === grp.id
                              ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Creating…</>
                              : "Create Paystack Subaccount"
                            }
                          </button>
                        )}
                        {isRotating && (
                          <button
                            onClick={() => { setShowGroups(false); openRotation(grp); }}
                            className="w-full mt-2 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                            </svg>
                            Manage Rotation
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
                                  {rs === "not_started" ? "Not started" : rs === "target_met" ? "Target met ✓" : rs === "closed" ? "Closed" : "Active"}
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
                                    Target deadline reached — {fmt(pot)} of {fmt(target)} saved. Close group and release funds?
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
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{pct}% of target</span>
                                    {daysLeft !== null && daysLeft >= 0 && (
                                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{daysLeft}d left</span>
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
                                  <span>Member breakdown</span>
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
                                        Release
                                      </button>
                                    </div>
                                  ))}
                                  {!det?.loading && (det?.members || []).length === 0 && (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center py-1">No active members</p>
                                  )}
                                </div>
                              )}

                              {/* Start round button */}
                              {(rs === "not_started" || rs === "closed") && !isLocked && (
                                <button
                                  type="button"
                                  onClick={() => { setStartRoundGid(grp.id); setStartRoundTarget(""); setStartRoundDeadline(""); setStartRoundMsg({ id: null, text: "", ok: false }); }}
                                  className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                                  Start savings round
                                </button>
                              )}

                              {/* Start round modal */}
                              {startRoundGid === grp.id && (
                                <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3 space-y-2.5 border border-slate-200 dark:border-slate-600">
                                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Start Savings Round</p>
                                  <div>
                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Target Amount (₦)</p>
                                    <input type="number" min="1" placeholder="e.g. 500000" value={startRoundTarget} onChange={e => setStartRoundTarget(e.target.value)}
                                      className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Target Deadline</p>
                                    <input type="date" min={new Date(Date.now() + 86400000).toISOString().split("T")[0]} value={startRoundDeadline} onChange={e => setStartRoundDeadline(e.target.value)}
                                      className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                                  </div>
                                  {startRoundMsg.id === grp.id && (
                                    <p className={`text-[10px] font-semibold ${startRoundMsg.ok ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>{startRoundMsg.text}</p>
                                  )}
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setStartRoundGid(null)} className="flex-1 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition">Cancel</button>
                                    <button type="button" onClick={() => handleStartSavingsRound(grp.id)} disabled={startRoundSaving} className="flex-1 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 rounded-xl transition flex items-center justify-center gap-1">
                                      {startRoundSaving ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Start Round"}
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
                                  Close group &amp; release funds
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
                                Pending admin approval — {isPendingEdit ? "edit" : "archive"} request
                              </p>
                            </div>
                            <button
                              onClick={() => cancelGroupRequest(pendingAppr.id, grp.id)}
                              className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline flex-shrink-0">
                              Cancel
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
                              Edit Details
                            </button>
                            <button
                              onClick={() => { setEditingGroup(grp.id); setEditGf({ contribution_amount: grp.contribution_amount ?? "", contribution_frequency: grp.contribution_frequency || "monthly", group_mode: grp.group_mode || "savings", percentage_charge: grp.percentage_charge ?? 100, bank_code: grp.bank_code || "", account_number: grp.account_number || "", account_name: grp.account_name || "" }); setGroupApprReason(""); setGroupApprMsg({ id: null, text: "", ok: false }); }}
                              className="py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-xl font-bold text-[10px] border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition active:scale-[0.99]">
                              Settings
                            </button>
                            <button
                              onClick={() => openArchiveRequest(grp)}
                              className="py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl font-bold text-[10px] border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition active:scale-[0.99]">
                              Archive
                            </button>
                          </div>
                        )}

                        {/* ── Direct-edit panel — name, description, privacy (no approval needed) ── */}
                        {isDirectEditOpen && (
                          <div className="mt-3 bg-slate-50 dark:bg-slate-700/40 rounded-xl p-3 space-y-2.5 border border-slate-200 dark:border-slate-600">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Edit Group Details</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Name and description changes apply immediately without admin approval.</p>
                            {[
                              { label: "Group Name", key: "name", type: "text" },
                              { label: "Description", key: "description", type: "text" },
                            ].map(({ label, key, type }) => (
                              <div key={key}>
                                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
                                <input type={type} value={directEditGf[key] ?? ""} onChange={e => setDEG(key, e.target.value)}
                                  className="w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              </div>
                            ))}
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Privacy</p>
                              <div className="flex flex-col gap-1.5">
                                {[
                                  { label: "Show member names to other members", key: "privacy_show_names" },
                                  { label: "Show contribution amounts to members", key: "privacy_show_amounts" },
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
                                {directEditSaving ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</> : "Save Changes"}
                              </button>
                              <button onClick={() => setDirectEditGroup(null)}
                                className="px-4 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ── Settings change panel — financial fields (approval required) ── */}
                        {isEditOpen && (
                          <div className="mt-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 space-y-2.5 border border-blue-200 dark:border-blue-800">
                            <p className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Request Settings Change</p>
                            <p className="text-[10px] text-blue-600 dark:text-blue-400">Financial changes require admin approval and apply only after a decision.</p>
                            {[
                              { label: "Contribution Amount (₦)", key: "contribution_amount", type: "number" },
                              { label: "Account Number", key: "account_number", type: "text" },
                              { label: "Account Name", key: "account_name", type: "text" },
                            ].map(({ label, key, type }) => (
                              <div key={key}>
                                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
                                <input type={type} value={editGf[key] ?? ""} onChange={e => setEG(key, e.target.value)}
                                  className="w-full text-sm bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              </div>
                            ))}
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Frequency</p>
                              <select value={editGf.contribution_frequency || "monthly"} onChange={e => setEG("contribution_frequency", e.target.value)}
                                className="w-full text-sm bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none">
                                {["daily","weekly","monthly"].map(fr => <option key={fr} value={fr}>{fr.charAt(0).toUpperCase() + fr.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Group Mode</p>
                              <select value={editGf.group_mode || "savings"} onChange={e => setEG("group_mode", e.target.value)}
                                className="w-full text-sm bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none">
                                <option value="savings">Savings</option>
                                <option value="rotating">Rotating (Esusu)</option>
                              </select>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Bank</p>
                              {banks.length > 0 ? (
                                <select value={editGf.bank_code || ""} onChange={e => setEG("bank_code", e.target.value)}
                                  className="w-full text-sm bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none">
                                  <option value="">Select bank…</option>
                                  {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                                </select>
                              ) : (
                                <input type="text" value={editGf.bank_code || ""} onChange={e => setEG("bank_code", e.target.value)} placeholder="Bank code"
                                  className="w-full text-sm bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none" />
                              )}
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-0.5">Reason for change *</p>
                              <textarea rows={2} value={groupApprReason} onChange={e => setGroupApprReason(e.target.value)} placeholder="Why do you need to change these settings?"
                                className="w-full text-sm bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none resize-none" />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => submitGroupEditRequest(grp)}
                                disabled={groupApprSubmitting || !groupApprReason.trim()}
                                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                                {groupApprSubmitting ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Submitting…</> : "Submit Request"}
                              </button>
                              <button onClick={() => { setEditingGroup(null); setGroupApprReason(""); }}
                                className="px-4 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ── Archive panel — safety-gated ── */}
                        {isDeleteOpen && (
                          <div className="mt-3 bg-red-50 dark:bg-red-900/20 rounded-xl p-3 space-y-2.5 border border-red-200 dark:border-red-800">
                            <p className="text-xs font-bold text-red-700 dark:text-red-300 uppercase tracking-wider">Request Group Archive</p>
                            {archiveSafetyLoading === grp.id ? (
                              <div className="flex items-center gap-2 py-1">
                                <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                                <p className="text-[10px] text-red-600 dark:text-red-400">Checking group status…</p>
                              </div>
                            ) : archiveSafety[grp.id] ? (
                              archiveSafety[grp.id].safe ? (
                                <div className="space-y-2.5">
                                  <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
                                    Archiving <strong>{grp.name}</strong> will remove it from active use and detach all {clientCount} member{clientCount !== 1 ? "s" : ""}. This requires admin approval and cannot be reversed through the portal. All contribution records, rounds, and payout history are preserved.
                                  </p>
                                  <div>
                                    <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-0.5">Reason for archive *</p>
                                    <textarea rows={2} value={groupApprReason} onChange={e => setGroupApprReason(e.target.value)} placeholder="Why do you need to archive this group?"
                                      className="w-full text-sm bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700 rounded-lg px-3 py-2 text-slate-800 dark:text-white focus:outline-none resize-none" />
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      onClick={() => submitGroupDeleteRequest(grp)}
                                      disabled={groupApprSubmitting || !groupApprReason.trim()}
                                      className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl font-bold text-xs transition active:scale-[0.99] flex items-center justify-center gap-1.5">
                                      {groupApprSubmitting ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Submitting…</> : "Submit Archive Request"}
                                    </button>
                                    <button onClick={() => { setDeletingGroup(null); setGroupApprReason(""); }}
                                      className="px-4 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <p className="text-[10px] font-semibold text-red-700 dark:text-red-300">This group cannot be archived yet:</p>
                                  {archiveSafety[grp.id].activeRound && (
                                    <div className="bg-red-100 dark:bg-red-900/30 rounded-lg px-3 py-2">
                                      <p className="text-[10px] font-bold text-red-700 dark:text-red-300">Active rotation round in progress</p>
                                      <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">Close the current round in the Rotation Dashboard before requesting archive.</p>
                                    </div>
                                  )}
                                  {archiveSafety[grp.id].unsettledMembers.length > 0 && (
                                    <div className="bg-red-100 dark:bg-red-900/30 rounded-lg px-3 py-2 space-y-1">
                                      <p className="text-[10px] font-bold text-red-700 dark:text-red-300">
                                        {archiveSafety[grp.id].unsettledMembers.length} member{archiveSafety[grp.id].unsettledMembers.length !== 1 ? "s" : ""} with unsettled balance
                                      </p>
                                      <ul className="space-y-0.5">
                                        {archiveSafety[grp.id].unsettledMembers.map(m => (
                                          <li key={m.id} className="text-[10px] text-red-600 dark:text-red-400 flex justify-between">
                                            <span>{m.full_name}</span>
                                            <span className="font-mono font-bold">₦{fmt(m.current_balance)}</span>
                                          </li>
                                        ))}
                                      </ul>
                                      <p className="text-[10px] text-red-600 dark:text-red-400">All member balances must be withdrawn before archiving.</p>
                                    </div>
                                  )}
                                  <button
                                    onClick={() => { setDeletingGroup(null); setArchiveSafety(prev => { const n = { ...prev }; delete n[grp.id]; return n; }); }}
                                    className="w-full mt-1 py-2 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 transition active:scale-[0.99]">
                                    Close
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
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">New Ajo Group</p>
                  {groupError && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-xl">{groupError}</p>}
                  <Field label="Group Name *" value={gf.name} onChange={e => setG("name", e.target.value)} placeholder="e.g. Monday Women Ajo" />

                  {/* Group mode toggle */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Group Type</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[["savings", "Savings Group"], ["rotating", "Rotating (Esusu)"]].map(([val, label]) => (
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
                      <p className="text-[10px] font-bold text-brand-600 dark:text-brand-400 uppercase tracking-wider">Member Privacy</p>
                      {[
                        { key: "privacy_show_names",   label: "Show full names to members" },
                        { key: "privacy_show_amounts", label: "Show others' amounts to members" },
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
                    <Field label="Monthly Amount (₦)" type="number" value={gf.contribution_amount} onChange={e => setG("contribution_amount", e.target.value)} placeholder="0" />
                    <Field label="Frequency" as="select" value={gf.contribution_frequency} onChange={e => setG("contribution_frequency", e.target.value)}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </Field>
                  </div>

                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-1">Bank Account (for Paystack routing)</p>
                  <Field label="Bank" as="select" value={gf.bank_code} onChange={e => { setG("bank_code", e.target.value); setResolvedName(""); }}>
                    <option value="">Select bank…</option>
                    {banks.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                  </Field>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Field label="Account Number" value={gf.account_number} onChange={e => { setG("account_number", e.target.value); setResolvedName(""); }} placeholder="10-digit NUBAN" />
                    </div>
                    <button
                      onClick={resolveAccount}
                      disabled={resolving || !gf.bank_code || !gf.account_number}
                      className="self-end mb-0 px-3 py-2.5 bg-slate-700 dark:bg-slate-600 text-white text-xs font-bold rounded-xl disabled:opacity-50 transition whitespace-nowrap">
                      {resolving ? "…" : "Verify"}
                    </button>
                  </div>
                  {resolvedName && (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/60 rounded-xl px-3 py-2 flex items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      <p className="text-xs font-bold text-green-700 dark:text-green-300">{resolvedName}</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setShowGroupAdd(false); setGf(BLANK_GROUP); setGroupError(""); setResolvedName(""); }}
                      className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs transition">
                      Cancel
                    </button>
                    <button onClick={saveGroup} disabled={groupSaving || !gf.name}
                      className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition active:scale-[0.99]">
                      {groupSaving ? "Saving…" : "Create Group"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setShowGroupAdd(true); setGroupError(""); setGf(BLANK_GROUP); setResolvedName(""); }}
                  className="w-full py-3.5 border-2 border-dashed border-brand-200 dark:border-brand-800 text-brand-600 dark:text-brand-400 rounded-2xl font-bold text-sm transition hover:bg-brand-50 dark:hover:bg-brand-900/20 active:scale-[0.99]">
                  + Create New Group
                </button>
              )}

              <div className="h-4" />
            </div>
          </div>
        </div>
      )}
      {txnPin && <TransactionPinModal {...txnPin} onCancel={() => setTxnPin(null)} />}

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
                Cancel
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
                <p className="text-[10px] text-slate-400">Esusu Rotation</p>
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
