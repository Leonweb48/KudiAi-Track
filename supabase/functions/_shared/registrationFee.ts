// Registration fee for Ajo/Savings clients: set per business, taken once out of the client's FIRST deposit.
// Mirrors src/utils/registrationFee.js (cleanRegFee) — keep the two in step.

export const MAX_REG_FEE = 1_000_000;

/** Any DB/JSON value → a safe naira amount: finite, ≥ 0, capped, 2dp. Junk means "no fee". */
export function cleanRegFee(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n * 100) / 100, MAX_REG_FEE);
}
