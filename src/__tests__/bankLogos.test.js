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
  test("fintechs and payment banks — by the codes BOTH providers use (Flutterwave's differ from Paystack's)", () => {
    const expected = { "999992": "opay", "100004": "opay", "999991": "palmpay", "100033": "palmpay", "50211": "kuda", "090267": "kuda",
      "50515": "moniepoint", "090405": "moniepoint", "565": "carbon", "51318": "fairmoney", "100002": "paga", "125": "rubies", "51310": "sparkle",
      "50126": "eyowo", "51269": "tangerine", "50304": "mint", "120004": "airtel", "120003": "momo", "120002": "hope", "120001": "ninepsb",
      "090567": "flutterwave", "51457": "paystack", "100039": "paystack" };
    for (const [code, key] of Object.entries(expected)) expect(bankFor({ code })?.key).toBe(key);
  });
  test("more banks — by code", () => {
    const expected = { "101": "providus", "076": "polaris", "082": "keystone", "032": "union", "102": "titan", "00103": "globus", "068": "standardchartered",
      "023": "citibank", "100": "suntrust", "104": "parallex", "303": "lotus", "105": "premiumtrust", "106": "signature", "107": "optimus",
      "561": "nova", "302": "taj", "559": "coronation", "501": "fsdh", "502": "rand" };
    for (const [code, key] of Object.entries(expected)) expect(bankFor({ code })?.key).toBe(key);
  });
  test("fintech and merchant-bank names, as the lists and the sending banks spell them", () => {
    const names = { "OPay Digital Services Limited (OPay)": "opay", "OPAY DIGITAL SERVICES LIMITED": "opay", "Paycom": "opay", "PalmPay Limited": "palmpay", "PALMPAY": "palmpay",
      "Kuda Microfinance Bank": "kuda", "KUDA BANK": "kuda", "Moniepoint MFB": "moniepoint", "MONIEPOINT MICROFINANCE BANK": "moniepoint",
      "Carbon": "carbon", "Fairmoney Microfinance Bank": "fairmoney", "Paga": "paga", "Rubies MFB": "rubies", "Sparkle Microfinance Bank": "sparkle",
      "Eyowo": "eyowo", "Tangerine Money": "tangerine", "Mint MFB": "mint", "MINT-FINEX MFB": "mint", "Airtel Smartcash PSB": "airtel", "MTN Momo PSB": "momo",
      "HopePSB": "hope", "9mobile 9Payment Service Bank": "ninepsb", "Flutterwave MFB": "flutterwave", "Flutterwave Technology solutions Limited": "flutterwave",
      "Paystack MFB": "paystack", "Paystack-Titan": "paystack", "Providus Bank": "providus", "Polaris Bank": "polaris", "Keystone Bank": "keystone",
      "Union Bank of Nigeria": "union", "Titan Trust Bank": "titan", "Globus Bank": "globus", "Standard Chartered Bank": "standardchartered",
      "Citibank Nigeria": "citibank", "Suntrust Bank": "suntrust", "Parallex Bank": "parallex", "Lotus Bank": "lotus", "PremiumTrust Bank": "premiumtrust",
      "Signature Bank Ltd": "signature", "Optimus Bank Limited": "optimus", "NOVA BANK": "nova", "TAJ Bank": "taj", "Coronation Merchant Bank": "coronation",
      "FSDH Merchant Bank Limited": "fsdh", "Rand Merchant Bank": "rand" };
    for (const [name, key] of Object.entries(names)) expect([name, bankFor({ name })?.key]).toEqual([name, key]);
  });
  test("look-alikes are NOT mistaken for them", () => {
    for (const name of ["Access Money", "First Trust Mortgage Bank", "Astrapolaris MFB LTD", "RANDALPHA MICROFINANCE BANK", "Union Trust MFB", "Novaland MFB", "Carbonate Bank", "Copay Systems"])
      expect([name, bankFor({ name })]).toEqual([name, null]);
  });
  test("banks we have NO logo for resolve to nothing — never to a wrong bank", () => {
    for (const name of ["Heritage Bank", "Mock Bank", "Hayat Trust MFB", "Lagos Building Investment Company Plc.", "TRUSTBANC J6 MICROFINANCE BANK"])
      expect(bankFor({ name })).toBeNull();
    for (const code of ["030", "090999", "000000", "123456"]) expect(bankFor({ code })).toBeNull();
    expect(bankFor({})).toBeNull();
    expect(bankFor()).toBeNull();
  });
});

