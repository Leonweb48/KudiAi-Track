import React, { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "fs";
import path from "path";
import { BILL_BRANDS, BILL_LOGO_DIR, billBrandFromText, billBrandFromRecord, billBrandForCategory, billLogoUrl } from "../utils/billLogos";
import { getProviderLogo, getProviderBadge } from "../utils/logoMap";
import { buildBillReceipt } from "../utils/receiptConfig";
import { ReceiptCard } from "../components/shared/ReceiptCard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LOGOS = path.join(__dirname, "..", "..", "public", "logos");
const FOLDER = path.join(LOGOS, "bills");
const names = (cat) => BILL_BRANDS.filter((b) => b.category === cat).map((b) => b.name);

describe("the logo files", () => {
  const onDisk = fs.readdirSync(FOLDER).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f));

  test("every provider that lists a file has it (exact name, case-sensitive), and a notice ships beside them", () => {
    for (const b of BILL_BRANDS) if (b.file) expect(onDisk).toContain(b.file);
    expect(fs.existsSync(path.join(FOLDER, "LICENSE.txt"))).toBe(true);
  });
  test("no logo in the folder is left unlisted (a new file must be added to BILL_BRANDS)", () => {
    const listed = new Set(BILL_BRANDS.map((b) => b.file).filter(Boolean));
    expect(onDisk.filter((f) => !listed.has(f))).toEqual([]);
  });
  test("names and files are unique; only MerryBet is still without a logo", () => {
    expect(new Set(BILL_BRANDS.map((b) => b.name)).size).toBe(BILL_BRANDS.length);
    const files = BILL_BRANDS.map((b) => b.file).filter(Boolean);
    expect(new Set(files).size).toBe(files.length);
    expect(BILL_BRANDS.filter((b) => !b.file).map((b) => b.name)).toEqual(["MerryBet"]);
  });
  test("the hand-drawn placeholder SVGs are gone (APLE's electricity badge is the one that stays)", () => {
    for (const f of ["dstv", "gotv", "startimes", "showmax", "nairabet", "betway", "sportybet", "betking", "1xbet", "merrybet", "bangbet", "naijabet", "betland", "waec", "jamb", "spectranet", "smile"])
      expect(fs.existsSync(path.join(LOGOS, `${f}.svg`))).toBe(false);
    expect(fs.existsSync(path.join(LOGOS, "aple.svg"))).toBe(true);
  });
});

describe("billBrandFromText — every spelling a bill can carry", () => {
  test("the names the app lists", () => {
    for (const b of BILL_BRANDS) expect(billBrandFromText(b.name, b.category)?.name).toBe(b.name);
  });
  test("the raw product codes the payment webhook stores instead of a name", () => {
    const codes = { dstv: "DSTV", gotv: "GOtv", startimes: "StarTimes", showmax: "Showmax", "product-nairabet": "NairaBet", "product-bang-bet": "BangBet",
      "product-bet-way": "Betway", "product-bet-land": "BetLand", "product-bet-king": "BetKing", "product-1x-bet": "1xBet", "product-naija-bet": "NaijaBet",
      "prd-sporty-bet": "SportyBet", "product-merry-bet": "MerryBet" };
    for (const [code, name] of Object.entries(codes)) expect([code, billBrandFromText(code)?.name]).toEqual([code, name]);
  });
  test("inside a longer item name; in any case", () => {
    expect(billBrandFromText("DStv Compact Plus")?.name).toBe("DSTV");
    expect(billBrandFromText("Sporty Bet Wallet Top-up")?.name).toBe("SportyBet");
    expect(billBrandFromText("STARTIMES NOVA")?.name).toBe("StarTimes");
    expect(billBrandFromText("Smile 4G 10GB")?.name).toBe("Smile");
  });
  test("a category restricts the search (a betting text is not a cable provider)", () => {
    expect(billBrandFromText("Betway", "cable")).toBeNull();
    expect(billBrandFromText("DSTV", "betting")).toBeNull();
    expect(billBrandFromText("MTN", "airtime")).toBeNull();   // networks are not handled here
  });
  test("look-alikes and nothing are not brands", () => {
    for (const t of ["", "   ", null, undefined, "Kano Traders", "Smiley Shop", "21xBetter", "Star Timesheet Ltd"]) expect([t, billBrandFromText(t)]).toEqual([t, null]);
  });
});

