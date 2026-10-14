// Wallet TIERS — see supabase/migrations/20270178000000_wallet_tiers.sql for the rules and how they are enforced.
// Everyone starts at Tier 1. The limits live in platform_config (wallet_tier{n}_{max_balance,daily_limit,per_transfer}_kobo) so they
// can be changed without a release; the numbers below are only the fallbacks and MUST match the migration's seeds.

export const TIER_CFG_KEYS = [1, 2, 3].flatMap((n) => [
  `wallet_tier${n}_max_balance_kobo`, `wallet_tier${n}_daily_limit_kobo`, `wallet_tier${n}_per_transfer_kobo`,
]);

const DEFAULTS = {
  1: { maxBalanceKobo: 30000000,  dailyKobo: 10000000,  perTransferKobo: 5000000 },     // ₦300,000 · ₦100,000 · ₦50,000
  2: { maxBalanceKobo: 50000000,  dailyKobo: 20000000,  perTransferKobo: 20000000 },    // ₦500,000 · ₦200,000 · ₦200,000
  3: { maxBalanceKobo: null,      dailyKobo: 500000000, perTransferKobo: 500000000 },   // unlimited · ₦5,000,000 · ₦5,000,000
};

export const TIER_INFO = {
  1: {
    name: "Basic",
    requirements: ["Email address and phone number", "Your BVN or NIN"],
    // translation keys for the text above (src/i18n/wallet.js) — screens show t(key); the English stays for code/tests
    nameKey: "wallet.tier.name1",
    requirementKeys: ["wallet.tier.req1.contact", "wallet.tier.req1.id"],
  },
  2: {
    name: "Verified",
    requirements: ["Your full name", "Your residential address", "Both your BVN and your NIN"],
    nameKey: "wallet.tier.name2",
    requirementKeys: ["wallet.tier.req2.name", "wallet.tier.req2.address", "wallet.tier.req2.both"],
  },
  3: {
    name: "Fully Verified",
    requirements: [
      "A valid ID — National ID or NIN slip, Voter's card, Driver's licence or International passport (photo of the front, and the back for cards)",
      "A utility bill or bank statement from the last 3 months, showing your address",
      "A recent passport photograph",
    ],
    nameKey: "wallet.tier.name3",
    requirementKeys: ["wallet.tier.req3.id", "wallet.tier.req3.bill", "wallet.tier.req3.photo"],
  },
};

// ── Tier 3 documents (uploaded in the app, checked by an admin) ─────────────────────────────────────────────────────
// Must match public.wallet_tier3_required_docs() and the request-tier action in supabase/functions/flutterwave.
export const TIER3_ID_TYPES = [
  { id: "national_id",     label: "National ID card",       numberLabel: "NIN",             placeholder: "11-digit NIN",      numeric: true,  back: true,  front: "Front of your National ID card",
    labelKey: "wallet.tier3.type.nationalId", numberLabelKey: "wallet.tier3.num.nin", placeholderKey: "wallet.id.ninPlaceholder", frontKey: "wallet.tier3.front.nationalId" },
  { id: "nin_slip",        label: "NIN slip",               numberLabel: "NIN",             placeholder: "11-digit NIN",      numeric: true,  back: false, front: "Your NIN slip",
    labelKey: "wallet.tier3.type.ninSlip", numberLabelKey: "wallet.tier3.num.nin", placeholderKey: "wallet.id.ninPlaceholder", frontKey: "wallet.tier3.front.ninSlip" },
  { id: "voters_card",     label: "Voter's card (PVC)",     numberLabel: "VIN",             placeholder: "VIN on the card",   numeric: false, back: true,  front: "Front of your voter's card",
    labelKey: "wallet.tier3.type.voters", numberLabelKey: "wallet.tier3.num.vin", placeholderKey: "wallet.tier3.ph.vin", frontKey: "wallet.tier3.front.voters" },
  { id: "drivers_license", label: "Driver's licence",       numberLabel: "Licence number",  placeholder: "e.g. ABC12345AA01", numeric: false, back: true,  front: "Front of your driver's licence",
    labelKey: "wallet.tier3.type.license", numberLabelKey: "wallet.tier3.num.license", placeholderKey: "wallet.tier3.ph.license", frontKey: "wallet.tier3.front.license" },
  { id: "passport",        label: "International passport", numberLabel: "Passport number", placeholder: "e.g. A12345678",   numeric: false, back: false, front: "Your passport's photo page",
    labelKey: "wallet.tier3.type.passport", numberLabelKey: "wallet.tier3.num.passport", placeholderKey: "wallet.tier3.ph.passport", frontKey: "wallet.tier3.front.passport" },
];

// translation keys for the messages tier3IdNumberError() returns (display only — the English is what the function returns)
export const TIER3_ID_ERROR_KEYS = {
  "Enter your ID number": "wallet.tier3.err.idNumber",
  "Your NIN must be exactly 11 digits": "wallet.id.err.nin11",
  "Enter the VIN on your voter's card": "wallet.tier3.err.vin",
  "Enter your driver's licence number": "wallet.tier3.err.license",
  "Enter your passport number (a letter and 8 digits, e.g. A12345678)": "wallet.tier3.err.passport",
  "Choose the type of ID": "wallet.tier3.err.chooseType",
};

export const tier3IdType = (id) => TIER3_ID_TYPES.find((t) => t.id === id) || null;

