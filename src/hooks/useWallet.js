import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../utils/supabase";
import { buildWalletReceipt } from "../utils/receiptConfig";

// Lightweight read-only edge call — no busy toggle, no post-refresh (used for
// bank list + account name lookup, which must not churn the consuming screen).
async function fwRead(action, extra = {}) {
  const { data, error } = await supabase.functions.invoke("flutterwave", { body: { action, ...extra } });
  if (error) {
    let msg = error.message || "Wallet request failed";
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Digital-wallet state for a business owner.
// - reads `wallets` + recent `wallet_ledger` via RLS (owner sees own only)
// - live-syncs balance + new ledger rows over realtime
// - `provisionAccount()` / `simulateTopup()` / `refresh()` call the edge function
//
// All amounts are kobo. balanceNaira is provided for convenience.
export function useWallet(userId, enabled = true) {
  const [wallet, setWallet]     = useState(null);
  const [ledger, setLedger]     = useState([]);
  const [withdrawals, setWd]    = useState([]);      // wallet_withdrawals (for receipts)
  const [requests, setRequests] = useState([]);      // wallet_payment_requests (all)
  const [banks, setBanks]       = useState([]);      // bank code → name (for receipts)
  const [payRequest, setPayReq] = useState(null);   // active pending "receive payment" request
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const loadRef = useRef(() => {});
  const loadedOnceRef = useRef(false);
  const active = !!userId && enabled;

  const load = useCallback(async () => {
    // Feature genuinely off → settle empty.
    if (!enabled) { setWallet(null); setLedger([]); setPayReq(null); setLoading(false); loadedOnceRef.current = false; return; }
    // Enabled but the session hasn't hydrated yet (e.g. right after a refresh) —
    // stay in the loading state, don't flash the "activate wallet" screen.
    if (!userId) { setLoading(!loadedOnceRef.current); return; }
    try {
      const [{ data: w }, { data: l }, { data: wd }, { data: rq }] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("wallet_ledger").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("wallet_withdrawals").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("wallet_payment_requests").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(50),
      ]);
      setWallet(w || null);
      setLedger(l || []);
      setWd(wd || []);
      setRequests(rq || []);
      const pr = (rq || []).find((r) => r.status === "pending" && new Date(r.expires_at) > new Date());
      setPayReq(pr || null);
      loadedOnceRef.current = true;
    } catch {
      /* leave prior state */
    } finally {
      setLoading(false);
    }
  }, [enabled, userId]);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { if (!loadedOnceRef.current) setLoading(true); load(); }, [load]);

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
      .on("postgres_changes",
        { event: "*", schema: "public", table: "wallet_withdrawals", filter: `user_id=eq.${userId}` },
        (p) => {
          const row = p.new;
          if (!row) return;
          setWd((prev) => (prev.some((r) => r.id === row.id)
            ? prev.map((r) => (r.id === row.id ? { ...r, ...row } : r))
            : [row, ...prev].slice(0, 50)));
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "wallet_payment_requests", filter: `user_id=eq.${userId}` },
        (p) => {
          const row = p.new;
          if (!row) return;
          setRequests((prev) => (prev.some((r) => r.id === row.id)
            ? prev.map((r) => (r.id === row.id ? { ...r, ...row } : r))
            : [row, ...prev].slice(0, 50)));
          setPayReq((prev) => {
            if (row.status === "pending") return row;
            // resolved/cancelled → clear if it's the one we're showing
            return prev && prev.id === row.id ? null : prev;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [active, userId]);

  // Bank list — loaded once when there's an account (code → name, for receipts).
  const hasAcct = !!(wallet?.flw_virtual_account_id && wallet?.flw_account_number);
  useEffect(() => {
    if (!active || !hasAcct || banks.length) return;
    let cancelled = false;
    fwRead("list-banks").then((d) => { if (!cancelled) setBanks(d?.banks || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [active, hasAcct, banks.length]);

  const invoke = useCallback(async (action, extra = {}) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("flutterwave", { body: { action, ...extra } });
      if (error) {
        // Non-2xx: pull the real message out of the response body when we can
        let msg = error.message || "Wallet request failed";
        try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data;
    } finally {
      setBusy(false);
      // give the webhook / RPC a beat, then refresh from source of truth
      setTimeout(() => loadRef.current(), 1200);
    }
  }, []);

  const provisionAccount = useCallback((bvn = "", nin = "") => invoke("provision-account", { bvn, nin }), [invoke]);
  const simulateTopup    = useCallback((amount_naira = 2000) => invoke("simulate-topup", { amount_naira }), [invoke]);
  const listBanks        = useCallback(() => fwRead("list-banks"), []);
  const resolveAccount   = useCallback((bank_code, account_number) => fwRead("resolve-account", { bank_code, account_number }), []);
  // Instant transfer, confirmed with the transaction PIN. Holds funds + pays out.
  const transfer = useCallback((amount_kobo, bank_code, account_number, pin, narration = "", book_expense = false, confirmed_name = "") =>
    invoke("transfer", { amount_kobo, bank_code, account_number, pin, narration, book_expense, confirmed_name }), [invoke]);

  const createPaymentRequest = useCallback(async (amountKobo, customerName = "", note = "") => {
    const { data, error } = await supabase.rpc("wallet_create_payment_request", {
      p_amount_kobo: Math.round(amountKobo), p_customer_name: customerName, p_note: note,
    });
    if (error) throw new Error(error.message.replace(/^.*:\s*/, ""));
    setTimeout(() => loadRef.current(), 400);
    return data;
  }, []);

  const cancelPaymentRequest = useCallback(async (id) => {
    await supabase.rpc("wallet_cancel_payment_request", { p_request_id: id });
    setPayReq(null);
    setTimeout(() => loadRef.current(), 400);
  }, []);

  const balanceKobo = Number(wallet?.balance_kobo || 0);
  const hasAccount = !!(wallet?.flw_virtual_account_id && wallet?.flw_account_number);

  // Full receipt data for a ledger row — joins the matching withdrawal / payment
  // request and resolves the recipient bank name, ready for <TransactionDetailModal>.
  const receiptFor = useCallback((row, businessName = "", ownerName = "") => {
    if (!row) return null;
    const isTransfer = row.source === "withdrawal" || row.source === "withdrawal_reversal";
    const wd = isTransfer ? withdrawals.find((x) => x.ledger_id === row.id) || null : null;
    const rq = row.source === "sale"
      ? requests.find((x) => x.ledger_id === row.id || x.txn_id === row.related_txn_id) || null
      : null;
    const recipientBankName = wd?.bank_code
      ? (banks.find((b) => String(b.code) === String(wd.bank_code))?.name || "")
      : "";
    return buildWalletReceipt(row, {
      businessName,
      ownerName,
      walletAccountNumber: wallet?.flw_account_number || "",
      withdrawal:          wd,
      request:             rq,
      originator:          row.meta?.originator || "",
      recipientBankName,
    });
  }, [withdrawals, requests, banks, wallet]);

  // Stable object identity — only changes when real data does, so screens/modals
  // that read the hook don't re-render (and re-run effects) on every tick.
  return useMemo(() => ({
    wallet, ledger, withdrawals, requests, banks, payRequest, loading, busy,
    hasAccount, balanceKobo, balanceNaira: balanceKobo / 100,
    refresh: load, receiptFor,
    provisionAccount, simulateTopup, listBanks, resolveAccount, transfer,
    createPaymentRequest, cancelPaymentRequest,
  }), [
    wallet, ledger, withdrawals, requests, banks, payRequest, loading, busy, hasAccount, balanceKobo,
    load, receiptFor, provisionAccount, simulateTopup, listBanks, resolveAccount, transfer,
    createPaymentRequest, cancelPaymentRequest,
  ]);
}
