// Two Flutterwave accounts at once — the original ("legacy", the personal one) and the business account
// the platform is moving to. Used by the `flutterwave` and `flutterwave-webhook` functions.
//
// WHY: a virtual account and a customer belong to the Flutterwave merchant that created them. Wallets that
// already have a number keep receiving deposits on the legacy account, so during the grace period both
// accounts have to work side by side: the webhook accepts both secret hashes and verifies each charge with the
// credentials of the account that signed it, and every wallet remembers which account its number lives on
// (wallets.flw_account).
//
// SECRET NAMES. The legacy account keeps its EXISTING secret names, so nothing has to be read back or re-entered:
//   FLW_CLIENT_ID · FLW_CLIENT_SECRET · FLW_BASE_URL · FLW_V3_SECRET_KEY · FLW_WEBHOOK_SECRET_HASH
// The business account uses the same names with a BIZ_ infix:
//   FLW_BIZ_CLIENT_ID · FLW_BIZ_CLIENT_SECRET · FLW_BIZ_BASE_URL (defaults to the legacy base) ·
//   FLW_BIZ_V3_SECRET_KEY · FLW_BIZ_WEBHOOK_SECRET_HASH
//
// WHICH ACCOUNT IS ACTIVE (new numbers, payouts, name enquiry) is platform_config.flw_active_account
// ('legacy' until the switch). The grace deadline is platform_config.flw_legacy_grace_until (ISO time).

export type AccountKey = "legacy" | "business";

export interface FlwAccount {
  key: AccountKey;
  clientId: string;
  clientSecret: string;
  base: string;
  v3Key: string;
  webhookHash: string;
}

const DEFAULT_BASE = "https://developersandbox-api.flutterwave.com";

export function loadAccounts(env: (name: string) => string | undefined): Record<AccountKey, FlwAccount> {
  const legacyBase = env("FLW_BASE_URL") || DEFAULT_BASE;
  return {
    legacy: {
      key: "legacy",
      clientId: env("FLW_CLIENT_ID") ?? "",
      clientSecret: env("FLW_CLIENT_SECRET") ?? "",
      base: legacyBase,
      v3Key: env("FLW_V3_SECRET_KEY") ?? "",
      webhookHash: env("FLW_WEBHOOK_SECRET_HASH") ?? "",
    },
    business: {
      key: "business",
      clientId: env("FLW_BIZ_CLIENT_ID") ?? "",
      clientSecret: env("FLW_BIZ_CLIENT_SECRET") ?? "",
      base: env("FLW_BIZ_BASE_URL") || legacyBase,
      v3Key: env("FLW_BIZ_V3_SECRET_KEY") ?? "",
      webhookHash: env("FLW_BIZ_WEBHOOK_SECRET_HASH") ?? "",
    },
  };
}

export const isConfigured = (a: FlwAccount): boolean => !!(a.clientId && a.clientSecret);

/**
 * The account new numbers, payouts and name enquiries go through. If the flag says "business" but the business
 * credentials are not there, fall back to legacy (and say so) rather than take every payout down.
 */
export function resolveActive(
  accounts: Record<AccountKey, FlwAccount>,
  flag: string | null | undefined,
  warn: (msg: string) => void = () => {},
): FlwAccount {
  if (String(flag || "").toLowerCase() === "business") {
    if (isConfigured(accounts.business)) return accounts.business;
    warn("flw_active_account=business but the FLW_BIZ_* credentials are missing — using the legacy account");
  }
  return accounts.legacy;
}

/**
 * Which account signed a webhook? Flutterwave sends either the secret hash itself or an HMAC of the body
 * (base64) in the signature header. Business is checked first; an account with no hash configured never matches.
 */
export function identifySigner(
  signature: string,
  rawBody: string,
  accounts: Record<AccountKey, FlwAccount>,
  hmacBase64: (secret: string, body: string) => string,
): AccountKey | null {
  if (!signature) return null;
  for (const key of ["business", "legacy"] as AccountKey[]) {
    const hash = accounts[key].webhookHash;
    if (!hash) continue;
    if (signature === hash || signature === hmacBase64(hash, rawBody)) return key;
  }
  return null;
}

export interface Grace {
  /** the legacy account has been retired: the business account is active AND the deadline has passed */
  retired: boolean;
  /** deadline in ms, or null when none is set */
  until: number | null;
}

/**
 * Grace period for the legacy account. It only ends when a deadline is explicitly set and has passed —
 * a missing or unreadable deadline never retires anything.
 */
export function graceStatus(active: AccountKey, graceUntil: string | null | undefined, now: number = Date.now()): Grace {
  const parsed = graceUntil ? Date.parse(graceUntil) : NaN;
  const until = Number.isFinite(parsed) ? parsed : null;
  return { retired: active === "business" && until !== null && now > until, until };
}
