import { supabase } from "./supabase";

/**
 * Whether this user still wants the client-triggered emails (daily summary,
 * low-stock alert, bill-payment success). Fails OPEN: no row, no column yet,
 * or any query error all mean "allowed" — a preference lookup hiccup must
 * never silently drop mail the user hasn't opted out of.
 */
export async function emailAllowed(userId) {
  if (!userId) return true;
  try {
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("email_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return true;
    return data?.email_enabled !== false;
  } catch {
    return true;
  }
}

/**
 * Once-per-period claim for the emails the app sends on first load (daily profit summary, overdue digest, weekly
 * nudge). localStorage alone only stops ONE device from repeating them — a new device, another browser or a cleared
 * cache sent the email again — so the winner is decided on the server: the first caller for a (kind, bucket) gets
 * true, every other device gets false. Callers keep their localStorage check as a cheap first gate.
 *
 * Fails OPEN (true) when the server can't be asked, like emailAllowed: the worst case is the old once-per-device
 * behaviour, never a silently dropped email.
 */
export async function claimEmailOnce(
  kind,
  bucket,
  rpc = (k, b) => supabase.rpc("claim_daily_email", { p_kind: k, p_bucket: b }),
) {
  try {
    const { data, error } = await rpc(kind, bucket);
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}
