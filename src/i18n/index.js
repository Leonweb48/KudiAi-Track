// UI text for every screen, split by area so each part of the app keeps its own file (2026-10-14 full-translation pass).
// The original table (src/utils/translations.js) is still loaded first; area files add to it. A key defined twice keeps
// the area file's version. Languages: en, pidgin, ha, ig, yo — a missing language falls back to English.
import { TRANSLATIONS as BASE } from "../utils/translations";
import common from "./common";
import home from "./home";
import sales from "./sales";
import credit from "./credit";
import ajo from "./ajo";
import stock from "./stock";
import finance from "./finance";
import bills from "./bills";
import wallet from "./wallet";
import invoices from "./invoices";
import settings from "./settings";
import business from "./business";
import account from "./account";
import client from "./client";
import circles from "./circles";
import walletpanel from "./walletpanel";
import auth2 from "./auth";
import messages from "./messages";
import invite from "./invite";

export const ALL_TRANSLATIONS = Object.assign({}, BASE, common, home, sales, credit, ajo, stock, finance, bills, wallet,
  invoices, settings, business, account, client, circles, walletpanel, auth2, messages, invite);

const fill = (text, vars) => (vars && typeof text === "string")
  ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
  : text;

/** Text for a key in a language, with {var} values filled in. Falls back to English, then to the key itself. */
export function translate(key, lang = "en", vars) {
  const row = ALL_TRANSLATIONS[key];
  const text = row ? (row[lang] ?? row.en) : key;
  return fill(text, vars);
}
