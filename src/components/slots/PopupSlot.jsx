// Slot: popup — a bottom sheet with a 4:5 creative (photo / GIF / video / Lottie / YouTube). Rules that keep it out of
// the way (2026-10-02 upgrade; campaignRules.js, tested):
//   • the admin's frequency cap is honoured: "always" = once per app session, "once_per_day", "once_ever"
//   • at most ONE pop-up per app session, whichever campaign
//   • waits 4 s after the screen opens, and never appears while another sheet / dialog / PIN / payment screen is open or
//     the app is in the background — it keeps checking for up to a minute, then gives up for this visit
//   • tap outside, "Not now", the ✕ or a swipe down closes it
// Only mounted on Home screens; client portals never get it (SlotRegistry).
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import CampaignMedia from "./CampaignMedia";
import { slotNavigate } from "./useSlotNav";
import { mediaKindOf, pickPopup, popupStore } from "../../utils/campaignRules";

const popupCSS = `
@keyframes popSlideUp   { from { transform:translateY(100%) } to { transform:translateY(0) } }
@keyframes popFadeIn    { from { opacity:0 } to { opacity:1 } }
.popup-enter  { animation: popSlideUp 0.38s cubic-bezier(.32,.72,0,1) forwards; }
.popbg-in     { animation: popFadeIn  0.3s ease forwards; }
`;
const FIRST_DELAY_MS = 4000;
const RETRY_MS = 3000;
const GIVE_UP_MS = 60000;

// Something else already has the user's attention: an open dialog / sheet / PIN pad, or the app isn't in front.
function screenBusy() {
  if (typeof document === "undefined") return true;
  if (document.visibilityState === "hidden") return true;
  return !!document.querySelector('[aria-modal="true"], [role="dialog"], [role="alertdialog"]');
}

export default function PopupSlot({ campaigns = [], loading, recordEvent }) {
  const navigate = useNavigate();
  const [promo, setPromo] = useState(null);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const [muted, setMuted] = useState(true);
  const [ytPlaying, setYtPlaying] = useState(false);
  const dragStart = useRef(null);
  const ids = campaigns.map((c) => c.id).join(",");

  useEffect(() => {
    if (loading || !campaigns.length) return undefined;
    const started = Date.now();
    let timer = null;
    const attempt = () => {
      const pick = pickPopup(campaigns);
      if (!pick) return;                                   // capped, or a pop-up already showed this session
      if (screenBusy()) {
        if (Date.now() - started < GIVE_UP_MS) timer = setTimeout(attempt, RETRY_MS);
        return;
      }
      popupStore.markShown(pick.id);
      recordEvent(pick.id, "impression");
      setPromo(pick);
    };
    timer = setTimeout(attempt, FIRST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!promo) return null;
  const kind = mediaKindOf({ media_type: promo.media_type, url: promo.creative_url });
  const hasSound = kind === "video" || kind === "youtube";

  const close = (track = true) => {
    if (closing) return;
    if (track) recordEvent(promo.id, "dismiss");
    setClosing(true);
    setTimeout(() => { setPromo(null); setClosing(false); setDrag(0); setYtPlaying(false); }, 260);
  };
  const onCTA = async () => {
    recordEvent(promo.id, "click");
    close(false);
    await slotNavigate(promo.cta_action_type, promo.cta_action_value, navigate);
  };
  const onPointerDown = (e) => { dragStart.current = e.clientY; };
  const onPointerMove = (e) => { if (dragStart.current != null) setDrag(Math.max(0, e.clientY - dragStart.current)); };
  const onPointerUp = () => { if (drag > 90) close(); else setDrag(0); dragStart.current = null; };

  return (
    <>
      <style>{popupCSS}</style>
      <div className="fixed inset-0 z-[78] bg-black/60 popbg-in transition-opacity duration-200"
        style={{ opacity: closing ? 0 : 1 }} onClick={() => close()} />
      <div
        role="dialog" aria-modal="true" aria-label={promo.headline || "Offer"}
        className="fixed bottom-0 left-0 right-0 z-[79] max-w-md mx-auto popup-enter"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          transform: closing ? "translateY(100%)" : `translateY(${drag}px)`,
          transition: dragStart.current != null ? "none" : "transform 0.26s ease-in",
        }}
      >
        <div className="relative bg-white dark:bg-slate-900 rounded-t-3xl overflow-hidden shadow-2xl">
          <div className="flex justify-center pt-3 pb-1 touch-none cursor-grab"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-700 rounded-full" />
          </div>
          <button onClick={() => close()} aria-label="Close"
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {promo.creative_url && (
            <div className="relative w-full bg-slate-900" style={{ aspectRatio: "4/5", maxHeight: "55dvh" }}
              onClick={kind === "youtube" && !ytPlaying ? () => { setYtPlaying(true); recordEvent(promo.id, "view_start"); } : undefined}>
              <CampaignMedia
                url={promo.creative_url} media_type={promo.media_type} poster_url={promo.poster_url} alt={promo.headline || ""}
                mode="fullscreen" playing={kind === "youtube" ? ytPlaying : !closing} muted={muted} loop
                fallback={<div className="absolute inset-0 bg-[linear-gradient(135deg,#16255A,#3DA829)]" />}
              />
              {hasSound && (kind !== "youtube" || ytPlaying) && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
                  aria-label={muted ? "Turn sound on" : "Turn sound off"}
                  className="absolute bottom-3 right-3 z-10 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white">
                  {muted
                    ? <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" /></svg>
                    : <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>}
                </button>
              )}
            </div>
          )}
          <div className="px-5 pt-4 pb-5">
            {promo.headline && <h2 className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight mb-1">{promo.headline}</h2>}
            {promo.body && <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-4">{promo.body}</p>}
            <div className="flex gap-2.5">
              {promo.cta_label && (
                <button onClick={onCTA}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm text-white active:scale-95 transition-transform shadow-sm bg-[linear-gradient(135deg,#3DA829,#16255A)]">
                  {promo.cta_label}
                </button>
              )}
              <button onClick={() => close()}
                className="py-3 px-4 rounded-2xl font-semibold text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 active:scale-95 transition-transform">
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
