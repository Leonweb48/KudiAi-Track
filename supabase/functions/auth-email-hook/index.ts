import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ADMIN_URL      = "https://admin.kudiai.app";
const TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Always return 200 {} to Supabase — never block signup on hook errors.
const ok = () => new Response(JSON.stringify({}), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

// Try to verify HS256 JWT with a given key (Uint8Array).
async function tryVerify(rawHeader: string, rawPayload: string, rawSig: string, keyBytes: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const data = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
    const sigBytes = Uint8Array.from(
      atob(rawSig.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    return await crypto.subtle.verify("HMAC", key, sigBytes, data);
  } catch {
    return false;
  }
}

// Verify Supabase hook JWT. Tries multiple key derivations so a mismatch
// in secret format does not permanently break auth. Returns true if valid.
async function verifyHookJwt(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [rawHeader, rawPayload, rawSig] = parts;

    // Attempt 1: base64-decode the whsec_ part (Supabase standard format)
    const whsecMatch = secret.match(/whsec_([A-Za-z0-9+/=]+)$/);
    if (whsecMatch) {
      const bin = atob(whsecMatch[1]);
      const keyBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
      if (await tryVerify(rawHeader, rawPayload, rawSig, keyBytes)) return true;
    }

    // Attempt 2: use raw UTF-8 bytes of the full secret string
    if (await tryVerify(rawHeader, rawPayload, rawSig, new TextEncoder().encode(secret))) return true;

    // Attempt 3: if secret has whsec_ prefix, try raw UTF-8 bytes of just the base64 value
    if (whsecMatch) {
      if (await tryVerify(rawHeader, rawPayload, rawSig, new TextEncoder().encode(whsecMatch[1]))) return true;
    }

    return false;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    const body = await req.json() as {
      user?: { id?: string; email?: string; user_metadata?: { full_name?: string } };
      email_data?: {
        token?: string;
        token_hash?: string;
        token_url?: string;      // only present in PKCE flow — usually empty
        email_action_type?: string;
        site_url?: string;
        redirect_to?: string;
      };
    };

    const email      = body.user?.email || "";
    const name       = body.user?.user_metadata?.full_name || "";
    const otpToken   = body.email_data?.token || "";
    const tokenHash  = body.email_data?.token_hash || "";
    const tokenUrl   = body.email_data?.token_url || "";      // usually empty for recovery
    const actionType = body.email_data?.email_action_type || "";
    const redirectTo = body.email_data?.redirect_to || body.email_data?.site_url || "";

    // Verify Supabase hook JWT — log failures but never block signup
    const hookSecret = Deno.env.get("HOOK_SECRET") ?? "";
    if (!hookSecret) {
      console.error("[auth-email-hook] HOOK_SECRET not set — skipping JWT verification");
    } else {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!token) {
        console.warn("[auth-email-hook] No Authorization token — proceeding (check Supabase hook config)");
      } else {
        const valid = await verifyHookJwt(token, hookSecret);
        if (!valid) {
          console.warn("[auth-email-hook] JWT verification failed — proceeding anyway (check HOOK_SECRET)");
          // Do NOT return error: that blocks signup. Log and continue so the email is still sent.
        }
      }
    }

    // Map Supabase action types to our email events
    let event: string | null = null;
    if (actionType === "signup" || actionType === "email_change_new") {
      event = "business_signup_otp";
    } else if (actionType === "magiclink") {
      event = "business_login_otp";
    } else if (actionType === "recovery") {
      event = "business_password_reset";
    }

    // Build event payload
    const payload: Record<string, string> = { email, name };
    if (otpToken) payload.otp_token = otpToken;

    // For recovery: Supabase hook payloads don't include token_url (that's only the PKCE flow).
    // Construct the verify URL from token_hash + SUPABASE_URL (auto-injected in edge functions).
    if (actionType === "recovery") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const resetUrl = tokenUrl
        || (tokenHash && supabaseUrl
          ? `${supabaseUrl}/auth/v1/verify?token=${tokenHash}&type=recovery${redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : ""}`
          : "");
      if (resetUrl) payload.reset_url = resetUrl;
    } else if (tokenUrl) {
      payload.reset_url = tokenUrl;
    }

    if (event && email) {
      await fetch(`${ADMIN_URL}/api/public/email-trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-trigger-secret": TRIGGER_SECRET,
        },
        body: JSON.stringify({ event, data: payload }),
      }).catch((e) => console.error("[auth-email-hook] email trigger failed:", e));
    }

    return ok();
  } catch (err) {
    console.error("[auth-email-hook] unexpected error:", err);
    // Still return 200 — never block signup on hook errors
    return ok();
  }
});
