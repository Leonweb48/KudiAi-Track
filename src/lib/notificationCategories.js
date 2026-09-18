/**
 * Canonical notification category registry — single source of truth for
 * the 8 visual buckets used by the notification drawer (icon circle color)
 * and, in a later phase, the Android push payload.
 *
 * Mirrors (but is not imported by, per this codebase's convention of each
 * edge function duplicating its own small constants) notify-send's
 * CATEGORY_META in supabase/functions/notify-send/index.ts — keep the two
 * in sync by hand when either changes.
 *
 * `rawCategories` lists every value notifications.category can actually
 * hold (9 — "permissions"/"approvals" are finer-grained preference keys
 * than this 8-bucket palette, so both map to the "account" bucket here).
 */

export const NOTIFICATION_CATEGORIES = {
  money: {
    label: "Money & Sales",
    hex: "#3DA829",
    icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  },
  savings: {
    label: "Ajo & Savings",
    hex: "#F59E0B",
    icon: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  },
  credit: {
    label: "Credit & Invoice",
    hex: "#3B82F6",
    icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  },
  alert: {
    label: "Alerts & Warnings",
    hex: "#EF4444",
    icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01",
  },
  stock: {
    label: "Stock",
    hex: "#8B5CF6",
    icon: "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
  },
  bills: {
    label: "Bills & Payments",
    hex: "#14B8A6",
    icon: "M3 21h18 M5 21V7l7-4 7 4v14 M9 9v.01 M9 12v.01 M9 15v.01 M15 9v.01 M15 12v.01 M15 15v.01",
  },
  account: {
    label: "Account & System",
    hex: "#64748B",
    icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  },
  milestone: {
    label: "Milestones",
    hex: "#CA8A04",
    icon: "M8 21h8 M12 17v4 M17 5V3H7v2 M17 5a5 5 0 01-5 5 5 5 0 01-5-5 M17 5h2a2 2 0 010 4h-2M7 5H5a2 2 0 000 4h2",
    sparkle: true,
  },
};

// Every raw value notifications.category can hold today, and which visual
// bucket above it renders as.
export const RAW_CATEGORY_TO_BUCKET = {
  money: "money",
  savings: "savings",
  stock: "stock",
  credit: "credit",
  alert: "alert",
  bills: "bills",
  milestone: "milestone",
  permissions: "account",
  approvals: "account",
};

export function categoryMeta(rawCategory) {
  const bucket = RAW_CATEGORY_TO_BUCKET[rawCategory] || "money";
  return NOTIFICATION_CATEGORIES[bucket];
}
