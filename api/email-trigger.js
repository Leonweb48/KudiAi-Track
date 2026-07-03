import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── helpers ─────────────────────────────────────────────────────────────────
const str = (v) => String(v || "");
const fmt = (n) => "₦" + Number(n || 0).toLocaleString("en-NG");

function emailHtml(title, body, headerColor = "#4f46e5") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f4f8;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">
  <tr><td style="background:${headerColor};border-radius:16px 16px 0 0;padding:36px 36px 32px;text-align:center;">
    <img src="https://kudiai.app/logo.png" alt="KudiAI Track" width="56" height="56"
      style="display:block;margin:0 auto 14px;border-radius:13px;border:2px solid rgba(255,255,255,0.3);">
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">${title}</h1>
  </td></tr>
  <tr><td style="background:#ffffff;padding:32px 36px;border-left:1px solid #e4e8f0;border-right:1px solid #e4e8f0;">
    ${body}
  </td></tr>
  <tr><td style="background:#f8fafc;border:1px solid #e4e8f0;border-top:none;border-radius:0 0 16px 16px;padding:18px 36px;text-align:center;">
    <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
      For support: <a href="mailto:support@kudiai.app" style="color:#4f46e5;text-decoration:none;">support@kudiai.app</a><br>
      A product of AMAYA &amp; Co. Technologies · all rights reserved &copy; ${new Date().getFullYear()}
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ─── SMTP helpers ─────────────────────────────────────────────────────────────

async function getSmtpConfig(sb) {
  const { data } = await sb.from("smtp_config").select("*").limit(1).maybeSingle();
  return data;
}

function makeTransporter(cfg) {
  return nodemailer.createTransport({
    host:  cfg.host,
    port:  Number(cfg.port) || 587,
    secure: cfg.encryption === "ssl",
    auth:  { user: cfg.username, pass: cfg.password },
    tls:   { rejectUnauthorized: cfg.encryption !== "none" },
  });
}

async function logDelivery(sb, to, subject, status, error_msg = null) {
  await sb.from("email_delivery_log")
    .insert({ to_email: str(to), subject: str(subject), status, error_msg: error_msg ?? null, smtp_host: "kudiai-app" })
    .catch(() => {});
}

