import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { LocalNotifications } from "@capacitor/local-notifications";

export function usePermissions(requestPush) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function requestAll() {
      // Camera + photo library
      try {
        await Camera.requestPermissions({ permissions: ["camera", "photos"] });
      } catch (_) {}

      // Microphone — getUserMedia triggers the RECORD_AUDIO dialog on Android
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}

      // Location
      try {
        await navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 1 });
      } catch (_) {}

      // Notifications — requestPush also sets push=true in notif settings when granted
      if (requestPush) {
        requestPush().catch(() => {});
      } else {
        try { await LocalNotifications.requestPermissions(); } catch (_) {}
      }
    }

    // Small delay so the app UI is visible before dialogs appear
    const t = setTimeout(requestAll, 1500);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
