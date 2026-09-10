import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";

// Digital-wallet state for a business owner.
// - reads `wallets` + recent `wallet_ledger` via RLS (owner sees own only)
// - live-syncs balance + new ledger rows over realtime
// - `provisionAccount()` / `simulateTopup()` / `refresh()` call the edge function
//
// All amounts are kobo. balanceNaira is provided for convenience.
export function useWallet(userId, enabled = true) {
  const [wallet, setWallet]   = useState(null);
  const [ledger, setLedger]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const loadRef = useRef(() => {});
  const active = !!userId && enabled;

  const load = useCallback(async () => {
    if (!active) { setWallet(null); setLedger([]); setLoading(false); return; }
    try {
      const [{ data: w }, { data: l }] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("wallet_ledger").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(50),
      ]);
      setWallet(w || null);
      setLedger(l || []);
    } catch {
      /* leave prior state */
    } finally {
      setLoading(false);
    }
  }, [active, userId]);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  // ── realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const channel = supabase.channel(`wallet_rt_${userId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` },
        (p) => { if (p.new) setWallet((prev) => ({ ...prev, ...p.new })); })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "wallet_ledger", filter: `user_id=eq.${userId}` },
        (p) => {
          if (!p.new) return;
          setLedger((prev) => (prev.some((r) => r.id === p.new.id) ? prev : [p.new, ...prev].slice(0, 50)));
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "wallet_ledger", filter: `user_id=eq.${userId}` },
        (p) => { if (p.new) setLedger((prev) => prev.map((r) => (r.id === p.new.id ? { ...r, ...p.new } : r))); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [active, userId]);

  const invoke = useCallback(async (action, extra = {}) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("flutterwave", { body: { action, ...extra } });
      if (error) throw new Error(error.message || "Wallet request failed");
      if (data?.error) throw new Error(data.error);
      return data;
    } finally {
      setBusy(false);
      // give the webhook / RPC a beat, then refresh from source of truth
      setTimeout(() => loadRef.current(), 1200);
    }
  }, []);

  const provisionAccount = useCallback(() => invoke("provision-account"), [invoke]);
  const simulateTopup    = useCallback((amount_naira = 2000) => invoke("simulate-topup", { amount_naira }), [invoke]);
  const listBanks        = useCallback(() => invoke("list-banks"), [invoke]);
  const resolveAccount   = useCallback((bank_code, account_number) => invoke("resolve-account", { bank_code, account_number }), [invoke]);
  const submitWithdrawal = useCallback((amount_kobo, bank_code, account_number) =>
    invoke("submit-withdrawal", { amount_kobo, bank_code, account_number }), [invoke]);

  const balanceKobo = Number(wallet?.balance_kobo || 0);

  return {
    wallet, ledger, loading, busy,
    hasAccount: !!(wallet?.flw_virtual_account_id && wallet?.flw_account_number),
    balanceKobo,
    balanceNaira: balanceKobo / 100,
    refresh: load,
    provisionAccount, simulateTopup, listBanks, resolveAccount, submitWithdrawal,
  };
}
