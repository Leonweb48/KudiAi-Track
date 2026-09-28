// RETIRED (2026-09-28). This was the first VTpass integration (June 2026): it bought airtime/data/etc. for any
// logged-in user with no check that the order was paid for, used a random request_id per call (a retry could buy
// twice) and treated "pending" as failed. VTpass is now the second bill provider inside the `clubkonnect` function
// (payment-gated, claim-based routing, requery-confirmed — see supabase/functions/_shared/billProvider.ts), so this
// endpoint answers every request with 410 and never touches VTpass. It stays deployed only so the old code is replaced.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return new Response(JSON.stringify({ error: "This endpoint has been retired. Bills are bought through the clubkonnect function." }), {
    status: 410, headers: { ...CORS, "Content-Type": "application/json" },
  });
});
