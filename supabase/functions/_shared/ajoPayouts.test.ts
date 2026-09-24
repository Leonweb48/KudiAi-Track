// deno test --no-lock --node-modules-dir=none supabase/functions/_shared/ajoPayouts.test.ts
import { attachPayouts, pendingPayouts, type Payout } from "./ajoPayouts.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error("assertion failed: " + msg); }
// deno-lint-ignore no-explicit-any
const v = (x: unknown) => x as any;
const payout = (over: Partial<Payout>): Payout => ({ id: "p", request_id: "r1", status: "pending", amount_kobo: 500000, scheduled_date: "2026-09-28", paid_at: null, created_at: "2026-09-25T10:00:00Z", ...over });

Deno.test("an approved request gets its payout's state", () => {
  const out = attachPayouts([{ id: "r1", status: "approved" }], [payout({})]);
  assert(v(out[0]).payout_status === "pending", "status");
  assert(v(out[0]).payout_amount_kobo === 500000, "amount");
  assert(v(out[0]).payout_date === "2026-09-28", "date");
  assert(v(out[0]).payout_paid_at === null, "not paid yet");
});

Deno.test("a request with no payout is returned untouched", () => {
  const r = { id: "r2", status: "pending" };
  const out = attachPayouts([r], [payout({ request_id: "r1" })]);
  assert(out[0] === r, "same object");
  assert(!("payout_status" in out[0]), "no payout fields");
});

Deno.test("each request gets ITS payout, and the newest wins if there are two", () => {
  const out = attachPayouts(
    [{ id: "r1" }, { id: "r2" }],
    [payout({ id: "new", request_id: "r1", status: "paid", paid_at: "2026-09-28T07:31:00Z" }), payout({ id: "old", request_id: "r1", status: "failed" }), payout({ id: "x", request_id: "r2", status: "pending" })],
  );
  assert(v(out[0]).payout_status === "paid", "r1 takes the newest");
  assert(v(out[1]).payout_status === "pending", "r2 has its own");
});

Deno.test("payouts with no request never attach to anything, but still count as pending", () => {
  const ps = [payout({ id: "a", request_id: null }), payout({ id: "b", request_id: "r9", status: "paid" }), payout({ id: "c", request_id: "r1", status: "failed" })];
  assert(v(attachPayouts([{ id: "r1" }], ps)[0]).payout_status === "failed", "only the request-linked one attaches");
  const pend = pendingPayouts(ps);
  assert(pend.length === 1 && pend[0].id === "a", "pending list = pending only, whether or not a request is linked");
});

Deno.test("no payouts at all is fine", () => {
  const rs = [{ id: "r1" }];
  assert(attachPayouts(rs, [])[0] === rs[0], "requests untouched");
  assert(pendingPayouts([]).length === 0, "nothing pending");
});
