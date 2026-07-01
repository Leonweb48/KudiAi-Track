import { supabase } from "./supabase";

/**
 * Fire-and-forget email trigger via the server-side edge function proxy.
 * The secret never touches the client bundle — it lives only in Supabase secrets.
 */
export function sendEmailTrigger(event, data) {
  supabase.functions.invoke("email-trigger", { body: { event, data } })
    .then(({ error }) => { if (error) console.warn("[Email]", event, error.message); })
    .catch(e => console.warn("[Email] trigger failed:", e));
}