async function send(transport, from, sb, to, subject, html) {
  try {
    await transport.sendMail({ from, to, subject, html });
    await logDelivery(sb, to, subject, "sent");
    return true;
  } catch (e) {
    await logDelivery(sb, to, subject, "failed", e.message);
    return false;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: "Service unavailable" });

  // Validate JWT
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Unauthorized" });

  const { event, data: rawData } = req.body || {};
  if (!event) return res.status(400).json({ error: "event required" });

  // Enrich with authenticated user email
  const d = { owner_email: user.email || "", user_email: user.email || "", ...(rawData || {}) };

  // Get SMTP
  const smtp = await getSmtpConfig(sb);
  if (!smtp?.host || !smtp.username || !smtp.password) {
    await logDelivery(sb, str(d.user_email), `[${event}] SMTP not configured`, "failed", "smtp_config row missing or incomplete");
    return res.status(200).json({ ok: false, error: "SMTP not configured" });
  }

  const transport = makeTransporter(smtp);
  const fromEmail = smtp.from_email || smtp.username;
  const from = `"${smtp.from_name || "KudiAI Track"}" <${fromEmail}>`;
  const now = new Date().toLocaleDateString("en-NG", { dateStyle: "medium" });

  const sends = [];
  const q = (to, subject, html) => { if (to) sends.push(send(transport, from, sb, str(to), subject, html)); };

  // ── Cash in / Cash out ──────────────────────────────────────────────────────
  if (event === "transaction_credit" || event === "transaction_debit") {
    const isIn   = event === "transaction_credit";
    const amt    = fmt(d.amount);
    const color  = isIn ? "#059669" : "#dc2626";
    const bgColor = isIn ? "#f0fdf4" : "#fef2f2";
    const border  = isIn ? "#bbf7d0" : "#fecaca";
    const label   = isIn ? "Cash In" : "Cash Out";

    q(d.user_email, `${label}: ${amt} — ${str(d.business_name) || "KudiAI Track"}`,
      emailHtml(`${label} Recorded`, `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">
          Hi there, a ${label.toLowerCase()} transaction has been recorded on your account.
        </p>
        <div style="background:${bgColor};border:1px solid ${border};border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:1px;">${label}</p>
          <p style="margin:0;font-size:36px;font-weight:900;color:${color};">${amt}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">${str(d.description) || "Transaction"} · ${str(d.date) || now}</p>
        </div>
        ${str(d.customer_name) ? `<p style="font-size:13px;color:#374151;margin:0 0 6px;">Customer: <strong>${str(d.customer_name)}</strong></p>` : ""}
        ${str(d.staff_name)    ? `<p style="font-size:12px;color:#64748b;margin:0;">Recorded by: <strong>${str(d.staff_name)}</strong></p>` : ""}
      `, color));

    if (d.staff_email && d.staff_email !== d.user_email) {
      q(d.staff_email, `Transaction Confirmed: ${label} ${amt}`,
        emailHtml(`${label} Confirmed`, `
          <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.staff_name) || "Staff"}</strong>, the transaction you recorded has been saved.</p>
          <div style="background:${bgColor};border:1px solid ${border};border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:1px;">${label}</p>
            <p style="margin:0;font-size:32px;font-weight:900;color:${color};">${amt}</p>
            <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">${str(d.description) || "Transaction"} · ${str(d.date) || now}</p>
          </div>
        `, color));
    }
  }

  // ── Transaction failed / cancelled ──────────────────────────────────────────
  else if (event === "transaction_failed" || event === "transaction_cancelled") {
    const label = event === "transaction_failed" ? "Failed" : "Cancelled";
    q(d.user_email, `Transaction ${label} — ${str(d.business_name) || "KudiAI Track"}`,
      emailHtml(`Transaction ${label}`, `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">A transaction on your account was ${label.toLowerCase()}.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0;font-size:28px;font-weight:900;color:#dc2626;">${fmt(d.amount)}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">${str(d.description) || "Transaction"} · ${now}</p>
        </div>
        ${str(d.reason) ? `<p style="font-size:13px;color:#374151;margin:0;">Reason: ${str(d.reason)}</p>` : ""}
      `, "#dc2626"));
  }

  // ── Credit added ─────────────────────────────────────────────────────────────
  else if (event === "credit_added") {
    const amt = fmt(d.total_amount);
    q(d.owner_email || d.user_email, `New Credit Record — ${str(d.customer_name)} · ${amt}`,
      emailHtml("New Credit Added", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">A credit record has been created${str(d.staff_name) ? ` by <strong>${str(d.staff_name)}</strong>` : ""} on your account.</p>
        <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#9f1239;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Credit Amount</p>
          <p style="margin:0;font-size:32px;font-weight:900;color:#9f1239;">${amt}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Customer: <strong>${str(d.customer_name)}</strong></p>
        </div>
        ${d.due_date ? `<p style="font-size:13px;color:#374151;margin:0;">Repayment Due: <strong>${str(d.due_date)}</strong></p>` : ""}
      `, "linear-gradient(135deg,#dc2626 0%,#f87171 100%)"));

    if (d.customer_email) {
      q(d.customer_email, `Credit Notice — ${amt} recorded under your name`,
        emailHtml("Credit Recorded For You", `
          <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.customer_name)}</strong>, a credit record of <strong>${amt}</strong> has been created for you by <strong>${str(d.business_name) || "your creditor"}</strong>. Please ensure timely repayment.</p>
          <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:#9f1239;font-weight:700;text-transform:uppercase;">Amount Owed</p>
            <p style="margin:0;font-size:32px;font-weight:900;color:#9f1239;">${amt}</p>
          </div>
          ${d.due_date ? `<p style="font-size:13px;color:#374151;margin:0;">Due: <strong>${str(d.due_date)}</strong></p>` : ""}
        `, "linear-gradient(135deg,#dc2626 0%,#f87171 100%)"));
    }
  }

  // ── Credit repayment / fully paid ───────────────────────────────────────────
  else if (event === "credit_repayment" || event === "credit_fully_paid") {
    const isFull = event === "credit_fully_paid";
    const amt    = fmt(d.amount_paid || d.amount);
    const label  = isFull ? "Credit Fully Paid!" : "Credit Repayment Received";
    const color  = isFull ? "#059669" : "#0891b2";
    q(d.owner_email || d.user_email, `${label} — ${str(d.customer_name)}`,
      emailHtml(label, `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;"><strong>${str(d.customer_name)}</strong> made a repayment of <strong>${amt}</strong>.</p>
        ${isFull ? `<p style="font-size:14px;color:#059669;font-weight:700;margin:0 0 16px;">✓ The full credit has been settled.</p>` : `<p style="font-size:13px;color:#374151;margin:0;">Balance remaining: <strong>${fmt(d.remaining_balance)}</strong></p>`}
      `, color));
  }

  // ── Ajo contribution ────────────────────────────────────────────────────────
  else if (event === "ajo_contribution") {
    const amt = fmt(d.amount);
    q(d.client_email, `Contribution Confirmed — ${amt}`,
      emailHtml("Contribution Recorded", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.client_name)}</strong>, your contribution has been recorded.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#15803d;font-weight:700;text-transform:uppercase;">Amount Contributed</p>
          <p style="margin:0;font-size:32px;font-weight:900;color:#15803d;">${amt}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">${str(d.date) || now}</p>
        </div>
      `, "#059669"));
    q(d.owner_email || d.user_email, `Ajo Contribution: ${amt} — ${str(d.client_name)}`,
      emailHtml("Contribution Received", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;"><strong>${str(d.client_name)}</strong> made a contribution of <strong>${amt}</strong>.</p>
        <p style="font-size:13px;color:#374151;margin:0;">Savings Group: <strong>${str(d.group_name)}</strong></p>
      `, "#059669"));
  }

  // ── Ajo contribution overdue ────────────────────────────────────────────────
  else if (event === "ajo_contribution_overdue") {
    q(d.client_email, `Contribution Overdue — ${fmt(d.amount_due)}`,
      emailHtml("Contribution Overdue", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.client_name)}</strong>, your ${str(d.contribution_frequency)} contribution is overdue.</p>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;">Amount Due</p>
          <p style="margin:0;font-size:32px;font-weight:900;color:#92400e;">${fmt(d.amount_due)}</p>
        </div>
        <p style="font-size:13px;color:#374151;margin:0;">Please make your contribution to avoid penalties.</p>
      `, "linear-gradient(135deg,#d97706 0%,#f59e0b 100%)"));
  }

  // ── Ajo withdrawal ──────────────────────────────────────────────────────────
  else if (event === "ajo_withdrawal" || event === "ajo_withdrawal_approved") {
    const amt   = fmt(d.amount);
    const color = "#7c3aed";
    q(d.client_email, `Withdrawal ${event === "ajo_withdrawal_approved" ? "Approved" : "Processed"} — ${amt}`,
      emailHtml(`Withdrawal ${event === "ajo_withdrawal_approved" ? "Approved" : "Processed"}`, `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.client_name)}</strong>, your withdrawal of <strong>${amt}</strong> has been ${event === "ajo_withdrawal_approved" ? "approved" : "processed"}.</p>
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#7c3aed;font-weight:700;text-transform:uppercase;">Amount</p>
          <p style="margin:0;font-size:32px;font-weight:900;color:#7c3aed;">${amt}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">${now}</p>
        </div>
      `, color));
    q(d.owner_email || d.user_email, `Ajo Withdrawal — ${str(d.client_name)} · ${amt}`,
      emailHtml("Withdrawal Processed", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">A withdrawal of <strong>${amt}</strong> was processed for <strong>${str(d.client_name)}</strong>.</p>
      `, color));
  }

  // ── Ajo withdrawal rejected ─────────────────────────────────────────────────
  else if (event === "ajo_withdrawal_rejected") {
    q(d.client_email, `Withdrawal Request Declined — ${fmt(d.amount)}`,
      emailHtml("Withdrawal Declined", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.client_name)}</strong>, your withdrawal request of <strong>${fmt(d.amount)}</strong> could not be approved at this time.</p>
        ${str(d.reason) ? `<p style="font-size:13px;color:#374151;margin:0;">Reason: ${str(d.reason)}</p>` : ""}
        <p style="font-size:13px;color:#374151;margin:12px 0 0;">Please contact your savings group administrator for more information.</p>
      `, "#dc2626"));
  }

  // ── Stock entry ─────────────────────────────────────────────────────────────
  else if (event === "stock_entry") {
    q(d.owner_email || d.user_email, `Stock Entry: ${str(d.product_name)} — ${str(d.quantity)} units`,
      emailHtml("Stock Entry Recorded", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">A stock entry has been recorded.</p>
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:20px;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#0369a1;font-weight:700;text-transform:uppercase;">Product</p>
          <p style="margin:0 0 12px;font-size:20px;font-weight:800;color:#0c4a6e;">${str(d.product_name)}</p>
          <p style="margin:0 0 4px;font-size:11px;color:#0369a1;font-weight:700;text-transform:uppercase;">Quantity Added</p>
          <p style="margin:0;font-size:28px;font-weight:900;color:#0369a1;">${str(d.quantity)} units</p>
        </div>
        ${str(d.staff_name) ? `<p style="font-size:12px;color:#64748b;margin:0;">Entered by: <strong>${str(d.staff_name)}</strong></p>` : ""}
      `, "linear-gradient(135deg,#0891b2 0%,#0e7490 100%)"));
  }

  // ── Low stock alert ─────────────────────────────────────────────────────────
  else if (event === "low_stock_alert") {
    q(d.owner_email || d.user_email, `⚠️ Low Stock Alert — ${str(d.product_name)}`,
      emailHtml("Low Stock Alert", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;"><strong>${str(d.product_name)}</strong> is running low on stock.</p>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;">Current Stock</p>
          <p style="margin:0;font-size:36px;font-weight:900;color:#92400e;">${str(d.current_stock)}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Reorder Level: ${str(d.reorder_level)} units</p>
        </div>
        <p style="font-size:13px;color:#374151;margin:0;">Please restock soon to avoid running out of this item.</p>
      `, "linear-gradient(135deg,#d97706 0%,#f59e0b 100%)"));
  }

  // ── Org member first login ──────────────────────────────────────────────────
  else if (event === "org_member_first_login") {
    q(d.email || d.user_email, `Welcome to ${str(d.org_name) || "Your Organisation Portal"}!`,
      emailHtml("Welcome to Your Portal", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.name)}</strong>, welcome to the <strong>${str(d.org_name)}</strong> portal! Your account is now active.</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px 20px;margin:0 0 20px;">
          <p style="font-size:13px;color:#1e40af;margin:0;">You can now access your savings, contributions, loan records, and more through your member portal.</p>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:10px;">Go to My Portal →</a>
          </td></tr>
        </table>
      `, "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)"));
  }

  // ── Invoice sent ────────────────────────────────────────────────────────────
  else if (event === "invoice_sent") {
    q(d.customer_email, `Invoice ${str(d.invoice_number)} from ${str(d.business_name) || "KudiAI Track"}`,
      emailHtml("Invoice Received", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.customer_name)}</strong>, you have received an invoice from <strong>${str(d.business_name)}</strong>.</p>
        <div style="background:#f8fafc;border:1px solid #e4e8f0;border-radius:12px;padding:20px;margin:0 0 16px;">
          <p style="font-size:13px;color:#374151;margin:0 0 6px;">Invoice: <strong>${str(d.invoice_number)}</strong></p>
          <p style="font-size:13px;color:#374151;margin:0 0 6px;">Amount: <strong>${fmt(d.total)}</strong></p>
          ${d.due_date ? `<p style="font-size:13px;color:#374151;margin:0;">Due: <strong>${str(d.due_date)}</strong></p>` : ""}
        </div>
        <p style="font-size:13px;color:#374151;margin:0;">Please arrange payment before the due date.</p>
      `, "#4f46e5"));
    q(d.owner_email || d.user_email, `Invoice ${str(d.invoice_number)} Sent — ${str(d.customer_name)}`,
      emailHtml("Invoice Sent", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Invoice <strong>${str(d.invoice_number)}</strong> for <strong>${fmt(d.total)}</strong> has been sent to <strong>${str(d.customer_name)}</strong>.</p>
      `, "#4f46e5"));
  }

  // ── Invoice paid ────────────────────────────────────────────────────────────
  else if (event === "invoice_paid") {
    const amt = fmt(d.total || d.amount);
    q(d.customer_email, `Payment Confirmed — Invoice ${str(d.invoice_number)}`,
      emailHtml("Payment Received", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.customer_name)}</strong>, your payment for Invoice <strong>${str(d.invoice_number)}</strong> has been confirmed.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#15803d;font-weight:700;text-transform:uppercase;">Amount Paid</p>
          <p style="margin:0;font-size:32px;font-weight:900;color:#15803d;">${amt}</p>
        </div>
        <p style="font-size:13px;color:#374151;margin:0;">Thank you for your payment!</p>
      `, "#059669"));
    q(d.owner_email || d.user_email, `Invoice Paid — ${str(d.customer_name)} · ${amt}`,
      emailHtml("Invoice Paid", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;"><strong>${str(d.customer_name)}</strong> has paid Invoice <strong>${str(d.invoice_number)}</strong> — <strong>${amt}</strong>.</p>
      `, "#059669"));
  }

  // ── Invoice cancelled ───────────────────────────────────────────────────────
  else if (event === "invoice_cancelled") {
    q(d.customer_email, `Invoice ${str(d.invoice_number)} Cancelled`,
      emailHtml("Invoice Cancelled", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.customer_name)}</strong>, Invoice <strong>${str(d.invoice_number)}</strong>${str(d.business_name) ? ` from <strong>${str(d.business_name)}</strong>` : ""} has been cancelled. No payment is required.</p>
        <p style="font-size:13px;color:#374151;margin:0;">If you believe this is an error, please contact ${str(d.business_name) || "your supplier"} directly.</p>
      `, "#64748b"));
  }

  // ── Business registered (new sign-up) ───────────────────────────────────────
  else if (event === "business_registered") {
    q(d.email || d.user_email, "Welcome to KudiAI Track — Your Account is Ready!",
      emailHtml("Welcome to KudiAI Track!", `
        <p style="font-size:15px;font-weight:700;color:#0f172a;margin:0 0 8px;">You're officially on KudiAI Track! 🎉</p>
        <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px;">
          Thank you for registering your business, <strong>${str(d.name)}</strong>. Your account is fully set up and ready to go.
        </p>
        ${str(d.business_name) ? `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 18px;border-radius:0 12px 12px 0;margin:0 0 20px;"><p style="margin:0;font-size:13px;color:#166534;font-weight:700;">Business: ${str(d.business_name)}</p></div>` : ""}
        <div style="margin:0 0 22px;">
          ${["📊 Track daily cash in and cash out", "👥 Manage staff and assign roles", "💰 Run Ajo savings groups", "📦 Manage inventory in real time", "🤖 Get AI insights into your business"].map(f => `<div style="background:#f8fafc;border-left:3px solid #10b981;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px;color:#1e293b;">${f}</div>`).join("")}
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 36px;border-radius:10px;">Open My Dashboard →</a>
          </td></tr>
        </table>
      `, "linear-gradient(135deg,#059669 0%,#10b981 100%)"));
  }

  // ── Kobo welcome (free plan) ─────────────────────────────────────────────────
  else if (event === "kobo_welcome") {
    q(d.user_email, "Welcome to KudiAI Track — Free Plan Activated",
      emailHtml("Welcome to KudiAI Track!", `
        <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px;">
          Hi <strong>${str(d.user_name)}</strong>, your free account is ready. You can start tracking your business finances right away!
        </p>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 18px;margin:0 0 22px;">
          <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">💡 Upgrade your plan anytime to unlock all features.</p>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:10px;">Open KudiAI Track →</a>
          </td></tr>
        </table>
      `, "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)"));
  }

  // ── Subscription welcome (paid plan) ────────────────────────────────────────
  else if (event === "subscription_welcome") {
    q(d.user_email, `${d.is_first_time !== false ? "Welcome to" : "Subscription Confirmed:"} ${str(d.plan_name)} — KudiAI Track`,
      emailHtml(`${str(d.plan_name)} Plan Active`, `
        <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px;">
          Hi <strong>${str(d.user_name)}</strong>, your <strong>${str(d.plan_name)}</strong> subscription is now active!
        </p>
        ${str(d.business_name) ? `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:0 10px 10px 0;margin:0 0 16px;"><p style="margin:0;font-size:13px;color:#166534;">Business: <strong>${str(d.business_name)}</strong></p></div>` : ""}
        ${Number(d.plan_price) > 0 ? `<p style="font-size:13px;color:#374151;margin:0 0 16px;">Plan Price: <strong>₦${Number(d.plan_price).toLocaleString("en-NG")}/month</strong></p>` : ""}
        ${Array.isArray(d.plan_features) && d.plan_features.length > 0 ? `<p style="font-size:12px;font-weight:700;color:#0f172a;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">What's included</p><div style="margin:0 0 20px;">${d.plan_features.map(f => `<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;"><span style="background:#059669;color:#fff;font-size:10px;font-weight:900;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">✓</span><span style="font-size:13px;color:#374151;">${f}</span></div>`).join("")}</div>` : ""}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 36px;border-radius:10px;">Go to My Dashboard →</a>
          </td></tr>
        </table>
      `, "linear-gradient(135deg,#059669 0%,#10b981 100%)"));
  }

  // ── Plan purchased (admin alert) ─────────────────────────────────────────────
  else if (event === "plan_purchased") {
    // Send confirmation to the user
    q(d.user_email, `Plan Confirmed: ${str(d.plan_name)} — KudiAI Track`,
      emailHtml("Plan Purchase Confirmed", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.user_name)}</strong>, your purchase of the <strong>${str(d.plan_name)}</strong> plan has been confirmed.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#15803d;font-weight:700;text-transform:uppercase;">Plan</p>
          <p style="margin:0;font-size:28px;font-weight:900;color:#15803d;text-transform:capitalize;">${str(d.plan_name)}</p>
          ${Number(d.plan_price) > 0 ? `<p style="margin:8px 0 0;font-size:14px;color:#374151;">₦${Number(d.plan_price).toLocaleString("en-NG")}/month</p>` : ""}
        </div>
        ${str(d.reference) ? `<p style="font-size:12px;color:#64748b;margin:0;">Reference: ${str(d.reference)}</p>` : ""}
      `, "linear-gradient(135deg,#059669 0%,#10b981 100%)"));
  }

  // ── Plan upgraded ────────────────────────────────────────────────────────────
  else if (event === "plan_upgraded") {
    q(d.user_email, `Plan Upgraded to ${str(d.new_plan)} — KudiAI Track`,
      emailHtml("Plan Upgraded!", `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.user_name)}</strong>, your subscription has been upgraded.</p>
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
          ${str(d.old_plan) ? `<p style="margin:0 0 6px;font-size:13px;color:#9ca3af;text-decoration:line-through;text-transform:capitalize;">${str(d.old_plan)}</p>` : ""}
          <p style="margin:0;font-size:28px;font-weight:900;color:#7c3aed;text-transform:capitalize;">${str(d.new_plan)}</p>
          <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">All new features are now unlocked</p>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:13px;font-weight:600;text-decoration:none;padding:11px 28px;border-radius:8px;">Explore New Features →</a>
          </td></tr>
        </table>
      `, "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)"));
  }

  // ── Staff / client first login ───────────────────────────────────────────────
  else if (event === "staff_first_login" || event === "ajo_client_first_login" || event === "marketer_first_login") {
    const portalLabel = event === "staff_first_login" ? "Staff Portal" : event === "marketer_first_login" ? "Marketer Portal" : "Savings Portal";
    q(d.email || d.user_email, `Welcome to KudiAI Track — ${portalLabel}`,
      emailHtml(`Welcome to Your ${portalLabel}`, `
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Hi <strong>${str(d.name)}</strong>, your account is now fully activated. Welcome to KudiAI Track!</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin:0 0 20px;">
          <p style="font-size:13px;color:#166534;margin:0;">Your ${portalLabel} account is ready. You can now sign in with your credentials.</p>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:10px;">Sign In →</a>
          </td></tr>
        </table>
      `, "linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)"));
  }

  // ── Fallback: unknown event — still log it ───────────────────────────────────
  else {
    await logDelivery(sb, str(d.user_email || d.owner_email), `[${event}] no handler`, "failed", `No email handler for event: ${event}`);
    return res.status(200).json({ ok: true, event, queued: 0, note: "no handler for this event" });
  }

  const results = await Promise.allSettled(sends);
  const sent   = results.filter(r => r.status === "fulfilled" && r.value === true).length;
  const failed = results.filter(r => r.status === "rejected" || r.value === false).length;

  return res.status(200).json({ ok: true, event, queued: sends.length, sent, failed });
}
