// ajo-overdue-reminders — daily job (pg_cron → pg_net, cron-secret auth).
//
// Emails Ajo clients whose contribution date has passed, via the admin email
// pipeline's `ajo_contribution_overdue` template. Idempotent per client: a
// client is marked emailed (aso_clients.last_overdue_email_on) only AFTER the
// pipeline reports the email was actually sent, and is not emailed again for
// 7 days.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET    = Deno.env.get("CRON_SECRET") ?? "";
const TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || SERVICE_KEY;
const EMAIL_URL      = "https://admin.kudiai.app/api/public/email-trigger";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // The callers (pg_cron → pg_net) hold the secret in the Vault, so that is what
  // it is checked against; a matching CRON_SECRET env var is accepted too.
  const provided = req.headers.get("x-cron-secret") ?? "";
  let authorised = !!provided && !!CRON_SECRET && provided === CRON_SECRET;
  if (!authorised && provided) {
    const { data } = await sb.rpc("verify_cron_secret", { p_secret: provided });
    authorised = data === true;
  }
  if (!authorised) return json({ error: "Unauthorized" }, 401);

  let limit = 25;
  // override_email: send the reminder to THIS address instead of the client's and
  // do not mark anyone as emailed. Lets the whole chain be proven end to end
  // (function → admin pipeline → SMTP) without emailing a real customer.
  let override = "";
  try {
    const b = await req.json();
    if (Number(b?.limit) > 0) limit = Math.min(Number(b.limit), 50);
    if (typeof b?.override_email === "string" && /^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(b.override_email)) {
      override = b.override_email;
      limit = 1;
    }
  } catch { /* default */ }

  const { data: rows, error } = await sb.rpc("ajo_get_overdue_email_candidates", { p_limit: limit });
  if (error) return json({ error: error.message }, 500);

  const candidates = (rows ?? []) as Array<{
    client_id: string; client_name: string | null; client_email: string;
    contribution_amount: number; contribution_frequency: string | null;
    next_contribution_date: string; current_balance: number | null; business_name: string | null;
  }>;

  // Test mode with nobody overdue: still exercise the full chain using a clearly
  // labelled sample client (never marked, sent only to the override address).
  if (override && candidates.length === 0) {
    candidates.push({
      client_id: "00000000-0000-0000-0000-000000000000", client_name: "Sample Client (test)", client_email: override,
      contribution_amount: 5000, contribution_frequency: "weekly",
      next_contribution_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      current_balance: 20000, business_name: "Sample Business",
    });
  }

  const emailed: string[] = [];
  let failed = 0;
  for (const c of candidates) {
    try {
      const resp = await fetch(EMAIL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trigger-secret": TRIGGER_SECRET },
        body: JSON.stringify({
          event: "ajo_contribution_overdue",
          data: {
            client_email: override || c.client_email,
            client_name: c.client_name ?? "",
            contribution_frequency: c.contribution_frequency ?? "",
            next_contribution_date: fmtDate(c.next_contribution_date),
            contribution_amount: c.contribution_amount,
            current_balance: c.current_balance ?? 0,
            business_name: c.business_name ?? "",
          },
        }),
      });
      const out = resp.ok ? (await resp.json().catch(() => null)) as { sent?: number } | null : null;
      if (out && Number(out.sent) >= 1) emailed.push(c.client_id); else failed++;
    } catch { failed++; }
    await sleep(2200);   // the email route allows 30 requests / minute / IP
  }

  if (emailed.length && !override) await sb.rpc("ajo_mark_overdue_emailed", { p_client_ids: emailed });
  return json({ ok: true, candidates: candidates.length, emailed: emailed.length, failed, test_override: !!override });
});
