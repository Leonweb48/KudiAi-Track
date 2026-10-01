// What ClubKonnect charges US for an order, worked out when the order is placed (the customer's price is a separate thing).
// The result is written to the platform finance ledger (finance_record_bill_cost — see supabase/migrations/20270223000000_finance_ledger.sql).
//
// Only airtime, data, print airtime and print data need this: they are sold at a price that differs from what the provider takes (the provider's
// wholesale discount, or its list price for a data plan). Every other category is resold at the provider's own price, so its cost is derived from the
// sale in SQL. In order of trust the cost is:
//   provider_reported    — the provider's own "amount charged" on the purchase response (never an estimate)
//   wholesale_discount   — face value less the provider's wholesale discount for the network (airtime, print airtime)
//   provider_plan_price  — the provider's list price for the data plan
import { parseCkAmount } from "./ckAmount.ts";

/** ClubKonnect network ids → the network names used for the discount table (platform_config.ck_discounts). */
export const NET_NAME: Record<string, string> = { "01": "MTN", "02": "Glo", "03": "9mobile", "04": "Airtel" };

// Last known provider spread — used for a network the live table does not list (same values the pricing refresh falls back to).
export const FALLBACK_AIRTIME: Record<string, number> = { MTN: 0.03, Airtel: 0.03, "9mobile": 0.07, Glo: 0.08 };
export const FALLBACK_EPIN: Record<string, number> = { MTN: 0.01, Airtel: 0.02, "9mobile": 0.05, Glo: 0.02 };

export interface Discounts { airtime: Record<string, number>; epin: Record<string, number> }
export type CostBasis = "provider_reported" | "wholesale_discount" | "provider_plan_price";
export interface Cost { costKobo: number; faceKobo: number; basis: CostBasis; estimated: boolean }

const kobo = (naira: number) => Math.round(naira * 100);
const posNumber = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const MAX_COST_KOBO = 500_000_000;   // ₦5,000,000 — a sanity ceiling when no face value is known

/** platform_config.ck_discounts (a JSON string or object) → validated discount fractions per network, with the fallbacks filling any gap. */
export function parseDiscounts(raw: unknown): Discounts {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { obj = null; } }
  const pick = (fallback: Record<string, number>, live: unknown): Record<string, number> => {
    const out = { ...fallback };
    if (live && typeof live === "object" && !Array.isArray(live)) {
      for (const [k, v] of Object.entries(live as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n < 0.5) out[k] = n;
      }
    }
    return out;
  };
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  return { airtime: pick(FALLBACK_AIRTIME, o.airtime), epin: pick(FALLBACK_EPIN, o.epin) };
}

/** The network name a purchase used ("MTN", "Glo", "9mobile", "Airtel"; the old "t2mobile" name is 9mobile). */
export function networkName(network: unknown, netId?: unknown): string | null {
  const n = String(network ?? "").trim();
  if (n && /^t2mobile$/i.test(n)) return "9mobile";
  const known = Object.values(NET_NAME).find((v) => v.toLowerCase() === n.toLowerCase());
  if (known) return known;
  return NET_NAME[String(netId ?? "")] ?? null;
}

/**
 * The provider's own statement of what it charged for THIS order, if the purchase response carries one. Only fields that are explicitly a charged
 * amount are trusted (a plain "amount" is usually the face value). With a face value to compare against, a figure far from it is discarded as
 * implausible rather than booked.
 */
export function reportedChargeKobo(resp: Record<string, unknown> | null | undefined, faceKobo = 0): number | null {
  if (!resp || typeof resp !== "object") return null;
  for (const f of ["amountcharged", "AmountCharged", "amount_charged", "Amount_Charged", "chargedamount", "ChargedAmount"]) {
    const n = parseCkAmount(resp[f]);
    if (n === null || n <= 0) continue;
    const k = kobo(n);
    if (faceKobo > 0) { if (k >= faceKobo * 0.5 && k <= faceKobo * 1.05) return k; continue; }
    if (k <= MAX_COST_KOBO) return k;
  }
  return null;
}

/** Airtime: face value less the wholesale discount for the network. */
export function airtimeCost(amountNaira: unknown, network: string | null, d: Discounts, resp?: Record<string, unknown>): Cost | null {
  const amt = posNumber(amountNaira);
  if (!amt || !network) return null;
  const face = kobo(amt);
  const reported = reportedChargeKobo(resp, face);
  if (reported !== null) return { costKobo: reported, faceKobo: face, basis: "provider_reported", estimated: false };
  const disc = d.airtime[network];
  if (disc === undefined) return null;
  return { costKobo: Math.round(face * (1 - disc)), faceKobo: face, basis: "wholesale_discount", estimated: true };
}

