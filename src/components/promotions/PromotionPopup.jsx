import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import PromotionMedia from "./PromotionMedia";

const slideUpCSS = `
@keyframes promoSlideUp   { from { transform: translateY(100%) } to { transform: translateY(0) } }
@keyframes promoSlideDown { from { transform: translateY(0) }    to { transform: translateY(100%) } }
@keyframes promoFadeIn    { from { opacity: 0 } to { opacity: 1 } }
@keyframes promoFadeOut   { from { opacity: 1 } to { opacity: 0 } }
.promo-popup-enter  { animation: promoSlideUp 0.38s cubic-bezier(.32,.72,0,1) forwards; }
.promo-popup-exit   { animation: promoSlideDown 0.3s ease-in forwards; }
.promo-backdrop-in  { animation: promoFadeIn  0.3s ease forwards; }
.promo-backdrop-out { animation: promoFadeOut 0.25s ease forwards; }
`;

async function openURL(url, type) {
  if (!url) return;
  if (type === "internal") {
    // Dispatch a custom event so App.jsx or any listener can navigate
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

export default function PromotionPopup({ popups, markSeen }) {
  const [index,      setIndex]      = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const [visible,    setVisible]    = useState(false);

  const promo = popups[index] ?? null;

  // Delay appearance by 1.2s so the page content loads first
  useEffect(() => {
    if (!promo) return;
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, [promo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!promo || !visible) return null;

  const dismiss = () => {
    setDismissing(true);
    setTimeout(() => {
      markSeen(promo.id, promo.display_freq);
      setDismissing(false);
      setVisible(false);
      // Show next popup if any
      if (index + 1 < popups.length) {
        setIndex(i => i + 1);
        setTimeout(() => setVisible(true), 400);
      }
    }, 300);
  };

  const handleCTA = async () => {
    dismiss();
    await openURL(promo.cta_url, promo.cta_type);
  };

  return (
    <>
      <style>{slideUpCSS}</style>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[78] bg-black/60 ${dismissing ? "promo-backdrop-out" : "promo-backdrop-in"}`}
        onClick={dismiss}
      />
      {/* Sheet */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-[79] max-w-md mx-auto ${dismissing ? "promo-popup-exit" : "promo-popup-enter"}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="bg-white dark:bg-slate-900 rounded-t-3xl overflow-hidden shadow-2xl">

          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-700 rounded-full" />
          </div>

          {/* Close button */}
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/30 flex items-center justify-center"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Media — 16:9 */}
          <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
            <PromotionMedia
              promo={promo}
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: "cover" }}
            />
            {/* Gradient overlay for text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          </div>

          {/* Content */}
          <div className="px-5 pt-4 pb-5">
            {promo.title && (
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight mb-1">
                {promo.title}
              </h2>
            )}
            {promo.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                {promo.description}
              </p>
            )}
            <div className="flex gap-2.5">
              {promo.cta_label && (
                <button
                  onClick={handleCTA}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm text-white active:scale-95 transition-transform shadow-sm"
                  style={{ background: "linear-gradient(135deg,#059669,#047857)" }}
                >
                  {promo.cta_label}
                </button>
              )}
              <button
                onClick={dismiss}
                className="py-3 px-4 rounded-2xl font-semibold text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 active:scale-95 transition-transform"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
