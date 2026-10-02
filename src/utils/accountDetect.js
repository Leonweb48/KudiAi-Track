// Reads a Nigerian bank account out of text someone copied or pasted — "0123456789 GTBank", "Acct: 0123 456 789, Access",
// "OPay 08031234567, Adaeze" — for the transfer screen's "use copied account" and paste handling.
//
//   extractAccountNumber(text) → the 10-digit account number, or "" when there is none or more than one
//   detectBankKey(text)        → the bankLogos key of the ONE bank the text names ("gtbank"), or ""
//   parseCopiedAccount(text, banks) → { account, bank } with bank = the entry from the transfer screen's bank list, or null
//
// A bank named in the text is a hint, not proof: the screen still checks the name with the bank, and asks the server for
// suggestions if the account isn't there. No regex lookbehind here (older iPhone Safari can't parse it).
import { bankFor } from "./bankLogos";

// How people write bank names in messages → bankLogos key. Checked in order; FCMB before First Bank.
const TEXT_ALIASES = [
  ["opay", /\bo\s?pay\b|\bpaycom\b/i],
  ["palmpay", /\bpalm\s?pay\b/i],
  ["moniepoint", /\bmonie\s?point\b/i],
  ["kuda", /\bkuda\b/i],
  ["gtbank", /\bgt\s?bank\b|\bgtb\b|\bgtco\b|\bguaranty\s+trust\b/i],
  ["access", /\baccess\b/i],
  ["zenith", /\bzenith\b/i],
  ["uba", /\buba\b|\bunited\s+bank\s+for\s+africa\b/i],
  ["fcmb", /\bfcmb\b|\bfirst\s+city\s+monument\b/i],
  ["firstbank", /\bfirst\s?bank\b|\bfbn\b/i],
  ["fidelity", /\bfidelity\b/i],
  ["sterling", /\bsterling\b/i],
  ["wema", /\bwema\b|\balat\b/i],
  ["stanbic", /\bstanbic\b/i],
  ["ecobank", /\beco\s?bank\b/i],
  ["union", /\bunion\s+bank\b/i],
  ["polaris", /\bpolaris\b/i],
  ["keystone", /\bkeystone\b/i],
  ["unity", /\bunity\s+bank\b/i],
  ["providus", /\bprovidus\b/i],
  ["jaiz", /\bjaiz\b/i],
  ["globus", /\bglobus\b/i],
  ["titan", /\btitan\s+trust\b/i],
  ["paga", /\bpaga\b/i],
  ["fairmoney", /\bfair\s?money\b/i],
  ["carbon", /\bcarbon\b/i],
  ["vfd", /\bvfd\b|\bv\s?bank\b/i],
  ["ninepsb", /\b9\s?psb\b/i],
  ["momo", /\bmomo\b/i],
  ["lotus", /\blotus\s+bank\b/i],
  ["taj", /\btaj\s?bank\b/i],
  ["parallex", /\bparallex\b/i],
  ["premiumtrust", /\bpremium\s?trust\b/i],
  ["standardchartered", /\bstandard\s+chartered\b/i],
  ["citibank", /\bciti\s?bank\b/i],
];

const allMatches = (re, text, group) => {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[group]);
  return out;
};

export function extractAccountNumber(text) {
  const t = String(text || "").slice(0, 2000);
  // a plain 10-digit number not touching other digits
  const tens = new Set(allMatches(/(^|\D)(\d{10})(?!\d)/g, t, 2));
  if (tens.size === 1) return [...tens][0];
  if (tens.size > 1) return "";
  // a mobile number written in full (OPay, PalmPay, Moniepoint, Paga use it as the account, without the 0)
  const phones = new Set(allMatches(/(^|\D)(0[789][01]\d{8})(?!\d)/g, t, 2).map((p) => p.slice(1)));
  if (phones.size === 1) return [...phones][0];
  if (phones.size > 1) return "";
  // written in groups: "0123 456 789", "012-345-6789", "0803 123 4567"
  const spaced = new Set(
    allMatches(/(^|\D)(\d{2,4}(?:[ -]\d{2,4}){2,3})(?!\d)/g, t, 2)
      .map((g) => g.replace(/\D/g, ""))
      .map((d) => (d.length === 11 && /^0[789][01]/.test(d) ? d.slice(1) : d))
      .filter((d) => d.length === 10),
  );
  return spaced.size === 1 ? [...spaced][0] : "";
}

export function detectBankKey(text) {
  const t = String(text || "").slice(0, 2000);
  const keys = new Set(TEXT_ALIASES.filter(([, re]) => re.test(t)).map(([k]) => k));
  return keys.size === 1 ? [...keys][0] : "";
}

export function parseCopiedAccount(text, banks = []) {
  const account = extractAccountNumber(text);
  if (!account) return { account: "", bank: null };
  const key = detectBankKey(text);
  const bank = key ? (banks || []).find((b) => b?.code && bankFor({ code: b.code, name: b.name })?.key === key) || null : null;
  return { account, bank };
}
