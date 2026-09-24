import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabase";
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

export function useWalletTier(userId, enabled = true) {
  const [row, setRow] = useState(null);            // { tier, flw_account_number } | null (no wallet)
  const [cfg, setCfg] = useState({});
  const [pending, setPending] = useState(false);   // a Tier 3 request is waiting for review
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId || !enabled) { setLoading(false); return; }
    try {
      const [{ data: w }, { data: pc }, { data: rq }] = await Promise.all([
        supabase.from("wallets").select("tier, flw_account_number").eq("user_id", userId).maybeSingle(),
        supabase.from("platform_config").select("key, value").in("key", TIER_CFG_KEYS),
        supabase.from("wallet_tier_requests").select("id").eq("user_id", userId).eq("status", "pending").eq("target_tier", 3).maybeSingle(),
      ]);
      setRow(w || null);
      if (Array.isArray(pc)) { const m = {}; pc.forEach((r) => { m[r.key] = r.value; }); setCfg(m); }
      setPending(!!rq);
    } catch { /* keep what we had — the card just shows the last known tier */ } finally { setLoading(false); }
  }, [userId, enabled]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const upgradeToTier2 = useCallback(async (form) => {
    const data = await callFn("upgrade-tier", { target_tier: 2, ...form });
    await load();
    return data;
  }, [load]);

  const requestTier3 = useCallback(async (note = "") => {
    const data = await callFn("request-tier", { target_tier: 3, note });
    await load();
    return data;
  }, [load]);

  const tier = clampTier(row?.tier);
  const next = nextTier(tier);
  return useMemo(() => ({
    loading,
    hasWallet: !!row?.flw_account_number,
    tier, next, pending,
    limits: tierLimits(tier, cfg),
    nextLimits: next ? tierLimits(next, cfg) : null,
    refresh: load, upgradeToTier2, requestTier3,
  }), [loading, row, tier, next, pending, cfg, load, upgradeToTier2, requestTier3]);
}
