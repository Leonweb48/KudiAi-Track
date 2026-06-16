import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (d: unknown) =>
  new Response(JSON.stringify(d), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

const BASE           = "https://www.nellobytesystems.com/";
const USER_ID        = Deno.env.get("CK_USER_ID")           ?? "";
const AIRTIME_K      = Deno.env.get("CK_AIRTIME_KEY")       ?? "";
const DATA_K         = Deno.env.get("CK_DATA_KEY")          ?? "";
const CABLETV_K      = Deno.env.get("CK_CABLETV_KEY")       ?? "";
const ELECTRICITY_K  = Deno.env.get("CK_ELECTRICITY_KEY")   ?? "";
const BETTING_K      = Deno.env.get("CK_BETTING_KEY")       ?? "";
const WAEC_K         = Deno.env.get("CK_WAEC_KEY")          ?? "";
const JAMB_K         = Deno.env.get("CK_JAMB_KEY")          ?? "";
const SPECTRANET_K   = Deno.env.get("CK_SPECTRANET_KEY")    ?? "";
const SMILE_K        = Deno.env.get("CK_SMILE_KEY")         ?? "";
const PRINT_AIRTIME_K = Deno.env.get("CK_PRINT_AIRTIME_KEY") ?? "";
const PRINT_DATA_K   = Deno.env.get("CK_PRINT_DATA_KEY")    ?? "";

const NET_ID: Record<string, string> = {
  MTN: "01", Glo: "02", "t2mobile": "03", "9mobile": "03", Airtel: "04",
};

const reqId = () => `KDT${Date.now()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

async function ck(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ UserID: USER_ID, ...params });
  const url = `${BASE}${path}?${qs}`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  const text = await res.text();
  console.log(`CK ${path} status=${res.status} body=${text.slice(0, 400)}`);
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { return { _raw: text, _http: res.status }; }
}

function isOk(data: Record<string, unknown>): boolean {
  const code = String(data?.statuscode ?? data?.StatusCode ?? "");
  const stat = String(data?.status ?? data?.Status ?? "").toUpperCase();
  return code === "100" || code === "200" || stat === "ORDER_RECEIVED" || stat === "ORDER_COMPLETED";
}

function errMsg(data: Record<string, unknown>, fallback: string): string {
  return String(
    data?.status ?? data?.Status ?? data?.message ?? data?.Message ??
    data?.description ?? data?._raw ?? fallback
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON body" }); }

  const { action } = body as { action: string };

  try {

    // ── Airtime ───────────────────────────────────────────────────────────────
    if (action === "airtime") {
      const { phone, network, amount } = body as { phone: string; network: string; amount: string };
      if (!phone || !network || !amount) return json({ error: "phone, network and amount required" });
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` });
      const data = await ck("APIAirtimeV1.asp", {
        APIKey: AIRTIME_K, MobileNetwork: netId, Amount: String(amount),
        MobileNumber: phone.replace(/\D/g, ""), RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Airtime purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Data plans ────────────────────────────────────────────────────────────
    if (action === "data-plans") {
      const { network } = body as { network: string };
      const netId = NET_ID[network] ?? "01";
      const data = await ck("APIDatabundlePlansV2.asp", { APIKey: DATA_K, MobileNetwork: netId });
      if (data?.status && String(data.status).includes("INVALID")) return json({ error: `Data API key error: ${data.status}`, plans: [] });

      // Response format: { MOBILE_NETWORK: { MTN: [{ ID, PRODUCT: [{PRODUCT_CODE, PRODUCT_NAME, PRODUCT_AMOUNT}] }] } }
      const NET_KEY: Record<string, string> = { MTN: "MTN", Glo: "GLO", "9mobile": "9MOBILE", Airtel: "AIRTEL" };
      const mobileNet = data?.MOBILE_NETWORK as Record<string, Record<string, unknown>[]> | undefined;
      let plans: { plan_id: string; plan_name: string; plan_amount: number }[] = [];

      if (mobileNet) {
        const netKey = NET_KEY[network] ?? "MTN";
        const groups = mobileNet[netKey] ?? [];
        for (const group of groups) {
          const products = (group?.PRODUCT ?? []) as Record<string, unknown>[];
          for (const p of products) {
            const pid = String(p.PRODUCT_CODE ?? p.PRODUCT_ID ?? "");
            if (pid) plans.push({
              plan_id:     pid,
              plan_name:   String(p.PRODUCT_NAME ?? ""),
              plan_amount: Number(p.PRODUCT_AMOUNT ?? 0),
            });
          }
        }
      } else {
        // Fallback for older response shapes
        const raw: unknown[] = Array.isArray(data) ? data
          : (data?.DataBundlePlans ?? data?.response ?? data?.DataPlans ?? data?.plans ?? data?.data ?? []) as unknown[];
        plans = (raw as Record<string, unknown>[]).map(p => ({
          plan_id:     String(p.DataPlan ?? p.PRODUCT_CODE ?? p.id ?? ""),
          plan_name:   String(p.DataPlanName ?? p.PRODUCT_NAME ?? p.name ?? ""),
          plan_amount: Number(p.Price ?? p.PRODUCT_AMOUNT ?? p.amount ?? 0),
        })).filter(p => p.plan_id && p.plan_id !== "undefined");
      }

      if (!plans.length) return json({ plans: [], error: `No plans returned: ${JSON.stringify(data).slice(0, 200)}` });
      return json({ plans, _count: plans.length });
    }

    // ── Data purchase ─────────────────────────────────────────────────────────
    if (action === "data") {
      const { phone, network, planId } = body as { phone: string; network: string; planId: string };
      if (!phone || !network || !planId) return json({ error: "phone, network and planId required" });
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` });
      const data = await ck("APIDatabundleV1.asp", {
        APIKey: DATA_K, MobileNetwork: netId, DataPlan: planId,
        MobileNumber: phone.replace(/\D/g, ""), RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Data purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Cable TV providers ────────────────────────────────────────────────────
    if (action === "cable-providers") {
      const data = await ck("APICableTVTypeV2.asp", { APIKey: CABLETV_K });
      return json({ providers: data });
    }

    // ── Cable TV packages ─────────────────────────────────────────────────────
    if (action === "cable-packages") {
      const { provider } = body as { provider: string };
      if (!provider) return json({ error: "provider required" });
      const data = await ck("APICableTVPackagesV2.asp", { APIKey: CABLETV_K, CableTV: provider });
      if (data?.status && String(data.status).includes("INVALID")) return json({ error: `Cable API key error: ${data.status}`, packages: [] });

      // Response format: { TV_ID: { DStv: [{ ID, PRODUCT: [{PACKAGE_ID, PACKAGE_NAME, PACKAGE_AMOUNT}] }] } }
      const TV_KEY: Record<string, string> = { dstv: "DStv", gotv: "GOtv", startimes: "StarTimes", showmax: "Showmax" };
      const tvId = data?.TV_ID as Record<string, Record<string, unknown>[]> | undefined;
      let packages: { package_id: string; package_name: string; package_amount: number }[] = [];

      if (tvId) {
        const tvKey = TV_KEY[provider] ?? provider;
        const groups = tvId[tvKey] ?? Object.values(tvId)[0] ?? [];
        for (const group of groups) {
          for (const p of ((group?.PRODUCT ?? []) as Record<string, unknown>[])) {
            const pid = String(p.PACKAGE_ID ?? p.PRODUCT_CODE ?? p.id ?? "");
            if (pid) packages.push({
              package_id:     pid,
              package_name:   String(p.PACKAGE_NAME ?? p.PRODUCT_NAME ?? ""),
              package_amount: Number(p.PACKAGE_AMOUNT ?? p.PRODUCT_AMOUNT ?? 0),
            });
          }
        }
      } else {
        const raw: unknown[] = Array.isArray(data) ? data
          : (data?.Packages ?? data?.packages ?? data?.CableTVPackages ?? data?.response ?? data?.data ?? []) as unknown[];
        packages = (raw as Record<string, unknown>[]).map(p => ({
          package_id:     String(p.PACKAGE_ID ?? p.PackageCode ?? p.id ?? ""),
          package_name:   String(p.PACKAGE_NAME ?? p.PackageName ?? p.name ?? ""),
          package_amount: Number(p.PACKAGE_AMOUNT ?? p.Price ?? p.amount ?? 0),
        })).filter(p => p.package_id && p.package_id !== "undefined");
      }

      if (!packages.length) return json({ packages: [], error: `No packages returned: ${JSON.stringify(data).slice(0, 200)}` });
      return json({ packages });
    }

    // ── Cable TV verify smartcard ─────────────────────────────────────────────
    if (action === "cable-verify") {
      const { provider, smartcard } = body as { provider: string; smartcard: string };
      if (!provider || !smartcard) return json({ error: "provider and smartcard required" });
      const data = await ck("APIVerifyCableTVV1.asp", { APIKey: CABLETV_K, CableTV: provider, SmartCardNo: smartcard });
      console.log("cable-verify raw:", JSON.stringify(data).slice(0, 400));
      const statusStr = String(data?.status ?? data?.Status ?? "").toUpperCase();
      if (statusStr.includes("INVALID_CREDENTIALS") || statusStr.includes("INVALID_KEY") || statusStr.includes("UNAUTHORIZED"))
        return json({ error: `Cable TV API key error: ${statusStr}` });
      const name = String(data?.customer_name ?? data?.CustomerName ?? data?.CUSTOMER_NAME ?? "");
      if (!name || name.toUpperCase() === "INVALID_SMARTCARDNO" || name.toUpperCase().includes("INVALID"))
        return json({ error: `Smartcard not found (${smartcard}). Check the number and selected provider.`, _raw: data });
      return json({ customer_name: name });
    }

    // ── Cable TV purchase ─────────────────────────────────────────────────────
    if (action === "cable") {
      const { provider, packageId, smartcard, phone } = body as { provider: string; packageId: string; smartcard: string; phone: string };
      if (!provider || !packageId || !smartcard || !phone) return json({ error: "provider, packageId, smartcard and phone required" });
      const data = await ck("APICableTVV1.asp", {
        APIKey: CABLETV_K, CableTV: provider, Package: packageId,
        SmartCardNo: smartcard, PhoneNo: phone.replace(/\D/g, ""),
        RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Cable TV subscription failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Electricity providers ─────────────────────────────────────────────────
    if (action === "electricity-providers") {
      const data = await ck("APIElectricityTypeV2.asp", { APIKey: ELECTRICITY_K });
      return json({ providers: data });
    }

    // ── Electricity verify meter ──────────────────────────────────────────────
    if (action === "electricity-verify") {
      const { company, meterNo, meterType } = body as { company: string; meterNo: string; meterType: string };
      if (!company || !meterNo || !meterType) return json({ error: "company, meterNo and meterType required" });
      const data = await ck("APIVerifyElectricityV1.asp", { APIKey: ELECTRICITY_K, ElectricCompany: company, MeterNo: meterNo, MeterType: meterType });
      console.log("electricity-verify raw:", JSON.stringify(data).slice(0, 400));
      // API key / credential errors
      const statusStr = String(data?.status ?? data?.Status ?? "").toUpperCase();
      if (statusStr.includes("INVALID_CREDENTIALS") || statusStr.includes("INVALID_KEY") || statusStr.includes("UNAUTHORIZED"))
        return json({ error: `Electricity API key error: ${statusStr}` });
      const name = String(data?.customer_name ?? data?.CustomerName ?? data?.CUSTOMER_NAME ?? "");
      if (!name || name.toUpperCase() === "INVALID_METERNO" || name.toUpperCase().includes("INVALID"))
        return json({ error: `Meter not found (${meterNo}). Check the number and selected company.`, _raw: data });
      return json({ customer_name: name });
    }

    // ── Electricity purchase ──────────────────────────────────────────────────
    if (action === "electricity") {
      const { company, meterType, meterNo, amount, phone } = body as { company: string; meterType: string; meterNo: string; amount: string; phone: string };
      if (!company || !meterType || !meterNo || !amount || !phone) return json({ error: "All electricity fields required" });
      const amt = parseFloat(amount);
      if (amt < 1000) return json({ error: "Minimum electricity amount is ₦1,000" });
      if (amt > 200000) return json({ error: "Maximum electricity amount is ₦200,000" });
      const data = await ck("APIElectricityV1.asp", {
        APIKey: ELECTRICITY_K, ElectricCompany: company, MeterType: meterType,
        MeterNo: meterNo, Amount: String(amount), PhoneNo: phone.replace(/\D/g, ""),
        RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Electricity purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), token: String(data.token ?? data.Token ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Betting providers ─────────────────────────────────────────────────────
    if (action === "betting-providers") {
      const data = await ck("APIBettingTypeV2.asp", { APIKey: BETTING_K });
      return json({ providers: data });
    }

    // ── Betting verify account ────────────────────────────────────────────────
    if (action === "betting-verify") {
      const { company, customerId } = body as { company: string; customerId: string };
      if (!company || !customerId) return json({ error: "company and customerId required" });
      const data = await ck("APIVerifyBettingV1.asp", { APIKey: BETTING_K, BettingCompany: company, CustomerID: customerId });
      const name = String(data?.customer_name ?? data?.CustomerName ?? "");
      if (!name || name.toLowerCase().includes("invalid") || name.toLowerCase().includes("error"))
        return json({ error: "Invalid customer ID" });
      return json({ customer_name: name });
    }

    // ── Betting purchase ──────────────────────────────────────────────────────
    if (action === "betting") {
      const { company, customerId, amount } = body as { company: string; customerId: string; amount: string };
      if (!company || !customerId || !amount) return json({ error: "company, customerId and amount required" });
      const data = await ck("APIBettingV1.asp", {
        APIKey: BETTING_K, BettingCompany: company, CustomerID: customerId,
        Amount: String(amount), RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Betting wallet funding failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── WAEC packages ─────────────────────────────────────────────────────────
    if (action === "waec-packages") {
      const data = await ck("APIWAECPackagesV2.asp", { APIKey: WAEC_K });
      return json({ packages: data });
    }

    // ── WAEC purchase ─────────────────────────────────────────────────────────
    if (action === "waec") {
      const { examType, phone } = body as { examType: string; phone: string };
      if (!examType || !phone) return json({ error: "examType and phone required" });
      const data = await ck("APIWAECV1.asp", {
        APIKey: WAEC_K, ExamType: examType,
        PhoneNo: phone.replace(/\D/g, ""), RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "WAEC ePin purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), cardDetails: String(data.carddetails ?? data.CardDetails ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── JAMB packages ─────────────────────────────────────────────────────────
    if (action === "jamb-packages") {
      const data = await ck("APIJAMBPackagesV2.asp", { APIKey: JAMB_K });
      return json({ packages: data });
    }

    // ── JAMB verify profile ───────────────────────────────────────────────────
    if (action === "jamb-verify") {
      const { examType, profileId } = body as { examType: string; profileId: string };
      if (!examType || !profileId) return json({ error: "examType and profileId required" });
      const data = await ck("APIVerifyJAMBV1.asp", { APIKey: JAMB_K, ExamType: examType, ProfileID: profileId });
      const name = String(data?.customer_name ?? data?.CustomerName ?? "");
      if (!name || name === "INVALID_ACCOUNTNO" || name.toLowerCase().includes("invalid"))
        return json({ error: "Invalid JAMB profile ID" });
      return json({ customer_name: name });
    }

    // ── JAMB purchase ─────────────────────────────────────────────────────────
    if (action === "jamb") {
      const { examType, phone } = body as { examType: string; phone: string };
      if (!examType || !phone) return json({ error: "examType and phone required" });
      const data = await ck("APIJAMBV1.asp", {
        APIKey: JAMB_K, ExamType: examType,
        PhoneNo: phone.replace(/\D/g, ""), RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "JAMB ePin purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), cardDetails: String(data.carddetails ?? data.CardDetails ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Spectranet plans ──────────────────────────────────────────────────────
    if (action === "spectranet-plans") {
      const data = await ck("APISpectranetPackagesV2.asp", { APIKey: SPECTRANET_K });
      if (data?.status && String(data.status).includes("INVALID")) return json({ error: `Spectranet API key error: ${data.status}`, plans: [] });
      const mobileNet = data?.MOBILE_NETWORK as Record<string, Record<string, unknown>[]> | undefined;
      let plans: { plan_id: string; plan_name: string; plan_amount: number }[] = [];
      if (mobileNet) {
        const groups = mobileNet["SPECTRANET"] ?? mobileNet["spectranet"] ?? Object.values(mobileNet)[0] ?? [];
        for (const group of groups) {
          for (const p of ((group?.PRODUCT ?? []) as Record<string, unknown>[])) {
            const pid = String(p.PRODUCT_CODE ?? p.PRODUCT_ID ?? "");
            if (pid) plans.push({ plan_id: pid, plan_name: String(p.PRODUCT_NAME ?? ""), plan_amount: Number(p.PRODUCT_AMOUNT ?? 0) });
          }
        }
      } else {
        const raw: unknown[] = Array.isArray(data) ? data : (data?.Packages ?? data?.packages ?? data?.response ?? data?.data ?? []) as unknown[];
        plans = (raw as Record<string, unknown>[]).map(p => ({
          plan_id:     String(p.DataPlan ?? p.PackageCode ?? p.PRODUCT_CODE ?? p.id ?? ""),
          plan_name:   String(p.DataPlanName ?? p.PackageName ?? p.PRODUCT_NAME ?? p.name ?? ""),
          plan_amount: Number(p.Price ?? p.PRODUCT_AMOUNT ?? p.amount ?? 0),
        })).filter(p => p.plan_id && p.plan_id !== "undefined");
      }
      if (!plans.length) return json({ plans: [], error: `No Spectranet plans returned: ${JSON.stringify(data).slice(0, 200)}` });
      return json({ plans });
    }

    // ── Spectranet purchase ───────────────────────────────────────────────────
    if (action === "spectranet") {
      const { accountNo, planId } = body as { accountNo: string; planId: string };
      if (!accountNo || !planId) return json({ error: "accountNo and planId required" });
      const data = await ck("APISpectranetV1.asp", {
        APIKey: SPECTRANET_K, MobileNetwork: "spectranet", DataPlan: planId,
        MobileNumber: accountNo, RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Spectranet purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Smile plans ───────────────────────────────────────────────────────────
    if (action === "smile-plans") {
      const data = await ck("APISmilePackagesV2.asp", { APIKey: SMILE_K });
      if (data?.status && String(data.status).includes("INVALID")) return json({ error: `Smile API key error: ${data.status}`, plans: [] });
      const mobileNet = data?.MOBILE_NETWORK as Record<string, Record<string, unknown>[]> | undefined;
      let plans: { plan_id: string; plan_name: string; plan_amount: number }[] = [];
      if (mobileNet) {
        const groups = mobileNet["SMILE"] ?? mobileNet["smile-direct"] ?? Object.values(mobileNet)[0] ?? [];
        for (const group of groups) {
          for (const p of ((group?.PRODUCT ?? []) as Record<string, unknown>[])) {
            const pid = String(p.PRODUCT_CODE ?? p.PRODUCT_ID ?? "");
            if (pid) plans.push({ plan_id: pid, plan_name: String(p.PRODUCT_NAME ?? ""), plan_amount: Number(p.PRODUCT_AMOUNT ?? 0) });
          }
        }
      } else {
        const raw: unknown[] = Array.isArray(data) ? data : (data?.Packages ?? data?.packages ?? data?.response ?? data?.data ?? []) as unknown[];
        plans = (raw as Record<string, unknown>[]).map(p => ({
          plan_id:     String(p.DataPlan ?? p.PackageCode ?? p.PRODUCT_CODE ?? p.id ?? ""),
          plan_name:   String(p.DataPlanName ?? p.PackageName ?? p.PRODUCT_NAME ?? p.name ?? ""),
          plan_amount: Number(p.Price ?? p.PRODUCT_AMOUNT ?? p.amount ?? 0),
        })).filter(p => p.plan_id && p.plan_id !== "undefined");
      }
      if (!plans.length) return json({ plans: [], error: `No Smile plans returned: ${JSON.stringify(data).slice(0, 200)}` });
      return json({ plans });
    }

    // ── Smile verify account ──────────────────────────────────────────────────
    if (action === "smile-verify") {
      const { accountNo } = body as { accountNo: string };
      if (!accountNo) return json({ error: "accountNo required" });
      const data = await ck("APIVerifySmileV1.asp", { APIKey: SMILE_K, MobileNetwork: "smile-direct", MobileNumber: accountNo });
      const name = String(data?.customer_name ?? data?.CustomerName ?? "");
      if (!name || name === "INVALID_ACCOUNTNO" || name.toLowerCase().includes("invalid"))
        return json({ error: "Invalid Smile account number" });
      return json({ customer_name: name });
    }

    // ── Smile purchase ────────────────────────────────────────────────────────
    if (action === "smile") {
      const { accountNo, planId } = body as { accountNo: string; planId: string };
      if (!accountNo || !planId) return json({ error: "accountNo and planId required" });
      const data = await ck("APISmileV1.asp", {
        APIKey: SMILE_K, MobileNetwork: "smile-direct", DataPlan: planId,
        MobileNumber: accountNo, RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Smile purchase failed"), _raw: data });
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Print Airtime EPIN (Enterprise only — gated in UI) ────────────────────
    if (action === "print-airtime") {
      const { network, value, quantity } = body as { network: string; value: string; quantity: string };
      if (!network || !value || !quantity) return json({ error: "network, value and quantity required" });
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` });
      const qty = parseInt(quantity, 10);
      if (qty < 1 || qty > 100) return json({ error: "Quantity must be between 1 and 100" });
      if (!["100", "200", "500"].includes(String(value))) return json({ error: "Value must be 100, 200 or 500" });
      const data = await ck("APIEPINV1.asp", {
        APIKey: PRINT_AIRTIME_K, MobileNetwork: netId, Value: String(value),
        Quantity: String(qty), RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Print airtime failed"), _raw: data });
      const pins = (data?.TXN_EPIN ?? []) as Record<string, unknown>[];
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), pins, message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Print Data EPIN (Enterprise only — gated in UI) ───────────────────────
    if (action === "print-data") {
      const { network, planId, quantity } = body as { network: string; planId: string; quantity: string };
      if (!network || !planId || !quantity) return json({ error: "network, planId and quantity required" });
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` });
      const qty = parseInt(quantity, 10);
      if (qty < 1 || qty > 100) return json({ error: "Quantity must be between 1 and 100" });
      const data = await ck("APIDatabundleEPINV1.asp", {
        APIKey: PRINT_DATA_K, MobileNetwork: netId, DataPlan: planId,
        Quantity: String(qty), RequestID: reqId(), CallBackURL: "https://kudiai.app/",
      });
      if (!isOk(data)) return json({ error: errMsg(data, "Print data failed"), _raw: data });
      const pins = (data?.TXN_EPIN_DATABUNDLE ?? []) as Record<string, unknown>[];
      return json({ status: "SUCCESS", reference: String(data.orderid ?? data.requestid ?? ""), pins, message: String(data.status ?? "ORDER_RECEIVED") });
    }

    // ── Health check — test every service key in parallel ─────────────────────
    if (action === "health-check") {
      const isInvalid = (d: Record<string, unknown>) => {
        const s = String(d?.status ?? d?.Status ?? d?._raw ?? "").toUpperCase();
        return s.includes("INVALID_CREDENTIALS") || s.includes("INVALID_KEY") ||
               s.includes("INVALID_APIKEY") || s.includes("UNAUTHORIZED") ||
               s.includes("INVALID_USER");
      };
      const ping = async (label: string, path: string, params: Record<string, string>) => {
        try {
          const d = await ck(path, params);
          return { label, ok: !isInvalid(d), detail: isInvalid(d) ? String(d?.status ?? "INVALID_CREDENTIALS") : "ok" };
        } catch (e) {
          return { label, ok: false, detail: (e as Error).message };
        }
      };
      const results = await Promise.all([
        ping("Airtime",       "APIAirtimeNetworkV2.asp",     { APIKey: AIRTIME_K }),
        ping("Data",          "APIDatabundlePlansV2.asp",    { APIKey: DATA_K, MobileNetwork: "01" }),
        ping("Cable TV",      "APICableTVTypeV2.asp",        { APIKey: CABLETV_K }),
        ping("Electricity",   "APIElectricityTypeV2.asp",    { APIKey: ELECTRICITY_K }),
        ping("Betting",       "APIBettingTypeV2.asp",        { APIKey: BETTING_K }),
        ping("WAEC",          "APIWAECPackagesV2.asp",       { APIKey: WAEC_K }),
        ping("JAMB",          "APIJAMBPackagesV2.asp",       { APIKey: JAMB_K }),
        ping("Spectranet",    "APISpectranetPackagesV2.asp", { APIKey: SPECTRANET_K }),
        ping("Smile",         "APISmilePackagesV2.asp",      { APIKey: SMILE_K }),
        ping("Print Airtime", "APIEPINDiscountV2.asp",       { APIKey: PRINT_AIRTIME_K }),
        ping("Print Data",    "APIDatabundlePlansV2.asp",    { APIKey: PRINT_DATA_K, MobileNetwork: "01" }),
      ]);
      return json({ results });
    }

    return json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("clubkonnect error:", e);
    return json({ error: (e as Error).message });
  }
});
