// Nigerian bank logos + one place that works out WHICH bank a name/code belongs to.
//
// The logo files live in public/logos/banks/ (PNG, converted from two open-source collections — Nigerian-Bank-Logos and
// ichtrojan/nigerian-banks; see the LICENSE.txt in that folder). A bank reaches us in different shapes, all handled here so
// the transfer screen, the receipt card, the receipt PDF and the history list agree:
//   • a bank CODE from the Flutterwave / Paystack bank list ("044")     – the reliable key when we have it. The two providers
//     use different codes for fintechs (OPay is 100004 on Flutterwave, 999992 on Paystack), so both are listed.
//   • the name the bank list returns ("Access Bank", "OPay Digital Services Limited (OPay)")
//   • the name the SENDING bank reports on a deposit ("WEMA BANK PLC", "ACCESS") – upper-case and inconsistent
//
// Only banks that have a logo are listed. Everyone else (Heritage, most small microfinance banks…) gets `logoUrl: null` and
// the UI shows an initials tile instead — never a wrong logo. To add a bank: drop its PNG into public/logos/banks/ and add
// one line to BANKS (a jest test fails if a file there is not listed). `canon: true` = the bank list spells this one out in
// legalese ("OPay Digital Services Limited (OPay)"), so receipts always write our short label.

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
  { key: "abbey",       label: "Abbey Mortgage Bank", file: "abbey.png",       codes: ["801", "404"],   match: /^abbey\s+mortgage/i },
  { key: "livingtrust", label: "Living Trust Bank",   file: "livingtrust.png", codes: ["031"],          match: /^living\s?trust/i },

  // ── fintechs, payment service banks, microfinance banks ──
  { key: "opay",        label: "OPay",                file: "opay.png",        codes: ["999992", "100004"], match: /\bopay\b|paycom/i, canon: true },
  { key: "palmpay",     label: "PalmPay",             file: "palmpay.png",     codes: ["999991", "100033"], match: /palm\s?pay/i, canon: true },
  { key: "kuda",        label: "Kuda Bank",           file: "kuda.png",        codes: ["50211", "090267"],  match: /^kuda\b/i, canon: true },
  { key: "moniepoint",  label: "Moniepoint",          file: "moniepoint.png",  codes: ["50515", "090405"],  match: /monie\s?point/i, canon: true },
  { key: "carbon",      label: "Carbon",              file: "carbon.png",      codes: ["565"],          match: /^carbon\b/i },
  { key: "fairmoney",   label: "FairMoney",           file: "fairmoney.png",   codes: ["51318"],        match: /fair\s?money/i },
  { key: "paga",        label: "Paga",                file: "paga.png",        codes: ["100002"],       match: /^paga\b/i },
  { key: "rubies",      label: "Rubies",              file: "rubies.png",      codes: ["125"],          match: /^rubies/i },
  { key: "sparkle",     label: "Sparkle",             file: "sparkle.png",     codes: ["51310"],        match: /^sparkle/i },
  { key: "eyowo",       label: "Eyowo",               file: "eyowo.png",       codes: ["50126"],        match: /^eyowo/i },
  { key: "tangerine",   label: "Tangerine",           file: "tangerine.png",   codes: ["51269"],        match: /^tangerine/i },
  { key: "mint",        label: "Mint",                file: "mint.png",        codes: ["50304"],        match: /^mint\b/i },
  { key: "airtel",      label: "Airtel Smartcash",    file: "airtel.png",      codes: ["120004"],       match: /^airtel/i },
  { key: "momo",        label: "MTN MoMo",            file: "momo.png",        codes: ["120003"],       match: /\bmomo\b/i },
  { key: "hope",        label: "Hope PSB",            file: "hope.png",        codes: ["120002"],       match: /^hope\s?psb|^hope\s+payment/i },
  { key: "ninepsb",     label: "9PSB",                file: "ninepsb.png",     codes: ["120001"],       match: /\b9\s?psb\b|9\s?payment|^9mobile/i },
  { key: "flutterwave", label: "Flutterwave",         file: "flutterwave.png", codes: ["090567"],       match: /^flutterwave/i },
  { key: "paystack",    label: "Paystack",            file: "paystack.png",    codes: ["51457", "100039"], match: /^paystack/i },

  // ── more commercial and merchant banks ──
  { key: "providus",    label: "Providus Bank",       file: "providus.png",    codes: ["101"],          match: /^providus/i },
  { key: "polaris",     label: "Polaris Bank",        file: "polaris.png",     codes: ["076"],          match: /^polaris/i },
  { key: "keystone",    label: "Keystone Bank",       file: "keystone.png",    codes: ["082"],          match: /^keystone/i },
  { key: "union",       label: "Union Bank",          file: "union.png",       codes: ["032"],          match: /^union\s+bank/i },
  { key: "titan",       label: "Titan Trust Bank",    file: "titan.png",       codes: ["102"],          match: /^titan\b/i },
  { key: "globus",      label: "Globus Bank",         file: "globus.png",      codes: ["00103"],        match: /^globus/i },
  { key: "standardchartered", label: "Standard Chartered", file: "standardchartered.png", codes: ["068"], match: /^standard\s+chartered/i },
  { key: "citibank",    label: "Citibank",            file: "citibank.png",    codes: ["023"],          match: /^citi(bank)?\b/i },
  { key: "suntrust",    label: "Suntrust Bank",       file: "suntrust.png",    codes: ["100"],          match: /^sun\s?trust/i },
  { key: "parallex",    label: "Parallex Bank",       file: "parallex.png",    codes: ["104"],          match: /^parallex/i },
  { key: "lotus",       label: "Lotus Bank",          file: "lotus.png",       codes: ["303"],          match: /^lotus/i },
  { key: "premiumtrust", label: "PremiumTrust Bank",  file: "premiumtrust.png", codes: ["105"],         match: /^premium\s?trust/i },
  { key: "signature",   label: "Signature Bank",      file: "signature.png",   codes: ["106"],          match: /^signature/i },
  { key: "optimus",     label: "Optimus Bank",        file: "optimus.png",     codes: ["107"],          match: /^optimus/i },
  { key: "nova",        label: "Nova Bank",           file: "nova.png",        codes: ["561"],          match: /^nova\b/i },
  { key: "taj",         label: "TAJ Bank",            file: "taj.png",         codes: ["302"],          match: /^taj\b/i },
  { key: "coronation",  label: "Coronation Merchant Bank", file: "coronation.png", codes: ["559"],     match: /^coronation/i },
  { key: "fsdh",        label: "FSDH Merchant Bank",  file: "fsdh.png",        codes: ["501"],          match: /^fsdh/i },
  { key: "rand",        label: "Rand Merchant Bank",  file: "rand.png",        codes: ["502"],          match: /^rand\s+merchant/i },
  { key: "heritage",    label: "Heritage Bank",       file: "heritage.png",    codes: ["030"],          match: /^heritage/i },
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
 * How a bank should be WRITTEN. A name the bank list gave us is kept as is (except the legalese ones flagged `canon`, which
 * always get our short label); a known bank reported in capitals ("WEMA BANK PLC", "ACCESS") is written the way we write it
 * ("Wema Bank", "Access Bank"); an unknown one reported in capitals is just title-cased.
 */
export function displayBankName({ code, name } = {}) {
  const asGiven = String(name || "").replace(/\s+/g, " ").trim();
  const bank = bankFor({ code, name });
  if (!asGiven) return bank ? bank.label : "";
  if (bank && bank.canon) return bank.label;      // "OPay Digital Services Limited (OPay)" → "OPay"
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
