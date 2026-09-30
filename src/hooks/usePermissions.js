import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";

export function usePermissions() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function requestAll() {
      // Camera only. The photo-library permissions (READ_MEDIA_IMAGES / _VIDEO) are removed from the manifest for Play's
      // photo & video policy, and Capacitor rejects the WHOLE request when any asked-for permission is undeclared — so
      // asking for "photos" here would silently skip the camera prompt too.
      try {
        await Camera.requestPermissions({ permissions: ["camera"] });
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
    }

    // Small delay so the app UI is visible before dialogs appear
    const t = setTimeout(requestAll, 1500);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
