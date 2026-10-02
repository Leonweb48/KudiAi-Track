// Reading what the user copied, for the transfer screen's "use copied account number".
//
// • In the Android app: the @capacitor/clipboard plugin (from APK build #186). Android 12+ shows its own small
//   "pasted from your clipboard" notice. An older APK doesn't have the plugin — the call fails quietly and we fall back.
// • On the web: only read silently when the browser has ALREADY been given clipboard permission; otherwise wait for the
//   user to tap "Paste" (userGesture), which is when a browser is allowed to ask.
// Never throws; "" when nothing can be read.
import { Capacitor } from "@capacitor/core";

export async function readClipboardText({ userGesture = false } = {}) {
  try {
    if (Capacitor.isNativePlatform?.()) {
      const { Clipboard } = await import("@capacitor/clipboard");
      const r = await Clipboard.read();
      if (typeof r?.value === "string") return r.value;
    }
  } catch { /* plugin not in this APK — try the web API */ }
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return "";
    if (!userGesture) {
      const p = await navigator.permissions?.query?.({ name: "clipboard-read" });
      if (!p || p.state !== "granted") return "";
    }
    return (await navigator.clipboard.readText()) || "";
  } catch {
    return "";
  }
}
