// Slot definitions — system-defined, never admin-configurable
export const SLOTS = {
  home_banner:      { aspectRatio: "16/9",  ref: [1200, 675],  label: "Home Banner"      },
  announcement_bar: { aspectRatio: null,    ref: null,         label: "Announcement Bar" },
  feed_card:        { aspectRatio: "4/1",   ref: [1200, 300],  label: "Feed Card"        },
  popup:            { aspectRatio: "4/5",   ref: [1080, 1350], label: "Popup"            },
  upsell_inline:    { aspectRatio: null,    ref: null,         label: "Upsell Inline"    },
  offers_section:   { aspectRatio: null,    ref: null,         label: "Offers Section"   },
  powered_by_card:  { aspectRatio: null,    ref: null,         label: "Powered By Card"  },
};

// Per-portal slot availability matrix (system-enforced, not merely untargeted).
// Client-facing portals can never receive carousel/popup/upsell/banner slots.
export const PORTAL_SLOTS = {
  business:     ["home_banner","announcement_bar","feed_card","popup","upsell_inline","offers_section"],
  staff:        ["home_banner","announcement_bar","feed_card","popup","upsell_inline","offers_section"],
  organisation: ["home_banner","announcement_bar","feed_card","popup","upsell_inline","offers_section"],
  ajo_client:   ["announcement_bar","offers_section","powered_by_card"],
  org_member:   ["announcement_bar","offers_section","powered_by_card"],
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
