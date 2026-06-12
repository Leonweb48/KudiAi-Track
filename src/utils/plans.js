// ── Subscription plan system ──────────────────────────────────────────────────
// Single source of truth: DB subscription_plans table.
// Falls back to hardcoded defaults if the DB is unreachable.
// canDo() / planLimits() are synchronous; call fetchAndCachePlans() once on
// app boot (inside useAuth) to warm the cache before any gated screen renders.

// ── Standard feature keys ─────────────────────────────────────────────────────
// Admin portal stores these in `feature_keys` jsonb column.
export const FEATURE_KEYS = {
  aso:              "Ajo/Savings Groups",
  pdfExport:        "PDF Reports & Export",
  staffManagement:  "Staff Management",
  inventory:        "Inventory Management",
  loyalty:          "Loyalty Program",
  aiInsights:       "AI Business Insights",
  branches:         "Branch Management",
  apiAccess:        "API Access",
};

// Full ordered list for "missing features" display in the upgrade screen
export const ALL_FEATURE_LIST = [
  { key: "aso",             label: "Ajo savings management" },
  { key: "pdfExport",       label: "PDF export" },
  { key: "staffManagement", label: "Staff management" },
  { key: "inventory",       label: "Inventory management" },
  { key: "loyalty",         label: "Loyalty program" },
  { key: "aiInsights",      label: "AI-powered insights" },
  { key: "branches",        label: "Branch management" },
  { key: "apiAccess",       label: "API access" },
];

// ── Fallback hardcoded plans (matches DB seed data) ───────────────────────────
const FALLBACK_PLANS = {
  starter: {
    id: "fallback-starter", name: "Starter", slug: "starter",
    description: "Free plan for individuals getting started",
    price_monthly: 0, price_yearly: 0, sort_order: 0,
    max_transactions: 50, max_organizations: 1, max_org_members: 5, max_ajo_groups: 1,
    feature_keys: [],
    features: ["Basic dashboard", "1 organization", "5 members", "50 transactions/mo"],
    is_active: true,
  },
  basic: {
    id: "fallback-basic", name: "Basic", slug: "basic",
    description: "For small businesses ready to grow",
    price_monthly: 2000, price_yearly: 20000, sort_order: 1,
    max_transactions: 500, max_organizations: 2, max_org_members: 20, max_ajo_groups: 3,
    feature_keys: ["aso", "pdfExport", "staffManagement", "inventory", "loyalty"],
    features: ["Unlimited transactions", "Ajo savings management", "PDF export", "Staff management", "Inventory", "Loyalty program"],
    is_active: true,
  },
  professional: {
    id: "fallback-professional", name: "Professional", slug: "professional",
    description: "For established businesses with more needs",
    price_monthly: 5000, price_yearly: 50000, sort_order: 2,
    max_transactions: 2000, max_organizations: 5, max_org_members: 50, max_ajo_groups: 10,
    feature_keys: ["aso", "pdfExport", "staffManagement", "inventory", "loyalty", "aiInsights", "branches"],
    features: ["Everything in Basic", "AI-powered insights", "Branch management", "Advanced analytics"],
    is_active: true,
  },
  enterprise: {
    id: "fallback-enterprise", name: "Enterprise", slug: "enterprise",
    description: "Full-featured plan for large businesses",
    price_monthly: 15000, price_yearly: 150000, sort_order: 3,
    max_transactions: 999999, max_organizations: 20, max_org_members: 200, max_ajo_groups: 50,
    feature_keys: ["aso", "pdfExport", "staffManagement", "inventory", "loyalty", "aiInsights", "branches", "apiAccess"],
    features: ["Everything in Professional", "API access", "Dedicated support", "SLA guarantee"],
    is_active: true,
  },
};

// ── Module-level cache ─────────────────────────────────────────────────────────
let _cache = null;          // { [slug]: planRow }
let _cacheExpiry = 0;
const CACHE_KEY = "kuditrack_plans_v2";
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Legacy slug mapping: old hardcoded slugs → DB slugs
const LEGACY_MAP = { business: "basic", premium: "professional" };

export function normalizeSlug(slug) {
  return LEGACY_MAP[slug] || slug || "starter";
}

