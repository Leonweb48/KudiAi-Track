// Run: deno test supabase/functions/_shared/idCheck.test.ts
import { checkIdentity, hmacHex, loadIdCheck, makeIdCheckDeps, namesMatch, personFromFullName, youverifyLookup, type CheckDeps, type Lookup, type Person, type SelfieResult } from "./idCheck.ts";

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
const SELFIE_IN = "data:image/png;base64,SUBMITTEDBYTES";
const foundWithSelfie = (sv: Record<string, unknown> | null) => ({ ...FOUND, data: { ...FOUND.data, selfieValidation: !!sv, ...(sv ? { validations: { selfie: { selfieVerification: sv }, validationMessages: "" } } : {}) } });

Deno.test("the request matches the provider's documented contract", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify(FOUND), { status: 200 }); }) as unknown as typeof fetch;
  await youverifyLookup(f, CFG, "bvn", "22222222222", "chk-1");
  eq(seen!.url, "https://api.sandbox.youverify.co/v2/api/identity/ng/bvn", "URL (trailing slash tolerated)");
  eq(seen!.init.method, "POST", "method");
  eq((seen!.init.headers as Record<string, string>).token, "secret-token", "the API token goes in the 'token' header");
  eq(JSON.parse(seen!.init.body as string), { id: "22222222222", isSubjectConsent: true, metadata: { ref: "chk-1" } }, "body has no validations key when no selfie is given");
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
  const r = await youverifyLookup(hang, CFG, "bvn", "22222222222", "c", undefined, 30);
  eq(r, { status: "unavailable", reason: "timeout" }, "timeout"); eq(calls, 1, "exactly one attempt: a retry could be billed twice");
});

Deno.test("no API token configured = unavailable, and nothing is sent", async () => {
  let called = false;
  const f = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  eq((await youverifyLookup(f, { baseUrl: CFG.baseUrl, token: "" }, "bvn", "22222222222", "c")).status, "unavailable", "status"); eq(called, false, "no request");
});

// ── selfie: request shape, response parsing, and the image-leak guard ────────────────────────────────────────────────
Deno.test("a selfie image is sent as validations.selfie.image, exactly as confirmed against the real sandbox", async () => {
  let seen: RequestInit | null = null;
  const f = (async (_u: string, init: RequestInit) => { seen = init; return new Response(JSON.stringify(foundWithSelfie({ match: true, confidenceLevel: 91, threshold: 70 })), { status: 200 }); }) as unknown as typeof fetch;
  await youverifyLookup(f, CFG, "bvn", "22222222222", "chk-1", SELFIE_IN);
  eq(JSON.parse(seen!.body as string), { id: "22222222222", isSubjectConsent: true, metadata: { ref: "chk-1" }, validations: { selfie: { image: SELFIE_IN } } }, "exact body");
});

Deno.test("a selfie match/no-match verdict is read from the nested selfieVerification object", async () => {
  const matched = await youverifyLookup(reply(200, foundWithSelfie({ match: true, confidenceLevel: 91, threshold: 70 })), CFG, "bvn", "22222222222", "c", SELFIE_IN);
  eq(matched.status === "found" && matched.selfie, { match: true, confidenceLevel: 91, threshold: 70 }, "match true");
  const noMatch = await youverifyLookup(reply(200, foundWithSelfie({ match: false, confidenceLevel: 0, threshold: 70 })), CFG, "bvn", "22222222222", "c", SELFIE_IN);
  eq(noMatch.status === "found" && noMatch.selfie, { match: false, confidenceLevel: 0, threshold: 70 }, "match false — a real result, not an error");
});

Deno.test("the provider echoes the submitted photo back in the response — it must never appear anywhere in our result", async () => {
  const withEcho = foundWithSelfie({ match: false, confidenceLevel: 12, threshold: 70, image: "data:image/png;base64,ECHOEDBACKBYTES" });
  const r = await youverifyLookup(reply(200, withEcho), CFG, "bvn", "22222222222", "c", SELFIE_IN);
  eq(JSON.stringify(r).includes("ECHOEDBACKBYTES"), false, "the echoed image never survives into our Lookup result");
  eq(r.status === "found" && Object.keys(r.selfie ?? {}).sort(), ["confidenceLevel", "match", "threshold"], "selfie carries ONLY these three fields");
});

