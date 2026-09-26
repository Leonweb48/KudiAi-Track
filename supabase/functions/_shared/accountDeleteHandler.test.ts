// Run: deno test --allow-env --allow-net=abcd.supabase.co supabase/functions/_shared/accountDeleteHandler.test.ts
// Drives the real account-delete handler with fetch stubbed to speak the Supabase Auth / PostgREST / Storage wire protocol.
// (The database rules themselves are proven by the self-test inside migration 20270213000000_account_deletion.sql.)

Deno.env.set("SUPABASE_URL", "https://abcd.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");

// capture the handler instead of starting a server
let handler: (req: Request) => Promise<Response> = () => { throw new Error("handler not captured"); };
const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve() }; };
await import("../account-delete/index.ts");
// deno-lint-ignore no-explicit-any
(Deno as any).serve = realServe;

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT ${msg}: got ${a}, expected ${e}`);
}

interface World {
  goodToken: string; user: { id: string; email: string } | null; password: string;
  check: Record<string, unknown>; erase: { data?: unknown; error?: { code: string; message: string } };
  limiter: boolean; calls: string[]; removed: Record<string, string[]>; inserted: unknown[]; smtp: boolean;
}
const world = (over: Partial<World> = {}): World => ({
  goodToken: "user-jwt", user: { id: "11111111-1111-1111-1111-111111111111", email: "ada@example.com" }, password: "correct-horse",
  check: { already_deleted: false, kinds: ["owner"], blockers: [], can_delete: true },
  erase: { data: { ok: true, already_deleted: false, kinds: ["owner"], files: ["https://abcd.supabase.co/storage/v1/object/public/avatars/u/me.png", "https://evil.example/x.png"] } },
  limiter: true, calls: [], removed: {}, inserted: [], smtp: false, ...over,
});

const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function install(w: World) {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? input.toString());
    const method = (init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    const p = url.pathname;
    const bodyText = typeof init.body === "string" ? init.body : "";
    w.calls.push(`${method} ${p}`);
    if (p === "/auth/v1/user") {
      const auth = new Headers(init.headers).get("Authorization") || "";
      if (auth === `Bearer ${w.goodToken}` && w.user) return J({ id: w.user.id, email: w.user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
      return J({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }, 401);
    }
    if (p === "/auth/v1/token") {
      const b = JSON.parse(bodyText || "{}");
      if (b.password === w.password) return J({ access_token: "a", token_type: "bearer", expires_in: 3600, refresh_token: "r", user: { id: w.user?.id, email: w.user?.email } });
      return J({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
    }
    if (p === "/rest/v1/rpc/rate_limit_hit") return J(w.limiter);
    if (p === "/rest/v1/rpc/account_deletion_check") return J(w.check);
    if (p === "/rest/v1/rpc/account_erase") {
      if (w.erase.error) return J({ code: w.erase.error.code, message: w.erase.error.message, details: null, hint: null }, 400);
      return J(w.erase.data);
    }
    if (p.startsWith("/storage/v1/object/") && method === "DELETE") {
      const bucket = p.replace("/storage/v1/object/", "");
      w.removed[bucket] = (JSON.parse(bodyText || "{}").prefixes as string[]) || [];
      return J([]);
    }
    if (p === "/rest/v1/smtp_config") {
      return J({ code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }, 406);
    }
    if (p === "/rest/v1/account_deletion_requests" && method === "POST") { w.inserted.push(JSON.parse(bodyText)); return new Response(null, { status: 201 }); }
    return J({ message: `unstubbed ${method} ${p}` }, 500);
  };
}

const post = (w: World, body: unknown, headers: Record<string, string> = {}) => {
  install(w);
  return handler(new Request("https://abcd.supabase.co/functions/v1/account-delete", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
};
const authed = (w: World) => ({ Authorization: `Bearer ${w.goodToken}` });

Deno.test("check: needs a signed-in user (the anon key is not a user)", async () => {
  const w = world();
  eq((await post(w, { action: "check" })).status, 401, "no token");
  eq((await post(w, { action: "check" }, { Authorization: "Bearer anon-key" })).status, 401, "anon key");
});

Deno.test("check: returns the account kinds and blockers", async () => {
  const w = world({ check: { already_deleted: false, kinds: ["owner"], can_delete: false, blockers: [{ code: "wallet_balance", title: "Your wallet still has ₦50.00", hint: "x" }] } });
  const r = await post(w, { action: "check" }, authed(w));
  const b = await r.json();
  eq(r.status, 200, "status"); eq(b.ok, true, "ok"); eq(b.can_delete, false, "can_delete"); eq(b.blockers[0].code, "wallet_balance", "blocker");
});

Deno.test("delete: refuses without confirmation or password, and never reaches the erase", async () => {
  const w = world();
  eq((await post(w, { action: "delete", password: "correct-horse" }, authed(w))).status, 400, "no confirm");
  const r = await post(w, { action: "delete", confirm: true }, authed(w));
  eq(r.status, 400, "no password"); eq((await r.json()).code, "password_required", "code");
  eq(w.calls.includes("POST /rest/v1/rpc/account_erase"), false, "erase not called");
});

Deno.test("delete: wrong password → 403 and nothing is erased", async () => {
  const w = world();
  const r = await post(w, { action: "delete", confirm: true, password: "nope" }, authed(w));
  eq(r.status, 403, "status"); eq((await r.json()).code, "wrong_password", "code");
  eq(w.calls.includes("POST /rest/v1/rpc/account_erase"), false, "erase not called");
});

Deno.test("delete: rate-limited callers are stopped before the password is even tried", async () => {
  const w = world({ limiter: false });
  const r = await post(w, { action: "delete", confirm: true, password: "correct-horse" }, authed(w));
  eq(r.status, 429, "status");
  eq(w.calls.includes("POST /auth/v1/token"), false, "no password attempt");
  eq(w.calls.includes("POST /rest/v1/rpc/account_erase"), false, "erase not called");
});

Deno.test("delete: blockers remaining → 409 with the list (the app shows it)", async () => {
  const w = world({
    erase: { error: { code: "P0001", message: "account_erase: blockers remain" } },
    check: { already_deleted: false, kinds: ["owner"], can_delete: false, blockers: [{ code: "staff_active", title: "You still have 2 staff accounts", hint: "x" }] },
  });
  const r = await post(w, { action: "delete", confirm: true, password: "correct-horse" }, authed(w));
  const b = await r.json();
  eq(r.status, 409, "status"); eq(b.code, "blocked", "code"); eq(b.blockers[0].code, "staff_active", "blockers passed through");
});

Deno.test("delete: success erases, removes only OUR project's files, and answers ok", async () => {
  const w = world();
  const r = await post(w, { action: "delete", confirm: true, password: "correct-horse" }, authed(w));
  eq(r.status, 200, "status"); eq((await r.json()).ok, true, "ok");
  eq(w.calls.includes("POST /rest/v1/rpc/account_erase"), true, "erase called");
  eq(w.removed, { avatars: ["u/me.png"] }, "storage cleanup (foreign host ignored)");
});

Deno.test("delete: an unexpected database error is a clean 500 that says nothing was changed", async () => {
  const w = world({ erase: { error: { code: "23502", message: "null value in column" } } });
  const r = await post(w, { action: "delete", confirm: true, password: "correct-horse" }, authed(w));
  const b = await r.json();
  eq(r.status, 500, "status"); eq(/Nothing was changed/.test(b.error), true, "message"); eq(JSON.stringify(b).includes("null value"), false, "no internals leaked");
});

Deno.test("request (public): records a valid request; honeypot and bad email are not recorded", async () => {
  const w = world();
  const ok = await post(w, { action: "request", email: "Ada@Example.com", full_name: "Ada", note: "please delete" });
  eq(ok.status, 200, "ok status");
  eq((w.inserted[0] as { email: string }).email, "ada@example.com", "email lower-cased");
  const bot = await post(w, { action: "request", email: "bot@example.com", website: "http://spam" });
  eq(bot.status, 200, "bot gets a quiet ok"); eq(w.inserted.length, 1, "bot not recorded");
  const bad = await post(w, { action: "request", email: "nope" });
  eq(bad.status, 400, "bad email"); eq(w.inserted.length, 1, "bad email not recorded");
});

Deno.test("request (public): over the limit → 429, nothing recorded", async () => {
  const w = world({ limiter: false });
  const r = await post(w, { action: "request", email: "ada@example.com" });
  eq(r.status, 429, "status"); eq(w.inserted.length, 0, "not recorded");
});

Deno.test("unknown actions and non-POST are rejected", async () => {
  const w = world();
  eq((await post(w, { action: "wipe-everything" }, authed(w))).status, 400, "unknown action");
  install(w);
  eq((await handler(new Request("https://abcd.supabase.co/functions/v1/account-delete", { method: "GET" }))).status, 405, "GET");
});
