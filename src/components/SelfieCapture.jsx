import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";

// A live, front-facing selfie for identity verification — NEVER a gallery photo (a photo of a photo defeats the point of a live check). Native: the
// Capacitor Camera plugin, forced to the front camera, no gallery option. Web: getUserMedia + a live preview, captured to a canvas. Either way the
// result is a JPEG data URI, downscaled so it comfortably fits Youverify's limits (a real image, 48–4096 px, ≤1MB — see supabase/functions/_shared/
// idCheck.ts) while still being large enough for a real face match. Nothing is uploaded by this component — it only hands the data URI to onCapture;
// the screen that owns the form is the one that sends it, alongside the ID number, when the customer submits.
const MAX_SIDE = 720;      // long side, px — comfortably under Youverify's 4096 px cap, small enough to stay well under their 1 MB cap at JPEG q≈0.85
const QUALITY = 82;        // 0–100 (Capacitor) / 0–1 (canvas, divided by 100 below)

function downscaledSize(w, h) {
  if (w <= MAX_SIDE && h <= MAX_SIDE) return { w, h };
  return w >= h ? { w: MAX_SIDE, h: Math.round((h / w) * MAX_SIDE) } : { w: Math.round((w / h) * MAX_SIDE), h: MAX_SIDE };
}

async function captureNative() {
  const { Camera, CameraResultType, CameraSource, CameraDirection } = await import("@capacitor/camera");
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,            // the camera app only — never the gallery
    direction: CameraDirection.Front,
    resultType: CameraResultType.DataUrl,
    quality: QUALITY, width: MAX_SIDE, height: MAX_SIDE,   // Capacitor keeps the aspect ratio; this just caps the longer side
    allowEditing: false, saveToGallery: false, correctOrientation: true,
  });
  if (!photo.dataUrl) throw new Error("No photo was returned");
  return photo.dataUrl;
}

/** value: the captured data URI, or "" / null when none yet. onCapture(dataUri) / onClear(): the screen owns the value, this component only captures. */
export default function SelfieCapture({ value, onCapture, onClear, label = "Take a selfie", className = "" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const isNative = Capacitor.isNativePlatform();

  const stopStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  useEffect(() => () => stopStream(), []);

  const start = async () => {
    setError("");
    if (isNative) {
      setBusy(true);
      try { onCapture(await captureNative()); }
      catch (e) { if (!/cancell?ed/i.test(e?.message || "")) setError("Couldn't open the camera. Check that camera permission is allowed for the app."); }
      finally { setBusy(false); }
      return;
    }
    setOpen(true); setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch (e) {
      setOpen(false);
      setError(e?.name === "NotAllowedError" ? "Camera access was blocked. Allow camera access for this site and try again." : "Couldn't reach your camera. Try again, or use a different device.");
    } finally { setBusy(false); }
  };

  const shoot = () => {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const { w, h } = downscaledSize(v.videoWidth, v.videoHeight);
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    // mirror horizontally — a selfie preview is normally shown mirrored, so the saved photo matches what they saw
    ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, w, h);
    const dataUri = canvas.toDataURL("image/jpeg", QUALITY / 100);
    stopStream(); setOpen(false); onCapture(dataUri);
  };

  const cancel = () => { stopStream(); setOpen(false); };
  const retake = () => { setError(""); onClear?.(); start(); };

  if (value) {
    return (
      <div className={`flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 px-3.5 py-3 ${className}`}>
        <img src={value} alt="Your selfie" className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-slate-200 dark:border-slate-600" />
        <span className="flex-1 text-[13px] font-semibold text-slate-700 dark:text-slate-200">Selfie captured</span>
        <button type="button" onClick={retake} className="text-[12px] font-semibold text-brand-600 dark:text-brand-400">Retake</button>
      </div>
    );
  }

  return (
    <div className={className}>
      <button type="button" onClick={start} disabled={busy}
        className="w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/60 dark:bg-slate-800/40 px-4 py-3.5 text-[13px] font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-60">
        <CameraGlyph /> {busy && !open ? "Opening camera…" : label}
      </button>
      {error && <p className="text-[12px] text-red-500 mt-1.5">{error}</p>}
      {/* Portal to <body>: a parent with a CSS transform (e.g. the new-device card) would otherwise trap this
          "fixed inset-0" layer inside itself, so the camera showed squashed in the card instead of full screen. */}
      {open && createPortal(
        <div className="fixed inset-0 z-[2147483001] bg-black flex flex-col items-center justify-center">
          <div className="relative w-full max-w-sm aspect-square overflow-hidden">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
            <div className="pointer-events-none absolute inset-6 rounded-full border-2 border-white/70" />
          </div>
          <p className="text-white/80 text-[13px] mt-5 px-6 text-center">Line your face up in the circle, in good light</p>
          <div className="flex items-center gap-6 mt-6">
            <button type="button" onClick={cancel} className="text-white/70 text-[13px] font-semibold px-4 py-2">Cancel</button>
            <button type="button" onClick={shoot} className="w-16 h-16 rounded-full bg-white ring-4 ring-white/30" aria-label="Capture" />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function CameraGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
