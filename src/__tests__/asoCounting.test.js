import { attachCounting, countingStart, effectiveNextDue, isCounting } from "../utils/asoOverdue";

// Owner's rule (2026-10-11): a client starts counting only when they have an active card / esusu round / savings
// group, and counting starts then — not at registration.
describe("Ajo counting start", () => {
  const base = { id: "c1", registration_date: "2026-08-01", next_contribution_date: "2026-08-20" };

  test("no active card or group: not counting, nothing due", () => {
    const c = { ...base, overdue_eligible: false, counting_since: null };
    expect(isCounting(c)).toBe(false);
    expect(countingStart(c)).toBeNull();
    expect(effectiveNextDue(c)).toBeNull();
  });

  test("card opened after a stale due date: due from the card's start, not the old date", () => {
    const c = { ...base, overdue_eligible: true, counting_since: "2026-10-11" };
    expect(countingStart(c)).toBe("2026-10-11");
    expect(effectiveNextDue(c)).toBe("2026-10-11");
  });

  test("due date after counting started is kept", () => {
    const c = { ...base, next_contribution_date: "2026-10-15", overdue_eligible: true, counting_since: "2026-10-11" };
    expect(effectiveNextDue(c)).toBe("2026-10-15");
  });

  test("unknown (not stamped yet) keeps the old behaviour: registration date, raw due date", () => {
    expect(isCounting(base)).toBe(true);
    expect(countingStart(base)).toBe("2026-08-01");
    expect(effectiveNextDue(base)).toBe("2026-08-20");
  });

  test("attachCounting stamps counting clients and marks the rest not counting", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const out = await attachCounting(rows, async () => ({ data: [{ client_id: "a", counting_since: "2026-10-01" }], error: null }));
    expect(out[0]).toMatchObject({ overdue_eligible: true, counting_since: "2026-10-01" });
    expect(out[1]).toMatchObject({ overdue_eligible: false, counting_since: null });
  });

  test("attachCounting falls back to the older eligibility RPC when the new one is missing", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const out = await attachCounting(rows,
      async () => ({ data: null, error: { message: "function does not exist" } }),
      async () => ({ data: ["b"], error: null }));
    expect(out[0].overdue_eligible).toBe(false);
    expect(out[1].overdue_eligible).toBe(true);
  });
});
