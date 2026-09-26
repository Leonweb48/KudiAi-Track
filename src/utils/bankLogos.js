// Nigerian bank logos + one place that works out WHICH bank a name/code belongs to.
//
// The logo files live in public/logos/banks/ (PNG, converted from the open-source Nigerian-Bank-Logos collection — see the
// LICENSE.txt in that folder). A bank reaches us in different shapes, all handled here so the transfer screen, the receipt
// card, the receipt PDF and the history list agree:
//   • a bank CODE from the Flutterwave / Paystack bank list ("044")     – the reliable key when we have it
//   • the name the bank list returns ("Access Bank", "Guaranty Trust Bank")
//   • the name the SENDING bank reports on a deposit ("WEMA BANK PLC", "ACCESS") – upper-case and inconsistent
//
// Only banks that have a logo in the collection are listed. Everyone else (OPay, PalmPay, Kuda, Moniepoint, Providus…) gets
// `logoUrl: null` and the UI shows an initials tile instead — never a wrong logo. To add a bank: drop its PNG into
// public/logos/banks/ and add one line to BANKS (a jest test fails if a file there is not listed).

export const BANK_LOGO_DIR = "/logos/banks/";

// key → { label (how we write the bank), file, codes (CBN/NIP codes it is known by), match (its name, tested on the cleaned name) }
export const BANKS = [
  { key: "access",      label: "Access Bank",         file: "access.png",      codes: ["044", "063"],   match: /^access(\s?bank\b|\s*\(|$)/i },
  { key: "gtbank",      label: "GTBank",              file: "gtbank.png",      codes: ["058"],          match: /guaranty\s+trust|^gt\s?bank\b|^gtb\b|^gtco\b/i },
  { key: "zenith",      label: "Zenith Bank",         file: "zenith.png",      codes: ["057"],          match: /^zenith/i },
  { key: "uba",         label: "UBA",                 file: "uba.png",         codes: ["033"],          match: /united\s+bank\s+for\s+africa|^uba\b/i },
  { key: "firstbank",   label: "First Bank",          file: "firstbank.png",   codes: ["011"],          match: /^first\s?bank\b|first\s+bank\s+of\s+nigeria|^fbn\b|^first\s?holdco/i },
  { key: "fidelity",    label: "Fidelity Bank",       file: "fidelity.png",    codes: ["070"],          match: /^fidelity/i },
  { key: "stanbic",     label: "Stanbic IBTC",        file: "stanbic.png",     codes: ["221"],          match: /stanbic/i },
  { key: "ecobank",     label: "Ecobank",             file: "ecobank.png",     codes: ["050"],          match: /ecobank/i },
  { key: "sterling",    label: "Sterling Bank",       file: "sterling.png",    codes: ["232"],          match: /^sterling\b/i },
  { key: "wema",        label: "Wema Bank",           file: "wema.png",        codes: ["035", "035A"],  match: /^wema\b|^alat\b/i },
  { key: "fcmb",        label: "FCMB",                file: "fcmb.png",        codes: ["214"],          match: /^fcmb\b|first\s+city\s+monument/i },
  { key: "jaiz",        label: "Jaiz Bank",           file: "jaiz.png",        codes: ["301"],          match: /^jaiz\b/i },
  { key: "unity",       label: "Unity Bank",          file: "unity.png",       codes: ["215"],          match: /^unity(\s?bank\b|$)/i },
  { key: "vfd",         label: "VFD MFB",             file: "vfd.png",         codes: [],               match: /^vfd\b/i },
  { key: "npf",         label: "NPF MFB",             file: "npf.png",         codes: [],               match: /^npf\b/i },
  { key: "aso",         label: "Aso Savings",         file: "aso.png",         codes: ["401"],          match: /^aso\s+savings/i },
  { key: "abbey",       label: "Abbey Mortgage Bank", file: "abbey.png",       codes: ["801"],          match: /^abbey\s+mortgage/i },
  { key: "livingtrust", label: "Living Trust Bank",   file: "livingtrust.png", codes: ["031"],          match: /^living\s?trust/i },
];

const BY_CODE = new Map(BANKS.flatMap((b) => b.codes.map((c) => [c.toUpperCase(), b])));

const urlOf = (bank) => encodeURI(BANK_LOGO_DIR + bank.file);

// "WEMA BANK PLC" → "WEMA BANK": the legal suffix never helps recognise a bank
const cleanName = (name) => String(name || "").replace(/\s+/g, " ").replace(/\s*\b(plc|ltd|limited)\.?$/i, "").trim();

/** A bank's code as it appears in the lists ("44" → "044"), or "" */
const cleanCode = (code) => {
  const c = String(code ?? "").trim().toUpperCase();
  return /^\d{2}$/.test(c) ? `0${c}` : c;
};

/** The bank entry (with a logo) a code and/or name belongs to, or null. The code wins; the name is the fallback. */
export function bankFor({ code, name } = {}) {
  const byCode = BY_CODE.get(cleanCode(code));
  if (byCode) return byCode;
  const n = cleanName(name);
  return (n && BANKS.find((b) => b.match.test(n))) || null;
}

/** URL of the bank's logo, or null when the collection has none for it. */
export function bankLogoUrl(args) {
  const bank = bankFor(args);
  return bank ? urlOf(bank) : null;
}

// Words that stay upper-case when a shouted bank name is tidied up
const KEEP_UPPER = new Set(["MFB", "PLC", "NIP", "ATM", "BVN", "POS", "NG", "IBTC", "GTB", "GTCO", "UBA", "FCMB", "VFD", "NPF", "ALAT", "FBN"]);

function tidy(name) {
  return cleanName(name).split(" ").map((w) => (KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

/**
 * How a bank should be WRITTEN. A name the bank list gave us is kept as is; a known bank reported in capitals
 * ("WEMA BANK PLC", "ACCESS") is written the way we write it ("Wema Bank", "Access Bank"); an unknown one reported in
 * capitals is just title-cased.
 */
export function displayBankName({ code, name } = {}) {
  const asGiven = String(name || "").replace(/\s+/g, " ").trim();
  const bank = bankFor({ code, name });
  if (!asGiven) return bank ? bank.label : "";
  const shouting = asGiven === asGiven.toUpperCase() && /[A-Z]/.test(asGiven);
  if (!shouting) return asGiven;
  return bank ? bank.label : tidy(asGiven);
}

// Words that describe WHAT a bank is, not WHICH bank — left out when choosing its initials
const GENERIC = /^(bank|banks|of|the|and|plc|ltd|limited|micro-?finance|mfb|digital|services|service|technology|technologies|solutions|financial|finance|mortgage|savings|loans|nigeria|nig|holdings|group|company|co)$/i;

/** Two letters for the tile shown when a bank has no logo: "Kuda Microfinance Bank" → "KU", "OPay Digital Services" → "OP", "First Trust Mortgage Bank" → "FT". */
export function bankInitials(name) {
  const all = cleanName(name).replace(/[^A-Za-z0-9 ]/g, " ").split(" ").filter(Boolean);
  const words = all.filter((w) => !GENERIC.test(w));
  const use = words.length ? words : all.filter((w) => !/^(of|the|and)$/i.test(w));
  if (!use.length) return "?";
  return (use.length > 1 ? use[0][0] + use[1][0] : use[0].slice(0, 2)).toUpperCase();
}

/**
 * Everything a receipt or screen needs about a bank in one object, or null when we cannot even NAME it (a bare code that is not
 * one we know is not something to print on a receipt):
 *   { name, code, logoUrl (null without a logo), initials }
 */
export function describeBank({ code, name } = {}) {
  const bank = bankFor({ code, name });
  const label = displayBankName({ code, name }) || (bank && bank.label) || "";
  if (!label) return null;
  return { name: label, code: String(code ?? "").trim(), logoUrl: bank ? urlOf(bank) : null, initials: bankInitials(label) };
}
