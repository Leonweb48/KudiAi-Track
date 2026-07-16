import React, { useState, useMemo } from "react";
import { createReportPdf, fmtCurrency, fmtDate } from "../utils/generateReportPdf";
import TransactionPinModal from "./TransactionPinModal";

// ── Period math ───────────────────────────────────────────────────────────────

function parseLocalDate(s) {
  if (!s) return null;
  const str = String(s);
  if (str.includes("T")) return new Date(str);
  return new Date(str + "T00:00:00");
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function periodStart(startDate, idx, freq) {
  const s = parseLocalDate(startDate);
  if (freq === "daily")   return addDays(s, idx);
  if (freq === "weekly")  return addDays(s, idx * 7);
  if (freq === "monthly") return addMonths(s, idx);
  return addDays(s, idx);
}

function periodEnd(startDate, idx, freq) {
  const s = periodStart(startDate, idx, freq);
  if (freq === "daily")   return addDays(s, 1);
  if (freq === "weekly")  return addDays(s, 7);
  if (freq === "monthly") return addMonths(s, 1);
  return addDays(s, 1);
}

// Returns array of { idx, from, to, paid, status }
function buildPeriods(cycle, contributions) {
  const { start_date, length_periods, expected_amount_per_period, status: cycleStatus } = cycle;
  const freq = cycle.frequency || cycle.contribution_frequency || "monthly";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const periods = [];
  for (let i = 0; i < length_periods; i++) {
    const from = periodStart(start_date, i, freq);
    const to   = periodEnd(start_date, i, freq);
    periods.push({ idx: i, from, to, paid: 0 });
  }

  // Assign each contribution to a period by its created_at
  for (const c of contributions) {
    if (!c.created_at) continue;
    const dt = new Date(c.created_at);
    for (const p of periods) {
      if (dt >= p.from && dt < p.to) {
        p.paid += Number(c.amount || 0);
        break;
      }
    }
  }

  // Score each period
  return periods.map((p) => {
    let status;
    const expected = Number(expected_amount_per_period);
    const isFuture = p.from > today;
    const isCurrent = p.from <= today && today < p.to;

    if (cycleStatus !== "active" && !p.paid) {
      status = "missed";
    } else if (isFuture) {
      status = "upcoming";
    } else if (p.paid >= expected) {
      status = "paid";
    } else if (p.paid > 0) {
      status = "partial";
    } else if (isCurrent) {
      status = "current";
    } else {
      status = "missed";
    }
    return { ...p, status };
  });
}

// ── Visual maps ───────────────────────────────────────────────────────────────

const MARK_CLS = {
  paid:     "bg-emerald-500 text-white",
  partial:  "bg-amber-400 text-white",
  missed:   "border-2 border-red-300 dark:border-red-700 text-red-400 dark:text-red-500 bg-transparent",
  current:  "bg-brand-500 text-white ring-2 ring-brand-300 dark:ring-brand-600 animate-pulse",
  upcoming: "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500",
};

const MARK_ICON = {
  paid:     "✓",
  partial:  "~",
  missed:   "✗",
  current:  "→",
  upcoming: "·",
};

const MARK_LABEL = {
  paid:     "Paid",
  partial:  "Partial",
  missed:   "Missed",
  current:  "Current",
  upcoming: "Upcoming",
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
    (c) => c.type === "contribution" || c.type === undefined
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
  return contributions.some((c) => c.type === "commission");
}

// ── PDF export ────────────────────────────────────────────────────────────────

async function exportCardPdf({ cycle, periods, contributions, clientName, businessName }) {
  const freq = cycle.frequency || cycle.contribution_frequency || "monthly";
  const paid    = periods.filter((p) => p.status === "paid").length;
  const partial = periods.filter((p) => p.status === "partial").length;
  const missed  = periods.filter((p) => p.status === "missed").length;
  const totalPaid = periods.reduce((s, p) => s + p.paid, 0);
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
    status: MARK_LABEL[p.status],
  }));

  pdf.addTable(cols, rows);
  const totalsRows = [
    { label: "Total Expected",  value: fmtCurrency(Number(cycle.expected_amount_per_period) * cycle.length_periods) },
    { label: "Total Collected", value: fmtCurrency(totalPaid), bold: true, green: totalPaid >= Number(cycle.expected_amount_per_period) * cycle.length_periods },
    { label: "Outstanding",     value: fmtCurrency(Math.max(0, Number(cycle.expected_amount_per_period) * cycle.length_periods - totalPaid)), red: true },
  ];
  if (commission.amount > 0) {
    totalsRows.push({ sep: true });
    totalsRows.push({ label: `Commission (${cycle.commission_model === "first_period" ? "Period 1" : `${cycle.commission_percent}%`})`, value: fmtCurrency(commission.amount), bold: true });
  }
  pdf.addTotalsBlock(totalsRows);

  await pdf.save(`contribution-card-${clientName.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContributionCard({
  cycle,
  contributions = [],
  frequency,
  clientName,
  businessName,
  onOpenCycle,
  onCloseCycle,
  onExecuteCommission,
  compact = false,
}) {
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [showPinForCommission, setShowPinForCommission] = useState(false);
  const [commissionExecuting, setCommissionExecuting] = useState(false);

  const freq = frequency || cycle?.frequency || cycle?.contribution_frequency || "monthly";
  const cols = COLS_BY_FREQ[freq] || 4;

  const periods = useMemo(
    () => (cycle ? buildPeriods({ ...cycle, frequency: freq }, contributions) : []),
    [cycle, contributions, freq]
  );

  const paidCount    = periods.filter((p) => p.status === "paid").length;
  const missedCount  = periods.filter((p) => p.status === "missed").length;
  const partialCount = periods.filter((p) => p.status === "partial").length;
  const totalPaid    = periods.reduce((s, p) => s + p.paid, 0);

  const commission        = useMemo(() => computeCommission(cycle, contributions), [cycle, contributions]);
  const commissionDone    = useMemo(() => commissionAlreadyExecuted(contributions), [contributions]);
  const canExecCommission = !compact && onExecuteCommission && cycle &&
    cycle.status !== "active" && commission.amount > 0 && !commissionDone;
  const totalExp     = cycle ? Number(cycle.expected_amount_per_period) * cycle.length_periods : 0;

  if (!cycle) {
    if (!onOpenCycle) return null;
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">No active cycle. Start one to track contributions.</p>
        <button
          onClick={() => onOpenCycle()}
          className="px-4 py-2 bg-brand-500 text-white text-sm font-semibold rounded-lg hover:bg-brand-600 transition-colors"
        >
          Open Cycle
        </button>
      </div>
    );
  }

  const handleExport = async () => {
    setExporting(true);
    try { await exportCardPdf({ cycle: { ...cycle, frequency: freq }, periods, contributions, clientName, businessName }); }
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

      {/* Stats strip */}
      <div className="px-4 pb-3 flex gap-4 text-[11px]">
        <span className="text-emerald-600 font-semibold">{paidCount} paid</span>
        {partialCount > 0 && <span className="text-amber-500 font-semibold">{partialCount} partial</span>}
        {missedCount > 0 && <span className="text-red-500 font-semibold">{missedCount} missed</span>}
        <span className="ml-auto text-slate-500 dark:text-slate-400">
          {fmtCurrency(totalPaid)} / {fmtCurrency(totalExp)}
        </span>
      </div>

      {/* Grid — CC-11: max-height + internal scroll for long cycles */}
      <div
        className="px-4 pb-4 grid gap-1.5 max-h-52 overflow-y-auto"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {periods.map((p) => (
          <button
            key={p.idx}
            onClick={() => setSelected(p)}
            className={`
              aspect-square rounded-lg flex flex-col items-center justify-center text-center
              text-[11px] font-bold transition-all active:scale-95
              ${MARK_CLS[p.status]}
              ${compact ? "text-[9px]" : ""}
            `}
            title={`Period ${p.idx + 1} · ${MARK_LABEL[p.status]}`}
          >
            <span className={compact ? "text-[10px]" : "text-base leading-none mb-0.5"}>{MARK_ICON[p.status]}</span>
            {!compact && <span className="text-[9px] opacity-75">#{p.idx + 1}</span>}
          </button>
        ))}
      </div>

      {/* Commission strip */}
      {!compact && commission.amount > 0 && (
        <div className="mx-4 mb-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 px-3 py-2.5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold text-brand-500 uppercase tracking-wide">Collector Commission</p>
            <p className="text-xs text-brand-600 dark:text-brand-300 mt-0.5">{commission.label}</p>
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
              <p className="font-bold text-slate-900 dark:text-white text-base">
                Period #{selected.idx + 1}
              </p>
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
                  selected.status === "paid" ? "text-emerald-600"
                  : selected.status === "missed" ? "text-red-500"
                  : selected.status === "partial" ? "text-amber-500"
                  : selected.status === "current" ? "text-brand-500"
                  : "text-slate-400"
                }`}>{MARK_LABEL[selected.status]}</span>
              </div>
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
              {selected.paid < Number(cycle.expected_amount_per_period) && (
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
