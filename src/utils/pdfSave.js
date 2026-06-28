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

      await Share.share({
        title: filename,
        url:   saved.uri,
        dialogTitle: "Share PDF",
      });
      return;
    } catch (e) {
      if (e?.message?.includes("cancel") || e?.errorMessage?.includes("cancel")) return;
      // fall through — try doc.save() as last resort (works in browser dev tools)
    }
  }
  doc.save(filename);
}
