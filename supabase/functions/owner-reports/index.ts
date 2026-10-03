// owner-reports — the monthly Business Report + Wallet Statement for business owners.
//
// pg_cron (days 1–3, every 10 min) → owner_reports_trigger() → pg_net → here (x-cron-secret).
// For each owner due LAST month (WAT; migration 20270277 decides who): claim the month (never twice) → read the
// business's data and build the General Business Report with the app's own code (_shared/app: reportData,
// businessReport, reportPdfCore — byte-for-byte copies of src/shared) → the month's wallet statement
// (client_wallet_statement + the shared statement layout) → a verify reference + QR on each PDF → in-app notification
// + push (notify-send) → email with both PDFs attached (admin pipeline, event owner_monthly_reports; skipped when the
// owner turned the email off) → record what went out.
//
// Body (all optional): { month: "YYYY-MM", limit }
// Test modes — nothing is recorded and nobody is notified:
//   dry_run: true          build everything and have the email pipeline render (not send) the email; counts only back
//   override_email: "a@b"  send the email to this address instead of the owner's (limit 1)
//   owner_id               with either test mode: only this owner (otherwise the first owner due)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@4.2.1";
import QRCode from "npm:qrcode@1.5.4";
import { buildGeneralData } from "../_shared/app/reportData.js";
import { businessReportSource, businessReportSummary, drawBusinessReport, letterheadFrom } from "../_shared/app/businessReport.js";
import { createReportPdfCore, fmtDate } from "../_shared/app/reportPdfCore.js";
import {
  businessHolder, fmtNaira, monthDates, monthKeyLabel, renderStatementPdf, verifyUrl, walletMonthSections, walletTitle,
  walletVerifySummary,
} from "../_shared/app/statementPdfLayout.js";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET    = Deno.env.get("CRON_SECRET") ?? "";
const TRIGGER_SECRET = Deno.env.get("EMAIL_TRIGGER_SECRET") || SERVICE_KEY;
const EMAIL_URL      = "https://admin.kudiai.app/api/public/email-trigger";
const LOGO_URL       = "https://kudiai.app/icon-192.png";
const FONT_URLS      = { reg: "https://kudiai.app/fonts/NotoSans-Regular.ttf", med: "https://kudiai.app/fonts/NotoSans-Medium.ttf" };
const MAX_BIZ_LOGO   = 600_000;   // bytes — a bigger logo is left off rather than bloating every email

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Candidate = { owner_id: string; owner_email: string | null; wants_email: boolean; business_name: string | null };
type Claim = { report_id: string; notified: boolean; emailed: boolean };
type Verify = { ref: string; qr: { size: number; isDark: (r: number, c: number) => boolean } } | null;
// deno-lint-ignore no-explicit-any
type Any = any;

