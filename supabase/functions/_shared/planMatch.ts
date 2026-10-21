// Cheapest provider per data plan (owner, 2026-10-21): ClubKonnect's list stays the base; where Bigisub sells the SAME
// plan — same network (each list is one network), same size, same validity — for less, the customer is shown Bigisub's
// plan at the price the owner set for the ClubKonnect one, so the saving is ours. Each plan still buys only on the
// provider that listed it ("bg:" ids → Bigisub). Pure, unit-tested in planMatch.test.ts.

export interface ListedPlan { plan_id: string; plan_name: string; plan_amount: number; cost_amount?: number; priced?: boolean; retail_amount?: number }

/** Data size in MB from a plan name ("1 GB - Monthly (SME)", "1.5GB (SME) - 30 days", "500MB …"); null when it has none. */
export function planSizeMb(name: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(MB|GB|TB)\b/i.exec(String(name ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toUpperCase();
  return Math.round(n * (unit === "TB" ? 1_000_000 : unit === "GB" ? 1000 : 1));
}

/** Validity as days from a plan name; null when it can't be read (such plans are never swapped). */
export function planDays(name: string): number | null {
  const t = String(name ?? "").toLowerCase().replace(/\s+/g, " ");
  if (/\bdaily\b|24 ?h(rs|ours)?\b/.test(t)) return 1;
  if (/\bweekly\b/.test(t)) return 7;
  if (/\bmonthly\b/.test(t)) return 30;
  if (/\byearly\b|\bannual\b/.test(t)) return 365;
  const w = /(\d+)\s*-?\s*weeks?\b/.exec(t);
  if (w) return Number(w[1]) * 7;
  const mo = /(\d+)\s*-?\s*months?\b/.exec(t);
  if (mo) return Number(mo[1]) * 30;
  const d = /(\d+)\s*-?\s*days?\b/.exec(t);
  if (d) return Number(d[1]);
  return null;
}

/**
 * ClubKonnect's priced list with each plan swapped for a cheaper Bigisub plan of the same size and validity, when:
 *   Bigisub's cost is at least `minSaving` naira under ClubKonnect's cost,
 *   it is not above the price the customer pays (never sell at a loss),
 *   and Bigisub's wallet can cover it (`bgBalance`; unknown = no swaps).
 * Each Bigisub plan replaces at most one ClubKonnect plan. The customer price and "priced" flag stay the owner's.
 */
export function pickCheaperPlans<T extends ListedPlan>(ck: T[], bg: ListedPlan[], opts: { minSaving?: number; bgBalance: number | null }): (T | (ListedPlan & { replaces: string }))[] {
  const minSaving = opts.minSaving ?? 5;
  if (opts.bgBalance === null || !bg.length) return ck;
  const key = (p: ListedPlan) => {
    const s = planSizeMb(p.plan_name), d = planDays(p.plan_name);
    return s !== null && d !== null ? `${s}|${d}` : null;
  };
  const cheapestBg = new Map<string, ListedPlan>();
  for (const b of bg) {
    const k = key(b);
    if (!k || !(b.plan_amount > 0)) continue;
    const cur = cheapestBg.get(k);
    if (!cur || b.plan_amount < cur.plan_amount) cheapestBg.set(k, b);
  }
  const used = new Set<string>();
  return ck.map((c) => {
    const k = key(c);
    const b = k ? cheapestBg.get(k) : undefined;
    const ckCost = Number(c.cost_amount ?? c.plan_amount);
    if (!b || used.has(b.plan_id)) return c;
    if (!(b.plan_amount + minSaving <= ckCost)) return c;
    if (b.plan_amount > c.plan_amount) return c;                     // the customer price must cover Bigisub's cost
    if (b.plan_amount > (opts.bgBalance as number)) return c;        // Bigisub's wallet can't take it right now
    used.add(b.plan_id);
    return { plan_id: b.plan_id, plan_name: b.plan_name, plan_amount: c.plan_amount, cost_amount: b.plan_amount, priced: c.priced, replaces: c.plan_id };
  });
}
