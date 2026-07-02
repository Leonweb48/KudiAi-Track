import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_URL    = "https://admin.kudiai.app/api/public/email-trigger";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: "Service unavailable" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Unauthorized" });

  const { event, data } = req.body || {};
  if (!event) return res.status(400).json({ error: "event required" });

  const enrichedData = {
    owner_email: user.email || "",
    user_email:  user.email || "",
    ...(data || {}),
  };

  const resp = await fetch(ADMIN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-trigger-secret": SERVICE_KEY },
    body:    JSON.stringify({ event, data: enrichedData }),
  }).catch(() => null);

  return res.status(resp?.ok ? 200 : 502).json({ ok: resp?.ok ?? false });
}
