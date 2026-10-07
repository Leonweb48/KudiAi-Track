// "Open a KudiAI Wallet" with Google. A Google account carries no account_type, so the choice made on the sign-in screen
// (the business the person is saving with, and their phone) is kept on this device while Google signs them in. Once the
// session exists, useAuth calls finishGoogleWalletSignup: it registers them with that business as a savings client
// (ajo-portal "self-register", the same step the email sign-up uses) and marks the account as one, so every later
// sign-in goes to the client portal. An account that is already a business, staff member or someone else's client is
// left exactly as it is.

export const GOOGLE_WALLET_KEY = "kuditrack_google_wallet_signup";
const MAX_AGE_MS = 30 * 60 * 1000;   // a choice from an abandoned Google sign-in must not turn a later one into a client

export function saveGoogleWalletChoice({ businessId, phone }, now = Date.now()) {
  try { localStorage.setItem(GOOGLE_WALLET_KEY, JSON.stringify({ business_id: businessId, phone: (phone || "").trim(), at: now })); }
  catch { /* storage unavailable: the sign-in then goes ahead as a normal Google sign-in */ }
}

export function clearGoogleWalletChoice() {
  try { localStorage.removeItem(GOOGLE_WALLET_KEY); } catch { /* storage unavailable */ }
}

export function hasGoogleWalletChoice() {
  try { return !!localStorage.getItem(GOOGLE_WALLET_KEY); } catch { return false; }
}

/** Reads and REMOVES the stored choice (one attempt only); null when there is none, it is stale or unreadable. */
export function takeGoogleWalletChoice(now = Date.now()) {
  let raw = null;
  try { raw = localStorage.getItem(GOOGLE_WALLET_KEY); localStorage.removeItem(GOOGLE_WALLET_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (!c?.business_id || !(now - Number(c.at) >= 0 && now - Number(c.at) <= MAX_AGE_MS)) return null;
    return c;
  } catch { return null; }
}

/** The session as the client portal routing expects it: account_type ajo_client in the user metadata. */
const asClient = (sess, fullName) => ({
  ...sess,
  user: { ...sess.user, user_metadata: { ...(sess.user.user_metadata || {}), account_type: "ajo_client", ...(fullName ? { full_name: fullName } : {}) } },
});

/** Marks this account as a savings client (best-effort: useAuth also restores it from the linked client record). */
export async function markAsClient(supabase, sess, fullName) {
  try { await supabase.auth.updateUser({ data: { account_type: "ajo_client", ...(fullName ? { full_name: fullName } : {}) } }); }
  catch { /* restored on a later sign-in from the client record linked to this account */ }
  return asClient(sess, fullName);
}

/**
 * Finishes a Google "Open a KudiAI Wallet" sign-up for this session.
 *   { status: "skip" }                 not a Google sign-in, or the account already is something else: route as usual
 *   { status: "done", session }        registered (or already linked): route this session, now a savings client
 *   { status: "failed", message }      the registration didn't go through: sign out and show the message
 */
export async function finishGoogleWalletSignup(supabase, sess, choice) {
  const user = sess?.user;
  const provider = user?.app_metadata?.provider;
  if (!user || !choice || !provider || provider === "email") return { status: "skip" };
  const uid = user.id;
  const email = (user.email || "").toLowerCase();

  const [{ data: profile }, { data: staffByUser }, { data: staffByEmail }, { data: clientByEmail }] = await Promise.all([
    supabase.from("profiles").select("business_name").eq("id", uid).maybeSingle(),
    supabase.from("staff").select("id").eq("user_id", uid).maybeSingle(),
    email ? supabase.from("staff").select("id").eq("email", email).maybeSingle() : Promise.resolve({ data: null }),
    email ? supabase.from("aso_clients").select("id, client_user_id").eq("email", email).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (profile?.business_name || staffByUser || staffByEmail) return { status: "skip" };   // already a business or staff
  if (clientByEmail) {
    if (clientByEmail.client_user_id === uid) return { status: "done", session: await markAsClient(supabase, sess) };
    return { status: "skip" };   // a client record of another login: the usual "use your email and password" rule applies
  }

  const meta = user.user_metadata || {};
  const fullName = String(meta.full_name || meta.name || email.split("@")[0] || "").trim();
  let reg = null;
  try {
    const { data, error } = await supabase.functions.invoke("ajo-portal", {
      body: { action: "self-register", business_id: choice.business_id, full_name: fullName, phone: choice.phone || "" },
    });
    if (!error && data?.ok) reg = data;
  } catch { /* reported below */ }
  if (!reg) return { status: "failed", message: "We couldn't open your KudiAI Wallet just now. Please try again." };
  return { status: "done", session: await markAsClient(supabase, sess, fullName) };
}
