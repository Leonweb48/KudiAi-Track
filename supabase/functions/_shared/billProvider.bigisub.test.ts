// Run: deno test supabase/functions/_shared/billProvider.bigisub.test.ts
// Bigisub as the airtime / data BACKUP inside the provider switch (2026-10-21).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bgVerify, buyAcrossProviders, parseProviderConfig, providerOrder, type BuyDeps, type Provider, type ProviderConfig } from "./billProvider.ts";
import { PENDING_STATUS, type CkResult, type Lookup } from "./ckRoute.ts";
import type { BgFind, BgResult } from "./bigisub.ts";

const CFG: ProviderConfig = { primary: "clubkonnect", failover: true, bigisub: true };

Deno.test("order: Bigisub is the last backup for airtime and data only, and only when switched on and set up", () => {
  const st = { vtUsable: false, bgUsable: true, health: { clubkonnect: "up" as const, bigisub: "up" as const } };
  assertEquals(providerOrder("airtime", CFG, st), ["clubkonnect", "bigisub"]);
  assertEquals(providerOrder("data", CFG, st), ["clubkonnect", "bigisub"]);
  assertEquals(providerOrder("cable", CFG, st), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", { ...CFG, bigisub: false }, st), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", CFG, { ...st, bgUsable: false }), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", { ...CFG, failover: false }, st), ["clubkonnect"]);
  // with VTpass live too: VTpass first backup, Bigisub after it
  assertEquals(providerOrder("airtime", CFG, { ...st, vtUsable: true, health: { clubkonnect: "up", vtpass: "up", bigisub: "up" } }), ["clubkonnect", "vtpass", "bigisub"]);
  // ClubKonnect known down → straight to the backups that are up
  assertEquals(providerOrder("airtime", CFG, { ...st, health: { clubkonnect: "down", bigisub: "up" } }), ["bigisub"]);
  assertEquals(providerOrder("airtime", CFG, { ...st, health: { clubkonnect: "down", bigisub: "down" } }), ["clubkonnect", "bigisub"]);
});

Deno.test("order: Bigisub FIRST for the services listed in bill_bigisub_first, ClubKonnect its backup", () => {
  const st = { vtUsable: false, bgUsable: true, health: { clubkonnect: "up" as const, bigisub: "up" as const } };
  const first = parseProviderConfig({ bill_provider_bigisub: "true", bill_bigisub_first: " Airtime, electricity ,water" });
  assertEquals([...first.bigisubFirst!], ["airtime", "electricity"]);   // "water" isn't a Bigisub service → ignored
  assertEquals(providerOrder("airtime", first, st), ["bigisub", "clubkonnect"]);
  assertEquals(providerOrder("electricity", first, st), ["bigisub", "clubkonnect"]);
  assertEquals(providerOrder("data", first, st), ["clubkonnect", "bigisub"]);
  assertEquals(providerOrder("cable", first, st), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", first, { ...st, health: { clubkonnect: "up", bigisub: "down" } }), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", { ...first, bigisub: false }, st), ["clubkonnect"]);   // Bigisub switched off wins
  assertEquals(providerOrder("airtime", first, { ...st, bgUsable: false }), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", { ...first, failover: false }, st), ["bigisub"]);
  assertEquals([...parseProviderConfig({}).bigisubFirst!], []);
});

interface W { row: Provider[] | null; ck: (CkResult | Error)[]; lookup: Lookup[]; pay: BgResult[]; find: BgFind[]; remembered: string[]; calls: string[] }
const w0 = (w: Partial<W>): W => ({ row: null, ck: [], lookup: [], pay: [], find: [], remembered: [], calls: [], ...w });
function deps(w: W): BuyDeps {
  const take = <T>(q: T[], what: string): T => { if (!q.length) throw new Error(`unexpected ${what}`); return q.shift()!; };
  return {
    claim: async (p, expect) => {
      w.calls.push(`claim:${p}`);
      if (!w.row) { w.row = [p]; return [...w.row]; }
      if (JSON.stringify(w.row) === JSON.stringify(expect) && !w.row.includes(p)) w.row = [...w.row, p];
      return [...w.row];
    },
    ck: async () => { w.calls.push("ck"); const a = take(w.ck, "ck"); if (a instanceof Error) throw a; return a; },
    ckLookup: async () => { w.calls.push("ckLookup"); return take(w.lookup, "lookup"); },
    vtPay: async () => { throw new Error("VTpass must not be called"); },
    vtRequery: async () => { throw new Error("VTpass must not be called"); },
    bgPay: async () => { w.calls.push("bgPay"); return take(w.pay, "bgPay"); },
    bgFind: async () => { w.calls.push("bgFind"); return take(w.find, "bgFind"); },
    bgRemember: (id) => { w.remembered.push(id); },
    isOk: (d) => String(d.statuscode) === "100",
    alert: () => {},
  };
}
const ORDER: Provider[] = ["clubkonnect", "bigisub"];
const ok = { _http: 201, success: true, data: { transaction_id: "Air1", status: "successful" } };

Deno.test("buy: ClubKonnect's wallet is empty → Bigisub delivers; its id is stored", async () => {
  const w = w0({ ck: [{ status: "INSUFFICIENT_BALANCE" }], pay: [ok] });
  const out = await buyAcrossProviders("airtime", ORDER, deps(w));
  assertEquals(out.via, "bigisub");
  assertEquals(out.via === "bigisub" && out.state, "delivered");
  assertEquals(w.row, ["clubkonnect", "bigisub"]);
  assertEquals(w.remembered, ["Air1"]);
});

