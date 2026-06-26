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
  apiAccess:       "API Access",
  loanAccess:      "Business Loan Access",
  printWholesale:  "Print Wholesale (Airtime & Data)",
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
  { key: "apiAccess",       label: "API access" },
  { key: "loanAccess",      label: "Business loan access" },
  { key: "printWholesale",  label: "Print recharge & data wholesale" },
];

// ── Fallback hardcoded plans (matches DB seed data) ───────────────────────────
const FALLBACK_PLANS = {
  kobo: {
    id: "fallback-kobo", name: "Kobo", slug: "kobo",
    description: "Free forever — get started at your own pace",
    price_monthly: 0, price_yearly: 0, sort_order: 0,
    max_transactions: 50, max_organizations: 1, max_org_members: 5, max_ajo_groups: 1,
    feature_keys: ["credit"],
    feature_limits: { staffManagement: 3, inventory: 50, loyalty: 100 },
    features: ["Basic dashboard", "1 organisation", "5 team members", "50 transactions/month"],
    is_active: true,
  },
  naira: {
    id: "fallback-naira", name: "Naira", slug: "naira",
    description: "Everything your business needs to grow",
    price_monthly: 7000, price_yearly: 75600, sort_order: 1,
    max_transactions: 999999, max_organizations: 5, max_org_members: 50, max_ajo_groups: 10,
    feature_keys: ["credit", "aso", "pdfExport", "staffManagement", "inventory", "loyalty", "aiInsights", "aiChatbot", "branches"],
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
    id: "fallback-oga", name: "Oga", slug: "oga",
    description: "Maximum power for serious business owners",
    price_monthly: 15000, price_yearly: 171000, sort_order: 2,
    max_transactions: 999999, max_organizations: 20, max_org_members: 200, max_ajo_groups: 50,
    feature_keys: ["credit", "aso", "pdfExport", "staffManagement", "inventory", "loyalty", "aiInsights", "aiChatbot", "branches", "organisation", "apiAccess", "loanAccess", "printWholesale"],
    feature_limits: { aso: 999999, staffManagement: 999999, branches: 999999, organisation: 999999, inventory: 999999, loyalty: 999999 },
    features: [
      "Everything in Naira",
      "Organisation / Coop management",
      "Business loan access",
      "Print airtime wholesale",
      "Print data wholesale",
      "API access",
      "Priority support",
    ],
    is_active: true,
  },
};

// ── Module-level cache ─────────────────────────────────────────────────────────
let _cache = null;
let _cacheExpiry = 0;
const CACHE_KEY = "kuditrack_plans_v2";
const CACHE_TTL = 10 * 60 * 1000;

// Legacy slug mapping
const LEGACY_MAP = {
  starter:      "kobo",
  basic:        "naira",
  business:     "naira",
  professional: "naira",
  premium:      "naira",
  enterprise:   "oga",
};

export function normalizeSlug(slug) {
  return LEGACY_MAP[slug] || slug || "kobo";
}

// ── fetchAndCachePlans ────────────────────────────────────────────────────────
export async function fetchAndCachePlans(supabaseClient) {
  const now = Date.now();

  if (_cache && now < _cacheExpiry) return _cache;

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.expiry > now && parsed?.plans && Object.keys(parsed.plans).length > 0) {
        _cache = parsed.plans;
        _cacheExpiry = parsed.expiry;
        return _cache;
      }
    }
  } catch {}

  try {
    const { data, error } = await supabaseClient
      .from("subscription_plans")
      .select("id, name, slug, description, price_monthly, price_yearly, max_organizations, max_org_members, max_ajo_groups, max_transactions, features, feature_keys, feature_limits, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order");

    if (!error && data?.length) {
      const bySlug = {};
      data.forEach((p) => {
        bySlug[p.slug] = {
          ...p,
          feature_keys:   Array.isArray(p.feature_keys)   ? p.feature_keys   : (p.feature_keys   ? JSON.parse(p.feature_keys)   : []),
          features:       Array.isArray(p.features)        ? p.features       : (p.features        ? JSON.parse(p.features)        : []),
          feature_limits: (p.feature_limits && typeof p.feature_limits === "object") ? p.feature_limits : (p.feature_limits ? JSON.parse(p.feature_limits) : {}),
        };
      });
      _cache = bySlug;
      _cacheExpiry = now + CACHE_TTL;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ plans: bySlug, expiry: _cacheExpiry }));
      } catch {}
      return _cache;
    }
  } catch {}

  return null;
}

// Force-invalidate cache (call after a plan change in admin portal)
export function invalidatePlansCache() {
  _cache = null;
  _cacheExpiry = 0;
  try { localStorage.removeItem(CACHE_KEY); } catch {}
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
  return Object.values(source).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
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

// Legacy compat
export const PLANS_META = {
  kobo:         { name: "Kobo",  color: "gray",   price: 0,     badge: "Free forever" },
  naira:        { name: "Naira", color: "blue",   price: 7000,  badge: "₦7,000/mo" },
  oga:          { name: "Oga",   color: "violet", price: 15000, badge: "₦15,000/mo" },
  starter:      { name: "Kobo",  color: "gray",   price: 0,     badge: "Free forever" },
  basic:        { name: "Naira", color: "blue",   price: 7000,  badge: "₦7,000/mo" },
  business:     { name: "Naira", color: "blue",   price: 7000,  badge: "₦7,000/mo" },
  professional: { name: "Naira", color: "blue",   price: 7000,  badge: "₦7,000/mo" },
  premium:      { name: "Naira", color: "blue",   price: 7000,  badge: "₦7,000/mo" },
  enterprise:   { name: "Oga",   color: "violet", price: 15000, badge: "₦15,000/mo" },
};

export const PLAN_ORDER = ["kobo", "naira", "oga"];

export const PLAN_LIMITS = {
  kobo:         { maxTxPerMonth: 50 },
  naira:        { maxTxPerMonth: Infinity, credit: true, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, aiChatbot: true, branches: true },
  oga:          { maxTxPerMonth: Infinity, credit: true, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, aiChatbot: true, branches: true, organisation: true, apiAccess: true, loanAccess: true, printWholesale: true },
  starter:      { maxTxPerMonth: 50 },
  basic:        { maxTxPerMonth: Infinity, credit: true, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, branches: true },
  business:     { maxTxPerMonth: Infinity, credit: true, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true },
  professional: { maxTxPerMonth: Infinity, credit: true, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, branches: true },
  premium:      { maxTxPerMonth: Infinity, credit: true, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, branches: true },
  enterprise:   { maxTxPerMonth: Infinity, credit: true, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, aiChatbot: true, branches: true, organisation: true, apiAccess: true, loanAccess: true, printWholesale: true },
};
