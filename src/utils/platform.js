// Where the app is running, and what the Google Play build may do.
//
// The Android app is distributed on Google Play. Its Payments policy requires Google Play Billing for subscriptions to an app's own
// features, and Nigeria has no alternative-billing programme — so until Play Billing is built the Android app does not SELL plans:
// no buy buttons, prices or coupon boxes, and nothing that tells people how to pay elsewhere (that is "steering", also not allowed).
// Existing paid plans keep working; the web app (kudiai.app) is unchanged and still sells plans.

export function isNativeApp() {
  return typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
}

/** May this build show plan prices, coupons and "Upgrade" buttons? Not inside the Android app. */
export function canSellPlans() {
  return !isNativeApp();
}

/** The Betting Wallet tile: shown on the web; hidden in the Android app until platform_config.android_betting_enabled = "true". */
export function bettingVisible(config) {
  return !isNativeApp() || config?.android_betting_enabled === "true";
}
