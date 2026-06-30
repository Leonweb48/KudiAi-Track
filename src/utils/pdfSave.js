import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror  = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Save or share a jsPDF document.
 * Native Android/iOS: writes to cache dir then opens the native share sheet.
 * The share sheet is NOT awaited — the caller's loading state clears immediately
 * so the spinner stops before the share dialog appears.
 * Web: triggers a browser file download.
 */
export async function savePdf(doc, filename) {
  if (Capacitor.isNativePlatform()) {
    try {
      const blob   = doc.output("blob");
      const base64 = await blobToBase64(blob);

      const saved = await Filesystem.writeFile({
        path:      filename,
        data:      base64,
        directory: Directory.Cache,
        recursive: true,
      });

      // Fire-and-forget: share sheet only resolves when user picks an app.
      // Awaiting it would leave the spinner running until the user acts.
      Share.share({
        title:       filename,
        url:         saved.uri,
        dialogTitle: "Share or save PDF",
      }).catch(() => {});
    } catch (e) {
      if (e?.message?.includes("cancel") || e?.errorMessage?.includes("cancel")) return;
      doc.save(filename);
    }
    return;
  }
  doc.save(filename);
}
