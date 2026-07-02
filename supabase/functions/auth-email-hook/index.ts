import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ADMIN_URL      = "https://admin.kudiai.app";
const TRIGGER_SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Verify a HS256 JWT using Deno Web Crypto (no external deps)
async function verifyHS256(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const [rawHeader, rawPayload, rawSig] = token.split(".");
    if (!rawHeader || !rawPayload || !rawSig) return null;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const data = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
    const sigBytes = Uint8Array.from(
      atob(rawSig.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );

    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, data);
    if (!valid) return null;

    return JSON.parse(atob(rawPayload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    // Verify Supabase hook JWT — reject all requests when secret is not configured
    const hookSecret = Deno.env.get("HOOK_SECRET") ?? "";
    if (!hookSecret) {
      console.error("[auth-email-hook] HOOK_SECRET env var not set — rejecting request");
      return new Response(JSON.stringify({ error: "Hook not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const payload = await verifyHS256(token, hookSecret);
    if (!payload) {
      return new Response(JSON.stringify({ error: "Invalid hook signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as {
      user?: { id?: string; email?: string; user_metadata?: { full_name?: string } };
      email_data?: {
        token?: string;
        email_action_type?: string;
      };
    };

    const email          = body.user?.email || "";
    const name           = body.user?.user_metadata?.full_name || "";
    const otpToken       = body.email_data?.token || "";
    const actionType     = body.email_data?.email_action_type || "";

    // Map Supabase action types to our email events
    let event: string | null = null;
    if (actionType === "signup" || actionType === "email_change_new") {
      event = "business_signup_otp";
    } else if (actionType === "magiclink") {
      event = "business_login_otp";
    }
    // For "recovery" (password reset) and "invite", let Supabase handle it normally
    // by not sending an event — they use different UX flows

    if (event && email && otpToken) {
      // Fire-and-forget — don't block the hook response
      fetch(`${ADMIN_URL}/api/public/email-trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-trigger-secret": TRIGGER_SECRET,
        },
        body: JSON.stringify({ event, data: { email, name, otp_token: otpToken } }),
      }).catch(() => null);
    }

    // Returning {} with 200 tells Supabase we handled the email
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[auth-email-hook]", err);
    // Returning an error causes Supabase to fallback to its own email
    return new Response(JSON.stringify({ error: "Hook failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
