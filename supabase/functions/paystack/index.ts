import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
  if (!SECRET_KEY) return json({ error: "Paystack not configured" }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const headers = {
    Authorization:  `Bearer ${SECRET_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const { action } = body;

    if (action === "initialize") {
      const { email, amount, reference, metadata } = body as {
        email: string; amount: number; reference: string;
        metadata?: Record<string, unknown>;
      };
      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          amount:    Math.round(Number(amount) * 100),
          reference,
          metadata,
          channels:  ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
        }),
      });
      return json(await res.json());
    }

    if (action === "verify") {
      const { reference } = body as { reference: string };
      const res = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        { headers },
      );
      return json(await res.json());
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
