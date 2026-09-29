import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useT } from "../contexts/LanguageContext";
import { installPromptDue, iosInstallTarget, markInstallChoice, markInstallShown, readInstallState } from "../utils/iosInstall";

// iPhone / iPad: invite the person to add KudiAI Track to the Home Screen (there's no iOS app yet — the web app is it).
// Once per device, then every 2 days until it is opened from the Home Screen. Schedule + detection: utils/iosInstall.js.
// Sits under the app lock / PIN screens (z-modal < z-lock), so an unlock always stays on top.

// Pages people reach without being users (receipt checks, legal pages, payment returns) never get the prompt.
const PUBLIC_PATHS = ["/verify", "/privacy", "/terms", "/delete-account", "/payment-return", "/app/payment-callback", "/bvn-return"];
const SHOW_AFTER_MS = 4000;   // let the app finish loading first

const safeStorage = () => { try { return window.localStorage; } catch { return null; } };

// iOS's own glyphs, so the steps match what's on the screen
const ShareIcon = ({ className = "" }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
  </svg>
);
const AddIcon = ({ className = "" }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" />
  </svg>
);

function Step({ n, icon, children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full bg-green-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
      <span className="flex-1 text-sm text-slate-700 dark:text-slate-200 leading-snug">{children}</span>
      {icon && <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-blue-500 flex items-center justify-center flex-shrink-0">{icon}</span>}
    </li>
  );
}

export default function IosInstallPrompt() {
  const t = useT();
  const location = useLocation();
  const [view, setView] = useState(null);         // null | "ask" | "steps" | "inapp"
  const [kind, setKind] = useState("first");      // "first" | "reminder"
  const [target, setTarget] = useState(null);     // { device, browser }
  const stateRef = useRef(null);
  const timerRef = useRef(null);

  const isPublic = PUBLIC_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(p + "/"));

  const check = useCallback(() => {
    if (view || isPublic || Capacitor.isNativePlatform()) return;
    const tg = iosInstallTarget(window.navigator, window);
    if (!tg) return;
    const due = installPromptDue(readInstallState(safeStorage()), Date.now());
    if (!due) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const st = readInstallState(safeStorage());
      const again = installPromptDue(st, Date.now());   // another tab may have shown it meanwhile
      if (!again) return;
      stateRef.current = markInstallShown(safeStorage(), Date.now(), st);
      setTarget(tg); setKind(again); setView(tg.browser === "inapp" ? "inapp" : "ask");
    }, SHOW_AFTER_MS);
  }, [view, isPublic]);

  useEffect(() => {
    check();
    // the app can sit open for days on a phone — check again whenever it comes back to the screen
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); clearTimeout(timerRef.current); };
  }, [check]);

  if (!view || !target) return null;

  const notNow = () => { markInstallChoice(safeStorage(), "rejected", stateRef.current, Date.now()); setView(null); };
  const install = () => { stateRef.current = markInstallChoice(safeStorage(), "accepted", stateRef.current, Date.now()); setView("steps"); };
  const device = target.device === "ipad" ? "iPad" : "iPhone";
  const shareStep = target.browser === "chrome" ? t("iosInstall.stepShareChrome")
    : target.browser === "safari" ? (target.device === "ipad" ? t("iosInstall.stepShareTop") : t("iosInstall.stepShareBottom"))
    : t("iosInstall.stepShareOther");
  const title = view === "inapp" ? t("iosInstall.inAppTitle")
    : view === "steps" ? t("iosInstall.stepsTitle")
    : kind === "reminder" ? t("iosInstall.reminderTitle") : t("iosInstall.title").replace("{device}", device);

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby="ios-install-title" data-testid="ios-install-prompt">
      <button type="button" aria-label={t("iosInstall.close")} className="absolute inset-0 bg-black/50 cursor-default"
        onClick={view === "steps" ? () => setView(null) : notNow} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] animate-fade-up">
        <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700 mx-auto mb-4" />
        <div className="flex items-center gap-3 mb-3">
          <img src="/logo.png" alt="" className="w-12 h-12 rounded-2xl shadow-md flex-shrink-0" />
          <h2 id="ios-install-title" className="text-base font-black text-slate-800 dark:text-white leading-tight">{title}</h2>
        </div>

        {view === "ask" && <>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">{t("iosInstall.body")}</p>
          <button type="button" onClick={install}
            className="w-full bg-gradient-to-br from-green-600 to-green-700 text-white font-bold rounded-xl py-3.5 text-sm">
            {t("iosInstall.install")}
          </button>
          <button type="button" onClick={notNow} className="w-full text-sm font-semibold text-slate-500 dark:text-slate-400 py-3 mt-1">
            {t("iosInstall.notNow")}
          </button>
        </>}

        {view === "steps" && <>
          <ol className="space-y-3 mb-5 mt-1">
            <Step n={1} icon={<ShareIcon className="w-5 h-5" />}>{shareStep}</Step>
            <Step n={2} icon={<AddIcon className="w-5 h-5" />}>{t("iosInstall.stepAdd")}</Step>
            <Step n={3}>{t("iosInstall.stepConfirm")}</Step>
          </ol>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-4">{t("iosInstall.stepOpen")}</p>
          <button type="button" onClick={() => setView(null)}
            className="w-full bg-gradient-to-br from-green-600 to-green-700 text-white font-bold rounded-xl py-3.5 text-sm">
            {t("iosInstall.done")}
          </button>
          {target.browser === "safari" && target.device === "iphone" && (
            // Safari's Share button sits just below this sheet, in the toolbar
            <div className="flex justify-center mt-3 text-blue-500 animate-bounce" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
            </div>
          )}
        </>}

        {view === "inapp" && <>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">{t("iosInstall.inAppBody")}</p>
          <button type="button" onClick={notNow}
            className="w-full bg-gradient-to-br from-green-600 to-green-700 text-white font-bold rounded-xl py-3.5 text-sm">
            {t("iosInstall.close")}
          </button>
        </>}
      </div>
    </div>
  );
}
