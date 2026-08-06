// Field definitions and computation for profile completion.
// Core fields are always expected filled after onboarding.
// Section fields are the 12 deferred optional fields.

export const COMPLETION_SECTIONS = [
  {
    id: "about",
    title: "About You",
    icon: "👤",
    why: "Helps personalise your reports and will be needed to verify your identity when you upgrade to a paid plan.",
    fields: [
      { key: "gender",        label: "Gender" },
      { key: "date_of_birth", label: "Date of birth" },
      { key: "address",       label: "Home address" },
      { key: "nin",           label: "National ID (NIN)" },
    ],
  },
  {
    id: "business",
    title: "Your Business",
    icon: "🏢",
    why: "Makes your analytics and reports more accurate, and surfaces the right insights for your industry.",
    fields: [
      { key: "store_image_url",              label: "Business logo" },
      { key: "business_type",               label: "Business type" },
      { key: "industry",                    label: "Industry" },
      { key: "operating_model",             label: "Operating model" },
    ],
  },
  {
    id: "location",
    title: "Location",
    icon: "📍",
    why: "Your business address appears on invoices and is used for local insights.",
    fields: [
      { key: "business_state",   label: "State" },
      { key: "business_lga",     label: "Local Government" },
      { key: "business_address", label: "Business address" },
    ],
  },
  {
    id: "verification",
    title: "Verification",
    icon: "📄",
    why: "A business document earns a verified badge, builds client trust, and is required when upgrading to a paid plan.",
    fields: [
      { key: "reg_doc_url", label: "Business document" },
    ],
  },
];

// Core fields — always filled after onboarding, always count toward completion.
const CORE_FIELDS = [
  { key: "owner_name" },
  { key: "email" },
  { key: "phone" },
  { key: "profile_image_url" },
  { key: "business_name" },
];

const ALL_OPTIONAL = COMPLETION_SECTIONS.flatMap(s => s.fields);
const TOTAL_FIELDS = CORE_FIELDS.length + ALL_OPTIONAL.length;

function isFilled(value) {
  return value != null && String(value).trim().length > 0;
}

export function computeCompletion(profile) {
  const all = [...CORE_FIELDS, ...ALL_OPTIONAL];
  const filled = all.filter(f => isFilled(profile[f.key])).length;
  return {
    pct:    Math.round((filled / TOTAL_FIELDS) * 100),
    filled,
    total:  TOTAL_FIELDS,
  };
}

export function getSectionStatus(section, profile) {
  const total  = section.fields.length;
  const filled = section.fields.filter(f => isFilled(profile[f.key])).length;
  return { filled, total, done: filled === total };
}

export function isProfileComplete(profile) {
  return computeCompletion(profile).pct >= 100;
}

// localStorage key for dismiss state — per user so multi-account safe.
export function bannerDismissKey(userId) {
  return `kt_profile_reminder_${userId}`;
}

export const BANNER_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
