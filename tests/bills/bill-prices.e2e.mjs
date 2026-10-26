// Bill-payment regression suite. Run: node tests/bills/bill-prices.e2e.mjs  — see tests/bills/README.md
// End-to-end: the REAL clubkonnect function with the admin's Bill Prices & Services settings (2026-10-26) — the prices
// customers see for cable / Smile / Spectranet / exam PINs, the price the payment gate checks, the admin's price catalogue,
// and a bill service switched off (refused before anyone is charged, and before the gate for a direct call).
import { FN, killTree } from "./_harness.mjs";
import http from "node:http";
import { spawn } from "node:child_process";
const CK = 8793, SB = 8794, FNPORT = 8000, SERVICE_KEY = "svc-test-key", USER_TOKEN = "user-token", USER_ID = "11111111-1111-4111-8111-111111111111";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m, x = "") => { checks++; if (!c) { fails++; console.log(`  FAIL ${m}\n       ${x}`); } else console.log(`  ok   ${m}`); };

// ── fake ClubKonnect: price lists + a cable purchase ──
const CABLE = { TV_ID: { DStv: [{ ID: "dstv", PRODUCT: [
  { PACKAGE_ID: "dstv-padi", PACKAGE_NAME: "DStv Padi", PACKAGE_AMOUNT: "4400" },
  { PACKAGE_ID: "dstv-79", PACKAGE_NAME: "DStv Compact", PACKAGE_AMOUNT: "15700" },
] }] } };
const SMILE = { MOBILE_NETWORK: { SMILE: [{ ID: "smile", PRODUCT: [{ PRODUCT_CODE: "624", PRODUCT_NAME: "Smile 1GB", PRODUCT_AMOUNT: "1000" }] }] } };
const SPECTRANET = { MOBILE_NETWORK: { SPECTRANET: [{ ID: "sp", PRODUCT: [{ PRODUCT_CODE: "500", PRODUCT_NAME: "Spectranet 500", PRODUCT_AMOUNT: "500" }] }] } };
const WAEC = { EXAM_TYPE: [{ PRODUCT_CODE: "waecdirect", PRODUCT_DESCRIPTION: "WAEC Result Checker PIN", PRODUCT_AMOUNT: "5350.00" },
  { PRODUCT_CODE: "waec-registraion", PRODUCT_DESCRIPTION: "WAEC Registration PIN", PRODUCT_AMOUNT: "37500.00" }] };
const DATA = { MOBILE_NETWORK: { MTN: [{ ID: "MTN", PRODUCT: [
  { PRODUCT_ID: "500.0", PRODUCT_NAME: "500 MB - 7 days (SME)", PRODUCT_AMOUNT: "385" },
  { PRODUCT_ID: "1000.0", PRODUCT_NAME: "1 GB - 30 days (SME) ", PRODUCT_AMOUNT: "770" },
] }] } };
let ckCalls = [];
const ckSrv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const path = u.pathname.slice(1); const p = Object.fromEntries(u.searchParams);
  const send = (body) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (p.UserID === "CK000000") return send({ status: "INVALID_CREDENTIALS" });
  ckCalls.push(path);
  if (path === "APICableTVPackagesV2.asp") return send(p.CableTV === "dstv" ? CABLE : { TV_ID: {} });
  if (path === "APISmilePackagesV2.asp") return send(SMILE);
  if (path === "APISpectranetPackagesV2.asp") return send(SPECTRANET);
  if (path === "APIWAECPackagesV2.asp") return send(WAEC);
  if (path === "APIJAMBPackagesV2.asp") return send({ EXAM_TYPE: [] });
  if (path === "APIDatabundlePlansV2.asp") return send(DATA);
  if (path === "APICableTVV1.asp") return send({ orderid: "777", statuscode: "100", status: "ORDER_RECEIVED" });
  if (path === "APIWalletBalanceV1.asp") return send({ balance: "900000" });
  return send({});
});

