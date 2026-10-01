// The holiday caps that can sit on the app logo (scheduled in the admin portal → Settings → Holiday Logo Caps).
// Each is a small self-contained animated SVG (its own <style>, class + keyframe names prefixed per preset so they never
// clash) drawn in a 48×40 box, placed over the top-left of the logo by `place`. Motion stops for people who ask their
// phone for reduced motion.
//
// KEEP IN STEP with the admin portal's copy (Kuditrack-Admin-Portal/src/lib/holidayCapPresets.ts) — same ids, same
// drawings — and with the preset CHECK on public.holiday_caps.

const still = (cls) => `@media (prefers-reduced-motion: reduce){${cls}{animation:none!important}}`;

// a hat sitting tilted on the top-left corner of the logo
const HAT = { left: -5, top: -13, width: 27, height: 23, rotate: -16 };
// an emblem floating centred above the logo
const ABOVE = { left: 4, top: -15, width: 24, height: 20, rotate: 0 };

export const HOLIDAY_CAP_PRESETS = {
  nigeria: {
    label: "Nigeria (green-white-green)",
    hint: "Independence Day, Democracy Day",
    place: HAT,
    svg: `<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg"><style>
.ng-s{transform-origin:24px 35px;animation:ng-s 2.6s ease-in-out infinite}.ng-b{transform-origin:24px 5px;animation:ng-b 1.3s ease-in-out infinite}
@keyframes ng-s{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}@keyframes ng-b{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}${still(".ng-s,.ng-b")}</style>
<defs><clipPath id="ng-cone"><path d="M24 6 L40 33 H8 Z"/></clipPath></defs>
<g class="ng-s"><g clip-path="url(#ng-cone)"><rect x="8" y="0" width="10.7" height="36" fill="#008751"/><rect x="18.7" y="0" width="10.6" height="36" fill="#fff"/><rect x="29.3" y="0" width="10.7" height="36" fill="#008751"/></g>
<path d="M24 6 L40 33 H8 Z" fill="none" stroke="#00663d" stroke-width="1.3" stroke-linejoin="round"/>
<rect x="5.5" y="31" width="37" height="5.5" rx="2.75" fill="#fff" stroke="#00663d" stroke-width="1.3"/>
<circle class="ng-b" cx="24" cy="5.5" r="3.4" fill="#fff" stroke="#00663d" stroke-width="1.2"/></g></svg>`,
  },
  christmas: {
    label: "Christmas (Santa hat)",
    hint: "Christmas, Boxing Day",
    place: HAT,
    svg: `<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg"><style>
.xm-p{transform-origin:33px 13px;animation:xm-p 1.8s ease-in-out infinite}.xm-sn{animation:xm-sn 2.4s linear infinite}.xm-sn2{animation:xm-sn 2.4s linear 1.2s infinite}
@keyframes xm-p{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(9deg)}}@keyframes xm-sn{0%{transform:translateY(-4px);opacity:0}20%{opacity:1}100%{transform:translateY(10px);opacity:0}}
${still(".xm-p,.xm-sn,.xm-sn2")}</style>
<path d="M8 31 C9 19 16 9 27 8 C31 7.7 33.5 9 35 12 C32 12 30 14 29.5 18 C29 23 31 27 33 31 Z" fill="#d6262f"/>
<path d="M27 8 C31 7.7 33.5 9 35 12 C32 12 30 14 29.5 18" fill="none" stroke="#a51c24" stroke-width="1"/>
<g class="xm-p"><path d="M33 12 C37 13 40 16 41 21" fill="none" stroke="#d6262f" stroke-width="4.5" stroke-linecap="round"/><circle cx="41.5" cy="23" r="4" fill="#fff" stroke="#e2e8f0" stroke-width="1"/></g>
<rect x="4.5" y="29" width="32" height="8" rx="4" fill="#fff" stroke="#e2e8f0" stroke-width="1.2"/>
<circle class="xm-sn" cx="44" cy="6" r="1.2" fill="#bfdbfe"/><circle class="xm-sn2" cx="4" cy="12" r="1" fill="#bfdbfe"/></svg>`,
  },
  new_year: {
    label: "New Year (party hat)",
    hint: "New Year's Day",
    place: HAT,
    svg: `<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg"><style>
.ny-c{animation:ny-c 1.4s ease-in-out infinite}.ny-c2{animation:ny-c 1.4s ease-in-out .45s infinite}.ny-c3{animation:ny-c 1.4s ease-in-out .9s infinite}
.ny-s{transform-origin:24px 34px;animation:ny-s 2.2s ease-in-out infinite}
@keyframes ny-c{0%,100%{opacity:0;transform:translateY(2px) scale(.6)}50%{opacity:1;transform:translateY(-2px) scale(1)}}@keyframes ny-s{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
${still(".ny-c,.ny-c2,.ny-c3,.ny-s")}</style>
<defs><clipPath id="ny-cone"><path d="M24 5 L39 33 H9 Z"/></clipPath></defs>
<g class="ny-s"><g clip-path="url(#ny-cone)"><rect x="0" y="0" width="48" height="40" fill="#6d28d9"/>
<path d="M-4 30 L30 -4 L36 -4 L2 30 Z M6 40 L44 2 L50 2 L12 40 Z M18 44 L52 10 L52 16 L24 44 Z" fill="#f5b301"/></g>
<path d="M24 5 L39 33 H9 Z" fill="none" stroke="#4c1d95" stroke-width="1.2" stroke-linejoin="round"/>
<rect x="7" y="31" width="34" height="4.5" rx="2.25" fill="#f5b301"/>
<path d="M24 5 l-3 -4 M24 5 l0 -5 M24 5 l3 -4" stroke="#f5b301" stroke-width="1.6" stroke-linecap="round"/></g>
<rect class="ny-c" x="5" y="6" width="3" height="3" rx=".6" fill="#ef4444" transform="rotate(20 6.5 7.5)"/>
<rect class="ny-c2" x="38" y="3" width="3" height="3" rx=".6" fill="#22c55e" transform="rotate(-15 39.5 4.5)"/>
<circle class="ny-c3" cx="42" cy="14" r="1.6" fill="#3b82f6"/></svg>`,
  },
  eid: {
    label: "Eid / Sallah (crescent & star)",
    hint: "Eid al-Fitr, Eid al-Adha, Mawlid",
    place: ABOVE,
    svg: `<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg"><style>
.ed-st{transform-origin:33px 13px;animation:ed-st 1.6s ease-in-out infinite}.ed-g{animation:ed-g 2.4s ease-in-out infinite}.ed-d{animation:ed-d 1.6s ease-in-out .8s infinite}
@keyframes ed-st{0%,100%{transform:scale(.85) rotate(0)}50%{transform:scale(1.1) rotate(12deg)}}@keyframes ed-g{0%,100%{opacity:.85}50%{opacity:1}}
@keyframes ed-d{0%,100%{opacity:0}50%{opacity:1}}${still(".ed-st,.ed-g,.ed-d")}</style>
<path class="ed-g" d="M23 4 A16 16 0 1 0 31 34 A13 13 0 1 1 23 4 Z" fill="#f2b705" stroke="#c99400" stroke-width="1"/>
<path class="ed-st" d="M33 6 l1.9 4.4 4.7 .4 -3.6 3.1 1.1 4.6 -4.1 -2.5 -4.1 2.5 1.1 -4.6 -3.6 -3.1 4.7 -.4 Z" fill="#f2b705" stroke="#c99400" stroke-width=".8"/>
<circle class="ed-d" cx="42" cy="24" r="1.2" fill="#f2b705"/><circle class="ed-d" cx="7" cy="9" r="1" fill="#f2b705"/></svg>`,
  },
  easter: {
    label: "Easter (bunny ears)",
    hint: "Good Friday, Easter Monday",
    place: { left: 1, top: -18, width: 30, height: 25, rotate: 0 },
    svg: `<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg"><style>
.es-r{transform-origin:30px 36px;animation:es-r 2s ease-in-out infinite}.es-l{transform-origin:18px 36px;animation:es-l 2.6s ease-in-out infinite}
@keyframes es-r{0%,70%,100%{transform:rotate(14deg)}80%{transform:rotate(30deg)}90%{transform:rotate(10deg)}}@keyframes es-l{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(-6deg)}}
${still(".es-r,.es-l")}</style>
<g class="es-l"><ellipse cx="18" cy="18" rx="6" ry="16" fill="#fff" stroke="#cbd5e1" stroke-width="1.2"/><ellipse cx="18" cy="19" rx="3" ry="11" fill="#f9a8d4"/></g>
<g class="es-r"><ellipse cx="30" cy="18" rx="6" ry="16" fill="#fff" stroke="#cbd5e1" stroke-width="1.2"/><ellipse cx="30" cy="19" rx="3" ry="11" fill="#f9a8d4"/></g>
<rect x="11" y="32" width="26" height="5" rx="2.5" fill="#f9a8d4" stroke="#ec4899" stroke-width="1"/></svg>`,
  },
  workers: {
    label: "Workers' Day (hard hat)",
    hint: "Workers' Day",
    place: HAT,
    svg: `<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg"><style>
.wk-b{transform-origin:24px 34px;animation:wk-b 1.6s ease-in-out infinite}.wk-sh{animation:wk-sh 2.4s ease-in-out infinite}
@keyframes wk-b{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-1.5px) rotate(2deg)}}@keyframes wk-sh{0%,100%{opacity:.35}50%{opacity:.85}}
${still(".wk-b,.wk-sh")}</style>
<g class="wk-b"><path d="M8 30 C8 18 15 10 24 10 C33 10 40 18 40 30 Z" fill="#facc15" stroke="#ca8a04" stroke-width="1.3"/>
<path d="M21 10.5 h6 v19.5 h-6 Z" fill="#eab308"/><path class="wk-sh" d="M13 22 C14 17 17 14 20 13" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>
<rect x="3" y="28.5" width="42" height="6" rx="3" fill="#facc15" stroke="#ca8a04" stroke-width="1.3"/></g></svg>`,
  },
  valentine: {
    label: "Valentine's (heart)",
    hint: "Valentine's Day",
    place: ABOVE,
    svg: `<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg"><style>
.vl-h{transform-origin:24px 20px;animation:vl-h 1.1s ease-in-out infinite}.vl-d{animation:vl-d 1.1s ease-in-out infinite}
@keyframes vl-h{0%,100%{transform:scale(.92)}15%{transform:scale(1.1)}30%{transform:scale(.96)}45%{transform:scale(1.06)}}@keyframes vl-d{0%,100%{opacity:0}50%{opacity:1}}
${still(".vl-h,.vl-d")}</style>
<path class="vl-h" d="M24 35 C10 26 6 19 6 13.5 C6 8.5 10 5 14.5 5 C18.5 5 22 7.5 24 11 C26 7.5 29.5 5 33.5 5 C38 5 42 8.5 42 13.5 C42 19 38 26 24 35 Z" fill="#e11d48" stroke="#9f1239" stroke-width="1.2"/>
<path d="M13 11 C14 9.5 15.5 9 17 9.2" stroke="#fff" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".8"/>
<circle class="vl-d" cx="44" cy="6" r="1.4" fill="#fb7185"/><circle class="vl-d" cx="4" cy="26" r="1.1" fill="#fb7185"/></svg>`,
  },
  celebration: {
    label: "Celebration (party hat)",
    hint: "Children's Day, company anniversaries, any celebration",
    place: HAT,
    svg: `<svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg"><style>
.cb-c{animation:cb-c 1.4s ease-in-out infinite}.cb-c2{animation:cb-c 1.4s ease-in-out .5s infinite}.cb-c3{animation:cb-c 1.4s ease-in-out 1s infinite}
.cb-s{transform-origin:24px 34px;animation:cb-s 2.2s ease-in-out infinite}
@keyframes cb-c{0%,100%{opacity:0;transform:translateY(2px) scale(.6)}50%{opacity:1;transform:translateY(-2px) scale(1)}}@keyframes cb-s{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
${still(".cb-c,.cb-c2,.cb-c3,.cb-s")}</style>
<defs><clipPath id="cb-cone"><path d="M24 5 L39 33 H9 Z"/></clipPath></defs>
<g class="cb-s"><g clip-path="url(#cb-cone)"><rect x="0" y="0" width="48" height="40" fill="#3DA829"/>
<circle cx="20" cy="15" r="2" fill="#fff"/><circle cx="28" cy="22" r="2" fill="#fff"/><circle cx="18" cy="27" r="2" fill="#fff"/><circle cx="30" cy="30" r="1.8" fill="#fff"/><circle cx="25" cy="11" r="1.5" fill="#fff"/></g>
<path d="M24 5 L39 33 H9 Z" fill="none" stroke="#2E8020" stroke-width="1.2" stroke-linejoin="round"/>
<rect x="7" y="31" width="34" height="4.5" rx="2.25" fill="#16255A"/><circle cx="24" cy="4.5" r="3.2" fill="#f5b301"/></g>
<rect class="cb-c" x="5" y="7" width="3" height="3" rx=".6" fill="#f5b301" transform="rotate(20 6.5 8.5)"/>
<rect class="cb-c2" x="39" y="4" width="3" height="3" rx=".6" fill="#3b82f6" transform="rotate(-15 40.5 5.5)"/>
<circle class="cb-c3" cx="42" cy="15" r="1.6" fill="#ef4444"/></svg>`,
  },
};

export const HOLIDAY_CAP_IDS = Object.keys(HOLIDAY_CAP_PRESETS);
