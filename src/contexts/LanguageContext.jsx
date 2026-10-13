import { createContext, useContext, useState, useCallback } from "react";
import { getLang, setLang } from "../utils/i18n";
import { translate } from "../i18n";

const LanguageContext = createContext({ lang: "en", changeLang: () => {} });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(getLang);

  const changeLang = useCallback((code) => {
    setLang(code);
    setLangState(code);
  }, []);

  return (
    <LanguageContext.Provider value={{ lang, changeLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/**
 * t(key, vars?) — the text for `key` in the chosen language; `vars` fills {placeholders}: t("home.hello", { name }).
 * Components that call this re-render when the language changes, so every screen switches at once.
 */
export function useT() {
  const { lang } = useContext(LanguageContext);
  return (key, vars) => translate(key, lang, vars);
}

/** Outside React (helpers, toasts built in plain functions): the current language from storage. */
export function tNow(key, vars) {
  return translate(key, getLang(), vars);
}
