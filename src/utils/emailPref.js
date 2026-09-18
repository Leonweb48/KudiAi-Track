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
