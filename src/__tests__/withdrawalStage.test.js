import { withdrawalStage, expectedDay, STAGE_CLS } from "../utils/withdrawalStage";

describe("expectedDay", () => {
  it("formats a plain calendar date without a timezone shift", () => {
    expect(expectedDay("2026-09-28")).toBe("Mon 28 Sep");
    expect(expectedDay("2026-10-01")).toBe("Thu 1 Oct");
    expect(expectedDay("2026-12-31")).toBe("Thu 31 Dec");
    expect(expectedDay("2026-09-28T23:59:59Z")).toBe("Mon 28 Sep");
  });
  it("returns nothing for junk", () => {
    for (const v of ["", null, undefined, "soon", "28/09/2026"]) expect(expectedDay(v)).toBe("");
  });
});

describe("withdrawalStage", () => {
  it("an approved withdrawal whose payout is still pending is 'processing to wallet', with the expected day", () => {
    const s = withdrawalStage({ status: "approved", payout_status: "pending", payout_date: "2026-09-28" });
    expect(s.key).toBe("processing");
    expect(s.label).toBe("Approved · processing to wallet");
    expect(s.detail).toBe("Expected in your wallet Mon 28 Sep");
    expect(s.tone).toBe("blue");
  });

  it("without a date it still says when in general terms", () => {
    expect(withdrawalStage({ status: "approved", payout_status: "pending" }).detail).toMatch(/next business day/);
  });

  it("once the payout has landed it says paid to wallet", () => {
    const s = withdrawalStage({ status: "approved", payout_status: "paid" });
    expect(s.key).toBe("paid");
    expect(s.label).toBe("Approved · paid to wallet");
    expect(s.tone).toBe("green");
  });

  it("a failed payout is shown as delayed, not lost", () => {
    const s = withdrawalStage({ status: "approved", payout_status: "failed" });
    expect(s.key).toBe("delayed");
    expect(s.label).toContain("delayed");
    expect(s.tone).toBe("orange");
  });

  it("approved with no wallet payout (paid another way) is just Approved", () => {
    expect(withdrawalStage({ status: "approved" })).toMatchObject({ key: "approved", label: "Approved" });
    expect(withdrawalStage({ status: "approved", payout_status: "cancelled" })).toMatchObject({ key: "approved" });
  });

  it("requests that are not approved keep their existing wording (null)", () => {
    for (const status of ["pending", "rejected", "held_24h", "", undefined]) expect(withdrawalStage({ status, payout_status: "pending" })).toBeNull();
    expect(withdrawalStage(null)).toBeNull();
  });

  it("every tone has a class", () => {
    for (const t of ["blue", "green", "orange"]) expect(STAGE_CLS[t]).toBeTruthy();
  });
});
