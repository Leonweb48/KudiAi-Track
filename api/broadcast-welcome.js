// One-shot broadcast: sends the comprehensive KudiAI Track welcome email to all
// existing business users. Protected by x-trigger-secret (SERVICE_ROLE_KEY).
// Supports pagination via ?offset=0&limit=200 query params.
// Trigger:
//   curl -X POST https://kudiai.app/api/broadcast-welcome \
//        -H "x-trigger-secret: <SUPABASE_SERVICE_ROLE_KEY>" \
//        -H "Content-Type: application/json" -d "{}"
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const SUPABASE_URL  = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TRIGGER_EMAIL = process.env.EMAIL_TRIGGER_SECRET;

const str = (v) => String(v || "");

// ── Inline email template (mirrors api/email-trigger.js) ──────────────────────
function emailHtml(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f4f8;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">
  <tr><td style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);border-radius:16px 16px 0 0;padding:36px 36px 32px;text-align:center;">
    <img src="https://kudiai.app/logo.png" alt="KudiAI Track" width="56" height="56" style="display:block;margin:0 auto 14px;border-radius:13px;border:2px solid rgba(255,255,255,0.3);">
    <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">${title}</h1>
  </td></tr>
  <tr><td style="background:#ffffff;padding:32px 36px;border-left:1px solid #e4e8f0;border-right:1px solid #e4e8f0;">${body}</td></tr>
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

