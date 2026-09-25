// ClubKonnect returns amounts as free-form strings: "3,169.36", "₦26.00", "-343.85", "N 1,200", "(50.00)".
// Stripping everything except digits and "." (the old parser) lost the sign, so a wallet in deficit read as a
// healthy positive balance. This keeps the sign and is safe with thousands separators and currency symbols.
export function parseCkAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, "");
  if (!/[0-9]/.test(digits)) return null;
  const n = Number(digits);
  if (isNaN(n)) return null;
  // "-343.85", "−343.85" (typographic minus), "₦-343.85" and accounting-style "(343.85)" are all negative.
  const negative = /[-−–]/.test(s) || /^\(.*\)$/.test(s);
  return negative && n !== 0 ? -n : n;
}
