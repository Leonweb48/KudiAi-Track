import { trNow } from "../i18n/now";
import { translate } from "../i18n";

// Known backend / SDK error strings → plain-language UI messages.
// Order matters: more specific substrings before broader ones.
// Values are keys in src/i18n/messages.js, shown in the language the user picked.
const KNOWN = {
  // Network
  "Failed to fetch":                 "msg.err.network",
  "Load failed":                     "msg.err.network",
  "NetworkError":                    "msg.err.network",
  "network error":                   "msg.err.network",

  // Paystack / payment
  "Payment not confirmed by Paystack":  "msg.err.paymentNotConfirmed",
  "Payment initialization failed":      "msg.err.paymentNotStarted",
  "Payment couldn't be started":        "msg.err.paymentNotStarted",

  // Account / client
  "Client not found":                   "msg.err.clientNotFound",
  "Your account has no email address":  "msg.err.noEmail",
  "No email on file":                   "msg.err.noEmail",

  // Balance / amounts
  "Insufficient balance":               "msg.err.insufficient",
  "Amount too small after fee":         "msg.err.tooSmallAfterFee",
  "Enter an amount to contribute.":     "msg.err.enterAmount",
  "Amount must be greater than zero":   "msg.err.amountAboveZero",

  // PIN / OTP
  "PIN must be exactly 4 digits":       "msg.err.pin4",
  "Invalid PIN":                        "msg.err.pinWrong",
  "Current PIN is incorrect":           "msg.err.pinCurrentWrong",
  "Invalid OTP":                        "msg.err.otpWrong",
  "OTP has expired":                    "msg.err.otpExpired",

  // Supabase Auth SDK
  "should be at least 6 characters":   "msg.err.password8",
  "Auth session missing":               "msg.err.sessionExpired",
  "only request this after":            "msg.err.waitMoment",
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

const GENERIC = "msg.err.generic";

/**
 * Map any error to a plain-language string safe to show to end users.
 * Technical details are logged to console.error and never shown.
 */
export function friendlyError(e) {
  const out = friendlyKey(e);
  return out.key ? trNow(out.key) : out.text;
}

// { key } for a known message, or { text } for a server message passed through as is.
function friendlyKey(e) {
  if (!e) return { key: GENERIC };
  const raw = e instanceof Error ? (e.message || "") : (typeof e === "string" ? e : "");
  if (!raw) return { key: GENERIC };

  // 1. Network errors (case-insensitive)
  const lower = raw.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("load failed") ||
      lower.includes("networkerror") || lower.includes("network error") ||
      lower.includes("failed to send a request to the edge function")) {
    return { key: "msg.err.network" };
  }

  // 2. Known map (substring match, most-specific first)
  for (const [key, friendly] of Object.entries(KNOWN)) {
    if (raw.includes(key)) return { key: friendly };
  }

  // 3. Looks technical → log and return generic
  if (TECHNICAL.some(p => p.test(raw))) {
    console.error("[kuditrack]", raw);
    return { key: GENERIC };
  }

  // 4. Probably already user-friendly (from our server-side fixes) — pass through
  return { text: raw };
}

/**
 * Same as friendlyError but appends a balance-safety reassurance.
 * Only use when the operation is guaranteed to NOT have moved money.
 */
export function moneyError(e) {
  const out = friendlyKey(e);
  const msg = out.key ? trNow(out.key) : out.text;
  // Don't append if the message already mentions the balance state (checked on the English text)
  const en = out.key ? translate(out.key, "en") : out.text;
  if (en.includes("balance") || en.includes("not affected")) return msg;
  return msg + " " + trNow("msg.err.balanceSafe");
}
