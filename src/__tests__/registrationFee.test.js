import { cleanRegFee, registrationFeeNotice, MAX_REG_FEE } from "../utils/registrationFee";

describe("cleanRegFee", () => {
  it("accepts a normal amount, including a numeric string from a form", () => {
    expect(cleanRegFee(2000)).toBe(2000);
    expect(cleanRegFee("1500.5")).toBe(1500.5);
  });
  it("treats blank, missing, negative and junk as no fee", () => {
    for (const v of [null, undefined, "", "abc", -5, NaN, Infinity, 0]) expect(cleanRegFee(v)).toBe(0);
  });
  it("rounds to kobo and caps an absurd value", () => {
    expect(cleanRegFee(10.005)).toBe(10.01);
    expect(cleanRegFee(99999999)).toBe(MAX_REG_FEE);
  });
});

describe("registrationFeeNotice", () => {
  it("states the fee, that it comes from the first deposit, and who confirms terms", () => {
    const n = registrationFeeNotice(2000, "Amaya & Co.");
    expect(n.hasFee).toBe(true);
    expect(n.headline).toBe("Registration fee: ₦2,000");
    expect(n.detail).toContain("first deposit");
    expect(n.detail).toContain("Amaya & Co. confirms your final terms");
  });
  it("says plainly when there is no fee, rather than staying silent", () => {
    const n = registrationFeeNotice(0, "Amaya & Co.");
    expect(n.hasFee).toBe(false);
    expect(n.headline).toBe("No registration fee");
  });
  it("falls back to a generic subject when the business name is unknown", () => {
    expect(registrationFeeNotice(500, "  ").detail).toContain("The business confirms your final terms");
  });
});
