/**
 * Reusable form field — input, select, or textarea. Full dark mode support.
 */
export default function Field({ label, as, children, ...props }) {
  const base =
    "w-full border border-slate-200 dark:border-slate-600 rounded-xl px-3.5 py-3 text-sm " +
    "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 " +
    "placeholder:text-slate-400 dark:placeholder:text-slate-500 " +
    "focus:outline-none focus:ring-2 focus:ring-brand-500 transition " +
    "disabled:opacity-50";

  return (
    <div className="mb-3">
      {label && (
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 tracking-wide uppercase">
          {label}
        </label>
      )}
      {as === "select" ? (
        <select className={base} {...props}>
          {children}
        </select>
      ) : as === "textarea" ? (
        <textarea className={`${base} resize-none`} rows={3} {...props} />
      ) : (
        <input className={base} {...props} />
      )}
    </div>
  );
}
