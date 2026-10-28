// The holiday decorations that can sit on the app logo (scheduled in the admin portal → Settings → Holiday Logo Caps).
// Since 2026-10-28 each is a professional animation — Google's Noto Emoji Animation (Lottie), self-hosted in
// public/holiday-caps/<id>.json — shown as a small badge on the logo's top-right corner (HolidayCap.jsx). Licence:
// CC BY 4.0, credited in the Terms (LegalScreen, intellectual property) and public/holiday-caps/CREDITS.txt.
//
// KEEP IN STEP with the admin portal's copy (Kuditrack-Admin-Portal/src/lib/holidayCapPresets.ts) — same ids, labels,
// files — and with the preset CHECK on public.holiday_caps (migration 20270438 for the six added ones).

// `still` = where in the animation (0–1) the picture for reduced-motion users is taken (default: the start).
// `loop` = play without the rest between plays (for animations whose start frame is nearly empty).
export const HOLIDAY_CAP_PRESETS = {
  nigeria:        { label: "Nigeria (green heart)",       hint: "Independence Day, Democracy Day",             anim: "/holiday-caps/nigeria.json" },
  christmas:      { label: "Christmas (gift)",            hint: "Christmas, Boxing Day",                       anim: "/holiday-caps/christmas.json" },
  new_year:       { label: "New Year (party popper)",     hint: "New Year's Day",                              anim: "/holiday-caps/new_year.json", still: 0.4 },
  eid:            { label: "Eid / Sallah (crescent moon)", hint: "Eid al-Fitr, Eid al-Adha, Mawlid",           anim: "/holiday-caps/eid.json" },
  easter:         { label: "Easter (hatching chick)",     hint: "Good Friday, Easter Monday",                  anim: "/holiday-caps/easter.json" },
  workers:        { label: "Workers' Day (strong arm)",   hint: "Workers' Day",                                anim: "/holiday-caps/workers.json" },
  valentine:      { label: "Valentine's (sparkling heart)", hint: "Valentine's Day",                           anim: "/holiday-caps/valentine.json" },
  celebration:    { label: "Celebration (confetti ball)", hint: "Children's Day, company anniversaries, any celebration", anim: "/holiday-caps/celebration.json", still: 0.4, loop: true },
  christmas_bell: { label: "Christmas (bell)",            hint: "Christmas, carol season",                     anim: "/holiday-caps/christmas_bell.json" },
  snowman:        { label: "Season's greetings (snowman)", hint: "Christmas, December holidays",               anim: "/holiday-caps/snowman.json" },
  star:           { label: "Glowing star",                hint: "Eid, Christmas, Ramadan, any festive season", anim: "/holiday-caps/star.json", still: 0.6, loop: true },
  sparkles:       { label: "Sparkles",                    hint: "Launches, milestones, any good news",         anim: "/holiday-caps/sparkles.json" },
  dove:           { label: "Peace dove",                  hint: "Independence Day, Democracy Day, Easter",     anim: "/holiday-caps/dove.json" },
  rabbit:         { label: "Easter (rabbit)",             hint: "Easter",                                      anim: "/holiday-caps/rabbit.json" },
};

export const HOLIDAY_CAP_IDS = Object.keys(HOLIDAY_CAP_PRESETS);

/** Where the badge sits on a logo `size` px wide: over the top-right corner, a little outside it. */
export function badgePlacement(size = 32) {
  const b = Math.round(size * 0.62);
  return { width: b, height: b, left: Math.round(size - b * 0.55), top: Math.round(-b * 0.45) };
}

export const REST_MS = 3500;   // pause between plays — the badge is a gentle touch, not a constant flicker
