// Selling prices for data plans. The provider (ClubKonnect) returns its own price for every plan; what customers are charged is set by the
// owner in platform_config.data_selling_prices (network -> provider plan name -> naira). This module swaps the two, so every app build, portal
// and screen that asks the clubkonnect "data-plans" action sees the selling price — and Print Data gets its percentage off on top.

export interface Plan { plan_id: string; plan_name: string; plan_amount: number }
export interface PricedPlan extends Plan {
  /** the provider's own price for this plan, before any selling price or discount */
  cost_amount: number;
  /** true when the plan has an owner-set selling price; false = it fell back to the provider price */
  priced: boolean;
}
export type SellingPrices = Record<string, Record<string, number>>;   // lower-cased network -> normalised plan name -> naira

/** Provider plan names are matched ignoring case, repeated spaces and leading/trailing spaces (the provider returns "…(SME) " with a trailing space). */
export const normName = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** platform_config.data_selling_prices (a JSON string) -> a lookup. Anything malformed or non-positive is ignored, never thrown. */
export function parseSellingPrices(raw: unknown): SellingPrices {
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return {}; } }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: SellingPrices = {};
  for (const [network, plans] of Object.entries(obj as Record<string, unknown>)) {
    if (!plans || typeof plans !== "object" || Array.isArray(plans)) continue;
    const m: Record<string, number> = {};
    for (const [name, price] of Object.entries(plans as Record<string, unknown>)) {
      const n = Number(price);
      if (Number.isFinite(n) && n > 0) m[normName(name)] = n;
    }
    out[network.trim().toLowerCase()] = m;
  }
  return out;
}

/** platform_config.print_data_discount_pct -> 0..20 (anything else = 0, i.e. no discount). */
export function parseDiscountPct(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : 0;
}

export function applyDataPrices(
  plans: Plan[], network: string, selling: SellingPrices, opts: { print?: boolean; printDiscountPct?: number } = {},
): PricedPlan[] {
  const byName = selling[String(network ?? "").trim().toLowerCase()] ?? {};
  const pct = opts.print ? parseDiscountPct(opts.printDiscountPct) : 0;
  return plans.map((p) => {
    const sp = byName[normName(p.plan_name)];
    const priced = typeof sp === "number";
    const base = priced ? sp : p.plan_amount;
    // The percentage comes off the SELLING price only — a plan with no selling price keeps the provider price (a discount off cost would sell below cost).
    const amount = priced && pct > 0 ? Math.round(base * (1 - pct / 100)) : base;
    return { ...p, plan_amount: amount, cost_amount: p.plan_amount, priced };
  });
}