/** Print airtime: value × quantity, less the e-pin wholesale discount for the network. */
export function printAirtimeCost(valueNaira: unknown, quantity: unknown, network: string | null, d: Discounts, resp?: Record<string, unknown>): Cost | null {
  const value = posNumber(valueNaira), qty = Math.floor(posNumber(quantity));
  if (!value || !qty || qty > 100 || !network) return null;
  const face = kobo(value * qty);
  const reported = reportedChargeKobo(resp, face);
  if (reported !== null) return { costKobo: reported, faceKobo: face, basis: "provider_reported", estimated: false };
  const disc = d.epin[network];
  if (disc === undefined) return null;
  return { costKobo: Math.round(face * (1 - disc)), faceKobo: face, basis: "wholesale_discount", estimated: true };
}

/** Data / print data: the provider's list price for the plan × quantity. planPriceNaira null = the plan's price could not be looked up (nothing is booked). */
export function dataCost(planPriceNaira: number | null, quantity: unknown, resp?: Record<string, unknown>): Cost | null {
  const price = posNumber(planPriceNaira), qty = Math.floor(posNumber(quantity ?? 1));
  if (!qty || qty > 100) return null;
  if (!price) {   // no list price to check against — the provider's own charged amount is still good enough on its own
    const only = reportedChargeKobo(resp, 0);
    return only === null ? null : { costKobo: only, faceKobo: only, basis: "provider_reported", estimated: false };
  }
  const face = kobo(price * qty);
  const reported = reportedChargeKobo(resp, face);
  if (reported !== null) return { costKobo: reported, faceKobo: face, basis: "provider_reported", estimated: false };
  return { costKobo: face, faceKobo: face, basis: "provider_plan_price", estimated: true };
}

/**
 * The provider's list price (naira) for a data plan, from the APIDatabundlePlansV2 response
 * { MOBILE_NETWORK: { MTN: [{ ID, PRODUCT: [{ PRODUCT_ID, PRODUCT_AMOUNT, … }] }] } }. The network key is matched ignoring case, punctuation and the
 * provider's own aliases for 9mobile.
 */
export function findPlanPrice(resp: unknown, network: string, planId: unknown): number | null {
  const mn = (resp as { MOBILE_NETWORK?: Record<string, unknown> } | null)?.MOBILE_NETWORK;
  if (!mn || typeof mn !== "object") return null;
  const squash = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();   // \W would keep the underscore in "m_9mobile"
  const want = squash(network);
  const aliases = want === "9MOBILE" ? ["9MOBILE", "M9MOBILE", "ETISALAT", "EMTS", "T2MOBILE"] : [want];
  const key = Object.keys(mn).find((k) => aliases.includes(squash(k)));
  if (!key) return null;
  const id = String(planId ?? "").trim();
  if (!id) return null;
  const groups = Array.isArray(mn[key]) ? (mn[key] as Record<string, unknown>[]) : [];
  const found = new Set<number>();
  for (const g of groups) {
    const products = Array.isArray(g?.PRODUCT) ? (g.PRODUCT as Record<string, unknown>[]) : [];
    for (const p of products) {
      if (String(p?.PRODUCT_ID ?? p?.DataPlan ?? "").trim() === id) {
        const n = parseCkAmount(p.PRODUCT_AMOUNT ?? p.Price);
        if (n !== null && n > 0) found.add(n);
      }
    }
  }
  // Two different prices under one id would be a guess — book nothing rather than the wrong cost.
  return found.size === 1 ? [...found][0] : null;
}

/** The plan entry (id, name, provider price) for one plan id — the shape applyDataPrices takes; null unless exactly one. */
export function findPlan(resp: unknown, network: string, planId: unknown): { plan_id: string; plan_name: string; plan_amount: number } | null {
  const price = findPlanPrice(resp, network, planId);
  if (price === null) return null;
  const mn = (resp as { MOBILE_NETWORK?: Record<string, unknown> }).MOBILE_NETWORK as Record<string, unknown>;
  const squash = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const want = squash(network);
  const aliases = want === "9MOBILE" ? ["9MOBILE", "M9MOBILE", "ETISALAT", "EMTS", "T2MOBILE"] : [want];
  const key = Object.keys(mn).find((k) => aliases.includes(squash(k)))!;
  const id = String(planId ?? "").trim();
  for (const g of (Array.isArray(mn[key]) ? mn[key] : []) as Record<string, unknown>[]) {
    for (const p of (Array.isArray(g?.PRODUCT) ? g.PRODUCT : []) as Record<string, unknown>[]) {
      if (String(p?.PRODUCT_ID ?? p?.DataPlan ?? "").trim() === id) {
        return { plan_id: id, plan_name: String(p.PRODUCT_NAME ?? p.DataPlanName ?? ""), plan_amount: price };
      }
    }
  }
  return null;
}
