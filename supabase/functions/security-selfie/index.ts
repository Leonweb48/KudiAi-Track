// Security selfie evidence — a live photo captured at a risky moment (a PIN reset, a new device signing in, a
// large transfer), stored as a timestamped record. NOT matched against anything automatically — see the migration
// (20270231000000_security_selfie_events.sql) for why: this is a deliberate, separate decision from the Youverify
// BVN/NIN selfie match (_shared/idCheck.ts). It never blocks the action it accompanies; it exists purely as
// deterrence (a stolen phone/session still needs someone physically willing to be photographed) and a dispute
// trail. --no-verify-jwt (same reason as flutterwave/verify-identity): the cleanup action is called by pg_cron via
// pg_net with no Supabase user session at all, so Supabase's automatic JWT gate would block it outright — every
// action here authenticates itself instead (a real user JWT for "submit", the Vault cron_secret for "cleanup").
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { selfieImageOk } from "../_shared/idCheck.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const KINDS = new Set(["pin_reset", "new_device", "large_transfer"]);

// Same dual-check as flutterwave's cronAuthorized: the CRON_SECRET function secret has drifted from the Vault
// value before, so accept either — the function secret directly, or the Vault value via the service-only RPC
// (which returns a boolean and never the secret itself).
// deno-lint-ignore no-explicit-any
async function cronAuthorized(req: Request, sb: any): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!provided) return false;
  const fromEnv = Deno.env.get("CRON_SECRET") ?? "";
  if (fromEnv && provided === fromEnv) return true;
  try {
    const { data } = await sb.rpc("verify_cron_secret", { p_secret: provided });
    return data === true;
  } catch { return false; }
}

function dataUriToBytes(dataUri: string): { bytes: Uint8Array; contentType: string } {
  const m = /^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/.exec(dataUri);
  if (!m) throw new Error("not a recognisable image");
  const contentType = m[1] === "image/jpg" ? "image/jpeg" : m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

// A small, non-sensitive detail per kind — never a full account number or free text straight from the client.
// deno-lint-ignore no-explicit-any
function sanitizeContext(kind: string, raw: any): Record<string, unknown> {
  const c = raw && typeof raw === "object" ? raw : {};
  if (kind === "large_transfer") {
    const amountKobo = Number(c.amountKobo);
    return {
      amountKobo:    Number.isFinite(amountKobo) && amountKobo >= 0 ? Math.round(amountKobo) : null,
      recipientName: typeof c.recipientName === "string" ? c.recipientName.slice(0, 80) : null,
      bankName:      typeof c.bankName === "string" ? c.bankName.slice(0, 60) : null,
      acctLast4:     typeof c.acctLast4 === "string" ? c.acctLast4.replace(/\D/g, "").slice(-4) : null,
    };
  }
  if (kind === "new_device") {
    return {
      deviceType: typeof c.deviceType === "string" ? c.deviceType.slice(0, 30) : null,
      browser:    typeof c.browser === "string" ? c.browser.slice(0, 30) : null,
      osName:     typeof c.osName === "string" ? c.osName.slice(0, 30) : null,
    };
  }
  return {};   // pin_reset needs no extra context
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const action = String(body?.action || "");

  // ── cleanup — pg_cron via pg_net, daily. Deletes the actual file via the Storage API first, and only forgets
  //    a row once its file is confirmed gone (a row that briefly survives an extra day is harmless; a leaked
  //    photo with no record of it is not) ────────────────────────────────────────────────────────────────────
  if (action === "cleanup") {
    if (!(await cronAuthorized(req, admin))) return json({ error: "Unauthorized" }, 401);
    const { data: rows, error } = await admin.rpc("security_selfie_events_older_than_90d");
    if (error) return json({ error: error.message }, 500);
    const dueIds: string[] = [];
    for (const row of (rows || []) as { id: string; storage_path: string }[]) {
      const { error: rmErr } = await admin.storage.from("security_selfies").remove([row.storage_path]);
      if (!rmErr) dueIds.push(row.id);
    }
    if (dueIds.length) await admin.rpc("security_selfie_events_delete", { p_ids: dueIds });
    return json({ success: true, deleted: dueIds.length, of: (rows || []).length });
  }

  // ── everything else needs a real signed-in user ─────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const jwt        = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // ── submit — the only client-facing action: capture + store, never a match/verdict ──────────────────────────
  if (action === "submit") {
    const kind = String(body?.kind || "");
    if (!KINDS.has(kind)) return json({ error: "Unrecognised security check" }, 400);
    if (!selfieImageOk(body?.selfie)) return json({ error: "A clear photo is required." }, 400);

    let bytes: Uint8Array, contentType: string;
    try { ({ bytes, contentType } = dataUriToBytes(body.selfie as string)); }
    catch { return json({ error: "A clear photo is required." }, 400); }

    const path = `${user.id}/${kind}/${Date.now()}.jpg`;
    const { error: upErr } = await admin.storage.from("security_selfies").upload(path, bytes, { contentType, upsert: false });
    if (upErr) return json({ error: "Couldn't save the photo — please try again." }, 500);

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const { error: insErr } = await admin.from("security_selfie_events").insert({
      user_id: user.id, kind, storage_path: path, context: sanitizeContext(kind, body?.context), ip_address: ip,
    });
    if (insErr) {
      await admin.storage.from("security_selfies").remove([path]);   // never leave an orphaned, unrecorded photo behind
      return json({ error: "Couldn't record this — please try again." }, 500);
    }
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, 400);
});
