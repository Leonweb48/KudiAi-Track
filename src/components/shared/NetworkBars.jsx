// A bank's "network strength" as signal bars, for the transfer screen and the bank picker (flutterwave `bank-network`:
// how that bank's name checks and our transfers to it went over the last 3 hours). good = 3 green, fair = 2 amber,
// poor = 1 red. Nothing at all for "unknown" (too few recent samples) — no bars is better than a made-up reading.
export const NETWORK_LABEL = { good: "Good network", fair: "Slow network", poor: "Poor network" };

export default function NetworkBars({ status, className = "" }) {
  if (!NETWORK_LABEL[status]) return null;
  const lit = status === "good" ? 3 : status === "fair" ? 2 : 1;
  const on = status === "good" ? "bg-emerald-500" : status === "fair" ? "bg-amber-500" : "bg-red-500";
  return (
    <span role="img" aria-label={NETWORK_LABEL[status]} title={NETWORK_LABEL[status]}
      className={`inline-flex items-end gap-[2px] h-3 flex-shrink-0 ${className}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-[3px] rounded-sm ${i <= lit ? on : "bg-slate-300 dark:bg-slate-600"}`}
          style={{ height: `${4 + i * 3}px` }} />
      ))}
    </span>
  );
}
