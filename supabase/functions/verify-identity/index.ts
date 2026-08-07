import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")        || "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Tier 2 savings threshold: ₦500,000 in kobo
const TIER2_SAVINGS_THRESHOLD = 500_000_00;

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ── Name similarity (Jaccard-style token overlap) ─────────────────────────────

function normalise(t: string): string {
  return t.toLowerCase().replace(/[^a-z]/g, "");
}

function nameSimilarity(a: string, b: string): number {
  const tokA = a.split(/\s+/).map(normalise).filter(t => t.length > 1);
  const tokB = b.split(/\s+/).map(normalise).filter(t => t.length > 1);
  if (!tokA.length || !tokB.length) return 0;
  const [shorter, longer] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];
  const matches = shorter.filter(t => longer.some(u => u === t || u.includes(t) || t.includes(u))).length;
  return Math.round((matches / shorter.length) * 100);
}

// ── Paystack Identity: NIN verification ──────────────────────────────────────

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

    // Read as text first — avoids opaque "Unexpected end of JSON input" when
    // Paystack returns an empty or non-JSON body (e.g. 404, 403, 204).
    const text = await res.text();
    if (!text.trim()) {
      return { success: false, error: `Identity provider returned no response (HTTP ${res.status}). Contact support.` };
    }

    let body: { status: boolean; message?: string; data?: { first_name?: string; last_name?: string; middle_name?: string } };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return { success: false, error: `Identity provider error (HTTP ${res.status}): ${text.slice(0, 120)}`, raw: text };
    }

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

