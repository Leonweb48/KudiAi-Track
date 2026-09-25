// Run: node --test api/_lib/relayLimits.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { singleEmail, countRecipients, overQuota, RELAY_LIMITS } from "./relayLimits.js";

test("singleEmail accepts one plain address", () => {
  assert.equal(singleEmail("ada@example.com"), "ada@example.com");
  assert.equal(singleEmail("  ada.o+tag@mail.example.co.ng "), "ada.o+tag@mail.example.co.ng");
});

test("singleEmail rejects lists, display names, header-injection and junk (one counted send must be one recipient)", () => {
  for (const bad of [
    "a@x.com, b@y.com", "a@x.com;b@y.com", "a@x.com b@y.com", "Ada <a@x.com>", "<a@x.com>", "a@x.com\nBcc: b@y.com",
    "a@x.com\r\nSubject: hi", "", null, undefined, "no-at-sign", "a@b", "a@@b.com", '"quoted"@x.com', "a@x.com,", "x".repeat(260) + "@x.com",
  ]) assert.equal(singleEmail(bad), null, `should reject ${JSON.stringify(bad)}`);
});

test("countRecipients splits the caller's own address from third parties, case-insensitively and de-duplicated", () => {
  const r = countRecipients(["Owner@Shop.com", "owner@shop.com", "client@x.com", "CLIENT@x.com", "staff@x.com"], "owner@shop.com");
  assert.deepEqual(r, { total: 3, third: 2 });
  assert.deepEqual(countRecipients([], "a@b.com"), { total: 0, third: 0 });
  assert.deepEqual(countRecipients(["a@b.com"], ""), { total: 1, third: 1 });
});

test("overQuota: under every limit -> allowed", () => {
  assert.equal(overQuota({ hour_third: 10, hour_total: 40, day_third: 100 }), null);
});

test("overQuota: each limit trips on its own", () => {
  assert.match(overQuota({ hour_third: RELAY_LIMITS.hourThirdParty, hour_total: 0, day_third: 0 }), /hourly limit for emails to other people/);
  assert.match(overQuota({ hour_third: 0, hour_total: RELAY_LIMITS.hourTotal, day_third: 0 }), /hourly email limit/);
  assert.match(overQuota({ hour_third: 0, hour_total: 0, day_third: RELAY_LIMITS.dayThirdParty }), /daily limit/);
});

test("overQuota: a missing / unreadable counter never blocks real mail", () => {
  assert.equal(overQuota(null), null);
  assert.equal(overQuota(undefined), null);
  assert.equal(overQuota({}), null);
});
