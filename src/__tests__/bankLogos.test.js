import fs from "fs";
import path from "path";
import { BANKS, BANK_LOGO_DIR, bankFor, bankLogoUrl, displayBankName, bankInitials, describeBank } from "../utils/bankLogos";

const FOLDER = path.join(__dirname, "..", "..", "public", "logos", "banks");

describe("the logo files", () => {
  const onDisk = fs.readdirSync(FOLDER).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f));

  test("every listed bank has its file (exact name, case-sensitive) and a licence notice ships beside them", () => {
    for (const b of BANKS) expect(onDisk).toContain(b.file);
    expect(fs.existsSync(path.join(FOLDER, "LICENSE.txt"))).toBe(true);
  });
  test("no logo in the folder is left unlisted (a new file must be added to BANKS)", () => {
    const listed = new Set(BANKS.map((b) => b.file));
    expect(onDisk.filter((f) => !listed.has(f))).toEqual([]);
  });
  test("keys and codes are unique", () => {
    expect(new Set(BANKS.map((b) => b.key)).size).toBe(BANKS.length);
    const codes = BANKS.flatMap((b) => b.codes);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("bankFor — by code, by name, and the names a SENDING bank reports", () => {
  test("the commercial-bank codes from the Flutterwave / Paystack lists", () => {
    const expected = { "044": "access", "063": "access", "058": "gtbank", "057": "zenith", "033": "uba", "011": "firstbank", "070": "fidelity",
      "221": "stanbic", "050": "ecobank", "232": "sterling", "035": "wema", "214": "fcmb", "301": "jaiz", "215": "unity" };
    for (const [code, key] of Object.entries(expected)) expect(bankFor({ code })?.key).toBe(key);
  });
  test("a code with a missing leading zero and a numeric code still resolve", () => {
    expect(bankFor({ code: "44" })?.key).toBe("access");
    expect(bankFor({ code: 58 })?.key).toBe("gtbank");
  });
  test("bank-list names", () => {
    const names = { "Access Bank": "access", "Access Bank (Diamond)": "access", "Guaranty Trust Bank": "gtbank", "Zenith Bank": "zenith",
      "United Bank For Africa": "uba", "First Bank of Nigeria": "firstbank", "Fidelity Bank": "fidelity", "Stanbic IBTC Bank": "stanbic",
      "Ecobank Nigeria": "ecobank", "Sterling Bank": "sterling", "Wema Bank": "wema", "ALAT by WEMA": "wema",
      "First City Monument Bank": "fcmb", "Jaiz Bank": "jaiz", "Unity Bank": "unity", "VFD Microfinance Bank": "vfd" };
    for (const [name, key] of Object.entries(names)) expect(bankFor({ name })?.key).toBe(key);
  });
  test("the shouted / abbreviated names a sending bank reports on a deposit", () => {
    const names = { "WEMA BANK PLC": "wema", "ACCESS": "access", "ACCESS BANK PLC": "access", "GTBANK": "gtbank", "GTB": "gtbank",
      "ZENITH BANK PLC": "zenith", "UBA": "uba", "FIRSTBANK": "firstbank", "FBN": "firstbank", "FCMB": "fcmb", "STERLING BANK": "sterling" };
    for (const [name, key] of Object.entries(names)) expect(bankFor({ name })?.key).toBe(key);
  });
  test("the code wins over a name", () => {
    expect(bankFor({ code: "044", name: "Zenith Bank" })?.key).toBe("access");
  });
  test("banks we have NO logo for resolve to nothing — never to a wrong bank", () => {
    for (const name of ["Kuda Microfinance Bank", "OPay Digital Services Limited", "PalmPay Limited", "Moniepoint Microfinance Bank",
      "Providus Bank", "Polaris Bank", "Keystone Bank", "Mock Bank", "Flutterwave Technology solutions Limited", "Access Money", "First Trust Mortgage Bank", "Union Bank of Nigeria"])
      expect(bankFor({ name })).toBeNull();
    for (const code of ["090405", "100004", "999992", "090567", "000000"]) expect(bankFor({ code })).toBeNull();
    expect(bankFor({})).toBeNull();
    expect(bankFor()).toBeNull();
  });
});

describe("bankLogoUrl", () => {
  test("points into public/logos/banks/", () => {
    expect(BANK_LOGO_DIR).toBe("/logos/banks/");
    expect(bankLogoUrl({ code: "058" })).toBe("/logos/banks/gtbank.png");
    expect(bankLogoUrl({ name: "WEMA BANK PLC" })).toBe("/logos/banks/wema.png");
    expect(bankLogoUrl({ name: "OPay" })).toBeNull();
  });
});

describe("displayBankName", () => {
  test("a name the bank list gave us is kept as it is", () => {
    expect(displayBankName({ code: "044", name: "Access Bank" })).toBe("Access Bank");
    expect(displayBankName({ name: "Kuda Microfinance Bank" })).toBe("Kuda Microfinance Bank");
    expect(displayBankName({ code: "058", name: "Guaranty Trust Bank" })).toBe("Guaranty Trust Bank");
  });
  test("a known bank reported in capitals is written our way", () => {
    expect(displayBankName({ name: "WEMA BANK PLC" })).toBe("Wema Bank");
    expect(displayBankName({ name: "ACCESS" })).toBe("Access Bank");
    expect(displayBankName({ name: "GTBANK" })).toBe("GTBank");
  });
  test("an unknown bank reported in capitals is title-cased, keeping the usual acronyms", () => {
    expect(displayBankName({ name: "KUDA MICROFINANCE BANK" })).toBe("Kuda Microfinance Bank");
    expect(displayBankName({ name: "TITAN TRUST MFB PLC" })).toBe("Titan Trust MFB");
  });
  test("nothing / only an unknown code -> empty", () => {
    expect(displayBankName({})).toBe("");
    expect(displayBankName({ code: "090405" })).toBe("");
  });
  test("no code + no name but a known code -> the bank's own name", () => {
    expect(displayBankName({ code: "057" })).toBe("Zenith Bank");
  });
});

describe("bankInitials", () => {
  test("two letters for the no-logo tile", () => {
    expect(bankInitials("Kuda Microfinance Bank")).toBe("KU");
    expect(bankInitials("OPay Digital Services Limited")).toBe("OP");
    expect(bankInitials("First Trust Mortgage Bank")).toBe("FT");
    expect(bankInitials("Guaranty Trust Bank")).toBe("GT");
    expect(bankInitials("OPay")).toBe("OP");
    expect(bankInitials("Moniepoint Microfinance Bank")).toBe("MO");
    expect(bankInitials("Microfinance Bank")).toBe("MB");   // nothing distinctive left: fall back to what there is
    expect(bankInitials("")).toBe("?");
    expect(bankInitials("of the")).toBe("?");
  });
});

describe("describeBank", () => {
  test("a known bank: display name, logo and initials", () => {
    expect(describeBank({ name: "WEMA BANK PLC" })).toEqual({ name: "Wema Bank", code: "", logoUrl: "/logos/banks/wema.png", initials: "WE" });
    const t = describeBank({ code: "058", name: "Guaranty Trust Bank" });
    expect(t.name).toBe("Guaranty Trust Bank");
    expect(t.logoUrl).toBe("/logos/banks/gtbank.png");
  });
  test("a bank with no logo still gets a name (and no logo)", () => {
    expect(describeBank({ code: "999992", name: "OPay Digital Services Limited" })).toEqual({ name: "OPay Digital Services Limited", code: "999992", logoUrl: null, initials: "OP" });
  });
  test("we cannot name it -> null (a bare unknown code is not printed on a receipt)", () => {
    expect(describeBank({})).toBeNull();
    expect(describeBank({ code: "090405" })).toBeNull();
    expect(describeBank()).toBeNull();
  });
});
