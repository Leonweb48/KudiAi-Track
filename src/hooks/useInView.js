// "Is this actually on the screen?" — for campaign media (play a video only while it can be seen) and fair impression
// counting (a view = at least half of it visible, for a second, while the app is in front).
import { useEffect, useRef, useState } from "react";

export function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

export function useInView(ref, { threshold = 0.5 } = {}) {
  const [inView, setInView] = useState(false);
  // The element often appears only after loading (placements render nothing until their campaigns arrive): pick it up
  // whenever it changes, not just on the first render.
  const [el, setEl] = useState(null);
  // Runs after every render on purpose (a ref change doesn't re-render); it only sets state when the element changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (ref.current !== el) setEl(ref.current); });
  useEffect(() => {
    if (!el) { setInView(false); return undefined; }
    if (typeof IntersectionObserver === "undefined") { setInView(true); return undefined; }
    const io = new IntersectionObserver(
      ([e]) => setInView(!!e && e.isIntersecting && e.intersectionRatio >= threshold - 0.001),
      { threshold: [0, threshold, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, threshold]);
  return inView;
}

/** Calls onImpression ONCE when the element has been at least half visible for `dwellMs` with the app in front. */
export function useImpression(ref, onImpression, { dwellMs = 1000, enabled = true, threshold = 0.5 } = {}) {
  const inView = useInView(ref, { threshold });
  const pageVisible = usePageVisible();
  const done = useRef(false);
  const cb = useRef(onImpression);
  cb.current = onImpression;
  useEffect(() => {
    if (!enabled || done.current || !inView || !pageVisible) return undefined;
    const t = setTimeout(() => { done.current = true; cb.current?.(); }, dwellMs);
    return () => clearTimeout(t);
  }, [enabled, inView, pageVisible, dwellMs]);
  return inView;
}

/** Like useImpression, for a placement whose campaign changes in place (rotating / dismissible): once per campaign id. */
export function useImpressionOf(ref, id, onImpression, { dwellMs = 1000, threshold = 0.5 } = {}) {
  const inView = useInView(ref, { threshold });
  const pageVisible = usePageVisible();
  const seen = useRef(new Set());
  const cb = useRef(onImpression);
  cb.current = onImpression;
  useEffect(() => {
    if (!id || seen.current.has(id) || !inView || !pageVisible) return undefined;
    const t = setTimeout(() => { seen.current.add(id); cb.current?.(id); }, dwellMs);
    return () => clearTimeout(t);
  }, [id, inView, pageVisible, dwellMs]);
  return inView;
}
