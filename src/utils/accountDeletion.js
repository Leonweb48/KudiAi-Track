import { supabase } from "./supabase";

/**
 * Calls the account-delete edge function. Always resolves { ok, status, data } — `data` is the parsed JSON body even for a 4xx/5xx
 * (the function answers 403 wrong_password / 409 blocked with a body the screen needs), and a network failure becomes a plain message.
 */
export async function callAccountDelete(body, client = supabase) {
  try {
    const { data, error } = await client.functions.invoke("account-delete", { body });
    if (!error) return { ok: data?.ok !== false, status: 200, data: data || {} };
    let parsed = {};
    let status = 0;
    try {
      status = error.context?.status || 0;
      parsed = (await (error.context?.clone ? error.context.clone().json() : error.context?.json?.())) || {};
    } catch { /* body was not JSON */ }
    return { ok: false, status, data: parsed };
  } catch {
    return { ok: false, status: 0, data: { error: "Network problem. Check your connection and try again." } };
  }
}

/** The plain-language "what gets erased" lines for the kinds of account this person has. */
export function erasedLines(kinds = []) {
  const k = new Set(kinds);
  const lines = ["Your name, phone number, email address and photos", "Your PINs and saved bank details"];
  if (k.has("owner")) lines.push("The names, phone numbers and addresses of the customers, debtors and clients in your books");
  if (k.has("ajo_client")) lines.push("Your savings profile — address, next of kin and ID numbers");
  if (k.has("coop_member")) lines.push("Your cooperative membership details");
  lines.push("Your notifications and sign-in on every device");
  return lines;
}
