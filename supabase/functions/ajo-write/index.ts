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
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  await fetch(EMAIL_TRIGGER_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-trigger-secret": EMAIL_TRIGGER_SECRET },
    body:    JSON.stringify({ event, data }),
    signal:  ctrl.signal,
  }).catch(() => null).finally(() => clearTimeout(timer));
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
const PIN_GATED = new Set(["record_withdrawal", "reverse_contribution", "archive_client", "request_client_archive", "confirm_manual_deposit", "approve_contribution", "collection_record", "execute_commission", "execute_payout", "skip_turn", "reorder_turns", "approve_reactivation", "record_credit_repayment", "batch_approve_contributions", "close_savings_round", "release_savings_member"]);

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

// ── Resolve owner + client IDs + original amount for a contribution ───────────
async function resolveContrib(
  sb: ReturnType<typeof createClient>,
  contribId: string,
): Promise<{ ownerId: string | null; clientId: string | null; originalAmount: number }> {
  const { data } = await sb
    .from("ajo_contributions")
    .select("owner_id, aso_client_id, amount")
    .eq("id", contribId)
    .maybeSingle();
  return {
    ownerId:        data?.owner_id      ?? null,
    clientId:       data?.aso_client_id ?? null,
    originalAmount: Number(data?.amount ?? 0),
  };
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

// ── Fire-and-forget notification via notify-send (gives FCM push + pref checks) ─
const _SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const _SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function notifyUser(
  _sb: ReturnType<typeof createClient>,       // kept for call-site compatibility
  userId: string | null | undefined,
  opts: { type: string; title: string; body: string; priority?: string; deepLink?: Record<string, unknown> | null; category?: string },
): Promise<void> {
  if (!userId) return;
  try {
    await fetch(`${_SUPABASE_URL}/functions/v1/notify-send`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        action:   "notify",
        userId,
        type:     opts.type,
        title:    opts.title,
        body:     opts.body,
        priority: opts.priority ?? "normal",
        deepLink: opts.deepLink ?? null,
        category: opts.category ?? "savings",
      }),
    });
  } catch { /* fire and forget */ }
}

// ── Resolve a client's auth user_id from aso_clients.client_user_id ──────────
async function resolveClientUserId(
  sb: ReturnType<typeof createClient>,
  clientId: string,
): Promise<string | null> {
  const { data } = await sb.from("aso_clients").select("client_user_id").eq("id", clientId).maybeSingle();
  return (data as { client_user_id?: string } | null)?.client_user_id ?? null;
}

