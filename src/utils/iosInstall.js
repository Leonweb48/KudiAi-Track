// "Add KudiAI Track to your Home Screen" on iPhone / iPad — there is no iOS app yet, so the web app is the app.
//
// iOS has no install API (no beforeinstallprompt): all we can do is show the steps (Share → Add to Home Screen). The
// prompt shows once; "Not now" snoozes it, and it comes back every 2 days until the app is opened from the Home Screen
// (standalone), which is the only proof of an install iOS gives us. Tapping "Install" shows the steps — if the person
// still hasn't added it 2 days later, they get the same reminder. Remembered per device (localStorage): the install is
// per device too.

export const IOS_INSTALL_KEY = "kt_ios_install";
export const REMIND_EVERY_MS = 2 * 24 * 60 * 60 * 1000;

// Apps whose built-in browser can't add to the Home Screen — the page has to be opened in Safari first.
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|MicroMessenger|TikTok|musical_ly|Snapchat|LinkedInApp|GSA\//i;

/**
 * An iPhone / iPad browser that hasn't installed the app: { device, browser }; anything else (Android, desktop, the
 * Home Screen app itself): null. iPadOS 13+ Safari reports a Mac user agent — a "Mac" with a touch screen is an iPad.
 */
export function iosInstallTarget(nav, win) {
  if (!nav) return null;
  const ua = String(nav.userAgent || "");
  const iPadAsMac = /Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1;
  if (!/iPhone|iPad|iPod/i.test(ua) && !iPadAsMac) return null;
  let standalone = nav.standalone === true;
  try { standalone = standalone || !!win?.matchMedia?.("(display-mode: standalone)")?.matches; } catch { /* old Safari */ }
  if (standalone) return null;
  const device = /iPad/i.test(ua) || iPadAsMac ? "ipad" : "iphone";
  const browser = IN_APP_BROWSER.test(ua) ? "inapp" : /CriOS/.test(ua) ? "chrome" : /FxiOS/.test(ua) ? "firefox" : /EdgiOS/.test(ua) ? "edge" : "safari";
  return { device, browser };
}

/** The remembered state — anything unreadable counts as never shown. */
export function readInstallState(storage) {
  try {
    const s = JSON.parse(storage?.getItem(IOS_INSTALL_KEY) || "null");
    return s && typeof s === "object" && Number.isFinite(s.last) ? s : null;
  } catch { return null; }
}

/** Should the prompt show now? "first" = never shown on this device; "reminder" = 2+ days since it was last shown. */
export function installPromptDue(state, now) {
  if (!state) return "first";
  if (now - state.last >= REMIND_EVERY_MS) return "reminder";
  if (state.last > now + 60_000) return "reminder";   // a clock that went backwards must not silence it forever
  return null;
}

/** Remember that it was shown (whether or not it's answered — closing the page counts as "not now"). */
export function markInstallShown(storage, now, prev) {
  const next = { first: prev?.first ?? now, last: now, shown: (prev?.shown ?? 0) + 1, choice: prev?.choice ?? null };
  try { storage?.setItem(IOS_INSTALL_KEY, JSON.stringify(next)); } catch { /* private mode: it just shows again */ }
  return next;
}

/** Remember the answer: "accepted" (saw the steps) or "rejected" (not now). Either way it comes back in 2 days if not installed. */
export function markInstallChoice(storage, choice, prev, now) {
  const next = { ...(prev ?? { first: now, last: now, shown: 1 }), choice, answeredAt: now };
  try { storage?.setItem(IOS_INSTALL_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
