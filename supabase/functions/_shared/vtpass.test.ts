import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  airtimeServiceId, dataServiceId, isVtPlan, lagosStamp, parseVariations, vtCall, vtConfigured, vtEnv, vtPlanCode, vtRequestId,
  type VtCreds,
} from "./vtpass.ts";

Deno.test("vtEnv: only an explicit 'live' is live — anything else is the sandbox (play money)", () => {
  assertEquals(vtEnv("live"), "live");
  assertEquals(vtEnv(" LIVE "), "live");
  for (const v of ["", undefined, null, "sandbox", "production", "prod", "true"]) assertEquals(vtEnv(v as string), "sandbox");
});

Deno.test("vtConfigured: needs both the api key and the secret key", () => {
  assert(vtConfigured({ apiKey: "a", secretKey: "s" }));
  assert(!vtConfigured({ apiKey: "a", secretKey: "" }));
  assert(!vtConfigured({ apiKey: "", secretKey: "s" }));
  assert(!vtConfigured(null));
});

Deno.test("lagosStamp: Lagos is UTC+1 — 23:30 UTC is 00:30 the next day", () => {
  assertEquals(lagosStamp(Date.UTC(2026, 8, 28, 23, 30)), "202609290030");
  assertEquals(lagosStamp(Date.UTC(2026, 0, 5, 7, 4)), "202601050804");
});

Deno.test("vtRequestId: built from the order reference's own timestamp, so a retry days later names the same order", () => {
  const ref = "KDT-BILL-1758812345678";
  const a = vtRequestId(ref, Date.UTC(2026, 8, 28));
  const b = vtRequestId(ref, Date.UTC(2027, 0, 1));
  assertEquals(a, b);
  assertEquals(a, lagosStamp(1758812345678) + "KDTBILL1758812345678");
  assert(/^\d{12}[A-Za-z0-9]+$/.test(a), "date prefix + letters and digits only");
});

Deno.test("vtRequestId: the four sub-orders of an airtime bundle stay distinct", () => {
  const ids = ["", "-MTN", "-AIR", "-9MB", "-GLO"].map((s) => vtRequestId(`KDT-BILL-1758812345678${s}`, 0));
  assertEquals(new Set(ids).size, 5);
});

Deno.test("vtRequestId: a reference with no timestamp uses 'now' for the date; the body is bounded", () => {
  const now = Date.UTC(2026, 8, 28, 10, 0);
  assertEquals(vtRequestId("KUDIAI-PROBE", now), lagosStamp(now) + "KUDIAIPROBE");
  assert(vtRequestId("x".repeat(200), now).length <= 12 + 40);
  assertEquals(vtRequestId("", now), lagosStamp(now) + "KDT");
});

Deno.test("service ids: VTpass calls 9mobile 'etisalat'; data ids add '-data'; unknown networks are refused", () => {
  assertEquals(airtimeServiceId("MTN"), "mtn");
  assertEquals(airtimeServiceId("Airtel"), "airtel");
  assertEquals(airtimeServiceId("Glo"), "glo");
  assertEquals(airtimeServiceId("9mobile"), "etisalat");
  assertEquals(airtimeServiceId("t2mobile"), "etisalat");
  assertEquals(airtimeServiceId("Vodafone"), null);
  assertEquals(dataServiceId("Airtel"), "airtel-data");
  assertEquals(dataServiceId("9mobile"), "etisalat-data");
  assertEquals(dataServiceId("nope"), null);
});

Deno.test("plan ids from a VTpass catalogue are tagged so the purchase goes back to VTpass", () => {
  assert(isVtPlan("vt:mtn-10mb-100"));
  assert(!isVtPlan("500"));
  assert(!isVtPlan(undefined));
  assertEquals(vtPlanCode("vt:mtn-10mb-100"), "mtn-10mb-100");
});

Deno.test("parseVariations: reads VTpass's misspelled 'varations', tags ids, drops unusable plans", () => {
  const plans = parseVariations({
    response_description: "000",
    content: {
      varations: [
        { variation_code: "mtn-10mb-100", name: "N100 100MB - 24 hrs ", variation_amount: "100.00" },
        { variation_code: "", name: "no code", variation_amount: "50" },
        { variation_code: "free", name: "zero", variation_amount: "0.00" },
      ],
    },
  });
  assertEquals(plans, [{ plan_id: "vt:mtn-10mb-100", plan_name: "N100 100MB - 24 hrs", plan_amount: 100 }]);
  assertEquals(parseVariations({ content: { variations: [{ variation_code: "x", name: "X", variation_amount: 5 }] } }).length, 1);
  assertEquals(parseVariations(null), []);
  assertEquals(parseVariations({ content: { varations: "nope" } }), []);
});

const creds: VtCreds = { apiKey: "AK", secretKey: "SK", env: "sandbox" };

Deno.test("vtCall: POST sends the keys and a JSON body to the environment's host; JSON comes back with the HTTP status", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const d = await vtCall(async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ code: "000" }), { status: 200 }); },
    creds, "POST", "/pay", { request_id: "R1" });
  assertEquals(d, { code: "000", _http: 200 });
  assertEquals(seen!.url, "https://sandbox.vtpass.com/api/pay");
  const h = seen!.init.headers as Record<string, string>;
  assertEquals([h["api-key"], h["secret-key"], h["Content-Type"]], ["AK", "SK", "application/json"]);
  assertStrictEquals(h["public-key"], undefined);
  assertEquals(JSON.parse(String(seen!.init.body)), { request_id: "R1" });
});

Deno.test("vtCall: live keys go to the live host; the public key is sent when there is one", async () => {
  let url = "", hdr: Record<string, string> = {};
  await vtCall(async (u, i) => { url = u; hdr = i.headers as Record<string, string>; return new Response("{}"); },
    { ...creds, env: "live", publicKey: "PK" }, "GET", "/service-variations?serviceID=mtn-data");
  assertEquals(url, "https://vtpass.com/api/service-variations?serviceID=mtn-data");
  assertEquals(hdr["public-key"], "PK");
});

Deno.test("vtCall: an error page comes back as _raw, a dead connection as _unreachable — it never throws", async () => {
  const page = await vtCall(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }), creds, "POST", "/pay", {});
  assertEquals(page._http, 502);
  assert(String(page._raw).includes("Bad Gateway"));
  const arr = await vtCall(async () => new Response("[1,2]"), creds, "POST", "/pay", {});
  assertEquals(typeof arr._raw, "string");
  const dead = await vtCall(async () => { throw new TypeError("connection reset"); }, creds, "POST", "/pay", {});
  assertEquals(dead._unreachable, true);
});

Deno.test("vtCall: a call that hangs is cut off at the timeout", async () => {
  const d = await vtCall((_u, init) => new Promise((_res, rej) => {
    (init.signal as AbortSignal).addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
  }), creds, "POST", "/pay", {}, 20);
  assertEquals(d._unreachable, true);
});
