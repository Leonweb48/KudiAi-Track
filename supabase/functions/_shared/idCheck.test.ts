// Run: deno test supabase/functions/_shared/idCheck.test.ts
import { checkIdentity, hmacHex, loadIdCheck, makeIdCheckDeps, namesMatch, personFromFullName, youverifyLookup, type CheckDeps, type Lookup, type Person } from "./idCheck.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT ${msg}: got ${a}, expected ${e}`);
}

// ── the provider client, against fake HTTP ────────────────────────────────────────────────────────────────────────
const CFG = { baseUrl: "https://api.sandbox.youverify.co/", token: "secret-token" };
const reply = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
const FOUND = { success: true, statusCode: 200, message: "success", data: {
  id: "6491edda239381d3be87a5fb", status: "found", firstName: "Sarah", middleName: "Jane", lastName: "Doe", dateOfBirth: "1988-04-04", mobile: "08000000000",
  gender: "f", image: "data:image/jpg;base64,AAAA", signature: "data:image/jpg;base64,BBBB", address: { town: "SULEJA", addressLine: "13B Fake Street" } } };

Deno.test("the request matches the provider's documented contract", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify(FOUND), { status: 200 }); }) as unknown as typeof fetch;
  await youverifyLookup(f, CFG, "bvn", "22222222222", "chk-1");
  eq(seen!.url, "https://api.sandbox.youverify.co/v2/api/identity/ng/bvn", "URL (trailing slash tolerated)");
  eq(seen!.init.method, "POST", "method");
  eq((seen!.init.headers as Record<string, string>).token, "secret-token", "the API token goes in the 'token' header");
  eq(JSON.parse(seen!.init.body as string), { id: "22222222222", isSubjectConsent: true, metadata: { ref: "chk-1" } }, "body");
  await youverifyLookup(f, CFG, "nin", "33333333333", "chk-2");
  eq(seen!.url, "https://api.sandbox.youverify.co/v2/api/identity/ng/nin", "NIN endpoint");
});

Deno.test("a found record yields ONLY the names — never the photo, address, phone or date of birth", async () => {
  const r = await youverifyLookup(reply(200, FOUND), CFG, "bvn", "22222222222", "c");
  eq(r, { status: "found", person: { firstName: "Sarah", middleName: "Jane", lastName: "Doe" }, providerRef: "6491edda239381d3be87a5fb" }, "result");
  const dump = JSON.stringify(r);
  for (const leak of ["AAAA", "BBBB", "SULEJA", "08000000000", "1988", "Fake Street"]) if (dump.includes(leak)) throw new Error("leaked " + leak);
});

Deno.test("failure statuses map to the right outcomes", async () => {
  const st = async (f: typeof fetch) => (await youverifyLookup(f, CFG, "nin", "44444444444", "c")).status;
  eq(await st(reply(402, { message: "Insufficient fund" })), "no_funds", "402 = our provider wallet is empty");
  eq(await st(reply(403, { message: "Permission denied" })), "unavailable", "403");
  eq(await st(reply(401, {})), "unavailable", "401");
  eq(await st(reply(500, { message: "Service unavailable" })), "unavailable", "500");
  eq(await st(reply(502, "<html>bad gateway</html>")), "unavailable", "non-JSON 5xx");
  eq(await st(reply(404, { message: "NIN not found" })), "not_found", "404 with a not-found message");
  eq(await st(reply(400, { success: false, message: "Invalid NIN supplied" })), "not_found", "400 invalid number");
  eq(await st(reply(404, { message: "route missing" })), "unavailable", "an unexplained 4xx is not held against the customer");
  eq(await st(reply(200, { success: true, data: { status: "not_found" } })), "not_found", "200 with status not_found");
  eq(await st(reply(200, { success: false, message: "Record not found" })), "not_found", "200 success:false not found");
  eq(await st(reply(200, { success: true, data: null })), "unavailable", "200 with no data");
  eq(await st(reply(200, { success: true, data: { status: "found", firstName: "", lastName: "" } })), "unavailable", "found but empty");
  eq(await st(reply(200, "not json")), "unavailable", "garbage 200");
  eq(await st((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch), "unavailable", "network error");
});

Deno.test("a slow provider times out as 'unavailable' (one attempt, no retry)", async () => {
  let calls = 0;
  const hang = ((_u: string, init: RequestInit) => { calls++; return new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))); }) as unknown as typeof fetch;
  const r = await youverifyLookup(hang, CFG, "bvn", "22222222222", "c", 30);
  eq(r, { status: "unavailable", reason: "timeout" }, "timeout"); eq(calls, 1, "exactly one attempt: a retry could be billed twice");
});