// ── fake Supabase: platform_config (filterable), a logged-in user, the payment gate ──
let config = {};
let walletPaidKobo = 0;
const claims = [], costs = [], balances = [];
const pick = (u) => {
  const rows = Object.entries(config).map(([key, value]) => ({ key, value }));
  const f = u.searchParams.get("key");
  if (!f) return rows;
  if (f.startsWith("eq.")) return rows.filter((r) => r.key === f.slice(3));
  if (f.startsWith("in.(")) { const ks = f.slice(4, -1).split(",").map((k) => k.replace(/^"|"$/g, "")); return rows.filter((r) => ks.includes(r.key)); }
  return rows;
};
const sbSrv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x"); const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname)?.[1];
    const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(o === null ? "" : JSON.stringify(o)); };
    if (u.pathname === "/auth/v1/user") {
      return (req.headers.authorization ?? "") === `Bearer ${USER_TOKEN}` ? send(200, { id: USER_ID, aud: "authenticated", role: "authenticated" }) : send(401, { message: "bad jwt" });
    }
    if (u.pathname === "/rest/v1/rpc/bill_gate_wallet_paid") return send(200, walletPaidKobo);
    if (u.pathname === "/rest/v1/rpc/bill_gate_claim") {
      const a = JSON.parse(b || "{}"); claims.push(a);
      const need = Math.max(0, a.p_face_kobo - a.p_allowance_kobo);
      return send(200, a.p_paid_kobo >= need ? { ok: true, verdict: "ok" } : { ok: false, reason: "underpaid", required_kobo: need });
    }
    if (t === "platform_config" && req.method === "GET") {
      const rows = pick(u);
      // maybeSingle / single ask for one object
      if (/vnd\.pgrst\.object/.test(req.headers.accept ?? "")) return rows.length ? send(200, rows[0]) : send(406, { message: "no rows" });
      return send(200, rows);
    }
    if (u.pathname === "/rest/v1/rpc/finance_record_bill_cost") { costs.push(JSON.parse(b || "{}")); return send(200, true); }
    if (t === "bill_provider_balances" && req.method === "POST") { balances.push(...[].concat(JSON.parse(b || "[]"))); return send(201, null); }
    if (u.pathname.includes("/rpc/")) return send(200, null);
    if (req.method === "GET") return send(200, []);
    send(201, null);
  });
});
await Promise.all([new Promise((r) => ckSrv.listen(CK, "127.0.0.1", r)), new Promise((r) => sbSrv.listen(SB, "127.0.0.1", r))]);
let fnProc = null;
const cleanup = () => { if (fnProc) try { killTree(fnProc); } catch {} for (const s of [ckSrv, sbSrv]) try { s.close(); } catch {} };
process.on("exit", cleanup);
{
  const env = { ...process.env, CK_BASE: `http://127.0.0.1:${CK}/`, SUPABASE_URL: `http://127.0.0.1:${SB}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: "anon",
    CK_USER_ID: "ckuser", CK_AIRTIME_KEY: "k-air", CK_DATA_KEY: "k-data", CK_CABLETV_KEY: "k-tv", CK_SMILE_KEY: "k-smile", CK_SPECTRANET_KEY: "k-sp",
    CK_WAEC_KEY: "k-waec", CK_JAMB_KEY: "k-jamb", CK_PRINT_AIRTIME_KEY: "k-pa", CK_PRINT_DATA_KEY: "k-pd" };
  fnProc = spawn("deno", ["run", "--allow-all", "--no-lock", "--node-modules-dir=none", FN], { env, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; fnProc.stdout.on("data", (d) => (log += d)); fnProc.stderr.on("data", (d) => (log += d));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "OPTIONS" }); up = r.status < 500; } catch {} if (!up) await sleep(1000); }
  if (!up) { console.log("function never started\n" + log.slice(-2000)); cleanup(); process.exit(2); }
}
const post = async (body, token) => {
  const r = await fetch(`http://127.0.0.1:${FNPORT}/`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const asUser = async (body) => (await post(body, USER_TOKEN)).body;
const asService = async (body) => (await post(body, SERVICE_KEY)).body;
// the catalogue re-reads the settings, so the next calls see what was just "saved"
const save = async (cfg) => { config = cfg; return asService({ action: "price-catalogue" }); };
let ref = 0;
const nextRef = () => `KDT-BILL-${String(1760000000000 + (++ref))}`;

try {
  // ── who may read the catalogue ──
  let r = await post({ action: "price-catalogue" }, USER_TOKEN);
  ok(r.status === 401, "price catalogue: a customer's login is refused (service only)", JSON.stringify(r));
  r = await post({ action: "price-catalogue" }, "");
  ok(r.status === 401, "price catalogue: no login is refused", JSON.stringify(r));

  // ── no admin prices: everything at the provider's price ──
  let cat = await save({});
  const dstv = cat?.cable?.find((c) => c.provider === "dstv");
  ok(dstv?.items?.length === 2 && dstv.items.every((i) => i.price === i.cost && !i.priced), "catalogue: DStv packages listed at ClubKonnect's price", JSON.stringify(dstv));
  ok(cat?.cable?.find((c) => c.provider === "gotv")?.error, "catalogue: a provider with no packages says so instead of failing the page", JSON.stringify(cat?.cable?.[1]));
  ok(cat?.smile?.items?.[0]?.cost === 1000 && cat?.spectranet?.items?.[0]?.cost === 500, "catalogue: Smile and Spectranet costs", JSON.stringify([cat?.smile, cat?.spectranet]));
  const waecRow = cat?.exams?.find((e) => e.type === "waecdirect");
  ok(waecRow?.cost === 5350 && waecRow?.price === 5350 && waecRow?.provider === "clubkonnect", "catalogue: WAEC checker cost/price from ClubKonnect", JSON.stringify(waecRow));
  ok(cat?.exams?.find((e) => e.type === "waec-registration")?.cost === 37500, "catalogue: WAEC registration found under ClubKonnect's misspelt code", JSON.stringify(cat?.exams));
  ok(cat?.exams?.find((e) => e.type === "utme-mock")?.available === false, "catalogue: JAMB with an empty list shows as not available", JSON.stringify(cat?.exams));
  const mtn = cat?.data?.find((d) => d.network === "MTN");
  ok(mtn?.plans?.length === 2 && mtn.plans[0].cost === 385 && !mtn.plans[0].priced, "catalogue: MTN data plans with their cost", JSON.stringify(mtn));
  ok(Array.isArray(cat?.services_off) && cat.services_off.length === 0 && cat?.services?.includes("print-data"), "catalogue: nothing switched off; the service list is there", JSON.stringify([cat?.services, cat?.services_off]));
  ok(cat?.print_airtime?.length === 20 && cat.print_airtime.every((p) => p.cost > 0 && p.cost <= p.face), "catalogue: Print Airtime cost for 4 networks × 5 values", JSON.stringify(cat?.print_airtime?.slice(0, 2)));

  // ── admin prices set ──
  cat = await save({
    bill_price_overrides: JSON.stringify({ cable: { "dstv|dstv-79": 16000 }, smile: { "624": 1100 }, spectranet: { "500": 520 }, exam: { "waec|waecdirect": 5600 } }),
    data_selling_prices: JSON.stringify({ MTN: { "1 GB - 30 days (SME)": 800 } }),
  });
  const compact = cat?.cable?.find((c) => c.provider === "dstv")?.items?.find((i) => i.id === "dstv-79");
  ok(compact?.price === 16000 && compact?.cost === 15700 && compact?.priced, "catalogue: the admin's DStv Compact price next to its cost", JSON.stringify(compact));
  ok(cat?.data?.find((d) => d.network === "MTN")?.plans?.find((p) => p.id === "1000.0")?.price === 800, "catalogue: the data selling price matches the plan despite the provider's trailing space", JSON.stringify(cat?.data?.[0]));

  // ── what customers are shown ──
  r = await asUser({ action: "cable-packages", provider: "dstv" });
  const shown = Object.fromEntries((r?.packages ?? []).map((p) => [p.package_id, p.package_amount]));
  ok(shown["dstv-79"] === 16000 && shown["dstv-padi"] === 4400, "customers see the admin's Compact price; Padi stays at the provider's", JSON.stringify(r));
  r = await asUser({ action: "smile-plans" });
  ok(r?.plans?.[0]?.plan_amount === 1100, "Smile plan at the admin's price", JSON.stringify(r));
  r = await asUser({ action: "spectranet-plans" });
  ok(r?.plans?.[0]?.plan_amount === 520, "Spectranet plan at the admin's price", JSON.stringify(r));
  r = await post({ action: "exam-price", exam: "waec", examType: "waecdirect" }, "");
  ok(r.body?.amount === 5600, "WAEC checker price (public lookup) at the admin's price", JSON.stringify(r));
  r = await post({ action: "exam-price", exam: "waec", examType: "waec-registration" }, "");
  ok(r.body?.amount === 37500, "WAEC registration (no admin price) stays at the provider's", JSON.stringify(r));
  r = await asUser({ action: "data-plans", network: "MTN" });
  ok(r?.plans?.find((p) => p.plan_id === "1000.0")?.plan_amount === 800, "data plan at the admin's selling price", JSON.stringify(r?.plans));

  // ── the payment gate checks the admin's price ──
  walletPaidKobo = 1_600_000; claims.length = 0; ckCalls = [];
  r = await asUser({ action: "cable", provider: "dstv", packageId: "dstv-79", smartcard: "1234567890", phone: "08031234567", requestId: nextRef() });
  ok(claims[0]?.p_face_kobo === 1_600_000, "gate: Compact's price is the admin's ₦16,000", JSON.stringify(claims[0]));
  ok(r?.status === "SUCCESS" && ckCalls.includes("APICableTVV1.asp"), "paid ₦16,000 → bought", JSON.stringify(r));
  await sleep(800);
  ok(costs.at(-1)?.p_cat === "cable" && costs.at(-1)?.p_cost_kobo === 1_570_000 && costs.at(-1)?.p_basis === "provider_plan_price" && costs.at(-1)?.p_estimated === true,
    "Bills account: the order's cost is ClubKonnect's list price ₦15,700 (not the ₦16,000 the customer paid)", JSON.stringify(costs.at(-1)));
  walletPaidKobo = 1_570_000; claims.length = 0; ckCalls = [];
  r = await asUser({ action: "cable", provider: "dstv", packageId: "dstv-79", smartcard: "1234567890", phone: "08031234567", requestId: nextRef() });
  ok(!!r?.error && !ckCalls.includes("APICableTVV1.asp"), "paid only the provider's ₦15,700 → refused as underpaid, nothing bought", JSON.stringify([r, ckCalls]));

  // an admin price BELOW the provider's: the customer pays the lower price and the gate accepts it
  await save({ ...config, bill_price_overrides: JSON.stringify({ cable: { "dstv|dstv-79": 15000 } }) });
  walletPaidKobo = 1_500_000; claims.length = 0; ckCalls = [];
  r = await asUser({ action: "cable", provider: "dstv", packageId: "dstv-79", smartcard: "1234567890", phone: "08031234567", requestId: nextRef() });
  ok(claims[0]?.p_face_kobo === 1_500_000 && r?.status === "SUCCESS", "a promo price below cost (₦15,000) is what the gate checks, and it goes through", JSON.stringify([claims[0]?.p_face_kobo, r]));

  // ── a service switched off ──
  await save({ ...config, bill_services_off: "cable,smile" });
  r = await asUser({ action: "bill-preflight", cat: "cable", amount: 15000 });
  ok(r?.ok === false && r?.reason === "service_off" && /not been charged/.test(r?.message) && /^Cable TV /.test(r?.message), "preflight: Cable TV off → stopped before charging, with a clear message", JSON.stringify(r));
  r = await asUser({ action: "bill-preflight", cat: "airtime", network: "MTN", amount: 100 });
  ok(r?.ok !== false || r?.reason !== "service_off", "preflight: airtime (still on) isn't stopped by the switch", JSON.stringify(r));
  walletPaidKobo = 1_500_000; claims.length = 0; ckCalls = [];
  r = await asUser({ action: "cable", provider: "dstv", packageId: "dstv-79", smartcard: "1234567890", phone: "08031234567", requestId: nextRef() });
  ok(r?._paused === "cable" && /not been charged/.test(r?.error) && claims.length === 0 && !ckCalls.includes("APICableTVV1.asp"),
    "a direct cable purchase while off → refused before the gate; nothing bought", JSON.stringify([r, claims.length, ckCalls]));
  r = await asService({ action: "cable", provider: "dstv", packageId: "dstv-79", smartcard: "1234567890", phone: "08031234567", requestId: nextRef(), gateUserId: USER_ID });
  ok(r?._paused === undefined && r?.status === "SUCCESS", "a card-paid order the webhook delivers (paid before the switch) still goes through", JSON.stringify(r));
  cat = await asService({ action: "price-catalogue" });
  ok(JSON.stringify([...(cat?.services_off ?? [])].sort()) === JSON.stringify(["cable", "smile"]), "catalogue shows what is switched off", JSON.stringify(cat?.services_off));

  // switched back on
  await save({ ...config, bill_services_off: "" });
  r = await asUser({ action: "bill-preflight", cat: "cable", amount: 15000 });
  ok(r?.reason !== "service_off", "switched back on → preflight no longer stops it", JSON.stringify(r));

  // ── provider wallet snapshot (cron) ──
  r = await post({ action: "provider-balance-snapshot" }, USER_TOKEN);
  ok(r.status === 401 && balances.length === 0, "wallet snapshot: a customer's login is refused", JSON.stringify(r));
  r = await post({ action: "provider-balance-snapshot" }, SERVICE_KEY);
  ok(JSON.stringify(r.body) === JSON.stringify({ saved: ["clubkonnect"] }) && balances.length === 1 && balances[0].provider === "clubkonnect" && balances[0].balance_kobo === 90_000_000,
    "wallet snapshot: ClubKonnect's balance saved; the answer names the provider, never the amount", JSON.stringify([r.body, balances]));

  // ── malformed settings never break selling ──
  await save({ bill_price_overrides: "{oops", bill_services_off: "nonsense,,", data_selling_prices: "[]" });
  r = await asUser({ action: "cable-packages", provider: "dstv" });
  ok(r?.packages?.find((p) => p.package_id === "dstv-79")?.package_amount === 15700, "unreadable price settings → provider prices, no error", JSON.stringify(r));
  r = await asUser({ action: "bill-preflight", cat: "cable", amount: 15700 });
  ok(r?.reason !== "service_off", "unknown names in the off-list switch nothing off", JSON.stringify(r));
} finally { cleanup(); }
console.log(fails ? `\n${fails} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
