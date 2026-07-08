import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── helpers ─────────────────────────────────────────────────────────────────
const str = (v) => String(v || "");
const fmt = (n) => "₦" + Number(n || 0).toLocaleString("en-NG");

function renderEmailItems(items) {
  if (!Array.isArray(items) || !items.length) return "";
  const rows = items.flatMap(item => {
    const parentRow = `<tr>
      <td style="font-size:12px;color:#374151;padding:7px 0;border-bottom:1px solid #f1f5f9;">${str(item.description)}</td>
      <td style="font-size:12px;color:#64748b;text-align:center;padding:7px 0;border-bottom:1px solid #f1f5f9;">${str(item.quantity)}</td>
      <td style="font-size:12px;font-weight:700;color:#0f172a;text-align:right;padding:7px 0;border-bottom:1px solid #f1f5f9;">${fmt(item.line_total)}</td>
    </tr>`;
    const subRows = (item.sub_items || []).map(sub => `<tr>
      <td style="font-size:11px;color:#64748b;padding:4px 0 4px 14px;border-bottom:1px solid #f8fafc;">
        <span style="color:#6d28d9;margin-right:4px;">•</span>${str(sub.description)}
      </td>
      <td style="font-size:11px;color:#94a3b8;text-align:center;padding:4px 0;border-bottom:1px solid #f8fafc;">${str(sub.quantity)}</td>
      <td style="font-size:11px;color:#94a3b8;text-align:right;padding:4px 0;border-bottom:1px solid #f8fafc;">${sub.line_total ? fmt(sub.line_total) : ""}</td>
    </tr>`);
    return [parentRow, ...subRows];
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 12px;border-collapse:collapse;">
    <thead><tr>
      <th style="text-align:left;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;padding:0 0 6px;border-bottom:1px solid #e4e8f0;">Item</th>
      <th style="text-align:center;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;padding:0 0 6px;border-bottom:1px solid #e4e8f0;">Qty</th>
      <th style="text-align:right;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;padding:0 0 6px;border-bottom:1px solid #e4e8f0;">Total</th>
    </tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

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

// ─── Comprehensive business welcome email ─────────────────────────────────────
function businessWelcomeEmailHtml(name, bizName, currentPlan = "kobo") {
  const slug = (currentPlan || "kobo").toLowerCase().replace(/\s+plan$/i, "").trim();
  const norm = { starter: "kobo", basic: "naira", professional: "naira", premium: "naira", enterprise: "oga" };
  const plan = norm[slug] || slug;

  const FEATURES = [
    ["📊", "Transaction Tracking",     "Record every naira in and out — cash, transfer, POS — in seconds. Never lose track of a payment."],
    ["💳", "Credit Management",        "Offer customer credit with confidence. Track balances, repayments, and limits per customer."],
    ["💰", "Ajo Savings Groups",       "Run organised rotating savings groups. Track contributions, manage withdrawals, build community trust."],
    ["🏦", "Organisation/Coop Portal","Set up a portal for cooperative societies. Members check balances and contributions anytime."],
    ["📦", "Inventory Management",     "Know exactly what's in stock at every moment. Get low-stock alerts before you run out."],
    ["👥", "Staff Management",         "Give staff logins with controlled access. See who recorded what and when — full accountability."],
    ["🎁", "Loyalty Program",          "Reward your best customers with points. Keep them coming back and grow lasting relationships."],
    ["🌿", "Branch Management",        "Run multiple locations from one dashboard. Compare branch performance side by side."],
    ["🤖", "KudiAI Assistant",         "Ask your business questions in plain English. Get instant answers about sales, customers, and trends."],
    ["💡", "AI Business Insights",     "Spot trends, predict busy periods, and find where money is silently leaking — automatically."],
    ["📄", "PDF Reports & Export",     "Generate professional financial reports and statements. Share with your accountant or investors instantly."],
    ["🧾", "Invoice Generation",       "Create and send professional invoices to clients directly via WhatsApp. Get paid faster."],
    ["📱", "Bill Payments",            "Pay airtime, data, electricity, and TV subscriptions for customers — all inside the app."],
    ["🔗", "API Access",               "Connect KudiAI Track to your other business tools and systems via our REST API."],
  ];

  const featureRows = [];
  for (let i = 0; i < FEATURES.length; i += 2) {
    const [ic1, t1, d1] = FEATURES[i];
    const f2 = FEATURES[i + 1];
    featureRows.push(
      `<tr>
        <td width="50%" style="padding:0 5px 10px 0;vertical-align:top;">
          <div style="background:#f8fafc;border:1px solid #e4e8f0;border-left:3px solid #10b981;border-radius:0 10px 10px 0;padding:13px 14px;">
            <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#0f172a;">${ic1} ${t1}</p>
            <p style="margin:0;font-size:11px;color:#64748b;line-height:1.5;">${d1}</p>
          </div>
        </td>
        <td width="50%" style="padding:0 0 10px 5px;vertical-align:top;">${
          f2 ? `<div style="background:#f8fafc;border:1px solid #e4e8f0;border-left:3px solid #10b981;border-radius:0 10px 10px 0;padding:13px 14px;">
            <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#0f172a;">${f2[0]} ${f2[1]}</p>
            <p style="margin:0;font-size:11px;color:#64748b;line-height:1.5;">${f2[2]}</p>
          </div>` : ""
        }</td>
      </tr>`
    );
  }

  const PLANS = [
    { slug: "kobo",  name: "Free",     price: "₦0/mo",       color: "#6b7280", bg: "#f9fafb", border: "#d1d5db",
      items: ["50 transactions/mo", "Basic dashboard", "Credit management", "1 organisation"] },
    { slug: "naira", name: "Standard", price: "₦7,000/mo",   color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe",
      items: ["Unlimited transactions", "Staff management", "Ajo savings groups", "Inventory & loyalty", "AI insights & chatbot", "Branch management", "PDF reports"] },
    { slug: "oga",   name: "Premium",  price: "₦15,000/mo",  color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe",
      items: ["Everything in Standard", "Organisation/Coop portal", "Invoice generation", "Airtime wholesale", "Business loan access", "API access", "Priority support"] },
  ];

  const planCells = PLANS.map(p => {
    const active = p.slug === plan;
    return `<td width="33%" style="padding:0 4px;vertical-align:top;">
      <div style="background:${active ? p.bg : "#fff"};border:2px solid ${active ? p.color : "#e4e8f0"};border-radius:12px;padding:14px 12px;text-align:center;">
        ${active ? `<p style="margin:0 0 6px;font-size:9px;font-weight:900;color:${p.color};text-transform:uppercase;letter-spacing:1px;">Your Plan ✓</p>` : ""}
        <p style="margin:0 0 2px;font-size:13px;font-weight:800;color:#0f172a;">${p.name}</p>
        <p style="margin:0 0 10px;font-size:14px;font-weight:900;color:${p.color};">${p.price}</p>
        ${p.items.map(f => `<p style="margin:0 0 4px;font-size:10px;color:#374151;text-align:left;line-height:1.4;">✓ ${f}</p>`).join("")}
        ${!active && p.slug !== "kobo" ? `<p style="margin:10px 0 0;font-size:9px;color:${p.color};font-weight:700;text-transform:uppercase;">Upgrade in app →</p>` : ""}
      </div>
    </td>`;
  }).join("");

  const body = `
    <!-- Greeting -->
    <p style="font-size:15px;font-weight:800;color:#0f172a;margin:0 0 6px;">Hi ${str(name) || "there"}, you're officially on KudiAI Track! 🎉</p>
    ${bizName ? `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:10px 16px;border-radius:0 10px 10px 0;margin:0 0 16px;">
      <p style="margin:0;font-size:13px;color:#166534;font-weight:700;">${str(bizName)}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#16a34a;">Registered on KudiAI Track</p>
    </div>` : ""}

    <!-- What it is -->
    <p style="font-size:13px;color:#374151;line-height:1.75;margin:0 0 24px;">
      KudiAI Track is Nigeria's most complete smart business management platform — built for growing businesses
      who want full control of their money, staff, and future. Whether you run a shop, a cooperative, a savings
      group, or a multi-branch operation, every tool you need is right here, and your AI business assistant
      is always on standby.
    </p>

    <!-- Feature grid -->
    <p style="font-size:10px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;padding:0 0 8px;border-bottom:2px solid #f1f5f9;">Everything Built Into KudiAI Track</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 26px;">${featureRows.join("")}</table>

    <!-- Plans -->
    <p style="font-size:10px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;padding:0 0 8px;border-bottom:2px solid #f1f5f9;">Choose the Plan That Fits Your Business</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px;"><tr>${planCells}</tr></table>
    <p style="font-size:10px;color:#94a3b8;text-align:center;margin:6px 0 26px;">Upgrade anytime from Settings in the app. Cancel anytime.</p>

    <!-- KudiAI Assistant -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:14px;padding:22px 22px;margin:0 0 20px;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;">🤖 KudiAI — Your Business Assistant</p>
      <p style="margin:0 0 12px;font-size:14px;font-weight:800;color:#ffffff;line-height:1.5;">Always available. Always working for you.</p>
      <p style="margin:0 0 14px;font-size:12px;color:#cbd5e1;line-height:1.7;">Ask KudiAI anything about your business — in English, Yoruba, Igbo, or Hausa. It reads your data and gives you real answers instantly. No accountant needed.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${[
          ["Which customers owe me the most?",        "#a5b4fc"],
          ["What were my best-selling days this month?","#a5b4fc"],
          ["Am I making more or less than last month?","#a5b4fc"],
          ["Which staff records the most transactions?","#a5b4fc"],
          ["Alert me when a product goes below 5 units.","#6ee7b7"],
        ].map(([q, c]) => `<tr><td style="padding:0 0 6px;font-size:12px;color:${c};">→ "${q}"</td></tr>`).join("")}
      </table>
    </div>

    <!-- Growth potential -->
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:20px 20px;margin:0 0 26px;">
      <p style="margin:0 0 14px;font-size:10px;font-weight:800;color:#9a3412;text-transform:uppercase;letter-spacing:1.5px;">📈 What KudiAI Track Does for Your Business</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${[
          ["Save 3+ hours every week",      "Stop manually summing daily sales. KudiAI Track tracks everything in real time."],
          ["Never miss a debt again",        "Credit management logs every customer who owes you — and auto-updates when they pay."],
          ["Spot where money is leaking",    "AI Insights reveal which products, customers, or hours are quietly costing you money."],
          ["Build total staff accountability","Every transaction is tied to the staff member who recorded it. No more guesswork."],
          ["Grow with confidence",           "Use real data to decide when to hire, what to restock, and when to open a new branch."],
          ["Look like a serious business",   "Send invoices and PDF reports to clients, banks, and investors. Open doors that were closed."],
        ].map(([title, desc]) => `
          <tr>
            <td style="padding:0 0 10px;vertical-align:top;">
              <div style="display:flex;gap:10px;align-items:flex-start;">
                <div style="min-width:16px;height:16px;background:#f97316;border-radius:50%;text-align:center;line-height:16px;font-size:9px;font-weight:900;color:#fff;margin-top:1px;">→</div>
                <div>
                  <p style="margin:0 0 1px;font-size:12px;font-weight:800;color:#9a3412;">${title}</p>
                  <p style="margin:0;font-size:11px;color:#78350f;line-height:1.5;">${desc}</p>
                </div>
              </div>
            </td>
          </tr>
        `).join("")}
      </table>
    </div>

    <!-- CTA -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td align="center">
        <a href="https://kudiai.app" style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:15px;font-weight:800;text-decoration:none;padding:14px 42px;border-radius:12px;letter-spacing:-0.3px;">Open My Dashboard →</a>
      </td></tr>
    </table>
    <p style="text-align:center;margin:12px 0 0;font-size:11px;color:#94a3b8;">Questions? We're at <a href="mailto:support@kudiai.app" style="color:#4f46e5;text-decoration:none;font-weight:600;">support@kudiai.app</a></p>
  `;

  return emailHtml("Welcome to KudiAI Track! 🎉", body, "linear-gradient(135deg,#059669 0%,#10b981 100%)");
}

// ─── Contact block helpers ────────────────────────────────────────────────────

function personBlock(label, name, email, phone, extra = []) {
  if (!name && !email && !phone) return "";
  const rows = [
    name  ? `<tr><td style="font-size:12px;color:#64748b;padding:2px 0;width:90px;">Name</td><td style="font-size:12px;font-weight:700;color:#0f172a;padding:2px 0;">${str(name)}</td></tr>` : "",
    phone ? `<tr><td style="font-size:12px;color:#64748b;padding:2px 0;">Phone</td><td style="font-size:12px;color:#374151;padding:2px 0;">${str(phone)}</td></tr>` : "",
    email ? `<tr><td style="font-size:12px;color:#64748b;padding:2px 0;">Email</td><td style="font-size:12px;color:#4f46e5;padding:2px 0;">${str(email)}</td></tr>` : "",
    ...extra.map(([k, v]) => v ? `<tr><td style="font-size:12px;color:#64748b;padding:2px 0;">${k}</td><td style="font-size:12px;color:#374151;padding:2px 0;">${str(v)}</td></tr>` : ""),
  ].filter(Boolean).join("");
  if (!rows) return "";
  return `
    <div style="margin:0 0 14px;">
      <p style="font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 6px;">${label}</p>
      <div style="background:#f8fafc;border:1px solid #e4e8f0;border-left:3px solid #6366f1;border-radius:0 10px 10px 0;padding:10px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
      </div>
    </div>`;
}

function detailRows(pairs) {
  const rows = pairs.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="font-size:12px;color:#64748b;padding:3px 0;width:110px;">${k}</td><td style="font-size:12px;color:#374151;font-weight:600;padding:3px 0;">${str(v)}</td></tr>`
  ).join("");
  if (!rows) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px;">${rows}</table>`;
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

async function send(transport, from, sb, to, subject, html, attachments = []) {
  try {
    const mail = { from, to, subject, html };
    if (attachments.length) mail.attachments = attachments;
    await transport.sendMail(mail);
    await logDelivery(sb, to, subject, "sent");
    return true;
  } catch (e) {
    await logDelivery(sb, to, subject, "failed", e.message);
    return false;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function handler(req, res) {
  // Capacitor webview origin is capacitor://localhost — always set CORS headers first
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  // Vercel's res object lacks Express's .set() — use setHeader for preflight too
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") return res.status(405).end();
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: "Service unavailable — env vars missing" });

  // Validate JWT
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized — no token" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) {
    // Log so it's visible in admin delivery log
    await logDelivery(sb, "auth-failure", "[email-trigger] JWT validation failed", "failed",
      authErr?.message || "getUser returned no user");
    return res.status(401).json({ error: "Unauthorized", detail: authErr?.message });
  }

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
  const q  = (to, subject, html)              => { if (to) sends.push(send(transport, from, sb, str(to), subject, html)); };
  const qa = (to, subject, html, attachments) => { if (to) sends.push(send(transport, from, sb, str(to), subject, html, attachments || [])); };

  // ── Cash in / Cash out ──────────────────────────────────────────────────────
  if (event === "transaction_credit" || event === "transaction_debit") {
    const isIn   = event === "transaction_credit";
    const amt    = fmt(d.amount);
    const color  = isIn ? "#059669" : "#dc2626";
    const bgColor = isIn ? "#f0fdf4" : "#fef2f2";
    const border  = isIn ? "#bbf7d0" : "#fecaca";
    const label   = isIn ? "Cash In" : "Cash Out";

    const pmLabel = (d.payment_method || "cash").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    q(d.user_email, `${label}: ${amt} — ${str(d.business_name) || "KudiAI Track"}`,
      emailHtml(`${label} Recorded`, `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">
          A ${label.toLowerCase()} transaction has been recorded on <strong>${str(d.business_name) || "your account"}</strong>.
        </p>
        <div style="background:${bgColor};border:1px solid ${border};border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
          <p style="margin:0 0 4px;font-size:11px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:1px;">${label}</p>
          <p style="margin:0;font-size:36px;font-weight:900;color:${color};">${amt}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">${str(d.description) || "Transaction"} · ${str(d.date) || now}</p>
        </div>
        ${detailRows([
          ["Payment Method", pmLabel],
          ["Category",       d.category],
          ["Quantity",       d.quantity],
          ["Note",          d.note],
          ["Date",          str(d.date) || now],
        ])}
        ${str(d.customer_name) ? personBlock("Customer", d.customer_name, "", "") : ""}
        ${str(d.staff_name) ? personBlock("Recorded By", d.staff_name, d.staff_email, "", [["Business", d.business_name], ["Biz Phone", d.business_phone]]) : ""}
      `, color));
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
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">A new credit record has been created on <strong>${str(d.business_name) || "your account"}</strong>.</p>
        <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
          <p style="margin:0 0 4px;font-size:11px;color:#9f1239;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Amount Owed</p>
          <p style="margin:0;font-size:32px;font-weight:900;color:#9f1239;">${amt}</p>
          ${d.due_date ? `<p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Due Date: <strong>${str(d.due_date)}</strong></p>` : ""}
        </div>
        ${personBlock("Customer / Debtor", d.customer_name, d.customer_email, d.customer_phone, [
          ["Address", d.customer_address],
          ["NIN",     d.nin],
          ["Next of Kin", d.next_of_kin],
          ["NOK Phone",   d.next_of_kin_phone],
        ])}
        ${d.notes ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin:0 0 14px;font-size:12px;color:#78350f;"><strong>Notes:</strong> ${str(d.notes)}</div>` : ""}
        ${personBlock("Recorded By", d.staff_name, "", "", [["Business", d.business_name], ["Biz Phone", d.business_phone]])}
      `, "linear-gradient(135deg,#dc2626 0%,#f87171 100%)"));

    if (d.customer_email) {
      q(d.customer_email, `Credit Notice — ${amt} recorded under your name`,
        emailHtml("Credit Recorded For You", `
          <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi <strong>${str(d.customer_name)}</strong>, a credit record of <strong>${amt}</strong> has been created for you by <strong>${str(d.business_name) || "your creditor"}</strong>. Please ensure timely repayment.</p>
          <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:20px;text-align:center;margin:0 0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:#9f1239;font-weight:700;text-transform:uppercase;">Amount Owed</p>
            <p style="margin:0;font-size:32px;font-weight:900;color:#9f1239;">${amt}</p>
          </div>
          ${detailRows([["Due Date", d.due_date]])}
          ${personBlock("Creditor Business", d.business_name, "", d.business_phone)}
          ${d.notes ? `<p style="font-size:12px;color:#374151;margin:0;">Note: ${str(d.notes)}</p>` : ""}
        `, "linear-gradient(135deg,#dc2626 0%,#f87171 100%)"));
    }
  }

  // ── Credit repayment / fully paid ───────────────────────────────────────────
  else if (event === "credit_repayment" || event === "credit_fully_paid") {
    const isFull = event === "credit_fully_paid";
    const amt    = fmt(d.amount_paid || d.amount);
    const label  = isFull ? "Credit Fully Paid!" : "Credit Repayment Received";
    const color  = isFull ? "#059669" : "#0891b2";
    const pmLabel = (d.payment_method || "cash").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    q(d.owner_email || d.user_email, `${label} — ${str(d.customer_name)}`,
      emailHtml(label, `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;"><strong>${str(d.customer_name)}</strong> made a repayment on <strong>${str(d.business_name) || "your account"}</strong>.</p>
        <div style="background:${isFull ? "#f0fdf4" : "#eff6ff"};border:1px solid ${isFull ? "#bbf7d0" : "#bfdbfe"};border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
          <p style="margin:0 0 4px;font-size:11px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:1px;">Amount Paid</p>
          <p style="margin:0;font-size:32px;font-weight:900;color:${color};">${amt}</p>
        </div>
        ${detailRows([
          ["Payment Method", pmLabel],
          ["Total Debt",     fmt(d.total_amount)],
          ["Balance Left",   isFull ? "₦0 — Fully Settled ✓" : fmt(d.outstanding)],
          ["Note",           d.notes],
          ["Date",           now],
        ])}
        ${isFull ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin:0 0 14px;font-size:13px;color:#15803d;font-weight:700;">✓ Credit fully settled. No balance remaining.</div>` : ""}
        ${personBlock("Customer", d.customer_name, d.customer_email, d.customer_phone)}
        ${personBlock("Recorded By", d.staff_name, "", "", [["Business", d.business_name], ["Biz Phone", d.business_phone]])}
      `, color));
  }

  // ── Ajo contribution ────────────────────────────────────────────────────────
  else if (event === "ajo_contribution") {
    const amt = fmt(d.amount);
    if (d.client_email) {
      q(d.client_email, `Contribution Confirmed — ${amt}`,
        emailHtml("Contribution Recorded", `
          <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi <strong>${str(d.client_name)}</strong>, your contribution to <strong>${str(d.group_name) || "your savings group"}</strong> has been recorded.</p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:11px;color:#15803d;font-weight:700;text-transform:uppercase;">Amount Contributed</p>
            <p style="margin:0;font-size:32px;font-weight:900;color:#15803d;">${amt}</p>
            ${d.reg_fee > 0 ? `<p style="margin:6px 0 0;font-size:11px;color:#6b7280;">Registration fee: ${fmt(d.reg_fee)}</p>` : ""}
          </div>
          ${detailRows([
            ["Group",         d.group_name],
            ["Balance",       fmt(d.balance)],
            ["Date",          str(d.date) || now],
          ])}
          ${personBlock("Savings Group Operator", d.business_name, "", d.business_phone)}
          ${str(d.staff_name) ? `<p style="font-size:12px;color:#64748b;margin:0;">Recorded by: <strong>${str(d.staff_name)}</strong></p>` : ""}
        `, "#059669"));
    }
    q(d.user_email, `Ajo Contribution: ${amt} — ${str(d.client_name)}`,
      emailHtml("Contribution Received", `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">A contribution of <strong>${amt}</strong> has been received on <strong>${str(d.business_name) || "your account"}</strong>.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
          <p style="margin:0;font-size:32px;font-weight:900;color:#15803d;">${amt}</p>
          ${d.reg_fee > 0 ? `<p style="margin:6px 0 0;font-size:11px;color:#6b7280;">Reg fee deducted: ${fmt(d.reg_fee)}</p>` : ""}
        </div>
        ${detailRows([
          ["Group",         d.group_name],
          ["Client Balance",fmt(d.balance)],
          ["Date",          str(d.date) || now],
        ])}
        ${personBlock("Member", d.client_name, d.client_email, d.client_phone)}
        ${personBlock("Recorded By", d.staff_name, "", "", [["Business", d.business_name]])}
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
    const isApproved = event === "ajo_withdrawal_approved";
    const netAmt  = fmt(d.net_amount || d.amount);
    const grossAmt = d.gross_amount ? fmt(d.gross_amount) : null;
    const feeAmt   = d.fee_amount   ? fmt(d.fee_amount)   : null;
    const color    = "#7c3aed";
    const clientName = str(d.client_name);
    const actionLabel = isApproved ? "Approved" : "Processed";

    if (d.client_email) {
      q(d.client_email, `Withdrawal ${actionLabel} — ${netAmt}`,
        emailHtml(`Withdrawal ${actionLabel}`, `
          <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi <strong>${clientName}</strong>, your withdrawal from <strong>${str(d.group_name) || "your savings group"}</strong> has been ${actionLabel.toLowerCase()}.</p>
          <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:11px;color:#7c3aed;font-weight:700;text-transform:uppercase;">Net Amount</p>
            <p style="margin:0;font-size:32px;font-weight:900;color:#7c3aed;">${netAmt}</p>
          </div>
          ${detailRows([
            ["Gross Amount",    grossAmt],
            ["Fee Deducted",    feeAmt],
            ["Fee Type",        d.fee_type],
            ["Balance After",   d.balance_after !== undefined ? fmt(d.balance_after) : ""],
            ["Group",           d.group_name],
            ["Date",            str(d.date) || now],
          ])}
          ${isApproved && str(d.approved_by) ? personBlock("Approved By", d.approved_by, d.owner_email, d.business_phone, [["Business", d.business_name]]) : personBlock("Business", d.business_name, "", d.business_phone)}
        `, color));
    }
    q(d.owner_email || d.user_email, `Ajo Withdrawal ${actionLabel} — ${clientName} · ${netAmt}`,
      emailHtml(`Withdrawal ${actionLabel}`, `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">A withdrawal has been ${actionLabel.toLowerCase()} on <strong>${str(d.business_name) || "your account"}</strong>.</p>
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
          <p style="margin:0;font-size:32px;font-weight:900;color:#7c3aed;">${netAmt}</p>
          ${grossAmt ? `<p style="margin:6px 0 0;font-size:11px;color:#6b7280;">Gross: ${grossAmt}${feeAmt ? ` · Fee: ${feeAmt}` : ""}</p>` : ""}
        </div>
        ${detailRows([
          ["Balance After",   d.balance_after !== undefined ? fmt(d.balance_after) : ""],
          ["Group",           d.group_name],
          ["Date",            str(d.date) || now],
        ])}
        ${personBlock("Member", d.client_name, d.client_email, d.client_phone)}
        ${isApproved && str(d.approved_by) ? personBlock("Approved By", d.approved_by, "", "") : personBlock("Processed By", d.staff_name, "", "", [["Business", d.business_name]])}
      `, color));
  }

  // ── Ajo withdrawal rejected ─────────────────────────────────────────────────
  else if (event === "ajo_withdrawal_rejected") {
    const rejAmt = fmt(d.amount);
    if (d.client_email) {
      q(d.client_email, `Withdrawal Request Declined — ${rejAmt}`,
        emailHtml("Withdrawal Declined", `
          <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi <strong>${str(d.client_name)}</strong>, your withdrawal request of <strong>${rejAmt}</strong> from <strong>${str(d.group_name) || "your savings group"}</strong> could not be approved at this time.</p>
          ${str(d.reason) ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin:0 0 14px;font-size:12px;color:#7f1d1d;"><strong>Reason:</strong> ${str(d.reason)}</div>` : ""}
          ${detailRows([["Date", str(d.date) || now]])}
          ${personBlock("Contact to Resolve", d.business_name, d.owner_email, d.business_phone)}
        `, "#dc2626"));
    }
    q(d.owner_email || d.user_email, `Withdrawal Rejected — ${str(d.client_name)} · ${rejAmt}`,
      emailHtml("Withdrawal Rejected", `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">A withdrawal request has been rejected on <strong>${str(d.business_name) || "your account"}</strong>.</p>
        ${detailRows([
          ["Amount",    rejAmt],
          ["Group",     d.group_name],
          ["Reason",    d.reason],
          ["Date",      str(d.date) || now],
        ])}
        ${personBlock("Member", d.client_name, d.client_email, d.client_phone)}
        ${str(d.rejected_by) ? personBlock("Rejected By", d.rejected_by, "", "") : ""}
      `, "#dc2626"));
  }

  // ── Stock entry ─────────────────────────────────────────────────────────────
  else if (event === "stock_entry") {
    // Resolve owner/staff info from DB if not provided in payload
    let resolvedOwnerEmail = str(d.owner_email || d.user_email);
    let resolvedBusinessName = str(d.business_name);
    let resolvedStaffName = str(d.staff_name);
    if (d.owner_id && (!resolvedOwnerEmail || !resolvedBusinessName)) {
      const { data: op } = await sb.from("profiles").select("email, business_name, phone").eq("id", d.owner_id).maybeSingle();
      if (op) { resolvedOwnerEmail = resolvedOwnerEmail || op.email || ""; resolvedBusinessName = resolvedBusinessName || op.business_name || ""; }
    }
    if (d.staff_id && !resolvedStaffName) {
      const { data: sp } = await sb.from("staff").select("name, email").eq("id", d.staff_id).maybeSingle();
      if (sp) resolvedStaffName = sp.name || "";
    }
    const entryTypeLabel = (d.entry_type || "restock") === "new_product" ? "New Product Added" : "Stock Restocked";
    if (resolvedOwnerEmail) {
      q(resolvedOwnerEmail, `Stock Entry: ${str(d.product_name)} — ${str(d.quantity)} units`,
        emailHtml("Stock Entry Recorded", `
          <p style="font-size:14px;color:#374151;margin:0 0 16px;">A stock entry has been recorded on <strong>${resolvedBusinessName || "your account"}</strong>.</p>
          <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:11px;color:#0369a1;font-weight:700;text-transform:uppercase;">${entryTypeLabel}</p>
            <p style="margin:0 0 12px;font-size:20px;font-weight:800;color:#0c4a6e;">${str(d.product_name)}</p>
            <p style="margin:0 0 4px;font-size:11px;color:#0369a1;font-weight:700;text-transform:uppercase;">Quantity</p>
            <p style="margin:0;font-size:28px;font-weight:900;color:#0369a1;">+${str(d.quantity)} units</p>
          </div>
          ${detailRows([
            ["Category",  d.category],
            ["SKU",       d.sku],
            ["Date",      now],
          ])}
          ${personBlock("Entered By", resolvedStaffName || resolvedBusinessName, "", "", [["Business", resolvedBusinessName]])}
        `, "linear-gradient(135deg,#0891b2 0%,#0e7490 100%)"));
    }
  }

  // ── Low stock alert ─────────────────────────────────────────────────────────
  else if (event === "low_stock_alert") {
    let resolvedOwnerEmail2 = str(d.owner_email || d.user_email);
    let resolvedBizName2 = str(d.business_name);
    if (d.owner_id && (!resolvedOwnerEmail2 || !resolvedBizName2)) {
      const { data: op2 } = await sb.from("profiles").select("email, business_name").eq("id", d.owner_id).maybeSingle();
      if (op2) { resolvedOwnerEmail2 = resolvedOwnerEmail2 || op2.email || ""; resolvedBizName2 = resolvedBizName2 || op2.business_name || ""; }
    }
    const curStock = d.current_stock !== undefined ? d.current_stock : (d.current_qty !== undefined ? d.current_qty : "?");
    const reorderLvl = d.reorder_level !== undefined ? d.reorder_level : (d.threshold !== undefined ? d.threshold : "?");
    if (resolvedOwnerEmail2) {
      q(resolvedOwnerEmail2, `⚠️ Low Stock Alert — ${str(d.product_name)}`,
        emailHtml("Low Stock Alert", `
          <p style="font-size:14px;color:#374151;margin:0 0 16px;"><strong>${str(d.product_name)}</strong> has fallen below the reorder level on <strong>${resolvedBizName2 || "your account"}</strong>.</p>
          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;">Current Stock</p>
            <p style="margin:0;font-size:40px;font-weight:900;color:#92400e;">${curStock}</p>
            <p style="margin:8px 0 0;font-size:13px;color:#78350f;">units remaining · Reorder level: <strong>${reorderLvl}</strong></p>
          </div>
          ${detailRows([
            ["Product",  d.product_name],
            ["Category", d.category],
            ["SKU",      d.sku],
            ["Date",     now],
          ])}
          <p style="font-size:13px;color:#92400e;font-weight:700;margin:0;">⚠ Please restock immediately to avoid running out.</p>
        `, "linear-gradient(135deg,#d97706 0%,#f59e0b 100%)"));
    }
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
    const pdfAttachments = d.pdf_base64
      ? [{ filename: str(d.pdf_filename) || "invoice.pdf", content: Buffer.from(str(d.pdf_base64), "base64"), contentType: "application/pdf" }]
      : [];

    const itemsHtml = renderEmailItems(d.items);

    const totalsHtml = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;">
        ${d.subtotal ? `<tr><td style="font-size:12px;color:#64748b;padding:3px 0;">Subtotal</td><td style="font-size:12px;color:#374151;text-align:right;padding:3px 0;">${fmt(d.subtotal)}</td></tr>` : ""}
        ${d.discount ? `<tr><td style="font-size:12px;color:#ef4444;padding:3px 0;">Discount</td><td style="font-size:12px;color:#ef4444;text-align:right;padding:3px 0;">−${fmt(d.discount)}</td></tr>` : ""}
        ${d.vat ? `<tr><td style="font-size:12px;color:#64748b;padding:3px 0;">VAT (7.5%)</td><td style="font-size:12px;color:#374151;text-align:right;padding:3px 0;">${fmt(d.vat)}</td></tr>` : ""}
        ${d.other_charges ? `<tr><td style="font-size:12px;color:#64748b;padding:3px 0;">${str(d.other_charges_label) || "Other Charges"}</td><td style="font-size:12px;color:#374151;text-align:right;padding:3px 0;">${fmt(d.other_charges)}</td></tr>` : ""}
        <tr><td colspan="2" style="padding:4px 0;"><div style="height:1px;background:#e4e8f0;"></div></td></tr>
        <tr><td style="font-size:14px;font-weight:800;color:#0f172a;padding:4px 0;">TOTAL DUE</td><td style="font-size:14px;font-weight:800;color:#4f46e5;text-align:right;padding:4px 0;">${fmt(d.total)}</td></tr>
      </table>`;

    qa(d.customer_email, `Invoice ${str(d.invoice_number)} from ${str(d.business_name) || "KudiAI Track"}`,
      emailHtml("Invoice Received", `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi <strong>${str(d.customer_name)}</strong>, you have received an invoice from <strong>${str(d.business_name)}</strong>.</p>
        <div style="background:#f8fafc;border:1px solid #e4e8f0;border-radius:12px;padding:16px 20px;margin:0 0 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td style="font-size:12px;color:#64748b;padding:2px 0;">Invoice No.</td><td style="font-size:12px;font-weight:700;color:#0f172a;text-align:right;padding:2px 0;">${str(d.invoice_number)}</td></tr>
            ${d.issue_date ? `<tr><td style="font-size:12px;color:#64748b;padding:2px 0;">Issue Date</td><td style="font-size:12px;color:#374151;text-align:right;padding:2px 0;">${str(d.issue_date)}</td></tr>` : ""}
            ${d.due_date ? `<tr><td style="font-size:12px;color:#64748b;padding:2px 0;">Due Date</td><td style="font-size:12px;font-weight:700;color:#dc2626;text-align:right;padding:2px 0;">${str(d.due_date)}</td></tr>` : ""}
          </table>
        </div>
        ${itemsHtml}
        ${totalsHtml}
        <p style="font-size:12px;color:#64748b;margin:0;">Please arrange payment before the due date. Contact <strong>${str(d.business_name)}</strong> if you have any questions.</p>
      `, "#4f46e5"), pdfAttachments);

    q(d.owner_email || d.user_email, `Invoice ${str(d.invoice_number)} Sent — ${str(d.customer_name)}`,
      emailHtml("Invoice Sent", `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">Invoice <strong>${str(d.invoice_number)}</strong> for <strong>${fmt(d.total)}</strong> has been sent to <strong>${str(d.customer_name)}</strong>.</p>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;margin:0 0 12px;font-size:13px;color:#1e40af;">
          ${d.customer_email ? `📧 ${str(d.customer_email)}` : ""}${d.customer_phone ? ` &nbsp;·&nbsp; 📞 ${str(d.customer_phone)}` : ""}
        </div>
        ${totalsHtml}
      `, "#4f46e5"));
  }

  // ── Invoice paid ────────────────────────────────────────────────────────────
  else if (event === "invoice_paid") {
    const pdfAttachments = d.pdf_base64
      ? [{ filename: str(d.pdf_filename) || "invoice.pdf", content: Buffer.from(str(d.pdf_base64), "base64"), contentType: "application/pdf" }]
      : [];

    const amtPaid    = fmt(d.amount_paid || d.total);
    const balanceDue = Number(d.balance_due || 0);

    const itemsHtml2 = renderEmailItems(d.items);

    qa(d.customer_email, `Payment Confirmed — Invoice ${str(d.invoice_number)}`,
      emailHtml("Payment Received", `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">Hi <strong>${str(d.customer_name)}</strong>, your payment for Invoice <strong>${str(d.invoice_number)}</strong> has been received.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
          <p style="margin:0 0 4px;font-size:11px;color:#15803d;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Amount Paid</p>
          <p style="margin:0;font-size:32px;font-weight:900;color:#15803d;">${amtPaid}</p>
          ${str(d.payment_method) ? `<p style="margin:6px 0 0;font-size:12px;color:#166534;text-transform:capitalize;">${str(d.payment_method).replace(/_/g," ")}</p>` : ""}
        </div>
        ${balanceDue > 0
          ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin:0 0 16px;font-size:13px;color:#92400e;font-weight:700;">Balance still due: ${fmt(balanceDue)}</div>`
          : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin:0 0 16px;font-size:13px;color:#15803d;font-weight:700;">✓ Invoice fully paid — thank you!</div>`
        }
        ${itemsHtml2}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 12px;">
          ${d.subtotal ? `<tr><td style="font-size:12px;color:#64748b;padding:3px 0;">Subtotal</td><td style="font-size:12px;color:#374151;text-align:right;padding:3px 0;">${fmt(d.subtotal)}</td></tr>` : ""}
          ${d.discount ? `<tr><td style="font-size:12px;color:#ef4444;padding:3px 0;">Discount</td><td style="font-size:12px;color:#ef4444;text-align:right;padding:3px 0;">−${fmt(d.discount)}</td></tr>` : ""}
          ${d.vat ? `<tr><td style="font-size:12px;color:#64748b;padding:3px 0;">VAT (7.5%)</td><td style="font-size:12px;color:#374151;text-align:right;padding:3px 0;">${fmt(d.vat)}</td></tr>` : ""}
          ${d.other_charges ? `<tr><td style="font-size:12px;color:#64748b;padding:3px 0;">${str(d.other_charges_label) || "Other Charges"}</td><td style="font-size:12px;color:#374151;text-align:right;padding:3px 0;">${fmt(d.other_charges)}</td></tr>` : ""}
          <tr><td colspan="2" style="padding:4px 0;"><div style="height:1px;background:#e4e8f0;"></div></td></tr>
          <tr><td style="font-size:13px;font-weight:700;color:#0f172a;padding:4px 0;">Invoice Total</td><td style="font-size:13px;font-weight:700;color:#0f172a;text-align:right;padding:4px 0;">${fmt(d.total)}</td></tr>
        </table>
      `, "#059669"), pdfAttachments);

    q(d.owner_email || d.user_email, `Invoice Paid — ${str(d.customer_name)} · ${amtPaid}`,
      emailHtml("Invoice Paid", `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;"><strong>${str(d.customer_name)}</strong> has paid Invoice <strong>${str(d.invoice_number)}</strong>.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin:0 0 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td style="font-size:12px;color:#64748b;padding:2px 0;">Amount Paid</td><td style="font-size:13px;font-weight:800;color:#15803d;text-align:right;padding:2px 0;">${amtPaid}</td></tr>
            ${str(d.payment_method) ? `<tr><td style="font-size:12px;color:#64748b;padding:2px 0;">Method</td><td style="font-size:12px;color:#374151;text-align:right;padding:2px 0;text-transform:capitalize;">${str(d.payment_method).replace(/_/g," ")}</td></tr>` : ""}
            <tr><td style="font-size:12px;color:#64748b;padding:2px 0;">Invoice Total</td><td style="font-size:12px;color:#374151;text-align:right;padding:2px 0;">${fmt(d.total)}</td></tr>
            ${balanceDue > 0 ? `<tr><td style="font-size:12px;color:#92400e;font-weight:700;padding:2px 0;">Balance Due</td><td style="font-size:12px;color:#92400e;font-weight:700;text-align:right;padding:2px 0;">${fmt(balanceDue)}</td></tr>` : ""}
          </table>
        </div>
        ${balanceDue <= 0 ? `<p style="font-size:13px;color:#15803d;font-weight:700;margin:0;">✓ Fully paid</p>` : `<p style="font-size:13px;color:#92400e;margin:0;">Balance of <strong>${fmt(balanceDue)}</strong> is still outstanding.</p>`}
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

  // ── Business welcome (all new registrations) ─────────────────────────────────
  else if (event === "business_welcome" || event === "kobo_welcome") {
    q(d.user_email, "Welcome to KudiAI Track — Your Smart Business Command Centre",
      businessWelcomeEmailHtml(d.user_name, d.business_name, d.current_plan || "kobo"));
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
