import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  airtimeServiceId, dataServiceId, isVtPlan, lagosStamp, parseVariations, VT_CABLE, VT_ELECTRIC, vtCableBody, vtCall, vtCardDetails,
  vtConfigured, vtCustomer, vtElectricBody, vtElectricToken, vtElectricUnits, vtEnv, vtMeterType, vtPlanCode, vtRequestId, vtSmileBody,
  vtWaecBody, NAMELESS_CUSTOMER, type VtCreds,
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

// ── Cable, electricity, WAEC, Smile — fixtures are VTpass's own sandbox answers (vtpass-explore, 2026-09-28) ──────────

Deno.test("electricity: every company the app offers maps to a VTpass disco; meter types map; anything else is refused", () => {
  assertEquals(Object.keys(VT_ELECTRIC).sort(), ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
  assertEquals(VT_ELECTRIC["02"], "ikeja-electric");
  assertEquals(VT_ELECTRIC["12"], "aba-electric");
  assertEquals(new Set(Object.values(VT_ELECTRIC)).size, 12);
  assertEquals(vtMeterType("01"), "prepaid");
  assertEquals(vtMeterType("02"), "postpaid");
  assertEquals(vtMeterType("prepaid"), null);
  assertEquals(vtElectricBody("ikeja-electric", "1111111111111", "prepaid", 1000, "08051111111"),
    { serviceID: "ikeja-electric", billersCode: "1111111111111", variation_code: "prepaid", amount: 1000, phone: "08051111111" });
});

Deno.test("electricity token: 'Token : 2636…' from token / purchased_code; postpaid (no token) and 'N/A' give none", () => {
  const prepaid = { code: "000", purchased_code: "Token : 26362054405982757802", token: "Token : 26362054405982757802", units: "79.9 kWh", resetToken: "N/A" };
  assertEquals(vtElectricToken(prepaid), "26362054405982757802");
  assertEquals(vtElectricToken({ purchased_code: "Token : 1234 5678 9012 3456 7890" }), "1234 5678 9012 3456 7890");
  assertEquals(vtElectricToken({ mainToken: "11112222333344445555" }), "11112222333344445555");
  assertEquals(vtElectricUnits(prepaid), "79.9 kWh");
  const postpaid = { code: "000", purchased_code: "", customerName: "NP NGEMA", meterNumber: "null" };
  assertEquals(vtElectricToken(postpaid), "");
  assertEquals(vtElectricToken({ token: "N/A" }), "");
  assertEquals(vtElectricUnits({ units: "N/A" }), "");
});

Deno.test("WAEC: result-checker cards and registration tokens become one receipt line", () => {
  const checker = {
    purchased_code: "Serial No:WRN182135587, pin: 373820665258||Serial No:WRN182135588, pin: 373827897584",
    cards: "[{\"Serial\":\"WRN182135587\",\"Pin\":\"373820665258\"},{\"Serial\":\"WRN182135588\",\"Pin\":\"373827897584\"}]",
  };
  assertEquals(vtCardDetails(checker), "Serial No: WRN182135587, PIN: 373820665258 | Serial No: WRN182135588, PIN: 373827897584");
  assertEquals(vtCardDetails({ purchased_code: "Token: 0100070365657400875", tokens: "[\"0100070365657400875\"]" }), "Token: 0100070365657400875");
  assertEquals(vtCardDetails({ purchased_code: "Serial No:A, pin: 1||Serial No:B, pin: 2" }), "Serial No:A, pin: 1 | Serial No:B, pin: 2");
  assertEquals(vtCardDetails({}), "");
  assertEquals(vtWaecBody("waecdirect", "0801"), { serviceID: "waec", variation_code: "waecdirect", quantity: 1, phone: "0801" });
  assertEquals(vtWaecBody("waec-registration", "0801"), { serviceID: "waec-registration", variation_code: "waec-registraion", quantity: 1, phone: "0801" });
  assertEquals(vtWaecBody("jamb", "0801"), null);
});

Deno.test("cable: DStv/GOtv buy the chosen bouquet as a 'change'; StarTimes doesn't; Showmax isn't carried", () => {
  assertEquals(vtCableBody("dstv", "1212121212", "dstv-padi", "0802"),
    { serviceID: "dstv", billersCode: "1212121212", variation_code: "dstv-padi", phone: "0802", subscription_type: "change", quantity: 1 });
  assertEquals(vtCableBody("startimes", "1212121212", "nova", "0804"), { serviceID: "startimes", billersCode: "1212121212", variation_code: "nova", phone: "0804" });
  assert(VT_CABLE.has("gotv") && !VT_CABLE.has("showmax"));
  assertEquals(vtSmileBody("08011111111", "516", "08011111111"), { serviceID: "smile-direct", billersCode: "08011111111", variation_code: "516", phone: "08011111111" });
});

Deno.test("vtCustomer: VTpass answers 000 either way — a bad number is content.error, a good one has Customer_Name", () => {
  const meter = { code: "000", content: { Customer_Name: "TESTMETER1", Address: "ABULE  EGBA BU ABULE", Meter_Type: "PREPAID", WrongBillersCode: "false" } };
  assertEquals(vtCustomer(meter), { kind: "ok", name: "TESTMETER1", address: "ABULE  EGBA BU ABULE" });
  assertEquals(vtCustomer({ code: "000", content: { Customer_Name: "TEST METER", Status: "ACTIVE" } }), { kind: "ok", name: "TEST METER", address: "" });
  const badMeter = { code: "000", content: { error: "This meter is not correct or is not a valid Ikeja Electric prepaid meter. Please check and try again", WrongBillersCode: "true" } };
  assertEquals(vtCustomer(badMeter), { kind: "invalid", message: badMeter.content.error });
  const badCard = { code: "000", content: { error: "The Smartcard/Decoder Number you entered may be invalid, Please check and only proceed if you are sure it's valid." } };
  assertEquals(vtCustomer(badCard).kind, "invalid");
  assertEquals(vtCustomer({ code: "000", content: { WrongBillersCode: "true" } }).kind, "invalid");
  // a name alongside an error flag is still a failed check
  assertEquals(vtCustomer({ code: "000", content: { Customer_Name: "SOMEONE", WrongBillersCode: "true" } }).kind, "invalid");
  assertEquals(vtCustomer({ code: "000", content: { Customer_Name: "SOMEONE", error: "Meter is blocked" } }), { kind: "invalid", message: "Meter is blocked" });
  assertEquals(vtCustomer({ code: "087", response_description: "INVALID CREDENTIALS" }), { kind: "unavailable" });
  assertEquals(vtCustomer({ _raw: "<html>", _http: 502 }), { kind: "unavailable" });
  assertEquals(vtCustomer({ _unreachable: true }), { kind: "unavailable" });
});

Deno.test("electricity: discos name the fields differently — Jos 'Token'/'Units' with dashes, Kano 'null' strings", () => {
  const jos = { code: "000", purchased_code: "Token : 3737-6908-5436-2208-2124", Token: "3737-6908-5436-2208-2124", Units: "4.5", CustomerName: "null" };
  assertEquals(vtElectricToken(jos), "3737-6908-5436-2208-2124");
  assertEquals(vtElectricUnits(jos), "4.5");
  assertEquals(vtElectricToken({ Token: "3737-6908-5436-2208-2124" }), "3737-6908-5436-2208-2124");
  const kano = { code: "000", purchased_code: "", Token: "null", Units: "null", Receipt: "null" };
  assertEquals(vtElectricToken(kano), "");
  assertEquals(vtElectricUnits(kano), "");
  const ibadanPostpaid = { code: "000", purchased_code: "", Token: "null", Units: "null", ReceiptNumber: "5513250204160657" };
  assertEquals(vtElectricToken(ibadanPostpaid), "");
});

Deno.test("vtCustomer: a matched meter with no name on record is verified (Jos); an empty answer tells us nothing", () => {
  const jos = { code: "000", content: { Customer_Name: "", Address: "", Min_Purchase_Amount: "", MeterNumber: "1111111111111", Meter_Type: "prepaid" } };
  assertEquals(vtCustomer(jos), { kind: "ok", name: NAMELESS_CUSTOMER, address: "" });
  assertEquals(vtCustomer({ code: "000", content: {} }), { kind: "unavailable" });
  assertEquals(vtCustomer({ code: "000", content: { Customer_Name: "null" } }), { kind: "unavailable" });
  assertEquals(vtCustomer({ code: "000", content: { Customer_Name: "", MeterNumber: "1111111111111", WrongBillersCode: "true" } }).kind, "invalid");
  const smile = { code: "000", content: { Customer_Name: "THE TESTER ITSELF", AccountList: { Account: [{ AccountId: "08011111111" }], NumberOfAccounts: 1 } } };
  assertEquals(vtCustomer(smile).kind, "ok");
});
