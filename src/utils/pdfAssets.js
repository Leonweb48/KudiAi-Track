// Shared asset loading for the vector PDFs (receipt, wallet statement).
// Same NotoSans files and approach as generateInvoicePdf.js — NotoSans carries
// the ₦ sign, which the built-in PDF fonts do not. (jsPDF embeds only the glyphs
// a document uses, so the full font files cost a few KB in the finished PDF.)

export async function imgToBase64(url) {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 5000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((ok) => {
      const r = new FileReader();
      r.onloadend = () => ok(r.result);
      r.onerror   = () => ok(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function loadFontBase64(url) {
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 5000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary  = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch { return null; }
}

/**
 * Shrink an image data URL to at most `px` on its longest side (PNG, keeps transparency).
 * The brand logo is a ~1.5 MB file: embedded as-is it would make every receipt PDF
 * that large. Falls back to the original if the browser can't decode/draw it.
 */
export function downscaleImage(dataUrl, px = 160) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof Image === "undefined" || typeof document === "undefined") return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, px / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Fetch the logo and both NotoSans weights in parallel (any of them may come back null). */
export async function loadPdfAssets() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [rawLogo, fontReg, fontMed] = await Promise.all([
    imgToBase64(`${origin}/logo-tp.png`),
    loadFontBase64(`${origin}/fonts/NotoSans-Regular.ttf`),
    loadFontBase64(`${origin}/fonts/NotoSans-Medium.ttf`),
  ]);
  const logo = rawLogo ? await downscaleImage(rawLogo, 160) : null;
  return { logo, fontReg, fontMed };
}

/**
 * Register NotoSans on a jsPDF document. Returns the font family to use:
 * "NotoSans" when the fonts loaded, else the built-in "helvetica" (callers then
 * spell the naira sign "NGN" because helvetica has no ₦).
 */
export function registerNotoSans(doc, { fontReg, fontMed }) {
  if (!fontReg) return "helvetica";
  doc.addFileToVFS("NotoSans-Regular.ttf", fontReg);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  if (fontMed) {
    doc.addFileToVFS("NotoSans-Medium.ttf", fontMed);
    doc.addFont("NotoSans-Medium.ttf", "NotoSans", "bold");
  } else {
    doc.addFont("NotoSans-Regular.ttf", "NotoSans", "bold");
  }
  return "NotoSans";
}
