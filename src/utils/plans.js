// ── Subscription plan system ──────────────────────────────────────────────────
// Single source of truth: DB subscription_plans table.
// Falls back to hardcoded defaults if the DB is unreachable.
// canDo() / planLimits() / featureLimit() are synchronous; call
// fetchAndCachePlans() once on app boot to warm the cache.

// ── Standard feature keys ─────────────────────────────────────────────────────
export const FEATURE_KEYS = {
  credit:          "Credit Management",
  aso:             "Ajo/Savings Groups",
  pdfExport:       "PDF Reports & Export",
  staffManagement: "Staff Management",
  inventory:       "Inventory Management",
  loyalty:         "Loyalty Program",
  aiInsights:      "AI Business Insights",
  aiChatbot:       "AI Chatbot",
  branches:        "Branch Management",
  organisation:    "Organisation / Coop",
  invoices:        "Invoice Generation",
  apiAccess:       "API Access",
  loanAccess:      "Business Loan Access",
  printWholesale:  "Print Wholesale (Airtime & Data)",
  prioritySupport: "Priority Support",
};

// Features that have a numeric cap (stored in feature_limits JSONB column)
// 999999 in DB = unlimited; Infinity returned by featureLimit()
export const COUNTABLE_FEATURES = {
  aso:             "Max Ajo Groups",
  staffManagement: "Max Staff Members",
  branches:        "Max Branches",
  organisation:    "Max Organisations",
  inventory:       "Max Inventory Items",
  loyalty:         "Max Loyalty Members",
};

// Full ordered list for upgrade-screen "missing features" display
export const ALL_FEATURE_LIST = [
  { key: "credit",          label: "Credit management" },
  { key: "aso",             label: "Ajo savings management" },
  { key: "pdfExport",       label: "PDF export & reports" },
  { key: "staffManagement", label: "Staff management" },
  { key: "inventory",       label: "Inventory tracking" },
  { key: "loyalty",         label: "Loyalty program" },
  { key: "aiInsights",      label: "AI business insights" },
  { key: "aiChatbot",       label: "AI chatbot" },
  { key: "branches",        label: "Branch management" },
  { key: "organisation",    label: "Organisation / Coop" },
  { key: "invoices",        label: "Invoice generation" },
  { key: "apiAccess",       label: "API access" },
  { key: "loanAccess",      label: "Business loan access" },
  { key: "printWholesale",  label: "Print recharge & data wholesale" },
  { key: "prioritySupport", label: "Priority support" },
];

// ── Fallback hardcoded plans (shown only when DB is unreachable) ───────────────
const FALLBACK_PLANS = {
  kobo: {
    id: "fallback-kobo", name: "Free", slug: "kobo",
    description: "Free forever — get started at your own pace",
    price_monthly: 0, price_yearly: 0, sort_order: 0,
    max_transactions: 50, max_organizations: 1, max_org_members: 5, max_ajo_groups: 1,
    feature_keys: ["credit"],
    feature_limits: { staffManagement: 3, inventory: 50, loyalty: 100 },
    features: ["Basic dashboard", "1 organisation", "5 team members", "50 transactions/month"],
    is_active: true,
  },
  naira: {
    id: "fallback-naira", name: "Standard", slug: "naira",
    description: "Everything your business needs to grow",
    price_monthly: 7000, price_yearly: 75600, sort_order: 1,
    max_transactions: 999999, max_organizations: 5, max_org_members: 50, max_ajo_groups: 10,
    feature_keys: ["credit", "aso", "pdfExport", "staffManagement", "inventory", "loyalty", "aiInsights", "aiChatbot", "branches", "invoices", "organisation"],
    feature_limits: { aso: 10, staffManagement: 10, branches: 3, inventory: 500, loyalty: 1000 },
    features: [
      "Unlimited transactions",
      "Credit management",
      "Ajo savings management",
      "PDF export & reports",
      "Staff management",
      "Inventory tracking",
      "Loyalty program",
      "AI business insights",
      "AI chatbot",
      "Branch management",
    ],
    is_active: true,
  },
  oga: {
    id: "fallback-oga", name: "Premium", slug: "oga",
    description: "Maximum power for serious business owners",
    price_monthly: 15000, price_yearly: 171000, sort_order: 2,
    max_transactions: 999999, max_organizations: 20, max_org_members: 200, max_ajo_groups: 50,
    feature_keys: ["credit", "aso", "pdfExport", "staffManagement", "inventory", "loyalty", "aiInsights", "aiChatbot", "branches", "organisation", "invoices", "apiAccess", "loanAccess", "printWholesale", "prioritySupport"],
    feature_limits: { aso: 999999, staffManagement: 999999, branches: 999999, organisation: 999999, inventory: 999999, loyalty: 999999 },
    features: [
      "Everything in Standard",
      "Organisation / Coop management",
      "Business loan access",
      "Print airtime wholesale",
      "Print data wholesale",
      "API access",
      "Invoice generation & WhatsApp sending",
      "Priority support",
    ],
    is_active: true,
  },
};

// ── Module-level cache (in-memory only — no localStorage so admin changes reflect immediately) ──
let _cache = null;
let _cacheExpiry = 0;
const CACHE_TTL = 2 * 60 * 1000; // 2-min in-session TTL; Realtime invalidates sooner

// Legacy slug mapping — covers both clean slugs and actual DB slugs (which may have spaces/full words)
const LEGACY_MAP = {
  // canonical aliases
  starter:           "kobo",
  basic:             "naira",
  business:          "naira",
  professional:      "naira",
  premium:           "naira",
  enterprise:        "oga",
  // actual DB slugs (subscription_plans.slug in production)
  "starter plan":    "kobo",
  "business plan":   "naira",
  "enterprise plan": "oga",
};

