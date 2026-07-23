import React, { useState, useMemo } from "react";
import { createReportPdf, fmtCurrency, fmtDate } from "../utils/generateReportPdf";
import TransactionPinModal from "./TransactionPinModal";
import { allocatePeriods, allocateForReceipt } from "../utils/allocatePeriods.mjs";

// ── Visual maps ───────────────────────────────────────────────────────────────

const MARK_CLS = {
  paid:            "bg-emerald-500 text-white",
  paid_in_advance: "bg-emerald-300 text-emerald-900",
  partial:         "bg-amber-400 text-white",
  pending:         "border-2 border-dashed border-amber-400 dark:border-amber-500 text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20",
  missed:          "border-2 border-red-300 dark:border-red-700 text-red-400 dark:text-red-500 bg-transparent",
  current:         "bg-brand-500 text-white ring-2 ring-brand-300 dark:ring-brand-600 animate-pulse",
  upcoming:        "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500",
  collector:       "bg-[#16255A] text-white dark:bg-[#1E3A6E]",
};

const MARK_ICON = {
  paid:            "✓",
  paid_in_advance: "✓",
  partial:         "~",
  pending:         "?",
  missed:          "✗",
  current:         "→",
  upcoming:        "·",
  collector:       "₦",
};

const MARK_LABEL = {
  paid:            "Paid",
  paid_in_advance: "Paid ahead",
  partial:         "Partial",
  pending:         "Pending",
  missed:          "Missed",
  current:         "Current",
  upcoming:        "Upcoming",
  collector:       "Collector's",
};

const COLS_BY_FREQ = { daily: 7, weekly: 5, monthly: 4 };

function fmtPeriodRange(p, freq) {
  const opts = freq === "daily"
    ? { weekday: "short", day: "numeric", month: "short" }
    : freq === "weekly"
    ? { day: "numeric", month: "short" }
    : { month: "long", year: "numeric" };
  const from = p.from.toLocaleDateString("en-NG", opts);
  if (freq === "monthly") return from;
  const to = new Date(p.to.getTime() - 86400000).toLocaleDateString("en-NG", opts);
  return freq === "daily" ? from : `${from} – ${to}`;
}

// ── Commission helpers ────────────────────────────────────────────────────────

function computeCommission(cycle, contributions) {
  if (!cycle || !cycle.commission_model || cycle.commission_model === "none") {
    return { amount: 0, label: null };
  }
  const ledgerContribs = contributions.filter(
    (c) => (c.type === "contribution" || c.type === undefined) && c.status === "completed"
  );
  if (cycle.commission_model === "first_period") {
    return {
      amount: Number(cycle.expected_amount_per_period),
      label: `Period 1 (${fmtCurrency(cycle.expected_amount_per_period)})`,
    };
  }
  if (cycle.commission_model === "percent") {
    const totalPaid = ledgerContribs.reduce((s, c) => s + Number(c.amount || 0), 0);
    const pct = Number(cycle.commission_percent || 0);
    return {
      amount: (totalPaid * pct) / 100,
      label: `${pct}% of ${fmtCurrency(totalPaid)}`,
    };
  }
  return { amount: 0, label: null };
}

function commissionAlreadyExecuted(contributions) {
  return contributions.some((c) => c.type === "commission" && c.status === "completed");
}

