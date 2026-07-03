import { createClient } from "@supabase/supabase-js";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const report = {
    timestamp:      new Date().toISOString(),
    env: {
      SUPABASE_URL:   SUPABASE_URL   ? SUPABASE_URL.slice(0, 40)   : "NOT SET",
      SERVICE_KEY:    SERVICE_KEY    ? "SET (" + SERVICE_KEY.length + " chars)" : "NOT SET",
    },
    supabaseWrite:  null,
    smtpConfig:     null,
  };

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(200).json({ ...report, error: "Missing env vars — cannot proceed" });
  }

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Test writing to delivery log
    const { error: logErr } = await sb.from("email_delivery_log").insert({
      to_email:  "diagnostic@kudiai.app",
      subject:   "[DIAGNOSTIC] api/email-trigger reachability test",
      status:    "sent",
      error_msg: "Automated test — ignore",
      smtp_host: "diagnostic",
    });
    report.supabaseWrite = logErr ? `FAILED: ${logErr.message}` : "SUCCESS";

    // 2. Check smtp_config
    const { data: smtp, error: smtpErr } = await sb.from("smtp_config").select("host, port, username, from_email, from_name, encryption").limit(1).maybeSingle();
    if (smtpErr) {
      report.smtpConfig = `ERROR: ${smtpErr.message}`;
    } else if (!smtp) {
      report.smtpConfig = "NOT CONFIGURED — no row in smtp_config table";
    } else {
      report.smtpConfig = {
        host:       smtp.host      || "MISSING",
        port:       smtp.port      || "MISSING",
        username:   smtp.username  ? smtp.username.slice(0, 20) + "..." : "MISSING",
        from_email: smtp.from_email || "(same as username)",
        from_name:  smtp.from_name  || "(default)",
        encryption: smtp.encryption || "tls",
      };
    }
  } catch (e) {
    report.error = e.message;
  }

  return res.status(200).json(report);
}
