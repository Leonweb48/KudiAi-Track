import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")              || "";
const SERVICE_KEY         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EMAIL_TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET")     || "";
const ADMIN_PORTAL_URL    = "https://admin.kudiai.app";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Only these two events can be triggered by authenticated users
const ALLOWED_EVENTS = ["support_ticket_admin_notify", "verification_submitted"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Authenticate the caller — any valid Supabase user may call this
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const client = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error: authErr } = await client.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json() as { event: string; data: Record<string, unknown> };
    const { event, data } = body;

    if (!ALLOWED_EVENTS.includes(event)) return json({ error: "Unknown event" }, 400);
    if (!EMAIL_TRIGGER_SECRET)           return json({ error: "Service not configured" }, 503);

    const res = await fetch(`${ADMIN_PORTAL_URL}/api/public/email-trigger`, {
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "x-trigger-secret": EMAIL_TRIGGER_SECRET,
      },
      body: JSON.stringify({ event, data }),
    });

    const result = await res.json().catch(() => ({ ok: res.ok }));
    return json(result, res.status);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return json({ error: msg }, 500);
  }
});
