const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL     = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function matchesTargeting(targeting, ctx) {
  if (!targeting || typeof targeting !== "object") return true;
  const { plans, roles, platforms, segments } = targeting;
  if (plans?.length     && !plans.includes(ctx.plan))         return false;
  if (roles?.length     && !roles.includes(ctx.role))         return false;
  if (platforms?.length && !platforms.includes(ctx.platform)) return false;
  if (segments?.length) {
    for (const seg of segments) {
      if (seg === "inactive_14d"  && !ctx.inactive14d)  return false;
      if (seg === "at_plan_limit" && !ctx.atPlanLimit)  return false;
      if (seg === "new_7d"        && !ctx.newUser7d)    return false;
    }
  }
  return true;
}

function isWithinSchedule(campaign) {
  const now = new Date();
  if (campaign.starts_at && new Date(campaign.starts_at) > now) return false;
  if (campaign.ends_at   && new Date(campaign.ends_at)   < now) return false;
  return true;
}

async function getUserContext(sb, userId, platform) {
  try {
    const [profileRes, txnRes] = await Promise.all([
      sb.from("profiles").select("role, plan, subscription_plan, created_at").eq("id", userId).single(),
      sb.from("transactions").select("id, transaction_date")
        .eq("user_id", userId).order("transaction_date", { ascending: false }).limit(1),
    ]);

    const profile    = profileRes.data || {};
    // Support both `plan` and `subscription_plan` column names
    const plan       = profile.plan || profile.subscription_plan || "starter";
    const lastTxDate = txnRes.data?.[0]?.transaction_date;
    const createdAt  = profile.created_at ? new Date(profile.created_at) : new Date();
    const now        = new Date();
    const daysSinceSignup  = (now - createdAt) / 86400000;
    const daysSinceLastTxn = lastTxDate ? (now - new Date(lastTxDate)) / 86400000 : 999;

    return {
      plan:        plan,
      role:        profile.role || "owner",
      platform:    platform || "web",
      inactive14d: daysSinceLastTxn > 14,
      atPlanLimit: false,
      newUser7d:   daysSinceSignup < 7,
    };
  } catch {
    return { plan: "starter", role: "owner", platform: platform || "web", inactive14d: false, atPlanLimit: false, newUser7d: false };
  }
}

async function getPopupCapStatus(sb, userId, campaignIds) {
  if (!campaignIds.length) return {};
  try {
    const { data } = await sb
      .from("ad_popup_views")
      .select("campaign_id, shown_count, last_shown_at")
      .eq("user_id", userId)
      .in("campaign_id", campaignIds);
    const map = {};
    for (const row of data || []) map[row.campaign_id] = row;
    return map;
  } catch { return {}; }
}

function popupAllowed(campaign, viewMap) {
  const view = viewMap[campaign.id];
  if (!view) return true;
  const cap = campaign.frequency_cap;
  if (cap === "once_ever" || cap === "once_per_campaign") return false;
  if (cap === "once_per_day") {
    return new Date(view.last_shown_at).toDateString() !== new Date().toDateString();
  }
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return res.status(401).json({ error: "Unauthorized" });

  const sb = adminClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: "Unauthorized" });

  // POST — record an event (best-effort, never block the response)
  if (req.method === "POST") {
    const { campaign_id, event_type, platform } = req.body || {};
    if (!campaign_id || !event_type) return res.status(400).json({ error: "Missing fields" });
    try {
      await sb.from("ad_campaign_events").insert({ campaign_id, user_id: user.id, event_type, platform: platform || "web" });
    } catch {}
    return res.status(200).json({ ok: true });
  }

  // GET — return targeted campaigns for this user
  const platform   = req.query.platform || "web";
  const slotsParam = req.query.slots    || "";
  const wantSlots  = slotsParam ? slotsParam.split(",") : null;

  // Fetch all active campaigns — date filtering done in JS to avoid PostgREST .or() issues
  let query = sb
    .from("ad_campaigns")
    .select("*")
    .in("status", ["live", "active"])
    .order("priority", { ascending: false });

  if (wantSlots?.length) query = query.in("slot", wantSlots);

  const { data: allActive, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Filter by schedule (starts_at / ends_at) in JS
  const timely = (allActive || []).filter(isWithinSchedule);

  // Get user context and filter by targeting
  const ctx     = await getUserContext(sb, user.id, platform);
  const matched = timely.filter(c => matchesTargeting(c.targeting, ctx));

  // Popup frequency caps
  const popupIds     = matched.filter(c => c.slot === "popup").map(c => c.id);
  const popupViewMap = await getPopupCapStatus(sb, user.id, popupIds);
  const allowed      = matched.filter(c => c.slot !== "popup" || popupAllowed(c, popupViewMap));

  // Group by slot with density limits
  const limits  = { home_banner: 5, popup: 1, announcement_bar: 1, feed_card: 1, upsell_inline: 3 };
  const bySlot  = {};
  for (const c of allowed) {
    if (!bySlot[c.slot]) bySlot[c.slot] = [];
    if (bySlot[c.slot].length < (limits[c.slot] ?? 5)) bySlot[c.slot].push(c);
  }

  res.setHeader("Cache-Control", "private, max-age=30");
  return res.status(200).json({ slots: bySlot, ctx: { plan: ctx.plan, role: ctx.role } });
};
