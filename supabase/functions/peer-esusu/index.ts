// peer-esusu — client-created, peer-to-peer Esusu circles.
//
// Deliberately a NEW, standalone edge function (not added to ajo-write/
// ajo-portal, which are both deeply shaped around aso_clients/business
// owners). Membership here is keyed on auth.users.id directly, so ANY
// KudiAI user can be invited by wallet account number regardless of which
// business (if any) they're a client of — see the migration
// 20261230000000_peer_esusu_circles.sql for why that's necessary (aso_clients
// .client_user_id is a table-wide UNIQUE constraint; one person can only
// ever be a client of one business owner, system-wide).
//
// Money movement (pay-contribution, execute-payout) calls SECURITY DEFINER
// Postgres RPCs that debit/credit the `wallets` table directly and
// atomically — same proven mechanics as wallet_pay_ajo_contribution,
// copied rather than reused since the underlying membership model differs.
// Everything else (create/invite/respond/reorder/start) is plain
// sequential code against the service-role client, matching how
// ajo-portal's create-group/join-group already work.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_TRIGGER_URL    = "https://admin.kudiai.app/api/public/email-trigger";
const EMAIL_TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

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

async function notifyUser(
  userId: string | null | undefined,
  opts: { type: string; title: string; body: string; priority?: string; deepLink?: Record<string, unknown> | null; category?: string },
): Promise<void> {
  if (!userId) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({
        action: "notify", userId, type: opts.type, title: opts.title, body: opts.body,
        priority: opts.priority ?? "normal", deepLink: opts.deepLink ?? null,
        category: opts.category ?? "savings",
      }),
    });
  } catch { /* fire and forget */ }
}

