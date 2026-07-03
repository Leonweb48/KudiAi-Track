// Live SMTP delivery test — sends a real email through the SAME pipeline as api/email-trigger.js
// Usage: GET https://kudiai.app/api/email-send-test?to=your@email.com
// Also tests admin portal pipeline when ?admin=1 is added
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const toEmail  = req.query?.to || "solomonleonjohnson01@gmail.com";
  const testAdmin = req.query?.admin === "1";

  const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const report = {
    timestamp: new Date().toISOString(),
    to: toEmail,
    smtpSend: null,
    adminTrigger: null,
  };

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(200).json({ ...report, error: "Missing env vars" });
  }

  // ── 1. Direct SMTP send (same as api/email-trigger.js) ────────────────────
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: smtp, error: smtpErr } = await sb
      .from("smtp_config")
      .select("host, port, username, password, from_email, from_name, encryption")
      .limit(1)
      .maybeSingle();

    if (smtpErr || !smtp?.host || !smtp.username || !smtp.password) {
      report.smtpSend = { ok: false, error: smtpErr?.message || "smtp_config not found" };
    } else {
      const fromEmail = smtp.from_email || smtp.username;
      const from      = `"${smtp.from_name || "KudiAI Track"}" <${fromEmail}>`;

      const transport = nodemailer.createTransport({
        host:   smtp.host,
        port:   Number(smtp.port) || 587,
        secure: smtp.encryption === "ssl",
        auth:   { user: smtp.username, pass: smtp.password },
        tls:    { rejectUnauthorized: smtp.encryption !== "none" },
      });

      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px">
        <h2 style="color:#4f46e5">KudiAI Email Delivery Test</h2>
        <p>This is a live delivery test sent at <strong>${new Date().toISOString()}</strong>.</p>
        <p>If you're reading this, the SMTP pipeline is working end-to-end.</p>
        <p>Sent from: <code>${from}</code></p>
        <p>Pipeline: main app → smtp.resend.com</p>
        <hr><p style="color:#888;font-size:12px">KudiAI Track · Automated diagnostic</p>
      </body></html>`;

      try {
        const info = await transport.sendMail({
          from,
          to:      toEmail,
          subject: `[KudiAI] Email delivery test — ${new Date().toLocaleTimeString("en-NG")}`,
          html,
        });
        report.smtpSend = { ok: true, messageId: info.messageId, accepted: info.accepted, from };
      } catch (sendErr) {
        report.smtpSend = { ok: false, error: sendErr.message, from };
      }
    }
  } catch (e) {
    report.smtpSend = { ok: false, error: e.message };
  }

  // ── 2. Admin portal trigger test ───────────────────────────────────────────
  if (testAdmin) {
    try {
      const resp = await fetch("https://admin.kudiai.app/api/public/email-trigger", {
        method: "POST",
        headers: {
          "Content-Type":   "application/json",
          "x-trigger-secret": SERVICE_KEY,
        },
        body: JSON.stringify({
          event: "staff_credentials",
          data: {
            staff_name:    "Live Test Staff",
            staff_email:   toEmail,
            role:          "Staff",
            temp_password: "LiveTest123!",
            business_name: "Delivery Test Co.",
            owner_email:   toEmail,
          },
        }),
      });
      const text = await resp.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      report.adminTrigger = { status: resp.status, body };
    } catch (e) {
      report.adminTrigger = { error: e.message };
    }
  }

  return res.status(200).json(report);
}
