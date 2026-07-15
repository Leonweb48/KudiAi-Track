// Slot: popup — 4:5 creative, dismissible overlay, server-side frequency cap
// Never renders over security/consent/PIN/payment UI — those gate at App.jsx level
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SlotMedia from "./SlotMedia";
import { slotNavigate } from "./useSlotNav";

const popupCSS = `
@keyframes popSlideUp   { from { transform:translateY(100%) } to { transform:translateY(0) } }
@keyframes popSlideDown { from { transform:translateY(0) }    to { transform:translateY(100%) } }
@keyframes popFadeIn    { from { opacity:0 } to { opacity:1 } }
@keyframes popFadeOut   { from { opacity:1 } to { opacity:0 } }
.popup-enter  { animation: popSlideUp   0.38s cubic-bezier(.32,.72,0,1) forwards; }
.popup-exit   { animation: popSlideDown 0.3s  ease-in forwards; }
.popbg-in     { animation: popFadeIn    0.3s  ease forwards; }
.popbg-out    { animation: popFadeOut   0.25s ease forwards; }
`;

export default function PopupSlot({ campaigns = [], loading, recordEvent }) {
  const navigate    = useNavigate();
  const [idx,       setIdx]       = useState(0);
  const [dismissing,setDismissing]= useState(false);
  const [visible,   setVisible]   = useState(false);

  const promo = campaigns[idx] ?? null;

  useEffect(() => {
    if (!promo) return;
    recordEvent(promo.id, "impression");
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, [promo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !promo || !visible) return null;

  const dismiss = () => {
    setDismissing(true);
    recordEvent(promo.id, "dismiss");
    setTimeout(() => {
      setDismissing(false);
      setVisible(false);
      if (idx + 1 < campaigns.length) {
        setIdx(i => i + 1);
        setTimeout(() => setVisible(true), 400);
      }
    }, 300);
  };

  const onCTA = async () => {
    dismiss();
    recordEvent(promo.id, "click");
    await slotNavigate(promo.cta_action_type, promo.cta_action_value, navigate);
  };

  return (
    <>
      <style>{popupCSS}</style>
      <div
        className={`fixed inset-0 z-[78] bg-black/60 ${dismissing ? "popbg-out" : "popbg-in"}`}
        onClick={dismiss}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-[79] max-w-md mx-auto ${dismissing ? "popup-exit" : "popup-enter"}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="bg-white dark:bg-slate-900 rounded-t-3xl overflow-hidden shadow-2xl">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-700 rounded-full" />
          </div>
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/30 flex items-center justify-center"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* 4:5 creative */}
          {promo.creative_url && (
            <div className="relative w-full" style={{ aspectRatio: "4/5", maxHeight: "55dvh", overflow: "hidden" }}>
              <SlotMedia creative_url={promo.creative_url} headline={promo.headline} className="absolute inset-0 w-full h-full" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            </div>
          )}
          <div className="px-5 pt-4 pb-5">
            {promo.headline && (
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight mb-1">
                {promo.headline}
              </h2>
            )}
            {promo.body && (
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-4">{promo.body}</p>
            )}
            <div className="flex gap-2.5">
              {promo.cta_label && (
                <button
                  onClick={onCTA}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm text-white active:scale-95 transition-transform shadow-sm bg-[linear-gradient(135deg,#3DA829,#16255A)]"
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
