// account-delete — in-app account deletion (Google Play requires it) and the public "delete my data" request form.
//
//   check   (signed in)  → what kind of account this is and what still blocks deletion (money, transfers, savings, staff, clients …)
//   delete  (signed in)  → { password, confirm: true } — re-authenticates, erases (account_erase), removes uploaded photos, emails a confirmation
//   request (public)     → { email, phone?, full_name?, note?, website? } — records a request for someone who can no longer sign in
//
// Policy ("block until zero"): nothing is deleted while the person still has money in the wallet, a transfer in flight, savings, an open loan,
// staff, Ajo clients or a cooperative. All the rules live in SQL (account_deletion_check / account_erase, service-role only, self-tested on the
// real schema); this function only authenticates, rate-limits, calls them and cleans up files.
// The auth user is banned + tombstoned by account_erase, never deleted (43 tables cascade from it and financial records must be kept).
//
// Deployed WITH JWT verification (the public form sends the anon key); the signed-in actions still validate the user themselves.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";
import { bankEmail, cleanSubject, htmlToText } from "../_shared/bankEmail.ts";
import { cleanText, clientIp, storageTargets, validEmail } from "../_shared/accountDelete.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Sb = any;

/** false when this key has used up its allowance for the window. Fails OPEN if the limiter itself errors (the password check is the real gate). */
async function within(sb: Sb, key: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("rate_limit_hit", { p_key: key.slice(0, 200), p_window_seconds: windowSeconds, p_max: max });
    if (error) return true;
    return data !== false;
  } catch { return true; }
}

async function sendConfirmation(sb: Sb, to: string, kinds: string[]) {
  try {
    const { data: smtp } = await sb.from("smtp_config").select("*").limit(1).maybeSingle();
    if (!smtp || !to) return;
    const html = bankEmail({
      title: "Account Deleted", tone: "neutral", timestamp: new Date(),
      intro: "Your KudiAI Track account has been deleted at your request. Your name, phone number, email address, photos and PINs have been erased and you can no longer sign in.",
      rows: [["Account type", kinds.includes("owner") ? "Business" : kinds.includes("staff") ? "Staff" : kinds.includes("ajo_client") ? "Savings client" : kinds.includes("coop_member") ? "Cooperative member" : "Account"]],
      note: "As required for financial records, a de-identified history of transactions is kept. If you did not ask for this, contact support right away.",
      preheader: "Your KudiAI Track account was deleted",
    });
    const transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.encryption === "ssl",
      auth: { user: smtp.username, pass: smtp.password },
    });
    await transport.sendMail({ from: `"${smtp.from_name || "KudiAI Track"}" <${smtp.from_email}>`, to, subject: cleanSubject("Your KudiAI Track account was deleted"), html, text: htmlToText(html) });
  } catch (e) { console.warn("[account-delete] confirmation email failed:", (e as Error).message); }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Supabase secrets not configured");
    const admin: Sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
    const action = String(body.action || "");

    // ── public: a request from someone who cannot sign in ─────────────────────────────────────────────────────
    if (action === "request") {
      if (body.website) return json({ ok: true });                       // honeypot: bots fill every field
      const email = cleanText(body.email, 200).toLowerCase();
      if (!validEmail(email)) return json({ ok: false, error: "Enter the email address you used on KudiAI Track." }, 400);
      const ip = clientIp(req.headers);
      if (!(await within(admin, `acctdelreq:ip:${ip}`, 3600, 5))) return json({ ok: false, error: "Too many requests. Try again later." }, 429);
      if (!(await within(admin, `acctdelreq:all`, 3600, 300))) return json({ ok: false, error: "Too many requests. Try again later." }, 429);
      if (!(await within(admin, `acctdelreq:email:${email}`, 86400, 2))) return json({ ok: true });   // already received; say nothing new
      const { error } = await admin.from("account_deletion_requests").insert({
        email, phone: cleanText(body.phone, 40) || null, full_name: cleanText(body.full_name, 120) || null,
        note: cleanText(body.note, 1000) || null, source: "web",
      });
      if (error) { console.error("[account-delete] request insert failed:", error.message); return json({ ok: false, error: "Could not record your request. Please email support." }, 500); }
      return json({ ok: true });
    }

    if (action !== "check" && action !== "delete") return json({ error: "Unknown action" }, 400);

    // ── signed-in actions ─────────────────────────────────────────────────────────────────────────────────────
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sign in to continue." }, 401);
    const caller = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: ud, error: ue } = await caller.auth.getUser(token);
    const user = ud?.user;
    if (ue || !user) return json({ error: "Your session has expired. Sign in again." }, 401);
    const uid = user.id;

    if (action === "check") {
      if (!(await within(admin, `acctdel:check:${uid}`, 3600, 60))) return json({ error: "Too many requests." }, 429);
      const { data, error } = await admin.rpc("account_deletion_check", { p_user_id: uid });
      if (error) { console.error("[account-delete] check failed:", error.message); return json({ error: "Could not check your account. Try again." }, 500); }
      return json({ ok: true, ...data });
    }

    // action === "delete"
    if (body.confirm !== true) return json({ error: "Confirmation required." }, 400);
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) return json({ ok: false, code: "password_required", error: "Enter your password to confirm." }, 400);
    if (!(await within(admin, `acctdel:delete:${uid}`, 900, 6))) return json({ ok: false, code: "rate_limited", error: "Too many attempts. Try again in a few minutes." }, 429);
    if (!user.email) return json({ ok: false, error: "This account has no email to confirm with. Contact support." }, 400);

    // re-authenticate with the account password (every account kind signs in with email + password)
    const verifier = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: pwErr } = await verifier.auth.signInWithPassword({ email: user.email, password });
    if (pwErr) {
      if ((pwErr as { status?: number }).status === 429) return json({ ok: false, code: "rate_limited", error: "Too many attempts. Try again in a few minutes." }, 429);
      return json({ ok: false, code: "wrong_password", error: "That password is not correct." }, 403);
    }

    const email = user.email;
    const { data: res, error: eraseErr } = await admin.rpc("account_erase", { p_user_id: uid });
    if (eraseErr) {
      if (eraseErr.code === "P0001" && /blockers remain/.test(eraseErr.message || "")) {
        const { data: chk } = await admin.rpc("account_deletion_check", { p_user_id: uid });
        return json({ ok: false, code: "blocked", error: "Your account still has something open.", blockers: chk?.blockers ?? [] }, 409);
      }
      console.error("[account-delete] erase failed:", eraseErr.message);
      return json({ ok: false, error: "We could not delete the account. Nothing was changed. Try again, or contact support." }, 500);
    }

    // uploaded photos / documents (their URLs are already erased from the database; this removes the files themselves)
    const targets = storageTargets((res?.files as unknown[]) || [], supabaseUrl);
    for (const [bucket, paths] of Object.entries(targets)) {
      try {
        const { error } = await admin.storage.from(bucket).remove(paths);
        if (error) console.warn(`[account-delete] storage cleanup (${bucket}):`, error.message);
      } catch (e) { console.warn(`[account-delete] storage cleanup (${bucket}):`, (e as Error).message); }
    }

    if (!res?.already_deleted) await sendConfirmation(admin, email, (res?.kinds as string[]) || []);   // awaited: the isolate can stop right after the response
    return json({ ok: true });
  } catch (e) {
    console.error("[account-delete] unexpected:", (e as Error).message);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
