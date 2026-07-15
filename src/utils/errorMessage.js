const PATTERNS = [
  // Auth (Supabase auth SDK messages)
  [/invalid login credentials/i,           "Wrong email or password."],
  [/email not confirmed/i,                 "Please verify your email before signing in."],
  [/user already registered/i,             "An account with this email already exists."],
  [/password should be at least/i,         "Password must be at least 6 characters."],
  [/for security purposes.*only request/i, "Please wait a moment before requesting another code."],
  [/email rate limit exceeded/i,           "Too many requests — please wait a few minutes."],
  [/token has expired or is invalid/i,     "This link has expired. Please request a new one."],
  [/user not found/i,                      "No account found with this email."],
  [/new password should be different/i,    "Please choose a different password."],
  [/signup is disabled/i,                  "Sign-ups are currently disabled."],
  // Network
  [/failed to fetch/i,                     "Connection lost. Please check your internet."],
  [/networkerror/i,                        "Connection lost. Please check your internet."],
  [/load failed/i,                         "Connection lost. Please check your internet."],
  // Supabase DB / PostgREST
  [/duplicate key value violates unique/i, "This record already exists."],
  [/violates foreign key constraint/i,     "This item is linked to other records and cannot be removed."],
  [/violates not-null constraint/i,        "A required field is missing."],
  [/value too long/i,                      "One of your inputs is too long."],
  [/violates row-level security/i,         "You don't have permission to do this."],
  [/jwt expired/i,                         "Your session has expired. Please sign in again."],
  [/invalid claim: missing sub claim/i,    "Your session has expired. Please sign in again."],
  [/violates check constraint/i,           "One of the values entered is not valid."],
  [/edge function returned a non-2xx/i,    "Service error. Please try again."],
];

export function friendlyError(e, fallback = "Something went wrong. Please try again.") {
  const msg = (typeof e === "string" ? e : e?.message) || "";
  for (const [pattern, human] of PATTERNS) {
    if (pattern.test(msg)) return human;
  }
  return fallback;
}
