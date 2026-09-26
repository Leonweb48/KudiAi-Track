/**
 * The two pieces every history row shares, OPay-style:
 *   <HistoryAvatar avatar={...} />  the round icon on the left — the bank's or provider's real logo (white disc, with a small
 *                                    arrow badge when it is a bank so you still see which way the money went), or a tinted
 *                                    circle with an icon (arrow up / down, bulb, phone, tv …) when there is no logo
 *   <StatusPill status={...} />     the small "Successful" / "Pending" / "Failed" tag under the amount
 *
 * `avatar` and `status` come from utils/historyEntries.js.
 */
import { useState } from "react";

// 24 x 24 stroke paths (feather-style), "|" separates sub-paths
const ICONS = {
  up:      "M12 19V5|M5 12l7-7 7 7",
  down:    "M12 5v14|M19 12l-7 7-7-7",
  bulb:    "M9 18h6|M10 22h4|M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z",
  phone:   "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z",
  tv:      "M4 3h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2z|M8 21h8|M12 17v4",
  wifi:    "M5 12.55a11 11 0 0114.08 0|M1.42 9a16 16 0 0121.16 0|M8.53 16.11a6 6 0 016.95 0|M12 20h.01",
  book:    "M4 19.5A2.5 2.5 0 016.5 17H20|M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z",
  bills:   "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8",
  percent: "M19 5L5 19|M6.5 6.5h.01|M17.5 17.5h.01",
  wallet:  "M20 12V8H6a2 2 0 010-4h12v4|M4 6v12a2 2 0 002 2h14v-4|M18 12a2 2 0 000 4h4v-4h-4z",
};

export function HistoryIcon({ name, size = 16, color = "currentColor", sw = 2.2 }) {
  const d = ICONS[name] || ICONS.bills;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const TINT = {
  ok:      "bg-emerald-50 dark:bg-emerald-900/25 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-50 dark:bg-amber-900/25 text-amber-600 dark:text-amber-400",
  failed:  "bg-red-50 dark:bg-red-900/25 text-red-500 dark:text-red-400",
  muted:   "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
};

export function HistoryAvatar({ avatar, size = 40 }) {
  const a = avatar || {};
  const [bad, setBad] = useState(null);
  const showLogo = !!a.logoUrl && bad !== a.logoUrl;
  const pad = Math.max(4, Math.round(size * 0.16));
  if (showLogo) {
    return (
      <span className="relative inline-flex flex-shrink-0" style={{ width: size, height: size }}>
        <span className="w-full h-full rounded-full bg-white border border-slate-200 dark:border-slate-600 overflow-hidden flex items-center justify-center" style={{ padding: pad }}>
          <img src={a.logoUrl} alt={a.name || ""} draggable={false}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
            onError={() => setBad(a.logoUrl)} />
        </span>
        {a.dir && (
          <span className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white dark:border-slate-800 flex items-center justify-center text-white ${a.dir === "in" ? "bg-emerald-500" : "bg-slate-600"}`}
            style={{ width: Math.round(size * 0.4), height: Math.round(size * 0.4) }}>
            <HistoryIcon name={a.dir === "in" ? "down" : "up"} size={Math.round(size * 0.24)} sw={3} />
          </span>
        )}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center justify-center rounded-full flex-shrink-0 ${TINT[a.tone] || TINT.ok}`} style={{ width: size, height: size }}>
      <HistoryIcon name={a.icon} size={Math.round(size * 0.42)} />
    </span>
  );
}

const PILL = {
  ok:      "bg-emerald-50 dark:bg-emerald-900/25 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-50 dark:bg-amber-900/25 text-amber-600 dark:text-amber-400",
  failed:  "bg-red-50 dark:bg-red-900/25 text-red-500 dark:text-red-400",
  muted:   "bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400",
};

export function StatusPill({ status, className = "" }) {
  if (!status) return null;
  return (
    <span className={`inline-block text-[10px] font-semibold leading-none px-1.5 py-1 rounded-md ${PILL[status.tone] || PILL.ok} ${className}`}>
      {status.label}
    </span>
  );
}
