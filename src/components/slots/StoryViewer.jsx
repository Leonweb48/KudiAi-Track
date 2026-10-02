// Full-screen story viewer (slot: stories) — opened only when the user taps a story, so it never interrupts.
//   • progress bars per frame; a photo / GIF stays 5 s (or the admin's duration), a video / animation as long as it runs,
//     a YouTube frame until the user moves on
//   • tap right = next, tap left = back, press and hold = pause, swipe down / ✕ / the phone's Back button = close
//   • plays with sound (opening it is a tap); if the phone blocks that, it plays muted with a "Tap for sound" button
//   • sits on the "modal" layer: the lock screen and PIN pad still cover it
// Events: view_start when a story is entered, view_complete when all its frames were watched, dismiss when closed early,
// click on the button.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CampaignMedia from "./CampaignMedia";
import { slotNavigate } from "./useSlotNav";
import { frameDurationMs, mediaKindOf, storyFrames, storySeen, storyStep } from "../../utils/campaignRules";

const HOLD_MS = 220;
const VIDEO_GRACE_MS = 1500;   // a video's own "ended" normally moves on; this only covers a stalled one

export default function StoryViewer({ stories, startIndex = 0, onClose, recordEvent }) {
  const navigate = useNavigate();
  const [pos, setPos] = useState({ s: startIndex, f: 0 });
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [mediaMs, setMediaMs] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const [drag, setDrag] = useState(0);
  const press = useRef({ at: 0, x: 0, y: 0, held: false, timer: null });
  const closedRef = useRef(false);
  const enteredRef = useRef(new Set());

  const story = stories[pos.s];
  const frames = storyFrames(story);
  const frame = frames[pos.f] || {};
  const kind = mediaKindOf({ media_type: frame.media_type, url: frame.url });
  const fixedMs = frameDurationMs(frame);
  const durationMs = fixedMs ?? (mediaMs ? mediaMs + (kind === "video" ? VIDEO_GRACE_MS : 0) : null);

  // ── close (✕, swipe, Back button) ──
  const close = useCallback((viaHistory = false) => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (story) recordEvent(story.id, "dismiss");
    if (!viaHistory && window.history.state?.kdtStory) window.history.back();
    onClose();
  }, [story, recordEvent, onClose]);

  useEffect(() => {
    window.history.pushState({ ...(window.history.state || {}), kdtStory: true }, "");
    const onPop = () => close(true);
    window.addEventListener("popstate", onPop);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("popstate", onPop); document.body.style.overflow = prevOverflow; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── moving between frames / stories ──
  const go = useCallback((dir) => {
    const next = storyStep(pos, dir, stories);
    const finishedStory = dir === "next" && (!next || next.s !== pos.s);
    if (finishedStory && story) {
      recordEvent(story.id, "view_complete");
      storySeen.mark(story);
    }
    if (!next) { closedRef.current = true; if (window.history.state?.kdtStory) window.history.back(); onClose(); return; }
    setPos(next);
  }, [pos, stories, story, recordEvent, onClose]);

  useEffect(() => {
    elapsedRef.current = 0; setElapsed(0); setMediaMs(null); setPaused(false);
    if (story && !enteredRef.current.has(story.id)) {
      enteredRef.current.add(story.id);
      recordEvent(story.id, "view_start");
    }
    // warm the next picture so the next tap is instant
    const n = storyStep(pos, "next", stories);
    const nf = n ? storyFrames(stories[n.s])[n.f] : null;
    if (nf && ["image", "gif"].includes(mediaKindOf({ media_type: nf.media_type, url: nf.url }))) { const img = new Image(); img.src = nf.url; }
  }, [pos.s, pos.f]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the frame clock ──
  useEffect(() => {
    if (paused || !durationMs) return undefined;
    let last = performance.now();
    let raf = 0;
    const tick = (t) => {
      const dt = t - last; last = t;
      if (document.visibilityState !== "hidden") {
        elapsedRef.current = Math.min(durationMs, elapsedRef.current + dt);
        setElapsed(elapsedRef.current);
        if (elapsedRef.current >= durationMs) { go("next"); return; }   // once: go() changes the frame, which ends this loop
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, durationMs, go]);

  // ── taps, holds and the swipe down ──
  const onPointerDown = (e) => {
    const p = press.current;
    p.at = Date.now(); p.x = e.clientX; p.y = e.clientY; p.held = false;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => { p.held = true; setPaused(true); }, HOLD_MS);
  };
  const onPointerMove = (e) => {
    const dy = e.clientY - press.current.y;
    if (press.current.at && dy > 8) { clearTimeout(press.current.timer); setDrag(dy); }
  };
  const onPointerUp = (e) => {
    const p = press.current;
    clearTimeout(p.timer);
    if (drag > 110) { close(); return; }
    setDrag(0);
    if (p.held) { setPaused(false); p.at = 0; return; }
    if (!p.at) return;
    p.at = 0;
    const w = e.currentTarget.getBoundingClientRect().width;
    go(e.clientX - e.currentTarget.getBoundingClientRect().left < w * 0.3 ? "prev" : "next");
  };

  if (!story || !frames.length) return null;
  const cta = frame.cta_label && frame.cta_action_value
    ? { label: frame.cta_label, type: frame.cta_action_type, value: frame.cta_action_value }
    : story.cta_label && story.cta_action_value ? { label: story.cta_label, type: story.cta_action_type, value: story.cta_action_value } : null;
  const onCTA = async () => {
    recordEvent(story.id, "click", { tileIndex: pos.f });
    closedRef.current = true;
    if (window.history.state?.kdtStory) window.history.back();
    onClose();
    await slotNavigate(cta.type, cta.value, navigate);
  };
  const hasSound = kind === "video" || kind === "youtube";
  const progress = durationMs ? Math.min(1, elapsed / durationMs) : 0;

  return (
    <div role="dialog" aria-modal="true" aria-label={story.headline || "Story"}
      className="fixed inset-0 z-modal bg-black flex items-center justify-center select-none"
      style={{ transform: drag ? `translateY(${drag}px)` : undefined, opacity: drag ? Math.max(0.4, 1 - drag / 500) : 1,
        transition: drag ? "none" : "transform 0.2s ease, opacity 0.2s ease" }}>
      <div className="relative w-full h-full max-w-md overflow-hidden"
        style={{ paddingTop: "env(safe-area-inset-top,0px)", paddingBottom: "env(safe-area-inset-bottom,0px)" }}>
        <div className="absolute inset-0" key={`${pos.s}:${pos.f}`}>
          <CampaignMedia url={frame.url} media_type={frame.media_type} poster_url={frame.poster_url} alt={frame.headline || story.headline || ""}
            fit="contain" mode="fullscreen" playing={!paused} muted={muted} loop={false}
            onDuration={setMediaMs} onEnded={() => go("next")}
            onAutoplayBlocked={() => { setMuted(true); setSoundBlocked(true); }}
            fallback={<div className="absolute inset-0 bg-[linear-gradient(160deg,#16255A,#3DA829)]" />} />
        </div>

        {/* tap / hold / swipe area (YouTube keeps its own controls in the middle) */}
        <div className="absolute inset-0 z-10 touch-none" style={kind === "youtube" ? { top: "30%", bottom: "30%", pointerEvents: "none" } : undefined}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
        {kind === "youtube" && (
          <>
            <div className="absolute inset-x-0 top-0 h-[30%] z-10 touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
            <div className="absolute inset-x-0 bottom-0 h-[30%] z-10 touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          </>
        )}

        {/* top: progress, title, sound, close */}
        <div className="absolute top-0 inset-x-0 z-20 px-3 pt-3 bg-gradient-to-b from-black/60 to-transparent pb-8 pointer-events-none [&_button]:pointer-events-auto"
          style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 12px)" }}>
          <div className="flex gap-1">
            {frames.map((_, i) => (
              <div key={i} className="h-[3px] flex-1 rounded-full bg-white/30 overflow-hidden">
                <div className="h-full bg-white" style={{ width: `${i < pos.f ? 100 : i > pos.f ? 0 : progress * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <p className="flex-1 min-w-0 text-white text-[13px] font-bold truncate drop-shadow">{story.headline || "KudiAI Track"}</p>
            {paused && <span className="text-white/70 text-[11px] font-semibold">Paused</span>}
            {hasSound && kind !== "youtube" && (
              <button type="button" onClick={() => { setMuted((m) => !m); setSoundBlocked(false); }}
                aria-label={muted ? "Turn sound on" : "Turn sound off"}
                className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white">
                {muted
                  ? <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M11 5 6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" /></svg>
                  : <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>}
              </button>
            )}
            <button type="button" onClick={() => close()} aria-label="Close"
              className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          {soundBlocked && muted && (
            <button type="button" onClick={() => { setMuted(false); setSoundBlocked(false); }}
              className="mt-2 px-3 py-1.5 rounded-full bg-white/90 text-slate-900 text-[12px] font-bold">Tap for sound</button>
          )}
        </div>

        {/* bottom: words + button */}
        {(frame.headline || frame.body || cta || kind === "youtube") && (
          <div className="absolute bottom-0 inset-x-0 z-20 px-5 pt-16 bg-gradient-to-t from-black/75 to-transparent pointer-events-none [&_button]:pointer-events-auto"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 20px)" }}>
            {frame.headline && <p className="text-white text-lg font-extrabold leading-snug drop-shadow">{frame.headline}</p>}
            {frame.body && <p className="text-white/85 text-sm mt-1 leading-relaxed drop-shadow">{frame.body}</p>}
            {kind === "youtube" && <p className="text-white/60 text-[11px] mt-2">Tap the right edge for the next story</p>}
            {cta && (
              <button type="button" onClick={onCTA}
                className="mt-4 w-full py-3.5 rounded-2xl font-bold text-[15px] text-slate-900 bg-white active:scale-[0.98] transition-transform">
                {cta.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