describe("bankLogoUrl", () => {
  test("points into public/logos/banks/", () => {
    expect(BANK_LOGO_DIR).toBe("/logos/banks/");
    expect(bankLogoUrl({ code: "058" })).toBe("/logos/banks/gtbank.png");
    expect(bankLogoUrl({ name: "WEMA BANK PLC" })).toBe("/logos/banks/wema.png");
    expect(bankLogoUrl({ name: "OPay" })).toBe("/logos/banks/opay.png");
    expect(bankLogoUrl({ name: "Heritage Bank" })).toBeNull();
  });
});

describe("displayBankName", () => {
  test("a name the bank list gave us is kept as it is", () => {
    expect(displayBankName({ code: "044", name: "Access Bank" })).toBe("Access Bank");
    expect(displayBankName({ name: "Heritage Bank" })).toBe("Heritage Bank");
    expect(displayBankName({ code: "058", name: "Guaranty Trust Bank" })).toBe("Guaranty Trust Bank");
    expect(displayBankName({ name: "Providus Bank" })).toBe("Providus Bank");
  });
  test("the legalese names of fintechs are always written short", () => {
    expect(displayBankName({ code: "100004", name: "OPay Digital Services Limited (OPay)" })).toBe("OPay");
    expect(displayBankName({ name: "PalmPay Limited" })).toBe("PalmPay");
    expect(displayBankName({ name: "Kuda Microfinance Bank" })).toBe("Kuda Bank");
    expect(displayBankName({ name: "MONIEPOINT MICROFINANCE BANK" })).toBe("Moniepoint");
  });
  test("a known bank reported in capitals is written our way", () => {
    expect(displayBankName({ name: "WEMA BANK PLC" })).toBe("Wema Bank");
    expect(displayBankName({ name: "ACCESS" })).toBe("Access Bank");
    expect(displayBankName({ name: "GTBANK" })).toBe("GTBank");
  });
  test("an unknown bank reported in capitals is title-cased, keeping the usual acronyms", () => {
    expect(displayBankName({ name: "HAYAT TRUST MFB" })).toBe("Hayat Trust MFB");
    expect(displayBankName({ name: "HERITAGE BANK PLC" })).toBe("Heritage Bank");
  });
  test("nothing / only an unknown code -> empty", () => {
    expect(displayBankName({})).toBe("");
    expect(displayBankName({ code: "090999" })).toBe("");
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
  test("a fintech: short name + its logo, from either provider's code", () => {
    expect(describeBank({ code: "100004", name: "OPay Digital Services Limited (OPay)" })).toEqual({ name: "OPay", code: "100004", logoUrl: "/logos/banks/opay.png", initials: "OP" });
    expect(describeBank({ code: "090405" })).toEqual({ name: "Moniepoint", code: "090405", logoUrl: "/logos/banks/moniepoint.png", initials: "MO" });
  });
  test("a bank with no logo still gets a name (and no logo)", () => {
    expect(describeBank({ code: "030", name: "Heritage Bank" })).toEqual({ name: "Heritage Bank", code: "030", logoUrl: null, initials: "HE" });
  });
  test("we cannot name it -> null (a bare unknown code is not printed on a receipt)", () => {
    expect(describeBank({})).toBeNull();
    expect(describeBank({ code: "090999" })).toBeNull();
    expect(describeBank()).toBeNull();
  });
});
