import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  // Require a valid Supabase session — prevents unauthenticated Paystack initialization
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  try {
    const { email, amount, reference, planId, userId, yearly } = await req.json();

    const res = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount,
          reference,
          // Must be an HTTPS URL so Paystack can redirect to it after payment.
          // The Vercel page then deep-links back into the native app.
          callback_url: "https://kudiai.app/payment-return",
          metadata: {
            payment_type: "subscription",
            plan_slug:    planId,
            user_id:      userId || null,
            yearly:       !!yearly,
            custom_fields: [
              { display_name: "Plan",    variable_name: "plan",          value: planId },
              { display_name: "Billing", variable_name: "billing_cycle", value: yearly ? "yearly" : "monthly" },
            ],
          },
        }),
      }
    );

    const body = await res.json();

    if (!body.status) {
      throw new Error(body.message || "Paystack initialization failed");
    }

    return new Response(
      JSON.stringify({
        authorization_url: body.data.authorization_url,
        reference: body.data.reference,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
