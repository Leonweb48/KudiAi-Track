// Paid-plan compliance: required fields, grace period, and feature lock logic.
// Free-plan owners are nudged (dismissible banner) but never blocked.
// Paid-plan owners must complete these fields within 14 days; after that
// certain premium features are restricted until compliance is achieved.

import { normalizeSlug } from "./plans";

// ── Required fields for paid-plan owners ─────────────────────────────────────
// 13 data fields + 1 identity-verification check + 1 wallet-activation check
// = 15 compliance items. Settlement account is now the owner's own KudiAI
// (Flutterwave) wallet — checked separately via the `walletActive` param on
// getMissingPaidFields, not a plain profile field (Paystack-linked bank
// settlement was retired; the wallet is genuinely where Ajo money lands).
export const PAID_REQUIRED_FIELDS = [
  // Personal details
  { key: "gender",                  label: "Gender",                   group: "Personal details" },
  { key: "date_of_birth",           label: "Date of birth",            group: "Personal details" },
  { key: "address",                 label: "Home address",             group: "Personal details" },
  { key: "state",                   label: "State of residence",       group: "Personal details" },
  { key: "lga",                     label: "LGA of residence",         group: "Personal details" },
  // Business details
  { key: "business_type",           label: "Business type",            group: "Business details" },
  { key: "reg_status",              label: "Registration status",      group: "Business details" },
  { key: "industry",                label: "Industry",                 group: "Business details" },
  { key: "business_size",           label: "Business size",            group: "Business details" },
  { key: "products_services_type",  label: "Products / services",      group: "Business details" },
  // Business location
  { key: "business_state",          label: "Business state",           group: "Business location" },
  { key: "business_lga",            label: "Business LGA",             group: "Business location" },
  { key: "business_address",        label: "Business address",         group: "Business location" },
  // Settlement account (wallet) and identity verification are special checks
  // (not plain profile fields) — see getMissingPaidFields below.
];

// Premium features restricted after the grace period expires (core money
// functions — transactions, credits, ajo, bills, finance — are never restricted).
export const PREMIUM_RESTRICTED_FEATURES = [
  "aiChatbot",
  "aiInsights",
  "pdfExport",
  "invoices",
  "loanAccess",
  "printWholesale",
];

// Grace period: 14 days from when the owner first lands on a paid plan.
export const GRACE_DAYS = 14;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

// ── localStorage keys ─────────────────────────────────────────────────────────
const graceSinceKey  = (uid) => `kt_paid_since_${uid}`;
const introShownKey  = (uid) => `kt_compliance_intro_${uid}`;

// ── Plan check ────────────────────────────────────────────────────────────────
export function isPaidPlan(planSlug) {
  return normalizeSlug(planSlug) !== "kobo";
}

// ── Field helpers ─────────────────────────────────────────────────────────────
function isFilled(value) {
  return value != null && String(value).trim().length > 0;
}

function isIdentityVerified(profile) {
  const st = profile?.verification_status;
  return st === "tier1_verified" || st === "tier2_verified";
}

// Returns all missing compliance items (fields + identity check + wallet).
// walletActive: whether the owner's KudiAI (Flutterwave) wallet has been
// provisioned — the settlement destination. Defaults to false (missing) when
// not passed, so existing callers that haven't been updated yet fail safe.
export function getMissingPaidFields(profile, walletActive = false) {
  const missing = PAID_REQUIRED_FIELDS.filter(f => !isFilled(profile?.[f.key]));
  if (!walletActive) {
    missing.push({ key: "settlement_account", label: "Active KudiAI wallet", group: "Settlement account" });
  }
  if (!isIdentityVerified(profile)) {
    missing.push({ key: "verification", label: "Identity verified (NIN)", group: "Verification" });
  }
  return missing;
}

// True when the owner has satisfied every requirement.
export function isPaidCompliant(profile, walletActive = false) {
  return getMissingPaidFields(profile, walletActive).length === 0;
}

// ── Grace period ──────────────────────────────────────────────────────────────

// Call on every paid-plan detected session. Sets the start timestamp only once.
export function recordPaidSince(userId) {
  if (!userId) return;
  const key = graceSinceKey(userId);
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, String(Date.now()));
  }
}

// Clear on downgrade (call when plan drops to free).
export function clearPaidSince(userId) {
  if (!userId) return;
  localStorage.removeItem(graceSinceKey(userId));
  localStorage.removeItem(introShownKey(userId));
}

export function getPaidGraceInfo(userId) {
  const raw = localStorage.getItem(graceSinceKey(userId));
  if (!raw) {
    // Not recorded yet (will be set this session) — treat as still in grace.
    return { paidSince: null, graceDaysLeft: GRACE_DAYS, inGrace: true };
  }
  const paidSince   = parseInt(raw, 10);
  const elapsed     = Date.now() - paidSince;
  const remaining   = GRACE_MS - elapsed;
  return {
    paidSince,
    graceDaysLeft: Math.max(0, Math.ceil(remaining / 86400000)),
    inGrace:       remaining > 0,
  };
}

// ── One-time compliance intro modal ──────────────────────────────────────────
export function isComplianceIntroShown(userId) {
  return !!localStorage.getItem(introShownKey(userId));
}
export function markComplianceIntroShown(userId) {
  if (!userId) return;
  localStorage.setItem(introShownKey(userId), "1");
}

// ── Feature lock ──────────────────────────────────────────────────────────────
// Returns true when a specific premium feature should be blocked because the
// owner is on a paid plan, grace period has expired, and compliance is unmet.
export function isFeatureLocked(feature, { isPaid, isCompliant, inGrace }) {
  if (!isPaid)      return false;
  if (isCompliant)  return false;
  if (inGrace)      return false;
  return PREMIUM_RESTRICTED_FEATURES.includes(feature);
}
