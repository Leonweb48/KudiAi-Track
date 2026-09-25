jest.mock("./supabase", () => ({ supabase: {} }));

import { claimEmailOnce } from "./emailPref";

describe("claimEmailOnce", () => {
  test("first claim wins, later claims for the same period lose (a second device must not re-send)", async () => {
    const seen = new Set();
    const rpc = async (kind, bucket) => {
      const k = `${kind}|${bucket}`;
      const first = !seen.has(k);
      seen.add(k);
      return { data: first, error: null };
    };
    expect(await claimEmailOnce("daily_summary", "2026-09-25", rpc)).toBe(true);
    expect(await claimEmailOnce("daily_summary", "2026-09-25", rpc)).toBe(false);
    expect(await claimEmailOnce("daily_summary", "2026-09-26", rpc)).toBe(true);
    expect(await claimEmailOnce("ajo_overdue_digest", "2026-09-25", rpc)).toBe(true);
  });

  test("passes the kind and bucket through unchanged", async () => {
    const calls = [];
    await claimEmailOnce("weekly_unnamed_nudge", "2026-09-21", async (k, b) => { calls.push([k, b]); return { data: true, error: null }; });
    expect(calls).toEqual([["weekly_unnamed_nudge", "2026-09-21"]]);
  });

  test("server error -> fails open (send once, like the old per-device behaviour)", async () => {
    expect(await claimEmailOnce("daily_summary", "d", async () => ({ data: null, error: { message: "function not found" } }))).toBe(true);
  });

  test("network failure -> fails open", async () => {
    expect(await claimEmailOnce("daily_summary", "d", async () => { throw new Error("offline"); })).toBe(true);
  });

  test("only an explicit true from the server is a win", async () => {
    expect(await claimEmailOnce("daily_summary", "d", async () => ({ data: false, error: null }))).toBe(false);
    expect(await claimEmailOnce("daily_summary", "d", async () => ({ data: null, error: null }))).toBe(false);
  });
});
