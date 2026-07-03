// Diagnostic: tests whether the main app can reach admin.kudiai.app/api/public/email-trigger
// Access: GET https://kudiai.app/api/admin-trigger-test
// This uses the same SUPABASE_SERVICE_ROLE_KEY that Supabase edge functions use as x-trigger-secret
export default async function handler(req, res) {
  const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    return res.status(200).json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set in main app" });
  }

  const report = {
    timestamp: new Date().toISOString(),
    service_key_chars: SERVICE_KEY.length,
    service_key_prefix: SERVICE_KEY.slice(0, 12) + "...",
    trigger_result: null,
  };

  try {
    const resp = await fetch("https://admin.kudiai.app/api/public/email-trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-trigger-secret": SERVICE_KEY,
      },
      body: JSON.stringify({
        event: "staff_credentials",
        data: {
          staff_name: "Diagnostic Test",
          staff_email: "diagnostic@kudiai.app",
          role: "Staff",
          temp_password: "DIAG-TEST-IGNORE",
          business_name: "Diagnostic Run",
          owner_email: "",
        },
      }),
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    report.trigger_result = { status: resp.status, body: json };
  } catch (e) {
    report.trigger_result = { error: e.message };
  }

  return res.status(200).json(report);
}
