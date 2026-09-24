import { walletAccountState } from "../utils/walletAccount";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const IN_3_DAYS  = "2026-10-04T12:00:00Z";
const HOUR_AGO   = "2026-10-01T11:00:00Z";

describe("walletAccountState", () => {
  it("no number yet → none, whatever the accounts say", () => {
    expect(walletAccountState({ hasAccount: false, walletAccount: "legacy", activeAccount: "business", graceUntil: IN_3_DAYS, now: NOW }).state).toBe("none");
  });

  it("before the switch every wallet is simply active", () => {
    expect(walletAccountState({ hasAccount: true, walletAccount: "legacy", activeAccount: "legacy", graceUntil: "", now: NOW }).state).toBe("active");
    expect(walletAccountState({ hasAccount: true, walletAccount: "legacy", activeAccount: null, now: NOW }).state).toBe("active");
  });

  it("legacy number after the switch, inside the grace window → migrate, with days left", () => {
    const r = walletAccountState({ hasAccount: true, walletAccount: "legacy", activeAccount: "business", graceUntil: IN_3_DAYS, now: NOW });
    expect(r.state).toBe("migrate");
    expect(r.daysLeft).toBe(3);
    expect(r.graceUntilMs).toBe(Date.parse(IN_3_DAYS));
  });

  it("rounds a part day up, so the last day never reads 0 days left", () => {
    const r = walletAccountState({ hasAccount: true, walletAccount: "legacy", activeAccount: "business", graceUntil: "2026-10-01T18:00:00Z", now: NOW });
    expect(r.state).toBe("migrate");
    expect(r.daysLeft).toBe(1);
  });

  it("legacy number after the deadline → retired", () => {
    const r = walletAccountState({ hasAccount: true, walletAccount: "legacy", activeAccount: "business", graceUntil: HOUR_AGO, now: NOW });
    expect(r.state).toBe("retired");
    expect(r.daysLeft).toBe(0);
  });

  it("a wallet already on the business account is active, even past the deadline", () => {
    expect(walletAccountState({ hasAccount: true, walletAccount: "business", activeAccount: "business", graceUntil: HOUR_AGO, now: NOW }).state).toBe("active");
  });

  it("a missing or unreadable deadline never retires anything", () => {
    for (const graceUntil of ["", null, undefined, "soon-ish"]) {
      const r = walletAccountState({ hasAccount: true, walletAccount: "legacy", activeAccount: "business", graceUntil, now: NOW });
      expect(r.state).toBe("migrate");
      expect(r.daysLeft).toBeNull();
    }
  });

  it("rolled back to legacy: a stale deadline retires nothing", () => {
    expect(walletAccountState({ hasAccount: true, walletAccount: "legacy", activeAccount: "legacy", graceUntil: HOUR_AGO, now: NOW }).state).toBe("active");
  });

  it("a business wallet after a rollback to legacy stays active", () => {
    expect(walletAccountState({ hasAccount: true, walletAccount: "business", activeAccount: "legacy", now: NOW }).state).toBe("active");
  });

  it("treats an unknown wallet account like legacy (the column default)", () => {
    expect(walletAccountState({ hasAccount: true, walletAccount: undefined, activeAccount: "business", graceUntil: IN_3_DAYS, now: NOW }).state).toBe("migrate");
  });
});
