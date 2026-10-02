// The rules behind campaign placements (banners, pop-ups, stories, cards), kept pure so they are tested on their own
// (src/__tests__/campaignRules.test.js):
//   • what kind of media a campaign carries, and the YouTube helpers
//   • when the phone should get the light version (data saver / 2G / "reduce motion")
//   • the pop-up frequency cap the admin sets — at most ONE pop-up per app session, whatever the cap
//   • how long a story frame stays up, and moving between frames and stories

export const MEDIA_TYPES = ["image", "gif", "video", "lottie", "youtube"];

const YT_ID = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/;
export const youtubeId = (url) => (String(url || "").match(YT_ID) || [])[1] || "";
export const youtubeThumb = (id) => (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "");
export const youtubeEmbed = (id, { muted = false } = {}) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1${muted ? "&mute=1" : ""}`;

/** What `url` is: the admin's explicit media_type when valid, otherwise worked out from the link (older campaigns). */
export function mediaKindOf({ media_type, url } = {}) {
  if (MEDIA_TYPES.includes(media_type)) return media_type;
  const u = String(url || "");
  if (!u) return "";
  if (youtubeId(u)) return "youtube";
  const path = u.split(/[?#]/)[0].toLowerCase();
  if (/\.(mp4|webm|m4v|mov)$/.test(path)) return "video";
  if (/\.json$/.test(path)) return "lottie";
  if (/\.gif$/.test(path)) return "gif";
  return "image";
}

/** Data saver on, a 2G-class connection, or the phone asks for less motion → no autoplaying video / animation. */
export function prefersLiteMedia(nav = typeof navigator !== "undefined" ? navigator : null, win = typeof window !== "undefined" ? window : null) {
  try {
    const c = nav?.connection;
    if (c?.saveData) return true;
    if (/(^|-)2g$/.test(String(c?.effectiveType || ""))) return true;
    if (win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return true;
  } catch { /* old browser */ }
  return false;
}

// ── pop-up frequency ─────────────────────────────────────────────────────────
const lagosDay = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

/**
 * May this pop-up show now?
 *   cap: "always" (= every visit: once per app session) | "once_per_day" (Nigerian calendar day) | "once_ever"
 *   lastShownAt: ms when THIS campaign last showed on this device (or null) · shownThisSession: any pop-up already shown
 */
export function canShowPopup({ cap, lastShownAt = null, now = Date.now(), shownThisSession = false } = {}) {
  if (shownThisSession) return false;
  if (!lastShownAt) return true;
  if (cap === "once_ever") return false;
  if (cap === "once_per_day") return lagosDay(lastShownAt) !== lagosDay(now);
  return true;
}

const POPUP_SEEN_KEY = "kt_popup_seen_v1";       // localStorage: { [campaignId]: ms last shown }
const POPUP_SESSION_KEY = "kt_popup_session_v1"; // sessionStorage: a pop-up already showed this app session
export const popupStore = {
  lastShown(id) { try { return JSON.parse(localStorage.getItem(POPUP_SEEN_KEY) || "{}")[id] || null; } catch { return null; } },
  shownThisSession() { try { return sessionStorage.getItem(POPUP_SESSION_KEY) === "1"; } catch { return false; } },
  markShown(id, now = Date.now()) {
    try {
      const all = JSON.parse(localStorage.getItem(POPUP_SEEN_KEY) || "{}");
      all[id] = now;
      localStorage.setItem(POPUP_SEEN_KEY, JSON.stringify(all));
    } catch { /* storage blocked */ }
    try { sessionStorage.setItem(POPUP_SESSION_KEY, "1"); } catch { /* storage blocked */ }
  },
};
/** The first campaign in priority order that may show now, or null. */
export function pickPopup(campaigns = [], store = popupStore, now = Date.now()) {
  const session = store.shownThisSession();
  return campaigns.find((c) => canShowPopup({ cap: c.frequency_cap, lastShownAt: store.lastShown(c.id), now, shownThisSession: session })) || null;
}

// ── stories ──────────────────────────────────────────────────────────────────
export const STORY_IMAGE_MS = 5000;
/** How long a frame stays up, or null when the media decides (a video's length, an animation's length, YouTube = never). */
export function frameDurationMs(frame = {}) {
  const d = Number(frame.duration_ms);
  if (Number.isFinite(d) && d > 0) return Math.min(Math.max(d, 2000), 60000);
  const kind = mediaKindOf({ media_type: frame.media_type, url: frame.url });
  return kind === "image" || kind === "gif" || kind === "" ? STORY_IMAGE_MS : null;
}

/** The frames of a stories campaign, cleaned (no frame without media), at most 10. */
export function storyFrames(campaign) {
  return (Array.isArray(campaign?.stories) ? campaign.stories : []).filter((f) => f && typeof f === "object" && f.url).slice(0, 10);
}

/** Moving through stories: { s: story index, f: frame index } → the next position, or null when the viewer should close. */
export function storyStep(pos, dir, stories) {
  const frames = (i) => storyFrames(stories[i]).length;
  let { s, f } = pos;
  if (dir === "next") {
    if (f + 1 < frames(s)) return { s, f: f + 1 };
    for (let n = s + 1; n < stories.length; n++) if (frames(n)) return { s: n, f: 0 };
    return null;
  }
  if (dir === "prev") {
    if (f > 0) return { s, f: f - 1 };
    for (let p = s - 1; p >= 0; p--) if (frames(p)) return { s: p, f: 0 };
    return { s, f: 0 };
  }
  return pos;
}

const STORY_SEEN_KEY = "kt_story_seen_v1";        // localStorage: { [campaignId]: updated_at seen }
export const storySeen = {
  has(c) { try { return JSON.parse(localStorage.getItem(STORY_SEEN_KEY) || "{}")[c.id] === String(c.updated_at || ""); } catch { return false; } },
  mark(c) {
    try {
      const all = JSON.parse(localStorage.getItem(STORY_SEEN_KEY) || "{}");
      all[c.id] = String(c.updated_at || "");
      localStorage.setItem(STORY_SEEN_KEY, JSON.stringify(all));
    } catch { /* storage blocked */ }
  },
};
