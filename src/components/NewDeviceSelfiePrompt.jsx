import { useEffect, useState } from "react";
import SelfieCapture from "./SelfieCapture";
import { submitSecuritySelfie } from "../utils/securitySelfie";
import { usePlatformConfig } from "../hooks/usePlatformConfig";

// Mounted once, as a sibling of <App/> in index.js (the same spot as <AdminAccessBannerHost/>, for the same
// reason: it must render outside App's many early-return status branches, so it works no matter which portal
// — owner, staff, manager, Ajo client, Coop member — ends up on screen). useAuth.js's logPlatformSession()
// dispatches window "kt:newDevice" the moment it flags a login from a device it hasn't seen in this account's
// last 20 sessions; this is the one listener for that event. Purely a deterrent + dispute-trail record (see
// utils/securitySelfie.js) — dismissible, never blocks app usage, unlike the PIN-reset/large-transfer selfie
// steps which sit INSIDE a specific action's own flow.
export default function NewDeviceSelfiePrompt() {
  // Paused unless platform_config.security_selfie_enabled = "true" (see usePlatformConfig).
  const { securitySelfieEnabled } = usePlatformConfig();
  const [open, setOpen] = useState(false);
  const [selfie, setSelfie] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handler = () => {
      // An admin opening the account from the admin portal is not the customer — never ask them for a selfie.
      try { if (sessionStorage.getItem("kt_admin_access_token")) return; } catch { /* storage unavailable */ }
      setOpen(true);
    };
    window.addEventListener("kt:newDevice", handler);
    return () => window.removeEventListener("kt:newDevice", handler);
  }, []);

  // Close on its own a moment after the selfie is saved, instead of leaving "Thanks — recorded" on screen.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => { setOpen(false); setDone(false); setSelfie(""); }, 2500);
    return () => clearTimeout(t);
  }, [done]);

  if (!open || !securitySelfieEnabled) return null;

  const dismiss = () => setOpen(false);

  const capture = async (dataUrl) => {
    setSelfie(dataUrl); setBusy(true); setError("");
    const r = await submitSecuritySelfie("new_device", dataUrl, {
      deviceType: /Mobi|Android/i.test(navigator.userAgent || "") ? "mobile" : "desktop",
      browser: /Chrome/i.test(navigator.userAgent || "") ? "Chrome" : /Firefox/i.test(navigator.userAgent || "") ? "Firefox" : /Safari/i.test(navigator.userAgent || "") ? "Safari" : "Other",
    });
    setBusy(false);
    if (!r.ok) { setSelfie(""); setError(r.error); return; }
    setDone(true);
  };

  return (
    <div role="dialog" aria-label="New device sign-in"
      style={{ position: "fixed", left: "50%", bottom: "calc(env(safe-area-inset-bottom,0px) + 16px)", transform: "translateX(-50%)", zIndex: 480, width: "calc(100vw - 32px)", maxWidth: 380 }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 18, boxShadow: "0 8px 28px rgba(15,28,69,.18)", border: "1px solid #e2e8f0" }}>
        {done ? (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#16a34a" /><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <p className="text-[13px] font-semibold text-slate-700">Thanks — recorded.</p>
          </div>
        ) : (
          <>
            <p className="text-[14px] font-extrabold text-[#0f1c45]">New device sign-in</p>
            <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">
              We don't recognise this device. A quick selfie helps if you ever need to prove this was you — it's optional and never blocks your access.
            </p>
            {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
            <div className="mt-3">
              <SelfieCapture value={selfie} onCapture={capture} onClear={() => setSelfie("")} label="Take a quick selfie" />
            </div>
            {busy && <p className="text-[11px] text-slate-400 mt-1.5">Saving…</p>}
            <button type="button" onClick={dismiss} className="text-[12px] font-semibold text-slate-400 mt-3">
              Not now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
