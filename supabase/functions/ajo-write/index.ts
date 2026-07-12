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
const PIN_GATED = new Set(["record_withdrawal", "reverse_contribution", "archive_client", "confirm_manual_deposit"]);

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

// ── Resolve Ajo permissions for the caller ────────────────────────────────────
// Returns null  → caller is the owner; full access, no staff ID to track.
// Returns false → caller is not an active staff member for this owner; 403.
// Returns perms → caller is staff; check individual flags before each action.
interface AjoStaffPerms {
  staffId:               string;
  can_create:            boolean; // record contributions
  ajo_confirm_deposits:  boolean; // confirm / reject manual deposit claims
  ajo_record_withdrawals:boolean; // record withdrawals + reverse contributions
  ajo_manage_clients:    boolean; // create / edit / archive clients
}

async function resolveAjoPerms(
  sb: ReturnType<typeof createClient>,
  callerUid: string,
  ownerId: string,
): Promise<AjoStaffPerms | null | false> {
  if (callerUid === ownerId) return null; // owner = full access

  const { data } = await sb
    .from("staff")
    .select("id, staff_permissions(module, can_create, ajo_confirm_deposits, ajo_record_withdrawals, ajo_manage_clients)")
    .eq("user_id",  callerUid)
    .eq("owner_id", ownerId)
    .eq("status",   "active")   // was incorrectly "is_active" = true — fixed
    .maybeSingle();

  if (!data) return false; // not an active staff member for this owner

  const p = (data.staff_permissions as Record<string, unknown>[]).find(
    (sp) => sp.module === "aso",
  );
  return {
    staffId:                data.id,
    can_create:             Boolean(p?.can_create),
    ajo_confirm_deposits:   Boolean(p?.ajo_confirm_deposits),
    ajo_record_withdrawals: Boolean(p?.ajo_record_withdrawals),
    ajo_manage_clients:     Boolean(p?.ajo_manage_clients),
  };
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
    const { client_id, amount, method, ref, notes } = params as {
      client_id: string; amount: number;
      method?: string; ref?: string; notes?: string;
    };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (ajoPerms !== null && !ajoPerms.can_create) {
      return json({ ok: false, error: "Permission denied: Ajo contribution recording not enabled for your account" }, 403);
    }

    // recorded_by = staff.id for staff callers; null for owner (owner needs no tracking)
    const recordedBy = ajoPerms === null ? null : ajoPerms.staffId;

    const { data, error } = await sb.rpc("ajo_record_contribution", {
      p_client_id:   client_id,
      p_owner_id:    ownerId,
      p_amount:      amount,
      p_method:      method || "cash",
      p_ref:         ref    || null,
      p_notes:       notes  || null,
      p_recorded_by: recordedBy,
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
    const { client_id, gross_amount, method, notes, request_id } = params as {
      client_id: string; gross_amount: number;
      method?: string; notes?: string; request_id?: string;
    };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (ajoPerms !== null && !ajoPerms.ajo_record_withdrawals) {
      return json({ ok: false, error: "Permission denied: Ajo withdrawal recording not enabled for your account" }, 403);
    }

    const recordedBy = ajoPerms === null ? null : ajoPerms.staffId;

    const { data, error } = await sb.rpc("ajo_record_withdrawal", {
      p_client_id:    client_id,
      p_owner_id:     ownerId,
      p_gross_amount: gross_amount,
      p_method:       method || "cash",
      p_notes:        notes  || null,
      p_recorded_by:  recordedBy,
      p_request_id:   request_id || null,
    });
    if (error) return json({ ok: false, error: error.message });

    const rpcWd = data as Record<string, unknown>;
    const ctx   = await fetchEmailContext(sb, client_id, ownerId, user.id);
    if (request_id) {
      // Request-based approval — send the approval-specific email server-side
      await fireAjoEmail("ajo_withdrawal_approved", {
        client_email:  ctx.clientEmail,
        client_name:   ctx.clientName,
        user_email:    ctx.ownerEmail,
        business_name: ctx.businessName,
        staff_email:   ctx.staffEmail,
        staff_name:    ctx.staffName,
        amount:        rpcWd?.gross_amount,
        fee_amount:    rpcWd?.fee_amount,
        net_amount:    rpcWd?.net_amount,
        balance_after: rpcWd?.balance_after,
        date:          new Date().toLocaleDateString("en-NG"),
      });
    } else {
      // Direct withdrawal (no prior request) — standard withdrawal email
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

  if (action === "reject_withdrawal_request") {
    const { request_id: rwrId, reason: rwrReason } = params as {
      request_id: string;
      reason?: string;
    };
    if (!rwrId) return json({ ok: false, error: "request_id required" }, 400);

    const { data: rwrRow, error: rwrErr } = await sb
      .from("ajo_withdrawal_requests")
      .select("aso_client_id, owner_id, amount, group_name")
      .eq("id", rwrId)
      .single();
    if (rwrErr || !rwrRow) return json({ ok: false, error: "Request not found" }, 404);

    const ownerId = rwrRow.owner_id as string;
    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (ajoPerms !== null && !(ajoPerms as Record<string, unknown>).ajo_record_withdrawals) {
      return json({ ok: false, error: "Permission denied: Ajo withdrawal not enabled for your account" }, 403);
    }

    const { error: updErr } = await sb
      .from("ajo_withdrawal_requests")
      .update({ status: "rejected", approved_at: new Date().toISOString() })
      .eq("id", rwrId);
    if (updErr) return json({ ok: false, error: updErr.message });

    const clientId = rwrRow.aso_client_id as string;
    const ctx = await fetchEmailContext(sb, clientId, ownerId, user.id);
    await fireAjoEmail("ajo_withdrawal_rejected", {
      client_email:  ctx.clientEmail,
      client_name:   ctx.clientName,
      user_email:    ctx.ownerEmail,
      business_name: ctx.businessName,
      group_name:    (rwrRow as Record<string, unknown>).group_name || "",
      amount:        (rwrRow as Record<string, unknown>).amount,
      reason:        rwrReason || "",
      date:          new Date().toLocaleDateString("en-NG"),
    });

    return json({ ok: true });
  }

  if (action === "reverse_contribution") {
    const { original_id, reason } = params as { original_id: string; reason: string };

    const { ownerId, clientId } = await resolveContrib(sb, original_id);
    if (!ownerId) return json({ ok: false, error: "Contribution not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (ajoPerms !== null && !ajoPerms.ajo_record_withdrawals) {
      return json({ ok: false, error: "Permission denied: Ajo withdrawal/reversal not enabled for your account" }, 403);
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

  if (action === "confirm_manual_deposit") {
    const { claim_id } = params as { claim_id: string };

    // Resolve owner from the claim itself (don't trust client-supplied owner_id)
    const { data: claim } = await sb
      .from("ajo_contributions")
      .select("owner_id, aso_client_id")
      .eq("id", claim_id)
      .maybeSingle();

    if (!claim) return json({ ok: false, error: "Claim not found" }, 404);
    const ownerId = claim.owner_id;

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (ajoPerms !== null && !ajoPerms.ajo_confirm_deposits) {
      return json({ ok: false, error: "Permission denied: Ajo deposit confirmation not enabled for your account" }, 403);
    }

    const { data, error } = await sb.rpc("ajo_confirm_manual_deposit", {
      p_claim_id:     claim_id,
      p_owner_id:     ownerId,
      p_confirmed_by: user.id,
    });
    if (error) return json({ ok: false, error: error.message });
    if (!data?.ok) return json({ ok: false, error: data?.error || "Failed to confirm" });

    // Fire confirmation email to client — non-blocking
    const ctx = await fetchEmailContext(sb, claim.aso_client_id, ownerId, user.id);
    await fireAjoEmail("ajo_manual_deposit_confirmed", {
      client_email:  ctx.clientEmail,
      client_name:   ctx.clientName,
      user_email:    ctx.ownerEmail,
      business_name: ctx.businessName,
      staff_email:   ctx.staffEmail,
      staff_name:    ctx.staffName,
      amount:        data?.amount,
      reg_fee:       data?.reg_fee || 0,
      new_balance:   data?.new_balance,
      date:          new Date().toLocaleDateString("en-NG"),
    });

    return json(data);
  }

  if (action === "reject_manual_claim") {
    const { claim_id, reason } = params as { claim_id: string; reason: string };

    const { data: claim } = await sb
      .from("ajo_contributions")
      .select("owner_id, aso_client_id, amount")
      .eq("id", claim_id)
      .maybeSingle();

    if (!claim) return json({ ok: false, error: "Claim not found" }, 404);
    const ownerId = claim.owner_id;

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (ajoPerms !== null && !ajoPerms.ajo_confirm_deposits) {
      return json({ ok: false, error: "Permission denied: Ajo deposit confirmation not enabled for your account" }, 403);
    }

    const { data, error } = await sb.rpc("ajo_reject_manual_claim", {
      p_claim_id: claim_id,
      p_owner_id: ownerId,
      p_reason:   reason,
    });
    if (error) return json({ ok: false, error: error.message });
    if (!data?.ok) return json({ ok: false, error: data?.error || "Failed to reject" });

    // Fire rejection email to client — non-blocking
    const ctx = await fetchEmailContext(sb, claim.aso_client_id, ownerId, user.id);
    await fireAjoEmail("ajo_manual_deposit_rejected", {
      client_email:  ctx.clientEmail,
      client_name:   ctx.clientName,
      user_email:    ctx.ownerEmail,
      business_name: ctx.businessName,
      amount:        claim.amount,
      reason:        reason,
      date:          new Date().toLocaleDateString("en-NG"),
    });

    return json(data);
  }

  if (action === "archive_client") {
    const { client_id } = params as { client_id: string };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (ajoPerms !== null && !ajoPerms.ajo_manage_clients) {
      return json({ ok: false, error: "Permission denied: Ajo client management not enabled for your account" }, 403);
    }

    const { data, error } = await sb.rpc("ajo_archive_client", {
      p_client_id: client_id,
      p_owner_id:  ownerId,
    });
    if (error) return json({ ok: false, error: error.message });
    return json(data);
  }

  if (action === "resolve_dispute") {
    const { contribution_id } = params as { contribution_id: string };
    if (!contribution_id) return json({ ok: false, error: "contribution_id required" }, 400);

    const { data: contrib } = await sb
      .from("ajo_contributions")
      .select("owner_id")
      .eq("id", contribution_id)
      .maybeSingle();
    if (!contrib) return json({ ok: false, error: "Contribution not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, contrib.owner_id);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);

    await sb.from("ajo_contributions")
      .update({ dispute_ticket_no: null })
      .eq("id", contribution_id);

    return json({ ok: true });
  }

  return json({ ok: false, error: `Unknown action: ${action}` }, 400);
});
