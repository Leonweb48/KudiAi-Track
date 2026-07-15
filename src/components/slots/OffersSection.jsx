// Slot: offers_section — curated partner offers, per-portal.
// Each offer shows: partner identity, user benefit, disclosure, CTA, report button.
// Max one partner surface per session on client portals (enforced by maxPerSession prop).
import { useState, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";

async function openUrl(url) {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function CreativeMedia({ offer }) {
  const isFeedCard = offer.slot === "feed_card";
  const ratio = isFeedCard ? "4/1" : "3/1";
  const maxH  = isFeedCard ? 120 : 160;
  const type  = offer.creative_type || (offer.creative_url ? "image" : "none");

  // Carousel: creative_urls is an array of image URLs
  const [carIdx, setCarIdx] = useState(0);
  const carUrls = offer.creative_urls?.length ? offer.creative_urls : null;

  if (type === "video" && offer.creative_url) {
    return (
      <div className="w-full overflow-hidden" style={{ aspectRatio: ratio, maxHeight: maxH }}>
        <video
          src={offer.creative_url}
          className="w-full h-full object-cover"
          autoPlay muted loop playsInline
        />
      </div>
    );
  }

  if (type === "carousel" && carUrls) {
    return (
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: ratio, maxHeight: maxH }}>
        <img src={carUrls[carIdx]} alt={offer.title} className="w-full h-full object-cover" />
        {carUrls.length > 1 && (
          <>
            <button
              onClick={e => { e.stopPropagation(); setCarIdx(i => (i - 1 + carUrls.length) % carUrls.length); }}
              className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center text-white text-[10px]">‹</button>
            <button
              onClick={e => { e.stopPropagation(); setCarIdx(i => (i + 1) % carUrls.length); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center text-white text-[10px]">›</button>
            <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
              {carUrls.map((_, i) => (
                <span key={i} className={`block rounded-full transition-all ${i === carIdx ? "w-3 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/50"}`} />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (offer.creative_url) {
    return (
      <div className="w-full overflow-hidden" style={{ aspectRatio: ratio, maxHeight: maxH }}>
        <img src={offer.creative_url} alt={offer.title} className="w-full h-full object-cover" loading="eager" />
      </div>
    );
  }

  return null;
}

function PartnerOfferCard({ offer, onEvent, ctaUrl }) {
  const [reported, setReported] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    onEvent(offer.id, "impression");
  }, [offer.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCTA = useCallback(async () => {
    onEvent(offer.id, "click");
    await openUrl(ctaUrl(offer));
  }, [offer, ctaUrl, onEvent]);

  const handleDismiss = useCallback(() => {
    onEvent(offer.id, "dismiss");
    setDismissed(true);
  }, [offer.id, onEvent]);

  const handleReport = useCallback(() => {
    if (reported) return;
    onEvent(offer.id, "report");
    setReported(true);
  }, [offer.id, onEvent, reported]);

  if (dismissed) return null;

  const partner = offer.partner ?? {};

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50 overflow-hidden shadow-sm mb-3">
      {/* Partner label bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center gap-2">
          {partner.logo_url && (
            <img src={partner.logo_url} alt={partner.name} className="w-5 h-5 rounded object-contain" />
          )}
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Partner offer</span>
        </div>
        <button
          onClick={handleDismiss}
          className="text-slate-300 dark:text-slate-600 hover:text-slate-500 transition-colors p-1"
          aria-label="Dismiss offer">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <CreativeMedia offer={offer} />

      {/* Content */}
      <div className="px-4 pt-3 pb-4">
        {offer.user_benefit && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold mb-2 bg-[#3DA82915] text-[#3DA829]">
            {offer.user_benefit}
          </span>
        )}
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-snug mb-1">{offer.title}</h3>
        {offer.body && (
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed mb-3">{offer.body}</p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleCTA}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white active:scale-[0.98] transition-transform bg-[linear-gradient(135deg,#3DA829,#16255A)]">
            {offer.cta_label || "Learn More"}
          </button>
          <button
            onClick={handleReport}
            disabled={reported}
            className="py-2.5 px-3 rounded-xl text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700/60 active:scale-[0.98] transition disabled:opacity-50"
            title="Report this offer">
            {reported ? "Reported" : "Report"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OffersSection({ offers = [], loading, recordEvent, ctaUrl, title = "Offers for You", maxShown }) {
  const visible = maxShown ? offers.slice(0, maxShown) : offers;

  if (loading) {
    return (
      <div className="px-4 pb-4">
        <div className="h-4 w-28 bg-slate-100 dark:bg-slate-700 rounded animate-pulse mb-3" />
        <div className="h-36 bg-slate-100 dark:bg-slate-700/60 rounded-2xl animate-pulse" />
      </div>
    );
  }
  if (!visible.length) return null;

  return (
    <div className="px-4 pb-4">
      <h2 className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">{title}</h2>
      {visible.map(offer => (
        <PartnerOfferCard key={offer.id} offer={offer} onEvent={recordEvent} ctaUrl={ctaUrl} />
      ))}
    </div>
  );
}
