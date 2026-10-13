// Bank list + account-name lookup through Flutterwave (2026-10-13 — the last app screens still used Paystack for this:
// Ajo payout accounts, invoice payment details). Returns the SAME shape the old `functions.invoke("paystack", …)` calls
// returned, so those screens only swap the call:
//   list-banks      → { data: { data: [{ code, name }] }, error }
//   resolve-account → { data: { status: true, data: { account_name } } }  or  { data: { status: false, message } }
// Note: a few fintech bank codes differ between Paystack and Flutterwave; screens that saved a Paystack code earlier
// match banks by name where it matters.
import { supabase } from "./supabase";

export async function bankLookup(action, body = {}) {
  if (action === "list-banks") {
    const { data, error } = await supabase.functions.invoke("flutterwave", { body: { action: "list-banks" } });
    const banks = (data?.banks || []).map((b) => ({ code: String(b.code), name: b.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { data: { data: banks }, error };
  }
  if (action === "resolve-account") {
    const { data, error } = await supabase.functions.invoke("flutterwave", {
      body: { action: "resolve-account", bank_code: body.bank_code, account_number: body.account_number },
    });
    if (data?.ok && data.account_name) return { data: { status: true, data: { account_name: data.account_name } }, error: null };
    let message = data?.error || "";
    if (!message && error) {
      try { message = (await error.context?.json?.())?.error || ""; } catch { /* keep default */ }
    }
    return { data: { status: false, message: message || "Could not verify account" }, error: null };
  }
  throw new Error(`bankLookup: unknown action ${action}`);
}
