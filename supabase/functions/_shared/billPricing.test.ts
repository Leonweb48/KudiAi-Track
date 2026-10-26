// Run: deno test --no-lock --node-modules-dir=none supabase/functions/_shared/billPricing.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cableKey, cleanPrice, examKey, formatServicesOff, markupPrice, marginPct, parsePriceOverrides, parseServicesOff, pausedMessage,
  sellingPrice, serviceOfAction, serviceOfCategory, withOverride,
} from "./billPricing.ts";

Deno.test("services off: parses a comma list, ignores unknown names and case", () => {
  assertEquals([...parseServicesOff(" Data, cable ,nonsense,,print-data")].sort(), ["cable", "data", "print-data"]);
  assertEquals(parseServicesOff(null).size, 0);
  assertEquals(parseServicesOff("").size, 0);
});

Deno.test("services off: stored in a fixed order, unknown names dropped", () => {
  assertEquals(formatServicesOff(["smile", "DATA", "x", "airtime"]), "airtime,data,smile");
  assertEquals(formatServicesOff([]), "");
});

Deno.test("cleanPrice: only positive prices up to the cap, rounded to kobo", () => {
  assertEquals(cleanPrice("1500.456"), 1500.46);
  assertEquals(cleanPrice(0), null);
  assertEquals(cleanPrice(-5), null);
  assertEquals(cleanPrice("abc"), null);
  assertEquals(cleanPrice(""), null);
  assertEquals(cleanPrice(null), null);
  assertEquals(cleanPrice(2_000_001), null);
  assertEquals(cleanPrice(Infinity), null);
});

Deno.test("overrides: malformed input never throws and keeps the good parts", () => {
  const o = parsePriceOverrides(JSON.stringify({ cable: { "DStv|COMPACT": "15000", "gotv|x": -1, "gotv|y": "nope" }, smile: [1, 2], exam: { "waec|waecdirect": 5600 }, junk: { a: 1 } }));
  assertEquals(o.cable, { "dstv|compact": 15000 });
  assertEquals(o.smile, {});
  assertEquals(o.exam, { "waec|waecdirect": 5600 });
  assertEquals(parsePriceOverrides("{not json"), { cable: {}, smile: {}, spectranet: {}, exam: {} });
  assertEquals(parsePriceOverrides(null), { cable: {}, smile: {}, spectranet: {}, exam: {} });
});

Deno.test("sellingPrice: admin price when set, provider price otherwise; keys match case-insensitively", () => {
  const o = parsePriceOverrides({ cable: { [cableKey("DStv", "COMPACT")]: 16000 }, exam: { [examKey("waec", "waecdirect")]: 5600 } });
  assertEquals(sellingPrice(o, "cable", cableKey("dstv", "compact"), 15700), { price: 16000, priced: true });
  assertEquals(sellingPrice(o, "cable", cableKey("dstv", "padi"), 4400), { price: 4400, priced: false });
  assertEquals(sellingPrice(o, "exam", examKey("WAEC", "waecdirect"), 5350), { price: 5600, priced: true });
  assertEquals(sellingPrice(o, "smile", "123", 1000), { price: 1000, priced: false });
});

Deno.test("withOverride: sets and removes one item without touching the rest or the input", () => {
  const o = parsePriceOverrides({ smile: { a: 100, b: 200 } });
  const set = withOverride(o, "smile", "C", 300);
  assertEquals(set.smile, { a: 100, b: 200, c: 300 });
  const removed = withOverride(set, "smile", "a", null);
  assertEquals(removed.smile, { b: 200, c: 300 });
  assertEquals(o.smile, { a: 100, b: 200 });
  assertEquals(withOverride(o, "smile", "  ", 5).smile, { a: 100, b: 200 });
});

Deno.test("service of a purchase action / preflight category", () => {
  assertEquals(serviceOfAction("print-data"), "print-data");
  assertEquals(serviceOfAction("data-plans"), null);
  assertEquals(serviceOfCategory("Cable"), "cable");
  assertEquals(serviceOfCategory("airtime-bundle"), null);
  assertEquals(serviceOfCategory("business-loan"), null);
});

Deno.test("paused message is worded so the app stops without retrying", () => {
  const m = pausedMessage("data");
  assertEquals(/not been charged/.test(m) && /unavailable/.test(m), true);
  assertEquals(m.startsWith("Data "), true);
});

Deno.test("margin and markup", () => {
  assertEquals(marginPct(1100, 1000), 10);
  assertEquals(marginPct(950, 1000), -5);
  assertEquals(marginPct(100, 0), null);
  assertEquals(markupPrice(1000, 5), 1050);
  assertEquals(markupPrice(1234, 5), 1300);          // 1295.7 → next ₦5 = 1300
  assertEquals(markupPrice(1234, 5, 1), 1296);
  assertEquals(markupPrice(1000, 0), 1000);
  assertEquals(markupPrice(0, 10), 0);
  assertEquals(markupPrice(299.99, 0, 5), 300);
});
