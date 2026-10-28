import { useEffect, useRef, useState } from "react";
import { HOLIDAY_CAP_PRESETS, badgePlacement, REST_MS } from "../utils/holidayCapPresets";
import { activeCap, cachedCaps, loadCaps, msUntilNextChange } from "../utils/holidayCaps";

/**
 * The holiday cap live on `portal` right now (null when none, or when no portal is given). Starts from the schedule
 * saved on the device, refreshes it from the server, switches exactly at each cap's start/end time and re-checks when the
 * app comes back to the foreground.
 */
export function useHolidayCap(portal) {
  const [caps, setCaps] = useState(() => (portal ? cachedCaps() : []));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!portal) return undefined;
    let alive = true;
    const refresh = () => loadCaps().then((c) => { if (alive) { setCaps(c); setNow(Date.now()); } });
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVisible); };
  }, [portal]);

  useEffect(() => {
    if (!portal) return undefined;
    const ms = msUntilNextChange(caps, portal, now);
    if (ms == null) return undefined;
    const t = setTimeout(() => setNow(Date.now()), ms + 250);
    return () => clearTimeout(t);
  }, [caps, portal, now]);

  return portal ? activeCap(caps, portal, now) : null;
}

// The animation player (lottie-web light, already used by campaigns) loads only when a cap is actually live.
let lottieLib = null;
const loadLottie = () => (lottieLib = lottieLib || import("lottie-web/build/player/lottie_light").then((m) => m.default || m));
const animJson = new Map();   // url → Promise<animation JSON>
function fetchAnim(url) {
  if (!animJson.has(url)) {
    animJson.set(url, Promise.resolve().then(() => fetch(url)).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }));
    animJson.get(url).catch(() => animJson.delete(url));
  }
  return animJson.get(url);
}
const reducedMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/**
 * The animated holiday badge on a logo's top-right corner (the parent must be `position: relative`). Plays once, rests a
 * few seconds, plays again (or loops, for presets marked `loop`) — paused while the app is in the background; one still
 * frame for reduced-motion users.
 * `size` = the logo's width in px.
 */
export default function HolidayCap({ preset, title, size = 32 }) {
  const p = HOLIDAY_CAP_PRESETS[preset];
  const box = useRef(null);

  useEffect(() => {
    if (!p) return undefined;
    let dead = false, anim = null, timer = null;
    const still = reducedMotion();
    const play = () => { clearTimeout(timer); if (anim && document.visibilityState === "visible") anim.goToAndPlay(0, true); };
    const onVisible = () => { if (document.visibilityState === "visible") play(); else { clearTimeout(timer); anim?.pause(); } };

    Promise.all([loadLottie(), fetchAnim(p.anim)]).then(([lottie, data]) => {
      if (dead || !box.current) return;
      anim = lottie.loadAnimation({ container: box.current, renderer: "svg", loop: !!p.loop && !still, autoplay: false, animationData: data });
      if (still) { anim.goToAndStop(Math.floor((p.still || 0) * anim.totalFrames), true); return; }
      if (!p.loop) anim.addEventListener("complete", () => { timer = setTimeout(play, REST_MS); });
      document.addEventListener("visibilitychange", onVisible);
      play();
    }).catch(() => { /* no badge rather than a broken one */ });

    return () => {
      dead = true; clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      anim?.destroy();
    };
  }, [p]);

  if (!p) return null;
  const { width, height, left, top } = badgePlacement(size);
  return (
    <span
      ref={box}
      aria-hidden="true"
      title={title || undefined}
      data-testid="holiday-cap"
      data-preset={preset}
      className="absolute pointer-events-none select-none"
      style={{ left, top, width, height, zIndex: 1, filter: "drop-shadow(0 1px 1.5px rgba(15,23,42,.22))" }}
    />
  );
}
