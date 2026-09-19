// auth-email-hook — Supabase Auth "Send Email" hook.
//
// Supabase calls this instead of sending its own auth emails; we forward a
// typed event to the admin email pipeline, which renders and sends it.
//
// SECURITY MODEL
// This function is deployed with --no-verify-jwt (Supabase Auth cannot present
// a user JWT), so it is reachable by anyone who knows the URL. The ONLY thing
// that proves a request really came from Supabase Auth is its signature:
//   • Supabase signs HTTPS hooks with the Standard Webhooks scheme — headers
//     `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC>`
//     over "<id>.<timestamp>.<raw body>", keyed with the hook secret
//     (`v1,whsec_<base64>`, kept in the HOOK_SECRET function secret).
//   • A Bearer HS256 JWT signed with the same secret is also accepted.
// A request that carries neither, or whose signature is wrong, must NEVER cause
// an email: an attacker could otherwise pick the recipient and the reset link
// and have KudiAI's real sender deliver a convincing phishing message.
//
// ENFORCEMENT SWITCH
// `platform_config.auth_hook_enforce`:
//   'true'              → unverified request => return {} immediately, send nothing.
//   anything else / unset → SHADOW mode: verify and log the verdict, but still
//                        process the request. Exists only so the very first
//                        rollout can prove, against real Supabase traffic, that
//                        HOOK_SECRET matches what the dashboard signs with —
//                        enforcing with a mismatched secret would silently stop
//                        every signup, login and password-reset email.
// Every verdict is written to email_delivery_log as "[auth-hook] …" while not
// enforcing; failures are always logged.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ADMIN_URL      = "https://admin.kudiai.app";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || SERVICE_KEY;

