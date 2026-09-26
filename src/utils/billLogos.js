// Logos for the bill providers that are not banks or electricity companies — cable TV, betting wallets, exam pins and internet
// — plus ONE place that works out which provider a bill belongs to.
//
// The logo files live in public/logos/bills/ (PNG; sources and licences in the LICENSE.txt in that folder). A stored bill can
// name its provider in several shapes, all handled here so the bill screen, the receipt card and the receipt PDF agree:
//   • "DSTV" / "SportyBet"            – the display name the app records
//   • "dstv" / "product-bang-bet" / "prd-sporty-bet"  – the raw product code the payment webhook stores instead of a name
//   • a category with only one provider (WAEC, JAMB, Spectranet, Smile) – the category itself is the provider
//
// A provider with `file: null` has no logo yet and shows an initials tile (never a made-up logo). To add one: drop the PNG into
// public/logos/bills/ and set its `file` (a jest test fails if a file there is not listed).

export const BILL_LOGO_DIR = "/logos/bills/";

// category → the providers we list for it. `match` is tested on the text a bill carries (any of the shapes above).
export const BILL_BRANDS = [
  { name: "DSTV",       category: "cable",      file: "dstv.png",       match: /\bdstv\b/i },
  { name: "GOtv",       category: "cable",      file: "gotv.png",       match: /\bgotv\b/i },
  { name: "StarTimes",  category: "cable",      file: "startimes.png",  match: /star[\s-]?times?\b/i },
  { name: "Showmax",    category: "cable",      file: "showmax.png",    match: /showmax/i },

  { name: "NairaBet",   category: "betting",    file: "nairabet.png",   match: /naira[\s-]?bet/i },
  { name: "BangBet",    category: "betting",    file: "bangbet.png",    match: /bang[\s-]?bet/i },
  { name: "Betway",     category: "betting",    file: "betway.png",     match: /bet[\s-]?way/i },
  { name: "BetLand",    category: "betting",    file: "betland.png",    match: /bet[\s-]?land/i },
  { name: "BetKing",    category: "betting",    file: "betking.png",    match: /bet[\s-]?king/i },
  { name: "1xBet",      category: "betting",    file: "1xbet.png",      match: /\b1[\s-]?x[\s-]?bet\b/i },
  { name: "NaijaBet",   category: "betting",    file: "naijabet.png",   match: /naija[\s-]?bet/i },
  { name: "SportyBet",  category: "betting",    file: "sportybet.png",  match: /sporty[\s-]?bet/i },
  { name: "MerryBet",   category: "betting",    file: null,             match: /merry[\s-]?bet/i },   // no clean logo available yet

  { name: "WAEC",       category: "waec",       file: "waec.png",       match: /\bwaec\b/i },
  { name: "JAMB",       category: "jamb",       file: "jamb.png",       match: /\bjamb\b/i },
  { name: "Spectranet", category: "spectranet", file: "spectranet.png", match: /spectranet/i },
  { name: "Smile",      category: "smile",      file: "smile.png",      match: /\bsmile\b/i },
];

const CATEGORIES = new Set(BILL_BRANDS.map((b) => b.category));
// Categories with exactly one provider: the category alone identifies it
const SOLO = { waec: "WAEC", jamb: "JAMB", spectranet: "Spectranet", smile: "Smile" };

/** The brand a piece of text names, or null. With a category, only that category's providers are considered. */
export function billBrandFromText(text, category) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (category && !CATEGORIES.has(category)) return null;
  return BILL_BRANDS.find((b) => (!category || b.category === category) && b.match.test(t)) || null;
}

/** The provider of a single-provider category (WAEC, JAMB, Spectranet, Smile), or null. */
export function billBrandForCategory(category) {
  const name = SOLO[category];
  return name ? BILL_BRANDS.find((b) => b.name === name) : null;
}

/** Which provider a stored bill belongs to — reads every shape a record can carry — or null. */
export function billBrandFromRecord(bill) {
  if (!bill) return null;
  const cat = bill.category;
  if (!CATEGORIES.has(cat)) return null;
  const bd = bill.bill_details || {};
  for (const c of [bill.providerName, bill.platformName, bill.provider, bd.provider, bd.company, bd.platform, bill.item_name]) {
    const b = billBrandFromText(c, cat);
    if (b) return b;
  }
  const inNote = /(?:Provider|Platform):\s*([^|]+)/i.exec(bill.note || "");
  return billBrandFromText(inNote && inNote[1], cat) || billBrandForCategory(cat);
}

/** URL of the brand's logo, or null when it has none. */
export function billLogoUrl(brand) {
  return brand && brand.file ? encodeURI(BILL_LOGO_DIR + brand.file) : null;
}