// ── fetchAndCachePlans ────────────────────────────────────────────────────────
// Call once on app boot (useAuth). Non-blocking — failures fall back to hardcoded.
export async function fetchAndCachePlans(supabaseClient) {
  const now = Date.now();

  // In-memory hit
  if (_cache && now < _cacheExpiry) return _cache;

  // localStorage hit
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

  // DB fetch
  try {
    const { data, error } = await supabaseClient
      .from("subscription_plans")
      .select("id, name, slug, description, price_monthly, price_yearly, max_organizations, max_org_members, max_ajo_groups, max_transactions, features, feature_keys, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order");

    if (!error && data?.length) {
      const bySlug = {};
      data.forEach((p) => {
        // Normalize jsonb fields (Supabase returns them as JS arrays/objects already)
        bySlug[p.slug] = {
          ...p,
          feature_keys: Array.isArray(p.feature_keys) ? p.feature_keys : (p.feature_keys ? JSON.parse(p.feature_keys) : []),
          features:     Array.isArray(p.features)     ? p.features     : (p.features     ? JSON.parse(p.features)     : []),
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

  return null; // Caller falls back to FALLBACK_PLANS
}

// Force-invalidate cache (call after a plan change in admin portal)
export function invalidatePlansCache() {
  _cache = null;
  _cacheExpiry = 0;
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

// ── Synchronous helpers ───────────────────────────────────────────────────────

function getPlanData(slug) {
  const s = normalizeSlug(slug);
  return _cache?.[s] ?? FALLBACK_PLANS[s] ?? FALLBACK_PLANS.starter;
}

export function canDo(slug, feature) {
  const p = getPlanData(slug);
  const keys = Array.isArray(p.feature_keys) ? p.feature_keys : [];
  return keys.includes(feature);
}

export function planLimits(slug) {
  const p = getPlanData(slug);
  const keys = Array.isArray(p.feature_keys) ? p.feature_keys : [];
  const limits = {
    maxTxPerMonth: p.max_transactions >= 999999 ? Infinity : (p.max_transactions || 100),
  };
  keys.forEach((k) => { limits[k] = true; });
  return limits;
}

// Returns plans sorted by sort_order (from cache or fallback)
export function getActivePlans() {
  const source = _cache ?? FALLBACK_PLANS;
  return Object.values(source).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function isHigherPlan(currentSlug, targetSlug) {
  const cur = getPlanData(normalizeSlug(currentSlug));
  const tgt = getPlanData(normalizeSlug(targetSlug));
  return (tgt?.sort_order ?? 0) > (cur?.sort_order ?? 0);
}

// Check if there's any plan above the user's current plan (for upgrade banner)
export function hasHigherPlanAvailable(currentSlug) {
  const cur = getPlanData(normalizeSlug(currentSlug));
  const source = _cache ?? FALLBACK_PLANS;
  return Object.values(source).some((p) => (p.sort_order ?? 0) > (cur?.sort_order ?? 0));
}

// Legacy compat — some files import these named exports
export const PLANS_META = {
  starter:      { name: "Starter",      color: "gray",   price: 0,     badge: "Free forever" },
  basic:        { name: "Basic",        color: "blue",   price: 2000,  badge: "₦2,000/mo" },
  professional: { name: "Professional", color: "violet", price: 5000,  badge: "₦5,000/mo" },
  enterprise:   { name: "Enterprise",   color: "amber",  price: 15000, badge: "₦15,000/mo" },
  // legacy
  business:     { name: "Basic",        color: "green",  price: 2000,  badge: "₦2,000/mo" },
  premium:      { name: "Professional", color: "purple", price: 5000,  badge: "₦5,000/mo" },
};

export const PLAN_ORDER = ["starter", "basic", "professional", "enterprise"];

export const PLAN_LIMITS = {
  starter:      { maxTxPerMonth: 50 },
  basic:        { maxTxPerMonth: 500,    aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true },
  professional: { maxTxPerMonth: 2000,   aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, branches: true },
  enterprise:   { maxTxPerMonth: Infinity, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, branches: true, apiAccess: true },
  // legacy
  business:     { maxTxPerMonth: Infinity, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true },
  premium:      { maxTxPerMonth: Infinity, aso: true, pdfExport: true, staffManagement: true, inventory: true, loyalty: true, aiInsights: true, branches: true },
};
