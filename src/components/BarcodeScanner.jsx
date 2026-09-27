import { useEffect, useRef, useState } from "react";

// Live camera QR scanner for the public /verify page — anyone holding a printed receipt (no KudiAI
// app, no login) can scan its QR instead of typing the reference by hand. Web only: getUserMedia +
// jsQR, both work in any mobile browser and inside the app's own WebView — no native barcode plugin,
// so this ships the moment the web build deploys (see receiptPdfLayout.js for the QR printed on the
// receipt itself). Rear camera by default — scanning something held up in front of you, not a selfie.
const SCAN_MS = 220;   // how often a frame is pulled and decoded — fast enough to feel instant, light on battery/CPU

/**
 * onScan(text): the raw string jsQR decoded — a bare reference or a full verify URL, whichever the
 * QR encoded. Making sense of that text is the caller's job (see refFromScan in VerifyReceipt.jsx).
 */
export default function BarcodeScanner({ onScan, label = "Scan a QR code instead" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const timerRef = useRef(null);
  const jsQRRef = useRef(null);

  // Cancels the scan loop before onScan fires — a setInterval callback never re-enters itself while one is
  // still running, so once this clears timerRef no further tick can land; no separate "already done" flag needed.
  const stopStream = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stopStream(), []);

  const scanTick = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !jsQRRef.current) return;
    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    let frame;
    try { frame = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch { return; }
    const result = jsQRRef.current(frame.data, frame.width, frame.height);
    if (result?.data) {   // an empty/garbage decode keeps scanning rather than closing on nothing
      stopStream(); setOpen(false);
      onScan(result.data);
    }
  };

  const start = async () => {
    setError(""); setBusy(true); setOpen(true);
    try {
      const [jsQRMod, stream] = await Promise.all([
        import("jsqr"),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 720 }, height: { ideal: 720 } }, audio: false }),
      ]);
      jsQRRef.current = jsQRMod.default || jsQRMod;
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      timerRef.current = setInterval(scanTick, SCAN_MS);
    } catch (e) {
      stopStream(); setOpen(false);
      setError(e?.name === "NotAllowedError" ? "Camera access was blocked. Allow camera access and try again." : "Couldn't reach your camera. Try again, or type the reference instead.");
    } finally { setBusy(false); }
  };

  const cancel = () => { stopStream(); setOpen(false); };

  return (
    <>
      <button type="button" onClick={start} disabled={busy}
        style={{ marginTop: 10, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 14px", fontSize: 13.5, fontWeight: 700, color: "#0f1c45", background: "#f0f4ff", border: "1px solid #dbe4ff", borderRadius: 10, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
        <ScanGlyph /> {busy && !open ? "Opening camera…" : label}
      </button>
      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: "#b45309" }}>{error}</p>}
      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: 380, aspectRatio: "1 / 1", overflow: "hidden" }}>
            <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 32, borderRadius: 18, border: "2px solid rgba(255,255,255,.7)", pointerEvents: "none" }} />
          </div>
          <p style={{ color: "rgba(255,255,255,.8)", fontSize: 13, marginTop: 20, padding: "0 24px", textAlign: "center" }}>
            Point your camera at the QR code printed on the receipt
          </p>
          <button type="button" onClick={cancel} style={{ color: "rgba(255,255,255,.7)", fontSize: 13, fontWeight: 700, padding: "8px 16px", marginTop: 16, background: "none", border: 0, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

function ScanGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}
