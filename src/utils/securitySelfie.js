import { supabase } from "./supabase";

/**
 * Records a live selfie against a risky moment (a PIN reset, a new device signing in, a large transfer) via the
 * security-selfie edge function. This is evidence only — deterrence + a dispute trail — never a match/verdict:
 * there is nothing to compare a fresh selfie against without either storing a reference photo or re-collecting the
 * BVN/NIN and paying for a fresh Youverify lookup every time, so it always succeeds once a real photo is captured;
 * it can never reject someone for "not looking right". See supabase/migrations/20270231000000_security_selfie_events.sql.
 *
 * kind: "pin_reset" | "new_device" | "large_transfer". context: a small, non-sensitive detail (amount, masked
 * recipient, device/browser) — the server drops anything else, so there's no reason to send more than it needs.
 * Returns { ok: true } or { ok: false, error }; never throws.
 */
export async function submitSecuritySelfie(kind, selfie, context = {}) {
  try {
    const { data, error } = await supabase.functions.invoke("security-selfie", { body: { action: "submit", kind, selfie, context } });
    if (error) return { ok: false, error: error.message || "Couldn't record this — please try again." };
    if (!data?.success) return { ok: false, error: data?.error || "Couldn't record this — please try again." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Couldn't record this — please try again." };
  }
}
