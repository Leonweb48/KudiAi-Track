// "Which bank is this account number at?" — the candidate list behind the transfer screen's bank suggestions
// (flutterwave `suggest-banks`). Pure logic, tested in bankSuggest.test.ts; the function then runs a name enquiry at each
// candidate and returns the ones where the account exists, with the holder's name.
//
// Where the candidates come from, best first:
//   1. history   — banks this exact account number was successfully sent to before, on the platform
//   2. phone     — an account number that is a mobile number without its leading 0 (OPay, PalmPay, Moniepoint, Paga give
//                  these out), so those fintechs
//   3. NUBAN     — banks whose CBN check digit fits the number. A commercial bank's NUBAN prefix is "000" + its 3-digit CBN
//                  code; a microfinance / fintech's is "9" + its 5-digit CBN code. A random number fits ~1 bank in 10.
//   4. popular   — the big fintechs, to fill the remaining tries
// Capped (each candidate costs a name enquiry), deduplicated, and only codes present in the live bank list are kept.

export type Bank = { code: string; name: string };

// NUBAN check digit (CBN revised standard, 2020): weights over the 6-digit institution prefix + 9-digit serial.
const NUBAN_WEIGHTS = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
export function nubanFits(prefix6: string, account10: string): boolean {
  if (!/^\d{6}$/.test(prefix6) || !/^\d{10}$/.test(account10)) return false;
  const digits = prefix6 + account10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += Number(digits[i]) * NUBAN_WEIGHTS[i];
  return (10 - (sum % 10)) % 10 === Number(account10[9]);
}

// A Nigerian mobile number without its leading 0: 70x / 80x / 81x / 90x / 91x + 7 digits.
export const isPhoneAccount = (acct: string) => /^[789][01]\d{8}$/.test(acct);

// Fintechs that use the phone number as the account number (Flutterwave codes).
export const PHONE_BANKS = ["100004" /* OPay */, "100033" /* PalmPay */, "090405" /* Moniepoint */, "100002" /* Paga */];
// Microfinance / fintechs whose NUBAN we can check: 5-digit CBN code → the code Flutterwave's list uses.
export const OFI_NUBAN: Record<string, string> = { "50211": "090267" /* Kuda */, "50515": "090405" /* Moniepoint */ };
// Most-used first: decides the order of NUBAN matches, and fills the remaining tries.
export const POPULAR_ORDER = [
  "100004", "090405", "100033", "090267", "058", "044", "057", "033", "011", "070", "214", "232", "035", "221", "076", "050",
  "082", "032", "215", "101", "301",
];
const POPULAR_FILL = ["100004", "100033", "090405", "090267"];

// Flutterwave lists several codes per bank (old CBN + new NIP), and the "0000xx" ones don't resolve: one entry per bank
// name, preferring a code that works — the same collapse the transfer screen does, so both sides agree on the code.
export function collapseBanks(list: Bank[]): Bank[] {
  const by = new Map<string, Bank>();
  for (const b of list || []) {
    if (!b?.code || !b?.name) continue;
    const k = b.name.trim().toLowerCase();
    const cur = by.get(k);
    const bad = /^0000\d\d$/.test(b.code);
    if (!cur || (/^0000\d\d$/.test(cur.code) && !bad)) by.set(k, { code: String(b.code), name: b.name });
  }
  return [...by.values()];
}

export function candidateBanks(account: string, banks: Bank[], historyCodes: string[] = [], max = 7): Bank[] {
  if (!/^\d{10}$/.test(account)) return [];
  const list = collapseBanks(banks);
  const byCode = new Map(list.map((b) => [b.code, b]));
  const rank = (c: string) => { const i = POPULAR_ORDER.indexOf(c); return i < 0 ? 999 : i; };
  const out: Bank[] = [];
  const add = (code: string) => {
    const b = byCode.get(code);
    if (b && !out.some((o) => o.code === b.code) && out.length < max) out.push(b);
  };

  for (const c of historyCodes) add(c);
  if (isPhoneAccount(account)) PHONE_BANKS.forEach(add);
  const nuban = [
    ...list.filter((b) => /^\d{3}$/.test(b.code) && nubanFits("000" + b.code, account)).map((b) => b.code),
    ...Object.entries(OFI_NUBAN).filter(([cbn]) => nubanFits("9" + cbn, account)).map(([, flw]) => flw),
  ].sort((a, b) => rank(a) - rank(b));
  nuban.forEach(add);
  POPULAR_FILL.forEach(add);
  return out;
}

// Was a name-enquiry answer a sign the bank's network is up? Any answer from the bank counts — "no such account" too.
// Only no answer / a timeout / a server error counts against it. null = says nothing about the bank (bad bank code).
export function resolveSaysNetworkUp(r: { ok: boolean; status?: number; type?: string; msg?: string; timedOut?: boolean }): boolean | null {
  if (r.ok) return true;
  const t = `${r.type || ""} ${r.msg || ""}`;
  if (/UNKNOWN_BANK_CODE|not recognized/i.test(t)) return null;
  if (r.timedOut || (r.status ?? 0) >= 500 || r.status === 0) return false;
  if (/INVALID_ACCOUNT|is invalid|does not exist|not found|could not resolve account|account name/i.test(t)) return true;
  return false;
}
