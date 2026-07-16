const STATUS_COLORS = {
  // Invoice / loan lifecycle
  active:          "bg-blue-100   dark:bg-blue-900/30   text-blue-700   dark:text-blue-300",
  paid:            "bg-green-100  dark:bg-green-900/30  text-green-700  dark:text-green-300",
  partially_paid:  "bg-amber-100  dark:bg-amber-900/30  text-amber-700  dark:text-amber-300",
  overdue:         "bg-red-100    dark:bg-red-900/30    text-red-700    dark:text-red-300",
  // Payment / transaction results
  completed:       "bg-green-100  dark:bg-green-900/30  text-green-700  dark:text-green-300",
  approved:        "bg-green-100  dark:bg-green-900/30  text-green-700  dark:text-green-300",
  failed:          "bg-red-100    dark:bg-red-900/30    text-red-700    dark:text-red-300",
  // Rotation / Esusu slot statuses
  current:         "bg-brand-100  dark:bg-brand-900/50  text-brand-600  dark:text-brand-300",
  upcoming:        "bg-slate-100  dark:bg-slate-700     text-slate-500  dark:text-slate-300",
  skipped:         "bg-amber-100  dark:bg-amber-900/30  text-amber-700  dark:text-amber-300",
  // Approval workflow
  pending:         "bg-amber-100  dark:bg-amber-900/30  text-amber-700  dark:text-amber-300",
  rejected:        "bg-red-100    dark:bg-red-900/30    text-red-700    dark:text-red-300",
  expired:         "bg-slate-100  dark:bg-slate-700     text-slate-400  dark:text-slate-400",
};

export default function Badge({ status, label }) {
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
        STATUS_COLORS[status] || "bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300"
      }`}
    >
      {label ?? status?.replace(/_/g, " ")}
    </span>
  );
}
