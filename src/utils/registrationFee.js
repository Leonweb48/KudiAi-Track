// Registration fee for Ajo/Savings clients: set per business, taken once out of the client's FIRST deposit.
// Mirrored server-side in supabase/functions/_shared/registrationFee.ts (cleanRegFee) — keep the two in step.

export const MAX_REG_FEE = 1000000;

// Any input (string from a form, null from a missing column) → a safe naira amount: finite, ≥ 0, capped, 2dp.
export function cleanRegFee(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n * 100) / 100, MAX_REG_FEE);
}

const naira = (n) => `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

// The wording a client sees BEFORE they register (and while they wait for approval).
export function registrationFeeNotice(fee, businessName) {
  const f = cleanRegFee(fee);
  const who = (businessName || "").trim() || "The business";
  return f > 0
    ? { hasFee: true, amount: f,
        headline: `Registration fee: ${naira(f)}`,
        detail: `Taken once, from your first deposit. ${who} confirms your final terms when they approve you.` }
    : { hasFee: false, amount: 0,
        headline: "No registration fee",
        detail: `${who} confirms your final terms when they approve you.` };
}
