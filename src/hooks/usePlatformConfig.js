import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { bettingVisible } from "../utils/platform";
import { inviteConfigFromPlatform } from "../utils/invite";

// Module-level cache: fetched once per session, reused across all hook calls.
// 2026-10-14: a failed fetch (offline start, weak signal) used to be cached as {} for the WHOLE session — the wallet
// disappeared and co-op users got "coming soon" until a full reload. Now the last good settings are kept on the device
// and used meanwhile, and a failed fetch is retried (when the connection returns, and every 20 s) until it succeeds.
const SAVED_KEY = "kt_platform_config";
let _cache = null;
let _fresh = false;
let _pending = null;
const _listeners = new Set();

function readSaved() {
  try { const v = JSON.parse(localStorage.getItem(SAVED_KEY) || "null"); return v && typeof v === "object" ? v : null; } catch { return null; }
}

function fetchConfig() {
  if (_pending) return _pending;
  _pending = Promise.resolve(supabase.from("platform_config").select("key, value"))
    .then(({ data, error }) => {
      if (error || !Array.isArray(data)) throw error || new Error("no config");
      const cfg = {};
      data.forEach(r => { cfg[r.key] = r.value; });
      _cache = cfg; _fresh = true;
      try { localStorage.setItem(SAVED_KEY, JSON.stringify(cfg)); } catch { /* storage full — still fine for this session */ }
      _listeners.forEach((fn) => fn(cfg));
      return cfg;
    })
    .catch(() => {
      _pending = null;                       // allow a retry
      if (!_cache) _cache = readSaved() || {};
      scheduleRetry();
      return _cache;
    });
  return _pending;
}

let _retryTimer = null;
function scheduleRetry() {
  if (_retryTimer || _fresh) return;
  const again = () => { _retryTimer = null; if (!_fresh) fetchConfig(); };
  _retryTimer = setTimeout(again, 20000);
  if (typeof window !== "undefined") window.addEventListener("online", () => { clearTimeout(_retryTimer); again(); }, { once: true });
}

export function usePlatformConfig() {
  const [config, setConfig] = useState(() => _cache || readSaved());
  const [loading, setLoading] = useState(() => !(_cache || readSaved()));

  useEffect(() => {
    const onFresh = (cfg) => { setConfig(cfg); setLoading(false); };
    _listeners.add(onFresh);
    if (_fresh) { setConfig(_cache); setLoading(false); }
    else fetchConfig().then(cfg => { setConfig(cfg); setLoading(false); });
    return () => { _listeners.delete(onFresh); };
  }, []);

  let ckDiscounts = null;
  try { ckDiscounts = config?.ck_discounts ? JSON.parse(config.ck_discounts) : null; } catch { ckDiscounts = null; }

  return {
    coopEnabled: config?.coop_module_enabled === "true",
    // Invite & Earn (referral rewards) — null when platform_config.referral_enabled is not "true"; amounts come from the same table.
    inviteCfg: inviteConfigFromPlatform(config),
    ckDiscounts,                                            // { airtime:{NET:pct}, epin:{NET:pct}, epin_live:{}, ... }
    enterpriseFeePct: Number(config?.enterprise_bill_fee_pct ?? "0.01") || 0.01,
    walletEnabled: config?.wallet_enabled === "true",
    // Business loans are offered through a third-party lender that is not live yet. Off ("coming soon", no application form) until
    // platform_config.business_loan_enabled = "true" — flipping it on needs no app rebuild.
    loansEnabled: config?.business_loan_enabled === "true",
    // Print Airtime price per PIN (network -> face value -> naira) and the Bundle Set switch — both set in platform_config (see migration 20270216000000).
    printAirtimePrices: (() => { try { const o = config?.print_airtime_prices ? JSON.parse(config.print_airtime_prices) : null; return o && typeof o === "object" ? o : null; } catch { return null; } })(),
    bundleSetEnabled: config?.bundle_set_enabled === "true",         // paused until the owner turns it back on
    // Bill services the admin switched off (admin portal → Bill Prices & Services): their tiles show PAUSED. The server refuses
    // them too (before anyone is charged), so an old build can't sell one either.
    billServicesOff: new Set(String(config?.bill_services_off ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)),
    // Betting Wallet tile: on for the web, off in the Android app (Google Play gambling rules) until platform_config.android_betting_enabled = "true".
    bettingVisible: bettingVisible(config),
    walletTestMode: config?.wallet_test_mode !== "false",   // default on until explicitly disabled
    // Off until Flutterwave confirms BVN Verification is enabled on this merchant
    // account — flipping this on is the only thing needed to re-enable both the
    // backend enforcement (flutterwave/index.ts) and the reverify banners.
    bvnVerificationEnabled: config?.bvn_verification_enabled === "true",
    // Identity checks for BVN / NIN through Youverify. Off (the default) = self-declared, as before; on shows the consent box wherever an ID is typed
    // and the server verifies it. A super admin toggles platform_config.kyc_youverify_enabled in the admin portal — no rebuild.
    kycEnabled: config?.kyc_youverify_enabled === "true",
    // A live selfie, compared against the BVN/NIN's own file photo, on top of the name match. Off (the default) even when kycEnabled is on.
    kycSelfieRequired: config?.kyc_selfie_required === "true",
    // The "Charge fee" on every wallet-to-wallet payment (savings payments, circle contributions, payouts) — shown before
    // the PIN; the server takes it (wallet_transfer_fee_kobo). 0 = no fee.
    walletMoveFeeKobo: Number(config?.wallet_move_fee_kobo ?? "1000") || 0,
    // 7.5% VAT on our wallet fees (2026-10-23), in basis points; 0 when platform_config.wallet_vat_enabled isn't "true".
    // The server takes it as its own line (trigger trg_wallet_charge_vat_on_fee) — the app only shows it before the PIN.
    walletVatBp: config?.wallet_vat_enabled === "true" ? (Number(config?.wallet_vat_rate_bp ?? "750") || 0) : 0,
    walletMinTopupKobo: Number(config?.wallet_min_topup_kobo ?? "10000") || 10000,
    walletMaxWithdrawalKobo: Number(config?.wallet_max_withdrawal_kobo ?? "5000000") || 5000000,
    // Mirrors the server-side cap already enforced in wallet_hold_transfer
    // (SUM of today's withdrawals) — this value is display-only, the RPC
    // remains the sole authority on whether a transfer is actually allowed.
    walletDailyWithdrawalCapKobo: Number(config?.wallet_daily_withdrawal_cap_kobo ?? "10000000") || 10000000,
    // A bank transfer at or above this asks for a quick security selfie first (evidence only — see securitySelfie.js;
    // it never blocks the transfer on a match, there's nothing to match it against). 0 turns the check off.
    largeTransferSelfieThresholdKobo: Number(config?.large_transfer_selfie_threshold_kobo ?? "10000000") || 0,
    // Master switch for the security selfies (PIN reset, large transfer, new-device sign-in). Off unless
    // platform_config.security_selfie_enabled = "true" — paused by the owner; turning it back on needs no rebuild.
    securitySelfieEnabled: config?.security_selfie_enabled === "true",
    configLoading: loading,
  };
}
