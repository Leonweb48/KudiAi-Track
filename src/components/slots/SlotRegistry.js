// Slot definitions — system-defined, never admin-configurable
export const SLOTS = {
  home_banner:      { aspectRatio: "16/9",  ref: [1200, 675],  label: "Home Banner"             },
  announcement_bar: { aspectRatio: null,    ref: null,         label: "Announcement Bar"        },
  feed_card:        { aspectRatio: "4/1",   ref: [1200, 300],  label: "Feed Card"               },
  popup:            { aspectRatio: "4/5",   ref: [1080, 1350], label: "Popup"                   },
  upsell_inline:    { aspectRatio: null,    ref: null,         label: "Upsell Inline"           },
  offers_section:   { aspectRatio: null,    ref: null,         label: "Offers Section"          },
  powered_by_card:  { aspectRatio: null,    ref: null,         label: "Powered By Card"         },
  tab_card_quad:    { aspectRatio: "1/1",   ref: [240, 240],   label: "Tab Card Quad (4 tiles)" },
  tab_card_duo:     { aspectRatio: "4/3",   ref: [480, 360],   label: "Tab Card Duo (2 cards)"  },
};

// Per-portal slot availability matrix (system-enforced, not merely untargeted).
// Client portals cannot receive banner/feed/popup/upsell slots.
// Tab cards are available to ALL portals including client portals.
export const PORTAL_SLOTS = {
  business:     ["home_banner","announcement_bar","feed_card","popup","upsell_inline","offers_section","tab_card_quad","tab_card_duo"],
  staff:        ["home_banner","announcement_bar","feed_card","popup","upsell_inline","offers_section","tab_card_quad","tab_card_duo"],
  organisation: ["home_banner","announcement_bar","feed_card","popup","upsell_inline","offers_section","tab_card_quad","tab_card_duo"],
  ajo_client:   ["announcement_bar","offers_section","powered_by_card","tab_card_quad","tab_card_duo"],
  org_member:   ["announcement_bar","offers_section","powered_by_card","tab_card_quad","tab_card_duo"],
};

// Slots structurally impossible on client-facing portals
export const CLIENT_PORTAL_FORBIDDEN_SLOTS = new Set(["home_banner","feed_card","popup","upsell_inline"]);

export function isClientPortal(portalType) {
  return portalType === "ajo_client" || portalType === "org_member";
}

export function isSlotAllowed(slot, portalType) {
  return (PORTAL_SLOTS[portalType] ?? PORTAL_SLOTS.business).includes(slot);
}

// Whitelisted deep-link routes (no arbitrary injection)
export const DEEPLINK_WHITELIST = [
  "/", "/upgrade", "/settings", "/inventory",
  "/credits", "/insights", "/bills", "/loyalty", "/referral",
];

export function isWhitelistedDeeplink(path) {
  return DEEPLINK_WHITELIST.some(r => path === r || path.startsWith(r + "/"));
}

export function slotAspectRatio(slot) {
  return SLOTS[slot]?.aspectRatio ?? null;
}
