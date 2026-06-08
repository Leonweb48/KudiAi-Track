export const PLANS_META = {
  starter:  { name: "Starter",  color: "gray",   price: 0,    badge: "Free forever" },
  business: { name: "Business", color: "green",  price: 2500, badge: "₦2,500/mo" },
  premium:  { name: "Premium",  color: "purple", price: 5000, badge: "₦5,000/mo" },
};

export const PLAN_ORDER = ["starter", "business", "premium"];

// Feature flags per plan
export const PLAN_LIMITS = {
  starter: {
    maxTxPerMonth: 100,
    aso:        false,
    pdfExport:  false,
    aiInsights: false,
  },
  business: {
    maxTxPerMonth:   Infinity,
    aso:             true,
    pdfExport:       true,
    aiInsights:      false,
    staffManagement: true,
  },
  premium: {
    maxTxPerMonth:   Infinity,
    aso:             true,
    pdfExport:       true,
    aiInsights:      true,
    staffManagement: true,
  },
};

export const planLimits = (plan) => PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
export const canDo      = (plan, feature) => !!planLimits(plan)[feature];

// Returns true if targetPlan is strictly higher than currentPlan
export const isHigherPlan = (currentPlan, targetPlan) =>
  PLAN_ORDER.indexOf(targetPlan) > PLAN_ORDER.indexOf(currentPlan);
