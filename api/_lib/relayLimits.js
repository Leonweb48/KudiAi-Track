// Guards for /api/email-trigger, which any logged-in user can call: without them a free account is a spam / phishing
// relay from the company domain. Pure functions so they can be tested without Vercel or Supabase.

// Generous for real use (a busy Ajo agent recording a few dozen contributions an hour), painful for abuse.
export const RELAY_LIMITS = { hourThirdParty: 150, hourTotal: 500, dayThirdParty: 800 };

// One plain address — no lists ("a@x.com, b@y.com"), display names, angle brackets or whitespace. A comma-separated
// "to" would otherwise turn one counted send into many recipients.
export function singleEmail(value) {
  const a = String(value ?? "").trim();
  if (a.length < 6 || a.length > 254) return null;
  if (!/^[^\s,;<>()[\]"'\\@]+@[^\s,;<>()[\]"'\\@]+\.[^\s,;<>()[\]"'\\@]+$/.test(a)) return null;
  return a;
}

// How many distinct recipients, and how many of them are someone other than the caller.
export function countRecipients(recipients, ownEmail) {
  const own = String(ownEmail || "").trim().toLowerCase();
  const seen = new Set(recipients.map((r) => String(r).trim().toLowerCase()));
  const third = [...seen].filter((r) => r !== own).length;
  return { total: seen.size, third };
}

// `usage` is the row from email_relay_quota (or null when it could not be read → never block real mail on an outage).
export function overQuota(usage) {
  if (!usage) return null;
  const { hour_third = 0, hour_total = 0, day_third = 0 } = usage;
  if (hour_third >= RELAY_LIMITS.hourThirdParty) return "hourly limit for emails to other people reached";
  if (hour_total >= RELAY_LIMITS.hourTotal)      return "hourly email limit reached";
  if (day_third  >= RELAY_LIMITS.dayThirdParty)  return "daily limit for emails to other people reached";
  return null;
}
