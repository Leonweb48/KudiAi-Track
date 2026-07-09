// Slot: home_banner — 16:9 full-width swipeable carousel
// Zero layout shift: reserves aspect-ratio space while loading, collapses to 0 if empty
import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import SlotMedia from "./SlotMedia";
import { slotNavigate } from "./useSlotNav";

const bannerCSS = `
.hb-scroll::-webkit-scrollbar { display: none; }
.hb-scroll { -ms-overflow-style: none; scrollbar-width: none; }
@keyframes hbFadeIn { from { opacity:0 } to { opacity:1 } }
.hb-fadein { animation: hbFadeIn 0.4s ease forwards; }
`;

export default function HomeBannerSlot({ campaigns = [], loading, recordEvent }) {
  const navigate  = useNavigate();
  const [idx, setIdx] = useState(0);
  const scrollRef = useRef(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const w = el.children[0]?.offsetWidth || el.offsetWidth;
    setIdx(Math.round(el.scrollLeft / w));
  }, []);

  // Loading skeleton — reserves 16:9 space
  if (loading) {
    return (
      <div className="w-full mb-4 rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 animate-pulse"
           style={{ aspectRatio: "16/9" }} />
    );
  }
  // Empty — zero height, no layout shift
  if (!campaigns.length) return null;

  const onCTA = async (c) => {
    recordEvent(c.id, "click");
    await slotNavigate(c.cta_action_type, c.cta_action_value, navigate);
  };

  return (
    <div className="mb-4">
      <style>{bannerCSS}</style>
      <div
        ref={scrollRef}
        className="hb-scroll overflow-x-auto flex snap-x snap-mandatory -mx-4"
        onScroll={handleScroll}
      >
        {campaigns.map((c, i) => (
          <div
            key={c.id}
            className="flex-shrink-0 w-full snap-start hb-fadein"
            style={{ aspectRatio: "16/9", paddingLeft: i === 0 ? "1rem" : 0, paddingRight: "1rem" }}
            onPointerEnter={() => i === 0 && recordEvent(c.id, "impression")}
          >
            <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-card">
              <SlotMedia creative_url={c.creative_url} headline={c.headline} className="absolute inset-0 w-full h-full" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
                {c.headline && <p className="text-white font-bold text-sm leading-snug line-clamp-2 drop-shadow">{c.headline}</p>}
                {c.body     && <p className="text-white/80 text-xs mt-0.5 line-clamp-1 drop-shadow">{c.body}</p>}
                {c.cta_label && (
                  <button
                    onClick={() => onCTA(c)}
                    className="mt-2 px-4 py-1.5 rounded-xl text-xs font-bold text-white active:scale-95 transition-transform shadow"
                    style={{ background: "linear-gradient(135deg,#3DA829,#16255A)" }}
                  >
                    {c.cta_label}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {campaigns.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {campaigns.map((_, i) => (
            <span key={i} className={`block rounded-full transition-all ${i === idx ? "w-4 h-1.5 bg-emerald-500" : "w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600"}`} />
          ))}
        </div>
      )}
    </div>
  );
}
