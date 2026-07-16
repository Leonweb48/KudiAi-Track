/**
 * Reusable form field — input, select, textarea, or custom children. Full dark mode support.
 */
export default function Field({
  label,
  as,
  hint,
  required,
  children,
  className = "",
  ...props
}) {
  const base =
    "w-full border rounded-xl px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-white " +
    "border-slate-200 dark:border-slate-600 placeholder-slate-400 " +
    "focus:outline-none focus:ring-2 focus:ring-brand-500/40 transition";

  let control;
  if (as === "select") {
    control = <select className={base} {...props}>{children}</select>;
  } else if (as === "textarea") {
    control = <textarea className={`${base} resize-none`} rows={3} {...props} />;
  } else if (children) {
    control = children;
  } else {
    control = <input className={base} {...props} />;
  }

  return (
    <div className={`mb-3 ${className}`}>
      {label && (
        <label className="block mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide uppercase">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      )}
      {control}
      {hint && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>
      )}
    </div>
  );
}
