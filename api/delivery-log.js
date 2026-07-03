// Shows recent email_delivery_log entries to debug delivery issues
// GET https://kudiai.app/api/delivery-log
import { createClient } from "@supabase/supabase-js";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(200).json({ error: "Missing env vars" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await sb
    .from("email_delivery_log")
    .select("created_at, to_email, subject, status, error_msg, smtp_host")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return res.status(200).json({ error: error.message });

  const summary = {
    total: data.length,
    sent:  data.filter(r => r.status === "sent").length,
    failed: data.filter(r => r.status === "failed").length,
    entries: data.map(r => ({
      time:   r.created_at?.slice(0, 19),
      status: r.status,
      to:     r.to_email,
      subject: (r.subject || "").slice(0, 60),
      error:  r.error_msg || null,
      host:   r.smtp_host,
    })),
  };

  return res.status(200).json(summary);
}
