// Run: deno test supabase/functions/_shared/accountDelete.test.ts
import { cleanText, clientIp, storageTargets, validEmail } from "./accountDelete.ts";

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERT ${msg}: got ${a}, expected ${e}`);
}
const BASE = "https://abcd.supabase.co";

Deno.test("storage URLs from our project are grouped by bucket and de-duplicated", () => {
  eq(storageTargets([
    `${BASE}/storage/v1/object/public/avatars/u1/me.png`,
    `${BASE}/storage/v1/object/public/avatars/u1/me.png`,
    `${BASE}/storage/v1/object/public/kyc/docs/a%20b.pdf`,
  ], BASE), { avatars: ["u1/me.png"], kyc: ["docs/a b.pdf"] }, "grouped");
});

Deno.test("signed and authenticated URLs are recognised; query strings are ignored", () => {
  eq(storageTargets([`${BASE}/storage/v1/object/sign/proofs/x/y.jpg?token=abc`], BASE), { proofs: ["x/y.jpg"] }, "sign");
  eq(storageTargets([`${BASE}/storage/v1/object/authenticated/proofs/x/z.jpg`], BASE), { proofs: ["x/z.jpg"] }, "authenticated");
});

Deno.test("foreign hosts, non-storage paths, traversal and junk are ignored", () => {
  eq(storageTargets([
    "https://evil.example/storage/v1/object/public/avatars/x.png",
    `${BASE}/rest/v1/profiles`,
    `${BASE}/storage/v1/object/public/avatars/../secret.png`,
    "not a url", "", null, 42,
  ], BASE), {}, "nothing usable");
  eq(storageTargets([`${BASE}/storage/v1/object/public/a/b.png`], "garbage"), {}, "bad base url");
});

Deno.test("email validation", () => {
  eq(validEmail("ada@example.com"), true, "plain");
  eq(validEmail(" ada@example.com "), true, "padded");
  eq(validEmail("ada@example"), false, "no tld");
  eq(validEmail("a b@example.com"), false, "space");
  eq(validEmail("<x>@example.com"), false, "angle brackets");
  eq(validEmail("a".repeat(201) + "@example.com"), false, "too long");
  eq(validEmail(undefined), false, "undefined");
});

Deno.test("cleanText strips control characters and caps length", () => {
  eq(cleanText("  hi\u0000 there\u0007  ", 50), "hi there", "control chars");
  eq(cleanText("line1\nline2", 50), "line1\nline2", "newline kept");
  eq(cleanText("x".repeat(500), 10), "xxxxxxxxxx", "cap");
  eq(cleanText(123, 10), "", "non-string");
});

Deno.test("client IP: the proxy header wins; otherwise the LAST forwarded hop (the first is caller-controlled)", () => {
  eq(clientIp(new Headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 5.6.7.8" })), "1.2.3.4", "cf header");
  eq(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 5.6.7.8" })), "5.6.7.8", "last hop");
  eq(clientIp(new Headers()), "unknown", "none");
});
