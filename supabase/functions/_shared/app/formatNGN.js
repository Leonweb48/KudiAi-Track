// SHARED WITH THE SERVER — copied byte-for-byte to supabase/functions/_shared/app/ by `node scripts/sync-shared.mjs`
// (the monthly owner/client report emails build their PDFs there). Edit it here, then run the script;
// src/__tests__/sharedModules.test.js fails while the copies differ. No imports outside src/shared.

/**
 * Formats a number as Nigerian Naira.
 * @param {number} amount   — amount in naira (not kobo)
 * @param {object} [opts]
 * @param {number} [opts.decimals=2]  — decimal places (0 for whole-naira display)
 * @returns {string}  e.g. "₦12,345.67"
 */
export function formatNGN(amount, { decimals = 2 } = {}) {
  return `₦${Number(amount ?? 0).toLocaleString("en-NG", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
