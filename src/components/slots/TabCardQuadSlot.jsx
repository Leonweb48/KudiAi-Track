import { useEffect } from "react";
import { isWhitelistedDeeplink } from "./SlotRegistry";

// Tab Card Quad — exactly 4 compact tiles (icon 1:1, label, per-tile CTA).
// Matches Quick Services visual language: rounded tiles, themed icons.
// Does NOT render if tiles.length < 4 (partial rows never show).
// Collapses with zero layout shift when campaign is removed.

export default function TabCardQuadSlot({ campaign, pageKey, recordEvent, navigate }) {
  const tiles = campaign?.tiles;
  if (!tiles || tiles.length < 4) return null;

  useEffect(() => {
    recordEvent?.(campaign.id, "impression", { pageKey });
  }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = (tile, index) => {
    recordEvent?.(campaign.id, "click", { pageKey, tileIndex: index });
    const { cta_action_type: type, cta_action_value: value } = tile;
    if (type === "deeplink" && value && isWhitelistedDeeplink(value)) {
      navigate?.(value);
    } else if (type === "external_url" && value) {
      try { window.open(value, "_blank", "noopener,noreferrer"); } catch {}
    }
  };

  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.slice(0, 4).map((tile, i) => (
        <button
          key={i}
          onClick={() => handleClick(tile, i)}
          className="flex flex-col items-center gap-2 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700/50 active:scale-90 transition-transform duration-150"
        >
          <div className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center bg-emerald-100 dark:bg-emerald-900/30 flex-shrink-0">
            {tile.icon_url ? (
              <img
                src={tile.icon_url}
                alt={tile.label || ""}
                className="w-full h-full object-cover"
                style={{ aspectRatio: "1/1" }}
              />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            )}
          </div>
          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 text-center leading-tight line-clamp-1 w-full">
            {(tile.label || "").slice(0, 14)}
          </span>
        </button>
      ))}
    </div>
  );
}
