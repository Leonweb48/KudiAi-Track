import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../utils/supabase";
import { buildWalletReceipt } from "../utils/receiptConfig";
import { walletEntry } from "../utils/historyEntries";
import { walletAccountState } from "../utils/walletAccount";
import { TIER_CFG_KEYS, tierLimits, clampTier } from "../utils/walletTier";

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
  const [dailyUsedKobo, setDailyUsedKobo] = useState(0); // today's withdrawals so far — mirrors wallet_hold_transfer's own check
  const [scheduledTransfers, setScheduledTransfers] = useState([]); // standing instructions — separate from ledger/wallet, fetched on demand
  const [bvnVerified, setBvnVerified] = useState(false);
  // Which Flutterwave account the platform is using and the legacy account's grace deadline. Read fresh with every
  // wallet load (NOT via usePlatformConfig, which caches for the whole session): the moment these change decides
  // whether a holder is told to move to a new account number.
  const [flwCfg, setFlwCfg]     = useState({ active: "", graceUntil: "" });
  // The per-tier limits (platform_config wallet_tier*_kobo), read fresh with every load like the account config above.
  const [tierCfg, setTierCfg]   = useState({});
  const [loading, setLoading]   = useState(true);
  // True only once a real wallet load has SUCCEEDED for an enabled feature.
  // `loading` can't answer "do we actually know whether this user has a
  // wallet yet?": it starts true, but flips false while the platform flag is
  // still unknown (enabled=false → "settle empty"), and is briefly false again
  // right when the flag turns on, before the query starts. Anything that acts
  // on `hasAccount === false` (e.g. the compliance banner) must wait for this.
  const [resolved, setResolved] = useState(false);
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
      const [{ data: w }, { data: l }, { data: wd }, { data: rq }, { data: pf }, { data: cl }, { data: st }, { data: du }, { data: pc }] = await Promise.all([
        supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("wallet_ledger").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("wallet_withdrawals").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("wallet_payment_requests").select("*").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(50),
        supabase.from("profiles").select("full_name, business_name, bvn_verified").eq("id", userId).maybeSingle(),
        supabase.from("aso_clients").select("bvn_verified").eq("client_user_id", userId).maybeSingle(),
        supabase.from("staff").select("bvn_verified").eq("user_id", userId).maybeSingle(),
        supabase.rpc("wallet_daily_transfer_used", { p_user_id: userId }),
        supabase.from("platform_config").select("key, value").in("key", ["flw_active_account", "flw_legacy_grace_until", ...TIER_CFG_KEYS]),
      ]);
      // A failed read (pc === null) keeps what we knew rather than silently flipping everyone to "active".
      if (Array.isArray(pc)) {
        const pcv = (k) => pc.find((r) => r.key === k)?.value || "";
        setFlwCfg((prev) => {
          const next = { active: pcv("flw_active_account"), graceUntil: pcv("flw_legacy_grace_until") };
          return prev.active === next.active && prev.graceUntil === next.graceUntil ? prev : next;
        });
        setTierCfg((prev) => {
          const next = {};
          TIER_CFG_KEYS.forEach((k) => { const v = pc.find((r) => r.key === k)?.value; if (v !== undefined && v !== null) next[k] = v; });
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      }
      setWallet(w || null);
      setLedger(l || []);
      setWd(wd || []);
      setRequests(rq || []);
      setDailyUsedKobo(Number(du || 0));
      // Same table-selection rule as the server's resolveIdentity() (flutterwave/
      // index.ts): profiles wins unless it has no name at all (the signal that
      // this uid is really an Ajo/Esusu client or staff member, not a business
      // owner) — a plain `pf?.bvn_verified ?? cl?.bvn_verified` would pick
      // profiles' (irrelevant, default-false) value for anyone who happens to
      // also have a profiles row. Staff/managers never get a profiles row at
      // all (no signup trigger creates one for admin-API-created staff auth
      // users), so cl-then-st is unambiguous — no case where both could apply.
      const pfHasName = !!((pf?.full_name || pf?.business_name || "").trim());
      setBvnVerified(!!(pfHasName ? pf?.bvn_verified : (cl?.bvn_verified ?? st?.bvn_verified ?? pf?.bvn_verified ?? false)));
      const pr = (rq || []).find((r) => r.status === "pending" && new Date(r.expires_at) > new Date());
      setPayReq(pr || null);
      loadedOnceRef.current = true;
      setResolved(true);
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
          // Keep the "left today" hint live without a full reload — a freshly
          // held transfer lands as source='withdrawal' status='pending', which
          // wallet_daily_transfer_used already counts.
          if (p.new.source === "withdrawal") {
            setDailyUsedKobo((prev) => prev + (Number(p.new.amount_kobo) || 0));
          }
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
  // Move a wallet that still has an OLD (legacy-account) number onto the business account. The old number is kept
  // by the server and keeps crediting this wallet until the grace deadline.
  const migrateAccount   = useCallback((bvn = "", nin = "") => invoke("provision-account", { bvn, nin, migrate: true }), [invoke]);
  const simulateTopup    = useCallback((amount_naira = 2000) => invoke("simulate-topup", { amount_naira }), [invoke]);
  const listBanks        = useCallback(() => fwRead("list-banks"), []);
  const resolveAccount   = useCallback((bank_code, account_number) => fwRead("resolve-account", { bank_code, account_number }), []);
  // Instant transfer, confirmed with the transaction PIN. Holds funds + pays out.
  const transfer = useCallback((amount_kobo, bank_code, account_number, pin, narration = "", book_expense = false, confirmed_name = "") =>
    invoke("transfer", { amount_kobo, bank_code, account_number, pin, narration, book_expense, confirmed_name }), [invoke]);

  // Standing instruction — PIN confirms it ONCE at creation; every future run
  // is unattended and re-checks balance/caps fresh server-side (see the edge
  // function's own comment). Doesn't move money immediately, so it doesn't
  // use invoke()'s post-action wallet reload — only refreshes its own list.
  const refreshScheduled = useCallback(async () => {
    if (!active) return;
    const d = await fwRead("list-scheduled-transfers").catch(() => null);
    if (d?.scheduled) setScheduledTransfers(d.scheduled);
  }, [active]);

  useEffect(() => { refreshScheduled(); }, [refreshScheduled]);

  const scheduleTransfer = useCallback(async (amount_kobo, bank_code, account_number, pin, frequency, narration = "", book_expense = false, confirmed_name = "", start_at = null) => {
    setBusy(true);
    try {
      const d = await fwRead("schedule-transfer", { amount_kobo, bank_code, account_number, pin, frequency, narration, book_expense, confirmed_name, start_at });
      await refreshScheduled();
      return d;
    } finally {
      setBusy(false);
    }
  }, [refreshScheduled]);

  const setScheduledTransferStatus = useCallback(async (scheduled_transfer_id, status) => {
    await fwRead("set-scheduled-transfer-status", { scheduled_transfer_id, status });
    await refreshScheduled();
  }, [refreshScheduled]);

  // Real BVN identity verification (Flutterwave v3 consent/OTP flow). Only
  // enforced server-side (and only offered in the UI) while platform_config's
  // bvn_verification_enabled is 'true' — currently off, since Flutterwave has
  // BVN Verification disabled on this merchant account. redirect_url lets
  // native pass its custom-scheme callback.
  const startBvnVerification = useCallback((bvn, redirect_url) => invoke("verify-bvn-init", { bvn, redirect_url }), [invoke]);
  // fwRead, not invoke — this gets polled up to 5x by useBvnVerification while
  // waiting for consent to complete; invoke's busy-toggle would flicker the
  // "Activate wallet" button and queue a redundant full wallet reload per poll.
  const checkBvnVerification = useCallback(() => fwRead("verify-bvn-status"), []);

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

  // none | active | migrate | retired — see utils/walletAccount.js. Only `retired` changes what the wallet can do
  // (its number stops receiving deposits); the wallet itself — balance, transfers, bills — keeps working in every state.
  const acct = useMemo(() => walletAccountState({
    hasAccount, walletAccount: wallet?.flw_account, activeAccount: flwCfg.active, graceUntil: flwCfg.graceUntil,
  }), [hasAccount, wallet?.flw_account, flwCfg.active, flwCfg.graceUntil]);
  // The row every screen reads, carrying the derived state so components handed only `wallet` (account card, fund /
  // receive sheets) can tell a dead number from a live one without their own hook.
  const walletView = useMemo(() => (wallet ? { ...wallet, account_state: acct.state } : wallet), [wallet, acct.state]);

  // The holder's tier (1 for everyone until they upgrade) and what it allows — the server enforces these; this is for display
  // and for the transfer sheet's own pre-checks.
  const tier = clampTier(wallet?.tier);
  const limits = useMemo(() => tierLimits(tier, tierCfg), [tier, tierCfg]);

  // What a ledger row is joined with — the matching withdrawal / payment request, the recipient bank's name (from its code) and who
  // paid in (and from which bank). The receipt and the history row are both built from this, so they always agree.
  const contextFor = useCallback((row) => {
    const isTransfer = row.source === "withdrawal" || row.source === "withdrawal_reversal";
    const wd = isTransfer ? withdrawals.find((x) => x.ledger_id === row.id) || null : null;
    const rq = row.source === "sale"
      ? requests.find((x) => x.ledger_id === row.id || x.txn_id === row.related_txn_id) || null
      : null;
    const recipientBankName = wd?.bank_code
      ? (banks.find((b) => String(b.code) === String(wd.bank_code))?.name || "")
      : "";
    return {
      withdrawal:     wd,
      request:        rq,
      originator:     row.meta?.originator || "",
      originatorBank: row.meta?.originator_bank || "",
      recipientBankName,
    };
  }, [withdrawals, requests, banks]);

  // Full receipt data for a ledger row, ready for <TransactionDetailModal>.
  const receiptFor = useCallback((row, businessName = "", ownerName = "", biz = null) => {
    if (!row) return null;
    return buildWalletReceipt(row, {
      businessName,
      ownerName,
      walletAccountNumber: wallet?.flw_account_number || "",
      ...contextFor(row),
      businessAddress:     biz?.address || "",
      businessPhone:       biz?.phone || "",
    });
  }, [contextFor, wallet]);

  // The row's history entry: "Transfer to NAME", the bank's logo, the status pill (see utils/historyEntries.js).
  const entryFor = useCallback((row) => (row ? walletEntry(row, contextFor(row)) : null), [contextFor]);

  // Stable object identity — only changes when real data does, so screens/modals
  // that read the hook don't re-render (and re-run effects) on every tick.
  return useMemo(() => ({
    wallet: walletView, ledger, withdrawals, requests, banks, payRequest, loading, resolved, busy,
    hasAccount, bvnVerified, balanceKobo, balanceNaira: balanceKobo / 100, dailyUsedKobo,
    accountState: acct.state, graceUntilMs: acct.graceUntilMs, graceDaysLeft: acct.daysLeft,
    tier, limits,
    scheduledTransfers, refreshScheduled, scheduleTransfer, setScheduledTransferStatus,
    refresh: load, receiptFor, entryFor,
    provisionAccount, migrateAccount, simulateTopup, listBanks, resolveAccount, transfer,
    startBvnVerification, checkBvnVerification,
    createPaymentRequest, cancelPaymentRequest,
  }), [
    walletView, ledger, withdrawals, requests, banks, payRequest, loading, resolved, busy, hasAccount, bvnVerified, balanceKobo, dailyUsedKobo,
    acct.state, acct.graceUntilMs, acct.daysLeft, tier, limits,
    scheduledTransfers, refreshScheduled, scheduleTransfer, setScheduledTransferStatus,
    load, receiptFor, entryFor, provisionAccount, migrateAccount, simulateTopup, listBanks, resolveAccount, transfer,
    startBvnVerification, checkBvnVerification,
    createPaymentRequest, cancelPaymentRequest,
  ]);
}
