// bvn-reverify-notify — ONE-TIME trigger, run manually once via the
// bvn-reverify-notify.yml GitHub Actions workflow (workflow_dispatch only,
// not scheduled). Nudges every existing wallet holder (business owners and
// Ajo/Esusu clients alike) to reverify their BVN now that real verification
// exists — their wallet keeps working normally in the meantime, this is a
// notification only, never a block.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function sendSms(phone: string | null | undefined, message: string, opts: {
  category?: string; user_id?: string | null; related_type?: string; related_id?: string;
} = {}): void {
  if (!phone) return;
  fetch(`${SUPABASE_URL}/functions/v1/sms-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action: "send", phone, message, category: opts.category ?? "money", user_id: opts.user_id ?? null, related_type: opts.related_type ?? null, related_id: opts.related_id ?? null }),
  }).catch(() => null);
}

function notifyUser(userId: string | null | undefined, opts: {
  type: string; title: string; body: string;
  priority?: string; deepLink?: Record<string, unknown> | null; category?: string;
}): void {
  if (!userId) return;
  fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ action: "notify", userId, type: opts.type, title: opts.title, body: opts.body, priority: opts.priority ?? "normal", deepLink: opts.deepLink ?? null, category: opts.category ?? "money" }),
  }).catch(() => null);
}

Deno.serve(async (req) => {
  const authHeader  = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace("Bearer ", "").trim();
  if (callerToken !== SERVICE_KEY) return json({ error: "Forbidden" }, 403);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: rows, error } = await sb.rpc("bvn_get_reverify_targets");
  if (error) return json({ error: error.message }, 500);

  const targets = (rows ?? []) as {
    user_id: string; full_name: string | null; phone: string | null;
    email: string | null; kind: "owner" | "ajo_client";
  }[];

  for (const r of targets) {
    sendSms(
      r.phone,
      "KudiAI: We've added real BVN verification to keep wallets secure. Please open the app and reverify your BVN to keep using it smoothly.",
      { category: "money", user_id: r.user_id, related_type: r.kind, related_id: r.user_id },
    );
    notifyUser(r.user_id, {
      type: "bvn_reverification_required",
      title: "Please reverify your BVN",
      body: "We've added real BVN verification for wallet security. Reverify to keep using your wallet smoothly.",
      priority: "high",
      category: "money",
      deepLink: r.kind === "owner" ? { tab: "wallet" } : { tab: "home", openWallet: true },
    });
  }

  return json({ ok: true, notified: targets.length });
});
