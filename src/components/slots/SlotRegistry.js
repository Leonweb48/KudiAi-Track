// Slot definitions — system-defined, never admin-configurable
export const SLOTS = {
  home_banner:      { aspectRatio: "16/9",  ref: [1200, 675],  label: "Home Banner"       },
  announcement_bar: { aspectRatio: null,    ref: null,         label: "Announcement Bar"  },
  feed_card:        { aspectRatio: "4/1",   ref: [1200, 300],  label: "Feed Card"         },
  popup:            { aspectRatio: "4/5",   ref: [1080, 1350], label: "Popup"             },
  upsell_inline:    { aspectRatio: null,    ref: null,         label: "Upsell Inline"     },
};

// Whitelisted deep-link routes (no arbitrary injection)
export const DEEPLINK_WHITELIST = [
  "/",
  "/upgrade",
  "/settings",
  "/inventory",
  "/credits",
  "/insights",
  "/bills",
  "/loyalty",
  "/referral",
];

export function isWhitelistedDeeplink(path) {
  return DEEPLINK_WHITELIST.some(r => path === r || path.startsWith(r + "/"));
}

// Slot-type to valid aspect ratio dimensions for server-side validation
export function slotAspectRatio(slot) {
  return SLOTS[slot]?.aspectRatio ?? null;
}