// ── Compact currency for grid cells (no import needed — standalone) ──────────
function fmtCompact(n) {
  if (n >= 1000000) return `₦${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `₦${Math.round(n / 1000)}k`;
  return `₦${n}`;
}

// ── PDF export ────────────────────────────────────────────────────────────────

async function exportCardPdf({ cycle, periods, contributions, clientName, businessName }) {
  const freq = cycle.frequency || cycle.contribution_frequency || "monthly";
  const paid         = periods.filter((p) => p.status === "paid" || p.status === "paid_in_advance").length;
  const partial      = periods.filter((p) => p.status === "partial").length;
  const pending      = periods.filter((p) => p.status === "pending").length;
  const missed       = periods.filter((p) => p.status === "missed").length;
  const totalPaid    = periods.reduce((s, p) => s + p.paid, 0);
  const pendingTotal = periods.reduce((s, p) => s + (p.pendingAmount || 0), 0);
  const commission = computeCommission(cycle, contributions || []);

  const pdf = await createReportPdf({
    title:        "Contribution Card",
    businessName,
    period:       `${fmtDate(cycle.start_date)} – ${cycle.label || `${cycle.length_periods} periods`}`,
    entityDetails: [
      { label: "Member",    value: clientName },
      { label: "Frequency", value: freq.charAt(0).toUpperCase() + freq.slice(1) },
      { label: "Expected / period", value: fmtCurrency(cycle.expected_amount_per_period) },
      { label: "Status",    value: cycle.status.charAt(0).toUpperCase() + cycle.status.slice(1) },
    ],
  });

  const stats = [
    { label: "Paid",            value: `${paid} / ${cycle.length_periods}`, color: "#059669" },
    { label: "Partial",         value: String(partial),                      color: "#d97706" },
    { label: "Missed",          value: String(missed),                       color: "#dc2626" },
    { label: "Total Collected", value: fmtCurrency(totalPaid),               color: "#0f1c45" },
  ];
  if (pending > 0) {
    stats.push({ label: "Pending (unconfirmed)", value: `${pending} — ${fmtCurrency(pendingTotal)}`, color: "#d97706" });
  }
  if (commission.amount > 0) {
    stats.push({ label: "Commission Earned", value: fmtCurrency(commission.amount), color: "#3DA829" });
  }
  pdf.addStats(stats);

  // CC-13: visual grid above the period table, matching on-screen cell colours
  pdf.addSectionTitle("Period Grid");
  const FREQ_COLS = { daily: 7, weekly: 5, monthly: 4 };
  pdf.addGrid(periods, FREQ_COLS[freq] || 4);

  pdf.addSectionTitle("Period Breakdown");

  const cols = [
    { key: "period",  label: "Period",  w: 40 },
    { key: "from",    label: "From",    w: 32 },
    { key: "to",      label: "To",      w: 32 },
    { key: "paid",    label: "Paid",    w: 28, right: true },
    { key: "status",  label: "Status",  w: 24 },
  ];

  const rows = periods.map((p, i) => ({
    period: `#${i + 1}`,
    from:   fmtDate(p.from),
    to:     fmtDate(new Date(p.to.getTime() - 86400000)),
    paid:   fmtCurrency(p.paid),
    status: p.status === "pending" ? "Pending (unconfirmed)" : MARK_LABEL[p.status],
  }));

  pdf.addTable(cols, rows);
  const totalsRows = [
    { label: "Total Expected",  value: fmtCurrency(Number(cycle.expected_amount_per_period) * cycle.length_periods) },
    { label: "Total Collected", value: fmtCurrency(totalPaid), bold: true, green: totalPaid >= Number(cycle.expected_amount_per_period) * cycle.length_periods },
    { label: "Outstanding",     value: fmtCurrency(Math.max(0, Number(cycle.expected_amount_per_period) * cycle.length_periods - totalPaid)), red: true },
  ];
  if (pendingTotal > 0) {
    totalsRows.push({ label: "Pending (awaiting confirmation)", value: fmtCurrency(pendingTotal) });
  }
  if (commission.amount > 0) {
    totalsRows.push({ sep: true });
    totalsRows.push({ label: `Commission (${cycle.commission_model === "first_period" ? "Period 1" : `${cycle.commission_percent}%`})`, value: fmtCurrency(commission.amount), bold: true });
  }
  pdf.addTotalsBlock(totalsRows);

  // Deposit allocation breakdown — shows how each deposit split across periods
  const completedDeposits = (contributions || []).filter(c => c.type === "contribution" && c.status === "completed");
  if (completedDeposits.length > 0) {
    const allocRows = completedDeposits.map(dep => {
      const { splits } = allocateForReceipt({ ...cycle, frequency: freq }, contributions, dep.id);
      return {
        date:   fmtDate(dep.created_at),
        amount: fmtCurrency(dep.amount),
        split:  splits.length > 0
          ? splits.map(s => `P${s.idx + 1}: ${fmtCurrency(s.amount)}`).join("  ·  ")
          : "—",
      };
    });
    if (allocRows.some(r => r.split !== "—")) {
      pdf.addSectionTitle("Deposit Allocations");
      pdf.addTable(
        [
          { key: "date",   label: "Date",          w: 0.22 },
          { key: "amount", label: "Amount",        w: 0.20, right: true },
          { key: "split",  label: "Period Split",  w: 0.58 },
        ],
        allocRows
      );
    }
  }

  await pdf.save(`contribution-card-${clientName.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContributionCard({
  cycle,
  contributions = [],
  frequency,
  clientName,
  businessName,
  registrationCharge = 0,
  onOpenCycle,
  onCloseCycle,
  onExecuteCommission,
  compact = false,
  isLegacyCycle = false,
}) {
  const [selected,             setSelected]             = useState(null);
  const [exporting,            setExporting]            = useState(false);
  const [showPinForCommission, setShowPinForCommission] = useState(false);
  const [commissionExecuting,  setCommissionExecuting]  = useState(false);
  const [cardTab,              setCardTab]              = useState("card");

  const freq = frequency || cycle?.frequency || cycle?.contribution_frequency || "monthly";
  const cols = COLS_BY_FREQ[freq] || 4;

  // Isolate this cycle's contributions: explicit cycle_id match.
  // Legacy fallback: absorb null-cycle_id rows ONLY when this cycle has zero direct hits
  // (cycle predates attribution tracking — all historical rows lack cycle_id).
  // When direct hits exist, null-cycle_id rows belong to an indeterminate cycle and must
  // NOT be pulled in, otherwise the first card inflates to the client's lifetime total.
  const cycleContribs = useMemo(() => {
    if (!cycle?.id) return contributions;
    const direct = contributions.filter(c => c.cycle_id === cycle.id);
    if (isLegacyCycle && direct.length === 0) {
      return contributions.filter(c => !c.cycle_id);
    }
    return direct;
  }, [contributions, cycle?.id, isLegacyCycle]);

  const { periods, cycleStarted, progressPct, nextDue } = useMemo(
    () => (cycle ? allocatePeriods({ ...cycle, frequency: freq }, cycleContribs, contributions) : { periods: [], cycleStarted: false, progressPct: 0, nextDue: null }),
    [cycle, cycleContribs, freq, contributions]
  );

  const paidCount    = periods.filter((p) => p.status === "paid" || p.status === "paid_in_advance").length;
  const missedCount  = periods.filter((p) => p.status === "missed").length;
  const partialCount = periods.filter((p) => p.status === "partial").length;
  const pendingCount = periods.filter((p) => p.status === "pending").length;
  const totalPaid         = periods.reduce((s, p) => s + p.paid, 0);
  const pendingTotal      = periods.reduce((s, p) => s + (p.pendingAmount || 0), 0);
  const outstandingPartial = cycle
    ? periods.filter(p => p.status === "partial").reduce((s, p) => s + Math.max(0, Number(cycle.expected_amount_per_period) - p.paid), 0)
    : 0;

  const commission        = useMemo(() => computeCommission(cycle, cycleContribs), [cycle, cycleContribs]);
  const commissionDone    = useMemo(() => commissionAlreadyExecuted(cycleContribs), [cycleContribs]);
  const canExecCommission = !compact && onExecuteCommission && cycle &&
    cycle.status !== "active" && commission.amount > 0 && !commissionDone &&
    cycle.commission_model !== "first_period";
  const totalExp     = cycle ? Number(cycle.expected_amount_per_period) * cycle.length_periods : 0;

  if (!cycle) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">No active cycle.</p>
        {onOpenCycle && (
          <button
            onClick={() => onOpenCycle()}
            className="px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
          >
            Open Cycle
          </button>
        )}
      </div>
    );
  }

  const handleExport = async () => {
    setExporting(true);
    try { await exportCardPdf({ cycle: { ...cycle, frequency: freq }, periods, contributions: cycleContribs, clientName, businessName }); }
    finally { setExporting(false); }
  };

  const handleCommissionPin = async (pin) => {
    setShowPinForCommission(false);
    setCommissionExecuting(true);
    try { await onExecuteCommission(commission.amount, pin); }
    finally { setCommissionExecuting(false); }
  };

  return (
    <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide">
            {freq.charAt(0).toUpperCase() + freq.slice(1)} Cycle
            {cycle.label ? ` — ${cycle.label}` : ""}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            From {fmtDate(cycle.start_date)} · {cycle.length_periods} periods
          </p>
          {cycleStarted && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 flex-shrink-0">{paidCount}/{cycle.length_periods}</span>
            </div>
          )}
          {nextDue && cycle.status === "active" && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              Next due {fmtDate(nextDue)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!compact && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-500 transition-colors disabled:opacity-50 min-h-[44px] px-3 inline-flex items-center"
            >
              {exporting ? "Exporting…" : "PDF"}
            </button>
          )}
          {!compact && onCloseCycle && cycle.status === "active" && (
            <button
              onClick={onCloseCycle}
              className="text-[11px] font-semibold text-red-500 hover:text-red-600 transition-colors min-h-[44px] px-3 inline-flex items-center"
            >
              Close
            </button>
          )}
          {!compact && onOpenCycle && cycle.status !== "active" && (
            <button
              onClick={() => onOpenCycle()}
              className="text-[11px] font-semibold text-brand-500 hover:text-brand-600 transition-colors min-h-[44px] px-3 inline-flex items-center"
            >
              New Cycle
            </button>
          )}
        </div>
      </div>

      {/* Tab bar — card view vs cycle history */}
      {!compact && (
        <div className="flex border-b border-slate-100 dark:border-slate-700 px-4">
          {[
            { id: "card",    label: "Card" },
            { id: "history", label: `History${cycleContribs.length > 0 ? ` (${cycleContribs.length})` : ""}` },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setCardTab(t.id)}
              className={`py-2 mr-5 text-xs font-bold border-b-2 transition-colors ${
                cardTab === t.id
                  ? t.id === "card" ? "border-brand-500 text-brand-500" : "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Card tab ── */}
      {(compact || cardTab === "card") && <>

      {/* Stats strip */}
      <div className="px-4 pb-3 flex flex-col gap-1">
        <div className="flex gap-4 text-[11px]">
          <span className="text-emerald-600 font-semibold">{paidCount} paid</span>
          {partialCount > 0 && <span className="text-amber-500 font-semibold">{partialCount} partial</span>}
          {pendingCount > 0 && <span className="text-amber-400 font-semibold">{pendingCount} pending</span>}
          {missedCount > 0 && <span className="text-red-500 font-semibold">{missedCount} missed</span>}
          <span className="ml-auto text-slate-500 dark:text-slate-400">
            {fmtCurrency(totalPaid)} / {fmtCurrency(totalExp)}
          </span>
        </div>
        {outstandingPartial > 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-500 font-medium">
            {fmtCurrency(outstandingPartial)} outstanding across {partialCount} partial period{partialCount > 1 ? "s" : ""}
          </p>
        )}
        {pendingTotal > 0 && (
          <p className="text-[10px] text-amber-500 font-medium">
            {fmtCurrency(pendingTotal)} awaiting confirmation
          </p>
        )}
        {!cycleStarted && pendingTotal > 0 && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            Cycle not yet started — first payment pending confirmation
          </p>
        )}
      </div>

      {/* pending_activation — active cycle with no deposits yet */}
      {!cycleStarted && pendingTotal === 0 && cycle.status === "active" ? (
        <div className="px-4 pb-5 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-slate-400 dark:text-slate-500" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Activate with your first deposit</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Your savings period tracker will appear here after your first deposit.</p>
          </div>
          {(() => {
            const expected   = Number(cycle.expected_amount_per_period || 0);
            const isFirstPrd = cycle.commission_model === "first_period";
            // Registration fee is a one-time charge on the client's very first deposit ever.
            // If they already have any completed contribution (on any prior cycle), skip it.
            const alreadyPaidReg = contributions.some(
              c => c.status === "completed" && c.type === "contribution"
            );
            const regCharge = alreadyPaidReg ? 0 : Number(registrationCharge || 0);
            if (!isFirstPrd && regCharge === 0) return null;
            const total = expected + regCharge;
            const parts = isFirstPrd
              ? `${fmtCurrency(expected)} collector fee${regCharge > 0 ? ` + ${fmtCurrency(regCharge)} registration` : ""}`
              : `${fmtCurrency(expected)} contribution + ${fmtCurrency(regCharge)} registration`;
            return (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2.5 w-full">
                <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">
                  First deposit: {fmtCurrency(total)} = {parts}
                </p>
              </div>
            );
          })()}
        </div>
      ) : (
        /* Grid — CC-11: max-height + internal scroll for long cycles */
        <div
          className="px-4 pb-4 grid gap-1.5 max-h-52 overflow-y-auto"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {periods.map((p) => {
            const outstanding = p.status === "partial"
              ? Math.max(0, Number(cycle.expected_amount_per_period) - p.paid)
              : 0;
            return (
              <button
                key={p.idx}
                onClick={() => setSelected(p)}
                className={`
                  aspect-square rounded-lg flex flex-col items-center justify-center text-center
                  text-[11px] font-bold transition-all active:scale-95
                  ${MARK_CLS[p.status]}
                  ${compact ? "text-[9px]" : ""}
                `}
                title={`Period ${p.idx + 1} · ${MARK_LABEL[p.status]}${outstanding > 0 ? ` · ${fmtCurrency(outstanding)} outstanding` : ""}`}
              >
                <span className={compact ? "text-[10px]" : "text-base leading-none mb-0.5"}>{MARK_ICON[p.status]}</span>
                {!compact && (
                  outstanding > 0
                    ? <span className="text-[8px] leading-tight opacity-90">{fmtCompact(outstanding)}</span>
                    : <span className="text-[9px] opacity-75">#{p.idx + 1}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Commission strip */}
      {!compact && commission.amount > 0 && (
        <div className="mx-4 mb-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 px-3 py-2.5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold text-brand-500 uppercase tracking-wide">Collector Commission</p>
            <p className="text-xs text-brand-600 dark:text-brand-300 mt-0.5">{commission.label}</p>
            {cycle?.commission_model === "first_period" && !commissionDone && Number(cycle.commission_balance || 0) > 0 && (
              <p className="text-[10px] text-amber-500 font-medium mt-0.5">
                {fmtCurrency(cycle.commission_balance)} / {fmtCurrency(commission.amount)} received
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="font-extrabold text-brand-600 dark:text-brand-300 text-sm">{fmtCurrency(commission.amount)}</p>
            {commissionDone && (
              <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">Executed ✓</p>
            )}
          </div>
        </div>
      )}

      {/* Settlement / execute commission */}
      {canExecCommission && (
        <div className="mx-4 mb-3">
          <button
            onClick={() => setShowPinForCommission(true)}
            disabled={commissionExecuting}
            className="w-full py-3.5 min-h-[44px] rounded-xl bg-brand-500 text-white text-sm font-bold hover:bg-brand-600 transition-colors disabled:opacity-50 active:scale-[0.98]"
          >
            {commissionExecuting ? "Processing…" : `Execute Commission — ${fmtCurrency(commission.amount)}`}
          </button>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-1">
            PIN-gated · deducts from client balance · client is notified
          </p>
        </div>
      )}

      {/* Legend */}
      {!compact && (
        <div className="px-4 pb-3 flex flex-wrap gap-3">
          {Object.entries(MARK_LABEL).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span className={`w-3 h-3 rounded flex items-center justify-center text-[8px] font-bold ${MARK_CLS[k]}`}>
                {MARK_ICON[k]}
              </span>
              {v}
            </span>
          ))}
        </div>
      )}

      {/* end card tab */}
      </>}

      {/* ── History tab ── */}
      {!compact && cardTab === "history" && (() => {
        const TX_LABEL = {
          contribution:             "Contribution",
          withdrawal:               "Withdrawal",
          commission:               "Commission",
          registration_fee:         "Registration Fee",
          withdrawal_fee:           "Withdrawal Fee",
          reversal_contribution:    "Reversal",
          reversal_withdrawal:      "Reversal (withdrawal)",
          reversal_withdrawal_fee:  "Reversal (fee)",
          reversal_registration_fee:"Reversal (reg fee)",
          esusu_payout:             "Esusu Payout",
          disbursement:             "Disbursement",
        };
        const isCredit = (type) =>
          type === "contribution" || type === "esusu_payout" || type === "disbursement" ||
          (type || "").startsWith("reversal_withdrawal") || type === "reversal_registration_fee";
        const statusCls = (s) =>
          s === "completed" || s === "approved" ? "text-emerald-600 dark:text-emerald-400"
          : s === "rejected"                     ? "text-red-500 dark:text-red-400"
          : "text-amber-500 dark:text-amber-400";
        const sorted = [...cycleContribs].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        const fmt = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (sorted.length === 0) {
          return (
            <div className="px-4 py-10 flex flex-col items-center text-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-slate-300 dark:text-slate-600" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>
              </svg>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold">No transactions yet for this cycle</p>
            </div>
          );
        }
        return (
          <div className="px-4 pb-4 pt-2 space-y-2 max-h-72 overflow-y-auto">
            {sorted.map(tx => {
              const credit = isCredit(tx.type);
              const dateStr = tx.created_at
                ? new Date(tx.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
                : "—";
              return (
                <div key={tx.id} className="flex items-start gap-3 rounded-xl bg-slate-50 dark:bg-slate-700/40 px-3 py-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${credit ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
                    <svg viewBox="0 0 24 24" fill="none" className={`w-3.5 h-3.5 ${credit ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                      {credit ? <path d="M12 5v14M5 12l7-7 7 7"/> : <path d="M12 19V5M5 12l7 7 7-7"/>}
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                        {TX_LABEL[tx.type] ?? tx.type}
                      </p>
                      <span className={`text-xs font-extrabold tabular-nums flex-shrink-0 ${credit ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {credit ? "+" : "−"}{fmt(tx.amount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] font-semibold capitalize ${statusCls(tx.status)}`}>{tx.status || "—"}</span>
                      <span className="text-[10px] text-slate-400">·</span>
                      <span className="text-[10px] text-slate-400">{dateStr}</span>
                    </div>
                    {tx.notes && (
                      <p className="text-[10px] text-slate-400 italic mt-0.5 truncate">"{tx.notes}"</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* PIN modal for commission execution */}
      {showPinForCommission && (
        <TransactionPinModal
          title="Confirm Commission"
          subtitle={`Deduct ${fmtCurrency(commission.amount)} from ${clientName}'s balance`}
          onApprove={handleCommissionPin}
          onCancel={() => setShowPinForCommission(false)}
        />
      )}

      {/* Period detail bottom sheet */}
      {selected && (
        <div
          className="fixed inset-0 z-card-detail flex items-end"
          onClick={() => setSelected(null)}
        >
          <style>{`@keyframes cc-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl p-5 max-w-lg mx-auto"
            style={{ animation: "cc-sheet-up 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-bold text-slate-900 dark:text-white text-base">
                  Period #{selected.idx + 1}
                </p>
                {selected.status === "partial" && (
                  <p className="text-xs text-amber-500 font-semibold mt-0.5">
                    {fmtCurrency(selected.paid)} paid · {fmtCurrency(Math.max(0, Number(cycle.expected_amount_per_period) - selected.paid))} outstanding
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-400 hover:text-slate-600"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Status</span>
                <span className={`font-semibold ${
                  selected.status === "paid"            ? "text-emerald-600"
                  : selected.status === "paid_in_advance" ? "text-emerald-500"
                  : selected.status === "missed"          ? "text-red-500"
                  : selected.status === "partial"         ? "text-amber-500"
                  : selected.status === "pending"         ? "text-amber-400"
                  : selected.status === "current"         ? "text-brand-500"
                  : selected.status === "collector"       ? "text-[#16255A] dark:text-[#8EA3D4]"
                  : "text-slate-400"
                }`}>{MARK_LABEL[selected.status]}</span>
              </div>
              {selected.status === "collector" && (
                <p className="text-xs text-[#16255A] dark:text-[#8EA3D4] bg-[#EEF1F9] dark:bg-[#16255A]/20 rounded-lg px-3 py-2">
                  This deposit went to your collector as the cycle fee. Your savings start from period 2.
                </p>
              )}
              {selected.status === "partial" && selected.idx === 0 && cycle?.commission_model === "first_period" && (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                  Collector fee in progress — {fmtCurrency(Number(cycle.commission_balance || 0))} received of {fmtCurrency(cycle.expected_amount_per_period)}. Your savings start once the full fee is paid.
                </p>
              )}
              {selected.status === "pending" && (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                  Awaiting your collector's confirmation
                </p>
              )}
              {selected.status === "missed" && selected.rejectedRow && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                  {selected.rejectedRow.reject_reason
                    ? `Rejected: ${selected.rejectedRow.reject_reason}`
                    : "A previous submission was rejected by your collector."}
                </p>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Range</span>
                <span className="font-medium text-slate-900 dark:text-white">{fmtPeriodRange(selected, freq)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Expected</span>
                <span className="font-medium text-slate-900 dark:text-white">{fmtCurrency(cycle.expected_amount_per_period)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Paid</span>
                <span className={`font-semibold ${selected.paid >= Number(cycle.expected_amount_per_period) ? "text-emerald-600" : selected.paid > 0 ? "text-amber-500" : "text-slate-400"}`}>
                  {fmtCurrency(selected.paid)}
                </span>
              </div>
              {selected.status === "pending" && (selected.pendingAmount || 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Pending</span>
                  <span className="font-semibold text-amber-500">{fmtCurrency(selected.pendingAmount)}</span>
                </div>
              )}
              {selected.paid < Number(cycle.expected_amount_per_period) && selected.status !== "pending" && (
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Shortfall</span>
                  <span className="font-semibold text-red-500">
                    {fmtCurrency(Math.max(0, Number(cycle.expected_amount_per_period) - selected.paid))}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
