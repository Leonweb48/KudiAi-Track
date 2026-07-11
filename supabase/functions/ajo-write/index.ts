// ajo-write — PIN-gated atomic write edge function for Ajo money operations.
//
// Why this exists (not a SQL parameter):
//   PIN hashes are PBKDF2-SHA256 via Web Crypto (see pin-manager/index.ts).
//   PostgreSQL has no PBKDF2 primitive, so verification must happen here.
//   This function: verifies PIN → calls service-role SQL RPC → returns result.
//   Calling the RPC without going through this function requires a service-role
//   key, which is equivalent to bypassing PIN at the infrastructure level.
//
// Actions handled:
//   record_contribution  — no PIN (contributions are not PIN-gated)
//   record_withdrawal    — PIN required
//   reverse_contribution — PIN required
//   archive_client       — PIN required
//
// Each action maps to a SECURITY DEFINER SQL RPC deployed in migration 000004.
//
// Authorization:
//   The app always passes owner_id (the business owner's UUID) in the body.
//   We resolve the true owner from the DB, then verify the caller is either
//   the owner or an active staff member for that owner.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_TRIGGER_URL    = "https://admin.kudiai.app/api/public/email-trigger";
const EMAIL_TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

async function fireAjoEmail(event: string, data: Record<string, unknown>): Promise<void> {
  await fetch(EMAIL_TRIGGER_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
    body:    JSON.stringify({ event, data }),
  }).catch(() => null);
}

// ── PIN verification (same PBKDF2 scheme as pin-manager/index.ts) ─────────────
async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const salt          = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));
  const expectedBytes = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"],
  );
  const derived      = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256,
  );
  const actualBytes  = new Uint8Array(derived);
  if (actualBytes.length !== expectedBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < actualBytes.length; i++) diff |= actualBytes[i] ^ expectedBytes[i];
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── PIN-requiring actions ─────────────────────────────────────────────────────
const PIN_GATED = new Set(["record_withdrawal", "reverse_contribution", "archive_client"]);

// ── Resolve the true owner UUID for a client from the DB ─────────────────────
async function resolveClientOwner(
  sb: ReturnType<typeof createClient>,
  clientId: string,
): Promise<string | null> {
  const { data } = await sb
    .from("aso_clients")
    .select("user_id")
    .eq("id", clientId)
    .maybeSingle();
  return data?.user_id ?? null;
}

// ── Resolve owner + client IDs for a contribution (reverse action) ────────────
async function resolveContrib(
  sb: ReturnType<typeof createClient>,
  contribId: string,
): Promise<{ ownerId: string | null; clientId: string | null }> {
  const { data } = await sb
    .from("ajo_contributions")
    .select("owner_id, aso_client_id")
    .eq("id", contribId)
    .maybeSingle();
  return { ownerId: data?.owner_id ?? null, clientId: data?.aso_client_id ?? null };
}

// ── Fetch email metadata for a client, owner, and optional staff caller ────────
async function fetchEmailContext(
  sb: ReturnType<typeof createClient>,
  clientId: string,
  ownerId: string,
  callerUid: string,
): Promise<{
  clientEmail: string; clientName: string;
  ownerEmail: string; businessName: string;
  staffEmail: string; staffName: string;
}> {
  const isStaff = callerUid !== ownerId;
  const [cl, own, st] = await Promise.all([
    sb.from("aso_clients").select("email, full_name").eq("id", clientId).maybeSingle().then(r => r.data),
    sb.from("profiles").select("email, business_name").eq("id", ownerId).maybeSingle().then(r => r.data),
    isStaff
      ? sb.from("staff").select("email, full_name").eq("user_id", callerUid).eq("owner_id", ownerId).maybeSingle().then(r => r.data)
      : Promise.resolve(null),
  ]);
  return {
    clientEmail:  cl?.email         || "",
    clientName:   cl?.full_name     || "",
    ownerEmail:   own?.email        || "",
    businessName: own?.business_name || "",
    staffEmail:   st?.email         || "",
    staffName:    st?.full_name     || "",
  };
}

