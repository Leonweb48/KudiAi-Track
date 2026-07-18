// Reusable period-filter chip row with optional custom date range.
// Props: period, setPeriod, dateFrom, setDateFrom, dateTo, setDateTo
const CHIPS = [
  { id: "all",    label: "All" },
  { id: "today",  label: "Today" },
  { id: "week",   label: "This week" },
  { id: "month",  label: "This month" },
  { id: "custom", label: "Custom" },
];

export default function PeriodFilter({ period, setPeriod, dateFrom, setDateFrom, dateTo, setDateTo, className = "" }) {
  return (
    <div className={className}>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {CHIPS.map(c => (
          <button
            key={c.id}
            onClick={() => setPeriod(c.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all active:scale-95 ${
              period === c.id
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
            }`}>
            {c.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex gap-2 mt-2 items-center">
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="flex-1 text-[11px] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <span className="text-slate-400 text-xs flex-shrink-0">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="flex-1 text-[11px] px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      )}
    </div>
  );
}
