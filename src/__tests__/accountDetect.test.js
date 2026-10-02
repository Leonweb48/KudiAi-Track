import { extractAccountNumber, detectBankKey, parseCopiedAccount } from "../utils/accountDetect";

describe("extractAccountNumber — the account number in copied text", () => {
  test.each([
    ["0123456789", "0123456789"],
    ["Acct: 0123456789 GTBank Adaeze Okafor", "0123456789"],
    ["Pls send to 2200001236 kuda", "2200001236"],
    ["0123 456 789", "0123456789"],
    ["012-345-6789 access", "0123456789"],
    ["OPay 08031234567 Chidi", "8031234567"],          // full mobile number → the OPay/PalmPay account
    ["0803 123 4567 palmpay", "8031234567"],
    ["Acct 0123456789, call me on 08031234567", "0123456789"],   // the 10-digit one wins over a phone number
  ])("%s → %s", (text, want) => expect(extractAccountNumber(text)).toBe(want));

  test.each([
    ["", "empty"],
    ["hello there", "no digits"],
    ["123456789", "9 digits"],
    ["01234567891", "11 digits that aren't a mobile number"],
    ["0123456789 or 9876543210", "two different accounts — don't guess"],
    ["BVN 22212345678", "an 11-digit BVN"],
    ["ref KDT-BILL-1759912345678", "a long reference"],
  ])("%s → nothing (%s)", (text) => expect(extractAccountNumber(text)).toBe(""));
});

describe("detectBankKey — the bank the text names", () => {
  test.each([
    ["0123456789 GTBank", "gtbank"],
    ["0123456789 gtb", "gtbank"],
    ["Guaranty Trust Bank 0123456789", "gtbank"],
    ["opay 8031234567", "opay"],
    ["Palm pay", "palmpay"],
    ["Moniepoint MFB", "moniepoint"],
    ["First Bank of Nigeria", "firstbank"],
    ["FCMB", "fcmb"],
    ["First City Monument Bank", "fcmb"],
    ["UBA", "uba"],
    ["Zenith", "zenith"],
    ["Kuda", "kuda"],
  ])("%s → %s", (text, want) => expect(detectBankKey(text)).toBe(want));

  test("two banks named → no guess", () => expect(detectBankKey("GTB or Access")).toBe(""));
  test("no bank named", () => expect(detectBankKey("0123456789 Adaeze")).toBe(""));
});

describe("parseCopiedAccount — picks the entry from the transfer screen's bank list", () => {
  const banks = [
    { code: "058", name: "Guaranty Trust Bank" },
    { code: "100004", name: "OPay" },
    { code: "044", name: "Access Bank" },
  ];
  test("account + bank", () => {
    expect(parseCopiedAccount("0123456789 GTBank", banks)).toEqual({ account: "0123456789", bank: { code: "058", name: "Guaranty Trust Bank" } });
  });
  test("phone account + OPay", () => {
    expect(parseCopiedAccount("OPay 08031234567", banks)).toEqual({ account: "8031234567", bank: { code: "100004", name: "OPay" } });
  });
  test("account, bank not in the list → account only", () => {
    expect(parseCopiedAccount("0123456789 Zenith", banks)).toEqual({ account: "0123456789", bank: null });
  });
  test("no account → nothing, even if a bank is named", () => {
    expect(parseCopiedAccount("GTBank", banks)).toEqual({ account: "", bank: null });
  });
});
