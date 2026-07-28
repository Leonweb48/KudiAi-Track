import { useState } from "react";
import { LANGUAGES, setLang, markLangChosen } from "../utils/i18n";
import { supabase } from "../utils/supabase";

const LABELS = {
  en:     { title: "Choose your language",  sub: "You can change this anytime in Settings" },
  pidgin: { title: "Choose your language",  sub: "You fit change am anytime for Settings"  },
  ha:     { title: "Zaɓi harshen ku",       sub: "Za ku iya canza shi a kowane lokaci a Saiti" },
  ig:     { title: "Họọ asụsụ gị",         sub: "Ị nwere ike gbanwee ya n'oge ọ bụla na Ntọala" },
  yo:     { title: "Yan ede rẹ",            sub: "O le yipada rẹ ni akoko eyikeyi ni Eto"     },
};

export default function LanguageSelector({ userId }) {
  const [selected, setSelected] = useState("en");
  const [saving,   setSaving]   = useState(false);

  const confirm = () => {
    setSaving(true);
    setLang(selected);
    markLangChosen();
    if (userId && supabase) {
      supabase.from("profiles").update({ preferred_language: selected }).eq("id", userId).catch(() => null);
    }
    // Language + chosen flag are already in localStorage; reload mounts the portal
    // cleanly on all platforms without the context-update + portal-mount burst freeze.
    window.location.reload();
  };

  const L = LABELS[selected] || LABELS.en;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col items-center justify-center px-6 py-10">
      {/* Logo */}
      <img src="/logo-tp.png" alt="KudiAI" className="w-16 h-16 mb-6 object-contain" />

      {/* Heading — updates live as user picks */}
      <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 text-center mb-1 tracking-tight transition-all">
        {L.title}
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-8">{L.sub}</p>

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
        {saving ? "…" : (selected === "en" ? "Continue" : selected === "pidgin" ? "Continue" : selected === "ha" ? "Ci gaba" : selected === "ig" ? "Gaa n'ihu" : "Tẹsiwaju")}
      </button>

      {/* Disclaimer */}
      <p className="mt-5 text-[11px] text-slate-400 dark:text-slate-500 text-center max-w-xs leading-relaxed">
        {selected === "en"     && "AI responses and the morning brief will be in your chosen language."}
        {selected === "pidgin" && "AI go reply and morning brief go dey for your language."}
        {selected === "ha"     && "AI da taƙaitaccen safiya za su kasance cikin harshen ku."}
        {selected === "ig"     && "AI na nchọpụta ụtụtụ ga-adị n'asụsụ gị."}
        {selected === "yo"     && "AI ati akọọlẹ owurọ yoo wa ni ede rẹ."}
      </p>
    </div>
  );
}