/** Which documents an ID type needs, in upload order. */
export function tier3RequiredDocs(idType) {
  const t = tier3IdType(idType);
  return t && !t.back ? ["id_front", "utility_bill", "passport_photo"] : ["id_front", "id_back", "utility_bill", "passport_photo"];
}

/** Check an ID number the same way the server does. Returns an error message or "". */
export function tier3IdNumberError(idType, raw) {
  const v = String(raw || "").toUpperCase().replace(/\s+/g, "");
  if (!v) return "Enter your ID number";
  if (idType === "national_id" || idType === "nin_slip") return /^\d{11}$/.test(v) ? "" : "Your NIN must be exactly 11 digits";
  if (idType === "voters_card") return /^[A-Z0-9]{9,23}$/.test(v) ? "" : "Enter the VIN on your voter's card";
  if (idType === "drivers_license") return /^[A-Z0-9-]{6,20}$/.test(v) ? "" : "Enter your driver's licence number";
  if (idType === "passport") return /^[A-Z]\d{8}$/.test(v) ? "" : "Enter your passport number (a letter and 8 digits, e.g. A12345678)";
  return "Choose the type of ID";
}

export const TIER3_DOCS = {
  id_front: {
    title: "ID — front", sample: "/kyc-samples/id-front.svg", camera: "environment", pdf: false,
    good: ["All four corners inside the photo", "Every word sharp and readable", "Your ID has not expired"],
    bad: ["Glare or flash on the card", "Fingers covering any part", "A photocopy or screenshot"],
    titleKey: "wallet.tier3.doc.idFront",
    goodKeys: ["wallet.tier3.good.corners", "wallet.tier3.good.sharp", "wallet.tier3.good.notExpired"],
    badKeys: ["wallet.tier3.bad.glare", "wallet.tier3.bad.fingers", "wallet.tier3.bad.copy"],
  },
  id_back: {
    title: "ID — back", sample: "/kyc-samples/id-back.svg", camera: "environment", pdf: false,
    good: ["All four corners inside the photo", "Barcode and writing readable"],
    bad: ["Glare or blur", "Cropped edges"],
    titleKey: "wallet.tier3.doc.idBack",
    goodKeys: ["wallet.tier3.good.corners", "wallet.tier3.good.barcode"],
    badKeys: ["wallet.tier3.bad.glareBlur", "wallet.tier3.bad.cropped"],
  },
  utility_bill: {
    title: "Utility bill (proof of address)", sample: "/kyc-samples/utility-bill.svg", camera: "environment", pdf: true,
    good: ["Electricity, water, waste or cable TV bill — or a bank statement", "Dated within the last 3 months", "Shows your name and the same address you entered"],
    bad: ["Older than 3 months", "Someone else's name (unless you explain in the note)", "Only part of the page"],
    titleKey: "wallet.tier3.doc.bill",
    goodKeys: ["wallet.tier3.good.billType", "wallet.tier3.good.billDate", "wallet.tier3.good.billName"],
    badKeys: ["wallet.tier3.bad.billOld", "wallet.tier3.bad.billName", "wallet.tier3.bad.billPart"],
  },
  passport_photo: {
    title: "Passport photograph", sample: "/kyc-samples/passport-photo.svg", camera: "user", pdf: false,
    good: ["Plain white or light background", "Face the camera — face and ears visible", "Taken in the last 6 months"],
    bad: ["Cap, sunglasses or face covering (religious head covering is fine)", "Filters or beauty effects", "A group photo or a photo of a photo"],
    titleKey: "wallet.tier3.doc.photo",
    goodKeys: ["wallet.tier3.good.photoBg", "wallet.tier3.good.photoFace", "wallet.tier3.good.photoRecent"],
    badKeys: ["wallet.tier3.bad.photoCover", "wallet.tier3.bad.photoFilter", "wallet.tier3.bad.photoGroup"],
  },
};

export const clampTier = (t) => { const n = Number(t); return n === 2 || n === 3 ? n : 1; };
export const nextTier = (t) => { const n = clampTier(t); return n < 3 ? n + 1 : null; };

// a blank value means "not set" (the database does the same: NULLIF(value, '')), never 0
const num = (v) => { if (v === null || v === undefined || String(v).trim() === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/**
 * Limits (kobo) for a tier, from the platform_config map (key → value string). A missing or unreadable value falls back to the
 * default. maxBalanceKobo === null means unlimited (the config stores 0 for that).
 */
export function tierLimits(tier, cfg = {}) {
  const t = clampTier(tier);
  const d = DEFAULTS[t];
  const read = (suffix, fallback) => { const v = num(cfg?.[`wallet_tier${t}_${suffix}_kobo`]); return v === null || v < 0 ? fallback : v; };
  const mb = read("max_balance", d.maxBalanceKobo === null ? 0 : d.maxBalanceKobo);
  return {
    maxBalanceKobo: mb === 0 ? null : mb,
    dailyKobo: read("daily_limit", d.dailyKobo),
    perTransferKobo: read("per_transfer", d.perTransferKobo),
  };
}

/** ₦300,000 from kobo, or "Unlimited" for null. */
export function formatKoboLimit(kobo) {
  if (kobo === null || kobo === undefined) return "Unlimited";
  return `₦${Math.round(Number(kobo) / 100).toLocaleString("en-NG")}`;
}
