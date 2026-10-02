// Run: deno test supabase/functions/_shared/bankSuggest.test.ts
import { candidateBanks, collapseBanks, isPhoneAccount, nubanFits, resolveSaysNetworkUp } from "./bankSuggest.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT ${msg}: got ${a}, expected ${e}`);
}

// A slice of Flutterwave's bank list, with its real quirks: several codes per bank, "0000xx" codes that don't resolve.
const BANKS = [
  { code: "044", name: "Access Bank" }, { code: "000014", name: "Access Bank" },
  { code: "058", name: "Guaranty Trust Bank" }, { code: "000013", name: "Guaranty Trust Bank" },
  { code: "057", name: "Zenith Bank" }, { code: "033", name: "United Bank For Africa" }, { code: "011", name: "First Bank of Nigeria" },
  { code: "070", name: "Fidelity Bank" }, { code: "215", name: "Unity Bank" },
  { code: "100004", name: "OPay" }, { code: "100033", name: "PalmPay" }, { code: "090405", name: "Moniepoint MFB" },
  { code: "090267", name: "Kuda Microfinance Bank" }, { code: "100002", name: "Paga" },
];
const codes = (bs: { code: string }[]) => bs.map((b) => b.code);

Deno.test("NUBAN check digit: the CBN's own worked example (First Bank, serial 000001457 → 0000014579)", () => {
  eq(nubanFits("000011", "0000014579"), true, "First Bank example fits");
  eq(nubanFits("000011", "0000014578"), false, "wrong check digit");
  eq(nubanFits("950211", "2200001236"), true, "Kuda (9 + CBN 50211)");
  eq(nubanFits("00011", "0000014579"), false, "bad prefix");
  eq(nubanFits("000011", "000001457"), false, "9 digits");
});

Deno.test("phone-number accounts", () => {
  eq(isPhoneAccount("8031234567"), true, "803…");
  eq(isPhoneAccount("9131234567"), true, "913…");
  eq(isPhoneAccount("7011234567"), true, "701…");
  eq(isPhoneAccount("0123456785"), false, "starts 0");
  eq(isPhoneAccount("8231234567"), false, "82x is not a mobile prefix");
});

Deno.test("collapse keeps one working code per bank", () => {
  eq(codes(collapseBanks(BANKS)).filter((c) => c.startsWith("0000")), [], "no 0000xx codes left");
  eq(collapseBanks(BANKS).length, 12, "12 distinct banks");
});

Deno.test("NUBAN matches first (most-used order), then the big fintechs", () => {
  // 0123456785 fits GTB, Fidelity AND Moniepoint (9 + CBN 50515) — any number fits ~1 bank in 10
  eq(codes(candidateBanks("0123456785", BANKS)), ["090405", "058", "070", "100004", "100033", "090267"], "Moniepoint, GTB, Fidelity fit");
});

Deno.test("a Kuda-style number: Kuda's NUBAN fits, ranked above the commercial bank that also fits", () => {
  eq(codes(candidateBanks("2200001236", BANKS)), ["090267", "215", "100004", "100033", "090405"], "Kuda first");
});

Deno.test("a phone-number account goes to the phone-number fintechs first", () => {
  eq(codes(candidateBanks("8031234567", BANKS)).slice(0, 4), ["100004", "100033", "090405", "100002"], "OPay, PalmPay, Moniepoint, Paga");
});

Deno.test("platform history comes first; unknown codes and duplicates are dropped; capped", () => {
  const c = codes(candidateBanks("0123456785", BANKS, ["070", "999999", "070"]));
  eq(c[0], "070", "history first");
  eq(c.includes("999999"), false, "code not in the bank list dropped");
  eq(c.filter((x) => x === "070").length, 1, "no duplicate");
  eq(candidateBanks("0000014579", BANKS, [], 3).length, 3, "max respected");
  eq(candidateBanks("12345", BANKS), [], "not 10 digits → nothing");
});

Deno.test("name enquiry answers as a network signal", () => {
  eq(resolveSaysNetworkUp({ ok: true }), true, "resolved");
  eq(resolveSaysNetworkUp({ ok: false, type: "INVALID_ACCOUNT", msg: "Account is invalid" }), true, "no such account = bank answered");
  eq(resolveSaysNetworkUp({ ok: false, timedOut: true }), false, "timeout");
  eq(resolveSaysNetworkUp({ ok: false, status: 502, msg: "Unable to process" }), false, "5xx");
  eq(resolveSaysNetworkUp({ ok: false, status: 400, type: "UNKNOWN_BANK_CODE" }), null, "bad bank code says nothing");
  eq(resolveSaysNetworkUp({ ok: false, status: 400, msg: "Something odd" }), false, "unclear = not up");
});
