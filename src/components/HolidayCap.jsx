import { useEffect, useState } from "react";
import { HOLIDAY_CAP_PRESETS } from "../utils/holidayCapPresets";
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

/**
 * The animated cap itself, absolutely placed over a logo box (the parent must be `position: relative`).
 * `size` = the logo's width in px; the placement is drawn for the 32px header logo and scales with it.
 */
export default function HolidayCap({ preset, title, size = 32 }) {
  const p = HOLIDAY_CAP_PRESETS[preset];
  if (!p) return null;
  const k = size / 32;
  const { left, top, width, height, rotate } = p.place;
  return (
    <span
      aria-hidden="true"
      title={title || undefined}
      data-testid="holiday-cap"
      data-preset={preset}
      className="absolute pointer-events-none select-none"
      style={{ left: left * k, top: top * k, width: width * k, height: height * k, transform: `rotate(${rotate}deg)`, transformOrigin: "50% 90%", zIndex: 1 }}
      // static, trusted drawings from holidayCapPresets.js — never data from the server
      dangerouslySetInnerHTML={{ __html: p.svg.replace("<svg ", '<svg width="100%" height="100%" style="overflow:visible;display:block" ') }}
    />
  );
}
