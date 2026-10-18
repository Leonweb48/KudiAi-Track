import { useEffect, useRef, useState } from "react";
import { LANGUAGES, getLangMeta, markLangChosen } from "../../utils/i18n";
import { useLanguage, useT } from "../../contexts/LanguageContext";

// Picked on the sign-in page, saved to the profile once signed in (App.jsx reads this flag) — the after-login language
// screen is then skipped, the person already chose.
export const LANG_PENDING_SYNC_KEY = "kt_lang_pending_sync";

/** Globe pill on the sign-in / sign-up page: switch the whole page (and the app after sign-in) to another language. */
export default function LoginLanguageMenu() {
  const { lang, changeLang } = useLanguage();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const pick = (code) => {
    changeLang(code);
    markLangChosen();
    try { localStorage.setItem(LANG_PENDING_SYNC_KEY, code); } catch { /* private mode: the choice still applies here */ }
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative ml-auto flex-shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        aria-label={t("auth2.chooseLanguage")}
        className="flex items-center gap-1.5 h-9 pl-2.5 pr-2 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 border border-white/30 backdrop-blur-md text-white text-[13px] font-bold shadow-lg transition">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
        <span>{getLangMeta(lang).native}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul role="listbox" aria-label={t("auth2.chooseLanguage")}
          className="absolute right-0 mt-2 w-48 py-1.5 rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-100 dark:border-slate-700 z-50 overflow-hidden">
          {LANGUAGES.map((l) => {
            const on = l.code === lang;
            return (
              <li key={l.code} role="option" aria-selected={on}>
                <button type="button" onClick={() => pick(l.code)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-[14px] transition ${on ? "bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-bold" : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 font-semibold"}`}>
                  <span className="text-lg leading-none">{l.flag}</span>
                  <span className="flex-1">{l.native}</span>
                  {on && <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
