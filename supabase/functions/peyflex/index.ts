import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE = "https://sandbox.vtpass.com/api";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function reqId() {
  return "KDT-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function dataServiceId(network: string) {
  const map: Record<string, string> = {
    mtn: "mtn-data", airtel: "airtel-data", glo: "glo-data",
    "9mobile": "etisalat-data", etisalat: "etisalat-data",
  };
  return map[network.toLowerCase().replace(/\s/g, "")] || "mtn-data";
}

function airtimeServiceId(network: string) {
  const map: Record<string, string> = {
    mtn: "mtn", airtel: "airtel", glo: "glo",
    "9mobile": "etisalat", etisalat: "etisalat",
  };
  return map[network.toLowerCase().replace(/\s/g, "")] || "mtn";
}

function cableServiceId(provider: string) {
  const map: Record<string, string> = { dstv: "dstv", gotv: "gotv", startimes: "startimes" };
  return map[provider.toLowerCase().replace(/\s/g, "")] || "dstv";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { action, payload = {} } = await req.json();

    const API_KEY    = Deno.env.get("VTPASS_API_KEY");
    const SECRET_KEY = Deno.env.get("VTPASS_SECRET_KEY");
    if (!API_KEY || !SECRET_KEY) return json({ error: "VTpass credentials not configured" }, 500);

    const hdrs = { "api-key": API_KEY, "secret-key": SECRET_KEY, "Content-Type": "application/json" };

    // ── Plan variations ────────────────────────────────────────────────

    if (action === "data-plans") {
      const { network } = payload as { network: string };
      const serviceID = dataServiceId(network);
      const res  = await fetch(`${BASE}/service-variations?serviceID=${serviceID}`, { headers: hdrs });
      const data = await res.json();
      const plans = (data?.content?.varations || []).map((v: Record<string, string>) => ({
        plan_id:     v.variation_code,
        plan_code:   v.variation_code,
        plan_name:   v.name,
        plan_amount: parseFloat(v.variation_amount) || 0,
      }));
      return json({ status: "SUCCESS", plans });
    }

    if (action === "cabletv-plans") {
      const { provider } = payload as { provider: string };
      const serviceID = cableServiceId(provider);
      const res  = await fetch(`${BASE}/service-variations?serviceID=${serviceID}`, { headers: hdrs });
      const data = await res.json();
      const plans = (data?.content?.varations || []).map((v: Record<string, string>) => ({
        plan_id:     v.variation_code,
        plan_code:   v.variation_code,
        plan_name:   v.name,
        plan_amount: parseFloat(v.variation_amount) || 0,
      }));
      return json({ status: "SUCCESS", plans });
    }

    // ── Electricity meter verify ───────────────────────────────────────

    if (action === "electricity-verify") {
      const { meter, plan, type } = payload as { meter: string; plan: string; type: string };
      const res  = await fetch(`${BASE}/merchant-verify`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ billersCode: meter, serviceID: plan, type }),
      });
      const data = await res.json();
      if (data?.code === "000") {
        return json({
          status:        "SUCCESS",
          customer_name: data?.content?.Customer_Name || data?.content?.name || "Verified",
          address:       data?.content?.Address || "",
        });
      }
      return json({ status: "FAILED", message: data?.response_description || "Verification failed" });
    }

    // ── Subscribe / Pay ────────────────────────────────────────────────

    if (action === "airtime") {
      const { phone, network, amount } = payload as { phone: string; network: string; amount: string };
      const serviceID = airtimeServiceId(network);
      const res  = await fetch(`${BASE}/pay`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ request_id: reqId(), serviceID, amount: parseFloat(amount), phone }),
      });
      const data = await res.json();
      const ok   = data?.code === "000";
      return json({
        status:    ok ? "SUCCESS" : "FAILED",
        reference: data?.requestId,
        amount:    data?.amount,
        message:   data?.response_description,
      });
    }

    if (action === "data") {
      const { phone, plan, amount, network } = payload as { phone: string; plan: string; amount: string; network: string };
      const serviceID = dataServiceId(network || "mtn");
      const res  = await fetch(`${BASE}/pay`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ request_id: reqId(), serviceID, billersCode: phone, variation_code: plan, amount: parseFloat(amount), phone }),
      });
      const data = await res.json();
      const ok   = data?.code === "000";
      return json({
        status:    ok ? "SUCCESS" : "FAILED",
        reference: data?.requestId,
        amount:    data?.amount,
        message:   data?.response_description,
      });
    }

    if (action === "electricity") {
      const { meter, plan, amount, type, phone } = payload as {
        meter: string; plan: string; amount: string; type: string; phone: string;
      };
      const res  = await fetch(`${BASE}/pay`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ request_id: reqId(), serviceID: plan, billersCode: meter, variation_code: type, amount: parseFloat(amount), phone }),
      });
      const data = await res.json();
      const ok   = data?.code === "000";
      return json({
        status:    ok ? "SUCCESS" : "FAILED",
        reference: data?.requestId,
        token:     data?.purchased_code || data?.content?.transactions?.token,
        amount:    data?.amount,
        message:   data?.response_description,
      });
    }

    if (action === "cabletv") {
      const { smartcard, plan, amount, phone, provider } = payload as {
        smartcard: string; plan: string; amount: string; phone: string; provider: string;
      };
      const serviceID = cableServiceId(provider || plan.split("-")[0] || "dstv");
      const res  = await fetch(`${BASE}/pay`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ request_id: reqId(), serviceID, billersCode: smartcard, variation_code: plan, amount: parseFloat(amount), phone }),
      });
      const data = await res.json();
      const ok   = data?.code === "000";
      return json({
        status:    ok ? "SUCCESS" : "FAILED",
        reference: data?.requestId,
        amount:    data?.amount,
        message:   data?.response_description,
      });
    }

    if (action === "betting") {
      const { account, provider, amount } = payload as { account: string; provider: string; amount: string };
      const bettingMap: Record<string, string> = {
        bet9ja: "bet9ja", sportybet: "sportybet", nairabet: "nairabet",
        betking: "betking", merrybet: "merrybet", paripesa: "paripesa",
      };
      const serviceID = bettingMap[provider.toLowerCase().replace(/\s/g, "")] || provider.toLowerCase();
      const res  = await fetch(`${BASE}/pay`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ request_id: reqId(), serviceID, billersCode: account, variation_code: "directly", amount: parseFloat(amount), phone: account }),
      });
      const data = await res.json();
      const ok   = data?.code === "000";
      return json({
        status:    ok ? "SUCCESS" : "FAILED",
        reference: data?.requestId,
        amount:    data?.amount,
        message:   data?.response_description,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
