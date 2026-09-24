import { tierLimits, clampTier, nextTier, formatKoboLimit, TIER_CFG_KEYS, TIER_INFO } from "../utils/walletTier";

describe("walletTier", () => {
  it("has the nine config keys the migration seeds", () => {
    expect(TIER_CFG_KEYS).toHaveLength(9);
    expect(TIER_CFG_KEYS).toContain("wallet_tier1_max_balance_kobo");
    expect(TIER_CFG_KEYS).toContain("wallet_tier3_per_transfer_kobo");
  });

  it("falls back to the shared numbers when the config is empty", () => {
    expect(tierLimits(1, {})).toEqual({ maxBalanceKobo: 30000000, dailyKobo: 10000000, perTransferKobo: 5000000 });
    expect(tierLimits(2, {})).toEqual({ maxBalanceKobo: 50000000, dailyKobo: 20000000, perTransferKobo: 20000000 });
    expect(tierLimits(3, {})).toEqual({ maxBalanceKobo: null, dailyKobo: 500000000, perTransferKobo: 500000000 });
  });

  it("reads the live config, and treats a max balance of 0 as unlimited", () => {
    const cfg = { wallet_tier1_max_balance_kobo: "40000000", wallet_tier1_daily_limit_kobo: "5000000", wallet_tier3_max_balance_kobo: "0" };
    expect(tierLimits(1, cfg).maxBalanceKobo).toBe(40000000);
    expect(tierLimits(1, cfg).dailyKobo).toBe(5000000);
    expect(tierLimits(3, cfg).maxBalanceKobo).toBeNull();
  });

  it("ignores unreadable or negative values", () => {
    expect(tierLimits(1, { wallet_tier1_daily_limit_kobo: "abc" }).dailyKobo).toBe(10000000);
    expect(tierLimits(1, { wallet_tier1_daily_limit_kobo: "-5" }).dailyKobo).toBe(10000000);
    expect(tierLimits(1, { wallet_tier1_daily_limit_kobo: "" }).dailyKobo).toBe(10000000);   // blank = not set, like the database's NULLIF
  });

  it("everything unknown is Tier 1", () => {
    for (const t of [undefined, null, 0, 4, "x", -1]) expect(clampTier(t)).toBe(1);
    expect(clampTier(2)).toBe(2);
    expect(clampTier("3")).toBe(3);
  });

  it("next tier: 1 -> 2 -> 3 -> none", () => {
    expect(nextTier(1)).toBe(2);
    expect(nextTier(2)).toBe(3);
    expect(nextTier(3)).toBeNull();
    expect(nextTier(undefined)).toBe(2);
  });

  it("formats limits", () => {
    expect(formatKoboLimit(30000000)).toBe("₦300,000");
    expect(formatKoboLimit(500000000)).toBe("₦5,000,000");
    expect(formatKoboLimit(null)).toBe("Unlimited");
  });

  it("every tier has a name and requirements", () => {
    for (const t of [1, 2, 3]) {
      expect(TIER_INFO[t].name).toBeTruthy();
      expect(TIER_INFO[t].requirements.length).toBeGreaterThan(0);
    }
    expect(TIER_INFO[2].requirements.join(" ")).toMatch(/BVN and your NIN/);
  });
});
