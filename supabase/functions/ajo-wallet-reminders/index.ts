// ajo-wallet-reminders — service-role-only batch job, triggered on a schedule
// (see .github/workflows/ajo-wallet-reminders.yml) rather than pg_cron: this
// repo has no existing pattern for Postgres calling out to an edge function
// (no pg_net anywhere), so scheduling lives in CI instead of adding that as
// new production-database infrastructure for one recurring nudge.
//
// Nudges Ajo/Esusu clients who have a portal login but haven't activated
// their KudiAI Wallet yet — never a gate, just a reminder. Saving needs no
// BVN; the wallet does, because that's a CBN requirement for opening any
// bank-linked account, not a KudiAI one.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Both return the in-flight request so the caller can await it — fired
// without awaiting, these were racing the function's own return (and the
// isolate shutdown that follows), silently dropping reminders under load.
function sendSms(phone: string | null | undefined, message: string, opts: {
  category?: string; user_id?: string | null; related_type?: string; related_id?: string;
} = {}): Promise<unknown> {
  if (!phone) return Promise.resolve();
  return fetch(`${SUPABASE_URL}/functions/v1/sms-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action: "send", phone, message, category: opts.category ?? "savings", user_id: opts.user_id ?? null, related_type: opts.related_type ?? null, related_id: opts.related_id ?? null }),
  }).catch(() => null);
}

function notifyUser(userId: string | null | undefined, opts: {
  type: string; title: string; body: string;
  priority?: string; deepLink?: Record<string, unknown> | null; category?: string;
}): Promise<unknown> {
  if (!userId) return Promise.resolve();
  return fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action: "notify", userId, type: opts.type, title: opts.title, body: opts.body, priority: opts.priority ?? "normal", deepLink: opts.deepLink ?? null, category: opts.category ?? "savings" }),
  }).catch(() => null);
}

Deno.serve(async (req) => {
  const authHeader  = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace("Bearer ", "").trim();
  if (callerToken !== SERVICE_KEY) return json({ error: "Forbidden" }, 403);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: rows, error } = await sb.rpc("ajo_get_wallet_reminder_candidates", { p_batch_limit: 500 });
  if (error) return json({ error: error.message }, 500);

  const candidates = (rows ?? []) as {
    client_id: string; client_user_id: string | null; full_name: string | null;
    phone: string | null; email: string | null;
  }[];

  const pending: Promise<unknown>[] = [];
  for (const r of candidates) {
    pending.push(sendSms(
      r.phone,
      "KudiAI: Saving needs no BVN. Open your free digital wallet to fund/withdraw instantly — BVN is a CBN rule, only for that. Open the app to activate.",
      { category: "savings", user_id: r.client_user_id, related_type: "aso_clients", related_id: r.client_id },
    ));
    pending.push(notifyUser(r.client_user_id, {
      type: "wallet_activation_reminder",
      title: "Your KudiAI Wallet is ready to activate",
      body: "Fund & withdraw instantly. BVN is only for the wallet — a CBN rule, never for your savings.",
      priority: "normal", category: "savings",
      deepLink: { tab: "home", openWallet: true },
    }));
  }
  await Promise.allSettled(pending);

  return json({ ok: true, reminded: candidates.length });
});
