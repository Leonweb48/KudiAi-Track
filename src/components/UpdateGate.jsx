import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { useT } from "../contexts/LanguageContext";
import { gateApplies, installedBuild, loadPolicy, cachedPolicy, updateVerdict, snoozed, snooze, openPlayStore } from "../utils/appUpdate";

// "Update required" / "A new version is available" for the Android app (policy and rules: utils/appUpdate.js).
// Mounted next to <App /> in index.js so it covers every screen, sign-in included. Checked at launch and each time the
// app comes back to the foreground (at most once a minute).
const RECHECK_MS = 60 * 1000;

export default function UpdateGate() {
  const t = useT();
  const [state, setState] = useState(null);   // { verdict, build, policy }
  const lastCheck = useRef(0);

  const check = useCallback(async (force = false) => {
    if (!gateApplies()) return;
    if (!force && Date.now() - lastCheck.current < RECHECK_MS) return;
    lastCheck.current = Date.now();
    const build = await installedBuild();
    // decide at once from the last copy, then again with the server's
    const fromCache = cachedPolicy();
    if (fromCache) setState({ verdict: updateVerdict(build, fromCache), build, policy: fromCache });
    const policy = await loadPolicy();
    setState({ verdict: updateVerdict(build, policy), build, policy });
  }, []);

  useEffect(() => {
    if (!gateApplies()) return undefined;
    check(true);
    const sub = CapApp.addListener("resume", () => check());
    return () => { Promise.resolve(sub).then((s) => s?.remove?.()).catch(() => {}); };
  }, [check]);

  const [, rerender] = useState(0);
  if (!state || state.verdict === "ok") return null;
  const { verdict, build, policy } = state;

  if (verdict === "available") {
    if (snoozed(policy.latest)) return null;
    return (
      <div role="status" className="fixed left-3 right-3 z-[390] mx-auto max-w-md rounded-2xl bg-[#0B3D2A] text-white shadow-2xl ring-1 ring-white/10 px-4 py-3 flex items-center gap-3"
        style={{ top: "calc(var(--status-bar-height, env(safe-area-inset-top, 0px)) + 8px)" }}>
        <span className="w-10 h-10 flex-shrink-0 rounded-xl bg-white flex items-center justify-center"><img src="/logo-tp.png" alt="" className="w-9 h-9" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold leading-tight">{t("update.availableTitle")}</p>
          <p className="text-[11.5px] text-white/75 leading-snug mt-0.5">{policy.message || t("update.availableBody")}</p>
        </div>
        <button onClick={openPlayStore} className="flex-shrink-0 px-3 py-1.5 rounded-full bg-[#7ED957] text-[#0B3D2A] text-[12px] font-extrabold active:scale-95 transition">
          {t("update.update")}
        </button>
        <button onClick={() => { snooze(policy.latest); rerender((n) => n + 1); }} aria-label={t("update.later")}
          className="flex-shrink-0 w-7 h-7 -mr-1 rounded-full flex items-center justify-center text-white/60 active:bg-white/10">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    );
  }

  // required: nothing else can be used until the app is updated
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="update-required-title"
      className="fixed inset-0 z-[2147483000] flex flex-col items-center justify-center text-center px-7 bg-gradient-to-b from-[#0B3D2A] to-[#05241A] text-white"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
      <div className="w-24 h-24 rounded-[28px] bg-white flex items-center justify-center shadow-xl mb-7">
        <img src="/logo-tp.png" alt="KudiAI Track" className="w-20 h-20" />
      </div>
      <h1 id="update-required-title" className="text-[24px] font-extrabold leading-tight">{t("update.requiredTitle")}</h1>
      <p className="mt-3 text-[14.5px] text-white/80 leading-relaxed max-w-sm">{t("update.requiredBody")}</p>
      {policy.message && <p className="mt-3 text-[13.5px] text-[#B9F09A] leading-relaxed max-w-sm">{policy.message}</p>}
      <button onClick={openPlayStore}
        className="mt-8 w-full max-w-xs py-3.5 rounded-2xl bg-[#7ED957] text-[#0B3D2A] text-[15px] font-extrabold shadow-lg active:scale-[0.98] transition">
        {t("update.updateNow")}
      </button>
      <p className="mt-4 text-[12px] text-white/55 leading-snug max-w-xs">{t("update.dataSafe")}</p>
      <p className="mt-6 text-[11px] text-white/35">{t("update.versionLine", { build, min: policy.min })}</p>
    </div>
  );
}
