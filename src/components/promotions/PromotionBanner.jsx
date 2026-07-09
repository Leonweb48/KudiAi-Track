import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import PromotionMedia from "./PromotionMedia";

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

function SingleBanner({ promo, onDismiss }) {
  const [hiding, setHiding] = useState(false);

  const dismiss = () => {
    setHiding(true);
    setTimeout(onDismiss, 250);
  };

  return (
    <div
      className="rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700/50 shadow-sm bg-white dark:bg-slate-800 flex items-stretch mb-3 transition-all"
      style={{ opacity: hiding ? 0 : 1, transform: hiding ? "scaleY(0.9)" : "scaleY(1)", transformOrigin: "top" }}
    >
      {/* Thumbnail */}
      <button
        onClick={() => openURL(promo.cta_url, promo.cta_type)}
        className="relative w-[88px] flex-shrink-0 overflow-hidden active:opacity-80 transition-opacity"
      >
        <PromotionMedia
          promo={promo}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: "cover" }}
        />
      </button>

      {/* Content */}
      <button
        onClick={() => openURL(promo.cta_url, promo.cta_type)}
        className="flex-1 min-w-0 px-3 py-3 text-left active:bg-slate-50 dark:active:bg-slate-700/50 transition-colors"
      >
        {promo.title && (
          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 leading-snug truncate">
            {promo.title}
          </p>
        )}
        {promo.description && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug line-clamp-2">
            {promo.description}
          </p>
        )}
        {promo.cta_label && (
          <span className="inline-block mt-1.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
            {promo.cta_label} →
          </span>
        )}
      </button>

      {/* Dismiss */}
      <button
        onClick={dismiss}
        className="flex-shrink-0 px-3 flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function PromotionBanner({ banners, markSeen }) {
  const [dismissed, setDismissed] = useState(new Set());

  const visible = banners.filter(p => !dismissed.has(p.id));
  if (!visible.length) return null;

  const handleDismiss = (promo) => {
    setDismissed(prev => new Set([...prev, promo.id]));
    markSeen(promo.id, promo.display_freq);
  };

  return (
    <div className="mb-1">
      {visible.map(promo => (
        <SingleBanner
          key={promo.id}
          promo={promo}
          onDismiss={() => handleDismiss(promo)}
        />
      ))}
    </div>
  );
}