Deno.test("no API token configured = unavailable, and nothing is sent", async () => {
  let called = false;
  const f = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  eq((await youverifyLookup(f, { baseUrl: CFG.baseUrl, token: "" }, "bvn", "22222222222", "c")).status, "unavailable", "status"); eq(called, false, "no request");
});

// ── name matching ─────────────────────────────────────────────────────────────────────────────────────────────────
const P = (firstName: string, middleName: string, lastName: string): Person => ({ firstName, middleName, lastName });

Deno.test("names that are the same person match, in any order and case", () => {
  const ok: [string, Person][] = [
    ["Amaka Okonkwo", P("AMAKA", "CHIDINMA", "OKONKWO")],
    ["okonkwo amaka", P("Amaka", "Chidinma", "Okonkwo")],
    ["Chidinma Okonkwo", P("Amaka", "Chidinma", "Okonkwo")],                 // goes by the middle name
    ["Amaka Chidinma Okonkwo", P("Amaka", "Chidinma", "Okonkwo")],
    ["Chukwuemeka Obi", P("Chukwu Emeka", "", "Obi")],                        // first name written as one word
    ["Chukwu Emeka Obi", P("Chukwuemeka", "", "Obi")],                        // …and the other way round
    ["Ngozi Adeyemi-Bello", P("Ngozi", "", "Adeyemi Bello")],                 // hyphenated surname
    ["Ngozi Adeyemi", P("Ngozi", "", "Adeyemi-Bello")],                       // …only half of it typed
    ["Seán Ó Briain", P("Sean", "", "O Briain")],                             // accents
    ["Kemi O'Neil", P("Kemi", "", "Oneil")],                                  // apostrophes
    ["Oluwaseun Adebayo", P("Oluwaseun", "", "Adebayo")],
    ["Oluwaseun Adebaio", P("Oluwaseun", "", "Adebayo")],                     // one typo on a long name
    ["  Amaka   Okonkwo  ", P("Amaka", "", "Okonkwo")],                       // stray spaces
  ];
  for (const [d, p] of ok) eq(namesMatch(d, p), true, `${d} ~ ${JSON.stringify(p)}`);
});

Deno.test("names that are different people do not match", () => {
  const no: [string, Person][] = [
    ["Amaka Okonkwo", P("Blessing", "", "Okonkwo")],                          // same surname only
    ["Amaka Okonkwo", P("Amaka", "", "Eze")],                                 // same first name only
    ["John Doe", P("Jane", "", "Roe")],
    ["Amaya & Co.", P("Amaka", "", "Okonkwo")],                               // a business name
    ["", P("Amaka", "", "Okonkwo")],
    ["Amaka", P("Amaka", "", "Okonkwo")],                                     // surname missing
    ["Ade Bola", P("Ada", "", "Bala")],                                       // short names must match exactly
    ["Oluwaseun Adebayo", P("Oluwaseun", "", "Adekunle")],
  ];
  for (const [d, p] of no) eq(namesMatch(d, p), false, `${d} !~ ${JSON.stringify(p)}`);
  eq(namesMatch("Ibrahim Musa", P("Musa", "", "Ibrahim")), true, "first/last swapped is still the same two words");
});

Deno.test("a stored verified name can be re-read into parts", () => {
  eq(personFromFullName("Amaka Chidinma Okonkwo"), { firstName: "Amaka", middleName: "Chidinma", lastName: "Okonkwo" }, "three words");
  eq(personFromFullName("Amaka Okonkwo"), { firstName: "Amaka", middleName: "", lastName: "Okonkwo" }, "two words");
  eq(personFromFullName("Madonna"), { firstName: "Madonna", middleName: "", lastName: "" }, "one word");
  eq(namesMatch("Amaka Okonkwo", personFromFullName("Amaka Chidinma Okonkwo")), true, "round trip");
});

