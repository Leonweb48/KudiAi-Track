import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { LocalNotifications } from "@capacitor/local-notifications";

export function usePermissions() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function requestAll() {
      // Camera + photo library
      try {
        await Camera.requestPermissions({ permissions: ["camera", "photos"] });
      } catch (_) {}

      // Microphone — getUserMedia triggers the RECORD_AUDIO dialog on Android
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}

      // Notifications
      try {
        await LocalNotifications.requestPermissions();
      } catch (_) {}
    }

    // Small delay so the app UI is visible before dialogs appear
    const t = setTimeout(requestAll, 1500);
    return () => clearTimeout(t);
  }, []);
}
