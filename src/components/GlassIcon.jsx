import { PATHS } from "./Icon";

/**
 * A glossy, iOS-style 3D icon tile: colour gradient body, glass highlight on the top half, soft inner edge and a
 * coloured drop shadow, with a white icon that casts its own little shadow.
 *
 *   <GlassIcon d="M12 5v14|M5 12h14" colors={["#60a5fa", "#2563eb"]} />   — `d` = path strings joined with "|"
 *   <GlassIcon name="wallet" colors={GLASS.brand} size={52} />             — or a name from components/Icon
 *
 * `variant="frost"` is a translucent white tile for dark hero cards.
 */
export const GLASS = {
  brand:  ["#6ee05a", "#2a8a1a"],
  green:  ["#4ade80", "#15803d"],
  blue:   ["#60a5fa", "#1d4ed8"],
  sky:    ["#38bdf8", "#0369a1"],
  red:    ["#fb7185", "#dc2626"],
  amber:  ["#fcd34d", "#d97706"],
  orange: ["#fdba74", "#ea580c"],
  violet: ["#a78bfa", "#6d28d9"],
  purple: ["#d8b4fe", "#9333ea"],
  pink:   ["#f9a8d4", "#db2777"],
  cyan:   ["#67e8f9", "#0e7490"],
  indigo: ["#a5b4fc", "#4338ca"],
  teal:   ["#5eead4", "#0f766e"],
  emerald:["#6ee7b7", "#047857"],
  rose:   ["#fda4af", "#e11d48"],
  slate:  ["#cbd5e1", "#475569"],
  navy:   ["#6d83c9", "#16255A"],
};

export default function GlassIcon({ d, name, colors = GLASS.brand, size = 56, iconSize, radius, strokeWidth = 2.1, variant = "solid", className = "", children }) {
  const [c1, c2] = colors;
  const r = radius ?? Math.round(size * 0.3);
  const is = iconSize ?? Math.round(size * 0.42);
  const paths = d ? d.split("|") : (PATHS[name] || "").split(" M").map((p, i) => (i === 0 ? p : "M" + p)).filter(Boolean);
  const frost = variant === "frost";
  return (
    <span
      className={`relative inline-flex items-center justify-center flex-none ${className}`}
      style={{
        width: size, height: size, borderRadius: r,
        background: frost ? "linear-gradient(160deg, rgba(255,255,255,.34), rgba(255,255,255,.10))" : `linear-gradient(150deg, ${c1} 0%, ${c2} 100%)`,
        boxShadow: frost
          ? "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 2px rgba(0,0,0,.15), 0 6px 14px -6px rgba(0,0,0,.45)"
          : `inset 0 1.5px 0 rgba(255,255,255,.55), inset 0 -3px 6px rgba(0,0,0,.18), 0 ${Math.round(size * 0.14)}px ${Math.round(size * 0.3)}px -${Math.round(size * 0.12)}px ${c2}b3, 0 1px 2px rgba(15,23,42,.12)`,
        backdropFilter: frost ? "blur(8px)" : undefined,
        border: frost ? "1px solid rgba(255,255,255,.25)" : undefined,
      }}
      aria-hidden="true"
    >
      {/* glass highlight — the top half catches the light */}
      <span className="pointer-events-none absolute inset-x-[6%] top-[4%] h-[48%]"
        style={{ borderRadius: `${r * 0.85}px ${r * 0.85}px ${r * 1.4}px ${r * 1.4}px / ${r * 0.85}px ${r * 0.85}px ${r * 0.6}px ${r * 0.6}px`,
          background: "linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,.12) 70%, rgba(255,255,255,0) 100%)" }} />
      {/* soft glow at the bottom edge */}
      {!frost && <span className="pointer-events-none absolute inset-x-[18%] bottom-[6%] h-[22%] rounded-full" style={{ background: `radial-gradient(closest-side, ${c1}88, transparent)` }} />}
      {children || (
        <svg width={is} height={is} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
          className="relative" style={{ filter: "drop-shadow(0 1.5px 1.2px rgba(0,0,0,.28))" }}>
          {paths.map((p, i) => <path key={i} d={p} />)}
        </svg>
      )}
    </span>
  );
}