// ── the check flow ────────────────────────────────────────────────────────────────────────────────────────────────
interface Trace { calls: string[]; finished: { outcome: string; matched: boolean | null; billed: boolean }[]; saved: { verifiedName: string }[]; tables: string[]; alerts: string[] }
function harness(o: { lookup?: Lookup | (() => Promise<Lookup>); cached?: { verifiedName: string } | null; rateLimited?: boolean } = {}): { deps: CheckDeps; t: Trace } {
  const t: Trace = { calls: [], finished: [], saved: [], tables: [], alerts: [] };
  const deps: CheckDeps = {
    async cached() { t.calls.push("cached"); return o.cached ?? null; },
    async begin() { t.calls.push("begin"); return o.rateLimited ? { ok: false, reason: "rate_limited" } : { ok: true, checkId: "chk-1" }; },
    async lookup() { t.calls.push("lookup"); const l = o.lookup ?? { status: "found", person: P("Amaka", "Chidinma", "Okonkwo"), providerRef: "prov-1" }; return typeof l === "function" ? await l() : l; },
    async finish(_id, r) { t.finished.push({ outcome: r.outcome, matched: r.matched, billed: r.billed }); },
    async saveVerified(a) { t.saved.push({ verifiedName: a.verifiedName }); t.tables.push(a.table); },
    async alertAdmins(title) { t.alerts.push(title); },
  };
  return { deps, t };
}
const ARGS = { userId: "u1", kind: "bvn" as const, id: "22222222222", consent: true, declaredName: "Amaka Okonkwo", hmac: "h1" };

Deno.test("no consent, or a malformed number, stops before anything is looked up or recorded", async () => {
  for (const [patch, code] of [[{ consent: false }, "consent_required"], [{ consent: undefined as unknown as boolean }, "consent_required"], [{ id: "1234567890" }, "id_format"], [{ id: "1234567890a" }, "id_format"], [{ id: "" }, "id_format"]] as [Partial<typeof ARGS>, string][]) {
    const { deps, t } = harness(); const r = await checkIdentity(deps, { ...ARGS, ...patch });
    eq(r.ok === false && r.code, code, "code " + JSON.stringify(patch)); eq(t.calls, [], "nothing touched");
  }
});

Deno.test("a matching person is verified: looked up once, recorded once, the found name is returned", async () => {
  const { deps, t } = harness(); const r = await checkIdentity(deps, ARGS);
  eq(r, { ok: true, kind: "bvn", verifiedName: "Amaka Chidinma Okonkwo", cached: false, nameMatched: true }, "result");
  eq(t.calls, ["cached", "begin", "lookup"], "order"); eq(t.saved, [{ verifiedName: "Amaka Chidinma Okonkwo" }], "saved"); eq(t.finished, [{ outcome: "verified", matched: true, billed: true }], "audited as billed");
});

Deno.test("the person's identity table is passed on (owner by default, an Ajo client or staff when told)", async () => {
  let h = harness(); await checkIdentity(h.deps, ARGS); eq(h.t.tables, ["profiles"], "default");
  h = harness(); await checkIdentity(h.deps, { ...ARGS, table: "aso_clients" }); eq(h.t.tables, ["aso_clients"], "Ajo client");
  h = harness(); await checkIdentity(h.deps, { ...ARGS, table: "staff" }); eq(h.t.tables, ["staff"], "staff");
});

Deno.test("a name that does not match is refused — and the message never says whose number it is", async () => {
  const { deps, t } = harness({ lookup: { status: "found", person: P("Blessing", "Ifeoma", "Nwosu"), providerRef: "p" } });
  const r = await checkIdentity(deps, ARGS);
  eq(r.ok === false && r.code, "mismatch", "code"); eq(t.saved, [], "nothing saved as verified"); eq(t.finished, [{ outcome: "mismatch", matched: false, billed: true }], "audited");
  const msg = JSON.stringify(r);
  for (const leak of ["Blessing", "Ifeoma", "Nwosu"]) if (msg.includes(leak)) throw new Error("the stranger's name leaked: " + leak);
});

Deno.test("with no personal name on file the ID is still checked for existence, and recorded as unchecked", async () => {
  const { deps, t } = harness(); const r = await checkIdentity(deps, { ...ARGS, declaredName: "" });
  eq(r.ok && r.nameMatched, null, "unchecked"); eq(t.finished, [{ outcome: "verified", matched: null, billed: true }], "audited with no match result");
});

Deno.test("an ID already verified for this person costs nothing: no lookup, no attempt counted", async () => {
  const { deps, t } = harness({ cached: { verifiedName: "Amaka Chidinma Okonkwo" } });
  const r = await checkIdentity(deps, ARGS);
  eq(r, { ok: true, kind: "bvn", verifiedName: "Amaka Chidinma Okonkwo", cached: true, nameMatched: true }, "result"); eq(t.calls, ["cached"], "only the cache was read");
  const r2 = await checkIdentity(harness({ cached: { verifiedName: "Amaka Chidinma Okonkwo" } }).deps, { ...ARGS, declaredName: "Someone Else" });
  eq(r2.ok === false && r2.code, "mismatch", "…but a different name is still compared with the verified one");
});

