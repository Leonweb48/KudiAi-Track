import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabase";
import { walletAccountState } from "../utils/walletAccount";

// Decides whether this signed-in user must stop and get a NEW wallet account number before using the app: their wallet still
// has a number on the old Flutterwave account while the platform has moved to the new one (see utils/walletAccount.js).
//
// Deliberately lightweight — one wallets row + two config reads, NO realtime channel (App.jsx is always mounted and every
// wallet screen already runs its own useWallet). It re-checks when the app comes back to the foreground, so an app that was
// left open across the switch is stopped on its next use.
//
// It fails OPEN: if the lookup errors or never answers (offline, slow), nobody is blocked. `flw_force_migration = 'false'`
// in platform_config turns the forcing off without touching payouts (the state cards on the wallet screens stay).
const CFG_KEYS = ["flw_active_account", "flw_legacy_grace_until", "flw_force_migration"];
const CHECK_TIMEOUT_MS = 4000;

export function useWalletMigrationGate(userId, enabled) {
  const [row, setRow] = useState(null);
  const [cfg, setCfg] = useState({ active: "", graceUntil: "", force: true });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState(false);   // the move just went through — keep the confirmation up until they tap Done
  const [snoozed, setSnoozed] = useState(false);   // "continue for now" after a failed attempt — until the app is next opened

  const load = useCallback(async () => {
    if (!userId || !enabled) return;
    try {
      const [{ data: w }, { data: pc }] = await Promise.all([
        supabase.from("wallets").select("flw_account, flw_account_number, flw_virtual_account_id").eq("user_id", userId).maybeSingle(),
        supabase.from("platform_config").select("key, value").in("key", CFG_KEYS),
      ]);
      setRow(w || null);
      if (Array.isArray(pc)) {
        const v = (k) => pc.find((r) => r.key === k)?.value || "";
        setCfg({ active: v("flw_active_account"), graceUntil: v("flw_legacy_grace_until"), force: v("flw_force_migration") !== "false" });
      }
    } catch { /* fail open */ } finally { setChecked(true); }
  }, [userId, enabled]);

  useEffect(() => { setChecked(false); setRow(null); load(); }, [load]);

  // never leave the app waiting on this check
  useEffect(() => {
    if (!enabled || checked) return undefined;
    const t = setTimeout(() => setChecked(true), CHECK_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [enabled, checked]);

  // back to the foreground (app resume / tab focus) → look again
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled, userId, load]);

  const hasAccount = !!(row?.flw_virtual_account_id && row?.flw_account_number);
  const acct = useMemo(() => walletAccountState({
    hasAccount, walletAccount: row?.flw_account, activeAccount: cfg.active, graceUntil: cfg.graceUntil,
  }), [hasAccount, row?.flw_account, cfg.active, cfg.graceUntil]);

  const migrateAccount = useCallback(async (bvn = "", nin = "") => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("flutterwave", { body: { action: "provision-account", bvn, nin, migrate: true } });
      if (error) {
        let msg = error.message || "Could not get your new number. Please try again.";
        try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      if (data?.migrated === true) setHolding(true);
      // Not awaited: the caller shows its "here is your new number" confirmation first; the refresh (which flips the state
      // to `active`) lands afterwards, and `holding` keeps the screen up until they tap Done.
      load();
      return data;
    } finally {
      setBusy(false);
    }
  }, [load]);

  const skip = useCallback(() => setSnoozed(true), []);
  const release = useCallback(() => setHolding(false), []);

  const mustMove = acct.state === "migrate" || acct.state === "retired";
  return useMemo(() => ({
    checking: !!enabled && !checked,
    blocking: !!enabled && checked && cfg.force && mustMove && !snoozed,
    holding,
    accountState: acct.state, graceUntilMs: acct.graceUntilMs, graceDaysLeft: acct.daysLeft,
    busy, migrateAccount, refresh: load, skip, release,
  }), [enabled, checked, cfg.force, mustMove, snoozed, holding, acct.state, acct.graceUntilMs, acct.daysLeft, busy, migrateAccount, load, skip, release]);
}