// ── Verify caller is the owner or an active staff member for that owner ───────
// Staff members who can use ASO must have an active row in the staff table
// linking their auth UUID to the owner's UUID.
async function isAuthorized(
  sb: ReturnType<typeof createClient>,
  callerUid: string,
  ownerId: string,
): Promise<boolean> {
  if (callerUid === ownerId) return true;

  const { data: staffRow } = await sb
    .from("staff")
    .select("id")
    .eq("user_id", callerUid)
    .eq("owner_id", ownerId)
    .eq("is_active", true)
    .maybeSingle();

  return !!staffRow;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Missing Authorization header" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");

  const anonSb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: { user }, error: userErr } = await anonSb.auth.getUser(token);
  if (userErr || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  // Service-role client — calls RPCs with elevated privilege
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const { action, pin, ...params } = body as {
    action: string;
    pin?: string;
    [k: string]: unknown;
  };

  if (!action) return json({ ok: false, error: "Missing action" });

  // ── PIN verification for PIN-gated actions ────────────────────────────────
  // PIN is always verified against the caller's own profile (owner or staff).
  if (PIN_GATED.has(action)) {
    if (!pin || typeof pin !== "string") {
      return json({ ok: false, error: "PIN required" });
    }

    const { data: profile } = await sb
      .from("profiles")
      .select("txn_pin_hash, txn_pin_attempts, txn_pin_locked_until, txn_pin_lockout_count")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.txn_pin_hash) {
      return json({ ok: false, error: "Transaction PIN not configured" });
    }

    // Lockout check
    if (profile.txn_pin_locked_until && new Date(profile.txn_pin_locked_until) > new Date()) {
      return json({ ok: false, error: "PIN locked — try again later", locked: true });
    }

    const correct = await verifyPinHash(pin, profile.txn_pin_hash);

    if (!correct) {
      const MAX_ATTEMPTS    = 5;
      const LOCKOUT_MINUTES = 30;
      const newAttempts     = (profile.txn_pin_attempts || 0) + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        const newLockouts = (profile.txn_pin_lockout_count || 0) + 1;
        await sb.from("profiles").update({
          txn_pin_attempts:     0,
          txn_pin_locked_until: lockedUntil,
          txn_pin_lockout_count: newLockouts,
        }).eq("id", user.id);
        return json({ ok: false, error: "Invalid PIN — account locked", locked: true });
      }
      await sb.from("profiles").update({ txn_pin_attempts: newAttempts }).eq("id", user.id);
      return json({ ok: false, error: "Invalid PIN", attempts_left: MAX_ATTEMPTS - newAttempts });
    }

    // Correct PIN — reset attempt counter
    await sb.from("profiles").update({
      txn_pin_attempts:     0,
      txn_pin_locked_until: null,
    }).eq("id", user.id);
  }

  // ── Route to SQL RPC ──────────────────────────────────────────────────────

  if (action === "record_contribution") {
    const { client_id, amount, method, ref, notes, recorded_by } = params as {
      client_id: string; amount: number;
      method?: string; ref?: string; notes?: string; recorded_by?: string;
    };

    // Resolve owner from DB — never trust client-supplied owner_id as the final word
    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);
    if (!await isAuthorized(sb, user.id, ownerId)) {
      return json({ ok: false, error: "Unauthorized" }, 403);
    }

    const { data, error } = await sb.rpc("ajo_record_contribution", {
      p_client_id:   client_id,
      p_owner_id:    ownerId,
      p_amount:      amount,
      p_method:      method || "cash",
      p_ref:         ref    || null,
      p_notes:       notes  || null,
      p_recorded_by: recorded_by || null,
    });
    if (error) return json({ ok: false, error: error.message });

    // Fire notification email — non-blocking to caller
    const ctx = await fetchEmailContext(sb, client_id, ownerId, user.id);
    await fireAjoEmail("ajo_contribution", {
      client_email:  ctx.clientEmail,
      client_name:   ctx.clientName,
      user_email:    ctx.ownerEmail,
      business_name: ctx.businessName,
      staff_email:   ctx.staffEmail,
      staff_name:    ctx.staffName,
      amount,
      balance:       (data as Record<string, unknown>)?.balance_after,
      reg_fee:       (data as Record<string, unknown>)?.reg_fee_charged
                       ? (data as Record<string, unknown>)?.registration_fee
                       : 0,
      date:          new Date().toLocaleDateString("en-NG"),
    });

    return json(data);
  }

  if (action === "record_withdrawal") {
    const { client_id, gross_amount, method, notes, recorded_by, request_id } = params as {
      client_id: string; gross_amount: number;
      method?: string; notes?: string; recorded_by?: string; request_id?: string;
    };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);
    if (!await isAuthorized(sb, user.id, ownerId)) {
      return json({ ok: false, error: "Unauthorized" }, 403);
    }

    const { data, error } = await sb.rpc("ajo_record_withdrawal", {
      p_client_id:    client_id,
      p_owner_id:     ownerId,
      p_gross_amount: gross_amount,
      p_method:       method     || "cash",
      p_notes:        notes      || null,
      p_recorded_by:  recorded_by || null,
      p_request_id:   request_id || null,
    });
    if (error) return json({ ok: false, error: error.message });

    const rpcWd = data as Record<string, unknown>;
    // Only fire server-side email for direct withdrawals (no prior request).
    // Request-based approvals already fire ajo_withdrawal_approved from the client.
    if (!request_id) {
      const ctx = await fetchEmailContext(sb, client_id, ownerId, user.id);
      await fireAjoEmail("ajo_withdrawal", {
        client_email:  ctx.clientEmail,
        client_name:   ctx.clientName,
        user_email:    ctx.ownerEmail,
        business_name: ctx.businessName,
        staff_email:   ctx.staffEmail,
        staff_name:    ctx.staffName,
        amount:        rpcWd?.net_amount,
        gross_amount:  rpcWd?.gross_amount,
        fee_amount:    rpcWd?.fee_amount,
        balance_after: rpcWd?.balance_after,
        date:          new Date().toLocaleDateString("en-NG"),
      });
    }

    return json(data);
  }

  if (action === "reverse_contribution") {
    const { original_id, reason } = params as { original_id: string; reason: string };

    const { ownerId, clientId } = await resolveContrib(sb, original_id);
    if (!ownerId) return json({ ok: false, error: "Contribution not found" }, 404);
    if (!await isAuthorized(sb, user.id, ownerId)) {
      return json({ ok: false, error: "Unauthorized" }, 403);
    }

    const { data, error } = await sb.rpc("ajo_reverse_contribution", {
      p_original_id: original_id,
      p_owner_id:    ownerId,
      p_reason:      reason,
    });
    if (error) return json({ ok: false, error: error.message });

    if (clientId) {
      const rpcRev = data as Record<string, unknown>;
      const ctx    = await fetchEmailContext(sb, clientId, ownerId, user.id);
      await fireAjoEmail("ajo_reversal", {
        client_email:  ctx.clientEmail,
        client_name:   ctx.clientName,
        user_email:    ctx.ownerEmail,
        business_name: ctx.businessName,
        staff_email:   ctx.staffEmail,
        staff_name:    ctx.staffName,
        amount:        rpcRev?.amount,
        balance_after: rpcRev?.balance_after,
        reason:        reason || "",
        original_type: rpcRev?.original_type || "contribution",
        date:          new Date().toLocaleDateString("en-NG"),
      });
    }

    return json(data);
  }

  if (action === "archive_client") {
    const { client_id } = params as { client_id: string };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);
    if (!await isAuthorized(sb, user.id, ownerId)) {
      return json({ ok: false, error: "Unauthorized" }, 403);
    }

    const { data, error } = await sb.rpc("ajo_archive_client", {
      p_client_id: client_id,
      p_owner_id:  ownerId,
    });
    if (error) return json({ ok: false, error: error.message });
    return json(data);
  }

  return json({ ok: false, error: `Unknown action: ${action}` }, 400);
});