Deno.test("too many tries: refused before any (billable) lookup", async () => {
  const { deps, t } = harness({ rateLimited: true }); const r = await checkIdentity(deps, ARGS);
  eq(r.ok === false && r.code, "rate_limited", "code"); eq(t.calls, ["cached", "begin"], "no lookup");
});

Deno.test("a number that does not exist", async () => {
  const { deps, t } = harness({ lookup: { status: "not_found" } }); const r = await checkIdentity(deps, ARGS);
  eq(r.ok === false && r.code, "not_found", "code"); eq(t.finished, [{ outcome: "not_found", matched: null, billed: false }], "audited, not billed"); eq(t.saved, [], "nothing saved");
});

Deno.test("an empty provider wallet or a broken key alerts the admins; a mere timeout does not", async () => {
  let h = harness({ lookup: { status: "no_funds" } }); let r = await checkIdentity(h.deps, ARGS);
  eq(r.ok === false && r.code, "unavailable", "customer sees a generic outage"); eq(h.t.alerts.length, 1, "admins told"); eq(JSON.stringify(r).includes("fund"), false, "the customer is not told about our provider wallet");
  h = harness({ lookup: { status: "unavailable", reason: "refused (403): Permission denied" } }); r = await checkIdentity(h.deps, ARGS);
  eq(h.t.alerts.length, 1, "a refused key alerts");
  h = harness({ lookup: { status: "unavailable", reason: "timeout" } }); r = await checkIdentity(h.deps, ARGS);
  eq([r.ok === false && r.code, h.t.alerts.length], ["unavailable", 0], "a timeout is just retried by the customer");
  h = harness({ lookup: async () => { throw new Error("boom"); } }); r = await checkIdentity(h.deps, ARGS);
  eq(r.ok === false && r.code, "unavailable", "a thrown error is an outage, not a crash"); eq(h.t.finished[0].outcome, "unavailable", "audited");
});

Deno.test("a failure to alert never breaks the customer's request", async () => {
  const { deps } = harness({ lookup: { status: "no_funds" } });
  deps.alertAdmins = async () => { throw new Error("db down"); };
  eq((await checkIdentity(deps, ARGS)).ok, false, "still a clean refusal");
});

// ── keyed hash ────────────────────────────────────────────────────────────────────────────────────────────────────
Deno.test("the keyed hash is stable, keyed and label-separated", async () => {
  const a = await hmacHex("k1", "bvn", "22222222222");
  eq(/^[0-9a-f]{64}$/.test(a), true, "64 hex"); eq(a, await hmacHex("k1", "bvn", "22222222222"), "stable");
  eq(a === await hmacHex("k2", "bvn", "22222222222"), false, "another key, another hash"); eq(a === await hmacHex("k1", "nin", "22222222222"), false, "a BVN and a NIN with the same digits do not collide");
  // the exact scheme wallet_kyc uses today (label:value, HMAC-SHA256)
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("k1"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const ref = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("bvn:22222222222")))).map((x) => x.toString(16).padStart(2, "0")).join("");
  eq(a, ref, "same as the existing wallet_kyc scheme");
});

// ── the database wiring ───────────────────────────────────────────────────────────────────────────────────────────
Deno.test("the database wiring maps the RPCs, reads the cache by hash, and de-duplicates admin alerts", async () => {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []; const inserts: unknown[] = []; let recent = false;
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return fn === "kyc_check_begin" ? { data: args.p_max_per_day === 0 ? { ok: false } : { ok: true, id: "abc" }, error: null } : { data: null, error: null }; },
    from: (t: string) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { verified_name: "Amaka Okonkwo", id_hmac: "h1" } }) }), gte: () => ({ limit: async () => ({ data: recent ? [{ id: 1 }] : [] }) }) }), gte: () => ({ limit: async () => ({ data: recent ? [{ id: 1 }] : [] }) }) }),
      insert: async (row: unknown) => { inserts.push({ t, row }); return {}; },
    }),
  };
  const mk = (max: number) => makeIdCheckDeps(sb, { fetchFn: reply(200, FOUND), cfg: CFG, maxPerDay: max, consentVersion: "v1" });
  eq(await mk(6).begin({ userId: "u", kind: "nin", hmac: "h" }), { ok: true, checkId: "abc" }, "begin ok");
  eq(await mk(0).begin({ userId: "u", kind: "nin", hmac: "h" }), { ok: false, reason: "rate_limited" }, "begin limited");
  eq(rpcs[0], { fn: "kyc_check_begin", args: { p_user: "u", p_kind: "nin", p_hmac: "h", p_max_per_day: 6, p_consent_version: "v1" } }, "rpc args");
  eq(await mk(6).cached({ userId: "u", kind: "bvn", hmac: "h1" }), { verifiedName: "Amaka Okonkwo" }, "cache hit only for the SAME number");
  eq(await mk(6).cached({ userId: "u", kind: "bvn", hmac: "other" }), null, "a different number is not a cache hit");
  await mk(6).alertAdmins("t", "m"); eq(inserts.length, 1, "first alert inserted"); recent = true; await mk(6).alertAdmins("t", "m"); eq(inserts.length, 1, "repeat within 6h suppressed");
});

