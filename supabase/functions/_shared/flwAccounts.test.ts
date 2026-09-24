// deno test --no-lock --node-modules-dir=none supabase/functions/_shared/flwAccounts.test.ts
import { graceStatus, identifySigner, isConfigured, loadAccounts, resolveActive } from "./flwAccounts.ts";

function assert(cond: unknown, msg: string) { if (!cond) throw new Error("assertion failed: " + msg); }
const fakeHmac = (secret: string, body: string) => `hmac(${secret}|${body})`;
const env = (m: Record<string, string>) => (k: string) => m[k];

Deno.test("legacy keeps the existing secret names; business uses FLW_BIZ_*; business base defaults to legacy's", () => {
  const a = loadAccounts(env({
    FLW_CLIENT_ID: "old-id", FLW_CLIENT_SECRET: "old-sec", FLW_BASE_URL: "https://live.example", FLW_V3_SECRET_KEY: "old-v3", FLW_WEBHOOK_SECRET_HASH: "old-hash",
    FLW_BIZ_CLIENT_ID: "new-id", FLW_BIZ_CLIENT_SECRET: "new-sec", FLW_BIZ_WEBHOOK_SECRET_HASH: "new-hash",
  }));
  assert(a.legacy.clientId === "old-id" && a.legacy.webhookHash === "old-hash" && a.legacy.v3Key === "old-v3", "legacy from the old names");
  assert(a.business.clientId === "new-id" && a.business.webhookHash === "new-hash", "business from FLW_BIZ_*");
  assert(a.business.base === "https://live.example", "business base falls back to legacy's");
  assert(isConfigured(a.legacy) && isConfigured(a.business), "both configured");
  assert(!isConfigured(loadAccounts(env({})).business), "business not configured when its secrets are absent");
  assert(loadAccounts(env({})).legacy.base.includes("sandbox"), "no base configured -> sandbox default (unchanged behaviour)");
});

Deno.test("active account: 'business' only when configured; a missing configuration falls back to legacy loudly", () => {
  const both = loadAccounts(env({ FLW_CLIENT_ID: "a", FLW_CLIENT_SECRET: "b", FLW_BIZ_CLIENT_ID: "c", FLW_BIZ_CLIENT_SECRET: "d" }));
  assert(resolveActive(both, "business").key === "business", "flag business + configured");
  assert(resolveActive(both, "legacy").key === "legacy", "flag legacy");
  assert(resolveActive(both, undefined).key === "legacy", "no flag = legacy (today's behaviour)");
  assert(resolveActive(both, "garbage").key === "legacy", "unknown flag = legacy");
  const onlyLegacy = loadAccounts(env({ FLW_CLIENT_ID: "a", FLW_CLIENT_SECRET: "b" }));
  const warnings: string[] = [];
  assert(resolveActive(onlyLegacy, "business", (m) => warnings.push(m)).key === "legacy", "business flagged but not configured -> legacy");
  assert(warnings.length === 1, "and it warns");
});

Deno.test("webhook signer: each account's hash (or its HMAC) identifies it; unknown and empty signatures match nothing", () => {
  const a = loadAccounts(env({ FLW_WEBHOOK_SECRET_HASH: "old-hash", FLW_BIZ_WEBHOOK_SECRET_HASH: "new-hash" }));
  const body = '{"type":"charge.completed"}';
  assert(identifySigner("old-hash", body, a, fakeHmac) === "legacy", "legacy plain hash");
  assert(identifySigner("new-hash", body, a, fakeHmac) === "business", "business plain hash");
  assert(identifySigner(fakeHmac("old-hash", body), body, a, fakeHmac) === "legacy", "legacy HMAC");
  assert(identifySigner(fakeHmac("new-hash", body), body, a, fakeHmac) === "business", "business HMAC");
  assert(identifySigner("nope", body, a, fakeHmac) === null, "unknown signature");
  assert(identifySigner("", body, a, fakeHmac) === null, "empty signature");
  assert(identifySigner(fakeHmac("old-hash", "different body"), body, a, fakeHmac) === null, "HMAC of another body");
  const noBiz = loadAccounts(env({ FLW_WEBHOOK_SECRET_HASH: "old-hash" }));
  assert(identifySigner("", body, noBiz, fakeHmac) === null, "an unconfigured account (empty hash) can never be matched by an empty signature");
  assert(identifySigner("old-hash", body, noBiz, fakeHmac) === "legacy", "before the switch only legacy exists, exactly as today");
});

Deno.test("grace period: ends only when the business account is active AND an explicit deadline has passed", () => {
  const T = Date.parse("2026-10-01T12:00:00Z");
  const until = "2026-10-08T12:00:00Z";
  assert(!graceStatus("business", until, T).retired, "day 0 of the grace period");
  assert(!graceStatus("business", until, Date.parse("2026-10-08T11:59:59Z")).retired, "one second before the deadline");
  assert(graceStatus("business", until, Date.parse("2026-10-08T12:00:01Z")).retired, "one second after the deadline");
  assert(!graceStatus("legacy", until, Date.parse("2027-01-01T00:00:00Z")).retired, "never retired while legacy is still the active account");
  assert(!graceStatus("business", "", T + 1e12).retired, "no deadline set -> never retired");
  assert(!graceStatus("business", null, T + 1e12).retired, "null deadline -> never retired");
  assert(!graceStatus("business", "not a date", T + 1e12).retired, "unparseable deadline -> never retired");
  assert(graceStatus("business", until, T).until === Date.parse(until), "deadline reported");
});
