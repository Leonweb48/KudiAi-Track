// Run: deno test supabase/functions/_shared/bigisub.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bgCall, bgConfigured, bgElecCustomer, bgElecProviders, bgElecToken, bgExamPins, bgExamPrices, bgHistoryRows, bgMessage, bgNetwork, bgStatus, bgTxnId, bgWalletHealth, classifyBgLookup, classifyBgPurchase,
  lagosDate, lagosToMs, matchHistory, parseBgPlans, BG_UNAVAILABLE, type BgHistoryRow,
} from "./bigisub.ts";

// Answers in the shapes of Bigisub's API spec v2.2.0 (examples copied from it, 2026-10-21)
const BG = {
  airOk:   { _http: 201, success: true, data: { transaction_id: "AirQVfafs4b3f2", reference: "202604101309hlpS", status: "successful", amount: "100" }, message: "Airtime purchase successful" },
  airProc: { _http: 201, success: true, data: { transaction_id: "AirP1", status: "processing" } },
  airFail: { _http: 201, success: true, data: { transaction_id: "AirF1", status: "failed", message: "Network unresponsive" } },
  poor:    { _http: 402, success: false, message: "Insufficient balance" },
  badPin:  { _http: 400, success: false, message: "Invalid transaction PIN" },
  badNum:  { _http: 400, success: false, message: "Validation failed", errors: { phone_number: ["Enter a valid 11-digit phone number"] } },
  noAuth:  { _http: 401, success: false, message: "Invalid credentials" },
  limited: { _http: 429, detail: "Request was throttled." },
  boom:    { _http: 500, _raw: "<html>Server Error (500)</html>" },
  dead:    { _unreachable: true, _error: "connection reset" },
};

Deno.test("bgConfigured: a token and a 4-digit PIN", () => {
  assertEquals(bgConfigured({ token: "48f7efce4b7133fae099aa451e72cc7fe8aa4f27", pin: "1234" }), true);
  assertEquals(bgConfigured({ token: "48f7efce4b7133fae099aa451e72cc7fe8aa4f27", pin: "12345" }), false);
  assertEquals(bgConfigured({ token: "", pin: "1234" }), false);
  assertEquals(bgConfigured(null), false);
});

Deno.test("bgNetwork: our network names → Bigisub's LIVE ids (2 = Glo, 3 = Airtel — its docs have them the other way)", () => {
  assertEquals([bgNetwork("MTN"), bgNetwork("glo"), bgNetwork("Airtel"), bgNetwork("9mobile"), bgNetwork("T2")], [1, 2, 3, 4, 4]);
  assertEquals(bgNetwork("Smile"), null);
});

Deno.test("classifyBgPurchase: every purchase answer", () => {
  assertEquals(classifyBgPurchase(BG.airOk), "delivered");
  assertEquals(classifyBgPurchase(BG.airProc), "pending");
  assertEquals(classifyBgPurchase(BG.airFail), "failed");
  assertEquals(classifyBgPurchase(BG.poor), "account");       // our wallet — nothing placed, another provider may take it
  assertEquals(classifyBgPurchase(BG.badPin), "account");     // our PIN
  assertEquals(classifyBgPurchase(BG.noAuth), "account");     // our token
  assertEquals(classifyBgPurchase(BG.limited), "account");
  assertEquals(classifyBgPurchase(BG.badNum), "order");       // the customer's number — show them why
  assertEquals(classifyBgPurchase(BG.boom), "unknown");       // can't tell → history decides / hold
  assertEquals(classifyBgPurchase(BG.dead), "unknown");
  assertEquals(classifyBgPurchase({ _http: 201, success: true, data: { status: "something-new" } }), "pending");   // exists, not final
});

Deno.test("bgMessage: customers see the order's own reason, never our account's", () => {
  assertEquals(bgMessage(BG.badNum, "order"), "Enter a valid 11-digit phone number");
  assertEquals(bgMessage(BG.poor, "account"), BG_UNAVAILABLE);
  assertEquals(bgMessage(BG.badPin, "order"), BG_UNAVAILABLE);   // a PIN word never reaches a customer
  assertEquals(bgMessage(BG.boom, "order"), BG_UNAVAILABLE);
});

Deno.test("bgTxnId / bgStatus / classifyBgLookup", () => {
  assertEquals(bgTxnId(BG.airOk), "AirQVfafs4b3f2");
  assertEquals(bgTxnId({ data: { tranx_id: "Data1" } }), "Data1");
  assertEquals([bgStatus("successful"), bgStatus("processing"), bgStatus("failed"), bgStatus("??")], ["delivered", "pending", "failed", null]);
  assertEquals(classifyBgLookup({ _http: 200, success: true, data: { new_status: "failed" } }), "failed");
  assertEquals(classifyBgLookup({ _http: 200, success: true, data: { status: "successful" } }), "delivered");
  assertEquals(classifyBgLookup({ _http: 404, success: false, message: "Transaction not found" }), "not-found");
  assertEquals(classifyBgLookup({ _http: 429 }), "unknown");
  assertEquals(classifyBgLookup(BG.dead), "unknown");
});