Deno.test("the switches: off by default; on builds the provider address, limit and fail-open from config", async () => {
  const mk = (c: Record<string, string>) => async (k: string, d: string) => c[k] ?? d;
  const sb = { rpc: async () => ({ data: { ok: true, id: "x" }, error: null }), from: () => ({}) };
  eq((await loadIdCheck(sb, mk({}), { fetchFn: reply(200, FOUND), token: "t" })).enabled, false, "no setting = off");
  eq((await loadIdCheck(sb, mk({ kyc_youverify_enabled: "false" }), { fetchFn: reply(200, FOUND), token: "t" })).enabled, false, "false = off");
  for (const junk of ["", "yes", "1", "TRUE", "on", "youverify"]) eq((await loadIdCheck(sb, mk({ kyc_youverify_enabled: junk }), { fetchFn: reply(200, FOUND), token: "t" })).enabled, false, "only the exact string 'true' turns it on: " + JSON.stringify(junk));
  eq((await loadIdCheck(sb, mk({ kyc_live: "true" }), { fetchFn: reply(200, FOUND), token: "t" })).enabled, false, "the live switch alone does not turn checks on");
  let url = "";
  const spy = (async (u: string) => { url = u; return new Response(JSON.stringify(FOUND)); }) as unknown as typeof fetch;
  const on = await loadIdCheck(sb, mk({ kyc_youverify_enabled: "true", kyc_youverify_base: "http://127.0.0.1:1", kyc_fail_open: "true" }), { fetchFn: spy, token: "t" });
  if (!on.enabled) throw new Error("should be enabled");
  eq(on.failOpen, true, "fail-open follows the setting"); await on.deps.lookup("nin", "22222222222", "r"); eq(url, "http://127.0.0.1:1/v2/api/identity/ng/nin", "an explicit address overrides the environment (tests only)");
  const def = await loadIdCheck(sb, mk({ kyc_youverify_enabled: "true" }), { fetchFn: spy, token: "t" });
  if (!def.enabled) throw new Error("should be enabled"); eq(def.failOpen, false, "fails closed by default"); await def.deps.lookup("bvn", "22222222222", "r"); eq(url, "https://api.sandbox.youverify.co/v2/api/identity/ng/bvn", "SANDBOX by default");
  const live = await loadIdCheck(sb, mk({ kyc_youverify_enabled: "true", kyc_youverify_live: "true" }), { fetchFn: spy, token: "t" });
  if (!live.enabled) throw new Error("should be enabled"); await live.deps.lookup("bvn", "22222222222", "r"); eq(url, "https://api.youverify.co/v2/api/identity/ng/bvn", "LIVE only when the live switch is on");
  const notLive = await loadIdCheck(sb, mk({ kyc_youverify_enabled: "true", kyc_youverify_live: "yes" }), { fetchFn: spy, token: "t" });
  if (!notLive.enabled) throw new Error("should be enabled"); await notLive.deps.lookup("bvn", "22222222222", "r"); eq(url, "https://api.sandbox.youverify.co/v2/api/identity/ng/bvn", "anything but 'true' stays on the sandbox");
  const bad = await loadIdCheck(sb, mk({ kyc_youverify_enabled: "true", kyc_max_checks_per_day: "abc" }), { fetchFn: spy, token: "t" });
  if (!bad.enabled) throw new Error("should be enabled"); eq(await bad.deps.begin({ userId: "u", kind: "bvn", hmac: "h" }), { ok: true, checkId: "x" }, "(the RPC is faked; the limit itself is tested in SQL)");
});