Deno.test("no selfieVerification in an otherwise-successful reply = no selfie field at all (never guessed as pass or fail)", async () => {
  const r = await youverifyLookup(reply(200, foundWithSelfie(null)), CFG, "bvn", "22222222222", "c", SELFIE_IN);
  eq(r.status === "found" && "selfie" in r, false, "no selfie key");
});

Deno.test("a rejected photo (too small / corrupt / wrong type) is its own status, only when a selfie was actually sent", async () => {
  const badImage = reply(400, { success: false, message: "Invalid Image: Facial compare image must be a valid image, less or equal to 1MB and between 48 x 48 and 4096 x 4096 (pixels)" });
  eq((await youverifyLookup(badImage, CFG, "bvn", "22222222222", "c", SELFIE_IN)).status, "invalid_image", "with a selfie: invalid_image");
  eq((await youverifyLookup(reply(400, { success: false, message: "Invalid Image: ..." }), CFG, "bvn", "22222222222", "c")).status, "not_found", "the SAME message with no selfie sent falls through to the generic 'invalid → not_found' rule instead");
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
interface FinRow { outcome: string; matched: boolean | null; billed: boolean; selfieSubmitted: boolean; selfie?: SelfieResult | null }
interface Trace { calls: string[]; finished: FinRow[]; saved: { verifiedName: string; selfieMatched: boolean | null }[]; tables: string[]; alerts: string[]; lookupArgs: unknown[] }
function harness(o: { lookup?: Lookup | (() => Promise<Lookup>); cached?: { verifiedName: string; selfieMatched?: boolean | null } | null; rateLimited?: boolean } = {}): { deps: CheckDeps; t: Trace } {
  const t: Trace = { calls: [], finished: [], saved: [], tables: [], alerts: [], lookupArgs: [] };
  const deps: CheckDeps = {
    async cached() { t.calls.push("cached"); return o.cached ? { verifiedName: o.cached.verifiedName, selfieMatched: o.cached.selfieMatched ?? null } : null; },
    async begin() { t.calls.push("begin"); return o.rateLimited ? { ok: false, reason: "rate_limited" } : { ok: true, checkId: "chk-1" }; },
    async lookup(kind, id, ref, selfieImage) {
      t.calls.push("lookup"); t.lookupArgs.push({ kind, id, ref, selfieImage });
      const l = o.lookup ?? { status: "found", person: P("Amaka", "Chidinma", "Okonkwo"), providerRef: "prov-1" };
      return typeof l === "function" ? await l() : l;
    },
    async finish(_id, r) { t.finished.push({ outcome: r.outcome, matched: r.matched, billed: r.billed, selfieSubmitted: r.selfieSubmitted, ...(r.selfie !== undefined ? { selfie: r.selfie } : {}) }); },
    async saveVerified(a) { t.saved.push({ verifiedName: a.verifiedName, selfieMatched: a.selfieMatched }); t.tables.push(a.table); },
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
  eq(r, { ok: true, kind: "bvn", verifiedName: "Amaka Chidinma Okonkwo", cached: false, nameMatched: true, selfieMatched: null }, "result");
  eq(t.calls, ["cached", "begin", "lookup"], "order"); eq(t.saved, [{ verifiedName: "Amaka Chidinma Okonkwo", selfieMatched: null }], "saved");
  eq(t.finished, [{ outcome: "verified", matched: true, billed: true, selfieSubmitted: false, selfie: null }], "audited as billed, no selfie involved");
});

Deno.test("the person's identity table is passed on (owner by default, an Ajo client or staff when told)", async () => {
  let h = harness(); await checkIdentity(h.deps, ARGS); eq(h.t.tables, ["profiles"], "default");
  h = harness(); await checkIdentity(h.deps, { ...ARGS, table: "aso_clients" }); eq(h.t.tables, ["aso_clients"], "Ajo client");
  h = harness(); await checkIdentity(h.deps, { ...ARGS, table: "staff" }); eq(h.t.tables, ["staff"], "staff");
});

Deno.test("a name that does not match is refused — and the message never says whose number it is", async () => {
  const { deps, t } = harness({ lookup: { status: "found", person: P("Blessing", "Ifeoma", "Nwosu"), providerRef: "p" } });
  const r = await checkIdentity(deps, ARGS);
  eq(r.ok === false && r.code, "mismatch", "code"); eq(t.saved, [], "nothing saved as verified");
  eq(t.finished, [{ outcome: "mismatch", matched: false, billed: true, selfieSubmitted: false, selfie: null }], "audited");
  const msg = JSON.stringify(r);
  for (const leak of ["Blessing", "Ifeoma", "Nwosu"]) if (msg.includes(leak)) throw new Error("the stranger's name leaked: " + leak);
});

Deno.test("with no personal name on file the ID is still checked for existence, and recorded as unchecked", async () => {
  const { deps, t } = harness(); const r = await checkIdentity(deps, { ...ARGS, declaredName: "" });
  eq(r.ok && r.nameMatched, null, "unchecked"); eq(t.finished, [{ outcome: "verified", matched: null, billed: true, selfieSubmitted: false, selfie: null }], "audited with no match result");
});

Deno.test("an ID already verified for this person costs nothing: no lookup, no attempt counted", async () => {
  const { deps, t } = harness({ cached: { verifiedName: "Amaka Chidinma Okonkwo" } });
  const r = await checkIdentity(deps, ARGS);
  eq(r, { ok: true, kind: "bvn", verifiedName: "Amaka Chidinma Okonkwo", cached: true, nameMatched: true, selfieMatched: null }, "result"); eq(t.calls, ["cached"], "only the cache was read");
  const r2 = await checkIdentity(harness({ cached: { verifiedName: "Amaka Chidinma Okonkwo" } }).deps, { ...ARGS, declaredName: "Someone Else" });
  eq(r2.ok === false && r2.code, "mismatch", "…but a different name is still compared with the verified one");
});

Deno.test("too many tries: refused before any (billable) lookup", async () => {
  const { deps, t } = harness({ rateLimited: true }); const r = await checkIdentity(deps, ARGS);
  eq(r.ok === false && r.code, "rate_limited", "code"); eq(t.calls, ["cached", "begin"], "no lookup");
});

Deno.test("a number that does not exist", async () => {
  const { deps, t } = harness({ lookup: { status: "not_found" } }); const r = await checkIdentity(deps, ARGS);
  eq(r.ok === false && r.code, "not_found", "code"); eq(t.finished, [{ outcome: "not_found", matched: null, billed: false, selfieSubmitted: false }], "audited, not billed"); eq(t.saved, [], "nothing saved");
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

// ── the check flow: selfie ────────────────────────────────────────────────────────────────────────────────────────
const SARGS = { ...ARGS, selfieImage: SELFIE_IN, selfieRequired: true };
const foundR = (person: Person, selfie?: SelfieResult): Lookup => ({ status: "found", person, providerRef: "prov-1", ...(selfie ? { selfie } : {}) });

Deno.test("a required selfie with no photo attached is refused before any lookup", async () => {
  const { deps, t } = harness(); const r = await checkIdentity(deps, { ...ARGS, selfieRequired: true });
  eq(r, { ok: false, code: "selfie_required", message: "Take a selfie to finish verifying your identity." }, "refused"); eq(t.calls, [], "nothing touched");
});

Deno.test("name matches and the selfie matches: verified, both facts saved and audited", async () => {
  const { deps, t } = harness({ lookup: foundR(P("Amaka", "Chidinma", "Okonkwo"), { match: true, confidenceLevel: 88, threshold: 70 }) });
  const r = await checkIdentity(deps, SARGS);
  eq(r, { ok: true, kind: "bvn", verifiedName: "Amaka Chidinma Okonkwo", cached: false, nameMatched: true, selfieMatched: true }, "result");
  eq(t.saved, [{ verifiedName: "Amaka Chidinma Okonkwo", selfieMatched: true }], "saved with selfieMatched");
  eq(t.finished, [{ outcome: "verified", matched: true, billed: true, selfieSubmitted: true, selfie: { match: true, confidenceLevel: 88, threshold: 70 } }], "audited with the full verdict");
  eq((t.lookupArgs[0] as { selfieImage?: string }).selfieImage, SELFIE_IN, "the photo was actually sent to the lookup");
});

Deno.test("name matches but the selfie does not, and it was required: refused, nothing saved as verified", async () => {
  const { deps, t } = harness({ lookup: foundR(P("Amaka", "Chidinma", "Okonkwo"), { match: false, confidenceLevel: 12, threshold: 70 }) });
  const r = await checkIdentity(deps, SARGS);
  eq(r, { ok: false, code: "selfie_no_match", message: "Your selfie doesn't look like the photo on file for this ID. Make sure your face is clearly lit and try again." }, "refused");
  eq(t.saved, [], "not saved as verified"); eq(t.finished, [{ outcome: "mismatch", matched: true, billed: true, selfieSubmitted: true, selfie: { match: false, confidenceLevel: 12, threshold: 70 } }], "audited as billed (a real check ran)");
});

Deno.test("a selfie that doesn't match is NOT held against the customer when it was only optional (selfieRequired not set)", async () => {
  const { deps, t } = harness({ lookup: foundR(P("Amaka", "Chidinma", "Okonkwo"), { match: false, confidenceLevel: 5, threshold: 70 }) });
  const r = await checkIdentity(deps, { ...ARGS, selfieImage: SELFIE_IN });   // no selfieRequired
  eq(r.ok && r.selfieMatched, false, "still passes, the false result is just recorded"); eq(t.saved, [{ verifiedName: "Amaka Chidinma Okonkwo", selfieMatched: false }], "recorded honestly");
});

Deno.test("a rejected photo is its own error, distinct from ID-not-found or name-mismatch, and is not billed", async () => {
  const { deps, t } = harness({ lookup: { status: "invalid_image" } }); const r = await checkIdentity(deps, SARGS);
  eq(r.ok === false && r.code, "selfie_invalid_image", "code"); eq(t.finished, [{ outcome: "unavailable", matched: null, billed: false, selfieSubmitted: true, selfie: null }], "not billed"); eq(t.saved, [], "nothing saved");
});

Deno.test("the provider accepts the photo but returns no verdict at all: never guessed as a pass, admins are told", async () => {
  const { deps, t } = harness({ lookup: foundR(P("Amaka", "Chidinma", "Okonkwo")) });   // no `selfie` key on the Lookup, as if the contract changed
  const r = await checkIdentity(deps, SARGS);
  eq(r.ok === false && r.code, "unavailable", "customer sees a generic outage, not a pass"); eq(t.saved, [], "nothing saved as verified");
  eq(t.alerts, ["ID verification: selfie result missing"], "admins told to check the response shape");
  eq(t.finished, [{ outcome: "unavailable", matched: true, billed: true, selfieSubmitted: true, selfie: null }], "billed — a real lookup happened, the gap is on the verdict, not the check");
});

Deno.test("a cached ID/name verification does NOT excuse a selfie an action now requires — a fresh check (with a fresh photo) runs", async () => {
  let h = harness({ cached: { verifiedName: "Amaka Chidinma Okonkwo", selfieMatched: null }, lookup: foundR(P("Amaka", "Chidinma", "Okonkwo"), { match: true, confidenceLevel: 80, threshold: 70 }) });
  let r = await checkIdentity(h.deps, SARGS);
  eq(h.t.calls, ["cached", "begin", "lookup"], "never verified with a selfie before: a fresh check runs"); eq(r.ok && r.cached, false, "not served from cache");

  h = harness({ cached: { verifiedName: "Amaka Chidinma Okonkwo", selfieMatched: false }, lookup: foundR(P("Amaka", "Chidinma", "Okonkwo"), { match: true, confidenceLevel: 80, threshold: 70 }) });
  r = await checkIdentity(h.deps, SARGS);
  eq(h.t.calls, ["cached", "begin", "lookup"], "previously FAILED the selfie: also forces a fresh attempt, not a permanent block"); eq(r.ok, true, "and can pass this time");

  h = harness({ cached: { verifiedName: "Amaka Chidinma Okonkwo", selfieMatched: true } });
  r = await checkIdentity(h.deps, SARGS);
  eq(h.t.calls, ["cached"], "already selfie-verified: served from cache, no new lookup"); eq(r, { ok: true, kind: "bvn", verifiedName: "Amaka Chidinma Okonkwo", cached: true, nameMatched: true, selfieMatched: true }, "result");
});

Deno.test("an action that does NOT require a selfie still uses the cache normally, whatever the stored selfie state", async () => {
  for (const selfieMatched of [null, false, true]) {
    const { deps, t } = harness({ cached: { verifiedName: "Amaka Chidinma Okonkwo", selfieMatched } });
    const r = await checkIdentity(deps, ARGS);   // no selfieRequired
    eq(t.calls, ["cached"], "cache used regardless of past selfie state " + selfieMatched); eq(r.ok && r.cached, true, "served from cache");
  }
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
Deno.test("the database wiring maps the RPCs, reads the cache by hash (incl. its selfie state), and de-duplicates admin alerts", async () => {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []; const inserts: unknown[] = []; let recent = false;
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return fn === "kyc_check_begin" ? { data: args.p_max_per_day === 0 ? { ok: false } : { ok: true, id: "abc" }, error: null } : { data: null, error: null }; },
    from: (t: string) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { verified_name: "Amaka Okonkwo", id_hmac: "h1", selfie_matched: true } }) }), gte: () => ({ limit: async () => ({ data: recent ? [{ id: 1 }] : [] }) }) }), gte: () => ({ limit: async () => ({ data: recent ? [{ id: 1 }] : [] }) }) }),
      insert: async (row: unknown) => { inserts.push({ t, row }); return {}; },
    }),
  };
  const mk = (max: number) => makeIdCheckDeps(sb, { fetchFn: reply(200, FOUND), cfg: CFG, maxPerDay: max, consentVersion: "v1" });
  eq(await mk(6).begin({ userId: "u", kind: "nin", hmac: "h" }), { ok: true, checkId: "abc" }, "begin ok");
  eq(await mk(0).begin({ userId: "u", kind: "nin", hmac: "h" }), { ok: false, reason: "rate_limited" }, "begin limited");
  eq(rpcs[0], { fn: "kyc_check_begin", args: { p_user: "u", p_kind: "nin", p_hmac: "h", p_max_per_day: 6, p_consent_version: "v1" } }, "rpc args");
  eq(await mk(6).cached({ userId: "u", kind: "bvn", hmac: "h1" }), { verifiedName: "Amaka Okonkwo", selfieMatched: true }, "cache hit only for the SAME number, selfie state read too");
  eq(await mk(6).cached({ userId: "u", kind: "bvn", hmac: "other" }), null, "a different number is not a cache hit");
  await mk(6).alertAdmins("t", "m"); eq(inserts.length, 1, "first alert inserted"); recent = true; await mk(6).alertAdmins("t", "m"); eq(inserts.length, 1, "repeat within 6h suppressed");

  await mk(6).finish("c1", { outcome: "verified", matched: true, providerRef: "p", billed: true, selfieSubmitted: true, selfie: { match: true, confidenceLevel: 91, threshold: 70 } });
  eq(rpcs.find((r) => r.fn === "kyc_check_finish")!.args, { p_id: "c1", p_outcome: "verified", p_matched: true, p_provider_ref: "p", p_billed: true, p_selfie_submitted: true, p_selfie_matched: true, p_selfie_confidence: 91 }, "finish() args, with a selfie");
  rpcs.length = 0;
  await mk(6).finish("c2", { outcome: "verified", matched: true, billed: true, selfieSubmitted: false });
  eq(rpcs[0].args, { p_id: "c2", p_outcome: "verified", p_matched: true, p_provider_ref: null, p_billed: true, p_selfie_submitted: false, p_selfie_matched: null, p_selfie_confidence: null }, "finish() args, no selfie at all");

  await mk(6).saveVerified({ userId: "u", kind: "bvn", hmac: "h", verifiedName: "Amaka Okonkwo", providerRef: "p", checkId: "c1", matched: true, table: "profiles", selfieMatched: true });
  eq(rpcs.find((r) => r.fn === "kyc_save_verified")!.args, { p_user: "u", p_kind: "bvn", p_hmac: "h", p_name: "Amaka Okonkwo", p_provider_ref: "p", p_check_id: "c1", p_matched: true, p_table: "profiles", p_selfie_matched: true }, "saveVerified() args, with selfieMatched");
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