// Always answer 200 {} — never surface an error into the auth flow.
const ok = () => new Response(JSON.stringify({}), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

const enc = new TextEncoder();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(keyBytes: Uint8Array, data: string): Promise<ArrayBuffer> {
  // new Uint8Array(...) copies into a plain ArrayBuffer, which is what WebCrypto's BufferSource type wants.
  const key = await crypto.subtle.importKey("raw", new Uint8Array(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", key, new Uint8Array(enc.encode(data)));
}

function bytesToB64(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

// Candidate HMAC keys derived from the stored secret. Supabase documents
// `v1,whsec_<base64>` (key = the decoded base64); a raw string secret is also
// tried so a slightly different dashboard format does not break verification.
function candidateKeys(secret: string): Uint8Array[] {
  const stripped = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  const keys: Uint8Array[] = [];
  try { keys.push(b64ToBytes(stripped)); } catch { /* not base64 */ }
  keys.push(enc.encode(stripped));
  keys.push(enc.encode(secret));
  return keys;
}

// ── Standard Webhooks (what Supabase Auth hooks send) ────────────────────────
async function verifyStandardWebhook(headers: Headers, rawBody: string, secret: string): Promise<boolean> {
  const id  = headers.get("webhook-id");
  const ts  = headers.get("webhook-timestamp");
  const sig = headers.get("webhook-signature");
  if (!id || !ts || !sig) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) return false; // replay window

  const signed = `${id}.${ts}.${rawBody}`;
  const provided = sig.split(" ").map((p) => p.trim()).filter(Boolean);
  for (const keyBytes of candidateKeys(secret)) {
    const expected = bytesToB64(await hmac(keyBytes, signed));
    for (const part of provided) {
      const [ver, value] = part.split(",");
      if (ver === "v1" && value && timingSafeEqual(value, expected)) return true;
    }
  }
  return false;
}

// ── Bearer HS256 JWT signed with the hook secret (older/alternate config) ────
async function verifyHookJwt(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [rawHeader, rawPayload, rawSig] = parts;
    const data = `${rawHeader}.${rawPayload}`;
    for (const keyBytes of candidateKeys(secret)) {
      const expected = bytesToB64(await hmac(keyBytes, data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (timingSafeEqual(rawSig, expected)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

type Verdict = "pass_standard_webhooks" | "pass_jwt" | "fail_bad_signature" | "fail_no_signature" | "fail_no_secret";

async function verify(req: Request, rawBody: string, secret: string): Promise<Verdict> {
  if (!secret) return "fail_no_secret";
  const hasWebhookHeaders = !!(req.headers.get("webhook-id") && req.headers.get("webhook-signature"));
  if (hasWebhookHeaders) {
    return (await verifyStandardWebhook(req.headers, rawBody, secret)) ? "pass_standard_webhooks" : "fail_bad_signature";
  }
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer) return (await verifyHookJwt(bearer, secret)) ? "pass_jwt" : "fail_bad_signature";
  return "fail_no_signature";
}

// ── Enforcement switch (platform_config.auth_hook_enforce) ───────────────────
let _enforce = false;
let _enforceAt = 0;
async function enforcing(): Promise<boolean> {
  if (Date.now() - _enforceAt < 30_000) return _enforce;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/platform_config?key=eq.auth_hook_enforce&select=value`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (r.ok) {
      const rows = await r.json() as Array<{ value: string }>;
      _enforce = String(rows?.[0]?.value ?? "").toLowerCase() === "true";
      _enforceAt = Date.now();
    }
  } catch { /* keep the last known value */ }
  return _enforce;
}

// Best-effort audit row; never allowed to break or delay the auth flow.
async function logHook(passed: boolean, verdict: string, actionType: string, enforce: boolean): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/email_delivery_log`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        to_email:  "auth-hook",
        subject:   `[auth-hook] ${passed ? "signature VERIFIED" : "signature REJECTED"} (${verdict}) action=${actionType || "?"} enforce=${enforce}`,
        status:    passed ? "sent" : "failed",
        error_msg: passed ? null : verdict,
        smtp_host: "auth-email-hook",
      }),
    });
  } catch { /* ignore */ }
}

// A reset/verify link is only ever built from what WE trust, never taken from
// the request body as-is.
const ALLOWED_REDIRECT_HOST = /^(https:\/\/([a-z0-9-]+\.)*kudiai\.app|http:\/\/localhost(:\d+)?|capacitor:\/\/localhost)(\/|$)/i;

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    const raw = await req.text();

    const secret  = Deno.env.get("HOOK_SECRET") ?? "";
    const verdict = await verify(req, raw, secret);
    const passed  = verdict.startsWith("pass");
    const enforce = await enforcing();

    let body: {
      user?: { id?: string; email?: string; new_email?: string; user_metadata?: { full_name?: string } };
      email_data?: {
        token?: string; token_new?: string; token_hash?: string; token_url?: string;
        email_action_type?: string; site_url?: string; redirect_to?: string;
      };
    };
    try { body = JSON.parse(raw); } catch { return ok(); }

    const actionType = body.email_data?.email_action_type || "";

    if (!passed) {
      await logHook(false, verdict, actionType, enforce);
      console.error(`[auth-email-hook] ${verdict} — ${enforce ? "REJECTED: no email sent" : "shadow mode: enforcement is off, processing anyway"}`);
      if (enforce) return ok();          // unverified => never send anything
    } else if (!enforce) {
      await logHook(true, verdict, actionType, enforce);   // observation period only
    }

    const email      = body.user?.email || "";
    const name       = body.user?.user_metadata?.full_name || "";
    const otpToken   = body.email_data?.token || "";
    const tokenHash  = body.email_data?.token_hash || "";
    const tokenUrl   = body.email_data?.token_url || "";
    const redirectTo = body.email_data?.redirect_to || body.email_data?.site_url || "";

    // Map Supabase action types to our email events
    let event: string | null = null;
    let recipient = email;
    let code = otpToken;
    if (actionType === "signup") {
      event = "business_signup_otp";
    } else if (actionType === "magiclink") {
      event = "business_login_otp";
    } else if (actionType === "recovery") {
      event = "business_password_reset";
    } else if (actionType === "email_change_new" || actionType === "email_change") {
      event = "business_email_change_otp";
      recipient = body.user?.new_email || email;            // the address being verified
      code = body.email_data?.token_new || otpToken;
    } else if (actionType === "email_change_current") {
      event = "business_email_change_otp";
    }

    const payload: Record<string, string> = { email: recipient, name };
    if (code) payload.otp_token = code;

    if (actionType === "recovery") {
      const safeRedirect = ALLOWED_REDIRECT_HOST.test(redirectTo) ? redirectTo : "";
      const built = tokenHash && SUPABASE_URL
        ? `${SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=recovery${safeRedirect ? `&redirect_to=${encodeURIComponent(safeRedirect)}` : ""}`
        : "";
      // Only trust a supplied link if it points at our own Supabase project.
      const supplied = tokenUrl && SUPABASE_URL && tokenUrl.startsWith(`${SUPABASE_URL}/auth/v1/verify`) ? tokenUrl : "";
      const resetUrl = supplied || built;
      if (resetUrl) payload.reset_url = resetUrl;
    }

    if (event && recipient) {
      await fetch(`${ADMIN_URL}/api/public/email-trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": TRIGGER_SECRET },
        body: JSON.stringify({ event, data: payload }),
      }).catch((e) => console.error("[auth-email-hook] email trigger failed:", e));
    }

    return ok();
  } catch (err) {
    console.error("[auth-email-hook] unexpected error:", err);
    return ok();
  }
}

// Tests import this module without starting a server.
if (Deno.env.get("AUTH_HOOK_TEST") !== "1") serve(handle);