// ── Resolve a staff member's auth user_id from their staff row id ─────────────
async function resolveStaffUserId(
  sb: ReturnType<typeof createClient>,
  staffRowId: string | null | undefined,
): Promise<string | null> {
  if (!staffRowId) return null;
  const { data } = await sb.from("staff").select("user_id").eq("id", staffRowId).maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

// ── Resolve the auth user_id of the manager assigned to a branch ─────────────
async function resolveBranchManagerId(
  sb: ReturnType<typeof createClient>,
  ownerId: string,
  branchId: string | null | undefined,
): Promise<string | null> {
  if (!branchId) return null;
  const { data } = await sb.from("staff")
    .select("user_id")
    .eq("owner_id", ownerId)
    .eq("branch_id", branchId)
    .eq("role", "manager")
    .eq("status", "active")
    .not("user_id", "is", null)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

// ── Resolve the auth user_id of the staff assigned to a client ───────────────
async function resolveAssignedStaffUserId(
  sb: ReturnType<typeof createClient>,
  clientId: string,
): Promise<string | null> {
  const { data: cl } = await sb.from("aso_clients").select("staff_id").eq("id", clientId).maybeSingle();
  const staffRowId = (cl as { staff_id?: string } | null)?.staff_id;
  if (!staffRowId) return null;
  return resolveStaffUserId(sb, staffRowId);
}

// ── Resolve Ajo permissions for the caller ────────────────────────────────────
// Returns null  → caller is the owner; full access, no staff ID to track.
// Returns false → caller is not an active staff member for this owner; 403.
// Returns perms → caller is staff; check individual flags before each action.
interface AjoStaffPerms {
  staffId:               string;
  isManager:             boolean; // branch managers bypass client scoping
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
    .select("id, role, staff_permissions(module, can_create, ajo_confirm_deposits, ajo_record_withdrawals, ajo_manage_clients)")
    .eq("user_id",  callerUid)
    .eq("owner_id", ownerId)
    .eq("status",   "active")
    .maybeSingle();

  if (!data) return false; // not an active staff member for this owner

  // Managers have full staff-level access to all Ajo actions without needing
  // explicit staff_permissions rows — they oversee all clients at their branch.
  if ((data as Record<string, unknown>).role === "manager") {
    return {
      staffId:                data.id,
      isManager:              true,
      can_create:             true,
      ajo_confirm_deposits:   true,
      ajo_record_withdrawals: true,
      ajo_manage_clients:     true,
    };
  }

  const p = (data.staff_permissions as Record<string, unknown>[]).find(
    (sp) => sp.module === "aso",
  );
  return {
    staffId:                data.id,
    isManager:              false,
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
    const { client_id, amount, method, ref, notes, contribution_context, cycle_id: callerCycleId, group_id: callerGroupId } = params as {
      client_id: string; amount: number;
      method?: string; ref?: string; notes?: string; contribution_context?: string; cycle_id?: string; group_id?: string;
    };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (ajoPerms !== null && !ajoPerms.can_create) {
      return json({ ok: false, error: "Permission denied: Ajo contribution recording not enabled for your account" }, 403);
    }

    // Scoping: staff can only record for clients assigned to them or created by them.
    // Managers bypass scoping — they oversee all clients at their branch.
    // Legacy clients (staff_id IS NULL AND created_by IS NULL) are accessible to all
    // can_view staff until the owner assigns scope.
    if (ajoPerms !== null && !ajoPerms.isManager) {
      const { data: clientScope } = await sb
        .from("aso_clients")
        .select("staff_id, created_by")
        .eq("id", client_id)
        .maybeSingle();
      if (!clientScope) return json({ ok: false, error: "Client not found" }, 404);
      const isLegacy = !clientScope.staff_id && !clientScope.created_by;
      if (!isLegacy &&
          clientScope.staff_id !== ajoPerms.staffId &&
          clientScope.created_by !== ajoPerms.staffId) {
        return json({ ok: false, error: "You are not assigned to this client" }, 403);
      }
    }

    // Block contributions while a client archive request is pending
    const { data: clPaC } = await sb.from("aso_clients").select("pending_archive").eq("id", client_id).maybeSingle();
    if (clPaC?.pending_archive) {
      return json({ ok: false, error: "This client has a pending archive request — contributions cannot be recorded until it is resolved." }, 409);
    }

    // recorded_by = staff.id for staff callers; null for owner (owner needs no tracking)
    const recordedBy = ajoPerms === null ? null : ajoPerms.staffId;
    // Staff contributions are tagged staff_collection so the owner queue can filter them
    const contribSource = ajoPerms !== null ? "staff_collection" : undefined;

    // Resolve cycle_id: caller's explicit choice wins; fall back to auto-pick/auto-open
    // for personal_savings contributions so the pending row always carries an attribution.
    let cycleId: string | null = callerCycleId || null;
    if (!cycleId && (!contribution_context || contribution_context === "personal_savings")) {
      const { data: existingCycle } = await sb
        .from("ajo_cycles").select("id").eq("client_id", client_id).eq("status", "active")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (existingCycle) {
        cycleId = existingCycle.id as string;
      } else {
        const { data: clientRow } = await sb
          .from("aso_clients")
          .select("contribution_amount, contribution_frequency, commission_model, commission_percent")
          .eq("id", client_id).maybeSingle();
        if ((clientRow as Record<string, unknown>)?.contribution_amount) {
          const cr = clientRow as Record<string, unknown>;
          const { data: openData } = await sb.rpc("ajo_open_cycle", {
            p_client_id:        client_id,
            p_owner_id:         ownerId,
            p_start:            null, // defaults to CURRENT_DATE in RPC — never registration_date
            p_length:           null,
            p_amount:           cr.contribution_amount as number,
            p_label:            "Personal Savings",
            p_commission_model: (cr.commission_model as string) || null,
            p_commission_pct:   (cr.commission_percent as number) || null,
            p_force:            false,
            p_frequency:        (cr.contribution_frequency as string) || null,
          }); // best-effort — cycle creation never blocks the contribution
          cycleId = (openData as Record<string, unknown>)?.cycle_id as string || null;
        }
      }
    }

    // ── Fix 2: Reject non-personal contributions with no active membership/round ──
    if (contribution_context === "group_savings" || contribution_context === "esusu_rotation") {
      const gid = callerGroupId;
      if (!gid) return json({ ok: false, error: "Select a savings group to contribute to" }, 400);
      const { data: gmem } = await sb.from("aso_client_group_memberships")
        .select("id").eq("client_id", client_id).eq("group_id", gid)
        .eq("status", "active").maybeSingle();
      if (!gmem) return json({ ok: false, error: "This client is not an active member of the selected group" }, 400);
      if (contribution_context === "esusu_rotation") {
        const { data: grd } = await sb.from("ajo_group_rounds")
          .select("id").eq("group_id", gid).eq("status", "active").maybeSingle();
        if (!grd) return json({ ok: false, error: "This esusu group has no active round — ask your savings agent to start one" }, 400);
      }
      if (contribution_context === "group_savings") {
        const { data: grpRow } = await sb.from("ajo_groups")
          .select("round_status").eq("id", gid).maybeSingle();
        if (!grpRow || grpRow.round_status !== "active") {
          return json({ ok: false, error: "This savings group hasn't started — ask your savings agent to start it" }, 400);
        }
      }
    }

    // ── Fix 3: First-deposit minimum (expected + registration fee) ──
    if ((!contribution_context || contribution_context === "personal_savings") && cycleId) {
      const { data: f3Cli } = await sb.from("aso_clients").select("registration_charge").eq("id", client_id).maybeSingle();
      const { data: f3Cyc } = await sb.from("ajo_cycles").select("expected_amount_per_period").eq("id", cycleId).maybeSingle();
      const regCharge = Number((f3Cli as Record<string, unknown>)?.registration_charge || 0);
      const expected  = Number((f3Cyc as Record<string, unknown>)?.expected_amount_per_period || 0);
      const minReq    = expected + regCharge;
      if (minReq > 0 && Number(amount) < minReq) {
        const { data: hasFirst } = await sb.from("ajo_contributions")
          .select("id").eq("aso_client_id", client_id).eq("status", "completed").eq("type", "contribution").limit(1).maybeSingle();
        if (!hasFirst) {
          return json({
            ok: false,
            error: `First deposit must be ₦${minReq.toLocaleString("en-NG")} — ₦${expected.toLocaleString("en-NG")} contribution + ₦${regCharge.toLocaleString("en-NG")} registration`,
            min_amount: minReq,
          }, 400);
        }
      }
    }

    // ── Cap check: reject if this cycle's target is already met ──────────────
    if (cycleId && (!contribution_context || contribution_context === "personal_savings")) {
      const { data: capCy } = await sb.from("ajo_cycles")
        .select("length_periods, expected_amount_per_period")
        .eq("id", cycleId).maybeSingle();
      const capTarget = Number((capCy as Record<string, unknown>)?.length_periods || 0) *
                        Number((capCy as Record<string, unknown>)?.expected_amount_per_period || 0);
      if (capTarget > 0) {
        const { data: capRows } = await sb.from("ajo_contributions")
          .select("amount").eq("aso_client_id", client_id).eq("cycle_id", cycleId)
          .eq("type", "contribution").eq("status", "completed");
        const capSaved = ((capRows || []) as Array<{ amount: number }>)
          .reduce((s, r) => s + Number(r.amount || 0), 0);
        if (capSaved >= capTarget) {
          return json({
            ok: false,
            error: `This savings plan has reached its ₦${capTarget.toLocaleString("en-NG")} target — close and renew the cycle to accept more contributions`,
          }, 400);
        }
      }
    }

    const { data, error } = await sb.rpc("ajo_record_contribution", {
      p_client_id:             client_id,
      p_owner_id:              ownerId,
      p_amount:                amount,
      p_method:                method || "cash",
      p_ref:                   ref    || null,
      p_notes:                 notes  || null,
      p_recorded_by:           recordedBy,
      p_contribution_context:  contribution_context || "personal_savings",
      p_cycle_id:              cycleId,
      p_group_id:              callerGroupId || null,
      ...(contribSource ? { p_source: contribSource } : {}),
    });
    if (error) return json({ ok: false, error: error.message });

    // Notify client that a contribution was recorded and is awaiting approval
    const ctx = await fetchEmailContext(sb, client_id, ownerId, user.id);
    await fireAjoEmail("ajo_contribution_pending", {
      client_email:  ctx.clientEmail,
      client_name:   ctx.clientName,
      owner_email:   ctx.ownerEmail,
      business_name: ctx.businessName,
      staff_name:    ctx.staffName,
      amount,
      method:        method || "cash",
      date:          new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
    });

    // Notify owner + branch manager when a staff member records a contribution
    if (ajoPerms !== null) {
      notifyUser(sb, ownerId, {
        type:     "staff_collection",
        title:    "New Staff Collection",
        body:     `${ctx.staffName || "Staff"} recorded a ₦${Number(amount).toLocaleString("en-NG")} collection — tap to review`,
        priority: "high",
        deepLink: { tab: "aso", sub: "collections" },
        category: "money",
      });
      // Notify branch manager (scoped to this staff's branch only)
      const { data: actingStaff } = await sb.from("staff").select("branch_id").eq("id", ajoPerms.staffId).maybeSingle();
      const actingBranchId = (actingStaff as { branch_id?: string } | null)?.branch_id ?? null;
      if (actingBranchId) {
        const brMgrUid = await resolveBranchManagerId(sb, ownerId, actingBranchId);
        if (brMgrUid && brMgrUid !== user.id) {
          notifyUser(sb, brMgrUid, {
            type:     "staff_collection",
            title:    "Branch Collection",
            body:     `${ctx.staffName || "Staff"} recorded a ₦${Number(amount).toLocaleString("en-NG")} collection at your branch`,
            priority: "high",
            deepLink: { tab: "home" },
            category: "money",
          });
        }
      }
    }

    return json(data);
  }

  // ── Approve a pending manual contribution (PIN-gated) ──────────────────────
  if (action === "approve_contribution") {
    const { contribution_id: acId } = params as { contribution_id: string };
    if (!acId) return json({ ok: false, error: "contribution_id required" }, 400);

    // Look up the contribution to determine the business owner
    const { data: acContrib } = await sb.from("ajo_contributions")
      .select("owner_id, aso_client_id, amount, payment_method, contribution_context, recorded_by, contribution_source")
      .eq("id", acId)
      .eq("status", "pending")
      .maybeSingle();
    if (!acContrib) return json({ ok: false, error: "Pending contribution not found" }, 404);

    const acOwnerId = (acContrib.owner_id as string) || await resolveClientOwner(sb, acContrib.aso_client_id as string);
    if (!acOwnerId) return json({ ok: false, error: "Owner not found" }, 404);

    const acPerms = await resolveAjoPerms(sb, user.id, acOwnerId);
    if (acPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: acData, error: acErr } = await sb.rpc("ajo_approve_contribution", {
      p_contribution_id: acId,
      p_owner_id:        acOwnerId,
      p_approver_id:     user.id,
    });
    if (acErr) return json({ ok: false, error: acErr.message });
    if (!(acData as Record<string, unknown>)?.ok) return json(acData);

    const acResult = acData as Record<string, unknown>;
    const acAmt    = Number(acContrib.amount).toLocaleString("en-NG");

    // Fetch email context + client userId in parallel, then fire all side
    // effects in parallel.  A 2.5 s race cap ensures the response is always
    // returned promptly — a slow email endpoint never triggers a function timeout.
    await Promise.race([
      (async () => {
        const [acCtx, acClientUserId, acAssignedStaffUid] = await Promise.all([
          fetchEmailContext(sb, acContrib.aso_client_id as string, acOwnerId, user.id),
          resolveClientUserId(sb, acContrib.aso_client_id as string),
          resolveAssignedStaffUserId(sb, acContrib.aso_client_id as string),
        ]);
        const effects: Promise<unknown>[] = [
          fireAjoEmail("ajo_contribution_approved", {
            client_email:  acCtx.clientEmail,
            client_name:   acCtx.clientName,
            owner_email:   acCtx.ownerEmail,
            business_name: acCtx.businessName,
            staff_name:    acCtx.staffName,
            amount:        acContrib.amount,
            method:        acContrib.payment_method,
            new_balance:   acResult.new_balance || 0,
            reg_fee:       acResult.reg_fee     || 0,
            date:          new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
          }),
          notifyUser(sb, acClientUserId, {
            type: "contribution_approved", title: "Contribution Approved",
            body: `Your ₦${acAmt} contribution has been approved`, priority: "normal",
            deepLink: { tab: "contributions" }, category: "savings",
          }),
        ];
        let acRecordingStaffUid: string | null = null;
        if ((acContrib as Record<string, unknown>).contribution_source === "staff_collection") {
          acRecordingStaffUid = await resolveStaffUserId(sb, (acContrib as Record<string, unknown>).recorded_by as string);
          effects.push(notifyUser(sb, acRecordingStaffUid, {
            type: "collection_approved", title: "Collection Approved",
            body: `Your recorded ₦${acAmt} collection was approved by the owner`, priority: "normal",
            deepLink: { tab: "aso", sub: "collections" }, category: "approvals",
          }));
        }
        if (acAssignedStaffUid && acAssignedStaffUid !== acRecordingStaffUid && acAssignedStaffUid !== acClientUserId) {
          effects.push(notifyUser(sb, acAssignedStaffUid, {
            type: "assigned_client_contribution_approved", title: "Client Contribution Approved",
            body: `${acCtx.clientName || "Your client"}'s ₦${acAmt} contribution was approved`,
            priority: "high",
            deepLink: { tab: "records", id: acContrib.aso_client_id },
            category: "approvals",
          }));
        }
        if (acResult.cycle_just_matured) {
          const maturedAmt = Number(acResult.matured_net_balance || 0).toLocaleString("en-NG");
          effects.push(
            notifyUser(sb, acClientUserId, {
              type: "cycle_matured", title: "Savings Cycle Complete!",
              body: `Your "${acResult.matured_cycle_label || "Personal Savings"}" cycle is complete — ₦${maturedAmt} is now available to withdraw`,
              priority: "high", deepLink: { tab: "contributions" }, category: "savings",
            }),
            fireAjoEmail("ajo_cycle_matured", {
              client_email:  acCtx.clientEmail,
              client_name:   acCtx.clientName,
              owner_email:   acCtx.ownerEmail,
              business_name: acCtx.businessName,
              cycle_label:   acResult.matured_cycle_label || "Personal Savings",
              net_balance:   acResult.matured_net_balance || 0,
              date:          new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
            }),
          );
        }
        await Promise.allSettled(effects);
      })().catch(() => null),
      new Promise<void>(r => setTimeout(r, 2500)),
    ]);

    return json(acData);
  }

  // ── Collection record: record + immediately approve (owner/staff physically collecting) ──
  //
  // Orphan-recovery design: if the approve step previously failed after the record step
  // succeeded, a pending row tagged contribution_source='collection' is left in the DB.
  // On retry, we detect this orphan (matching client + amount + source='collection' + pending)
  // and skip the insert, running only the approve step on the existing row.
  //
  // The source='collection' tag ensures this check never touches client-submitted
  // manual-deposit claims (those use initiated_by='client'), which must always wait
  // for explicit owner confirmation and must never be auto-approved by a collection retry.
  if (action === "collection_record") {
    const { client_id, amount, contribution_context, cycle_id: callerCollCycleId, group_id: callerCollGroupId } = params as {
      client_id: string; amount: number; contribution_context?: string; cycle_id?: string; group_id?: string;
    };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const recordedBy = null;
    const context    = contribution_context || "personal_savings";
    const dateStr    = new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });

    // Resolve cycle_id: caller's explicit choice wins; fall back to auto-pick/auto-open.
    let collCycleId: string | null = callerCollCycleId || null;
    if (!collCycleId && context === "personal_savings") {
      const { data: existingCollCycle } = await sb
        .from("ajo_cycles").select("id").eq("client_id", client_id).eq("status", "active")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (existingCollCycle) {
        collCycleId = existingCollCycle.id as string;
      } else {
        const { data: collClientRow } = await sb
          .from("aso_clients")
          .select("contribution_amount, contribution_frequency, commission_model, commission_percent")
          .eq("id", client_id).maybeSingle();
        if ((collClientRow as Record<string, unknown>)?.contribution_amount) {
          const cr = collClientRow as Record<string, unknown>;
          const { data: openData } = await sb.rpc("ajo_open_cycle", {
            p_client_id:        client_id,
            p_owner_id:         ownerId,
            p_start:            null, // defaults to CURRENT_DATE in RPC — never registration_date
            p_length:           null,
            p_amount:           cr.contribution_amount as number,
            p_label:            "Personal Savings",
            p_commission_model: (cr.commission_model as string) || null,
            p_commission_pct:   (cr.commission_percent as number) || null,
            p_force:            false,
            p_frequency:        (cr.contribution_frequency as string) || null,
          });
          collCycleId = (openData as Record<string, unknown>)?.cycle_id as string || null;
        }
      }
    }

    // ── Fix 2: Validate group membership and active round ──
    if (context === "group_savings" || context === "esusu_rotation") {
      const gid = callerCollGroupId;
      if (!gid) return json({ ok: false, error: "Select a savings group to contribute to" }, 400);
      const { data: gmem } = await sb.from("aso_client_group_memberships")
        .select("id").eq("client_id", client_id).eq("group_id", gid)
        .eq("status", "active").maybeSingle();
      if (!gmem) return json({ ok: false, error: "This client is not an active member of the selected group" }, 400);
      if (context === "esusu_rotation") {
        const { data: grd } = await sb.from("ajo_group_rounds")
          .select("id").eq("group_id", gid).eq("status", "active").maybeSingle();
        if (!grd) return json({ ok: false, error: "This esusu group has no active round — ask your savings agent to start one" }, 400);
      }
      if (context === "group_savings") {
        const { data: grpRow } = await sb.from("ajo_groups")
          .select("round_status").eq("id", gid).maybeSingle();
        if (!grpRow || grpRow.round_status !== "active") {
          return json({ ok: false, error: "This savings group hasn't started — ask your savings agent to start it" }, 400);
        }
      }
    }

    // ── Fix 3: First-deposit minimum ──
    if (context === "personal_savings" && collCycleId) {
      const { data: f3Cli } = await sb.from("aso_clients").select("registration_charge").eq("id", client_id).maybeSingle();
      const { data: f3Cyc } = await sb.from("ajo_cycles").select("expected_amount_per_period").eq("id", collCycleId).maybeSingle();
      const regCharge = Number((f3Cli as Record<string, unknown>)?.registration_charge || 0);
      const expected  = Number((f3Cyc as Record<string, unknown>)?.expected_amount_per_period || 0);
      const minReq    = expected + regCharge;
      if (minReq > 0 && Number(amount) < minReq) {
        const { data: hasFirst } = await sb.from("ajo_contributions")
          .select("id").eq("aso_client_id", client_id).eq("status", "completed").eq("type", "contribution").limit(1).maybeSingle();
        if (!hasFirst) {
          return json({
            ok: false,
            error: `First deposit must be ₦${minReq.toLocaleString("en-NG")} — ₦${expected.toLocaleString("en-NG")} contribution + ₦${regCharge.toLocaleString("en-NG")} registration`,
            min_amount: minReq,
          }, 400);
        }
      }
    }

    // Check for orphaned pending row left by a prior collection attempt for this client+amount
    const { data: orphan } = await sb
      .from("ajo_contributions")
      .select("id")
      .eq("aso_client_id", client_id)
      .eq("amount", amount)
      .eq("status", "pending")
      .eq("contribution_source", "collection")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let contribId: string;
    const recovered = !!orphan?.id;

    if (recovered) {
      // Recovery path: orphan found — skip the insert, run only approve
      contribId = orphan!.id as string;
    } else {
      // Normal path: create new pending entry tagged as collection
      const { data: recData, error: recErr } = await sb.rpc("ajo_record_contribution", {
        p_client_id:            client_id,
        p_owner_id:             ownerId,
        p_amount:               amount,
        p_method:               "cash",
        p_ref:                  null,
        p_notes:                null,
        p_recorded_by:          recordedBy,
        p_contribution_context: context,
        p_source:               "collection",
        p_cycle_id:             collCycleId,
        p_group_id:             callerCollGroupId || null,
      });
      if (recErr || !(recData as Record<string, unknown>)?.ok) {
        return json({
          ok:    false,
          stage: "record",
          error: "Couldn't record — nothing saved, retry safely",
        });
      }
      contribId = (recData as Record<string, unknown>).contribution_id as string;
    }

    // Approve the pending entry (new or recovered orphan)
    const { data: appData, error: appErr } = await sb.rpc("ajo_approve_contribution", {
      p_contribution_id: contribId,
      p_owner_id:        ownerId,
      p_approver_id:     user.id,
    });
    if (appErr || !(appData as Record<string, unknown>)?.ok) {
      return json({
        ok:    false,
        stage: "approve",
        error: "Recorded but not credited — retry to complete; do not re-enter manually",
      });
    }

    const app = appData as Record<string, unknown>;
    const ctx = await fetchEmailContext(sb, client_id, ownerId, user.id);
    await fireAjoEmail("ajo_contribution_collected", {
      client_email:  ctx.clientEmail,
      client_name:   ctx.clientName,
      owner_email:   ctx.ownerEmail,
      business_name: ctx.businessName,
      staff_name:    ctx.staffName,
      amount,
      method:        "cash",
      date:          dateStr,
      new_balance:   app.new_balance || 0,
    });

    const collClientUserId = await resolveClientUserId(sb, client_id);
    await notifyUser(sb, collClientUserId, {
      type: "contribution_approved", title: "Contribution Recorded",
      body: `Your ₦${Number(amount).toLocaleString("en-NG")} contribution has been recorded and credited`,
      priority: "normal", deepLink: { tab: "contributions" }, category: "savings",
    });

    if (app.cycle_just_matured) {
      const maturedAmt = Number(app.matured_net_balance || 0).toLocaleString("en-NG");
      notifyUser(sb, collClientUserId, {
        type: "cycle_matured", title: "Savings Cycle Complete!",
        body: `Your "${app.matured_cycle_label || "Personal Savings"}" cycle is complete — ₦${maturedAmt} is now available to withdraw`,
        priority: "high", deepLink: { tab: "contributions" }, category: "savings",
      }).catch(() => null);
      fireAjoEmail("ajo_cycle_matured", {
        client_email:  ctx.clientEmail,
        client_name:   ctx.clientName,
        owner_email:   ctx.ownerEmail,
        business_name: ctx.businessName,
        cycle_label:   app.matured_cycle_label || "Personal Savings",
        net_balance:   app.matured_net_balance || 0,
        date:          dateStr,
      }).catch(() => null);
    }

    return json({ ok: true, recovered, ...app });
  }

  if (action === "record_withdrawal") {
    const { client_id, gross_amount, method, notes, request_id } = params as {
      client_id: string; gross_amount: number;
      method?: string; notes?: string; request_id?: string;
    };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const recordedBy = null;

    // Block direct withdrawals while a client archive request is pending.
    // Approvals of existing withdrawal requests (request_id present) are still allowed
    // so the owner can clear pending requests before or after the archive executes.
    if (!request_id) {
      const { data: clPaW } = await sb.from("aso_clients").select("pending_archive").eq("id", client_id).maybeSingle();
      if (clPaW?.pending_archive) {
        return json({ ok: false, error: "This client has a pending archive request — direct withdrawals cannot be recorded until it is resolved." }, 409);
      }
    }

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

    // RPC returns ok:false on domain errors (e.g. "Insufficient balance") — these are
    // not PostgreSQL errors so `error` is null above; guard explicitly here.
    if (!rpcWd?.ok) {
      const rpcErr = (rpcWd?.error as string) || "Withdrawal failed";
      // Auto-reject the request so it does not remain pending — the client must
      // re-submit once their balance is sufficient.
      if (request_id) {
        await sb.from("ajo_withdrawal_requests")
          .update({ status: "rejected", approved_at: new Date().toISOString() })
          .eq("id", request_id);
        const rCtx = await fetchEmailContext(sb, client_id, ownerId, user.id);
        await fireAjoEmail("ajo_withdrawal_rejected", {
          client_email:  rCtx.clientEmail,
          client_name:   rCtx.clientName,
          user_email:    rCtx.ownerEmail,
          business_name: rCtx.businessName,
          group_name:    "",
          amount:        gross_amount,
          reason:        `Insufficient balance at time of approval. ${rpcErr}`,
          date:          new Date().toLocaleDateString("en-NG"),
        }).catch(() => {});
        const [rwFailClientUserId, rwFailStaffUid] = await Promise.all([
          resolveClientUserId(sb, client_id),
          resolveAssignedStaffUserId(sb, client_id),
        ]);
        await Promise.allSettled([
          notifyUser(sb, rwFailClientUserId, {
            type: "withdrawal_rejected", title: "Withdrawal Rejected",
            body: `Your withdrawal request for ₦${Number(gross_amount).toLocaleString("en-NG")} was rejected — insufficient balance`,
            priority: "high", deepLink: { tab: "contributions" }, category: "money",
          }),
          notifyUser(sb, rwFailStaffUid !== user.id ? rwFailStaffUid : null, {
            type: "assigned_client_withdrawal", title: "Client Withdrawal Rejected",
            body: `${rCtx.clientName || "A client"}'s ₦${Number(gross_amount).toLocaleString("en-NG")} withdrawal was rejected — insufficient balance`,
            priority: "high", deepLink: { tab: "home" }, category: "money",
          }),
        ]);
      }
      return json({ ok: false, error: rpcErr }, 400);
    }

    // Fetch context then fire all post-withdrawal side effects in parallel with a 2.5 s cap
    await Promise.race([
      (async () => {
        const [ctx, rwApprClientUserId] = await Promise.all([
          fetchEmailContext(sb, client_id, ownerId, user.id),
          resolveClientUserId(sb, client_id), // always resolve — needed for both request and direct paths
        ]);
        if (request_id) {
          const rwApprStaffUid = await resolveAssignedStaffUserId(sb, client_id);
          await Promise.allSettled([
            fireAjoEmail("ajo_withdrawal_approved", {
              client_email:  ctx.clientEmail,
              client_name:   ctx.clientName,
              user_email:    ctx.ownerEmail,
              business_name: ctx.businessName,
              staff_email:   ctx.staffEmail,
              staff_name:    ctx.staffName,
              amount:        rpcWd?.gross_amount,
              fee_amount:    rpcWd?.fee_amount,
              net_amount:    rpcWd?.net_amount,
              balance_after: rpcWd?.new_balance,
              date:          new Date().toLocaleDateString("en-NG"),
            }),
            notifyUser(sb, rwApprClientUserId, {
              type: "withdrawal_approved", title: "Withdrawal Approved",
              body: `Your withdrawal of ₦${Number(rpcWd?.net_amount ?? gross_amount).toLocaleString("en-NG")} has been approved`,
              priority: "high", deepLink: { tab: "contributions" }, category: "money",
            }),
            notifyUser(sb, rwApprStaffUid !== user.id ? rwApprStaffUid : null, {
              type: "assigned_client_withdrawal", title: "Client Withdrawal Approved",
              body: `${ctx.clientName || "A client"}'s ₦${Number(rpcWd?.net_amount ?? gross_amount).toLocaleString("en-NG")} withdrawal was approved`,
              priority: "high", deepLink: { tab: "home" }, category: "money",
            }),
          ]);
        } else {
          // Direct withdrawal: email + client push (client gets no separate approval step so
          // notify them now that the payment is done)
          await Promise.allSettled([
            fireAjoEmail("ajo_withdrawal", {
              client_email:  ctx.clientEmail,
              client_name:   ctx.clientName,
              user_email:    ctx.ownerEmail,
              business_name: ctx.businessName,
              staff_email:   ctx.staffEmail,
              staff_name:    ctx.staffName,
              amount:        rpcWd?.net_amount,
              gross_amount:  rpcWd?.gross_amount,
              fee_amount:    rpcWd?.fee_amount,
              balance_after: rpcWd?.new_balance,
              date:          new Date().toLocaleDateString("en-NG"),
            }),
            notifyUser(sb, rwApprClientUserId, {
              type:     "withdrawal_approved",
              title:    "Payment Processed",
              body:     `Your payment of ₦${Number(rpcWd?.net_amount ?? gross_amount).toLocaleString("en-NG")} has been processed`,
              priority: "high",
              deepLink: { tab: "contributions" },
              category: "money",
            }),
          ]);
        }
        if (rpcWd.cycle_just_closed) {
          notifyUser(sb, rwApprClientUserId, {
            type: "cycle_settled", title: "Savings Cycle Closed",
            body: `Your "${rpcWd.closed_cycle_label || "Personal Savings"}" savings cycle is now closed. Thank you for saving!`,
            priority: "normal", deepLink: { tab: "contributions" }, category: "savings",
          }).catch(() => null);
        }
      })().catch(() => null),
      new Promise<void>(r => setTimeout(r, 2500)),
    ]);

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
      .select("aso_client_id, owner_id, amount, group_id")
      .eq("id", rwrId)
      .single();
    if (rwrErr || !rwrRow) return json({ ok: false, error: "Request not found" }, 404);

    const ownerId = rwrRow.owner_id as string;
    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { error: updErr } = await sb
      .from("ajo_withdrawal_requests")
      .update({ status: "rejected", approved_at: new Date().toISOString() })
      .eq("id", rwrId);
    if (updErr) return json({ ok: false, error: updErr.message });

    const clientId = rwrRow.aso_client_id as string;
    await Promise.race([
      (async () => {
        const [ctx, rwrClientUserId, rwrStaffUid, grpRow] = await Promise.all([
          fetchEmailContext(sb, clientId, ownerId, user.id),
          resolveClientUserId(sb, clientId),
          resolveAssignedStaffUserId(sb, clientId),
          (rwrRow as Record<string, unknown>).group_id
            ? sb.from("ajo_groups").select("name").eq("id", (rwrRow as Record<string, unknown>).group_id as string).maybeSingle().then(r => r.data)
            : Promise.resolve(null),
        ]);
        await Promise.allSettled([
          fireAjoEmail("ajo_withdrawal_rejected", {
            client_email:  ctx.clientEmail,
            client_name:   ctx.clientName,
            user_email:    ctx.ownerEmail,
            business_name: ctx.businessName,
            group_name:    (grpRow as Record<string, unknown> | null)?.name as string || "",
            amount:        (rwrRow as Record<string, unknown>).amount,
            reason:        rwrReason || "",
            date:          new Date().toLocaleDateString("en-NG"),
          }),
          notifyUser(sb, rwrClientUserId, {
            type: "withdrawal_rejected", title: "Withdrawal Rejected",
            body: `Your withdrawal request for ₦${Number((rwrRow as Record<string, unknown>).amount).toLocaleString("en-NG")} was rejected${rwrReason ? ` — ${rwrReason}` : ""}`,
            priority: "high", deepLink: { tab: "contributions" }, category: "money",
          }),
          notifyUser(sb, rwrStaffUid !== user.id ? rwrStaffUid : null, {
            type: "assigned_client_withdrawal", title: "Client Withdrawal Rejected",
            body: `${ctx.clientName || "A client"}'s ₦${Number((rwrRow as Record<string, unknown>).amount).toLocaleString("en-NG")} withdrawal was rejected${rwrReason ? ` — ${rwrReason}` : ""}`,
            priority: "high", deepLink: { tab: "home" }, category: "money",
          }),
        ]);
      })().catch(() => null),
      new Promise<void>(r => setTimeout(r, 2500)),
    ]);

    return json({ ok: true });
  }

  if (action === "open_cycle") {
    const {
      client_id: ocClientId, start_date, length_periods, expected_amount_per_period,
      label: ocLabel, commission_model: ocCommModel, commission_percent: ocCommPct,
      force: ocForce, frequency: ocFrequency,
    } = params as {
      client_id: string; start_date?: string; length_periods?: number;
      expected_amount_per_period?: number; label?: string;
      commission_model?: string; commission_percent?: number; force?: boolean;
      frequency?: string;
    };
    if (!ocClientId) return json({ ok: false, error: "client_id required" }, 400);

    const ownerId = await resolveClientOwner(sb, ocClientId);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: ocData, error: ocErr } = await sb.rpc("ajo_open_cycle", {
      p_client_id:        ocClientId,
      p_owner_id:         ownerId,
      p_start:            start_date        || null,
      p_length:           length_periods    || null,
      p_amount:           expected_amount_per_period || null,
      p_label:            ocLabel           || null,
      p_commission_model: ocCommModel       || null,
      p_commission_pct:   ocCommPct         || null,
      p_force:            ocForce           || false,
      p_frequency:        ocFrequency       || null,
    });
    if (ocErr) return json({ ok: false, error: ocErr.message });
    return json(ocData);
  }

  if (action === "close_cycle") {
    const { cycle_id, status: closeStatus } =
      params as { cycle_id: string; status?: string };
    if (!cycle_id) return json({ ok: false, error: "cycle_id required" }, 400);

    const { data: cycleRow } = await sb
      .from("ajo_cycles")
      .select("client_id, owner_id")
      .eq("id", cycle_id)
      .maybeSingle();
    if (!cycleRow) return json({ ok: false, error: "Cycle not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, cycleRow.owner_id as string);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: ccData, error: ccErr } = await sb.rpc("ajo_close_cycle", {
      p_cycle_id: cycle_id,
      p_owner_id: cycleRow.owner_id as string,
      p_status:   closeStatus || "completed",
    });
    if (ccErr) return json({ ok: false, error: ccErr.message });
    return json(ccData);
  }

  if (action === "execute_commission") {
    const { cycle_id: ecCycleId, amount: ecAmount } =
      params as { cycle_id: string; amount: number };
    if (!ecCycleId) return json({ ok: false, error: "cycle_id required" }, 400);
    if (!ecAmount || Number(ecAmount) <= 0) return json({ ok: false, error: "amount must be > 0" }, 400);

    const { data: cycleRow } = await sb
      .from("ajo_cycles")
      .select("client_id, owner_id, commission_model")
      .eq("id", ecCycleId)
      .maybeSingle();
    if (!cycleRow) return json({ ok: false, error: "Cycle not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, cycleRow.owner_id as string);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: ecData, error: ecErr } = await sb.rpc("ajo_execute_commission", {
      p_cycle_id: ecCycleId,
      p_owner_id: cycleRow.owner_id as string,
      p_amount:   Number(ecAmount),
    });
    if (ecErr) return json({ ok: false, error: ecErr.message });
    if (!(ecData as Record<string, unknown>)?.ok) return json(ecData);

    const ctx = await fetchEmailContext(sb, cycleRow.client_id as string, cycleRow.owner_id as string, user.id);
    await fireAjoEmail("ajo_commission", {
      client_email:     ctx.clientEmail,
      client_name:      ctx.clientName,
      user_email:       ctx.ownerEmail,
      business_name:    ctx.businessName,
      staff_email:      ctx.staffEmail,
      staff_name:       ctx.staffName,
      amount:           Number(ecAmount),
      balance_after:    (ecData as Record<string, unknown>)?.balance_after,
      commission_model: cycleRow.commission_model,
      date:             new Date().toLocaleDateString("en-NG"),
    });

    return json(ecData);
  }

  if (action === "reverse_contribution") {
    const { original_id, reason } = params as { original_id: string; reason: string };

    const { ownerId, clientId, originalAmount } = await resolveContrib(sb, original_id);
    if (!ownerId) return json({ ok: false, error: "Contribution not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data, error } = await sb.rpc("ajo_reverse_contribution", {
      p_original_id: original_id,
      p_owner_id:    ownerId,
      p_reason:      reason,
    });
    if (error) return json({ ok: false, error: error.message });

    const rpcRev = data as Record<string, unknown>;
    // Only fire notifications on confirmed success — never on domain failures
    // (short reason, already reversed, balance too low, unauthorized, etc.)
    if (!rpcRev?.ok) return json(data);

    if (clientId) {
      const ctx    = await fetchEmailContext(sb, clientId, ownerId, user.id);
      await fireAjoEmail("ajo_reversal", {
        client_email:  ctx.clientEmail,
        client_name:   ctx.clientName,
        user_email:    ctx.ownerEmail,
        business_name: ctx.businessName,
        staff_email:   ctx.staffEmail,
        staff_name:    ctx.staffName,
        amount:        originalAmount,
        balance_after: rpcRev?.new_balance,
        reason:        reason || "",
        original_type: rpcRev?.original_type || "contribution",
        date:          new Date().toLocaleDateString("en-NG"),
      });

      // Push notification to client about the reversal
      const { data: rrcl } = await sb.from("aso_clients").select("client_user_id").eq("id", clientId).maybeSingle();
      notifyUser(sb, rrcl?.client_user_id, {
        type:     "contribution_reversed",
        title:    "Contribution Reversed",
        body:     `₦${Number(originalAmount).toLocaleString("en-NG")} contribution was reversed${reason ? ` — ${reason}` : ""}`,
        priority: "high",
        deepLink: { tab: "contributions" },
        category: "savings",
      });
    }

    return json(data);
  }

  if (action === "confirm_manual_deposit") {
    const { claim_id } = params as { claim_id: string };

    // Resolve owner from the claim itself (don't trust client-supplied owner_id)
    const { data: claim } = await sb
      .from("ajo_contributions")
      .select("owner_id, aso_client_id, contribution_context, group_id")
      .eq("id", claim_id)
      .maybeSingle();

    if (!claim) return json({ ok: false, error: "Claim not found" }, 404);
    const ownerId = claim.owner_id;

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    // Gate: group_savings deposits cannot be confirmed if the round is no longer active
    if (claim.contribution_context === "group_savings" && claim.group_id) {
      const { data: grpRow } = await sb.from("ajo_groups")
        .select("round_status").eq("id", claim.group_id).maybeSingle();
      if (!grpRow || grpRow.round_status !== "active") {
        return json({ ok: false, error: "This savings group is no longer active — the deposit cannot be confirmed" }, 400);
      }
    }

    const { data, error } = await sb.rpc("ajo_confirm_manual_deposit", {
      p_claim_id:     claim_id,
      p_owner_id:     ownerId,
      p_confirmed_by: user.id,
    });
    if (error) return json({ ok: false, error: error.message });
    if (!data?.ok) return json({ ok: false, error: data?.error || "Failed to confirm" });

    // Fire confirmation email + push notification — capped at 2.5 s so a slow
    // email endpoint never causes a client-side WebView timeout (10 s budget).
    await Promise.race([
      (async () => {
        const [ctx, mdClientUserId] = await Promise.all([
          fetchEmailContext(sb, claim.aso_client_id, ownerId, user.id),
          resolveClientUserId(sb, claim.aso_client_id),
        ]);
        await Promise.allSettled([
          fireAjoEmail("ajo_manual_deposit_confirmed", {
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
          }),
          notifyUser(sb, mdClientUserId, {
            type: "deposit_confirmed", title: "Deposit Confirmed",
            body: `Your deposit of ₦${Number(data?.amount).toLocaleString("en-NG")} was confirmed and credited`,
            priority: "high", deepLink: { tab: "contributions" }, category: "money",
          }),
          ...(data?.cycle_just_matured ? [
            notifyUser(sb, mdClientUserId, {
              type: "cycle_matured", title: "Savings Cycle Complete!",
              body: `Your "${data.matured_cycle_label || "Personal Savings"}" cycle is complete — ₦${Number(data.matured_net_balance || 0).toLocaleString("en-NG")} is now available to withdraw`,
              priority: "high", deepLink: { tab: "contributions" }, category: "savings",
            }),
            fireAjoEmail("ajo_cycle_matured", {
              client_email:  ctx.clientEmail,
              client_name:   ctx.clientName,
              owner_email:   ctx.ownerEmail,
              business_name: ctx.businessName,
              cycle_label:   data.matured_cycle_label || "Personal Savings",
              net_balance:   data.matured_net_balance || 0,
              date:          new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
            }),
          ] : []),
        ]);
      })().catch(() => null),
      new Promise<void>(r => setTimeout(r, 2500)),
    ]);

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
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data, error } = await sb.rpc("ajo_reject_manual_claim", {
      p_claim_id: claim_id,
      p_owner_id: ownerId,
      p_reason:   reason,
    });
    if (error) return json({ ok: false, error: error.message });
    if (!data?.ok) return json({ ok: false, error: data?.error || "Failed to reject" });

    // Fire rejection email + push notification — capped at 2.5 s so a slow
    // email endpoint never causes a client-side WebView timeout (10 s budget).
    await Promise.race([
      (async () => {
        const [ctx, rmcClientUserId] = await Promise.all([
          fetchEmailContext(sb, claim.aso_client_id, ownerId, user.id),
          resolveClientUserId(sb, claim.aso_client_id),
        ]);
        await Promise.allSettled([
          fireAjoEmail("ajo_manual_deposit_rejected", {
            client_email:  ctx.clientEmail,
            client_name:   ctx.clientName,
            user_email:    ctx.ownerEmail,
            business_name: ctx.businessName,
            amount:        claim.amount,
            reason:        reason,
            date:          new Date().toLocaleDateString("en-NG"),
          }),
          notifyUser(sb, rmcClientUserId, {
            type: "deposit_rejected", title: "Deposit Rejected",
            body: `Your deposit claim was rejected${reason?.trim() ? ` — ${reason.trim()}` : ""}`,
            priority: "high", deepLink: { tab: "contributions" }, category: "money",
          }),
        ]);
      })().catch(() => null),
      new Promise<void>(r => setTimeout(r, 2500)),
    ]);

    return json(data);
  }

  if (action === "archive_client") {
    const { client_id } = params as { client_id: string };

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data, error } = await sb.rpc("ajo_archive_client", {
      p_client_id: client_id,
      p_owner_id:  ownerId,
    });
    if (error) return json({ ok: false, error: error.message });
    return json(data);
  }

  // ── Submit a client archive approval request (PIN-gated) ─────────────────────
  if (action === "request_client_archive") {
    const { client_id, reason } = params as { client_id: string; reason?: string };
    if (!client_id) return json({ ok: false, error: "client_id required" }, 400);
    if (!reason?.trim()) return json({ ok: false, error: "A reason is required" }, 400);

    const ownerId = await resolveClientOwner(sb, client_id);
    if (!ownerId) return json({ ok: false, error: "Client not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: client } = await sb
      .from("aso_clients")
      .select("full_name, membership_number, total_saved, total_withdrawn, current_balance, pending_archive")
      .eq("id", client_id)
      .maybeSingle();
    if (!client) return json({ ok: false, error: "Client not found" }, 404);

    if (Number(client.current_balance || 0) !== 0) {
      return json({ ok: false, error: `Balance must be ₦0.00 before requesting archive. Current balance: ₦${client.current_balance}` }, 400);
    }
    if (client.pending_archive) {
      return json({ ok: false, error: "An archive request is already pending for this client" }, 409);
    }

    const { data: ownerProfile } = await sb.from("profiles").select("business_name").eq("id", ownerId).maybeSingle();

    const { error: insertErr } = await sb.from("admin_approval_requests").insert({
      request_type: "client_archive",
      requester:    ownerId,
      business:     (ownerProfile as Record<string, string> | null)?.business_name ?? "",
      target_id:    client_id,
      payload: {
        full_name:         client.full_name,
        membership_number: client.membership_number,
        total_saved:       Number(client.total_saved) || 0,
        total_withdrawn:   Number(client.total_withdrawn) || 0,
      },
      reason: reason.trim(),
    });
    if (insertErr) return json({ ok: false, error: insertErr.message }, 500);

    await sb.from("aso_clients").update({ pending_archive: true }).eq("id", client_id);

    return json({ ok: true });
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
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    await sb.from("ajo_contributions")
      .update({ dispute_ticket_no: null })
      .eq("id", contribution_id);

    return json({ ok: true });
  }

  // ── Esusu: start_round ─────────────────────────────────────────────────
  if (action === "start_round") {
    const { group_id: srGroupId, turns: srTurns } =
      params as { group_id: string; turns: Array<{ client_id: string; expected_payout_date?: string }> };
    if (!srGroupId) return json({ ok: false, error: "group_id required" }, 400);
    if (!srTurns?.length) return json({ ok: false, error: "turns array required" }, 400);

    const { data: grpRow } = await sb.from("ajo_groups").select("owner_id").eq("id", srGroupId).maybeSingle();
    if (!grpRow) return json({ ok: false, error: "Group not found" }, 404);

    const ajoPerms = await resolveAjoPerms(sb, user.id, grpRow.owner_id as string);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: srData, error: srErr } = await sb.rpc("ajo_start_round", {
      p_group_id: srGroupId,
      p_owner_id: grpRow.owner_id as string,
      p_turns:    srTurns,
    });
    if (srErr) return json({ ok: false, error: srErr.message });
    return json(srData);
  }

  // ── Savings: start_savings_round ──────────────────────────────────────────
  if (action === "start_savings_round") {
    const { group_id: ssrGid, target_amount: ssrTarget, target_deadline: ssrDeadline } =
      params as { group_id: string; target_amount: number; target_deadline: string };
    if (!ssrGid) return json({ ok: false, error: "group_id required" });
    if (!ssrTarget || ssrTarget <= 0) return json({ ok: false, error: "target_amount required and must be > 0" });
    if (!ssrDeadline) return json({ ok: false, error: "target_deadline required" });

    const { data: ssrGrp } = await sb.from("ajo_groups").select("owner_id").eq("id", ssrGid).maybeSingle();
    if (!ssrGrp) return json({ ok: false, error: "Group not found" });

    const ssrPerms = await resolveAjoPerms(sb, user.id, ssrGrp.owner_id as string);
    if (ssrPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" });

    const { data: ssrData, error: ssrErr } = await sb.rpc("ajo_start_savings_round", {
      p_owner_id:      ssrGrp.owner_id as string,
      p_group_id:      ssrGid,
      p_target_amount: ssrTarget,
      p_deadline:      ssrDeadline,
    });
    if (ssrErr) return json({ ok: false, error: ssrErr.message });
    return json(ssrData);
  }

  // ── Savings: close_savings_round (PIN-gated) ─────────────────────────────
  if (action === "close_savings_round") {
    const { group_id: csrGid } = params as { group_id: string };
    if (!csrGid) return json({ ok: false, error: "group_id required" }, 400);

    const { data: csrGrp } = await sb.from("ajo_groups")
      .select("owner_id, name").eq("id", csrGid).maybeSingle();
    if (!csrGrp) return json({ ok: false, error: "Group not found" }, 404);

    const csrOwnerId = csrGrp.owner_id as string;
    const csrPerms = await resolveAjoPerms(sb, user.id, csrOwnerId);
    if (csrPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: csrData, error: csrErr } = await sb.rpc("ajo_close_savings_round", {
      p_owner_id: csrOwnerId,
      p_group_id: csrGid,
    });
    if (csrErr) return json({ ok: false, error: csrErr.message });
    if (!(csrData as Record<string, unknown>)?.ok) return json(csrData);

    const csr = csrData as Record<string, unknown>;
    const releases = (csr.releases as Array<{ client_id: string; client_name: string; released_amount: number }>) || [];

    // Fetch owner profile once for email context
    const csrOwnerRow = await sb.from("profiles")
      .select("email, business_name").eq("id", csrOwnerId).maybeSingle().then(r => r.data);
    const csrOwnerEmail   = (csrOwnerRow as Record<string,string> | null)?.email         || "";
    const csrBusinessName = (csrOwnerRow as Record<string,string> | null)?.business_name || "";

    // Notify all released members (push + email)
    await Promise.race([
      Promise.allSettled(
        releases.map(async rel => {
          const [clientUserId, clientRow] = await Promise.all([
            resolveClientUserId(sb, rel.client_id),
            sb.from("aso_clients").select("email").eq("id", rel.client_id).maybeSingle().then(r => r.data),
          ]);
          const clientEmail = (clientRow as Record<string,string> | null)?.email || "";
          const effects: Promise<unknown>[] = [];
          if (clientUserId) {
            effects.push(notifyUser(sb, clientUserId, {
              type:     "group_funds_released",
              title:    "Savings group funds released",
              body:     `${csrGrp.name || "Savings group"} has closed — ₦${Number(rel.released_amount).toLocaleString("en-NG")} is now available in your balance`,
              priority: "high",
              deepLink: { tab: "contributions" }, category: "savings",
            }));
          }
          if (clientEmail) {
            effects.push(fireAjoEmail("ajo_group_release", {
              client_email:  clientEmail,
              client_name:   rel.client_name || "",
              owner_email:   csrOwnerEmail,
              business_name: csrBusinessName,
              group_name:    csrGrp.name    || "",
              amount:        rel.released_amount,
              date:          new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
            }));
          }
          return Promise.allSettled(effects);
        })
      ),
      new Promise<void>(r => setTimeout(r, 2500)),
    ]);

    return json(csrData);
  }

  // ── Savings: release_savings_member (PIN-gated) ──────────────────────────
  if (action === "release_savings_member") {
    const { group_id: rsmGid, client_id: rsmClientId } =
      params as { group_id: string; client_id: string };
    if (!rsmGid || !rsmClientId) return json({ ok: false, error: "group_id and client_id required" }, 400);

    const { data: rsmGrp } = await sb.from("ajo_groups")
      .select("owner_id, name").eq("id", rsmGid).maybeSingle();
    if (!rsmGrp) return json({ ok: false, error: "Group not found" }, 404);

    const rsmOwnerId = rsmGrp.owner_id as string;
    const rsmPerms = await resolveAjoPerms(sb, user.id, rsmOwnerId);
    if (rsmPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: rsmData, error: rsmErr } = await sb.rpc("ajo_release_savings_member", {
      p_owner_id:  rsmOwnerId,
      p_group_id:  rsmGid,
      p_client_id: rsmClientId,
    });
    if (rsmErr) return json({ ok: false, error: rsmErr.message });
    if (!(rsmData as Record<string, unknown>)?.ok) return json(rsmData);

    const rsm = rsmData as Record<string, unknown>;
    await Promise.race([
      (async () => {
        const rsmUserId = await resolveClientUserId(sb, rsmClientId);
        if (!rsmUserId) return;
        return notifyUser(sb, rsmUserId, {
          type:     "group_funds_released",
          title:    "Released from savings group",
          body:     `You have been released from ${rsmGrp.name}${(rsm.released_amount as number) > 0 ? ` — ₦${Number(rsm.released_amount).toLocaleString("en-NG")} is now available in your balance` : ""}`,
          priority: "high",
          deepLink: { tab: "contributions" }, category: "savings",
        });
      })().catch(() => null),
      new Promise<void>(r => setTimeout(r, 2500)),
    ]);

    return json(rsmData);
  }

  // ── Esusu: execute_payout (PIN-gated) ──────────────────────────────────
  if (action === "execute_payout") {
    const { turn_id: epTurnId } = params as { turn_id: string };
    if (!epTurnId) return json({ ok: false, error: "turn_id required" });

    const { data: turnRow } = await sb.from("ajo_group_turns").select("group_id, position, round_id").eq("id", epTurnId).maybeSingle();
    if (!turnRow) return json({ ok: false, error: "Turn not found" });

    const { data: grpRow } = await sb.from("ajo_groups").select("owner_id").eq("id", turnRow.group_id as string).maybeSingle();
    if (!grpRow) return json({ ok: false, error: "Group not found" });

    const ownerId = grpRow.owner_id as string;
    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" });

    const { data: epData, error: epErr } = await sb.rpc("ajo_execute_payout", {
      p_turn_id:  epTurnId,
      p_owner_id: ownerId,
    });
    if (epErr) return json({ ok: false, error: epErr.message });
    if (!(epData as Record<string, unknown>)?.ok) return json(epData);

    // Payout committed — notifications are best-effort; never let a crash here hide the success
    try {
    // Gather all context needed for rich payout emails
    const epResult            = epData as Record<string, unknown>;
    const groupId             = turnRow.group_id as string;
    const roundId             = turnRow.round_id as string;
    const currentPosition     = (turnRow.position as number) || 0;
    const beneficiaryClientId = epResult.beneficiary_client_id as string;
    const today               = new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });

    const [ownerRow, groupRow, allMembers, beneficiaryRow, nextTurnRow, roundRow, allTurnRows, staffRow] = await Promise.all([
      sb.from("profiles").select("email, business_name").eq("id", ownerId).maybeSingle().then(r => r.data),
      sb.from("ajo_groups").select("name, group_mode").eq("id", groupId).maybeSingle().then(r => r.data),
      sb.from("aso_clients").select("id, full_name, email, client_user_id").eq("ajo_group_id", groupId).then(r => r.data || []),
      sb.from("aso_clients").select("current_balance").eq("id", beneficiaryClientId).maybeSingle().then(r => r.data),
      epResult.next_turn_id
        ? sb.from("ajo_group_turns").select("position, expected_payout_date, client_id").eq("id", epResult.next_turn_id as string).maybeSingle().then(r => r.data)
        : Promise.resolve(null),
      sb.from("ajo_group_rounds").select("round_number").eq("id", roundId).maybeSingle().then(r => r.data),
      sb.from("ajo_group_turns").select("status").eq("round_id", roundId).then(r => r.data || []),
      user.id !== ownerId
        ? sb.from("staff").select("email, full_name").eq("user_id", user.id).eq("owner_id", ownerId).maybeSingle().then(r => r.data)
        : Promise.resolve(null),
    ]);

    // Build clientId → name and clientId → client_user_id maps from members already fetched
    const clientNameMap:   Record<string, string> = {};
    const clientAuthIdMap: Record<string, string> = {};
    (allMembers as Array<{ id: string; full_name: string; client_user_id?: string }>).forEach(m => {
      clientNameMap[m.id]   = m.full_name;
      if (m.client_user_id) clientAuthIdMap[m.id] = m.client_user_id;
    });

    const businessName      = (ownerRow  as { business_name?: string } | null)?.business_name || "";
    const ownerEmail        = (ownerRow  as { email?: string }         | null)?.email          || "";
    const groupName         = (groupRow  as { name?: string }          | null)?.name           || "";
    const groupMode         = (groupRow  as { group_mode?: string }    | null)?.group_mode     || "rotating";
    const roundNumber       = (roundRow  as { round_number?: number }  | null)?.round_number   || 1;
    const potAmount         = epResult.pot_amount as number;
    const newBalance        = (beneficiaryRow as { current_balance?: number } | null)?.current_balance || 0;
    const staffEmail        = (staffRow  as { email?: string }         | null)?.email          || "";
    const staffName         = (staffRow  as { full_name?: string }     | null)?.full_name      || "";
    const executedBy        = staffName || "Owner";
    const totalTurns        = (allTurnRows as Array<{ status: string }>).length;
    const paidTurns         = (allTurnRows as Array<{ status: string }>).filter(t => t.status === "paid").length;
    const nextClientId      = (nextTurnRow as { client_id?: string }           | null)?.client_id           || "";
    const nextPosition      = (nextTurnRow as { position?: number }            | null)?.position            || 0;
    const nextPayoutDate    = (nextTurnRow as { expected_payout_date?: string }| null)?.expected_payout_date || "";
    const nextReceiverName  = nextClientId ? (clientNameMap[nextClientId] || "") : "";

    const debtors = (epResult.debtors as Array<{ client_id: string; client_name: string; client_email: string; amount_owed: number }>) || [];

    const sharedContext = {
      group_name:          groupName,
      group_mode:          groupMode,
      business_name:       businessName,
      round_number:        roundNumber,
      total_turns:         totalTurns,
      paid_turns:          paidTurns,
      remaining_turns:     totalTurns - paidTurns,
      round_complete:      epResult.round_complete || false,
      next_receiver_name:  nextReceiverName,
      next_position:       nextPosition,
      next_payout_date:    nextPayoutDate,
      date:                today,
    };

    // 1. Full payout receipt to beneficiary (includes new balance + who's next)
    await fireAjoEmail("ajo_esusu_payout_receipt", {
      ...sharedContext,
      beneficiary_name:   epResult.beneficiary_name  || "",
      beneficiary_email:  epResult.beneficiary_email || "",
      pot_amount:         potAmount,
      new_balance:        newBalance,
      position:           currentPosition,
      debtor_count:       epResult.debtor_count || 0,
    });

    // 2. Notification to every other group member (full details + who's next)
    for (const member of allMembers as Array<{ id: string; full_name: string; email: string }>) {
      if (!member.email || member.id === beneficiaryClientId) continue;
      await fireAjoEmail("ajo_esusu_member_payout_notify", {
        ...sharedContext,
        member_name:       member.full_name || "",
        member_email:      member.email,
        beneficiary_name:  epResult.beneficiary_name || "",
        pot_amount:        potAmount,
      });
    }

    // 3. Debt notices to members who owe contributions
    for (const debtor of debtors) {
      if (!debtor.client_email) continue;
      await fireAjoEmail("ajo_esusu_debt_notice", {
        ...sharedContext,
        member_name:  debtor.client_name  || "",
        member_email: debtor.client_email,
        amount_owed:  debtor.amount_owed,
      });
    }

    // 4. Full owner summary with all details
    await fireAjoEmail("ajo_esusu_payout_owner_summary", {
      ...sharedContext,
      owner_email:            ownerEmail,
      beneficiary_name:       epResult.beneficiary_name  || "",
      beneficiary_email:      epResult.beneficiary_email || "",
      beneficiary_new_balance: newBalance,
      pot_amount:             potAmount,
      position:               currentPosition,
      debtor_count:           epResult.debtor_count || 0,
      debtors,
      executed_by:            executedBy,
      executed_by_email:      staffEmail || ownerEmail,
    });

    // 5. Staff notification — only when a staff member (not owner) executed the payout
    if (staffEmail) {
      await fireAjoEmail("ajo_esusu_payout_staff_notify", {
        ...sharedContext,
        staff_name:        staffName,
        staff_email:       staffEmail,
        beneficiary_name:  epResult.beneficiary_name || "",
        pot_amount:        potAmount,
        position:          currentPosition,
        debtor_count:      epResult.debtor_count || 0,
      });
    }

    // 6. In-app bell for the beneficiary
    const epBeneficiaryAuthId = clientAuthIdMap[beneficiaryClientId] || await resolveClientUserId(sb, beneficiaryClientId);
    await notifyUser(sb, epBeneficiaryAuthId, {
      type: "payout_received", title: "Esusu Payout Received",
      body: `₦${Number(potAmount).toLocaleString("en-NG")} has been credited to your account`,
      priority: "high", deepLink: { tab: "contributions" }, category: "savings",
    });

    } catch (_notifErr) {
      // Notification or email context build threw — payout already committed, return success
    }
    return json(epData);
  }

  // ── Esusu: skip_turn (PIN-gated) ───────────────────────────────────────
  if (action === "skip_turn") {
    const { turn_id: stTurnId, reason: stReason, move_to_end: stMoveToEnd = true } =
      params as { turn_id: string; reason: string; move_to_end?: boolean };
    if (!stTurnId)  return json({ ok: false, error: "turn_id required" }, 400);
    if (!stReason)  return json({ ok: false, error: "reason required" }, 400);

    const { data: turnRow } = await sb.from("ajo_group_turns").select("group_id, client_id").eq("id", stTurnId).maybeSingle();
    if (!turnRow) return json({ ok: false, error: "Turn not found" }, 404);

    const { data: grpRow } = await sb.from("ajo_groups").select("owner_id").eq("id", turnRow.group_id as string).maybeSingle();
    if (!grpRow) return json({ ok: false, error: "Group not found" }, 404);

    const ownerId = grpRow.owner_id as string;
    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: stData, error: stErr } = await sb.rpc("ajo_skip_turn", {
      p_turn_id:     stTurnId,
      p_owner_id:    ownerId,
      p_reason:      stReason,
      p_move_to_end: stMoveToEnd,
    });
    if (stErr) return json({ ok: false, error: stErr.message });
    if (!(stData as Record<string, unknown>)?.ok) return json(stData);

    // Notify the affected member
    const ctx = await fetchEmailContext(sb, turnRow.client_id as string, ownerId, user.id);
    await fireAjoEmail("ajo_esusu_turn_skipped", {
      client_email:  ctx.clientEmail,
      client_name:   ctx.clientName,
      owner_email:   ctx.ownerEmail,
      business_name: ctx.businessName,
      reason:        stReason,
      moved_to_end:  stMoveToEnd,
      date:          new Date().toLocaleDateString("en-NG"),
    });

    // Push notification to affected member
    const { data: stClientRow } = await sb.from("aso_clients").select("client_user_id").eq("id", turnRow.client_id as string).maybeSingle();
    notifyUser(sb, stClientRow?.client_user_id, {
      type:     "esusu_turn_skipped",
      title:    "Esusu Turn Skipped",
      body:     `Your esusu turn has been skipped — ${stReason}`,
      priority: "high",
      deepLink: { tab: "contributions" },
      category: "savings",
    });

    return json(stData);
  }

  // ── Esusu: reorder_turns (PIN-gated) ───────────────────────────────────
  if (action === "reorder_turns") {
    const { round_id: rtRoundId, new_order: rtNewOrder } =
      params as { round_id: string; new_order: Array<{ turn_id: string; position: number }> };
    if (!rtRoundId)        return json({ ok: false, error: "round_id required" }, 400);
    if (!rtNewOrder?.length) return json({ ok: false, error: "new_order required" }, 400);

    const { data: roundRow } = await sb.from("ajo_group_rounds").select("group_id").eq("id", rtRoundId).maybeSingle();
    if (!roundRow) return json({ ok: false, error: "Round not found" }, 404);

    const { data: grpRow } = await sb.from("ajo_groups").select("owner_id").eq("id", roundRow.group_id as string).maybeSingle();
    if (!grpRow) return json({ ok: false, error: "Group not found" }, 404);

    const ownerId = grpRow.owner_id as string;
    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: rtData, error: rtErr } = await sb.rpc("ajo_reorder_turns", {
      p_round_id:  rtRoundId,
      p_owner_id:  ownerId,
      p_new_order: rtNewOrder,
    });
    if (rtErr) return json({ ok: false, error: rtErr.message });
    return json(rtData);
  }

  // ── Esusu: close_round ─────────────────────────────────────────────────
  if (action === "close_round") {
    const { round_id: crRoundId } = params as { round_id: string };
    if (!crRoundId) return json({ ok: false, error: "round_id required" }, 400);

    const { data: roundRow } = await sb.from("ajo_group_rounds").select("group_id").eq("id", crRoundId).maybeSingle();
    if (!roundRow) return json({ ok: false, error: "Round not found" }, 404);

    const { data: grpRow } = await sb.from("ajo_groups").select("owner_id").eq("id", roundRow.group_id as string).maybeSingle();
    if (!grpRow) return json({ ok: false, error: "Group not found" }, 404);

    const ownerId = grpRow.owner_id as string;
    const ajoPerms = await resolveAjoPerms(sb, user.id, ownerId);
    if (ajoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { data: crData, error: crErr } = await sb.rpc("ajo_close_round", {
      p_round_id: crRoundId,
      p_owner_id: ownerId,
    });
    if (crErr) return json({ ok: false, error: crErr.message });
    return json(crData);
  }

  // ── Owner approves a client reactivation request (PIN-gated) ────────────────
  if (action === "approve_reactivation") {
    const { reactivation_request_id } = params as { reactivation_request_id: string };
    if (!reactivation_request_id) return json({ ok: false, error: "reactivation_request_id required" }, 400);

    const { data: rr } = await sb
      .from("ajo_reactivation_requests")
      .select("id, client_id, owner_id, status, reason, client_name")
      .eq("id", reactivation_request_id)
      .maybeSingle();

    if (!rr) return json({ ok: false, error: "Reactivation request not found" }, 404);
    if ((rr as Record<string, unknown>).owner_id !== user.id) return json({ ok: false, error: "Unauthorized" }, 403);
    if ((rr as Record<string, unknown>).status !== "pending") {
      return json({ ok: false, error: `Request is already ${(rr as Record<string, unknown>).status}` }, 409);
    }

    // Fetch client financial snapshot for admin context
    const { data: clientSnap } = await sb
      .from("aso_clients")
      .select("full_name, email, membership_number, total_saved, total_withdrawn, current_balance")
      .eq("id", (rr as Record<string, unknown>).client_id as string)
      .maybeSingle();

    const { data: ownerProfile } = await sb
      .from("profiles")
      .select("business_name")
      .eq("id", user.id)
      .maybeSingle();

    // Mark reactivation request as owner_approved
    await sb.from("ajo_reactivation_requests")
      .update({ status: "owner_approved" })
      .eq("id", reactivation_request_id);

    // Submit admin approval request
    const { error: aarErr } = await sb.from("admin_approval_requests").insert({
      request_type: "client_reactivation",
      requester:    user.id,
      business:     (ownerProfile as Record<string, string> | null)?.business_name ?? "",
      target_id:    (rr as Record<string, unknown>).client_id as string,
      payload: {
        full_name:               (clientSnap as Record<string, unknown> | null)?.full_name ?? (rr as Record<string, unknown>).client_name ?? "",
        membership_number:       (clientSnap as Record<string, unknown> | null)?.membership_number ?? "",
        total_saved:             Number((clientSnap as Record<string, unknown> | null)?.total_saved) || 0,
        total_withdrawn:         Number((clientSnap as Record<string, unknown> | null)?.total_withdrawn) || 0,
        reactivation_request_id: reactivation_request_id,
        client_reason:           (rr as Record<string, unknown>).reason ?? "",
      },
      reason: `Owner approved reactivation for ${(clientSnap as Record<string, unknown> | null)?.full_name ?? "client"}. Client reason: ${(rr as Record<string, unknown>).reason ?? "none provided"}`,
    });

    if (aarErr) return json({ ok: false, error: aarErr.message }, 500);

    // Notify client: owner approved, waiting for admin
    fireAjoEmail("ajo_reactivation_owner_approved", {
      client_email:  (clientSnap as Record<string, unknown> | null)?.email ?? "",
      client_name:   (clientSnap as Record<string, unknown> | null)?.full_name ?? (rr as Record<string, unknown>).client_name ?? "",
      business_name: (ownerProfile as Record<string, string> | null)?.business_name ?? "",
    });

    // Push notification to client
    const { data: arRCl } = await sb.from("aso_clients").select("client_user_id").eq("id", (rr as Record<string, unknown>).client_id as string).maybeSingle();
    notifyUser(sb, arRCl?.client_user_id, {
      type:     "reactivation_approved",
      title:    "Reactivation Pending Admin",
      body:     `${(ownerProfile as Record<string, string> | null)?.business_name || "Your savings agent"} approved your reactivation — waiting for admin confirmation`,
      priority: "normal",
      deepLink: { tab: "me" },
      category: "savings",
    });

    return json({ ok: true });
  }

  // ── Owner resends stuck owner_approved reactivation to admin (no PIN needed) ──
  // Recovery path: if the original approve_reactivation call succeeded in setting
  // status=owner_approved but the admin_approval_requests INSERT failed (e.g. the
  // CHECK constraint was missing before the 20260714000006 migration), this action
  // idempotently re-creates the missing admin row without requiring a new PIN.
  if (action === "resend_reactivation") {
    const { reactivation_request_id: rraId } = params as { reactivation_request_id: string };
    if (!rraId) return json({ ok: false, error: "reactivation_request_id required" }, 400);

    const { data: rr } = await sb
      .from("ajo_reactivation_requests")
      .select("id, client_id, client_name, owner_id, status, reason")
      .eq("id", rraId)
      .maybeSingle();

    if (!rr) return json({ ok: false, error: "Reactivation request not found" }, 404);
    if ((rr as Record<string, unknown>).owner_id !== user.id) return json({ ok: false, error: "Unauthorized" }, 403);
    if ((rr as Record<string, unknown>).status !== "owner_approved") {
      return json({ ok: false, error: "Only owner-approved requests can be resent" }, 409);
    }

    const clientId = (rr as Record<string, unknown>).client_id as string;

    // Check if an admin_approval_requests row already exists for this client reactivation
    const { data: existingRow } = await sb
      .from("admin_approval_requests")
      .select("id")
      .eq("request_type", "client_reactivation")
      .eq("target_id", clientId)
      .eq("status", "pending")
      .maybeSingle();

    if (existingRow) {
      return json({ ok: true, note: "Already in the admin queue — check the Approvals page." });
    }

    const [{ data: clientSnap }, { data: ownerProfile }] = await Promise.all([
      sb.from("aso_clients").select("full_name, email, membership_number, total_saved, total_withdrawn").eq("id", clientId).maybeSingle(),
      sb.from("profiles").select("business_name").eq("id", user.id).maybeSingle(),
    ]);

    const { error: insertErr } = await sb.from("admin_approval_requests").insert({
      request_type: "client_reactivation",
      requester:    user.id,
      business:     (ownerProfile as Record<string, string> | null)?.business_name ?? "",
      target_id:    clientId,
      payload: {
        full_name:               (clientSnap as Record<string, unknown> | null)?.full_name ?? (rr as Record<string, unknown>).client_name ?? "",
        membership_number:       (clientSnap as Record<string, unknown> | null)?.membership_number ?? "",
        total_saved:             Number((clientSnap as Record<string, unknown> | null)?.total_saved) || 0,
        total_withdrawn:         Number((clientSnap as Record<string, unknown> | null)?.total_withdrawn) || 0,
        reactivation_request_id: rraId,
        client_reason:           (rr as Record<string, unknown>).reason ?? "",
      },
      reason: `Owner approved reactivation for ${(clientSnap as Record<string, unknown> | null)?.full_name ?? "client"}. Client reason: ${(rr as Record<string, unknown>).reason ?? "none provided"}`,
    });

    if (insertErr) return json({ ok: false, error: insertErr.message }, 500);

    fireAjoEmail("ajo_reactivation_owner_approved", {
      client_email:  (clientSnap as Record<string, unknown> | null)?.email ?? "",
      client_name:   (clientSnap as Record<string, unknown> | null)?.full_name ?? (rr as Record<string, unknown>).client_name ?? "",
      business_name: (ownerProfile as Record<string, string> | null)?.business_name ?? "",
    });

    return json({ ok: true, note: "Request sent to admin. They will review it shortly." });
  }

  // ── Owner rejects a client reactivation request (no PIN needed) ──────────────
  if (action === "reject_reactivation") {
    const { reactivation_request_id, note } = params as { reactivation_request_id: string; note?: string };
    if (!reactivation_request_id) return json({ ok: false, error: "reactivation_request_id required" }, 400);

    const { data: rr } = await sb
      .from("ajo_reactivation_requests")
      .select("id, client_id, client_name, owner_id, status")
      .eq("id", reactivation_request_id)
      .maybeSingle();

    if (!rr) return json({ ok: false, error: "Reactivation request not found" }, 404);
    if ((rr as Record<string, unknown>).owner_id !== user.id) return json({ ok: false, error: "Unauthorized" }, 403);
    if ((rr as Record<string, unknown>).status !== "pending") {
      return json({ ok: false, error: `Request is already ${(rr as Record<string, unknown>).status}` }, 409);
    }

    await sb.from("ajo_reactivation_requests")
      .update({ status: "owner_rejected", resolved_at: new Date().toISOString() })
      .eq("id", reactivation_request_id);

    // Notify client: owner rejected the request
    const [{ data: clientForEmail }, { data: ownerForEmail }] = await Promise.all([
      sb.from("aso_clients").select("email, full_name").eq("id", (rr as Record<string, unknown>).client_id as string).maybeSingle(),
      sb.from("profiles").select("business_name").eq("id", user.id).maybeSingle(),
    ]);
    fireAjoEmail("ajo_reactivation_owner_rejected", {
      client_email:   clientForEmail?.email ?? "",
      client_name:    (rr as Record<string, unknown>).client_name as string || clientForEmail?.full_name || "",
      business_name:  (ownerForEmail as Record<string, string> | null)?.business_name ?? "",
      rejection_note: note ?? "",
    });

    // Push notification to client
    const { data: rrRCl } = await sb.from("aso_clients").select("client_user_id").eq("id", (rr as Record<string, unknown>).client_id as string).maybeSingle();
    notifyUser(sb, rrRCl?.client_user_id, {
      type:     "reactivation_rejected",
      title:    "Reactivation Declined",
      body:     `Your reactivation request was declined${note ? ` — ${note}` : ""}`,
      priority: "normal",
      deepLink: { tab: "me" },
      category: "savings",
    });

    return json({ ok: true });
  }

  // ── record_credit_repayment ────────────────────────────────────────────────
  if (action === "record_credit_repayment") {
    const { credit_id, amount, payment_method, notes } = params as {
      credit_id?: string; amount?: unknown;
      payment_method?: string; notes?: string;
    };

    if (!credit_id) return json({ ok: false, error: "credit_id required" }, 400);
    const parsedAmount = parseFloat(String(amount ?? "0"));
    if (!parsedAmount || parsedAmount <= 0) return json({ ok: false, error: "Invalid amount" }, 400);

    // Fetch credit — verify owner
    const { data: credit, error: creditFetchErr } = await sb
      .from("credits")
      .select("id, user_id, amount_paid, total_amount, outstanding, status, customer_name, email, phone, items")
      .eq("id", credit_id)
      .maybeSingle();

    if (creditFetchErr || !credit) return json({ ok: false, error: "Credit not found" }, 404);

    // Branch managers (staff) may record repayments — this is normal branch operations.
    // record_credit_repayment is already PIN_GATED so PIN was verified above.
    // Owners pass (callerUid === credit.user_id → null). Staff must have can_create permission.
    const crPerms = await resolveAjoPerms(sb, user.id, credit.user_id);
    if (crPerms === false) return json({ ok: false, error: "Unauthorized" }, 403);
    if (crPerms !== null && !crPerms.can_create) {
      return json({ ok: false, error: "Permission denied: Ajo contribution recording not enabled for your account" }, 403);
    }

    if (credit.status === "paid") return json({ ok: false, error: "Credit is already fully paid" }, 409);

    const newAmountPaid  = (credit.amount_paid || 0) + parsedAmount;
    const newOutstanding = Math.max(0, (credit.total_amount || 0) - newAmountPaid);
    const newStatus      = newOutstanding === 0 ? "paid" : newAmountPaid > 0 ? "partially_paid" : "active";

    const { error: updateErr } = await sb
      .from("credits")
      .update({ amount_paid: newAmountPaid, outstanding: newOutstanding, status: newStatus })
      .eq("id", credit_id);
    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    const { data: payment, error: payErr } = await sb
      .from("debt_payments")
      .insert({
        credit_id,
        owner_id:       credit.user_id,  // always the credit owner, not the JWT caller
        amount:         parsedAmount,
        payment_method: payment_method || "cash",
        payment_date:   new Date().toISOString().slice(0, 10),
        notes:          notes || null,
        recorded_by:    user.id,         // actual caller — owner or branch manager staff
      })
      .select("*")
      .single();
    if (payErr) return json({ ok: false, error: payErr.message }, 500);

    // Record a cash-in transaction so the repayment appears in revenue and profit reporting.
    // On the final payment (credit fully settled) include line_items from the stored catalogue
    // items so profitEngine can compute COGS. Partial repayments record revenue only —
    // attaching items to every partial payment would double-count COGS across installments.
    {
      const txPayload: Record<string, unknown> = {
        user_id:          credit.user_id,
        type:             "in",
        category:         "debt repayment",
        amount:           parsedAmount,
        item_name:        credit.customer_name || "",
        customer_name:    credit.customer_name || "",
        payment_type:     payment_method || "cash",
        note:             notes || null,
        transaction_date: new Date().toISOString().slice(0, 10),
        client_txn_id:    crypto.randomUUID(),
      };
      // Attach line_items only on full settlement so COGS isn't counted multiple times
      const storedItems = Array.isArray(credit.items) ? credit.items as Array<Record<string, unknown>> : [];
      if (newStatus === "paid" && storedItems.length > 0) {
        txPayload.line_items = storedItems.map(item => ({
          name:      item.product_name || "",
          qty:       Number(item.quantity) || 1,
          unitPrice: Number(item.unit_price) || 0,
          lineTotal: (Number(item.quantity) || 1) * (Number(item.unit_price) || 0),
          productId: item.product_id || null,
        }));
      }
      const { error: txErr } = await sb.from("transactions").insert(txPayload);
      if (txErr) console.error("record_credit_repayment: failed to insert transaction:", txErr.message);
    }

    return json({ ok: true, payment, outstanding: newOutstanding, status: newStatus });
  }

  // ── reject_contribution (owner-only, no PIN) ──────────────────────────────
  // Rejects a single staff-collection pending contribution with a reason.
  if (action === "reject_contribution") {
    const { contribution_id: rcId, reason: rcReason } = params as {
      contribution_id: string; reason?: string;
    };
    if (!rcId) return json({ ok: false, error: "contribution_id required" }, 400);

    const { data: rcRow } = await sb
      .from("ajo_contributions")
      .select("owner_id, aso_client_id, amount, status, contribution_source, recorded_by")
      .eq("id", rcId)
      .maybeSingle();
    if (!rcRow) return json({ ok: false, error: "Contribution not found" }, 404);
    if ((rcRow as Record<string, unknown>).status !== "pending")
      return json({ ok: false, error: "Only pending contributions can be rejected" }, 409);
    if ((rcRow as Record<string, unknown>).contribution_source !== "staff_collection")
      return json({ ok: false, error: "Only staff-collection pending rows can be rejected here" }, 400);

    const rcAjoPerms = await resolveAjoPerms(sb, user.id, rcRow.owner_id as string);
    if (rcAjoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    const { error: rcErr } = await sb
      .from("ajo_contributions")
      .update({ status: "rejected", reject_reason: rcReason?.trim() || null })
      .eq("id", rcId);
    if (rcErr) return json({ ok: false, error: rcErr.message });

    const rcAmt = Number((rcRow as Record<string, unknown>).amount).toLocaleString("en-NG");
    await Promise.race([
      (async () => {
        const [rcCtx, rcClientUserId, rcStaffUserId, rcAssignedStaffUid] = await Promise.all([
          fetchEmailContext(sb, rcRow.aso_client_id as string, rcRow.owner_id as string, user.id),
          resolveClientUserId(sb, rcRow.aso_client_id as string),
          resolveStaffUserId(sb, (rcRow as Record<string, unknown>).recorded_by as string),
          resolveAssignedStaffUserId(sb, rcRow.aso_client_id as string),
        ]);
        const rcEffects: Promise<unknown>[] = [
          fireAjoEmail("ajo_contribution_rejected", {
            client_email:  rcCtx.clientEmail,
            client_name:   rcCtx.clientName,
            owner_email:   rcCtx.ownerEmail,
            business_name: rcCtx.businessName,
            amount:        (rcRow as Record<string, unknown>).amount,
            reason:        rcReason?.trim() || "",
            date:          new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }),
          }),
          notifyUser(sb, rcClientUserId, {
            type: "contribution_rejected", title: "Contribution Rejected",
            body: `Your ₦${rcAmt} contribution was rejected${rcReason?.trim() ? ` — ${rcReason.trim()}` : ""}`,
            priority: "normal", deepLink: { tab: "contributions" }, category: "savings",
          }),
          notifyUser(sb, rcStaffUserId, {
            type: "collection_rejected", title: "Collection Rejected",
            body: `Your recorded ₦${rcAmt} collection was rejected by the owner${rcReason?.trim() ? ` — ${rcReason.trim()}` : ""}`,
            priority: "normal", deepLink: { tab: "aso", sub: "collections" }, category: "approvals",
          }),
        ];
        if (rcAssignedStaffUid && rcAssignedStaffUid !== rcStaffUserId && rcAssignedStaffUid !== rcClientUserId) {
          rcEffects.push(notifyUser(sb, rcAssignedStaffUid, {
            type: "assigned_client_contribution_rejected", title: "Client Contribution Rejected",
            body: `${rcCtx.clientName || "Your client"}'s contribution was rejected${rcReason?.trim() ? ` — ${rcReason.trim()}` : ""}`,
            priority: "normal",
            deepLink: { tab: "records", id: rcRow.aso_client_id },
            category: "approvals",
          }));
        }
        await Promise.allSettled(rcEffects);
      })().catch(() => null),
      new Promise<void>(r => setTimeout(r, 2500)),
    ]);

    return json({ ok: true });
  }

  // ── batch_approve_contributions (owner-only, PIN-gated) ───────────────────
  // Approves multiple staff-collection pending contributions in one PIN entry.
  if (action === "batch_approve_contributions") {
    const { contribution_ids: bacIds } = params as { contribution_ids: string[] };
    if (!Array.isArray(bacIds) || bacIds.length === 0)
      return json({ ok: false, error: "contribution_ids array required" }, 400);

    // Resolve owner from the first row — all must belong to the same owner
    const { data: firstRow } = await sb
      .from("ajo_contributions")
      .select("owner_id")
      .eq("id", bacIds[0])
      .maybeSingle();
    if (!firstRow) return json({ ok: false, error: "Contribution not found" }, 404);

    const bacOwnerId = firstRow.owner_id as string;
    const bacAjoPerms = await resolveAjoPerms(sb, user.id, bacOwnerId);
    if (bacAjoPerms !== null) return json({ ok: false, error: "Unauthorized: owner-only action" }, 403);

    // Prefetch contribution details so we can notify after each approval
    const { data: bacRows } = await sb
      .from("ajo_contributions")
      .select("id, aso_client_id, amount, recorded_by, contribution_source")
      .in("id", bacIds);
    const bacMap: Record<string, { aso_client_id: string; amount: number; recorded_by: string | null; contribution_source: string | null }> = {};
    for (const r of (bacRows || [])) bacMap[(r as Record<string, unknown>).id as string] = r as { aso_client_id: string; amount: number; recorded_by: string | null; contribution_source: string | null };

    // Prefetch all unique client_user_ids and staff user_ids in batch
    const uniqueClientIds = [...new Set((bacRows || []).map(r => (r as Record<string, unknown>).aso_client_id as string).filter(Boolean))];
    const uniqueStaffRowIds = [...new Set((bacRows || []).map(r => (r as Record<string, unknown>).recorded_by as string).filter(Boolean))];
    const [{ data: bClientRows }, { data: bStaffRows }] = await Promise.all([
      uniqueClientIds.length ? sb.from("aso_clients").select("id, client_user_id").in("id", uniqueClientIds) : Promise.resolve({ data: [] }),
      uniqueStaffRowIds.length ? sb.from("staff").select("id, user_id").in("id", uniqueStaffRowIds) : Promise.resolve({ data: [] }),
    ]);
    const bClientAuthMap: Record<string, string> = {};
    for (const r of (bClientRows || [])) bClientAuthMap[(r as Record<string, unknown>).id as string] = (r as Record<string, unknown>).client_user_id as string;
    const bStaffAuthMap: Record<string, string> = {};
    for (const r of (bStaffRows || [])) bStaffAuthMap[(r as Record<string, unknown>).id as string] = (r as Record<string, unknown>).user_id as string;

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const cId of bacIds) {
      const { data: bRes, error: bErr } = await sb.rpc("ajo_approve_contribution", {
        p_contribution_id: cId,
        p_owner_id:        bacOwnerId,
        p_approver_id:     user.id,
      });
      if (bErr || !(bRes as Record<string, unknown>)?.ok) {
        results.push({ id: cId, ok: false, error: bErr?.message || (bRes as Record<string, unknown>)?.error as string || "Failed" });
      } else {
        results.push({ id: cId, ok: true });
        // Notify the client and recording staff after each successful approval
        const bc    = bacMap[cId];
        const bcAmt = bc ? Number(bc.amount).toLocaleString("en-NG") : "";
        if (bc) {
          await notifyUser(sb, bClientAuthMap[bc.aso_client_id], {
            type: "contribution_approved", title: "Contribution Approved",
            body: `Your ₦${bcAmt} contribution has been approved`, priority: "normal",
            deepLink: { tab: "contributions" }, category: "savings",
          });
          if (bc.contribution_source === "staff_collection" && bc.recorded_by) {
            await notifyUser(sb, bStaffAuthMap[bc.recorded_by], {
              type: "collection_approved", title: "Collection Approved",
              body: `Your recorded ₦${bcAmt} collection was approved by the owner`, priority: "normal",
              deepLink: { tab: "aso", sub: "collections" }, category: "approvals",
            });
          }
        }
      }
    }

    const approved = results.filter(r => r.ok).length;
    const failed   = results.filter(r => !r.ok).length;
    return json({ ok: failed === 0, approved, failed, results });
  }

  return json({ ok: false, error: `Unknown action: ${action}` }, 400);
});
