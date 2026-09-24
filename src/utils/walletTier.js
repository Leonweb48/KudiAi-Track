// Wallet TIERS — see supabase/migrations/20270178000000_wallet_tiers.sql for the rules and how they are enforced.
// Everyone starts at Tier 1. The limits live in platform_config (wallet_tier{n}_{max_balance,daily_limit,per_transfer}_kobo) so they
// can be changed without a release; the numbers below are only the fallbacks and MUST match the migration's seeds.

export const TIER_CFG_KEYS = [1, 2, 3].flatMap((n) => [
  `wallet_tier${n}_max_balance_kobo`, `wallet_tier${n}_daily_limit_kobo`, `wallet_tier${n}_per_transfer_kobo`,
]);

const DEFAULTS = {
  1: { maxBalanceKobo: 30000000,  dailyKobo: 10000000,  perTransferKobo: 5000000 },     // ₦300,000 · ₦100,000 · ₦50,000
  2: { maxBalanceKobo: 50000000,  dailyKobo: 20000000,  perTransferKobo: 20000000 },    // ₦500,000 · ₦200,000 · ₦200,000
  3: { maxBalanceKobo: null,      dailyKobo: 500000000, perTransferKobo: 500000000 },   // unlimited · ₦5,000,000 · ₦5,000,000
};

export const TIER_INFO = {
  1: {
    name: "Basic",
    requirements: ["Email address and phone number", "Your BVN or NIN"],
  },
  2: {
    name: "Verified",
    requirements: ["Your full name", "Your residential address", "Both your BVN and your NIN"],
  },
  3: {
    name: "Fully Verified",
    requirements: [
      "A valid ID — National ID, Voter's card, International Passport or Driver's License",
      "A utility bill as proof of address",
      "A passport photograph",
    ],
  },
};

export const clampTier = (t) => { const n = Number(t); return n === 2 || n === 3 ? n : 1; };
export const nextTier = (t) => { const n = clampTier(t); return n < 3 ? n + 1 : null; };

// a blank value means "not set" (the database does the same: NULLIF(value, '')), never 0
const num = (v) => { if (v === null || v === undefined || String(v).trim() === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/**
 * Limits (kobo) for a tier, from the platform_config map (key → value string). A missing or unreadable value falls back to the
 * default. maxBalanceKobo === null means unlimited (the config stores 0 for that).
 */
export function tierLimits(tier, cfg = {}) {
  const t = clampTier(tier);
  const d = DEFAULTS[t];
  const read = (suffix, fallback) => { const v = num(cfg?.[`wallet_tier${t}_${suffix}_kobo`]); return v === null || v < 0 ? fallback : v; };
  const mb = read("max_balance", d.maxBalanceKobo === null ? 0 : d.maxBalanceKobo);
  return {
    maxBalanceKobo: mb === 0 ? null : mb,
    dailyKobo: read("daily_limit", d.dailyKobo),
    perTransferKobo: read("per_transfer", d.perTransferKobo),
  };
}

/** ₦300,000 from kobo, or "Unlimited" for null. */
export function formatKoboLimit(kobo) {
  if (kobo === null || kobo === undefined) return "Unlimited";
  return `₦${Math.round(Number(kobo) / 100).toLocaleString("en-NG")}`;
}
