import { Capacitor } from "@capacitor/core";

/**
 * Save or share a jsPDF document.
 * Web: triggers a browser file download.
 * Native Android/iOS: opens the system share sheet so the user can send to WhatsApp,
 * Drive, email, etc. Falls back silently if share is unavailable.
 */
export async function savePdf(doc, filename) {
  if (Capacitor.isNativePlatform() && navigator.share) {
    try {
      const blob = doc.output("blob");
      const file = new File([blob], filename, { type: "application/pdf" });
      const shareData = { title: filename };
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        shareData.files = [file];
      }
      await navigator.share(shareData);
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
      // Share failed — fall through to normal doc.save() as last resort
    }
  }
  doc.save(filename);
}
