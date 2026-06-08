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

  try {
    const { email, amount, reference, planId } = await req.json();

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
          callback_url:
            "com.amayatechnologies.kuditrack://payment-callback",
          metadata: {
            planId,
            custom_fields: [
              {
                display_name: "Plan",
                variable_name: "plan",
                value: planId,
              },
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