Deno.test("buy: ClubKonnect refuses the number itself → Bigisub is NOT tried", async () => {
  const w = w0({ ck: [{ status: "INVALID_MOBILENUMBER" }] });
  const out = await buyAcrossProviders("airtime", ORDER, deps(w));
  assertEquals(out.via, "clubkonnect");
  assertEquals(w.calls.includes("bgPay"), false);
});

Deno.test("buy: ClubKonnect's network failure (throws) never moves the order to Bigisub", async () => {
  const w = w0({ ck: [new Error("network")] });
  let threw = false;
  try { await buyAcrossProviders("airtime", ORDER, deps(w)); } catch { threw = true; }
  assertEquals(threw, true);
  assertEquals(w.calls.includes("bgPay"), false);
});

Deno.test("buy: Bigisub processing → held (confirming), id stored", async () => {
  const w = w0({ row: ["clubkonnect", "bigisub"], pay: [{ _http: 201, success: true, data: { transaction_id: "AirP", status: "processing" } }] });
  const out = await buyAcrossProviders("airtime", ORDER, deps(w));
  assertEquals(out.via === "bigisub" && [out.state, out.message], ["pending", PENDING_STATUS]);
  assertEquals(w.remembered, ["AirP"]);
});

Deno.test("buy: Bigisub failed → final (refunded on both sides)", async () => {
  const w = w0({ row: ["bigisub"], pay: [{ _http: 201, success: true, data: { transaction_id: "AirF", status: "failed" } }] });
  const out = await buyAcrossProviders("airtime", ["bigisub"], deps(w));
  assertEquals(out.via === "bigisub" && out.state, "failed");
});

Deno.test("buy: Bigisub's own wallet empty after ClubKonnect's → nothing placed anywhere, clean failure", async () => {
  const w = w0({ ck: [{ status: "INSUFFICIENT_BALANCE" }], pay: [{ _http: 402, success: false, message: "Insufficient balance" }] });
  const out = await buyAcrossProviders("airtime", ORDER, deps(w));
  assertEquals(out.via === "bigisub" && out.state, "failed");
  assertEquals(w.calls.filter((c) => c === "bgFind").length, 0);
});

Deno.test("buy: Bigisub's reply lost → found in its history → delivered (no second purchase)", async () => {
  const w = w0({ row: ["bigisub"], pay: [{ _unreachable: true }], find: [{ kind: "found", tranxId: "AirH", state: "delivered" }] });
  const out = await buyAcrossProviders("airtime", ["bigisub"], deps(w));
  assertEquals(out.via === "bigisub" && [out.state, out.tranxId], ["delivered", "AirH"]);
  assertEquals(w.calls.filter((c) => c === "bgPay").length, 1);
  assertEquals(w.remembered, ["AirH"]);
});

Deno.test("buy: Bigisub's reply lost and NOT in its history (yet) → held, never refunded, never sent elsewhere", async () => {
  for (const f of [{ kind: "none" }, { kind: "ambiguous" }, { kind: "unknown" }] as BgFind[]) {
    const w = w0({ row: ["clubkonnect", "bigisub"], pay: [{ _http: 500, _raw: "<html>500</html>" }], find: [f] });
    const out = await buyAcrossProviders("airtime", ORDER, deps(w));
    assertEquals(out.via === "bigisub" && out.state, "pending", f.kind);
    assertEquals(w.calls.filter((c) => c === "ck").length, 0, f.kind);
  }
});

Deno.test("buy: an order claimed for Bigisub when Bigisub isn't set up any more → held", async () => {
  const w = w0({ row: ["clubkonnect", "bigisub"] });
  const d = deps(w); delete d.bgPay;
  const out = await buyAcrossProviders("airtime", ORDER, d);
  assertEquals(out.via === "bigisub" && out.state, "pending");
});

Deno.test("bgVerify", () => {
  assertEquals([bgVerify("delivered"), bgVerify("failed"), bgVerify("pending"), bgVerify("not-found"), bgVerify("unknown"), bgVerify(null)],
    ["SUCCESS", "FAILED", "PENDING", "NOT_FOUND", "UNKNOWN", "UNKNOWN"]);
});

Deno.test("order: cable / betting / Smile get Bigisub as backup only once listed in bill_bigisub_services", () => {
  const st = { vtUsable: false, bgUsable: true, health: { clubkonnect: "up" as const, bigisub: "up" as const } };
  const off = parseProviderConfig({ bill_provider_bigisub: "true" });
  assertEquals([...off.bigisubServices!], ["airtime", "data", "electricity"]);       // unset = the three proven live
  assertEquals(providerOrder("cable", off, st), ["clubkonnect"]);
  assertEquals(providerOrder("airtime", off, st), ["clubkonnect", "bigisub"]);
  const on = parseProviderConfig({ bill_provider_bigisub: "true", bill_bigisub_services: "airtime,data,electricity,cable,betting,smile,spectranet" });
  assertEquals(providerOrder("cable", on, st), ["clubkonnect", "bigisub"]);
  assertEquals(providerOrder("betting", on, st), ["clubkonnect", "bigisub"]);
  assertEquals(providerOrder("smile", on, st), ["clubkonnect", "bigisub"]);
  assertEquals(providerOrder("spectranet", on, st), ["clubkonnect"]);                 // not a Bigisub service
  const none = parseProviderConfig({ bill_provider_bigisub: "true", bill_bigisub_services: "" });
  assertEquals(providerOrder("airtime", none, st), ["clubkonnect"]);                  // explicitly emptied → no backup at all
});