describe("billBrandFromRecord — every shape a stored bill can have", () => {
  test("recorded by the app: display names", () => {
    expect(billBrandFromRecord({ category: "cable", providerName: "DSTV", item_name: "DSTV Compact" })?.name).toBe("DSTV");
    expect(billBrandFromRecord({ category: "betting", platformName: "NairaBet", item_name: "NairaBet Wallet Top-up" })?.name).toBe("NairaBet");
  });
  test("written by the payment webhook: only a raw code", () => {
    expect(billBrandFromRecord({ category: "cable", item_name: "dstv Compact", note: "Provider: dstv | Smartcard: 123" })?.name).toBe("DSTV");
    expect(billBrandFromRecord({ category: "betting", item_name: "product-bang-bet Wallet", note: "Customer: 123" })?.name).toBe("BangBet");
    expect(billBrandFromRecord({ category: "betting", item_name: "prd-sporty-bet Wallet" })?.name).toBe("SportyBet");
  });
  test("the note when nothing else says", () => {
    expect(billBrandFromRecord({ category: "cable", item_name: "Compact", note: "Provider: GOtv | Package: Max" })?.name).toBe("GOtv");
    expect(billBrandFromRecord({ category: "betting", item_name: "", note: "Platform: BetKing | Customer: 9" })?.name).toBe("BetKing");
  });
  test("structured bill_details", () => {
    expect(billBrandFromRecord({ category: "betting", item_name: "", bill_details: { company: "product-1x-bet" } })?.name).toBe("1xBet");
  });
  test("a single-provider category IS its provider", () => {
    for (const [cat, name] of [["waec", "WAEC"], ["jamb", "JAMB"], ["spectranet", "Spectranet"], ["smile", "Smile"]]) {
      expect(billBrandFromRecord({ category: cat, item_name: "" })?.name).toBe(name);
      expect(billBrandForCategory(cat)?.name).toBe(name);
    }
    expect(billBrandForCategory("cable")).toBeNull();
  });
  test("other categories and empty records have none", () => {
    expect(billBrandFromRecord({ category: "airtime", item_name: "MTN Airtime" })).toBeNull();
    expect(billBrandFromRecord({ category: "electricity", item_name: "EKEDC" })).toBeNull();
    expect(billBrandFromRecord({ category: "cable", item_name: "" })).toBeNull();
    expect(billBrandFromRecord(null)).toBeNull();
  });
});

describe("getProviderLogo / getProviderBadge", () => {
  test("every provider the selectors list resolves to its own logo", () => {
    for (const cat of ["cable", "betting"])
      for (const name of names(cat)) {
        const b = BILL_BRANDS.find((x) => x.name === name);
        expect([name, getProviderLogo(name, cat)]).toEqual([name, b.file ? BILL_LOGO_DIR + b.file : null]);
      }
    expect(getProviderLogo("DSTV", "cable")).toBe("/logos/bills/dstv.png");
    expect(getProviderLogo("1xBet", "betting")).toBe("/logos/bills/1xbet.png");
  });
  test("the webhook's raw codes find them too", () => {
    expect(getProviderLogo("dstv", "cable")).toBe("/logos/bills/dstv.png");
    expect(getProviderLogo("product-bang-bet", "betting")).toBe("/logos/bills/bangbet.png");
  });
  test("single-provider categories resolve by category alone", () => {
    for (const [cat, file] of [["waec", "waec.png"], ["jamb", "jamb.png"], ["spectranet", "spectranet.png"], ["smile", "smile.png"]])
      expect(getProviderLogo(null, cat)).toBe(BILL_LOGO_DIR + file);
  });
  test("MerryBet has no logo — null, not a look-alike — but still has its badge colour", () => {
    expect(getProviderLogo("MerryBet", "betting")).toBeNull();
    expect(getProviderBadge("MerryBet", "betting").bg).toBe("#c00000");
  });
  test("networks, electricity and the unknown are unchanged", () => {
    expect(getProviderLogo("MTN", "airtime")).toBe("/mtn.png");
    expect(getProviderLogo("EKEDC", "electricity")).toMatch(/electricity%20logos/);
    expect(getProviderLogo("Kano Traders", "cable")).toBeNull();
    expect(getProviderLogo(null, "cable")).toBeNull();
  });
  test("billLogoUrl", () => {
    expect(billLogoUrl(BILL_BRANDS[0])).toBe("/logos/bills/dstv.png");
    expect(billLogoUrl(BILL_BRANDS.find((b) => b.name === "MerryBet"))).toBeNull();
    expect(billLogoUrl(null)).toBeNull();
  });
});

