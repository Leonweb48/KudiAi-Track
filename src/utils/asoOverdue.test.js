import { overdueEligible, attachOverdueEligibility } from "./asoOverdue";

const rows = [{ id: "a", full_name: "A" }, { id: "b", full_name: "B" }, { id: "c", full_name: "C" }];

describe("overdueEligible", () => {
  test("only an explicit false excludes a client (unknown = eligible = old date-only behaviour)", () => {
    expect(overdueEligible({ overdue_eligible: true })).toBe(true);
    expect(overdueEligible({ overdue_eligible: false })).toBe(false);
    expect(overdueEligible({})).toBe(true);
    expect(overdueEligible({ overdue_eligible: undefined })).toBe(true);
    expect(overdueEligible({ overdue_eligible: null })).toBe(true);
  });
});

describe("attachOverdueEligibility", () => {
  test("stamps true for the ids the server returned and false for the rest", async () => {
    const out = await attachOverdueEligibility(rows, async () => ({ data: ["a", "c"], error: null }));
    expect(out.map((r) => [r.id, r.overdue_eligible])).toEqual([["a", true], ["b", false], ["c", true]]);
    expect(out[0].full_name).toBe("A");
  });

  test("sends every client id in one call", async () => {
    let seen;
    await attachOverdueEligibility(rows, async (ids) => { seen = ids; return { data: [], error: null }; });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  test("an empty eligible list marks everyone ineligible (e.g. all cards settled)", async () => {
    const out = await attachOverdueEligibility(rows, async () => ({ data: [], error: null }));
    expect(out.every((r) => r.overdue_eligible === false)).toBe(true);
  });

  test("tolerates the object-wrapped row shape", async () => {
    const out = await attachOverdueEligibility(rows, async () => ({ data: [{ ajo_overdue_eligible_clients: "b" }], error: null }));
    expect(out.map((r) => r.overdue_eligible)).toEqual([false, true, false]);
  });

  test("RPC error -> rows returned untouched (fail-safe, nobody is hidden)", async () => {
    const out = await attachOverdueEligibility(rows, async () => ({ data: null, error: { message: "boom" } }));
    expect(out).toBe(rows);
    expect(out.every(overdueEligible)).toBe(true);
  });

  test("RPC throws -> rows returned untouched", async () => {
    const out = await attachOverdueEligibility(rows, async () => { throw new Error("offline"); });
    expect(out).toBe(rows);
  });

  test("non-array data -> rows untouched", async () => {
    const out = await attachOverdueEligibility(rows, async () => ({ data: { nope: 1 }, error: null }));
    expect(out).toBe(rows);
  });

  test("empty / missing list is returned as-is without calling the server", async () => {
    let called = false;
    const spy = async () => { called = true; return { data: [], error: null }; };
    expect(await attachOverdueEligibility([], spy)).toEqual([]);
    expect(await attachOverdueEligibility(undefined, spy)).toBeUndefined();
    expect(called).toBe(false);
  });
});
