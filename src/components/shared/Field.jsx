/**
 * Reusable form field — input, select, or textarea.
 * Pass `as="select"` or `as="textarea"` to change type.
 */
export default function Field({ label, as, children, ...props }) {
  const base =
    "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 " +
    "focus:outline-none focus:ring-2 focus:ring-green-400";

  return (
    <div className="mb-3">
      {label && (
        <label className="block text-xs font-semibold text-gray-500 mb-1">
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
