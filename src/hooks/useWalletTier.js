import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabase";
import { compressImage } from "../utils/compressImage";
import { TIER_CFG_KEYS, tierLimits, clampTier, nextTier } from "../utils/walletTier";

// A wallet holder's tier for the profile screens: which tier they are on (1 until they upgrade), what it allows, what the next tier
// would allow, and the two upgrade calls. Lightweight on purpose — one wallets row, the limit config and the holder's own pending
// request; no realtime channel.
async function callFn(action, extra) {
  const { data, error } = await supabase.functions.invoke("flutterwave", { body: { action, ...extra } });
  if (error) {
    let msg = error.message || "Something went wrong. Please try again.";
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// The holder's latest Tier 3 request. Falls back to the original columns if the documents migration isn't live yet.
async function latestTier3(userId) {
  const q = (cols) => supabase.from("wallet_tier_requests").select(cols).eq("user_id", userId).eq("target_tier", 3)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  let { data, error } = await q("id, status, created_at, documents, review_note, submitted_at");
  if (error) ({ data } = await q("id, status, created_at"));
  if (!data) return null;
  return {
    id: data.id, status: data.status,
    hasDocs: Array.isArray(data.documents) && data.documents.length > 0,
    reviewNote: data.review_note || "",
    submittedAt: data.submitted_at || data.created_at,
  };
}

/**
 * Upload one Tier 3 document to the PRIVATE kyc_documents bucket (only the signed-in user's own "<uid>/tier3/" folder is
 * writable; nobody but our server and the admins' review screen can read it). Photos are shrunk to a sharp JPEG first;
 * a PDF is allowed for the utility bill only. Returns { kind, path }.
 */
export async function uploadTier3Doc(kind, file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error("Please sign in again, then retry.");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  let body = file, ext = "jpg", contentType = "image/jpeg";
  if (isPdf) {
    if (kind !== "utility_bill") throw new Error("Please use a photo for this one (JPG or PNG).");
    if (file.size > 6 * 1024 * 1024) throw new Error("That PDF is over 6 MB — take a photo of the bill instead.");
    ext = "pdf"; contentType = "application/pdf";
  } else {
    if (!/^image\//.test(file.type || "")) throw new Error("Please choose a photo (JPG or PNG) or, for the bill, a PDF.");
    body = await compressImage(file, 1500);
  }
  const path = `${user.id}/tier3/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("kyc_documents").upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(error.message?.includes("mime") ? "That file type isn't accepted — use a JPG, PNG or PDF." : "Upload failed — check your connection and try again.");
  return { kind, path };
}

export function useWalletTier(userId, enabled = true) {
  const [row, setRow] = useState(null);            // { tier, flw_account_number } | null (no wallet)
  const [cfg, setCfg] = useState({});
  const [t3, setT3] = useState(null);               // the latest Tier 3 request: { id, status, hasDocs, reviewNote, submittedAt } | null
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId || !enabled) { setLoading(false); return; }
    try {
      const [{ data: w }, { data: pc }, rq] = await Promise.all([
        supabase.from("wallets").select("tier, flw_account_number").eq("user_id", userId).maybeSingle(),
        supabase.from("platform_config").select("key, value").in("key", TIER_CFG_KEYS),
        latestTier3(userId),
      ]);
      setRow(w || null);
      if (Array.isArray(pc)) { const m = {}; pc.forEach((r) => { m[r.key] = r.value; }); setCfg(m); }
      setT3(rq);
    } catch { /* keep what we had — the card just shows the last known tier */ } finally { setLoading(false); }
  }, [userId, enabled]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const upgradeToTier2 = useCallback(async (form) => {
    const data = await callFn("upgrade-tier", { target_tier: 2, ...form });
    await load();
    return data;
  }, [load]);

  // form = { id_type, id_number, address, documents: [{ kind, path }], note }
  const submitTier3 = useCallback(async (form) => {
    const data = await callFn("request-tier", { target_tier: 3, ...form });
    await load();
    return data;
  }, [load]);

  const tier = clampTier(row?.tier);
  const next = nextTier(tier);
  const pending = t3?.status === "pending";
  return useMemo(() => ({
    loading,
    hasWallet: !!row?.flw_account_number,
    tier, next, pending, t3,
    limits: tierLimits(tier, cfg),
    nextLimits: next ? tierLimits(next, cfg) : null,
    refresh: load, upgradeToTier2, submitTier3, uploadTier3Doc,
  }), [loading, row, tier, next, pending, t3, cfg, load, upgradeToTier2, submitTier3]);
}