// ── Notify user (fire-and-forget) ─────────────────────────────────────────────

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

  // Auth — verify the caller's JWT using the admin client
  const authHeader = req.headers.get("Authorization") || "";
  const jwt        = authHeader.replace("Bearer ", "");
  const admin      = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const userId = user.id;

  try {
    const body = await req.json() as { action: string; [k: string]: unknown };
    const { action } = body;

    // ── get_status ────────────────────────────────────────────────────────────
    if (action === "get_status") {
      const { data: profile } = await admin
        .from("profiles")
        .select("verification_status, nin_verified, bvn_verified, face_verified, verified_name, verification_rejected_reason, tier2_trigger, tier2_trigger_detail")
        .eq("id", userId)
        .maybeSingle();

      const { data: latest } = await admin
        .from("verification_submissions")
        .select("id, tier, status, rejection_reason, submitted_at, reviewed_at")
        .eq("user_id", userId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return json({ status: profile || {}, submission: latest || null });
    }

    // ── tier1_submit ──────────────────────────────────────────────────────────
    if (action === "tier1_submit") {
      const nin = String(body.nin || "").replace(/\D/g, "");
      if (nin.length !== 11) return json({ error: "NIN must be 11 digits." }, 400);

      // Idempotent guard — already verified?
      const { data: p } = await admin
        .from("profiles")
        .select("verification_status, full_name, settlement_account_name")
        .eq("id", userId)
        .maybeSingle();

      if (p?.verification_status === "tier1_verified" || p?.verification_status === "tier2_verified") {
        return json({ already_verified: true, status: p.verification_status });
      }

      const settlementName = (p?.settlement_account_name || p?.full_name || "") as string;

      // Call Paystack Identity API
      const result = await verifyNINPaystack(nin);

      if (!result.success) {
        await admin.from("verification_submissions").insert({
          user_id: userId, tier: 1, status: "failed",
          nin, rejection_reason: result.error,
          provider_response: result.raw,
        });
        await admin.from("profiles").update({
          verification_status: "tier1_failed",
          verification_submitted_at: new Date().toISOString(),
          verification_rejected_reason: result.error,
        }).eq("id", userId);
        return json({ success: false, error: result.error });
      }

      const score = settlementName
        ? nameSimilarity(result.verifiedName!, settlementName)
        : 100; // No settlement name on file → skip match

      const nameMatched = score >= 60;

      if (!nameMatched) {
        const reason = `Identity name "${result.verifiedName}" does not sufficiently match your settlement account name "${settlementName}" (match: ${score}%). Please update your settlement account to match your legal name, or contact support.`;
        await admin.from("verification_submissions").insert({
          user_id: userId, tier: 1, status: "failed",
          nin, submitted_name: settlementName,
          verified_name: result.verifiedName, name_match_score: score,
          rejection_reason: reason, provider_response: result.raw,
        });
        await admin.from("profiles").update({
          verification_status: "tier1_failed",
          verification_submitted_at: new Date().toISOString(),
          verified_name: result.verifiedName,
          verification_rejected_reason: reason,
        }).eq("id", userId);
        await notifyUser(userId, "Verification Incomplete", reason, "verification_tier1_failed");
        return json({ success: false, error: reason, score, verifiedName: result.verifiedName });
      }

      // ── Passed Tier 1 — check if Tier 2 is required ──────────────────────
      const { data: savingsRow } = await admin
        .from("aso_clients")
        .select("balance")
        .eq("owner_id", userId);

      const totalSavings = (savingsRow || []).reduce((s: number, r: { balance?: number }) => s + (r.balance ?? 0), 0);
      const tier2Required = totalSavings > TIER2_SAVINGS_THRESHOLD;
      const tier2Trigger  = tier2Required ? "savings_threshold" : undefined;
      const tier2Detail   = tier2Required
        ? `Total held client savings ₦${(totalSavings / 100).toLocaleString("en-NG")} exceeds the ₦500,000 threshold.`
        : undefined;

      const finalStatus = tier2Required ? "tier2_required" : "tier1_verified";

      await admin.from("verification_submissions").insert({
        user_id: userId, tier: 1, status: "approved",
        nin, submitted_name: settlementName,
        verified_name: result.verifiedName, name_match_score: score,
        nin_verified: true, provider_response: result.raw,
      });
      await admin.from("profiles").update({
        verification_status: finalStatus,
        nin_verified: true,
        verified_name: result.verifiedName,
        verification_submitted_at: new Date().toISOString(),
        verification_rejected_reason: null,
        tier2_trigger: tier2Trigger ?? null,
        tier2_trigger_detail: tier2Detail ?? null,
      }).eq("id", userId);

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
        tier2Required,
        tier2Detail,
      });
    }

    // ── tier2_submit ──────────────────────────────────────────────────────────
    if (action === "tier2_submit") {
      const docUrl    = String(body.doc_url           || "");
      const g1Name    = String(body.guarantor1_name   || "");
      const g1Phone   = String(body.guarantor1_phone  || "");
      const g1Email   = String(body.guarantor1_email  || "");
      const g1Address = String(body.guarantor1_address || "");
      const g1Nin     = String(body.guarantor1_nin    || "");
      const g2Name    = String(body.guarantor2_name   || "");
      const g2Phone   = String(body.guarantor2_phone  || "");
      const g2Email   = String(body.guarantor2_email  || "");
      const g2Address = String(body.guarantor2_address || "");
      const g2Nin     = String(body.guarantor2_nin    || "");

      if (!docUrl) return json({ error: "Document URL is required." }, 400);
      if (!g1Name || !g1Phone || !g2Name || !g2Phone) {
        return json({ error: "Both guarantors must provide at least a name and phone number." }, 400);
      }

      await admin.from("verification_submissions").insert({
        user_id: userId, tier: 2, status: "pending",
        doc_url: docUrl,
        guarantor1_name: g1Name, guarantor1_phone: g1Phone,
        guarantor1_email: g1Email, guarantor1_address: g1Address, guarantor1_nin: g1Nin,
        guarantor2_name: g2Name, guarantor2_phone: g2Phone,
        guarantor2_email: g2Email, guarantor2_address: g2Address, guarantor2_nin: g2Nin,
      });
      await admin.from("profiles").update({ verification_status: "tier2_pending" }).eq("id", userId);
      return json({ success: true, status: "tier2_pending" });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    console.error("[verify-identity]", msg);
    return json({ error: msg }, 500);
  }
});
