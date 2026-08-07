import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const PAYSTACK_SECRET  = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const DB_URL           = Deno.env.get("SUPABASE_DB_URL")     || "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")        || "";
const SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Tier 2 savings threshold: if total held Ajo savings > this, Tier 2 is required.
const TIER2_SAVINGS_THRESHOLD = 500_000_00; // ₦500,000 in kobo

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ── Schema bootstrap (idempotent) ─────────────────────────────────────────────

let _schemaReady = false;

async function ensureSchema(sql: ReturnType<typeof postgres>) {
  if (_schemaReady) return;
  // Add columns to profiles (safe to run repeatedly)
  await sql`
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS verification_status          TEXT    DEFAULT 'unverified',
      ADD COLUMN IF NOT EXISTS nin_verified                 BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS bvn_verified                 BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS face_verified                BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS verified_name                TEXT,
      ADD COLUMN IF NOT EXISTS verification_submitted_at    TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS verification_rejected_reason TEXT,
      ADD COLUMN IF NOT EXISTS tier2_trigger                TEXT,
      ADD COLUMN IF NOT EXISTS tier2_trigger_detail         TEXT
  `;

  // Create verification_submissions table
  await sql`
    CREATE TABLE IF NOT EXISTS verification_submissions (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID        REFERENCES profiles(id) ON DELETE CASCADE,
      tier                INT         NOT NULL DEFAULT 1,
      status              TEXT        NOT NULL DEFAULT 'pending',
      nin                 TEXT,
      bvn                 TEXT,
      submitted_name      TEXT,
      verified_name       TEXT,
      name_match_score    INT,
      nin_verified        BOOLEAN     DEFAULT false,
      bvn_verified        BOOLEAN     DEFAULT false,
      provider_response   JSONB,
      rejection_reason    TEXT,
      doc_url             TEXT,
      guarantor1_name     TEXT,
      guarantor1_phone    TEXT,
      guarantor1_email    TEXT,
      guarantor1_address  TEXT,
      guarantor1_nin      TEXT,
      guarantor2_name     TEXT,
      guarantor2_phone    TEXT,
      guarantor2_email    TEXT,
      guarantor2_address  TEXT,
      guarantor2_nin      TEXT,
      submitted_at        TIMESTAMPTZ DEFAULT now(),
      reviewed_at         TIMESTAMPTZ,
      reviewer_id         UUID,
      review_notes        TEXT
    )
  `;

  // RLS — users read their own, service role bypasses
  await sql`ALTER TABLE verification_submissions ENABLE ROW LEVEL SECURITY`;
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'verification_submissions' AND policyname = 'user_sees_own'
      ) THEN
        CREATE POLICY "user_sees_own" ON verification_submissions
          FOR SELECT USING (auth.uid() = user_id);
      END IF;
    END $$
  `;

  _schemaReady = true;
}

// ── Name similarity (Jaccard-style token overlap) ─────────────────────────────

function normalise(t: string): string {
  return t.toLowerCase().replace(/[^a-z]/g, "");
}

function nameSimilarity(a: string, b: string): number {
  const tokA = a.split(/\s+/).map(normalise).filter(t => t.length > 1);
  const tokB = b.split(/\s+/).map(normalise).filter(t => t.length > 1);
  if (!tokA.length || !tokB.length) return 0;
  const [shorter, longer] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];
  // A token matches if the longer set contains it or a superstring of it
  const matches = shorter.filter(t => longer.some(u => u === t || u.includes(t) || t.includes(u))).length;
  return Math.round((matches / shorter.length) * 100);
}

// ── Paystack Identity: NIN verification ──────────────────────────────────────
// Endpoint: POST https://api.paystack.co/customer/{customer_code}/identification
// OR standalone: POST https://api.paystack.co/identity/verify  (check with Paystack docs)
// Response: { status: true, data: { first_name, last_name, middle_name, ... } }

async function verifyNINPaystack(nin: string): Promise<{
  success: boolean;
  verifiedName?: string;
  raw?: unknown;
  error?: string;
}> {
  if (!PAYSTACK_SECRET) return { success: false, error: "Identity verification not configured." };
  try {
    const res = await fetch("https://api.paystack.co/identity/verify", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ type: "nin", value: nin }),
    });
    const body = await res.json() as {
      status: boolean;
      message?: string;
      data?: { first_name?: string; last_name?: string; middle_name?: string };
    };

    if (!body.status || !body.data) {
      return { success: false, error: body.message || "NIN not found or invalid.", raw: body };
    }
    const { first_name = "", last_name = "", middle_name = "" } = body.data;
    const verifiedName = [first_name, middle_name, last_name].filter(Boolean).join(" ").trim();
    return { success: true, verifiedName, raw: body };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Network error contacting identity provider.";
    return { success: false, error: msg };
  }
}

// ── Check Tier 2 trigger for a user ──────────────────────────────────────────

async function checkTier2Trigger(sql: ReturnType<typeof postgres>, userId: string): Promise<{
  required: boolean;
  trigger?: string;
  detail?: string;
}> {
  // Check total ajo savings held
  const [row] = await sql`
    SELECT COALESCE(SUM(ac.balance), 0)::BIGINT AS total_savings
    FROM aso_clients ac
    WHERE ac.owner_id = ${userId}
  `;
  const savings = Number(row?.total_savings ?? 0);
  if (savings > TIER2_SAVINGS_THRESHOLD) {
    return {
      required: true,
      trigger: "savings_threshold",
      detail:  `Total held client savings ₦${(savings / 100).toLocaleString("en-NG")} exceeds the ₦500,000 threshold.`,
    };
  }
  return { required: false };
}

// ── Notify user (fire-and-forget via notify-send) ────────────────────────────

async function notifyUser(userId: string, title: string, body: string, event: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        userId, category: "approvals", event,
        title, body,
        dedupeKey: `${event}_${userId}`,
      }),
    });
  } catch { /* non-fatal */ }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Auth — extract caller's user ID
  const authHeader = req.headers.get("Authorization") || "";
  const supabase   = createClient(SUPABASE_URL, SERVICE_KEY);
  const callerClient = createClient(SUPABASE_URL, authHeader.replace("Bearer ", ""), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const userId = user.id;
  let sql: ReturnType<typeof postgres> | null = null;

  try {
    sql = postgres(DB_URL, { max: 1 });
    await ensureSchema(sql);

    const body = await req.json() as { action: string; [k: string]: unknown };
    const { action } = body;

    // ── get_status ──────────────────────────────────────────────────────────
    if (action === "get_status") {
      const [profile] = await sql`
        SELECT verification_status, nin_verified, bvn_verified, face_verified,
               verified_name, verification_rejected_reason, tier2_trigger, tier2_trigger_detail
        FROM profiles WHERE id = ${userId}
      `;
      const [latest] = await sql`
        SELECT id, tier, status, rejection_reason, submitted_at, reviewed_at
        FROM verification_submissions
        WHERE user_id = ${userId}
        ORDER BY submitted_at DESC LIMIT 1
      `;
      return json({ status: profile || {}, submission: latest || null });
    }

    // ── tier1_submit ────────────────────────────────────────────────────────
    if (action === "tier1_submit") {
      const nin  = String(body.nin  || "").replace(/\D/g, "");
      const bvn  = String(body.bvn  || "").replace(/\D/g, "");

      if (nin.length !== 11) return json({ error: "NIN must be 11 digits." }, 400);

      // Already verified? Idempotent guard
      const [p] = await sql`SELECT verification_status FROM profiles WHERE id = ${userId}`;
      if (p?.verification_status === "tier1_verified" || p?.verification_status === "tier2_verified") {
        return json({ already_verified: true, status: p.verification_status });
      }

      // Get settlement account name for name matching
      const [profile] = await sql`
        SELECT full_name, settlement_account_name
        FROM profiles WHERE id = ${userId}
      `;
      const settlementName = profile?.settlement_account_name || profile?.full_name || "";

      // Call Paystack Identity
      const result = await verifyNINPaystack(nin);

      if (!result.success) {
        // Record failed attempt
        await sql`
          INSERT INTO verification_submissions
            (user_id, tier, status, nin, rejection_reason, provider_response)
          VALUES (${userId}, 1, 'failed', ${nin}, ${result.error}, ${JSON.stringify(result.raw)})
        `;
        await sql`
          UPDATE profiles SET
            verification_status = 'tier1_failed',
            verification_submitted_at = now(),
            verification_rejected_reason = ${result.error}
          WHERE id = ${userId}
        `;
        return json({ success: false, error: result.error });
      }

      const score = settlementName
        ? nameSimilarity(result.verifiedName!, settlementName)
        : 100; // No settlement name on file → skip match, still pass (they must verify settlement separately)

      const nameMatched = score >= 60;

      if (!nameMatched) {
        const reason = `Identity name "${result.verifiedName}" does not sufficiently match your settlement account name "${settlementName}" (match: ${score}%). Please update your settlement account to match your legal name, or contact support.`;
        await sql`
          INSERT INTO verification_submissions
            (user_id, tier, status, nin, submitted_name, verified_name, name_match_score, rejection_reason, provider_response)
          VALUES (${userId}, 1, 'failed', ${nin}, ${settlementName}, ${result.verifiedName}, ${score}, ${reason}, ${JSON.stringify(result.raw)})
        `;
        await sql`
          UPDATE profiles SET
            verification_status = 'tier1_failed',
            verification_submitted_at = now(),
            verified_name = ${result.verifiedName},
            verification_rejected_reason = ${reason}
          WHERE id = ${userId}
        `;
        await notifyUser(userId, "Verification Incomplete", reason, "verification_tier1_failed");
        return json({ success: false, error: reason, score, verifiedName: result.verifiedName });
      }

      // ── Passed Tier 1 ──────────────────────────────────────────────────────
      // Check whether Tier 2 is also required
      const tier2 = await checkTier2Trigger(sql, userId);

      const finalStatus = tier2.required ? "tier2_required" : "tier1_verified";

      await sql`
        INSERT INTO verification_submissions
          (user_id, tier, status, nin, submitted_name, verified_name, name_match_score, nin_verified, provider_response)
        VALUES (${userId}, 1, 'approved', ${nin}, ${settlementName}, ${result.verifiedName}, ${score}, true, ${JSON.stringify(result.raw)})
      `;
      await sql`
        UPDATE profiles SET
          verification_status = ${finalStatus},
          nin_verified = true,
          verified_name = ${result.verifiedName},
          verification_submitted_at = now(),
          verification_rejected_reason = NULL,
          tier2_trigger = ${tier2.trigger || null},
          tier2_trigger_detail = ${tier2.detail || null}
        WHERE id = ${userId}
      `;

      if (finalStatus === "tier1_verified") {
        await notifyUser(userId, "Identity Verified ✓",
          `Your NIN has been verified (${result.verifiedName}). Your account is now verified.`,
          "verification_tier1_passed");
      }

      return json({
        success: true,
        status: finalStatus,
        verifiedName: result.verifiedName,
        score,
        tier2Required: tier2.required,
        tier2Detail:   tier2.detail,
      });
    }

    // ── tier2_submit ────────────────────────────────────────────────────────
    if (action === "tier2_submit") {
      const docUrl        = String(body.doc_url || "");
      const g1Name        = String(body.guarantor1_name    || "");
      const g1Phone       = String(body.guarantor1_phone   || "");
      const g1Email       = String(body.guarantor1_email   || "");
      const g1Address     = String(body.guarantor1_address || "");
      const g1Nin         = String(body.guarantor1_nin     || "");
      const g2Name        = String(body.guarantor2_name    || "");
      const g2Phone       = String(body.guarantor2_phone   || "");
      const g2Email       = String(body.guarantor2_email   || "");
      const g2Address     = String(body.guarantor2_address || "");
      const g2Nin         = String(body.guarantor2_nin     || "");

      if (!docUrl) return json({ error: "Document URL is required." }, 400);
      if (!g1Name || !g1Phone || !g2Name || !g2Phone) return json({ error: "Both guarantors must provide at least a name and phone number." }, 400);

      await sql`
        INSERT INTO verification_submissions
          (user_id, tier, status, doc_url,
           guarantor1_name, guarantor1_phone, guarantor1_email, guarantor1_address, guarantor1_nin,
           guarantor2_name, guarantor2_phone, guarantor2_email, guarantor2_address, guarantor2_nin)
        VALUES
          (${userId}, 2, 'pending', ${docUrl},
           ${g1Name}, ${g1Phone}, ${g1Email}, ${g1Address}, ${g1Nin},
           ${g2Name}, ${g2Phone}, ${g2Email}, ${g2Address}, ${g2Nin})
      `;
      await sql`
        UPDATE profiles SET verification_status = 'tier2_pending'
        WHERE id = ${userId}
      `;
      return json({ success: true, status: "tier2_pending" });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    console.error("[verify-identity]", msg);
    return json({ error: msg }, 500);
  } finally {
    await sql?.end?.();
  }
});
