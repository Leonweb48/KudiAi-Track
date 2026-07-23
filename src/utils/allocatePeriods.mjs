// Sequential period allocation — single source of truth for savings-card accounting.
// ESM (.mjs): named exports work with both CRA webpack import and Node.js test runner.

export function parseLocalDate(s) {
  if (!s) return null;
  const str = String(s);
  if (str.includes("T")) return new Date(str);
  return new Date(str + "T00:00:00");
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

export function periodStart(startDate, idx, freq) {
  const s = parseLocalDate(startDate);
  if (freq === "daily")   return addDays(s, idx);
  if (freq === "weekly")  return addDays(s, idx * 7);
  if (freq === "monthly") return addMonths(s, idx);
  return addDays(s, idx);
}

export function periodEnd(startDate, idx, freq) {
  const s = periodStart(startDate, idx, freq);
  if (freq === "daily")   return addDays(s, 1);
  if (freq === "weekly")  return addDays(s, 7);
  if (freq === "monthly") return addMonths(s, 1);
  return addDays(s, 1);
}

// Sign of each ledger row type in the client's net allocation.
// Day-one collector fee (commission + registration_fee) reduces net so it does
// not inflate the savings ledger for first_period cycles.
export const ALLOC_SIGNS = {
  contribution:              1,
  reversal_contribution:    -1,
  commission:               -1,
  registration_fee:         -1,
  reversal_commission:       1,
  reversal_registration_fee: 1,
};

/**
 * Derive the full period ledger for one savings cycle.
 *
 * @param {object}   cycle            — ajo_cycles row
 * @param {object[]} contributions    — ledger rows filtered to this cycle
 * @param {object[]} allContributions — optional full list for cross-cycle reversal detection
 * @returns {{ periods, cycleStarted, paidCount, totalCount, progressPct, nextDue }}
 */
export function allocatePeriods(cycle, contributions, allContributions) {
  const { start_date, length_periods, expected_amount_per_period, status: cycleStatus } = cycle;
  const freq = cycle.frequency || cycle.contribution_frequency || "monthly";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const periods = [];
  for (let i = 0; i < length_periods; i++) {
    const from = periodStart(start_date, i, freq);
    const to   = periodEnd(start_date, i, freq);
    periods.push({ idx: i, from, to, paid: 0, pendingAmount: 0, pendingRow: null, rejectedRow: null });
  }

  const reversedIds = new Set(
    (allContributions || contributions)
      .filter(c => c.reverses_contribution_id && typeof c.type === "string" && c.type.startsWith("reversal_"))
      .map(c => c.reverses_contribution_id)
  );

  const netClientTotal = Math.max(
    0,
    contributions
      .filter(c => c.status === "completed" && ALLOC_SIGNS[c.type] !== undefined && !reversedIds.has(c.id))
      .reduce((s, c) => s + Number(c.amount || 0) * ALLOC_SIGNS[c.type], 0)
  );

  const clientStart = cycle.commission_model === "first_period" ? 1 : 0;
  let remaining = netClientTotal;
  for (let i = clientStart; i < periods.length && remaining > 0; i++) {
    const fill = Math.min(remaining, Number(expected_amount_per_period));
    periods[i].paid = fill;
    remaining -= fill;
  }

  const pendingContribs = contributions
    .filter(c => c.type === "contribution" && c.status === "pending" && !reversedIds.has(c.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let pendingLeft = pendingContribs.reduce((s, c) => s + Number(c.amount || 0), 0);
  for (let i = clientStart; i < periods.length && pendingLeft > 0; i++) {
    const p = periods[i];
    const canFill = Number(expected_amount_per_period) - p.paid;
    if (canFill <= 0) continue;
    const fill = Math.min(pendingLeft, canFill);
    p.pendingAmount = fill;
    if (!p.pendingRow) p.pendingRow = pendingContribs[0];
    pendingLeft -= fill;
  }

  for (const c of contributions) {
    if (c.type !== "contribution" || (c.status !== "rejected" && c.status !== "failed")) continue;
    const dt = new Date(c.created_at);
    for (const p of periods) {
      if (dt >= p.from && dt < p.to) { if (!p.rejectedRow) p.rejectedRow = c; break; }
    }
  }

  const cycleCommissionCollected =
    cycle.commission_model === "first_period" &&
    Number(cycle.commission_balance || 0) >= Number(cycle.expected_amount_per_period || 0) &&
    Number(cycle.expected_amount_per_period || 0) > 0;

  const cycleStarted = contributions.some(c => c.type === "contribution" && c.status === "completed");

  const mappedPeriods = periods.map((p) => {
    if (cycle.commission_model === "first_period" && p.idx === 0) {
      if (cycleCommissionCollected) return { ...p, status: "collector" };
      const commBalance = Number(cycle.commission_balance || 0);
      if (commBalance > 0) {
        const expected = Number(expected_amount_per_period);
        return { ...p, paid: commBalance, status: commBalance >= expected ? "paid" : "partial" };
      }
    }

    const expected  = Number(expected_amount_per_period);
    const isFuture  = p.from > today;
    const isCurrent = p.from <= today && today < p.to;

    let status;
    if (cycleStatus !== "active") {
      if (p.paid >= expected) status = "paid";
      else if (p.paid > 0)   status = "partial";
      else                   status = "missed";
    } else if (p.paid >= expected) {
      status = isFuture ? "paid_in_advance" : "paid";
    } else if (p.pendingAmount > 0) {
      status = "pending";
    } else if (isFuture) {
      status = "upcoming";
    } else if (p.paid > 0) {
      status = "partial";
    } else if (isCurrent && cycleStarted) {
      status = "current";
    } else if (isCurrent) {
      status = "upcoming";
    } else {
      status = "missed";
    }
    return { ...p, status };
  });

  const paidCount     = mappedPeriods.filter(p => p.status === "paid" || p.status === "paid_in_advance").length;
  const totalCount    = mappedPeriods.length;
  const progressPct   = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;
  const nextDuePeriod = mappedPeriods.find(
    p => p.status !== "paid" && p.status !== "paid_in_advance" && p.status !== "collector"
  );

  return {
    periods: mappedPeriods,
    cycleStarted,
    paidCount,
    totalCount,
    progressPct,
    nextDue: nextDuePeriod ? nextDuePeriod.from : null,
  };
}
