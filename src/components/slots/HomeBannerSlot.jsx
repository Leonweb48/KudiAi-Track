import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import SlotMedia from "./SlotMedia";
import { slotNavigate } from "./useSlotNav";

const css = `
.hb-track::-webkit-scrollbar { display: none; }
.hb-track { -ms-overflow-style: none; scrollbar-width: none; }
@keyframes hbFade { from { opacity:0 } to { opacity:1 } }
.hb-fade { animation: hbFade 0.35s ease forwards; }
`;

export default function HomeBannerSlot({ campaigns = [], loading, recordEvent }) {
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);
  const trackRef = useRef(null);

  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const w = el.firstElementChild?.offsetWidth || el.offsetWidth;
    if (w > 0) setIdx(Math.round(el.scrollLeft / w));
  }, []);

  if (loading) {
    return (
      <div
        className="w-full mb-4 mx-0 rounded-2xl bg-slate-200 dark:bg-slate-700 animate-pulse"
        style={{ aspectRatio: "16/9" }}
      />
    );
  }
  if (!campaigns.length) return null;

  const onCTA = async (c) => {
    recordEvent(c.id, "click");
    await slotNavigate(c.cta_action_type, c.cta_action_value, navigate);
  };

  return (
    <div className="mb-4 -mx-4">
      <style>{css}</style>

      {/* Scroll track */}
      <div
        ref={trackRef}
        className="hb-track flex overflow-x-auto snap-x snap-mandatory"
        onScroll={handleScroll}
      >
        {campaigns.map((c, i) => (
          <div
            key={c.id}
            className="hb-fade flex-shrink-0 snap-start"
            style={{ width: "100%", paddingLeft: "1rem", paddingRight: "1rem" }}
            onPointerEnter={() => i === 0 && recordEvent(c.id, "impression")}
          >
            {/* Card — aspect-ratio lives here so absolutely-positioned children always fill it */}
            <div
              className="relative w-full rounded-2xl overflow-hidden"
              style={{ aspectRatio: "16/9" }}
            >
              {/* Background image */}
              <SlotMedia
                creative_url={c.creative_url}
                headline={c.headline}
                className="absolute inset-0 w-full h-full"
              />

              {/* Fallback background when no image */}
              {!c.creative_url && (
                <div
                  className="absolute inset-0"
                  style={{ background: "linear-gradient(135deg,#16255A,#3DA829)" }}
                />
              )}

              {/* Gradient overlay for text legibility */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

              {/* Text + CTA */}
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
                {c.headline && (
                  <p className="text-white font-bold text-sm leading-snug line-clamp-2 drop-shadow">
                    {c.headline}
                  </p>
                )}
                {c.body && (
                  <p className="text-white/80 text-xs mt-0.5 line-clamp-1 drop-shadow">
                    {c.body}
                  </p>
                )}
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

      {/* Dot indicators */}
      {campaigns.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {campaigns.map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all duration-300 ${
                i === idx
                  ? "w-4 h-1.5 bg-emerald-500"
                  : "w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
