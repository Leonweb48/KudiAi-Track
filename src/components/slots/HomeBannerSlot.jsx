// Slot: home_banner — 16:9 swipeable carousel in the normal page flow (never covers anything).
// Media: anything CampaignMedia plays (photo, GIF, video, Lottie animation, YouTube picture). Slides turn by themselves
// every 7 s while the carousel is on screen, and stop for a while once the user touches it. A view is counted per slide
// when it is at least half visible for a second (it used to be counted on mouse-hover, which phones never send).
import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import CampaignMedia from "./CampaignMedia";
import { slotNavigate } from "./useSlotNav";
import { useImpression, useInView, usePageVisible } from "../../hooks/useInView";

const css = `
.hb-track::-webkit-scrollbar { display: none; }
.hb-track { -ms-overflow-style: none; scrollbar-width: none; }
`;
const ROTATE_MS = 7000;
const TOUCH_PAUSE_MS = 12000;
const Fallback = () => <div className="absolute inset-0 bg-[linear-gradient(135deg,#16255A,#3DA829)]" />;

function Slide({ c, index, recordEvent, onCTA }) {
  const ref = useRef(null);
  useImpression(ref, () => recordEvent(c.id, "impression", { tileIndex: index }));
  const tappable = !!c.cta_action_value;
  return (
    <div ref={ref} className="flex-shrink-0 snap-start" style={{ width: "100%", paddingLeft: "1rem", paddingRight: "1rem" }}>
      <div
        role={tappable ? "button" : undefined}
        tabIndex={tappable ? 0 : undefined}
        onClick={tappable ? () => onCTA(c) : undefined}
        onKeyDown={tappable ? (e) => { if (e.key === "Enter") onCTA(c); } : undefined}
        className={`relative w-full rounded-2xl overflow-hidden bg-slate-200 dark:bg-slate-700 ${tappable ? "cursor-pointer active:scale-[0.99] transition-transform" : ""}`}
        style={{ aspectRatio: "16/9" }}
      >
        <CampaignMedia url={c.creative_url} media_type={c.media_type} poster_url={c.poster_url} alt={c.headline || ""} fallback={<Fallback />} />
        {(c.headline || c.body || c.cta_label) && (
          <>
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 pointer-events-none">
              {c.headline && <p className="text-white font-bold text-sm leading-snug line-clamp-2 drop-shadow">{c.headline}</p>}
              {c.body && <p className="text-white/80 text-xs mt-0.5 line-clamp-1 drop-shadow">{c.body}</p>}
              {c.cta_label && (
                <span className="inline-block mt-2 px-4 py-1.5 rounded-xl text-xs font-bold text-white shadow bg-[linear-gradient(135deg,#3DA829,#16255A)]">
                  {c.cta_label}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function HomeBannerSlot({ campaigns = [], loading, recordEvent }) {
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);
  const trackRef = useRef(null);
  const wrapRef = useRef(null);
  const touchedAt = useRef(0);
  const inView = useInView(wrapRef, { threshold: 0.5 });
  const pageVisible = usePageVisible();

  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const w = el.firstElementChild?.offsetWidth || el.offsetWidth;
    if (w > 0) setIdx(Math.round(el.scrollLeft / w));
  }, []);

  const goTo = useCallback((i) => {
    const el = trackRef.current;
    if (!el) return;
    const w = el.firstElementChild?.offsetWidth || el.offsetWidth;
    el.scrollTo({ left: i * w, behavior: "smooth" });
  }, []);

  const count = campaigns.length;
  useEffect(() => {
    if (count < 2 || !inView || !pageVisible) return undefined;
    const t = setInterval(() => {
      if (Date.now() - touchedAt.current < TOUCH_PAUSE_MS) return;
      goTo((idx + 1) % count);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [count, idx, inView, pageVisible, goTo]);

  // No grey placeholder while loading: on a screen with no banners it would flash and push the page around. Cached
  // banners (useCampaigns keeps the last list) show at once; brand-new ones appear when they arrive.
  if (loading || !count) return null;

  const onCTA = async (c) => {
    recordEvent(c.id, "click");
    await slotNavigate(c.cta_action_type, c.cta_action_value, navigate);
  };

  return (
    <div ref={wrapRef} className="mb-4 -mx-4" aria-roledescription="carousel">
      <style>{css}</style>
      <div
        ref={trackRef}
        className="hb-track flex overflow-x-auto snap-x snap-mandatory"
        onScroll={handleScroll}
        onPointerDown={() => { touchedAt.current = Date.now(); }}
        onTouchStart={() => { touchedAt.current = Date.now(); }}
      >
        {campaigns.map((c, i) => <Slide key={c.id} c={c} index={i} recordEvent={recordEvent} onCTA={onCTA} />)}
      </div>
      {count > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {campaigns.map((c, i) => (
            <button key={c.id} type="button" aria-label={`Show banner ${i + 1}`}
              onClick={() => { touchedAt.current = Date.now(); goTo(i); }}
              className="p-1 -m-1">
              <span className={`block rounded-full transition-all duration-300 ${i === idx ? "w-4 h-1.5 bg-emerald-500" : "w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600"}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
