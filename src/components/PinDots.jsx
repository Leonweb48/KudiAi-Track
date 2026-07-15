/**
 * PinDots — shared PIN entry indicator for all three PIN contexts.
 * Filled dots consume var(--brand-green) via inline style.
 *
 * count      — total dot count (4 for txn/setup, 6 for OTP/app-lock)
 * filled     — number of filled dots (typically pin.length)
 * emptyClass — Tailwind classes for the unfilled ring;
 *              default suits light+dark surfaces; pass "border-white/20"
 *              when the component sits on a fixed-dark background
 * className  — applied to the outer flex row (e.g. shake animation class)
 */
export default function PinDots({
  count = 4,
  filled = 0,
  className = "",
  emptyClass = "border-slate-300 dark:border-slate-600",
}) {
  return (
    <div className={`flex justify-center gap-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => {
        const isFilled = filled > i;
        return (
          <div
            key={i}
            className={`rounded-full border-2 transition-all duration-150 ${
              count === 6 ? "w-3 h-3" : "w-4 h-4"
            } ${
              isFilled ? "scale-110" : `${emptyClass} bg-transparent`
            }`}
            style={isFilled ? {
              background: "var(--brand-green)",
              borderColor: "var(--brand-green)",
            } : undefined}
          />
        );
      })}
    </div>
  );
}
