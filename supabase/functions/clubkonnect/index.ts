import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const BASE      = "https://www.clubkonnect.com/api/v2/";
const USER_ID   = Deno.env.get("CK_USER_ID")      ?? "";
const AIRTIME_K = Deno.env.get("CK_AIRTIME_KEY")  ?? "";
const DATA_K    = Deno.env.get("CK_DATA_KEY")      ?? "";

const NET_ID: Record<string, string> = {
  MTN: "01", Airtel: "02", Glo: "03", "9mobile": "04",
};

const reqId = () => `KDT${Date.now()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

async function ck(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ UserID: USER_ID, ...params });
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`ClubKonnect HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`Invalid response: ${text.slice(0, 120)}`); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { action } = body as { action: string };

  try {
    // ── Airtime ───────────────────────────────────────────────────────
    if (action === "airtime") {
      const { phone, network, amount } = body as { phone: string; network: string; amount: string };
      if (!phone || !network || !amount) return json({ error: "phone, network and amount required" }, 400);
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` }, 400);

      const data = await ck("airtime/", {
        APIKey:       AIRTIME_K,
        MobileNumber: phone.replace(/\D/g, ""),
        NetworkID:    netId,
        Amount:       String(amount),
        RequestID:    reqId(),
      });

      const ok = String(data?.status ?? "").toLowerCase() === "success";
      if (!ok) return json({ error: data?.message ?? data?.Message ?? "Airtime purchase failed" }, 400);
      return json({ status: "SUCCESS", reference: data.RequestID ?? data.requestID ?? null });
    }

    // ── Data plans ────────────────────────────────────────────────────
    if (action === "data-plans") {
      const { network } = body as { network: string };
      const netId = NET_ID[network] ?? "01";

      const data = await ck("data/plans/", { APIKey: DATA_K, NetworkID: netId });

      const raw: unknown[] = Array.isArray(data) ? data : (data?.plans ?? data?.data ?? []);
      const plans = raw.map((p: Record<string, unknown>) => ({
        plan_id:     String(p.DataPlan   ?? p.data_plan ?? p.ID    ?? p.id    ?? ""),
        plan_name:   String(p.DataPlanName ?? p.plan_name ?? p.Name ?? p.name ?? ""),
        plan_amount: Number(p.Price ?? p.price ?? p.Amount ?? p.amount ?? 0),
      })).filter(p => p.plan_id);

      return json({ plans });
    }

    // ── Data purchase ─────────────────────────────────────────────────
    if (action === "data") {
      const { phone, network, planId } = body as { phone: string; network: string; planId: string };
      if (!phone || !network || !planId) return json({ error: "phone, network and planId required" }, 400);
      const netId = NET_ID[network];
      if (!netId) return json({ error: `Unknown network: ${network}` }, 400);

      const data = await ck("data/", {
        APIKey:       DATA_K,
        MobileNumber: phone.replace(/\D/g, ""),
        DataPlan:     planId,
        NetworkID:    netId,
        RequestID:    reqId(),
      });

      const ok = String(data?.status ?? "").toLowerCase() === "success";
      if (!ok) return json({ error: data?.message ?? data?.Message ?? "Data purchase failed" }, 400);
      return json({ status: "SUCCESS", reference: data.RequestID ?? data.requestID ?? null });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
