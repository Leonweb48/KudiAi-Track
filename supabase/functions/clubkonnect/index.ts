import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

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

// Statuses that always mean failure regardless of statuscode
const FAIL_PATTERNS = [
  "INSUFFICIENT", "LOW_WALLET", "LOW WALLET", "LOW BALANCE", "NO BALANCE",
  "FAILED", "FAILURE", "TRANSACTION FAILED", "ORDER FAILED", "ORDER_FAILED",
  "NETWORK ERROR", "SERVICE UNAVAILABLE", "DUPLICATE", "INVALID_CREDENTIALS",
  "INVALID_KEY", "INVALID KEY", "INVALID USER", "UNAUTHORIZED",
];

function isOk(data: Record<string, unknown>): boolean {
  const code = String(data?.statuscode ?? data?.StatusCode ?? "").trim();
  const stat = String(data?.status ?? data?.Status ?? "").toUpperCase().trim();

  // Explicit failure — override any good statuscode
  if (FAIL_PATTERNS.some(p => stat.includes(p))) return false;

  return code === "100" || code === "200" ||
         stat === "ORDER_RECEIVED" || stat === "ORDER_COMPLETED" ||
         stat === "SUCCESSFUL" || stat === "SUCCESS";
}

function errMsg(data: Record<string, unknown>, fallback: string): string {
  // Prefer the human-readable status message from ClubKonnect
  const raw = data?.status ?? data?.Status ?? data?.message ?? data?.Message ??
              data?.description ?? data?.Description ?? data?._raw ?? fallback;
  return String(raw);
}

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")              ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

    // ── Shared email helper ───────────────────────────────────────────────────────
    const sendEmail = async (
      sb: ReturnType<typeof createClient>,
      opts: { to: string; subject: string; html: string }
    ) => {
      const { data: smtp } = await sb.from("smtp_config").select("*").limit(1).maybeSingle();
      if (!smtp) { console.error("sendEmail: no SMTP config found"); return; }
      const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.encryption === "ssl",
        auth: { user: smtp.username, pass: smtp.password },
      });
      await transport.sendMail({
        from: `"${smtp.from_name}" <${smtp.from_email}>`,
        to:   opts.to,
        subject: opts.subject,
        html: opts.html,
      });
    };

    // ── Bill failure alert — create critical support ticket + email admins & user ─
    if (action === "bill-failure-alert") {
      const { user_id, user_email, user_name, service, amount, ps_ref, ck_error } = body as {
        user_id?: string; user_email?: string; user_name?: string;
        service?: string; amount?: number; ps_ref?: string; ck_error?: string;
      };
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

        // Create a critical support ticket so admin/finance see it immediately
        const ticketSubject = `BILLING FAILURE: ${service} — Paystack paid, ClubKonnect failed`;
        const description =
          `A customer paid successfully via Paystack but bill delivery failed.\n\n` +
          `User: ${user_name || "Unknown"} (${user_email || "N/A"})\n` +
          `Service: ${service}\n` +
          `Amount: ₦${amount?.toLocaleString() || "?"}\n` +
          `Paystack Reference: ${ps_ref}\n` +
          `ClubKonnect Error: ${ck_error}\n\n` +
          `ACTION REQUIRED: Verify ClubKonnect wallet balance and manually fulfill or refund.`;

        await sb.from("support_tickets").insert({
          subject:    ticketSubject,
          description,
          type:       "payment",
          priority:   "critical",
          status:     "open",
          user_id:    user_id || null,
          user_email: user_email || null,
          user_name:  user_name  || null,
        });

        await sb.from("admin_tasks").insert({
          title:       `ClubKonnect wallet failure — ${service}`,
          description: `Paystack ref ${ps_ref} was charged ₦${amount?.toLocaleString() || "?"} but ClubKonnect returned: "${ck_error}". Check wallet balance and fulfill manually.`,
          priority: "critical",
          status:   "pending",
        });

        // Email SuperAdmin + Finance admins
        const { data: admins } = await sb
          .from("admin_users")
          .select("email, role")
          .in("role", ["super_admin", "finance_admin"])
          .eq("is_active", true)
          .not("email", "is", null);

        const adminEmailHtml = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#dc2626;padding:20px 24px;border-radius:12px 12px 0 0">
              <h1 style="color:#fff;margin:0;font-size:20px">⚠ Bill Payment Failure Alert</h1>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #fca5a5;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 16px;color:#374151">A customer paid via Paystack but <strong>ClubKonnect failed to deliver</strong> the service.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <tr><td style="padding:8px 0;color:#6b7280;width:140px">User</td><td style="padding:8px 0;font-weight:600;color:#111827">${user_name || "Unknown"} (${user_email || "N/A"})</td></tr>
                <tr style="background:#fef2f2"><td style="padding:8px;color:#6b7280">Service</td><td style="padding:8px;font-weight:600;color:#111827">${service}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280">Amount Paid</td><td style="padding:8px 0;font-weight:600;color:#111827">₦${amount?.toLocaleString() || "?"}</td></tr>
                <tr style="background:#fef2f2"><td style="padding:8px;color:#6b7280">Paystack Ref</td><td style="padding:8px;font-family:monospace;color:#111827">${ps_ref}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280">Error</td><td style="padding:8px 0;font-weight:600;color:#dc2626">${ck_error}</td></tr>
              </table>
              <div style="margin-top:20px;padding:16px;background:#fef9c3;border:1px solid #fde68a;border-radius:8px">
                <p style="margin:0;font-weight:700;color:#92400e">ACTION REQUIRED</p>
                <p style="margin:8px 0 0;color:#92400e;font-size:14px">Check ClubKonnect wallet balance and manually fulfill or refund this customer immediately.</p>
              </div>
            </div>
          </div>`;

        for (const admin of (admins || [])) {
          if (admin.email) {
            try { await sendEmail(sb, { to: admin.email, subject: `[KudiTrack] URGENT: Bill delivery failed — ${service}`, html: adminEmailHtml }); }
            catch (e) { console.error("Admin email failed:", admin.email, (e as Error).message); }
          }
        }

        // Email the business user
        if (user_email) {
          const userEmailHtml = `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
              <div style="background:#1e293b;padding:20px 24px;border-radius:12px 12px 0 0">
                <h1 style="color:#fff;margin:0;font-size:20px">KudiTrack — Bill Payment Update</h1>
              </div>
              <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
                <p style="margin:0 0 12px;color:#374151">Dear ${user_name || "Valued Customer"},</p>
                <p style="margin:0 0 16px;color:#374151">Your Paystack payment of <strong>₦${amount?.toLocaleString() || "?"}</strong> for <strong>${service}</strong> was received successfully. However, we encountered a temporary issue delivering the service.</p>
                <div style="padding:16px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;margin-bottom:16px">
                  <p style="margin:0;font-weight:700;color:#dc2626">Delivery issue detected</p>
                  <p style="margin:8px 0 0;color:#dc2626;font-size:14px">${ck_error}</p>
                </div>
                <div style="padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px">
                  <p style="margin:0;font-weight:600;color:#92400e">Your money is safe</p>
                  <p style="margin:8px 0 0;color:#92400e;font-size:14px">Our team has been automatically alerted and will resolve this immediately. Keep your payment reference below for follow-up:</p>
                  <p style="margin:12px 0 0;font-family:monospace;font-size:16px;font-weight:700;color:#1e293b">${ps_ref}</p>
                </div>
                <p style="margin:16px 0 0;color:#6b7280;font-size:13px">If you do not receive your service within 2 hours, please contact our support team with the reference above.</p>
              </div>
            </div>`;
          try { await sendEmail(sb, { to: user_email, subject: `KudiTrack: Action needed on your ${service} payment`, html: userEmailHtml }); }
          catch (e) { console.error("User failure email failed:", (e as Error).message); }
        }

        console.log(`Bill failure alert created: ${ps_ref} — ${ck_error}`);
        return json({ ok: true });
      } catch (e) {
        console.error("bill-failure-alert error:", e);
        return json({ ok: false, error: (e as Error).message });
      }
    }

    // ── Bill success email — notify business user their bill was delivered ────────
    if (action === "bill-success-email") {
      const { user_email, user_name, service, amount, reference, detail } = body as {
        user_email?: string; user_name?: string; service?: string;
        amount?: number; reference?: string; detail?: string;
      };
      if (!user_email) return json({ ok: false, error: "user_email required" });
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
        const detailRows = (detail || "").split(" | ").filter(Boolean).map(d => {
          const [k, ...rest] = d.split(": ");
          return rest.length
            ? `<tr><td style="padding:6px 0;color:#6b7280;width:120px">${k}</td><td style="padding:6px 0;font-weight:600;color:#111827">${rest.join(": ")}</td></tr>`
            : `<tr><td colspan="2" style="padding:6px 0;color:#374151">${d}</td></tr>`;
        }).join("");
        const html = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <div style="background:linear-gradient(135deg,#059669,#047857);padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
              <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center">
                <span style="color:#fff;font-size:28px">✓</span>
              </div>
              <h1 style="color:#fff;margin:0;font-size:22px">Bill Payment Successful</h1>
              <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:15px">${service}</p>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #d1fae5;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 16px;color:#374151">Dear ${user_name || "Valued Customer"},</p>
              <p style="margin:0 0 20px;color:#374151">Your <strong>${service}</strong> payment of <strong>₦${amount?.toLocaleString() || "?"}</strong> was processed successfully.</p>
              ${detailRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">${detailRows}</table>` : ""}
              <div style="padding:12px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
                <p style="margin:0;font-size:13px;color:#166534">Payment Ref: <strong style="font-family:monospace">${reference}</strong></p>
              </div>
              <p style="margin:16px 0 0;color:#6b7280;font-size:13px">Thank you for using KudiTrack. Keep this email as proof of your transaction.</p>
            </div>
          </div>`;
        await sendEmail(sb, { to: user_email, subject: `KudiTrack: ${service} payment confirmed ✓`, html });
        return json({ ok: true });
      } catch (e) {
        console.error("bill-success-email error:", e);
        return json({ ok: false, error: (e as Error).message });
      }
    }

    // ── Health check — test every service key in parallel ─────────────────────
    if (action === "health-check") {
      // Only check the top-level status field — never scan the whole JSON body
      // which may contain "INVALID" in product names, IDs, etc.
      const isInvalid = (d: Record<string, unknown>) => {
        const s = String(d?.status ?? d?.Status ?? "").toUpperCase().trim();
        return s === "INVALID_CREDENTIALS" || s === "INVALID_KEY" ||
               s === "INVALID_APIKEY"      || s === "INVALID_USER" ||
               s === "INVALID_USERID"      || s === "UNAUTHORIZED" ||
               (s.startsWith("INVALID") && s.includes("CREDENTIAL"));
      };
      // A response is positively OK if it has real data (not just absence of error)
      const hasData = (d: Record<string, unknown>) =>
        !!(d?.MOBILE_NETWORK ?? d?.TV_ID ?? d?.Networks ?? d?.Packages ?? d?.packages ??
           d?.Plans ?? d?.plans ?? d?.DataBundlePlans ?? d?.CardDetails ?? d?.card_details);
      const ping = async (label: string, path: string, params: Record<string, string>) => {
        try {
          const d = await ck(path, params);
          const raw = JSON.stringify(d).slice(0, 150);
          if (isInvalid(d)) return { label, ok: false, detail: String(d?.status ?? "INVALID_CREDENTIALS"), raw };
          return { label, ok: true, detail: hasData(d) ? "confirmed" : "reachable", raw };
        } catch (e) {
          return { label, ok: false, detail: (e as Error).message, raw: "" };
        }
      };
      const results = await Promise.all([
        ping("Airtime",       "APIDatabundleNetworkV2.asp",  { APIKey: AIRTIME_K }),
        ping("Data",          "APIDatabundlePlansV2.asp",    { APIKey: DATA_K, MobileNetwork: "01" }),
        ping("Cable TV",      "APICableTVPackagesV2.asp",    { APIKey: CABLETV_K, CableTV: "dstv" }),
        ping("Electricity",   "APIElectricityTypeV2.asp",    { APIKey: ELECTRICITY_K }),
        ping("Betting",       "APIBettingTypeV2.asp",        { APIKey: BETTING_K }),
        ping("WAEC",          "APIWAECPackagesV2.asp",       { APIKey: WAEC_K }),
        ping("JAMB",          "APIJAMBPackagesV2.asp",       { APIKey: JAMB_K }),
        ping("Spectranet",    "APISpectranetPackagesV2.asp", { APIKey: SPECTRANET_K }),
        ping("Smile",         "APISmilePackagesV2.asp",      { APIKey: SMILE_K }),
        ping("Print Airtime", "APIEPINDiscountV2.asp",       { APIKey: PRINT_AIRTIME_K }),
        ping("Print Data",    "APIDatabundleEPINV1.asp",     { APIKey: PRINT_DATA_K, MobileNetwork: "01", DataPlan: "test", Quantity: "1", RequestID: "HEALTHCHECK", CallBackURL: "https://kudiai.app/" }),
      ]);
      return json({ results });
    }

    return json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error("clubkonnect error:", e);
    return json({ error: (e as Error).message });
  }
});
