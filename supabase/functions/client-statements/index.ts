// client-statements — the monthly savings + wallet statement for Ajo/savings clients.
//
// pg_cron (days 1–3, every 10 min) → client_statements_trigger() → pg_net → here (x-cron-secret).
// For each client due for LAST month (WAT; migration 20270273 decides who): claim the month (never twice) → build it
// (client_statement_data — the same numbers the app's Statements screen shows) → draw the PDF with the app's own
// statement layout (_shared/statementPdfLayout.js, a byte-for-byte copy) → in-app notification + push (notify-send) →
// email with the PDF attached (admin email pipeline, event client_monthly_statement) → record what went out.
//
// Body (all optional): { month: "YYYY-MM", limit }
// Test modes — nothing is recorded and nobody is notified:
//   dry_run: true          build data + PDF and have the email pipeline render (not send) the email; counts only back
//   override_email: "a@b"  send the email to this address instead of the client's (limit 1)
//   client_id              with either test mode: only this client (otherwise the first client due)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@4.2.1";
import { fmtNaira, monthKeyLabel, monthlyStatementFilename, renderMonthlyStatementPdf } from "../_shared/statementPdfLayout.js";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET    = Deno.env.get("CRON_SECRET") ?? "";
const TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || SERVICE_KEY;
const EMAIL_URL      = "https://admin.kudiai.app/api/public/email-trigger";
const LOGO_URL       = "https://kudiai.app/icon-192.png";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Savings = { opening: number; total_in: number; total_out: number; closing: number; entries: unknown[];
                 client?: { name?: string }; business?: { name?: string } };
type Wallet  = { opening_kobo: number; in_kobo: number; out_kobo: number; closing_kobo: number; entries: unknown[];
                 account?: { number?: string; bank?: string } };
type Data    = { month: string; savings: Savings | null; wallet: Wallet | null; generatedAt?: string };
type Claim = { statement_id: string; notified: boolean; emailed: boolean };
type Candidate = { client_id: string; client_user_id: string | null; client_name: string | null; client_email: string | null; business_name: string | null };

