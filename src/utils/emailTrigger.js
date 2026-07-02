import { supabase } from "./supabase";

/**
 * Fire email via the /api/email-trigger Vercel serverless function.
 * Same-origin call — no CORS, no proxy header stripping.
 * JWT is validated server-side before the admin email-trigger is called.
 */
export async function sendEmailTrigger(event, data) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    fetch("/api/email-trigger", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ event, data }),
    }).catch(e => console.warn("[Email] trigger failed:", e));
  } catch (e) {
    console.warn("[Email] trigger failed:", e);
  }
}
