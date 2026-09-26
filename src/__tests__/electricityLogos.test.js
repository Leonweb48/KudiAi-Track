import fs from "fs";
import path from "path";
import {
  ELECTRICITY_LOGO_DIR, ELECTRICITY_LOGO_FILES, DISCO_BY_CODE, discoFromText, discoFromRecord, electricityLogoUrl,
} from "../utils/electricityLogos";
import { getProviderLogo, getProviderBadge } from "../utils/logoMap";
import { buildBillReceipt } from "../utils/receiptConfig";

const FOLDER = path.join(__dirname, "..", "..", "public", "logos", "electricity logos");

describe("the logo files", () => {
  const onDisk = fs.readdirSync(FOLDER).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f));

  test("every DISCO in the map has its file in public/logos/electricity logos/ (exact name, case-sensitive)", () => {
    for (const [disco, file] of Object.entries(ELECTRICITY_LOGO_FILES)) expect(onDisk).toContain(file);
  });

  test("no logo in the folder is left unmapped (a new/renamed file must be added to the map)", () => {
    const mapped = new Set(Object.values(ELECTRICITY_LOGO_FILES));
    expect(onDisk.filter((f) => !mapped.has(f))).toEqual([]);
  });

  test("the 11 old electricity SVGs are gone (APLE keeps its own)", () => {
    const logosDir = path.join(FOLDER, "..");
    for (const d of ["ekedc", "ikedc", "aedc", "kedc", "phedc", "jedc", "ibedc", "kaedc", "eedc", "bedc", "yedc"])
      expect(fs.existsSync(path.join(logosDir, `${d}.svg`))).toBe(false);
    expect(fs.existsSync(path.join(logosDir, "aple.svg"))).toBe(true);
  });
});

describe("electricityLogoUrl", () => {
  test("encodes the folder's space so the URL is valid everywhere (HTML, PDF loader, WebView)", () => {
    expect(electricityLogoUrl("EKEDC")).toBe("/logos/electricity%20logos/ekedc%20(Eko).png");
    expect(electricityLogoUrl("ekedc")).toBe(electricityLogoUrl("EKEDC"));
    expect(electricityLogoUrl("PHEDC")).toBe("/logos/electricity%20logos/phedc%20(port%20harcout).png");
    expect(ELECTRICITY_LOGO_DIR).toBe("/logos/electricity logos/");
  });
  test("a DISCO without a logo, or garbage, has none", () => {
    expect(electricityLogoUrl("APLE")).toBeNull();
    expect(electricityLogoUrl("NOPE")).toBeNull();
    expect(electricityLogoUrl(null)).toBeNull();
  });
});

describe("discoFromText", () => {
  test("reads the abbreviation, telling AEDC / KAEDC / KEDC / EKEDC apart", () => {
    expect(discoFromText("AEDC (Abuja)")).toBe("AEDC");
    expect(discoFromText("KAEDC (Kaduna) Prepaid")).toBe("KAEDC");
    expect(discoFromText("KEDC (Kano)")).toBe("KEDC");
    expect(discoFromText("EKEDC (Eko)")).toBe("EKEDC");
    expect(discoFromText("ekedc")).toBe("EKEDC");
    expect(discoFromText("IBEDC (Ibadan) Postpaid")).toBe("IBEDC");
    expect(discoFromText("EEDC (Enugu)")).toBe("EEDC");
    expect(discoFromText("BEDC (Benin)")).toBe("BEDC");
    expect(discoFromText("APLE (Abuja)")).toBe("APLE");       // APLE is in Abuja too — its abbreviation wins
  });
  test("reads a long company name when there is no abbreviation", () => {
    expect(discoFromText("Ikeja Electric")).toBe("IKEDC");
    expect(discoFromText("Port Harcourt Electricity Distribution Company")).toBe("PHEDC");
    expect(discoFromText("Eko Electricity Distribution Company")).toBe("EKEDC");
    expect(discoFromText("Kaduna Electric")).toBe("KAEDC");
    expect(discoFromText("Ikeja Electric", { allowNames: false })).toBeNull();
  });
  test("nothing / unrelated text -> null", () => {
    for (const v of [null, undefined, "", "   ", "MTN Airtime", "Prepaid"]) expect(discoFromText(v)).toBeNull();
  });
});

