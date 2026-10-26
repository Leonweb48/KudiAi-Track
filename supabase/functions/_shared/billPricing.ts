// Bill prices and on/off switches the admin sets (admin portal → Bill Prices & Services, 2026-10-26).
//
// What customers pay for a plan-priced bill used to be the provider's own price, except Data (owner's selling prices in
// platform_config.data_selling_prices — see dataPricing.ts) and Print Airtime (print_airtime_prices). This module adds the
// same for the rest: platform_config.bill_price_overrides = { cable: { "<provider>|<package id>": naira }, smile: { "<plan id>": naira },
// spectranet: { "<plan id>": naira }, exam: { "<waec|jamb>|<exam type>": naira } }. No entry = the provider's price, as before.
//
// platform_config.bill_services_off = comma list of bill services switched off ("data,cable"). The app greys the tile out,
// the preflight refuses before anyone is charged, and a direct purchase call is refused before the payment gate.

export const BILL_SERVICES = [
  "airtime", "data", "cable", "electricity", "betting", "waec", "jamb", "spectranet", "smile", "print-airtime", "print-data",
] as const;
export type BillService = (typeof BILL_SERVICES)[number];
export const SERVICE_LABEL: Readonly<Record<BillService, string>> = {
  airtime: "Airtime", data: "Data", cable: "Cable TV", electricity: "Electricity", betting: "Betting wallet", waec: "Exam PINs",
  jamb: "JAMB PINs", spectranet: "Spectranet", smile: "Smile", "print-airtime": "Print Airtime", "print-data": "Print Data",
};

export const OVERRIDE_KINDS = ["cable", "smile", "spectranet", "exam"] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];
export type PriceOverrides = Record<OverrideKind, Record<string, number>>;

/** Highest price an admin may set for one item (₦). Anything above is a typo, not a price. */
export const MAX_ITEM_PRICE = 2_000_000;

/** platform_config.bill_services_off → the services switched off. Unknown names are ignored. */
export function parseServicesOff(raw: unknown): Set<BillService> {
  const out = new Set<BillService>();
  for (const s of String(raw ?? "").split(",")) {
    const v = s.trim().toLowerCase();
    if ((BILL_SERVICES as readonly string[]).includes(v)) out.add(v as BillService);
  }
  return out;
}

/** The services-off set → the stored value (fixed order, so an unchanged set never rewrites the row differently). */
export function formatServicesOff(off: Iterable<string>): string {
  const set = new Set(Array.from(off, (s) => String(s).trim().toLowerCase()));
  return BILL_SERVICES.filter((s) => set.has(s)).join(",");
}

/** A valid price: a finite number above 0 and at most MAX_ITEM_PRICE, rounded to kobo. Otherwise null. */
export function cleanPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_ITEM_PRICE) return null;
  return Math.round(n * 100) / 100;
}

/** platform_config.bill_price_overrides (JSON string or object) → a lookup. Malformed parts are ignored, never thrown. */
export function parsePriceOverrides(raw: unknown): PriceOverrides {
  const out: PriceOverrides = { cable: {}, smile: {}, spectranet: {}, exam: {} };
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return out; } }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const kind of OVERRIDE_KINDS) {
    const m = (obj as Record<string, unknown>)[kind];
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      const p = cleanPrice(v);
      const key = overrideKey(kind, k);
      if (p !== null && key) out[kind][key] = p;
    }
  }
  return out;
}

/** The lookup key for one item: lower-case, trimmed ("dstv|COMPACT" → "dstv|compact"). */
export function overrideKey(_kind: OverrideKind, key: string): string {
  return String(key ?? "").trim().toLowerCase();
}
export const cableKey = (provider: string, packageId: string) => `${String(provider ?? "").trim().toLowerCase()}|${String(packageId ?? "").trim()}`;
export const examKey = (exam: string, examType: string) => `${String(exam ?? "").trim().toLowerCase()}|${String(examType ?? "").trim()}`;

/** What the customer pays for one item: the admin's price when one is set, else the provider's. */
export function sellingPrice(o: PriceOverrides, kind: OverrideKind, key: string, providerPrice: number): { price: number; priced: boolean } {
  const p = o[kind][overrideKey(kind, key)];
  return typeof p === "number" ? { price: p, priced: true } : { price: providerPrice, priced: false };
}

/** Set (price) or remove (null) one item's price in a stored overrides object, returning the new stored object. */
export function withOverride(o: PriceOverrides, kind: OverrideKind, key: string, price: number | null): PriceOverrides {
  const next: PriceOverrides = { cable: { ...o.cable }, smile: { ...o.smile }, spectranet: { ...o.spectranet }, exam: { ...o.exam } };
  const k = overrideKey(kind, key);
  if (!k) return next;
  if (price === null) delete next[kind][k];
  else next[kind][k] = price;
  return next;
}

/** Which bill service a purchase action belongs to. */
export function serviceOfAction(action: string): BillService | null {
  return (BILL_SERVICES as readonly string[]).includes(action) ? action as BillService : null;
}

/** The app's preflight category → the service it belongs to (Bundle Set has its own switch, bundle_set_enabled). */
export function serviceOfCategory(cat: string): BillService | null {
  return serviceOfAction(String(cat ?? "").trim().toLowerCase());
}

/** Worded so the app shows it and doesn't retry ("not been charged" / "unavailable" both stop the purchase). */
export function pausedMessage(s: BillService): string {
  return `${SERVICE_LABEL[s]} is unavailable right now. Please try again later — you have not been charged.`;
}

/** Margin of a selling price over cost, in % of cost (one decimal). null when the cost is unknown. */
export function marginPct(selling: number, cost: number): number | null {
  if (!(cost > 0) || !(selling > 0)) return null;
  return Math.round(((selling - cost) / cost) * 1000) / 10;
}

/** Cost plus a markup, rounded UP to the nearest `step` naira (the admin's "set all to cost + x%" tool). */
export function markupPrice(cost: number, pct: number, step = 5): number {
  if (!(cost > 0)) return 0;
  const raw = cost * (1 + (Number.isFinite(pct) ? pct : 0) / 100);
  const s = step > 0 ? step : 1;
  return Math.ceil(Math.round(raw * 100) / 100 / s) * s;
}