// Resolve a display name for a user_id — checks profiles (business owner)
// first, then aso_clients (business client). Peer-circle members can be
// either, or someone with neither yet (falls back to a generic label).
async function resolveDisplayName(sb: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data: prof } = await sb.from("profiles").select("business_name, owner_name").eq("id", userId).maybeSingle();
  const profName = (prof as Record<string, unknown> | null)?.business_name as string || (prof as Record<string, unknown> | null)?.owner_name as string || "";
  if (profName) return profName;
  const { data: cl } = await sb.from("aso_clients").select("full_name").eq("client_user_id", userId).maybeSingle();
  return (cl as Record<string, unknown> | null)?.full_name as string || "KudiAI User";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const _jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!_jwt) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { data: { user: caller }, error: authErr } = await sb.auth.getUser(_jwt);
  if (authErr || !caller) return json({ error: "Unauthorized" }, 401);
  const callerId = caller.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { action } = body as { action: string };
  if (!action) return json({ error: "Missing action" }, 400);

  // Client for the two money-moving RPCs — carries the caller's own JWT so
  // auth.uid() resolves correctly inside the SECURITY DEFINER functions
  // (calling via the service-role client would leave auth.uid() null).
  const asCaller = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${_jwt}` } }, auth: { persistSession: false },
  });

  // ── search-wallet-user ────────────────────────────────────────────────
  if (action === "search-wallet-user") {
    const { account_number } = body as { account_number?: string };
    if (!account_number || !/^\d{10}$/.test(account_number)) {
      return json({ error: "Enter a valid 10-digit wallet account number" }, 400);
    }
    const { data: searcherWallet } = await sb.from("wallets").select("status").eq("user_id", callerId).maybeSingle();
    if (!(searcherWallet as Record<string, unknown> | null)?.status || (searcherWallet as Record<string, unknown>).status !== "active") {
      return json({ error: "Activate your own KudiAI wallet first" }, 400);
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await sb.from("peer_esusu_search_log")
      .select("id", { count: "exact", head: true }).eq("searcher_id", callerId).gte("created_at", oneHourAgo);
    if ((count || 0) >= 20) return json({ error: "Too many searches — try again in a bit" }, 429);
    await sb.from("peer_esusu_search_log").insert({ searcher_id: callerId });

    const { data: wallet } = await sb.from("wallets").select("user_id, status").eq("flw_account_number", account_number).maybeSingle();
    const w = wallet as Record<string, unknown> | null;
    if (!w || w.status !== "active") return json({ found: false });
    if (w.user_id === callerId) return json({ found: false, error: "That's your own wallet number" });

    const displayName = await resolveDisplayName(sb, w.user_id as string);
    return json({ found: true, user_id: w.user_id, display_name: displayName });
  }

  // ── create-group ──────────────────────────────────────────────────────
  if (action === "create-group") {
    const { name, contribution_amount, frequency, custom_interval_days, payout_slots_per_round } = body as {
      name?: string; contribution_amount?: number; frequency?: string;
      custom_interval_days?: number; payout_slots_per_round?: number;
    };
    if (!name?.trim()) return json({ error: "Give your circle a name" }, 400);
    const amt = Number(contribution_amount);
    if (!(amt > 0)) return json({ error: "Enter a contribution amount" }, 400);
    const freq = ["daily", "weekly", "monthly", "custom"].includes(frequency || "") ? frequency : "monthly";
    if (freq === "custom" && !(Number(custom_interval_days) > 0)) {
      return json({ error: "Enter how many days between rotations" }, 400);
    }
    const slots = Math.max(1, parseInt(String(payout_slots_per_round)) || 1);

    const { data: group, error } = await sb.from("peer_esusu_groups").insert({
      creator_user_id: callerId, name: name.trim(), contribution_amount: amt,
      frequency: freq, custom_interval_days: freq === "custom" ? Number(custom_interval_days) : null,
      payout_slots_per_round: slots,
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);

    await sb.from("peer_esusu_members").insert({ group_id: (group as { id: string }).id, user_id: callerId, position: 1, status: "active" });
    return json({ ok: true, group_id: (group as { id: string }).id });
  }

  // ── invite-member ─────────────────────────────────────────────────────
  if (action === "invite-member") {
    const { group_id, invitee_user_id } = body as { group_id?: string; invitee_user_id?: string };
    if (!group_id || !invitee_user_id) return json({ error: "group_id and invitee_user_id required" }, 400);

    const { data: group } = await sb.from("peer_esusu_groups").select("id, creator_user_id, name, status").eq("id", group_id).maybeSingle();
    const g = group as Record<string, unknown> | null;
    if (!g) return json({ error: "Circle not found" }, 404);
    if (g.creator_user_id !== callerId) return json({ error: "Only the circle creator can invite members" }, 403);
    if (g.status !== "forming") return json({ error: "This circle has already started — no new invites" }, 400);
    if (invitee_user_id === callerId) return json({ error: "You're already in this circle" }, 400);

    const { data: existingMember } = await sb.from("peer_esusu_members").select("id").eq("group_id", group_id).eq("user_id", invitee_user_id).maybeSingle();
    if (existingMember) return json({ error: "Already a member of this circle" }, 400);

    const { data: existingInvite } = await sb.from("peer_esusu_invites").select("id")
      .eq("group_id", group_id).eq("invitee_user_id", invitee_user_id).eq("status", "pending").maybeSingle();
    if (existingInvite) return json({ error: "Invite already sent — waiting on their response" }, 400);

    const { data: invite, error } = await sb.from("peer_esusu_invites").insert({
      group_id, inviter_user_id: callerId, invitee_user_id,
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);

    const inviterName = await resolveDisplayName(sb, callerId);
    notifyUser(invitee_user_id, {
      type: "peer_esusu_invite", title: "Esusu Circle Invite",
      body: `${inviterName} invited you to join "${g.name}"`,
      priority: "high", deepLink: { tab: "circles", groupId: group_id }, category: "savings",
    });
    fireAjoEmail("peer_esusu_invite", { group_name: g.name, inviter_name: inviterName, invitee_user_id });

    return json({ ok: true, invite_id: (invite as { id: string }).id });
  }

  // ── respond-invite ────────────────────────────────────────────────────
  if (action === "respond-invite") {
    const { invite_id, accept } = body as { invite_id?: string; accept?: boolean };
    if (!invite_id) return json({ error: "invite_id required" }, 400);

    const { data: invite } = await sb.from("peer_esusu_invites")
      .select("*, peer_esusu_groups(name, creator_user_id)").eq("id", invite_id).maybeSingle();
    const inv = invite as Record<string, unknown> | null;
    if (!inv) return json({ error: "Invite not found" }, 404);
    if (inv.invitee_user_id !== callerId) return json({ error: "Forbidden" }, 403);
    if (inv.status !== "pending") return json({ error: "This invite has already been responded to" }, 400);

    const newStatus = accept ? "accepted" : "rejected";
    await sb.from("peer_esusu_invites").update({ status: newStatus, responded_at: new Date().toISOString() }).eq("id", invite_id);

    if (accept) {
      const { data: maxPos } = await sb.from("peer_esusu_members").select("position")
        .eq("group_id", inv.group_id as string).order("position", { ascending: false }).limit(1).maybeSingle();
      const nextPos = ((maxPos as { position: number } | null)?.position || 0) + 1;
      await sb.from("peer_esusu_members").insert({ group_id: inv.group_id, user_id: callerId, position: nextPos, status: "active" });
    }

    const responderName = await resolveDisplayName(sb, callerId);
    const groupInfo = inv.peer_esusu_groups as { name: string; creator_user_id: string };
    notifyUser(groupInfo.creator_user_id, {
      type: "peer_esusu_invite_response", title: accept ? "Invite Accepted" : "Invite Declined",
      body: `${responderName} ${accept ? "accepted" : "declined"} your invite to "${groupInfo.name}"`,
      priority: "normal", deepLink: { tab: "circles", groupId: inv.group_id }, category: "savings",
    });
    fireAjoEmail("peer_esusu_invite_response", { group_name: groupInfo.name, responder_name: responderName, accepted: accept });

    return json({ ok: true, accepted: !!accept });
  }

  // ── reorder-members ───────────────────────────────────────────────────
  if (action === "reorder-members") {
    const { group_id, new_order } = body as { group_id?: string; new_order?: Array<{ member_id: string; position: number }> };
    if (!group_id || !new_order?.length) return json({ error: "group_id and new_order required" }, 400);

    const { data: group } = await sb.from("peer_esusu_groups").select("creator_user_id, status").eq("id", group_id).maybeSingle();
    const g = group as Record<string, unknown> | null;
    if (!g) return json({ error: "Circle not found" }, 404);
    if (g.creator_user_id !== callerId) return json({ error: "Only the circle creator can reorder members" }, 403);
    if (g.status !== "forming") return json({ error: "Can only reorder before the circle starts" }, 400);

    for (const item of new_order) {
      await sb.from("peer_esusu_members").update({ position: item.position }).eq("id", item.member_id).eq("group_id", group_id);
    }
    return json({ ok: true });
  }

  // ── start-group ───────────────────────────────────────────────────────
  if (action === "start-group") {
    const { group_id } = body as { group_id?: string };
    if (!group_id) return json({ error: "group_id required" }, 400);

    const { data: group } = await sb.from("peer_esusu_groups").select("*").eq("id", group_id).maybeSingle();
    const g = group as Record<string, unknown> | null;
    if (!g) return json({ error: "Circle not found" }, 404);
    if (g.creator_user_id !== callerId) return json({ error: "Only the circle creator can start it" }, 403);
    if (g.status !== "forming") return json({ error: "This circle has already started" }, 400);

    const { data: members } = await sb.from("peer_esusu_members").select("id, user_id, position")
      .eq("group_id", group_id).eq("status", "active").order("position", { ascending: true });
    const mem = (members || []) as Array<{ id: string; user_id: string; position: number | null }>;
    if (mem.length < 2) return json({ error: "Need at least 2 members to start a circle" }, 400);

    const ordered = mem.map((m, i) => ({ ...m, position: m.position ?? i + 1 }));

    const { data: round, error: roundErr } = await sb.from("peer_esusu_rounds")
      .insert({ group_id, round_number: 1 }).select("id").single();
    if (roundErr) return json({ error: roundErr.message }, 500);
    const roundId = (round as { id: string }).id;

    const slots = g.payout_slots_per_round as number;
    const turnRows = ordered.map((m, i) => ({
      round_id: roundId, user_id: m.user_id, position: m.position,
      status: i < slots ? "current" : "upcoming",
    }));
    const { error: turnsErr } = await sb.from("peer_esusu_turns").insert(turnRows);
    if (turnsErr) return json({ error: turnsErr.message }, 500);

    await sb.from("peer_esusu_groups").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", group_id);

    for (const m of ordered) {
      if (m.user_id === callerId) continue;
      notifyUser(m.user_id, {
        type: "peer_esusu_started", title: "Esusu Circle Started",
        body: `"${g.name}" has started — your rotation position is #${m.position}`,
        priority: "normal", deepLink: { tab: "circles", groupId: group_id }, category: "savings",
      });
    }

    return json({ ok: true, round_id: roundId });
  }

  // ── pay-contribution ──────────────────────────────────────────────────
  if (action === "pay-contribution") {
    const { group_id, amount } = body as { group_id?: string; amount?: number };
    if (!group_id || !(Number(amount) > 0)) return json({ error: "group_id and amount required" }, 400);

    const { data: rpcResult, error: rpcErr } = await asCaller().rpc("peer_esusu_pay_contribution", {
      p_group_id: group_id, p_amount_kobo: Math.round(Number(amount) * 100),
    });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500);
    const r = rpcResult as Record<string, unknown>;
    if (!r?.ok) return json(r, 422);

    const { data: group } = await sb.from("peer_esusu_groups").select("creator_user_id, name").eq("id", group_id).maybeSingle();
    const g = group as Record<string, unknown> | null;
    if (g && g.creator_user_id !== callerId) {
      notifyUser(g.creator_user_id as string, {
        type: "peer_esusu_contribution", title: "Circle Contribution Received",
        body: `₦${Number(amount).toLocaleString("en-NG")} was paid into "${g.name}"`,
        priority: "normal", deepLink: { tab: "circles", groupId: group_id }, category: "money",
      });
    }
    return json(r);
  }

  // ── execute-payout ────────────────────────────────────────────────────
  if (action === "execute-payout") {
    const { group_id } = body as { group_id?: string };
    if (!group_id) return json({ error: "group_id required" }, 400);

    const { data: rpcResult, error: rpcErr } = await asCaller().rpc("peer_esusu_execute_payout", { p_group_id: group_id });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500);
    const r = rpcResult as Record<string, unknown>;
    if (!r?.ok) return json(r, r?.blocked ? 409 : 422);

    const { data: group } = await sb.from("peer_esusu_groups").select("name").eq("id", group_id).maybeSingle();
    const { data: members } = await sb.from("peer_esusu_members").select("user_id").eq("group_id", group_id).eq("status", "active");
    const groupName = (group as { name: string } | null)?.name || "your circle";
    const winners = (r.winners || []) as Array<{ user_id: string; amount: number }>;
    const winnerIds = new Set(winners.map(w => w.user_id));

    for (const w of winners) {
      notifyUser(w.user_id, {
        type: "peer_esusu_payout_received", title: "Circle Payout Received",
        body: `₦${Number(w.amount).toLocaleString("en-NG")} was credited to your wallet from "${groupName}"`,
        priority: "high", deepLink: { tab: "circles", groupId: group_id }, category: "money",
      });
    }
    for (const m of (members || []) as Array<{ user_id: string }>) {
      if (winnerIds.has(m.user_id)) continue;
      notifyUser(m.user_id, {
        type: "peer_esusu_round_paid", title: "Circle Payout Complete",
        body: `This round's payout for "${groupName}" has been paid out`,
        priority: "normal", deepLink: { tab: "circles", groupId: group_id }, category: "savings",
      });
    }
    return json(r);
  }

  // ── list-my-groups ────────────────────────────────────────────────────
  if (action === "list-my-groups") {
    const { data: created } = await sb.from("peer_esusu_groups").select("*").eq("creator_user_id", callerId).order("created_at", { ascending: false });
    const { data: memberships } = await sb.from("peer_esusu_members").select("group_id, position, peer_esusu_groups(*)").eq("user_id", callerId).eq("status", "active");
    const memberGroups = ((memberships || []) as unknown as Array<{ peer_esusu_groups: Record<string, unknown> | Record<string, unknown>[] }>)
      .map(m => Array.isArray(m.peer_esusu_groups) ? m.peer_esusu_groups[0] : m.peer_esusu_groups)
      .filter((g): g is Record<string, unknown> => !!g && g.creator_user_id !== callerId);
    const { data: myInvites } = await sb.from("peer_esusu_invites").select("*, peer_esusu_groups(name)").eq("invitee_user_id", callerId).eq("status", "pending");

    return json({ created: created || [], member_of: memberGroups, invites: myInvites || [] });
  }

  // ── get-group-detail ──────────────────────────────────────────────────
  if (action === "get-group-detail") {
    const { group_id } = body as { group_id?: string };
    if (!group_id) return json({ error: "group_id required" }, 400);

    const { data: group } = await sb.from("peer_esusu_groups").select("*").eq("id", group_id).maybeSingle();
    const g = group as Record<string, unknown> | null;
    if (!g) return json({ error: "Circle not found" }, 404);

    const { data: membership } = await sb.from("peer_esusu_members").select("id").eq("group_id", group_id).eq("user_id", callerId).maybeSingle();
    const isCreator = g.creator_user_id === callerId;
    if (!isCreator && !membership) return json({ error: "Forbidden" }, 403);

    const { data: members } = await sb.from("peer_esusu_members").select("*").eq("group_id", group_id).order("position", { ascending: true });
    const memberRows = (members || []) as Array<Record<string, unknown>>;
    const membersOut = await Promise.all(memberRows.map(async m => ({ ...m, display_name: await resolveDisplayName(sb, m.user_id as string) })));

    const { data: round } = await sb.from("peer_esusu_rounds").select("*").eq("group_id", group_id).eq("status", "active").order("round_number", { ascending: false }).limit(1).maybeSingle();
    let turns: unknown[] = [];
    let contributionsThisRound: unknown[] = [];
    if (round) {
      const roundId = (round as { id: string }).id;
      const { data: t } = await sb.from("peer_esusu_turns").select("*").eq("round_id", roundId).order("position", { ascending: true });
      turns = t || [];
      // Contributions for the CURRENT payout (cycle_no), not the whole round: every payout needs a fresh set from
      // every member. Falls back to the round if the column isn't there yet (function deployed a moment before its migration).
      let cq = await sb.from("peer_esusu_contributions").select("*").eq("group_id", group_id).eq("cycle_no", (g.cycle_no as number) ?? 1).eq("type", "contribution");
      if (cq.error) cq = await sb.from("peer_esusu_contributions").select("*").eq("round_id", roundId).eq("type", "contribution");
      contributionsThisRound = cq.data || [];
    }

    const { data: pendingInvites } = isCreator
      ? await sb.from("peer_esusu_invites").select("*").eq("group_id", group_id).eq("status", "pending")
      : { data: [] };

    return json({
      group: g, members: membersOut, round: round || null, turns, contributions: contributionsThisRound,
      pending_invites: pendingInvites || [], is_creator: isCreator,
    });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
