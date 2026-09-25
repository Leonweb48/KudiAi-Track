import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { escapeHtml, escapeDeep, decodeEntities, cleanSubject } from "./_lib/escapeHtml.js";
import { handleMoneyEmail } from "./_lib/moneyEmails.js";
import { singleEmail, countRecipients, overQuota } from "./_lib/relayLimits.js";

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

// Plain-text alternative: some clients, screen readers and spam filters want one.
function htmlToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h1|h2|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")               // last: "&amp;lt;" must become "&lt;", not "<"
    .replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function send(transport, from, sb, to, subject, html, attachments = []) {
  // `to` and `subject` arrive HTML-escaped (they were built from the escaped
  // payload) but they are not HTML — decode them for the SMTP envelope/headers.
  const toAddr = decodeEntities(to).trim();
  const subj   = cleanSubject(subject);
  try {
    const mail = { from, to: toAddr, subject: subj, html, text: htmlToText(html) };
    if (attachments.length) mail.attachments = attachments;
    await transport.sendMail(mail);
    await logDelivery(sb, toAddr, subj, "sent");
    return true;
  } catch (e) {
    await logDelivery(sb, toAddr, subj, "failed", e.message);
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

  // Enrich with authenticated user email, then HTML-escape EVERY string in the
  // payload once, here. Nothing a user typed (names, notes, descriptions,
  // reasons…) can reach an email's HTML unescaped after this line.
  const d = escapeDeep({ owner_email: user.email || "", user_email: user.email || "", ...(rawData || {}) });

  // Per-user sending allowance — this route is callable by any logged-in user and can address third parties, so
  // without a cap a free account is a spam/phishing relay from the company domain. An outage of the counter must
  // never block real mail, so a failed lookup lets the request through.
  try {
    const { data: usageRows } = await sb.rpc("email_relay_quota", { p_user: user.id });
    const why = overQuota(Array.isArray(usageRows) ? usageRows[0] : usageRows);
    if (why) {
      await logDelivery(sb, str(user.email), `[${event}] refused`, "failed", `rate limited: ${why}`);
      return res.status(429).json({ error: "Too many emails — try again later", detail: why });
    }
  } catch { /* fail open */ }

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
  const recipients = [];   // every address this request actually queued (counted against the user's allowance below)
  // One plain address only — a comma-separated "to" would turn one counted send into many recipients.
  const queueTo = (to) => {
    const addr = singleEmail(decodeEntities(str(to)));
    if (addr) recipients.push(addr);
    return addr;
  };
  const q  = (to, subject, html)              => { const a = queueTo(to); if (a) sends.push(send(transport, from, sb, a, subject, html)); };
  const qa = (to, subject, html, attachments) => { const a = queueTo(to); if (a) sends.push(send(transport, from, sb, a, subject, html, attachments || [])); };

  // ── Cash in / Cash out ──────────────────────────────────────────────────────
  if (await handleMoneyEmail(event, { d, q, qa, sb, user, fmt })) {
    // handled by the bank-grade templates in api/_lib/moneyEmails.js
  }

  // ── Transaction failed / cancelled ──────────────────────────────────────────

  // ── Credit added ─────────────────────────────────────────────────────────────

  // ── Credit repayment / fully paid ───────────────────────────────────────────

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
      // Values read from the database are escaped here — they did not pass through escapeDeep().
      if (op) { resolvedOwnerEmail = resolvedOwnerEmail || op.email || ""; resolvedBusinessName = resolvedBusinessName || escapeHtml(op.business_name || ""); }
    }
    if (d.staff_id && !resolvedStaffName) {
      const { data: sp } = await sb.from("staff").select("name, email").eq("id", d.staff_id).maybeSingle();
      if (sp) resolvedStaffName = escapeHtml(sp.name || "");
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
      if (op2) { resolvedOwnerEmail2 = resolvedOwnerEmail2 || op2.email || ""; resolvedBizName2 = resolvedBizName2 || escapeHtml(op2.business_name || ""); }
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

  // (invoice_sent / invoice_paid / invoice_cancelled now live in api/_lib/moneyEmails.js)

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

  // ── Ajo client self-registration: owner needs to review + approve ────────────
  else if (event === "ajo_registration_pending") {
    q(d.owner_email, `New client registration — ${str(d.client_name)} is awaiting your approval`,
      emailHtml("New Client Registration", `
        <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px;">
          Hi <strong>${str(d.owner_name || d.business_name)}</strong>, <strong>${str(d.client_name)}</strong> just registered
          themselves as a savings client under your business${str(d.client_phone) ? ` (${str(d.client_phone)})` : ""}.
        </p>
        <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:14px 18px;border-radius:0 12px 12px 0;margin:0 0 20px;">
          <p style="margin:0;font-size:13px;color:#1e40af;">
            Open your Ajo dashboard to set their contribution terms and approve — they can't start saving until you do.
          </p>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 36px;border-radius:10px;">Review Registration →</a>
          </td></tr>
        </table>
      `, "linear-gradient(135deg,#2563eb 0%,#3b82f6 100%)"));
  }

  // ── Ajo client registration approved — invite them to sign in ────────────────
  else if (event === "ajo_registration_approved") {
    q(d.client_email || d.email, "You're approved! Sign in to your KudiAI savings account",
      emailHtml("Registration Approved 🎉", `
        <p style="font-size:14px;color:#374151;line-height:1.7;margin:0 0 20px;">
          Hi <strong>${str(d.client_name)}</strong>, great news — <strong>${str(d.business_name)}</strong> approved your
          savings registration. Your account is ready.
        </p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin:0 0 20px;">
          <p style="font-size:13px;color:#166534;margin:0;">Sign in with the email and password you registered with to open your savings account and wallet.</p>
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 36px;border-radius:10px;">Sign In →</a>
          </td></tr>
        </table>
      `, "linear-gradient(135deg,#059669 0%,#10b981 100%)"));
  }

  // ── Daily business summary (yesterday's revenue/profit) ─────────────────────
  // net_approx is only present when has_profit is true (enough of yesterday's
  // revenue actually had a cost price behind it to trust a profit figure) —
  // computed by the SAME profitEngine.compute() used for "Today's Profit" on
  // Home, so this number always matches what the owner sees in the app.
  else if (event === "daily_summary") {
    const netProfit = d.net_approx;
    const isLoss    = d.has_profit && netProfit != null && netProfit < 0;
    const color     = !d.has_profit ? "#4f46e5" : isLoss ? "#dc2626" : "#059669";
    const headerBg  = !d.has_profit
      ? "linear-gradient(135deg,#4f46e5 0%,#6366f1 100%)"
      : isLoss
        ? "linear-gradient(135deg,#dc2626 0%,#f87171 100%)"
        : "linear-gradient(135deg,#059669 0%,#10b981 100%)";
    const headline  = d.has_profit ? (isLoss ? "Yesterday's Deficit" : "Yesterday's Profit") : "Yesterday's Business Summary";
    const bizName   = str(d.business_name) || "your business";
    const dateLabel = str(d.period_label);

    q(d.owner_email || d.user_email, `${headline} — ${dateLabel}${d.has_profit ? ` · ${fmt(Math.abs(netProfit))}` : ""}`,
      emailHtml(headline, `
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">Here's how <strong>${bizName}</strong> did on <strong>${dateLabel}</strong>.</p>
        ${d.has_profit ? `
          <div style="background:${isLoss ? "#fef2f2" : "#f0fdf4"};border:1px solid ${isLoss ? "#fecaca" : "#bbf7d0"};border-radius:12px;padding:20px;text-align:center;margin:0 0 20px;">
            <p style="margin:0 0 4px;font-size:11px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:1px;">${isLoss ? "Net Deficit" : "Net Profit"}</p>
            <p style="margin:0;font-size:32px;font-weight:900;color:${color};">${fmt(Math.abs(netProfit))}</p>
          </div>
        ` : `
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin:0 0 20px;">
            <p style="margin:0;font-size:13px;color:#92400e;">Revenue is in, but only ${d.coverage_pct}% of yesterday's sales have a cost price set — not enough to show a reliable profit figure. Set cost prices on your products for a complete picture.</p>
          </div>
        `}
        ${detailRows([
          ["Revenue",      fmt(d.revenue)],
          ["Expenses",     fmt(d.expenses)],
          ["Transactions", d.tx_count],
        ])}
        ${d.capital_status ? `
          <div style="background:${d.capital_status === "red" ? "#fef2f2" : d.capital_status === "amber" ? "#fffbeb" : "#f0fdf4"};border:1px solid ${d.capital_status === "red" ? "#fecaca" : d.capital_status === "amber" ? "#fde68a" : "#bbf7d0"};border-radius:8px;padding:10px 14px;margin:0 0 14px;font-size:12px;color:${d.capital_status === "red" ? "#991b1b" : d.capital_status === "amber" ? "#92400e" : "#166534"};">
            ${d.capital_status === "healthy"
              ? "✓ Working capital is healthy."
              : d.capital_status === "amber"
                ? `⚠ Working capital is under pressure${d.capital_shortfall ? ` — ${fmt(d.capital_shortfall)} short` : ""}.`
                : `⚠ Working capital shortfall${d.capital_shortfall ? `: ${fmt(d.capital_shortfall)}` : ""} — review expenses.`}
          </div>
        ` : ""}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td align="center">
            <a href="https://kudiai.app" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 36px;border-radius:10px;">Open KudiAI Track →</a>
          </td></tr>
        </table>
      `, headerBg));
  }

  // ── Fallback: unknown event — still log it. (The OTP-carrying events — portal PIN reset, transaction-PIN and staff
  //    email-change codes — are NOT handled here: their codes are generated by server code, which sends them through the
  //    admin pipeline. Letting any logged-in user send a "verification code" email with a code of their choosing from
  //    this route was a phishing vector.)
  // ── Subscription payment failed ─────────────────────────────────────────────

  // ── Credit extended (more credit added to an existing debtor) ───────────────
  // Owner always gets the email; the customer only if an address is on file.

  else {
    await logDelivery(sb, str(d.user_email || d.owner_email), `[${event}] no handler`, "failed", `No email handler for event: ${event}`);
    return res.status(200).json({ ok: true, event, queued: 0, note: "no handler for this event" });
  }

  const results = await Promise.allSettled(sends);
  const sent   = results.filter(r => r.status === "fulfilled" && r.value === true).length;
  const failed = results.filter(r => r.status === "rejected" || r.value === false).length;

  // Count what this request sent against the user's allowance (awaited: Vercel freezes the function after the response).
  if (recipients.length) {
    const { total, third } = countRecipients(recipients, user.email);
    await sb.rpc("email_relay_record", { p_user: user.id, p_third: third, p_total: total }).then(() => null, () => null);
  }

  return res.status(200).json({ ok: true, event, queued: sends.length, sent, failed });
}
