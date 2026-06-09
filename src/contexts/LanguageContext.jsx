import { createContext, useContext, useState, useCallback } from "react";
import { getLang, setLang } from "../utils/i18n";
import { TRANSLATIONS } from "../utils/translations";

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

export function useT() {
  const { lang } = useContext(LanguageContext);
  return (key) => TRANSLATIONS[key]?.[lang] ?? TRANSLATIONS[key]?.en ?? key;
}
