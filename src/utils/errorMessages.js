// Known backend / SDK error strings → plain-language UI messages.
// Order matters: more specific substrings before broader ones.
const KNOWN = {
  // Network
  "Failed to fetch":                 "Check your connection and try again.",
  "Load failed":                     "Check your connection and try again.",
  "NetworkError":                    "Check your connection and try again.",
  "network error":                   "Check your connection and try again.",

  // Paystack / payment
  "Payment not confirmed by Paystack":  "Payment wasn't confirmed — your balance was not affected. Tap Retry if you completed the payment.",
  "Payment initialization failed":      "Payment couldn't be started — please try again.",

  // Account / client
  "Client not found":                   "We couldn't find your account — please sign out and sign back in.",
  "Your account has no email address":  "You don't have an email on file — ask your savings agent to add one.",
  "No email on file":                   "You don't have an email on file — ask your savings agent to add one.",

  // Balance / amounts
  "Insufficient balance":               "You don't have enough balance for this amount.",
  "Amount too small after fee":         "The amount is too small — the fee would use it all up.",
  "Enter an amount to contribute.":     "Enter an amount to continue.",
  "Amount must be greater than zero":   "Enter an amount greater than zero.",

  // PIN / OTP
  "PIN must be exactly 4 digits":       "Your PIN must be exactly 4 digits.",
  "Invalid PIN":                        "Incorrect PIN — try again.",
  "Current PIN is incorrect":           "That PIN isn't right — try again.",
  "Invalid OTP":                        "That code isn't right — check and try again.",
  "OTP has expired":                    "This code has expired — tap Resend to get a new one.",

  // Supabase Auth SDK
  "should be at least 6 characters":   "Password must be at least 8 characters.",
  "Auth session missing":               "Your session has expired — please sign out and sign back in.",
  "only request this after":            "Please wait a moment before trying again.",
};

// Raw-technical patterns — these should never reach the user directly.
const TECHNICAL = [
  /\bDB error\b/i,
  /\bpostgres(ql)?\b/i,
  /TypeError:/,
  /\bsyntax error\b/i,
  /column .* does not exist/i,
  /relation .* does not exist/i,
  /at Object\./,
  /\bstack trace\b/i,
];

const GENERIC = "Something went wrong — please try again.";

/**
 * Map any error to a plain-language string safe to show to end users.
 * Technical details are logged to console.error and never shown.
 */
export function friendlyError(e) {
  if (!e) return GENERIC;
  const raw = e instanceof Error ? (e.message || "") : (typeof e === "string" ? e : "");
  if (!raw) return GENERIC;

  // 1. Network errors (case-insensitive)
  const lower = raw.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("load failed") ||
      lower.includes("networkerror") || lower.includes("network error") ||
      lower.includes("failed to send a request to the edge function")) {
    return "Check your connection and try again.";
  }

  // 2. Known map (substring match, most-specific first)
  for (const [key, friendly] of Object.entries(KNOWN)) {
    if (raw.includes(key)) return friendly;
  }

  // 3. Looks technical → log and return generic
  if (TECHNICAL.some(p => p.test(raw))) {
    console.error("[kuditrack]", raw);
    return GENERIC;
  }

  // 4. Probably already user-friendly (from our server-side fixes) — pass through
  return raw;
}

/**
 * Same as friendlyError but appends a balance-safety reassurance.
 * Only use when the operation is guaranteed to NOT have moved money.
 */
export function moneyError(e) {
  const msg = friendlyError(e);
  // Don't append if the message already mentions the balance state
  if (msg.includes("balance") || msg.includes("not affected")) return msg;
  return msg + " Your balance was not affected.";
}
