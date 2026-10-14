// Translate outside React (shared helpers in src/utils) using the language the user picked. Same as tNow in
// contexts/LanguageContext, without pulling React into plain utility modules.
import { getLang } from "../utils/i18n";
import { translate } from "./index";

export function trNow(key, vars) {
  let lang = "en";
  try { lang = getLang(); } catch { /* no storage: English */ }
  return translate(key, lang, vars);
}
