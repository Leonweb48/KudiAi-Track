import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror   = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Share a generated file (a receipt image or PDF) — the native share sheet in the app, the Web Share API in a browser that
 * can share files, else a download. `text` goes with it (WhatsApp shows it as the caption): a document's verify link.
 * @returns 'shared' | 'downloaded' — throws on a real failure (a cancelled share counts as shared)
 */
export async function shareFile(file, { text = "", dialogTitle = "Share receipt" } = {}) {
  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = await fileToBase64(file);
      const saved  = await Filesystem.writeFile({ path: file.name, data: base64, directory: Directory.Cache, recursive: true });
      await Share.share({ title: file.name, ...(text ? { text } : {}), url: saved.uri, dialogTitle });
      return "shared";
    } catch (e) {
      if (e?.message?.includes("cancel") || e?.errorMessage?.includes("cancel")) return "shared";
      throw e;
    }
  }
  if (navigator.canShare) {
    // with the verify link when this browser can send text alongside a file, else the file alone
    const payloads = text ? [{ files: [file], title: file.name, text }, { files: [file], title: file.name }] : [{ files: [file], title: file.name }];
    const payload = payloads.find((p) => { try { return navigator.canShare(p); } catch { return false; } });
    if (payload) {
      try {
        await navigator.share(payload);
        return "shared";
      } catch (e) {
        if (e?.name === "AbortError" || e?.message?.includes("cancel")) return "shared";
      }
    }
  }
  const url = URL.createObjectURL(file);
  const a   = Object.assign(document.createElement("a"), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