Deno.test("lagos time: history stamps are Lagos wall time", () => {
  assertEquals(new Date(lagosToMs("2026-10-13T17:04:11")).toISOString(), "2026-10-13T16:04:11.000Z");
  assertEquals(lagosDate(Date.parse("2026-10-13T23:30:00Z")), "2026-10-14");   // already the 14th in Lagos
});

Deno.test("matchHistory: one order that fits → found; none → none; two → ambiguous; taken ids skipped", () => {
  const sent = Date.parse("2026-10-21T10:36:43Z");   // 11:36:43 Lagos
  const row = (id: string, at: string, extra: Partial<BgHistoryRow> = {}): BgHistoryRow =>
    ({ tranx_id: id, unique_element: "08134315002", status: "successful", service_type: "airtime", date_created: at, ...extra });
  const key = { phone: "+2348134315002", service: "airtime" as const, sentAtMs: sent };
  assertEquals(matchHistory([row("A1", "2026-10-21T11:36:50")], key), { kind: "found", tranxId: "A1", state: "delivered" });
  assertEquals(matchHistory([row("A1", "2026-10-21T11:20:00")], key).kind, "none");                         // before we sent it
  assertEquals(matchHistory([row("A1", "2026-10-21T11:36:50", { service_type: "data" })], key).kind, "none");
  assertEquals(matchHistory([row("A1", "2026-10-21T11:36:50", { unique_element: "08000000000" })], key).kind, "none");
  assertEquals(matchHistory([row("A1", "2026-10-21T11:36:50"), row("A2", "2026-10-21T11:37:10")], key).kind, "ambiguous");
  assertEquals(matchHistory([row("A1", "2026-10-21T11:36:50"), row("A2", "2026-10-21T11:37:10")], key, new Set(["A1"])),
    { kind: "found", tranxId: "A2", state: "delivered" });
});

Deno.test("bgHistoryRows: a page's rows, or null when unreadable", () => {
  assertEquals(bgHistoryRows({ _http: 200, count: 1, results: [{ tranx_id: "X" }] })?.length, 1);
  assertEquals(bgHistoryRows({ _http: 500, _raw: "<html>" }), null);
  assertEquals(bgHistoryRows(BG.dead), null);
});

Deno.test("parseBgPlans: the live list shape → app plans tagged bg:, our cost = corporate price, disabled ones out", () => {
  const live = { success: true, data: [
    { id: 136, network: 1, plantype: "GIFTING", size: 20, plan_volume: "MB", validity: "1 day[WHAT'SAPP]", amount: 25, plan_amount: 25, corporate_amount: 25, plan_disabled: false },
    { id: 298, network: 1, plantype: "SME", size: 1, plan_volume: "GB", validity: "7days", amount: 455, plan_amount: 455, corporate_amount: 450, plan_disabled: false },
    { id: 299, network: 1, plantype: "SME", size: 2, plan_volume: "GB", validity: "7days", amount: 900, corporate_amount: 880, plan_disabled: true },
    { id: 400, network: 2, plantype: "SME", size: 1, plan_volume: "GB", validity: "30 days", amount: 600 },
  ] };
  assertEquals(parseBgPlans(live, 1), [
    { plan_id: "bg:136", plan_name: "20MB (GIFTING) - 1 day[WHAT'SAPP]", plan_amount: 25, retail_amount: 25 },
    { plan_id: "bg:298", plan_name: "1GB (SME) - 7days", plan_amount: 450, retail_amount: 455 },
  ]);
});

Deno.test("bgWalletHealth: up with balance / token refused = down / no answer = unknown", () => {
  assertEquals(bgWalletHealth({ _http: 200, success: true, data: { balance: 15430.5 } }), { health: "up", balance: 15430.5 });
  assertEquals(bgWalletHealth(BG.noAuth), { health: "down", balance: null });
  assertEquals(bgWalletHealth(BG.boom), { health: "down", balance: null });
  assertEquals(bgWalletHealth(BG.dead), { health: "unknown", balance: null });
});

Deno.test("bgCall: sends the token header, never throws", async () => {
  let seen: RequestInit | null = null, url = "";
  const f = (u: string, i: RequestInit) => { url = u; seen = i; return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })); };
  const r = await bgCall(f, { token: "t".repeat(40), pin: "1234", base: "http://x/api/v2/" }, "GET", "/financial/wallet/balance/");
  assertEquals(url, "http://x/api/v2/financial/wallet/balance/");
  assertEquals((seen!.headers as Record<string, string>).Authorization, `Token ${"t".repeat(40)}`);
  assertEquals(r, { success: true, _http: 200 });
  const dead = await bgCall(() => Promise.reject(new Error("boom")), { token: "t", pin: "1" }, "GET", "/x");
  assertEquals(dead._unreachable, true);
});

