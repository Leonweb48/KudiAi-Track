import { useState } from "react";
import { LANGUAGES, setLang, markLangChosen } from "../utils/i18n";
import { supabase } from "../utils/supabase";
import { translate } from "../i18n";

// The screen's own text is shown in the language being picked (live preview), not the stored one, so it
// reads the tables directly with translate(key, selected) — the stored language changes only on Continue.

export default function LanguageSelector({ userId }) {
  const [selected, setSelected] = useState("en");
  const [saving,   setSaving]   = useState(false);

  const confirm = () => {
    setSaving(true);
    // Persist synchronously before reload so the app wakes up in the right language.
    try { setLang(selected); } catch (_) {}
    try { markLangChosen(); } catch (_) {}
    // Sync language to profile in background — never block navigation.
    if (userId && supabase) {
      setTimeout(() => {
        // Promise.resolve(): a Supabase query builder has no .catch of its own, so calling it directly threw and the save never ran.
        Promise.resolve(supabase.from("profiles").update({ preferred_language: selected }).eq("id", userId)).catch(() => null);
      }, 0);
    }
    // Reload on all platforms. Lang + chosen are in localStorage so the app
    // boots into the portal directly without re-showing this screen.
    window.location.reload();
  };

  const tt = (key, vars) => translate(key, selected, vars);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col items-center justify-center px-6 py-10">
      {/* Logo */}
      <img src="/logo-tp.png" alt="KudiAI" className="w-16 h-16 mb-6 object-contain" />

      {/* Heading — updates live as user picks */}
      <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 text-center mb-1 tracking-tight transition-all">
        {tt("account.lang.title")}
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-8">{tt("account.lang.sub")}</p>

      {/* Language options */}
      <div className="w-full max-w-sm space-y-3">
        {LANGUAGES.map(lang => {
          const active = selected === lang.code;
          return (
            <button
              key={lang.code}
              onClick={() => setSelected(lang.code)}
              className={[
                "w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition-all active:scale-[0.98]",
                active
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20 shadow-sm"
                  : "border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-brand-200 dark:hover:border-brand-700",
              ].join(" ")}
            >
              <span className="text-3xl leading-none flex-shrink-0 select-none">{lang.flag}</span>
              <div className="flex-1 text-left">
                <p className={`font-bold text-base leading-tight ${active ? "text-brand-700 dark:text-brand-300" : "text-slate-800 dark:text-slate-100"}`}>
                  {lang.native}
                </p>
                {lang.native !== lang.name && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{lang.name}</p>
                )}
              </div>
              <span className={[
                "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                active ? "border-brand-500 bg-brand-500" : "border-slate-300 dark:border-slate-600",
              ].join(" ")}>
                {active && (
                  <svg viewBox="0 0 12 10" fill="none" className="w-3 h-2.5">
                    <path d="M1 5l3 3 7-7" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Confirm */}
      <button
        onClick={confirm}
        disabled={saving}
        className="mt-8 w-full max-w-sm py-4 rounded-2xl bg-brand-600 active:bg-brand-700 text-white font-extrabold text-base shadow-lg active:scale-[0.98] transition-all disabled:opacity-60"
      >
        {saving ? "…" : tt("account.lang.continue")}
      </button>

      {/* Disclaimer */}
      <p className="mt-5 text-[11px] text-slate-400 dark:text-slate-500 text-center max-w-xs leading-relaxed">
        {tt("account.lang.disclaimer")}
      </p>
    </div>
  );
}
