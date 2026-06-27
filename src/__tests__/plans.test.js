import { canDo, featureLimit, planLimits, normalizeSlug, getLowestPlanWithFeature } from "../utils/plans";

// These tests run against the FALLBACK_PLANS (no DB cache active).
// They verify that the hardcoded defaults match the product spec so that
// a DB outage doesn't silently grant or deny the wrong features.

describe("normalizeSlug", () => {
  it("maps legacy slug 'starter' → 'kobo'",      () => expect(normalizeSlug("starter")).toBe("kobo"));
  it("maps legacy slug 'professional' → 'naira'", () => expect(normalizeSlug("professional")).toBe("naira"));
  it("maps legacy slug 'enterprise' → 'oga'",     () => expect(normalizeSlug("enterprise")).toBe("oga"));
  it("passes current slugs through unchanged",    () => {
    expect(normalizeSlug("kobo")).toBe("kobo");
    expect(normalizeSlug("naira")).toBe("naira");
    expect(normalizeSlug("oga")).toBe("oga");
  });
  it("returns 'kobo' for null",      () => expect(normalizeSlug(null)).toBe("kobo"));
  it("returns 'kobo' for undefined", () => expect(normalizeSlug(undefined)).toBe("kobo"));
});

describe("canDo — feature access by plan (fallback)", () => {
  describe("kobo (free)", () => {
    it("can do credit",         () => expect(canDo("kobo", "credit")).toBe(true));
    it("cannot do aso",         () => expect(canDo("kobo", "aso")).toBe(false));
    it("cannot do aiChatbot",   () => expect(canDo("kobo", "aiChatbot")).toBe(false));
    it("cannot do branches",    () => expect(canDo("kobo", "branches")).toBe(false));
    it("cannot do organisation",() => expect(canDo("kobo", "organisation")).toBe(false));
  });

  describe("naira", () => {
    it("can do aso",            () => expect(canDo("naira", "aso")).toBe(true));
    it("can do inventory",      () => expect(canDo("naira", "inventory")).toBe(true));
    it("can do aiInsights",     () => expect(canDo("naira", "aiInsights")).toBe(true));
    it("can do aiChatbot",      () => expect(canDo("naira", "aiChatbot")).toBe(true));
    it("cannot do organisation",() => expect(canDo("naira", "organisation")).toBe(false));
    it("cannot do printWholesale",() => expect(canDo("naira", "printWholesale")).toBe(false));
    it("cannot do apiAccess",   () => expect(canDo("naira", "apiAccess")).toBe(false));
  });

  describe("oga (top tier)", () => {
    it("can do printWholesale", () => expect(canDo("oga", "printWholesale")).toBe(true));
    it("can do organisation",   () => expect(canDo("oga", "organisation")).toBe(true));
    it("can do apiAccess",      () => expect(canDo("oga", "apiAccess")).toBe(true));
    it("can do loanAccess",     () => expect(canDo("oga", "loanAccess")).toBe(true));
  });

  describe("legacy slugs map correctly", () => {
    it("'enterprise' has printWholesale (maps to oga)", () => expect(canDo("enterprise", "printWholesale")).toBe(true));
    it("'starter' has no aso (maps to kobo)",           () => expect(canDo("starter", "aso")).toBe(false));
    it("'professional' has aiInsights (maps to naira)", () => expect(canDo("professional", "aiInsights")).toBe(true));
  });
});

describe("featureLimit — numeric caps (fallback)", () => {
  it("kobo inventory cap is 50",            () => expect(featureLimit("kobo", "inventory")).toBe(50));
  it("kobo staffManagement cap is 3",       () => expect(featureLimit("kobo", "staffManagement")).toBe(3));
  it("kobo loyalty cap is 100",             () => expect(featureLimit("kobo", "loyalty")).toBe(100));
  it("naira inventory cap is 500",          () => expect(featureLimit("naira", "inventory")).toBe(500));
  it("naira staffManagement cap is 10",     () => expect(featureLimit("naira", "staffManagement")).toBe(10));
  it("oga inventory is unlimited",          () => expect(featureLimit("oga", "inventory")).toBe(Infinity));
  it("oga staffManagement is unlimited",    () => expect(featureLimit("oga", "staffManagement")).toBe(Infinity));
  it("features without a limit → Infinity", () => expect(featureLimit("naira", "credit")).toBe(Infinity));
});

describe("planLimits — composed view", () => {
  it("kobo has 50 tx/month cap",        () => expect(planLimits("kobo").maxTxPerMonth).toBe(50));
  it("naira has unlimited transactions",() => expect(planLimits("naira").maxTxPerMonth).toBe(Infinity));
  it("naira includes credit feature",   () => expect(planLimits("naira").credit).toBe(true));
  it("naira includes aso feature",      () => expect(planLimits("naira").aso).toBe(true));
  it("kobo does not include aso",       () => expect(planLimits("kobo").aso).toBeUndefined());
});

describe("getLowestPlanWithFeature", () => {
  it("credit is on kobo (lowest plan)", () => {
    const p = getLowestPlanWithFeature("credit");
    expect(p?.slug).toBe("kobo");
  });
  it("organisation requires oga",        () => {
    const p = getLowestPlanWithFeature("organisation");
    expect(p?.slug).toBe("oga");
  });
  it("aiChatbot requires at least naira", () => {
    const p = getLowestPlanWithFeature("aiChatbot");
    expect(p?.slug).toBe("naira");
  });
  it("returns null for unknown feature", () => {
    expect(getLowestPlanWithFeature("nonexistentFeature")).toBeNull();
  });
});