describe("buildBillReceipt — every bill receipt carries its provider", () => {
  const base = { amount: 5000, created_at: "2026-09-20T10:00:00Z", bill_status: "success" };
  const row = (r, label) => r.fields.find((f) => f.label === label);

  test("cable, recorded by the app", () => {
    const r = buildBillReceipt({ ...base, category: "cable", item_name: "DSTV Compact", providerName: "DSTV", smartcard: "1234567890" });
    expect(r.provider).toBe("DSTV");
    expect(getProviderLogo(r.provider, r.category)).toBe("/logos/bills/dstv.png");
  });
  test("an OLDER cable receipt from the webhook shows a proper name, not the raw code", () => {
    const r = buildBillReceipt({ ...base, category: "cable", item_name: "gotv Max", providerName: "gotv", smartcard: "123" });
    expect(r.provider).toBe("GOtv");
    expect(row(r, "Provider").value).toBe("GOtv");
    expect(getProviderLogo(r.provider, r.category)).toBe("/logos/bills/gotv.png");
  });
  test("an older betting receipt (only a raw code) gets its logo and a Platform row", () => {
    const r = buildBillReceipt({ ...base, category: "betting", item_name: "product-bang-bet Wallet", customerId: "77" });
    expect(r.provider).toBe("BangBet");
    expect(row(r, "Platform").value).toBe("BangBet");
    expect(getProviderLogo(r.provider, r.category)).toBe("/logos/bills/bangbet.png");
  });
  test("a betting receipt from the app", () => {
    const r = buildBillReceipt({ ...base, category: "betting", item_name: "SportyBet Wallet Top-up", platformName: "SportyBet", customerId: "77" });
    expect(r.provider).toBe("SportyBet");
    expect(row(r, "Platform").value).toBe("SportyBet");
  });
  test("MerryBet is named on the receipt even though it has no logo", () => {
    const r = buildBillReceipt({ ...base, category: "betting", item_name: "MerryBet Wallet Top-up", platformName: "MerryBet" });
    expect(r.provider).toBe("MerryBet");
    expect(row(r, "Platform").value).toBe("MerryBet");
    expect(getProviderLogo(r.provider, r.category)).toBeNull();
  });
  test("exam pins and internet: the category is the provider", () => {
    for (const [cat, name] of [["waec", "WAEC"], ["jamb", "JAMB"], ["spectranet", "Spectranet"], ["smile", "Smile"]]) {
      const r = buildBillReceipt({ ...base, category: cat, item_name: `${name} plan` });
      expect(r.provider).toBe(name);
      expect(getProviderLogo(r.provider, r.category)).toMatch(/^\/logos\/bills\//);
    }
  });
  test("airtime / data receipts are unchanged", () => {
    const r = buildBillReceipt({ ...base, category: "airtime", item_name: "MTN Airtime", network: "MTN" });
    expect(r.provider).toBe("MTN");
    expect(row(r, "Platform")).toBeUndefined();
  });
});

describe("the receipt card", () => {
  let host, root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const spec = (bill) => buildBillReceipt({ amount: 5000, created_at: "2026-09-20T10:00:00Z", bill_status: "success", ...bill });

  test("a betting receipt shows the platform's wordmark with room to breathe", () => {
    act(() => root.render(<ReceiptCard data={spec({ category: "betting", item_name: "SportyBet Wallet Top-up", platformName: "SportyBet" })} />));
    const img = host.querySelector('img[src="/logos/bills/sportybet.png"]');
    expect(img).not.toBeNull();
    // bounded by max-width / max-height only, so the browser AND the shared-image renderer both keep the logo's own proportions
    expect(img.style.maxWidth).toBe("150px");
    expect(img.style.maxHeight).toBe("44px");
    expect(img.style.height).toBe("auto");
    expect(img.style.objectFit).toBe("");
  });
  test("a network receipt keeps its small square icon", () => {
    act(() => root.render(<ReceiptCard data={spec({ category: "airtime", item_name: "MTN Airtime", network: "MTN" })} />));
    const img = host.querySelector('img[src="/mtn.png"]');
    expect(img).not.toBeNull();
    expect(img.style.maxWidth).toBe("88px");
  });
  test("MerryBet gets an initials tile", () => {
    act(() => root.render(<ReceiptCard data={spec({ category: "betting", item_name: "MerryBet Wallet Top-up", platformName: "MerryBet" })} />));
    expect(host.querySelector('img[src^="/logos/bills/"]')).toBeNull();
    expect(host.textContent).toContain("ME");
  });
});
