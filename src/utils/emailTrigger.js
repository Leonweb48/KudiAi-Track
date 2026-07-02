import { supabase } from "./supabase";

const DIRECT_URL = process.env.REACT_APP_SUPABASE_URL;
const ANON_KEY   = process.env.REACT_APP_SUPABASE_ANON_KEY;

/**
 * Fire email via Supabase edge function, bypassing the Vercel /sb proxy.
 * The proxy strips the Authorization header on external rewrites, causing 401s.
 * We call the edge function URL directly so the JWT reaches the function intact.
 */
export async function sendEmailTrigger(event, data) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    fetch(`${DIRECT_URL}/functions/v1/email-trigger`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey":        ANON_KEY,
      },
      body: JSON.stringify({ event, data }),
    }).catch(e => console.warn("[Email] trigger failed:", e));
  } catch (e) {
    console.warn("[Email] trigger failed:", e);
  }
}