export function normalizeSlug(slug) {
  if (!slug) return "kobo";
  const lower = slug.toLowerCase().trim();
  return LEGACY_MAP[lower] || lower || "kobo";
}

// ── fetchAndCachePlans ────────────────────────────────────────────────────────
export async function fetchAndCachePlans(supabaseClient) {
  const now = Date.now();
  if (_cache && now < _cacheExpiry) return _cache;

  try {
    const { data, error } = await supabaseClient
      .from("subscription_plans")
      .select("id, name, slug, description, price_monthly, price_yearly, max_organizations, max_org_members, max_ajo_groups, max_transactions, features, feature_keys, feature_limits, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order");

    if (!error && data?.length) {
      const bySlug = {};
      data.forEach((p) => {
        const normalized = {
          ...p,
          feature_keys:   Array.isArray(p.feature_keys)   ? p.feature_keys   : (p.feature_keys   ? JSON.parse(p.feature_keys)   : []),
          features:       Array.isArray(p.features)        ? p.features       : (p.features        ? JSON.parse(p.features)        : []),
          feature_limits: (p.feature_limits && typeof p.feature_limits === "object") ? p.feature_limits : (p.feature_limits ? JSON.parse(p.feature_limits) : {}),
        };
        // Index by original slug AND canonical slug so lookups always hit cache
        bySlug[p.slug] = normalized;
        const canonical = normalizeSlug(p.slug);
        if (canonical !== p.slug) bySlug[canonical] = normalized;
      });
      _cache = bySlug;
      _cacheExpiry = now + CACHE_TTL;
      return _cache;
    }
  } catch {}

  return null;
}

// Force-invalidate cache — called by Realtime subscription when admin changes plans
export function invalidatePlansCache() {
  _cache = null;
  _cacheExpiry = 0;
}

// ── Synchronous helpers ───────────────────────────────────────────────────────

function getPlanData(slug) {
  // Try the exact slug first so DB-defined plans (any slug) always win
  if (slug && _cache?.[slug]) return _cache[slug];
  // Then try normalized slug (handles legacy aliases like "professional" → "naira")
  const s = normalizeSlug(slug);
  return _cache?.[s] ?? FALLBACK_PLANS[s] ?? FALLBACK_PLANS.kobo;
}

export function canDo(slug, feature) {
  const p = getPlanData(slug);
  const keys = Array.isArray(p.feature_keys) ? p.feature_keys : [];
  return keys.includes(feature);
}

// Returns the numeric cap for a countable feature.
// Returns Infinity if the feature is uncapped (value missing, null, or >= 999999).
export function featureLimit(slug, key) {
  const p = getPlanData(slug);
  const limits = (p.feature_limits && typeof p.feature_limits === "object") ? p.feature_limits : {};
  const val = limits[key];
  if (val === undefined || val === null || Number(val) >= 999999) return Infinity;
  return Number(val);
}

export function planLimits(slug) {
  const p = getPlanData(slug);
  const keys = Array.isArray(p.feature_keys) ? p.feature_keys : [];
  // 0 or unset = unlimited (admin hasn't restricted); 999999 = explicitly unlimited
  const maxTx = !p.max_transactions || p.max_transactions >= 999999 ? Infinity : p.max_transactions;
  const limits = { maxTxPerMonth: maxTx };
  keys.forEach((k) => { limits[k] = true; });
  return limits;
}

export function getActivePlans() {
  const source = _cache ?? FALLBACK_PLANS;
  const seen = new Set();
  return Object.values(source)
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// Returns the cheapest active plan that includes featureKey.
export function getLowestPlanWithFeature(featureKey) {
  return getActivePlans()
    .filter(p => p.is_active !== false)
    .find(p => Array.isArray(p.feature_keys) && p.feature_keys.includes(featureKey)) ?? null;
}

// Dynamic button label: "Upgrade to Naira — ₦7,000/mo"
export function upgradeLabel(featureKey) {
  const p = getLowestPlanWithFeature(featureKey);
  if (!p) return "Upgrade Plan";
  const price = p.price_monthly ? `₦${Number(p.price_monthly).toLocaleString()}/mo` : "Free";
  return `Upgrade to ${p.name} — ${price}`;
}

// Dynamic heading: "Naira Plan Required"
export function planRequiredLabel(featureKey) {
  const p = getLowestPlanWithFeature(featureKey);
  return p ? `${p.name} Plan Required` : "Upgrade Required";
}

// Dynamic description: "Available on the Naira plan and above."
export function planAvailableText(featureKey) {
  const p = getLowestPlanWithFeature(featureKey);
  return p ? `Available on the ${p.name} plan and above.` : "Upgrade to access this feature.";
}

// Returns the plan's display name and sort_order from the live cache.
// Use this instead of comparing slug strings — plan names can change in admin.
export function getPlanInfo(slug) {
  const p = getPlanData(slug);
  return { name: p?.name ?? "Free", sortOrder: p?.sort_order ?? 0 };
}

export function isHigherPlan(currentSlug, targetSlug) {
  const cur = getPlanData(normalizeSlug(currentSlug));
  const tgt = getPlanData(normalizeSlug(targetSlug));
  return (tgt?.sort_order ?? 0) > (cur?.sort_order ?? 0);
}

export function hasHigherPlanAvailable(currentSlug) {
  const cur = getPlanData(normalizeSlug(currentSlug));
  const source = _cache ?? FALLBACK_PLANS;
  return Object.values(source).some((p) => (p.sort_order ?? 0) > (cur?.sort_order ?? 0));
}

