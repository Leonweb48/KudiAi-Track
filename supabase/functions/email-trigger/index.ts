// v4 — uses dedicated EMAIL_TRIGGER_SECRET (falls back to SUPABASE_SERVICE_ROLE_KEY)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_URL    = "https://admin.kudiai.app/api/public/email-trigger";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")             ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TRIGGER_KEY  = Deno.env.get("EMAIL_TRIGGER_SECRET") || SERVICE_KEY;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Require a valid Supabase session — secret never leaves the server
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  let body: { event?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.event) return json({ error: "event is required" }, 400);

  // Inject the authenticated user's email as fallback so invoice emails
  // always reach the business owner even if profiles.email is null
  const authEmail = user.email || "";
  const enrichedData = {
    owner_email: authEmail,
    user_email:  authEmail,
    ...(body.data || {}),
  };

  // Forward to admin API — authenticated with dedicated EMAIL_TRIGGER_SECRET
  const resp = await fetch(ADMIN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-trigger-secret": TRIGGER_KEY },
    body:    JSON.stringify({ event: body.event, data: enrichedData }),
  }).catch(() => null);

  return json({ ok: resp?.ok ?? false });
});