describe("discoFromRecord — every shape a stored electricity bill can have", () => {
  test("client-recorded item name / provider", () => {
    expect(discoFromRecord({ item_name: "IKEDC (Ikeja) Prepaid" })).toBe("IKEDC");
    expect(discoFromRecord({ providerName: "KAEDC (Kaduna)", item_name: "" })).toBe("KAEDC");
  });
  test("the payment webhook stores the company CODE in front of the item name", () => {
    expect(discoFromRecord({ item_name: "01 Electric" })).toBe("EKEDC");
    expect(discoFromRecord({ item_name: "08 Electric" })).toBe("KAEDC");
    expect(discoFromRecord({ item_name: "11 Electric" })).toBe("YEDC");
    for (const [code, disco] of Object.entries(DISCO_BY_CODE)) expect(discoFromRecord({ item_name: `${code} Electric` })).toBe(disco);
  });
  test("structured bill_details win", () => {
    expect(discoFromRecord({ bill_details: { company: "PHEDC" }, item_name: "" })).toBe("PHEDC");
    expect(discoFromRecord({ bill_details: { company: "03" }, item_name: "Electric" })).toBe("AEDC");
  });
  test("falls back to the note's Provider: part, and only reads abbreviations elsewhere in the note", () => {
    expect(discoFromRecord({ item_name: "", note: "Meter: 123 | Type: Prepaid | Provider: JEDC (Jos) | Phone: 080" })).toBe("JEDC");
    expect(discoFromRecord({ item_name: "", note: "Meter: 123 | Token: 1234 | customer Kano Traders" })).toBeNull();   // a customer name is not a DISCO
  });
  test("no information -> null; a phone number is not a company code", () => {
    expect(discoFromRecord({})).toBeNull();
    expect(discoFromRecord(null)).toBeNull();
    expect(discoFromRecord({ item_name: "08012345678" })).toBeNull();
  });
});

describe("getProviderLogo / getProviderBadge for electricity", () => {
  test("every DISCO resolves to its own new logo", () => {
    for (const disco of Object.keys(ELECTRICITY_LOGO_FILES)) {
      expect(getProviderLogo(disco, "electricity")).toBe(electricityLogoUrl(disco));
      expect(getProviderLogo(`${disco} (city) Prepaid`, "electricity")).toBe(electricityLogoUrl(disco));
    }
  });
  test("Kaduna gets the Kaduna logo, not Abuja's (AEDC used to win by substring)", () => {
    expect(getProviderLogo("KAEDC (Kaduna)", "electricity")).toBe(electricityLogoUrl("KAEDC"));
    expect(getProviderLogo("KAEDC (Kaduna)", "electricity")).not.toBe(electricityLogoUrl("AEDC"));
    expect(getProviderBadge("KAEDC (Kaduna)", "electricity").bg).toBe(getProviderBadge("KAEDC", "electricity").bg);
    expect(getProviderBadge("KAEDC (Kaduna)", "electricity").bg).not.toBe(getProviderBadge("AEDC", "electricity").bg);
  });
  test("no logo ever points at the removed SVGs", () => {
    for (const disco of Object.keys(ELECTRICITY_LOGO_FILES)) expect(getProviderLogo(disco, "electricity")).not.toMatch(/\.svg$/);
  });
  test("APLE keeps its badge svg; other categories are unchanged", () => {
    expect(getProviderLogo("APLE", "electricity")).toBe("/logos/aple.svg");
    expect(getProviderLogo("MTN", "airtime")).toBe("/mtn.png");
    expect(getProviderLogo("Glo", "data")).toBe("/glo.jpg");
    expect(getProviderLogo("DSTV", "cable")).toBe("/logos/bills/dstv.png");
    expect(getProviderLogo("SportyBet", "betting")).toBe("/logos/bills/sportybet.png");
    expect(getProviderLogo("9mobile", "airtime")).toBe("/9mobile.png");
  });
  test("a city word only counts as a DISCO for electricity (a Kano-named cable customer is not IKEDC/KEDC)", () => {
    expect(getProviderLogo("Kano Traders", "cable")).toBeNull();
  });
});

describe("buildBillReceipt — electricity receipts carry the DISCO", () => {
  const base = { category: "electricity", amount: 5000, created_at: "2026-09-20T10:00:00Z", bill_status: "success", meterNo: "12345678901" };

  test("a receipt recorded by the app (name in the item + provider)", () => {
    const r = buildBillReceipt({ ...base, item_name: "EKEDC (Eko) Prepaid", providerName: "EKEDC (Eko)" });
    expect(r.provider).toBe("EKEDC");
    expect(getProviderLogo(r.provider, r.category)).toBe(electricityLogoUrl("EKEDC"));
    expect(r.fields.find((f) => f.label === "Provider").value).toBe("EKEDC (Eko)");
  });
  test("an OLDER receipt written by the webhook (only a company code) now shows the DISCO and a Provider row", () => {
    const r = buildBillReceipt({ ...base, item_name: "08 Electric", providerName: "" });
    expect(r.provider).toBe("KAEDC");
    expect(getProviderLogo(r.provider, r.category)).toBe(electricityLogoUrl("KAEDC"));
    expect(r.fields.find((f) => f.label === "Provider").value).toBe("KAEDC (Kaduna)");
  });
  test("a record that names no DISCO gets no invented one", () => {
    const r = buildBillReceipt({ ...base, item_name: "Electric" });
    expect(r.provider).toBeNull();
    expect(r.fields.find((f) => f.label === "Provider")).toBeUndefined();
  });
  test("non-electricity receipts are untouched", () => {
    const r = buildBillReceipt({ category: "airtime", amount: 500, network: "MTN", item_name: "MTN Airtime", bill_status: "success", created_at: "2026-09-20T10:00:00Z" });
    expect(r.provider).toBe("MTN");
    expect(r.category).toBe("airtime");
  });
});
