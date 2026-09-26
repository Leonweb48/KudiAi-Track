import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { bettingVisible } from "../utils/platform";

// Module-level cache: fetched once per browser session, reused across all hook calls.
let _cache = null;
let _pending = null;

function fetchConfig() {
  if (_pending) return _pending;
  _pending = supabase
    .from("platform_config")
    .select("key, value")
    .then(({ data }) => {
      const cfg = {};
      (data || []).forEach(r => { cfg[r.key] = r.value; });
      _cache = cfg;
      return cfg;
    })
    .catch(() => {
      _cache = {};
      return {};
    });
  return _pending;
}

export function usePlatformConfig() {
  const [config, setConfig] = useState(_cache);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) { setConfig(_cache); setLoading(false); return; }
    fetchConfig().then(cfg => { setConfig(cfg); setLoading(false); });
  }, []);

  let ckDiscounts = null;
  try { ckDiscounts = config?.ck_discounts ? JSON.parse(config.ck_discounts) : null; } catch { ckDiscounts = null; }

  return {
    coopEnabled: config?.coop_module_enabled === "true",
    ckDiscounts,                                            // { airtime:{NET:pct}, epin:{NET:pct}, epin_live:{}, ... }
    enterpriseFeePct: Number(config?.enterprise_bill_fee_pct ?? "0.01") || 0.01,
    walletEnabled: config?.wallet_enabled === "true",
    // Business loans are offered through a third-party lender that is not live yet. Off ("coming soon", no application form) until
    // platform_config.business_loan_enabled = "true" — flipping it on needs no app rebuild.
    loansEnabled: config?.business_loan_enabled === "true",
    // Betting Wallet tile: on for the web, off in the Android app (Google Play gambling rules) until platform_config.android_betting_enabled = "true".
    bettingVisible: bettingVisible(config),
    walletTestMode: config?.wallet_test_mode !== "false",   // default on until explicitly disabled
    // Off until Flutterwave confirms BVN Verification is enabled on this merchant
    // account — flipping this on is the only thing needed to re-enable both the
    // backend enforcement (flutterwave/index.ts) and the reverify banners.
    bvnVerificationEnabled: config?.bvn_verification_enabled === "true",
    walletMinTopupKobo: Number(config?.wallet_min_topup_kobo ?? "10000") || 10000,
    walletMaxWithdrawalKobo: Number(config?.wallet_max_withdrawal_kobo ?? "5000000") || 5000000,
    // Mirrors the server-side cap already enforced in wallet_hold_transfer
    // (SUM of today's withdrawals) — this value is display-only, the RPC
    // remains the sole authority on whether a transfer is actually allowed.
    walletDailyWithdrawalCapKobo: Number(config?.wallet_daily_withdrawal_cap_kobo ?? "10000000") || 10000000,
    configLoading: loading,
  };
}