// The service role, proven: the token works on a service-only RPC (an ordinary user token never gets that far).
async function isServiceCall(token: string): Promise<boolean> {
  if (SERVICE_KEY && token === SERVICE_KEY) return true;
  if (!token || token.split(".").length !== 3) return false;
  try {
    const p = JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
    if (p?.role !== "service_role") return false;
  } catch { return false; }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/client_statement_candidates`, {
      method: "POST",
      headers: { apikey: token, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_month: "2000-01-01", p_limit: 0 }),
    });
    return r.ok;
  } catch { return false; }
}

/** "YYYY-MM" of the month before now, in WAT (UTC+1). */
function lastMonthWAT(now = new Date()): string {
  const w = new Date(now.getTime() + 3600000);
  const y = w.getUTCFullYear(), m = w.getUTCMonth();          // m = this month (0-based)
  const py = m === 0 ? y - 1 : y, pm = m === 0 ? 12 : m;      // previous month (1-based)
  return `${py}-${String(pm).padStart(2, "0")}`;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let logoCache: Uint8Array | null | undefined;
async function logo(): Promise<Uint8Array | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    const r = await fetch(LOGO_URL);
    logoCache = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch { logoCache = null; }
  return logoCache;
}

async function buildPdf(data: Data): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  renderMonthlyStatementPdf(doc, data, { logo: await logo(), font: "helvetica" });
  doc.setProperties({ title: `Statement — ${monthKeyLabel(data.month)}`, subject: "KudiAI Track monthly statement", author: "KudiAI Track · Amaya & Co. Technologies" });
  return new Uint8Array(doc.output("arraybuffer"));
}

// Headline figures (naira) — what the record keeps and the email shows.
function summary(data: Data) {
  const s = data.savings, w = data.wallet;
  return {
    savings: s ? { opening: Number(s.opening), in: Number(s.total_in), out: Number(s.total_out), closing: Number(s.closing), count: s.entries.length } : null,
    wallet:  w ? { opening: w.opening_kobo / 100, in: w.in_kobo / 100, out: w.out_kobo / 100, closing: w.closing_kobo / 100, count: w.entries.length,
                   account: w.account?.number || "", bank: w.account?.bank || "" } : null,
  };
}

async function notify(c: Candidate, month: string, sum: ReturnType<typeof summary>): Promise<boolean> {
  if (!c.client_user_id) return false;
  const label = monthKeyLabel(month);
  const parts = [
    sum.savings ? `Savings ${fmtNaira(sum.savings.closing)}` : "",
    sum.wallet ? `Wallet ${fmtNaira(sum.wallet.closing)}` : "",
  ].filter(Boolean).join(" · ");
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        action: "notify", userId: c.client_user_id, type: "monthly_statement", category: "savings", priority: "normal",
        title: `Your ${label} statement is ready`,
        body: `${parts ? `Closing balance — ${parts}. ` : ""}Tap to view or download it.`,
        deepLink: { openStatements: true, month },
        dedupeKey: `statement:${c.client_id}:${month}`,
      }),
    });
    return r.ok;
  } catch { return false; }
}

async function email(c: Candidate, data: Data, sum: ReturnType<typeof summary>, pdf: Uint8Array,
                     opts: { to?: string; dryRun?: boolean }): Promise<{ ok: boolean; preview?: unknown }> {
  const to = opts.to || c.client_email;
  if (!to && !opts.dryRun) return { ok: false };
  try {
    const r = await fetch(EMAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-trigger-secret": TRIGGER_SECRET },
      body: JSON.stringify({
        event: "client_monthly_statement",
        data: {
          client_email: to || "dry-run@example.invalid",
          client_name: c.client_name ?? "",
          business_name: c.business_name ?? data.savings?.business?.name ?? "",
          month: data.month,
          month_label: monthKeyLabel(data.month),
          savings: sum.savings,
          wallet: sum.wallet,
          attachment: { filename: monthlyStatementFilename(data.month), content: toBase64(pdf) },
          dry_run: !!opts.dryRun,
        },
      }),
    });
    const out = r.ok ? await r.json().catch(() => null) as { sent?: number; dry_run?: boolean } | null : null;
    if (opts.dryRun) return { ok: !!out?.dry_run, preview: out };
    return { ok: !!out && Number(out.sent) >= 1 };
  } catch { return { ok: false }; }
}

Deno.serve(async (req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Callers: pg_cron (the Vault's cron_secret in x-cron-secret) or a proven service-role token (manual test runs).
  const provided = req.headers.get("x-cron-secret") ?? "";
  let authorised = !!provided && !!CRON_SECRET && provided === CRON_SECRET;
  if (!authorised && provided) {
    const { data } = await sb.rpc("verify_cron_secret", { p_secret: provided });
    authorised = data === true;
  }
  if (!authorised) authorised = await isServiceCall((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim());
  if (!authorised) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const month = typeof body.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month) ? body.month : lastMonthWAT();
  const dryRun = body.dry_run === true;
  const override = typeof body.override_email === "string" && /^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(body.override_email) ? body.override_email : "";
  const testing = dryRun || !!override;
  let limit = Math.min(Math.max(Number(body.limit) || 5, 1), 10);
  if (override) limit = 1;

  let candidates: Candidate[] = [];
  if (testing && typeof body.client_id === "string") {
    const { data: c } = await sb.from("aso_clients")
      .select("id, client_user_id, full_name, email, user_id").eq("id", body.client_id).maybeSingle();
    if (!c) return json({ error: "client not found" }, 404);
    const { data: p } = await sb.from("profiles").select("business_name").eq("id", c.user_id).maybeSingle();
    candidates = [{ client_id: c.id, client_user_id: c.client_user_id, client_name: c.full_name, client_email: c.email, business_name: p?.business_name ?? null }];
  } else {
    const { data, error } = await sb.rpc("client_statement_candidates", { p_month: `${month}-01`, p_limit: limit });
    if (error) return json({ error: error.message }, 500);
    candidates = (data ?? []) as Candidate[];
  }

  const results: Record<string, unknown>[] = [];
  for (const c of candidates) {
    let claim = null as Claim | null;
    if (!testing) {
      const { data: rows } = await sb.rpc("client_statement_claim", { p_client_id: c.client_id, p_month: `${month}-01` });
      claim = ((rows ?? []) as Claim[])[0] ?? null;
      if (!claim) { results.push({ skipped: "already sent or being sent" }); continue; }
    }
    try {
      const { data: raw, error } = await sb.rpc("client_statement_data", { p_client_id: c.client_id, p_month: `${month}-01` });
      if (error || !raw) throw new Error(error?.message || "no statement data");
      const data: Data = { ...(raw as Data), generatedAt: new Date().toISOString() };
      const pdf = await buildPdf(data);
      const sum = summary(data);

      if (dryRun) {
        const e = await email(c, data, sum, pdf, { dryRun: true });
        results.push({ savings_entries: sum.savings?.count ?? null, wallet_entries: sum.wallet?.count ?? null,
                       pdf_bytes: pdf.length, email_rendered: e.ok, preview: e.preview, has_login: !!c.client_user_id, has_email: !!c.client_email });
        continue;
      }
      if (override) {
        const e = await email(c, data, sum, pdf, { to: override });
        results.push({ test_email_sent: e.ok, pdf_bytes: pdf.length });
        continue;
      }

      const notified = claim!.notified || await notify(c, month, sum);
      const wantsEmail = !!c.client_email;
      const emailed = claim!.emailed || (wantsEmail && (await email(c, data, sum, pdf, {})).ok);
      const done = (wantsEmail ? emailed : true) && (c.client_user_id ? notified : true);
      await sb.rpc("client_statement_finish", {
        p_id: claim!.statement_id, p_status: done ? "sent" : "failed", p_savings: sum.savings, p_wallet: sum.wallet,
        p_notified: notified, p_emailed: emailed, p_note: done ? null : `notified=${notified} emailed=${emailed}`,
      });
      results.push({ status: done ? "sent" : "failed", notified, emailed });
      if (wantsEmail) await sleep(2200);   // the email route allows 30 requests / minute / IP
    } catch (e) {
      const held = claim as Claim | null;
      if (held) {
        await sb.rpc("client_statement_finish", {
          p_id: held.statement_id, p_status: "failed", p_savings: null, p_wallet: null,
          p_notified: false, p_emailed: false, p_note: String((e as Error)?.message || e).slice(0, 200),
        });
      }
      results.push({ status: "failed", error: String((e as Error)?.message || e).slice(0, 120) });
    }
  }

  return json({ ok: true, month, candidates: candidates.length, results, dry_run: dryRun, test_override: !!override });
});
