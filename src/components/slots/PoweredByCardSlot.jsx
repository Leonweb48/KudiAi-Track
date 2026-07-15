// Slot: powered_by_card — footer-positioned acquisition card for client portals.
// Always-on for ajo_client and org_member. Not managed through the campaign system.
// Clicks recorded as acquisition events — no user PII transmitted.
import { useState, useCallback } from "react";
import { supabase } from "../../utils/supabase";
import { Capacitor } from "@capacitor/core";

const SIGNUP_URL = "https://kudiai.app";

async function recordAcquisitionClick(portalType, businessId) {
  try {
    await supabase.from("acquisition_events").insert({
      portal_type: portalType,
      business_id: businessId || null,
      source: "powered_by_card",
    });
  } catch {}
}

async function openUrl(url) {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export default function PoweredByCardSlot({ portalType = "ajo_client", businessId }) {
  const [tapped, setTapped] = useState(false);

  const handleTap = useCallback(async () => {
    if (tapped) return;
    setTapped(true);
    await recordAcquisitionClick(portalType, businessId);
    await openUrl(SIGNUP_URL);
    setTimeout(() => setTapped(false), 3000);
  }, [tapped, portalType, businessId]);

  return (
    <div className="mx-4 mb-4">
      <button
        onClick={handleTap}
        className="w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800 active:scale-[0.98] transition-transform shadow-sm"
      >
        {/* Thin brand stripe */}
        <div className="h-0.5 w-full bg-[linear-gradient(90deg,#16255A,#3DA829)]" />

        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            {/* KudiAI logo mark */}
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-[linear-gradient(135deg,#16255A,#3DA829)]">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="text-left min-w-0">
              <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100 leading-none">
                Powered by <span style={{ background: "linear-gradient(135deg,#16255A,#3DA829)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>KudiAI Track</span>
              </p>
              <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                Track sales · Manage finance · Grow your business
              </p>
            </div>
          </div>
          <div className="flex-shrink-0 ml-2">
            <span className="text-[10px] font-bold text-white px-2.5 py-1.5 rounded-lg whitespace-nowrap bg-[linear-gradient(135deg,#3DA829,#16255A)]">
              Get Started →
            </span>
          </div>
        </div>
      </button>
    </div>
  );
}