Deno.test("parseBgPlans: a network's list holds only that network's plans (live ids AND names: 2 glo, 3 airtel)", () => {
  const live = { success: true, data: [
    { id: 501, network: 2, network_name: "glo", plantype: "SME", size: 125, plan_volume: "MB", validity: "1 day", amount: 99, corporate_amount: 95 },
    { id: 601, network: 3, network_name: "airtel", plantype: "GIFTING", size: 300, plan_volume: "MB", validity: "2 days", amount: 299, corporate_amount: 290 },
    { id: 602, network: 3, network_name: "glo", plantype: "SME", size: 1, plan_volume: "GB", validity: "30 days", amount: 300 },   // ids and names disagree → out
  ] };
  assertEquals(parseBgPlans(live, bgNetwork("Glo")!).map((p) => p.plan_id), ["bg:501"]);
  assertEquals(parseBgPlans(live, bgNetwork("Airtel")!).map((p) => p.plan_id), ["bg:601"]);
});

Deno.test("exam PINs: the reply's pins become card details; prices from education services", () => {
  assertEquals(bgExamPins({ success: true, data: { pins: ["WRC-1234567890"] } }), "PIN: WRC-1234567890");
  assertEquals(bgExamPins({ success: true, data: { pins: ["A1", "B2"] } }), "PIN: A1 | PIN: B2");
  assertEquals(bgExamPins({ success: true, data: {} }), "");
  assertEquals(bgExamPrices({ success: true, data: { services: [
    { id: "WAEC", name: "WAEC Result Checker", type: "WAEC", regular_price: 5250, corporate_price: 5200 },
    { id: "NECO", name: "NECO Result Checker", type: "NECO", regular_price: 2500, corporate_price: 2450 }] } }),
    { WAEC: { regular: 5250, corporate: 5200, name: "WAEC Result Checker" }, NECO: { regular: 2500, corporate: 2450, name: "NECO Result Checker" } });
});

Deno.test("electricity: discos, meter check, token", () => {
  assertEquals(bgElecProviders({ success: true, data: { providers: [
    { code: "ikeja-electric", min_amount_prepaid: 1000, min_amount_postpaid: 500, service_charge: 100 },
    { code: "ibadan-electric", min_amount_prepaid: 2000, min_amount_postpaid: 2000 }] } }),
    { "ikeja-electric": { minPrepaid: 1000, minPostpaid: 500, fee: 100 }, "ibadan-electric": { minPrepaid: 2000, minPostpaid: 2000, fee: 100 } });
  assertEquals(bgElecCustomer({ _http: 200, success: true, data: { customer_name: "JOHN DOE", customer_address: "123 Lagos St" } }), { kind: "ok", name: "JOHN DOE", address: "123 Lagos St" });
  assertEquals(bgElecCustomer({ _http: 404, success: false, message: "Meter not found" }), { kind: "invalid" });
  assertEquals(bgElecCustomer({ _http: 400, success: false, message: "Invalid transaction PIN" }).kind, "unavailable");   // ours, not the meter's
  assertEquals(bgElecCustomer({ _http: 500, _raw: "<html>" }).kind, "unavailable");
  assertEquals(bgElecToken({ success: true, data: { token: "1234-5678-9012-3456-7890", units: "45.2kWh" } }), { token: "1234-5678-9012-3456-7890", units: "45.2kWh" });
  assertEquals(bgElecToken({ success: true, data: { token: "null" } }), { token: "", units: "" });
});

Deno.test("matchHistory for an exam order: no phone, matched by kind of service + amount + time", () => {
  const sent = Date.parse("2026-10-21T15:00:00Z");
  const rows: BgHistoryRow[] = [
    { tranx_id: "Edu1", unique_element: "", status: "successful", service_type: "education", date_created: "2026-10-21T16:00:20", transaction_amount: "5200.00", transaction_type: "WAEC Result Checker x1" },
    { tranx_id: "Air9", unique_element: "08031234567", status: "successful", service_type: "airtime", date_created: "2026-10-21T16:00:30", transaction_amount: "99" },
  ];
  assertEquals(matchHistory(rows, { phone: "", service: "exam", sentAtMs: sent, amount: 5200 }), { kind: "found", tranxId: "Edu1", state: "delivered" });
  assertEquals(matchHistory(rows, { phone: "", service: "exam", sentAtMs: sent, amount: 2450 }).kind, "none");
});
