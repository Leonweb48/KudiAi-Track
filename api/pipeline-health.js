// Checks all three email pipelines and surfaces the last delivery time for each.
// GET https://kudiai.app/api/pipeline-health
// Shows immediately if any pipeline has gone silent.
import { createClient } from "@supabase/supabase-js";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(204).end();

  const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(200).json({ ok: false, error: "Missing env vars" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch last 200 delivery log entries to get coverage across all pipelines
  const { data: entries, error } = await sb
    .from("email_delivery_log")
    .select("created_at, smtp_host, status, subject, error_msg")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return res.status(200).json({ ok: false, error: error.message });
  }

  const now = Date.now();
  const hoursSince = (iso) => iso ? Math.round((now - new Date(iso).getTime()) / 3600000) : null;

  // Pipeline 1 — main app (api/email-trigger.js, smtp_host starts with "kudiai-app")
  const p1 = entries.filter(e => (e.smtp_host || "").startsWith("kudiai-app"));
  const p1Last = p1.find(e => e.status === "sent");
  const p1Fail = p1.filter(e => e.status === "failed");

  // Pipeline 2 — admin portal + edge functions (smtp_host = "kudiai.app")
  const p2 = entries.filter(e => e.smtp_host === "kudiai.app");
  const p2Last = p2.find(e => e.status === "sent");

  // Pipeline 3 — auth hook OTPs (subjects contain "Login Code" or "Verification Code")
  const p3 = entries.filter(e =>
    /login code|verification code|otp/i.test(e.subject || "") && e.status === "sent"
  );
  const p3Last = p3[0];

  // CORS self-test: attempt an OPTIONS preflight to api/email-trigger to verify CORS headers
  let corsOk = null;
  try {
    const preflight = await fetch(`https://kudiai.app/api/email-trigger`, { method: "OPTIONS" });
    const allow = preflight.headers.get("access-control-allow-origin");
    corsOk = allow === "*" ? "ok" : `wrong: '${allow}'`;
  } catch (e) {
    corsOk = `error: ${e.message}`;
  }

  const report = {
    checked_at: new Date().toISOString(),
    cors_preflight: corsOk,
    pipelines: {
      "1_main_app": {
        description: "Transaction, invoice, credit, ajo emails (api/email-trigger.js)",
        last_sent:   p1Last?.created_at || null,
        hours_ago:   hoursSince(p1Last?.created_at),
        recent_failures: p1Fail.slice(0, 5).map(e => ({
          time:    e.created_at?.slice(0, 19),
          subject: e.subject,
          error:   e.error_msg,
        })),
        status: p1Last
          ? (hoursSince(p1Last.created_at) > 48 ? "STALE (>48h)" : "ok")
          : "NO DATA — pipeline may never have delivered",
      },
      "2_admin_portal": {
        description: "Staff credentials, member portals, daily digests (admin.kudiai.app)",
        last_sent:   p2Last?.created_at || null,
        hours_ago:   hoursSince(p2Last?.created_at),
        status: p2Last
          ? (hoursSince(p2Last.created_at) > 24 ? "STALE (>24h)" : "ok")
          : "NO DATA",
      },
      "3_auth_hook": {
        description: "OTP / magic-link emails (Supabase auth hook)",
        last_sent:   p3Last?.created_at || null,
        hours_ago:   hoursSince(p3Last?.created_at),
        status: p3Last
          ? (hoursSince(p3Last.created_at) > 72 ? "STALE (>72h, normal if no signups)" : "ok")
          : "NO DATA",
      },
    },
    summary: null,
  };

  const issues = [];
  if (corsOk !== "ok") issues.push(`CORS preflight: ${corsOk}`);
  if (!p1Last) issues.push("Pipeline 1 (main app) has never successfully delivered — check CORS and JWT auth");
  else if (hoursSince(p1Last.created_at) > 48) issues.push("Pipeline 1 stale (>48h)");
  if (p1Fail.length > 0) issues.push(`Pipeline 1 has ${p1Fail.length} failures in last 200 log entries`);
  if (!p2Last) issues.push("Pipeline 2 (admin portal) has no data");
  else if (hoursSince(p2Last.created_at) > 24) issues.push("Pipeline 2 stale (>24h)");

  report.summary = issues.length === 0 ? "ALL PIPELINES HEALTHY" : issues;

  return res.status(200).json(report);
}
