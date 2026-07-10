import { useEffect } from "react";
import { isWhitelistedDeeplink } from "./SlotRegistry";

// Tab Card Duo — exactly 2 wider cards (4:3 image, headline, optional subtext, per-card CTA).
// Does NOT render if tiles.length < 2.

export default function TabCardDuoSlot({ campaign, pageKey, recordEvent, navigate }) {
  const tiles = campaign?.tiles;
  const valid = !!(tiles && tiles.length >= 2);

  useEffect(() => {
    if (valid) recordEvent?.(campaign?.id, "impression", { pageKey });
  }, [campaign?.id, valid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!valid) return null;

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
    <div className="grid grid-cols-2 gap-3">
      {tiles.slice(0, 2).map((tile, i) => (
        <button
          key={i}
          onClick={() => handleClick(tile, i)}
          className="flex flex-col rounded-2xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 shadow-sm active:scale-95 transition-transform duration-150 text-left"
        >
          {/* 4:3 image */}
          <div className="w-full bg-slate-100 dark:bg-slate-700" style={{ aspectRatio: "4/3" }}>
            {tile.image_url ? (
              <img
                src={tile.image_url}
                alt={tile.headline || ""}
                className="w-full h-full object-cover"
                style={{ aspectRatio: "4/3" }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                  stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
            )}
          </div>
          {/* Text */}
          <div className="px-3 py-2.5">
            <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug">
              {tile.headline || ""}
            </p>
            {tile.subtext && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                {tile.subtext}
              </p>
            )}
            {tile.cta_label && (
              <p className="text-[10px] font-bold text-brand-600 dark:text-brand-400 mt-1.5">
                {tile.cta_label} →
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
