/**
 * Formats a number as Nigerian Naira.
 * @param {number} amount   — amount in naira (not kobo)
 * @param {object} [opts]
 * @param {number} [opts.decimals=2]  — decimal places (0 for whole-naira display)
 * @returns {string}  e.g. "₦12,345.67"
 */
export function formatNGN(amount, { decimals = 2 } = {}) {
  return `₦${Number(amount).toLocaleString("en-NG", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