// The service role, proven: the token works on a service-only RPC (an ordinary user token never gets that far).
async function isServiceCall(token: string): Promise<boolean> {
  if (SERVICE_KEY && token === SERVICE_KEY) return true;
  if (!token || token.split(".").length !== 3) return false;
  try {
    const p = JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")));
    if (p?.role !== "service_role") return false;
  } catch { return false; }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/owner_report_candidates`, {
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
  const y = w.getUTCFullYear(), m = w.getUTCMonth();
  const py = m === 0 ? y - 1 : y, pm = m === 0 ? 12 : m;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchBytes(url: string, max = 2_000_000): Promise<Uint8Array | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.length <= max ? b : null;
  } catch { return null; }
}

let assetCache: { logo: Uint8Array | null; fontReg: string | null; fontMed: string | null } | undefined;
async function assets() {
  if (assetCache) return assetCache;
  const [logo, reg, med] = await Promise.all([fetchBytes(LOGO_URL), fetchBytes(FONT_URLS.reg), fetchBytes(FONT_URLS.med)]);
  assetCache = { logo, fontReg: reg ? toBase64(reg) : null, fontMed: med ? toBase64(med) : null };
  return assetCache;
}

/** The business's logo for the letterhead — { dataUrl, w, h, format }, or null (too big, unreadable, not PNG/JPEG). */
async function bizLogo(url: string) {
  if (!/^https:\/\//i.test(url || "")) return null;
  const b = await fetchBytes(url, MAX_BIZ_LOGO);
  if (!b) return null;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpg = b[0] === 0xff && b[1] === 0xd8;
  if (!png && !jpg) return null;
  const dataUrl = `data:image/${png ? "png" : "jpeg"};base64,${toBase64(b)}`;
  try {
    const p = new jsPDF().getImageProperties(dataUrl);
    return { dataUrl, w: p.width, h: p.height, format: png ? "PNG" : "JPEG" };
  } catch { return null; }
}

/** Same QR library and settings as the app (src/utils/qrMatrix.js). */
function qrMatrix(text: string) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  return { size: q.modules.size as number, isDark: (r: number, c: number) => !!q.modules.get(r, c) };
}

async function registerVerify(sb: Any, ownerId: string, type: string, from: string, to: string, name: string,
                              summary: { label: string; value: string }[]): Promise<Verify> {
  const { data, error } = await sb.from("report_verifications").insert({
    owner_id: ownerId, report_type: type, period_from: from, period_to: to,
    business_name: (name || "").slice(0, 200) || null, summary: summary.slice(0, 8),
  }).select("ref").single();
  if (error || !data?.ref) return null;
  return { ref: data.ref as string, qr: qrMatrix(verifyUrl(data.ref as string)) };
}

type Built = {
  month: string; label: string; business: Any; wallet: Any | null;
  businessPdf: Uint8Array; walletPdf: Uint8Array | null; verified: number; name: string; ownerName: string;
};

/** Build both PDFs for one owner's month. `sample` = a dry run: a sample reference, nothing saved. */
async function build(sb: Any, ownerId: string, month: string, sample: boolean): Promise<Built> {
  const { fromDate: from, toDate: to } = monthDates(month);
  const t0 = `${from}T00:00:00+01:00`;
  const t1 = `${monthDates(nextMonth(month)).fromDate}T00:00:00+01:00`;
  const [{ data: profile }, { data: inv }] = await Promise.all([
    sb.from("profiles").select("*").eq("id", ownerId).maybeSingle(),
    sb.from("invoice_settings").select("logo_url, contact_email, contact_phone, address").eq("user_id", ownerId).maybeSingle(),
  ]);
  if (!profile) throw new Error("no profile");
  const generatedAt = new Date();
  const letterhead = letterheadFrom(profile, inv, generatedAt);
  const name = letterhead.businessName;

  // ── Business Report (the Reports page's General Business Report for the month) ──
  const data: Any = buildGeneralData((await businessReportSource(sb, ownerId, { from, to })) as Any, from, to);
  const a = await assets();
  const sampleVerify = (ref: string) => ({ ref, qr: qrMatrix(verifyUrl(ref)) });
  const bizVerify: Verify = sample ? sampleVerify("KDR-000000-SAMPLEQR")
    : await registerVerify(sb, ownerId, "general", from, to, name, businessReportSummary(data));
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pdf = createReportPdfCore(doc, {
    title: "Business Report", businessName: name, period: `${fmtDate(from)} – ${fmtDate(to)}`, letterhead,
    verifyRef: bizVerify?.ref || "",
  }, { appLogo: a.logo, fontReg: a.fontReg, fontMed: a.fontMed, bizLogo: await bizLogo(letterhead.logoUrl), qr: bizVerify?.qr || null });
  drawBusinessReport(pdf, data);
  const businessPdf = new Uint8Array(pdf.getDoc().output("arraybuffer"));

  // ── Wallet statement for the month ──
  const { data: w } = await sb.rpc("client_wallet_statement", { p_user_id: ownerId, p_from: t0, p_to: t1 });
  let walletPdf: Uint8Array | null = null;
  let walletVerified = false;
  if (w) {
    const holder = businessHolder({ name, phone: letterhead.phone, email: letterhead.email, address: letterhead.address });
    const sections = walletMonthSections(w, month, holder, { titleFor: walletTitle });
    const wVerify: Verify = sample ? sampleVerify("KDR-000000-SAMPLEWT")
      : await registerVerify(sb, ownerId, "wallet_statement", from, to, name, walletVerifySummary(sections[0].months, w.account?.number) as { label: string; value: string }[]);
    walletVerified = !!wVerify;
    const wdoc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
    let font = "helvetica";
    if (a.fontReg) {
      wdoc.addFileToVFS("NotoSans-Regular.ttf", a.fontReg); wdoc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      if (a.fontMed) { wdoc.addFileToVFS("NotoSans-Medium.ttf", a.fontMed); wdoc.addFont("NotoSans-Medium.ttf", "NotoSans", "bold"); }
      else wdoc.addFont("NotoSans-Regular.ttf", "NotoSans", "bold");
      font = "NotoSans";
    }
    renderStatementPdf(wdoc, { sections, generatedAt, verify: wVerify }, { logo: a.logo, font });
    walletPdf = new Uint8Array(wdoc.output("arraybuffer"));
  }

  return {
    month, label: monthKeyLabel(month), name, ownerName: profile.full_name || "",
    business: {
      revenue: data.profit.revenue, gross: data.profit.gross, expenses: data.profit.expenses, net: data.profit.net,
      money_in: data.money.in, money_out: data.money.out,
    },
    wallet: w ? {
      opening: w.opening_kobo / 100, in: w.in_kobo / 100, out: w.out_kobo / 100, closing: w.closing_kobo / 100,
      count: (w.entries || []).length, account: w.account?.number || "", bank: w.account?.bank || "",
    } : null,
    businessPdf, walletPdf, verified: (bizVerify ? 1 : 0) + (walletVerified ? 1 : 0),
  };
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

async function notify(ownerId: string, b: Built): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        action: "notify", userId: ownerId, type: "monthly_reports", category: "money", priority: "normal",
        title: `Your ${b.label} reports are ready`,
        body: `Net profit ${fmtNaira(b.business.net)}${b.wallet ? ` · Wallet ${fmtNaira(b.wallet.closing)}` : ""}. Tap to view or download your Business Report${b.wallet ? " and Wallet Statement" : ""}.`,
        deepLink: { tab: "insights", openReports: "monthly", month: b.month },
        dedupeKey: `owner-reports:${ownerId}:${b.month}`,
      }),
    });
    return r.ok;
  } catch { return false; }
}

async function email(to: string, b: Built, opts: { dryRun?: boolean } = {}): Promise<{ ok: boolean; preview?: unknown }> {
  const file = (kind: string) => `KudiAI_${kind}_${b.label.replace(/\s+/g, "_")}.pdf`;
  const attachments = [{ filename: file("Business_Report"), content: toBase64(b.businessPdf) }];
  if (b.walletPdf) attachments.push({ filename: file("Wallet_Statement"), content: toBase64(b.walletPdf) });
  try {
    const r = await fetch(EMAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-trigger-secret": TRIGGER_SECRET },
      body: JSON.stringify({
        event: "owner_monthly_reports",
        data: {
          owner_email: to || "dry-run@example.invalid", owner_name: b.ownerName, business_name: b.name,
          month: b.month, month_label: b.label, business: b.business, wallet: b.wallet, attachments, dry_run: !!opts.dryRun,
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
  let limit = Math.min(Math.max(Number(body.limit) || 2, 1), 5);
  if (override) limit = 1;

  let candidates: Candidate[] = [];
  if (testing && typeof body.owner_id === "string") {
    const { data: p } = await sb.from("profiles").select("id, email, business_name, monthly_reports_email").eq("id", body.owner_id).maybeSingle();
    if (!p) return json({ error: "owner not found" }, 404);
    candidates = [{ owner_id: p.id, owner_email: p.email, wants_email: p.monthly_reports_email !== false, business_name: p.business_name }];
  } else {
    const { data, error } = await sb.rpc("owner_report_candidates", { p_month: `${month}-01`, p_limit: limit });
    if (error) return json({ error: error.message }, 500);
    candidates = (data ?? []) as Candidate[];
  }

  const results: Record<string, unknown>[] = [];
  for (const c of candidates) {
    let claim = null as Claim | null;
    if (!testing) {
      const { data: rows } = await sb.rpc("owner_report_claim", { p_owner_id: c.owner_id, p_month: `${month}-01` });
      claim = ((rows ?? []) as Claim[])[0] ?? null;
      if (!claim) { results.push({ skipped: "already sent or being sent" }); continue; }
    }
    try {
      const b = await build(sb, c.owner_id, month, dryRun);
      if (dryRun) {
        const e = await email(c.owner_email || "", b, { dryRun: true });
        results.push({ business_pdf_bytes: b.businessPdf.length, wallet_pdf_bytes: b.walletPdf?.length ?? null, email_rendered: e.ok,
                       preview: e.preview, has_email: !!c.owner_email, wants_email: c.wants_email, font: assetCache?.fontReg ? "NotoSans" : "helvetica" });
        continue;
      }
      if (override) {
        const e = await email(override, b);
        results.push({ test_email_sent: e.ok, business_pdf_bytes: b.businessPdf.length, wallet_pdf_bytes: b.walletPdf?.length ?? null, verified: b.verified });
        continue;
      }
      const notified = claim!.notified || await notify(c.owner_id, b);
      const wantsEmail = c.wants_email && !!c.owner_email;
      const emailed = claim!.emailed || (wantsEmail && (await email(c.owner_email!, b)).ok);
      const done = notified && (wantsEmail ? emailed : true);
      await sb.rpc("owner_report_finish", {
        p_id: claim!.report_id, p_status: done ? "sent" : "failed", p_business: b.business, p_wallet: b.wallet,
        p_notified: notified, p_emailed: emailed, p_note: done ? null : `notified=${notified} emailed=${emailed}`,
      });
      results.push({ status: done ? "sent" : "failed", notified, emailed, verified: b.verified });
      if (wantsEmail) await sleep(2200);   // the email route allows 30 requests / minute / IP
    } catch (e) {
      const held = claim as Claim | null;
      if (held) {
        await sb.rpc("owner_report_finish", {
          p_id: held.report_id, p_status: "failed", p_business: null, p_wallet: null,
          p_notified: false, p_emailed: false, p_note: String((e as Error)?.message || e).slice(0, 200),
        });
      }
      results.push({ status: "failed", error: String((e as Error)?.message || e).slice(0, 120) });
    }
  }

  return json({ ok: true, month, candidates: candidates.length, results, dry_run: dryRun, test_override: !!override });
});
