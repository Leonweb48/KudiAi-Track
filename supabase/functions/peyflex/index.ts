import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE = "https://client.peyflex.com.ng";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { action, payload = {} } = await req.json();

    // ── Public endpoints (no auth) ─────────────────────────────────────

    if (action === "electricity-plans") {
      const res = await fetch(`${BASE}/api/electricity/plans/?identifier=electricity`);
      return json(await res.json());
    }

    if (action === "electricity-verify") {
      const { meter, plan, type } = payload as { meter: string; plan: string; type: string };
      const url = `${BASE}/api/electricity/verify/?identifier=electricity&meter=${encodeURIComponent(meter)}&plan=${encodeURIComponent(plan)}&type=${encodeURIComponent(type)}`;
      const res = await fetch(url);
      return json(await res.json());
    }

    if (action === "data-plans") {
      const { network } = payload as { network: string };
      const net = network.toLowerCase().replace(/\s/g, "");
      const res = await fetch(`${BASE}/api/data/plans/?identifier=data&network=${net}`);
      const text = await res.text();
      try { return json(JSON.parse(text)); } catch { return json({ plans: [] }); }
    }

    if (action === "cabletv-plans") {
      const { provider } = payload as { provider: string };
      const p = provider.toLowerCase().replace(/\s/g, "");
      const res = await fetch(`${BASE}/api/cabletv/plans/?identifier=cabletv&plan=${p}`);
      const text = await res.text();
      try { return json(JSON.parse(text)); } catch { return json({ plans: [] }); }
    }

    // ── Authenticated subscribe endpoints ─────────────────────────────

    const API_KEY = Deno.env.get("PEYFLEX_API_KEY");
    if (!API_KEY) return json({ error: "PEYFLEX_API_KEY not configured" }, 500);

    const authHeaders = {
      "Authorization": `Token ${API_KEY}`,
      "Content-Type": "application/json",
    };

    if (action === "airtime") {
      const { phone, network, amount } = payload as { phone: string; network: string; amount: string };
      const net = network.toLowerCase().replace(/\s/g, "");
      const res = await fetch(`${BASE}/api/airtime/subscribe/`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ identifier: "airtime", phone, plan: net, amount: String(amount) }),
      });
      return json(await res.json());
    }

    if (action === "data") {
      const { phone, plan, amount } = payload as { phone: string; plan: string; amount: string };
      const res = await fetch(`${BASE}/api/data/subscribe/`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ identifier: "data", phone, plan, amount: String(amount) }),
      });
      return json(await res.json());
    }

    if (action === "electricity") {
      const { meter, plan, amount, type, phone } = payload as {
        meter: string; plan: string; amount: string; type: string; phone: string;
      };
      const res = await fetch(`${BASE}/api/electricity/subscribe/`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ identifier: "electricity", meter, plan, amount: String(amount), type, phone }),
      });
      return json(await res.json());
    }

    if (action === "cabletv") {
      const { smartcard, plan, amount, phone } = payload as {
        smartcard: string; plan: string; amount: string; phone: string;
      };
      const res = await fetch(`${BASE}/api/cabletv/subscribe/`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ identifier: "cabletv", smartcard, plan, amount: String(amount), phone }),
      });
      return json(await res.json());
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
