import { Capacitor } from "@capacitor/core";
import { isWhitelistedDeeplink } from "./SlotRegistry";
import { safeExternalUrl } from "../../utils/sanitizeHtml";

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
  // external_url — campaign data: web / tel / mail links only (never javascript:, data:, intent: …)
  const safeUrl = safeExternalUrl(actionValue);
  if (!safeUrl) return;
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: safeUrl });
  } else {
    window.open(safeUrl, "_blank", "noopener,noreferrer");
  }
}
