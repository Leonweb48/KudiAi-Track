import { Capacitor } from "@capacitor/core";
import { isWhitelistedDeeplink } from "./SlotRegistry";

export async function slotNavigate(actionType, actionValue, navigate) {
  if (!actionValue) return;
  if (actionType === "deeplink") {
    if (!isWhitelistedDeeplink(actionValue)) return;
    navigate(actionValue);
    return;
  }
  if (actionType === "promo_code") {
    // Store the code so SubscriptionPlan can auto-apply it on mount
    try { sessionStorage.setItem("kt_auto_promo", actionValue); } catch {}
    // Signal App.jsx to open the upgrade screen
    window.dispatchEvent(new CustomEvent("kt:openUpgrade"));
    return;
  }
  // external_url
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: actionValue });
  } else {
    window.open(actionValue, "_blank", "noopener,noreferrer");
  }
}