function businessWelcomeEmailHtml(name, bizName, currentPlan = "kobo") {
  const slug = (currentPlan || "kobo").toLowerCase().replace(/\s+plan$/i, "").trim();
  const norm = { starter: "kobo", basic: "naira", professional: "naira", premium: "naira", enterprise: "oga" };
  const plan = norm[slug] || slug;

  const FEATURES = [
    ["📊", "Transaction Tracking",      "Record every naira in and out — cash, transfer, POS — in seconds. Never lose track of a payment."],
    ["💳", "Credit Management",         "Offer customer credit with confidence. Track balances, repayments, and limits per customer."],
    ["💰", "Ajo Savings Groups",        "Run organised rotating savings groups. Track contributions, manage withdrawals, build community trust."],
    ["🏦", "Organisation/Coop Portal", "Set up a portal for cooperative societies. Members check balances and contributions anytime."],
    ["📦", "Inventory Management",      "Know exactly what's in stock at every moment. Get low-stock alerts before you run out."],
    ["👥", "Staff Management",          "Give staff logins with controlled access. See who recorded what and when — full accountability."],
    ["🎁", "Loyalty Program",           "Reward your best customers with points. Keep them coming back and grow lasting relationships."],
    ["🌿", "Branch Management",         "Run multiple locations from one dashboard. Compare branch performance side by side."],
    ["🤖", "KudiAI Assistant",          "Ask your business questions in plain English. Get instant answers about sales, customers, and trends."],
    ["💡", "AI Business Insights",      "Spot trends, predict busy periods, and find where money is silently leaking — automatically."],
    ["📄", "PDF Reports & Export",      "Generate professional financial reports and statements. Share with your accountant or investors instantly."],
    ["🧾", "Invoice Generation",        "Create and send professional invoices to clients directly via WhatsApp. Get paid faster."],
    ["📱", "Bill Payments",             "Pay airtime, data, electricity, and TV subscriptions for customers — all inside the app."],
    ["🔗", "API Access",                "Connect KudiAI Track to your other business tools and systems via our REST API."],
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
    { slug: "kobo",  name: "Free",     price: "₦0/mo",      color: "#6b7280", bg: "#f9fafb", items: ["50 transactions/mo", "Basic dashboard", "Credit management", "1 organisation"] },
    { slug: "naira", name: "Standard", price: "₦7,000/mo",  color: "#2563eb", bg: "#eff6ff", items: ["Unlimited transactions", "Staff management", "Ajo savings groups", "Inventory & loyalty", "AI insights & chatbot", "Branch management", "PDF reports"] },
    { slug: "oga",   name: "Premium",  price: "₦15,000/mo", color: "#7c3aed", bg: "#f5f3ff", items: ["Everything in Standard", "Organisation/Coop portal", "Invoice generation", "Airtime wholesale", "Business loan access", "API access", "Priority support"] },
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

  return emailHtml("Welcome to KudiAI Track! 🎉", `
    <p style="font-size:15px;font-weight:800;color:#0f172a;margin:0 0 6px;">Hi ${str(name) || "there"}, you're officially on KudiAI Track! 🎉</p>
    ${bizName ? `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:10px 16px;border-radius:0 10px 10px 0;margin:0 0 16px;">
      <p style="margin:0;font-size:13px;color:#166534;font-weight:700;">${str(bizName)}</p>
      <p style="margin:2px 0 0;font-size:11px;color:#16a34a;">Registered on KudiAI Track</p>
    </div>` : ""}
    <p style="font-size:13px;color:#374151;line-height:1.75;margin:0 0 24px;">KudiAI Track is Nigeria's most complete smart business management platform — built for growing businesses who want full control of their money, staff, and future. Whether you run a shop, a cooperative, a savings group, or a multi-branch operation, every tool you need is right here, and your AI business assistant is always on standby.</p>

    <p style="font-size:10px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;padding:0 0 8px;border-bottom:2px solid #f1f5f9;">Everything Built Into KudiAI Track</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 26px;">${featureRows.join("")}</table>

    <p style="font-size:10px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;padding:0 0 8px;border-bottom:2px solid #f1f5f9;">Choose the Plan That Fits Your Business</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px;"><tr>${planCells}</tr></table>
    <p style="font-size:10px;color:#94a3b8;text-align:center;margin:6px 0 26px;">Upgrade anytime from Settings in the app. Cancel anytime.</p>

    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:14px;padding:22px;margin:0 0 20px;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;">🤖 KudiAI — Your Business Assistant</p>
      <p style="margin:0 0 12px;font-size:14px;font-weight:800;color:#ffffff;line-height:1.5;">Always available. Always working for you.</p>
      <p style="margin:0 0 12px;font-size:12px;color:#cbd5e1;line-height:1.7;">Ask KudiAI anything about your business — in English, Yoruba, Igbo, or Hausa. It reads your data and gives you real answers instantly. No accountant needed.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${[
          ["Which customers owe me the most?",         "#a5b4fc"],
          ["What were my best-selling days this month?","#a5b4fc"],
          ["Am I making more or less than last month?", "#a5b4fc"],
          ["Which staff records the most transactions?","#a5b4fc"],
          ["Alert me when a product goes below 5 units.","#6ee7b7"],
        ].map(([q, c]) => `<tr><td style="padding:0 0 5px;font-size:12px;color:${c};">→ "${q}"</td></tr>`).join("")}
      </table>
    </div>

    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:20px;margin:0 0 26px;">
      <p style="margin:0 0 14px;font-size:10px;font-weight:800;color:#9a3412;text-transform:uppercase;letter-spacing:1.5px;">📈 What KudiAI Track Does for Your Business</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${[
          ["Save 3+ hours every week",       "Stop manually summing daily sales. KudiAI Track tracks everything in real time."],
          ["Never miss a debt again",         "Credit management logs every customer who owes you — and auto-updates when they pay."],
          ["Spot where money is leaking",     "AI Insights reveal which products, customers, or hours are quietly costing you money."],
          ["Build total staff accountability","Every transaction is tied to the staff member who recorded it. No more guesswork."],
          ["Grow with confidence",            "Use real data to decide when to hire, what to restock, and when to open a new branch."],
          ["Look like a serious business",    "Send invoices and PDF reports to clients, banks, and investors. Open doors that were closed."],
        ].map(([title, desc]) => `<tr><td style="padding:0 0 10px;vertical-align:top;">
          <p style="margin:0 0 1px;font-size:12px;font-weight:800;color:#9a3412;">→ ${title}</p>
          <p style="margin:0;font-size:11px;color:#78350f;line-height:1.5;">${desc}</p>
        </td></tr>`).join("")}
      </table>
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td align="center">
        <a href="https://kudiai.app" style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:15px;font-weight:800;text-decoration:none;padding:14px 42px;border-radius:12px;">Open My Dashboard →</a>
      </td></tr>
    </table>
    <p style="text-align:center;margin:12px 0 0;font-size:11px;color:#94a3b8;">Questions? We're at <a href="mailto:support@kudiai.app" style="color:#4f46e5;text-decoration:none;font-weight:600;">support@kudiai.app</a></p>
  `);
}

// ── SMTP helpers ───────────────────────────────────────────────────────────────
async function getSmtpConfig(sb) {
  const { data } = await sb.from("smtp_config").select("*").limit(1).maybeSingle();
  return data;
}

function makeTransporter(cfg) {
  return nodemailer.createTransport({
    host: cfg.host, port: Number(cfg.port) || 587,
    secure: cfg.encryption === "ssl",
    auth: { user: cfg.username, pass: cfg.password },
    tls: { rejectUnauthorized: cfg.encryption !== "none" },
  });
}

async function sendOne(transport, from, sb, to, subject, html) {
  try {
    await transport.sendMail({ from, to, subject, html });
    await sb.from("email_delivery_log").insert({ to_email: to, subject, status: "sent", smtp_host: "kudiai-app-broadcast" }).catch(() => {});
    return { ok: true };
  } catch (e) {
    await sb.from("email_delivery_log").insert({ to_email: to, subject, status: "failed", error_msg: e.message, smtp_host: "kudiai-app-broadcast" }).catch(() => {});
    return { ok: false, error: e.message };
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "https://kudiai.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-trigger-secret",
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).set(CORS).end();
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== "POST") return res.status(405).end();

  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: "env vars missing" });

  const secret = req.headers["x-trigger-secret"];
  const validSecrets = [SERVICE_KEY, TRIGGER_EMAIL].filter(Boolean);
  if (!secret || !validSecrets.includes(secret)) return res.status(401).json({ error: "Unauthorized" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit  = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

  // Fetch profiles with current plan (LEFT JOIN subscriptions)
  const { data: profiles, error: profErr } = await sb
    .from("profiles")
    .select("id, full_name, business_name, email")
    .not("email", "is", null)
    .neq("email", "")
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (profErr) return res.status(500).json({ error: profErr.message });
  if (!profiles?.length) return res.status(200).json({ ok: true, sent: 0, failed: 0, total: 0, note: "no users found" });

  // Fetch active subscriptions for these users in one query
  const ids = profiles.map(p => p.id);
  const { data: subs } = await sb
    .from("subscriptions")
    .select("user_id, plan")
    .in("user_id", ids)
    .eq("status", "active");
  const subMap = {};
  (subs || []).forEach(s => { subMap[s.user_id] = s.plan; });

  const smtp = await getSmtpConfig(sb);
  if (!smtp?.host) return res.status(500).json({ error: "SMTP not configured" });

  const transport = makeTransporter(smtp);
  const fromAddr  = `"${smtp.from_name || "KudiAI Track"}" <${smtp.from_email || smtp.username}>`;
  const subject   = "Welcome to KudiAI Track — Your Smart Business Command Centre";

  let sent = 0, failed = 0;
  // Send in batches of 5 to avoid SMTP rate limits
  const BATCH = 5;
  for (let i = 0; i < profiles.length; i += BATCH) {
    const batch = profiles.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(p => sendOne(transport, fromAddr, sb, p.email,
        subject,
        businessWelcomeEmailHtml(p.full_name, p.business_name, subMap[p.id] || "kobo")
      ))
    );
    results.forEach(r => {
      if (r.status === "fulfilled" && r.value?.ok) sent++;
      else failed++;
    });
    // Small pause between batches
    if (i + BATCH < profiles.length) await new Promise(r => setTimeout(r, 300));
  }

  return res.status(200).json({ ok: true, total: profiles.length, sent, failed, offset, limit });
}
