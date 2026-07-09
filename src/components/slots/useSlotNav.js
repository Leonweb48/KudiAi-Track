import { Capacitor } from "@capacitor/core";
import { isWhitelistedDeeplink } from "./SlotRegistry";

export async function slotNavigate(actionType, actionValue, navigate) {
  if (!actionValue) return;
  if (actionType === "deeplink") {
    if (!isWhitelistedDeeplink(actionValue)) return; // blocked
    navigate(actionValue);
    return;
  }
  if (actionType === "promo_code") {
    // Dispatch so the subscription screen can pick it up
    window.dispatchEvent(new CustomEvent("applyPromoCode", { detail: { code: actionValue } }));
    navigate("/upgrade");
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
