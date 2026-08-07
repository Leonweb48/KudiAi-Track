import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")                || "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")   || "";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ── Notify user (fire-and-forget) ─────────────────────────────────────────────

async function notifyUser(userId: string, title: string, body: string, type: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-send`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        action:    "notify",
        userId,
        type,
        category:  "approvals",
        title,
        body,
        deepLink:  { tab: "verification" },
        dedupeKey: `${type}_${userId}`,
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

      // Idempotent guard
      const { data: p } = await admin
        .from("profiles")
        .select("verification_status")
        .eq("id", userId)
        .maybeSingle();

      const current = p?.verification_status as string | undefined;
      if (current === "tier1_verified" || current === "tier2_verified") {
        return json({ already_verified: true, status: current });
      }
      if (current === "tier1_pending") {
        return json({ success: true, status: "tier1_pending", already_submitted: true });
      }

      // Store NIN for manual admin review (no external API call)
      await admin.from("verification_submissions").insert({
        user_id: userId, tier: 1, status: "pending", nin,
      });
      await admin.from("profiles").update({
        verification_status: "tier1_pending",
        verification_submitted_at: new Date().toISOString(),
        verification_rejected_reason: null,
      }).eq("id", userId);

      await notifyUser(userId,
        "NIN submitted for review",
        "Your NIN has been received and is being reviewed. Expect a decision within 1–2 business days.",
        "verification_tier1_submitted",
      );

      return json({ success: true, status: "tier1_pending" });
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
