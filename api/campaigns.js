// Server-side campaign fetch — evaluates targeting, enforces frequency caps
// Never ships raw campaign list to client; only returns what this user should see.
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL      = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CACHE_TTL_SECONDS = 30;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Evaluate a single campaign's targeting JSONB against the user context
function matchesTargeting(targeting, ctx) {
  const { plans, roles, platforms, segments } = targeting;
  if (plans?.length     && !plans.includes(ctx.plan))      return false;
  if (roles?.length     && !roles.includes(ctx.role))      return false;
  if (platforms?.length && !platforms.includes(ctx.platform)) return false;
  if (segments?.length) {
    for (const seg of segments) {
      if (seg === "inactive_14d"   && !ctx.inactive14d)    return false;
      if (seg === "at_plan_limit"  && !ctx.atPlanLimit)    return false;
      if (seg === "new_7d"         && !ctx.newUser7d)      return false;
    }
  }
  return true;
}

async function getUserContext(sb, userId, platform) {
  // Fetch profile + recent txns in parallel
  const [profileRes, txnRes] = await Promise.all([
    sb.from("profiles").select("role, plan, created_at").eq("id", userId).single(),
    sb.from("transactions").select("id, transaction_date")
      .eq("user_id", userId)
      .order("transaction_date", { ascending: false })
      .limit(1),
  ]);

  const profile     = profileRes.data;
  const lastTxDate  = txnRes.data?.[0]?.transaction_date;
  const createdAt   = profile?.created_at ? new Date(profile.created_at) : new Date();
  const now         = new Date();
  const daysSinceSignup = (now - createdAt) / 86400000;
  const daysSinceLastTxn = lastTxDate
    ? (now - new Date(lastTxDate)) / 86400000
    : 999;

  return {
    plan:        profile?.plan        || "starter",
    role:        profile?.role        || "owner",
    platform:    platform             || "web",
    inactive14d: daysSinceLastTxn > 14,
    atPlanLimit: false, // extend with plan-limit check if needed
    newUser7d:   daysSinceSignup < 7,
  };
}

async function getPopupCapStatus(sb, userId, campaignIds) {
  if (!campaignIds.length) return {};
  const { data } = await sb
    .from("ad_popup_views")
    .select("campaign_id, shown_count, last_shown_at")
    .eq("user_id", userId)
    .in("campaign_id", campaignIds);

  const map = {};
  for (const row of data || []) map[row.campaign_id] = row;
  return map;
}

function popupAllowed(campaign, viewMap) {
  const view = viewMap[campaign.id];
  if (!view) return true;
  const cap  = campaign.frequency_cap;
  if (cap === "once_ever" || cap === "once_per_campaign") return false;
  if (cap === "once_per_day") {
    const lastDate = new Date(view.last_shown_at).toDateString();
    return lastDate !== new Date().toDateString();
  }
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth: verify Supabase JWT
  const authHeader = req.headers.authorization || "";
  const jwt        = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return res.status(401).json({ error: "Unauthorized" });

  const sb = adminClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: "Unauthorized" });

  // POST /api/campaigns — record an event
  if (req.method === "POST") {
    const { campaign_id, event_type, platform } = req.body || {};
    if (!campaign_id || !event_type) return res.status(400).json({ error: "Missing fields" });

    // Upsert popup view for impression events
    if (event_type === "impression") {
      await sb.rpc("upsert_popup_view", { p_campaign_id: campaign_id, p_user_id: user.id })
        .catch(() => {}); // best-effort
    }

    await sb.from("ad_campaign_events").insert({
      campaign_id,
      user_id: user.id,
      event_type,
      platform: platform || "web",
    });

    return res.status(200).json({ ok: true });
  }

  // GET /api/campaigns?platform=apk&slots=home_banner,popup
  const platform   = req.query.platform || "web";
  const slotsParam = req.query.slots    || "";
  const wantSlots  = slotsParam ? slotsParam.split(",") : null;

  const now = new Date().toISOString();

  // Fetch all live/scheduled campaigns (server evaluates, never ships all to client)
  let query = sb
    .from("ad_campaigns")
    .select("*")
    .eq("status", "live")
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("priority", { ascending: false });

  if (wantSlots?.length) query = query.in("slot", wantSlots);

  const { data: allLive, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Get user context for targeting
  const ctx = await getUserContext(sb, user.id, platform);

  // Filter by targeting
  const matched = (allLive || []).filter(c => matchesTargeting(c.targeting || {}, ctx));

  // For popups, apply server-side frequency caps
  const popupIds     = matched.filter(c => c.slot === "popup").map(c => c.id);
  const popupViewMap = await getPopupCapStatus(sb, user.id, popupIds);
  const allowed      = matched.filter(c => c.slot !== "popup" || popupAllowed(c, popupViewMap));

  // Group by slot, enforce density rules
  const bySlot = {};
  for (const c of allowed) {
    if (!bySlot[c.slot]) bySlot[c.slot] = [];
    // home_banner: max 5 in carousel; popup: max 1; announcement_bar: max 1; feed_card: max 1
    const limits = { home_banner: 5, popup: 1, announcement_bar: 1, feed_card: 1, upsell_inline: 3 };
    if (bySlot[c.slot].length < (limits[c.slot] ?? 5)) {
      bySlot[c.slot].push(c);
    }
  }

  res.setHeader("Cache-Control", `private, max-age=${CACHE_TTL_SECONDS}`);
  return res.status(200).json({ slots: bySlot, ctx: { plan: ctx.plan, role: ctx.role } });
};
