/**
 * One-tap "Turn on notifications" prompt for browser sessions.
 *
 * Clients never had a way to discover browser push — the toggle lived three
 * taps deep in Me → Preferences, and a browser only shows its permission
 * prompt from a direct tap. This puts that tap on the home screen.
 *
 * Shows only when it can actually work: a non-native browser that supports
 * push, permission still undecided, and not dismissed in the last 7 days.
 * On an iPhone that hasn't installed the site to the Home Screen it shows the
 * one-line install hint instead (iOS only exposes push to installed sites).
 */
import { useState } from "react";
import {
  webPushConfigured, webPushSupported, webPushPermission, needsIosInstall, enableWebPush,
} from "../utils/webPush";

const DISMISS_MS = 7 * 24 * 3600 * 1000;
const keyFor = (userId) => `kt_notif_banner_dismissed_${userId || "anon"}`;

function recentlyDismissed(userId) {
  try {
    const at = Number(localStorage.getItem(keyFor(userId)) || 0);
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch { return false; }
}

function isNativeApp() {
  return typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
}

export default function EnableNotificationsBanner({ userId }) {
  const [hidden,  setHidden]  = useState(() => recentlyDismissed(userId));
  const [busy,    setBusy]    = useState(false);
  const [outcome, setOutcome] = useState(null); // "ok" | "denied" | "error" | null

  if (hidden || !userId || isNativeApp() || !webPushConfigured()) return null;

  const iosInstall = needsIosInstall();
  if (!iosInstall && (!webPushSupported() || webPushPermission() !== "default") && outcome == null) return null;

  const dismiss = () => {
    try { localStorage.setItem(keyFor(userId), String(Date.now())); } catch { /* private mode */ }
    setHidden(true);
  };

  const turnOn = async () => {
    setBusy(true);
    const r = await enableWebPush(userId);
    setBusy(false);
    if (r === "ok") { setOutcome("ok"); setTimeout(() => setHidden(true), 2500); }
    else if (r === "denied") setOutcome("denied");
    else if (r === "dismissed") setOutcome(null);   // closed the prompt — leave the banner up
    else setOutcome("error");
  };

  return (
    <div className="mx-4 mt-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        {outcome === "ok" ? (
          <p className="text-[13px] font-bold text-emerald-700 dark:text-emerald-300">Notifications are on</p>
        ) : iosInstall ? (
          <>
            <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">Get alerts on your iPhone</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">Tap Share → Add to Home Screen, then open KudiAI Track from there.</p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">Get alerts when money moves</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              {outcome === "denied" ? "Notifications are blocked for this site — allow them from the padlock beside the address bar."
                : outcome === "error" ? "Couldn't turn them on — please try again."
                : "Contributions, payouts and wallet credits, even when this tab is closed."}
            </p>
          </>
        )}
      </div>

      {outcome !== "ok" && !iosInstall && outcome !== "denied" && (
        <button
          onClick={turnOn}
          disabled={busy}
          className="flex-shrink-0 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-[12px] font-bold active:opacity-80 disabled:opacity-60"
        >
          {busy ? "…" : "Turn on"}
        </button>
      )}
      {outcome !== "ok" && (
        <button onClick={dismiss} aria-label="Dismiss" className="flex-shrink-0 text-slate-400 dark:text-slate-500 text-lg leading-none px-1">×</button>
      )}
    </div>
  );
}
