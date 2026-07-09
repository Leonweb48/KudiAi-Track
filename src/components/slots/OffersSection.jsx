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

function PartnerOfferCard({ offer, onEvent, ctaUrl }) {
  const [reported, setReported] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const isFeedCard = offer.slot === "feed_card";

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
          {partner.logo_url ? (
            <img src={partner.logo_url} alt={partner.name} className="w-5 h-5 rounded object-contain" />
          ) : (
            <div className="w-5 h-5 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
              <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          )}
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">{partner.name || "Partner"} · Partner offer</span>
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

      {/* Creative image if present */}
      {offer.creative_url && (
        <div className="w-full overflow-hidden" style={{ aspectRatio: isFeedCard ? "4/1" : "3/1", maxHeight: isFeedCard ? 120 : 140 }}>
          <img src={offer.creative_url} alt={offer.title} className="w-full h-full object-cover" loading="eager" />
        </div>
      )}

      {/* Content */}
      <div className="px-4 pt-3 pb-4">
        {/* User benefit badge */}
        {offer.user_benefit && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold mb-2"
                style={{ background: "#3DA82915", color: "#3DA829" }}>
            {offer.user_benefit}
          </span>
        )}
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-snug mb-1">{offer.title}</h3>
        {offer.body && (
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed mb-3">{offer.body}</p>
        )}

        {/* CTA row */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCTA}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white active:scale-[0.98] transition-transform"
            style={{ background: "linear-gradient(135deg,#3DA829,#16255A)" }}>
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

        {/* Mandatory disclosure */}
        <p className="text-[9px] text-slate-300 dark:text-slate-600 mt-2 leading-relaxed">
          {offer.disclosure_text || "Partner offer · KudiAI Track may earn a commission"}
        </p>
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
