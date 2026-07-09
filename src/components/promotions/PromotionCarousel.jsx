import { useState, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import PromotionMedia from "./PromotionMedia";

const carouselCSS = `
.promo-carousel::-webkit-scrollbar { display: none; }
.promo-carousel { -ms-overflow-style: none; scrollbar-width: none; }
`;

async function openURL(url, type) {
  if (!url) return;
  if (type === "internal") {
    window.dispatchEvent(new CustomEvent("promoNavigate", { detail: { path: url } }));
    return;
  }
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export default function PromotionCarousel({ carouselItems, markSeen, title = "Offers for You" }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef(null);

  if (!carouselItems.length) return null;

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const cardW = el.children[0]?.offsetWidth || 256;
    const idx = Math.round(el.scrollLeft / (cardW + 12));
    setActiveIdx(Math.max(0, Math.min(idx, carouselItems.length - 1)));
  };

  return (
    <div className="mb-4">
      <style>{carouselCSS}</style>

      {/* Section header */}
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          {title}
        </p>
        {carouselItems.length > 1 && (
          <div className="flex items-center gap-1">
            {carouselItems.map((_, i) => (
              <span
                key={i}
                className={`block rounded-full transition-all ${
                  i === activeIdx
                    ? "w-4 h-1.5 bg-emerald-500"
                    : "w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Horizontal scroll */}
      <div
        ref={scrollRef}
        className="promo-carousel overflow-x-auto flex gap-3 -mx-4 px-4 pb-1"
        onScroll={handleScroll}
      >
        {carouselItems.map((promo) => (
          <div
            key={promo.id}
            className="flex-shrink-0 w-64 bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-card border border-slate-100 dark:border-slate-700/50"
          >
            {/* Media — 16:9 */}
            <button
              onClick={() => openURL(promo.cta_url, promo.cta_type)}
              className="relative w-full block active:opacity-90 transition-opacity"
              style={{ aspectRatio: "16/9" }}
            >
              <PromotionMedia
                promo={promo}
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "cover" }}
              />
              {/* Subtle gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            </button>

            {/* Card content */}
            <div className="px-3 pt-2.5 pb-3">
              {promo.title && (
                <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 leading-snug line-clamp-1">
                  {promo.title}
                </p>
              )}
              {promo.description && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug line-clamp-2">
                  {promo.description}
                </p>
              )}

              {promo.cta_label && (
                <button
                  onClick={() => {
                    markSeen(promo.id, promo.display_freq);
                    openURL(promo.cta_url, promo.cta_type);
                  }}
                  className="mt-2.5 w-full py-2 rounded-xl font-bold text-xs text-white active:scale-95 transition-transform"
                  style={{ background: "linear-gradient(135deg,#059669,#047857)" }}
                >
                  {promo.cta_label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
