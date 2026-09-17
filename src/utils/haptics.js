// Thin, safe wrapper around @capacitor/haptics — every call is a no-op on
// web (no native bridge) and never throws, so callers can fire-and-forget
// these at success/error moments without guarding every call site.
import { Capacitor } from "@capacitor/core";

let hapticsModule = null;
async function getHaptics() {
  if (!Capacitor.isNativePlatform()) return null;
  if (hapticsModule) return hapticsModule;
  try {
    hapticsModule = await import("@capacitor/haptics");
    return hapticsModule;
  } catch {
    return null;
  }
}

export async function hapticSuccess() {
  try {
    const h = await getHaptics();
    await h?.Haptics.notification({ type: h.NotificationType.Success });
  } catch { /* best-effort */ }
}

export async function hapticError() {
  try {
    const h = await getHaptics();
    await h?.Haptics.notification({ type: h.NotificationType.Error });
  } catch { /* best-effort */ }
}

export async function hapticImpact() {
  try {
    const h = await getHaptics();
    await h?.Haptics.impact({ style: h.ImpactStyle.Light });
  } catch { /* best-effort */ }
}
