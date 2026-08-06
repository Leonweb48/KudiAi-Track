import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { uid, today, isBillPayment } from "../utils/helpers";
import { logAudit } from "../utils/auditLog";
import { sendEmailTrigger } from "../utils/emailTrigger";
import { computeCapital } from "../lib/profitEngine";
import { notify, notifyBranchManager } from "../lib/notifyEngine";
import { savePendingOp, getPendingCount } from "../utils/offlineDb";
import { syncPending } from "../utils/syncManager";

const fireEmailTrigger = sendEmailTrigger;

// ── localStorage cache ─────────────────────────────────────────────
function saveCacheLS(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /**/ }
}
function loadCacheLS(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

export function useStore(userId, staffId = null, staffName = null, branchId = null, role = null) {
  const [transactions, setTransactions] = useState([]);
  const [credits,      setCredits]      = useState([]);
  const [asoClients,   setAsoClients]   = useState([]);
  const [debtPayments, setDebtPayments] = useState([]);
  const [profile,      setProfileState] = useState({
    business_name: "", owner_name: "", email: "",
    gender: "", date_of_birth: "", nin: "",
    phone: "", address: "", state: "", lga: "", ward: "",
    currency: "Nigerian Naira (₦)",
    dark_mode: localStorage.getItem("kuditrack_dark") === "1",
    profile_image_url: null, store_image_url: null,
  });
  const [staffMap,    setStaffMap]    = useState({});
  const [staffList,   setStaffList]   = useState([]);
  const [branchList,  setBranchList]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [isOnline,    setIsOnline]    = useState(navigator.onLine);
  const [dbError,     setDbError]     = useState(null);
  const [loadError,   setLoadError]   = useState(null);
  const [fromCache,   setFromCache]   = useState(false);
  const [rtConnected, setRtConnected] = useState(false);
  const [syncing,      setSyncing]     = useState(false);
  const [syncResult,   setSyncResult]  = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState(() => {
    const v = localStorage.getItem(`kt_last_sync_${userId || ""}`);
    return v ? parseInt(v, 10) : null;
  });

  const authEmailRef    = useRef("");
  const pendingRepayRef = useRef(new Set()); // credit IDs with an in-flight repayment call
  const wasOfflineRef   = useRef(!navigator.onLine);
  const loadDataRef     = useRef(null);

  // ── Load all data ──────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    if (!userId) return;
    if (!silent) { setLoading(true); setLoadError(null); setFromCache(false); }

    // ── Offline: serve from local cache ───────────────────────
    if (!navigator.onLine) {
      const cached = loadCacheLS(`kt_store_${userId}${staffId ? `_${staffId}` : ""}`);
      if (cached) {
        if (cached.transactions) setTransactions(cached.transactions);
        if (cached.credits)      setCredits(cached.credits);
        if (cached.asoClients)   setAsoClients(cached.asoClients);
        if (cached.profile) {
          const dk = cached.profile.dark_mode ?? (localStorage.getItem("kuditrack_dark") === "1");
          setProfileState(prev => ({
            ...prev,
            business_name: cached.profile.business_name || prev.business_name,
            dark_mode: dk,
          }));
        }
        setFromCache(true);
      } else {
        // Offline and no cache — nothing to show; surface the error banner
        setLoadError("Couldn't load your data — check your connection");
      }
      setLoading(false);
      return;
    }

    // ── Online: fetch from Supabase ───────────────────────────
    let txQ  = supabase.from("transactions").select("*").eq("user_id", userId);
    let crQ  = supabase.from("credits").select("*").eq("user_id", userId);
    let asoQ = supabase.from("aso_clients").select("*").eq("user_id", userId).eq("portal_active", true);
    let dpQ  = supabase.from("debt_payments").select("*").eq("owner_id", userId);
    if (staffId) {
      if (role === "manager" && branchId) {
        // Manager: all records for their branch (RLS enforces the same on the server)
        txQ  = txQ.eq("branch_id", branchId);
        crQ  = crQ.eq("branch_id", branchId);
        asoQ = asoQ.eq("branch_id", branchId);
        dpQ  = dpQ.eq("staff_id",  staffId);
      } else {
        // Regular staff: own records only — never the whole branch
        txQ  = txQ.eq("staff_id",  staffId);
        crQ  = crQ.eq("staff_id",  staffId);
        asoQ = asoQ.eq("staff_id", staffId);
        dpQ  = dpQ.eq("staff_id",  staffId);
      }
    } else if (branchId) {
      txQ  = txQ.eq("branch_id", branchId);
      crQ  = crQ.eq("branch_id", branchId);
      asoQ = asoQ.eq("branch_id", branchId);
    }

    try {
    const [txRes, crRes, asoRes, profRes, staffRes, sessRes, dpRes, brRes] = await Promise.all([
      txQ.order("created_at",  { ascending: false }),
      crQ.order("created_at",  { ascending: false }),
      asoQ.order("created_at", { ascending: false }),
      supabase.from("profiles")
        .select(staffId
          ? "id, business_name, full_name, email, currency, dark_mode, profile_image_url, store_image_url"
          : "*")
        .eq("id", userId).maybeSingle(),
      !staffId
        ? supabase.from("staff").select("id, full_name, branch_id, role").eq("owner_id", userId)
        : Promise.resolve({ data: null }),
      supabase.auth.getSession(),
      dpQ.order("created_at", { ascending: false }),
      !staffId
        ? supabase.from("branches").select("id, name").eq("owner_id", userId).order("name")
        : Promise.resolve({ data: [] }),
    ]);
    authEmailRef.current = sessRes?.data?.session?.user?.email || "";

    if (txRes.data)  setTransactions(txRes.data);
    if (crRes.data)  setCredits(crRes.data);
    if (asoRes.data) setAsoClients(asoRes.data);
    if (dpRes.data)  setDebtPayments(dpRes.data);

    // One daily overdue digest to the owner listing ALL overdue clients (owner session only)
    if (!staffId && asoRes.data?.length) {
      const todayStr  = today();
      const digestKey = `kt_ajo_overdue_digest_${userId}_${todayStr}`;
      if (!localStorage.getItem(digestKey)) {
        const overdueCls = asoRes.data.filter(cl =>
          cl.next_contribution_date &&
          cl.next_contribution_date < todayStr &&
          !["paid", "cancelled", "completed"].includes(cl.status)
        );
        if (overdueCls.length > 0) {
          localStorage.setItem(digestKey, "1");
          const bizName = profRes.data?.business_name || "";
          fireEmailTrigger("ajo_overdue_digest", {
            owner_id:        userId,
            owner_email:     authEmailRef.current,
            business_name:   bizName,
            overdue_count:   overdueCls.length,
            overdue_clients: overdueCls.map(cl => ({
              client_name:            cl.full_name             || "",
              next_contribution_date: cl.next_contribution_date,
              contribution_amount:    cl.contribution_amount   || 0,
              contribution_frequency: cl.contribution_frequency || "",
              current_balance:        cl.current_balance       || 0,
              group_name:             cl.group_name            || "",
              days_overdue: Math.max(0, Math.floor(
                (new Date(todayStr).getTime() - new Date(cl.next_contribution_date).getTime()) / 86400000
              )),
            })),
          });
        }
      }
    }

    // Weekly unnamed-sales nudge — owner only, fires at most once per calendar week.
    // Counts "in" sales with no item_name in the last 7 days; if ≥5, sends a prompt
    // email so the owner knows profit tracking is incomplete for those records.
    if (!staffId && txRes.data) {
      const sevenAgo = new Date();
      sevenAgo.setDate(sevenAgo.getDate() - 6);
      sevenAgo.setHours(0, 0, 0, 0);
      const unnamedCount = txRes.data.filter(t => {
        const d = t.transaction_date
          ? new Date(t.transaction_date + "T00:00:00")
          : new Date(t.created_at);
        return (
          t.type === "in" &&
          (t.category === "sale" || t.category === "credit sale") &&
          (!t.item_name || !t.item_name.trim()) &&
          d >= sevenAgo
        );
      }).length;
      if (unnamedCount >= 5) {
        const mon = new Date();
        mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
        const weekBucket = mon.toISOString().slice(0, 10);
        const nudgeKey = `kt_unnamed_nudge_${userId}_${weekBucket}`;
        if (!localStorage.getItem(nudgeKey)) {
          localStorage.setItem(nudgeKey, "1");
          fireEmailTrigger("weekly_unnamed_sales_nudge", {
            owner_id:      userId,
            owner_email:   authEmailRef.current,
            unnamed_count: unnamedCount,
          });
        }
      }
    }

    // Daily summary email — owner only, fires at most once per calendar day on first load.
    // Sends yesterday's revenue + expense totals; includes costing coverage proxy so the
    // admin email template knows whether to show a profit line (≥50%) or a "set cost prices" CTA.
    // Also includes capital status line if the feature is set on the owner's profile.
    if (!staffId && txRes.data) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const summaryKey = `kt_daily_summary_${userId}_${todayStr}`;
      if (!localStorage.getItem(summaryKey)) {
        localStorage.setItem(summaryKey, "1");
        // Compute yesterday's window
        const yd = new Date();
        yd.setDate(yd.getDate() - 1);
        const ydDate = yd.toISOString().slice(0, 10);
        const ydStart = new Date(ydDate + "T00:00:00");
        const ydEnd   = new Date(ydDate + "T23:59:59.999");
        const dayTxs  = txRes.data.filter(t => {
          const d = t.transaction_date
            ? new Date(t.transaction_date + "T00:00:00")
            : new Date(t.created_at);
          return d >= ydStart && d <= ydEnd;
        });
        if (dayTxs.length > 0) {
          const saleCats = new Set(["sale", "credit sale"]);
          const saleTxs  = dayTxs.filter(t => t.type === "in" && saleCats.has(t.category));
          const totalRev = saleTxs.reduce((s, t) => s + (t.amount || 0), 0);
          const namedRev = saleTxs.filter(t => t.item_name?.trim()).reduce((s, t) => s + (t.amount || 0), 0);
          const expenses = dayTxs.filter(t => t.type === "out" && t.category !== "stock" && !isBillPayment(t))
            .reduce((s, t) => s + (t.amount || 0), 0);
          const coverage  = totalRev > 0 ? namedRev / totalRev : 0;
          const hasProfit = coverage >= 0.5;

          // Capital status for daily summary email (null = feature not set → omit)
          const capitalSettings = profRes.data?.working_capital_amount
            ? { amount_kobo: profRes.data.working_capital_amount, as_of_date: profRes.data.working_capital_as_of || null }
            : null;
          const capitalResult = capitalSettings
            ? computeCapital(
                { transactions: txRes.data, debtPayments: dpRes.data || [], credits: crRes.data || [] },
                capitalSettings
              )
            : null;

          fireEmailTrigger("daily_summary", {
            owner_id:         userId,
            owner_email:      authEmailRef.current,
            period_label:     ydDate,
            revenue:          totalRev,
            expenses,
            has_profit:       hasProfit,
            net_approx:       hasProfit ? totalRev - expenses : null,
            coverage_pct:     Math.round(coverage * 100),
            tx_count:         dayTxs.length,
            capital_status:   capitalResult?.status   || null,
            capital_shortfall: capitalResult?.shortfall ?? null,
          });
        }
      }

      // Capital state-transition notification — fires once per status transition.
      // Deduped by storing last-seen status in localStorage; never fires more than
      // once per transition even if multiple loads occur on the same day.
      if (!staffId && profRes.data?.working_capital_amount) {
        const capitalSettings = {
          amount_kobo: profRes.data.working_capital_amount,
          as_of_date:  profRes.data.working_capital_as_of || null,
        };
        const capitalResult = computeCapital(
          { transactions: txRes.data, debtPayments: dpRes.data || [], credits: crRes.data || [] },
          capitalSettings
        );
        if (capitalResult) {
          const prevStatusKey = `kt_capital_status_${userId}`;
          const prevStatus = localStorage.getItem(prevStatusKey);
          const newStatus  = capitalResult.status;
          if (prevStatus !== null && prevStatus !== newStatus) {
            fireEmailTrigger("capital_status_change", {
              owner_id:       userId,
              owner_email:    authEmailRef.current,
              prev_status:    prevStatus,
              new_status:     newStatus,
              shortfall:      capitalResult.shortfall || 0,
              capital_amount: capitalResult.capital.amount,
            });
          }
          localStorage.setItem(prevStatusKey, newStatus);
        }
      }
    }

    if (staffRes.data) {
      const map  = {};
      const list = [];
      staffRes.data.forEach(s => {
        map[s.id] = s.full_name;
        list.push({ id: s.id, full_name: s.full_name, branch_id: s.branch_id || null });
      });
      setStaffMap(map);
      setStaffList(list);
    }
    if (brRes.data) setBranchList(brRes.data);

    if (profRes.data) {
      const p = profRes.data;
      const darkFromDb = p.dark_mode != null ? p.dark_mode : (localStorage.getItem("kuditrack_dark") === "1");
      if (!silent) localStorage.setItem("kuditrack_dark", darkFromDb ? "1" : "0");
      setProfileState(prev => ({
        id:                p.id                || "",
        business_name:     p.business_name     || "",
        owner_name:        p.full_name         || "",
        email:             p.email             || "",
        gender:            p.gender            || "",
        date_of_birth:     p.date_of_birth     || "",
        nin:               p.nin               || "",
        phone:             p.phone             || "",
        address:           p.address           || "",
        state:             p.state             || "",
        lga:               p.lga               || "",
        ward:              p.ward              || "",
        currency:          p.currency          || "Nigerian Naira (₦)",
        // Silent polls (3-second interval) must not race against a just-toggled preference
        // that may not have committed to DB yet. Preserve current state on silent refresh;
        // only trust DB value on initial load.
        dark_mode:         silent && prev?.dark_mode != null ? prev.dark_mode : darkFromDb,
        profile_image_url: p.profile_image_url
          ? `${p.profile_image_url.split("?")[0]}?v=${Date.now()}`
          : null,
        store_image_url: p.store_image_url
          ? `${p.store_image_url.split("?")[0]}?v=${Date.now()}`
          : null,
        working_capital_amount: p.working_capital_amount ?? null,
        working_capital_as_of:  p.working_capital_as_of  ?? null,
        business_type:                 p.business_type                 || "",
        industry:                      p.industry                      || "",
        business_size:                 p.business_size                 || "",
        products_services_type:        p.products_services_type        || "",
        target_market:                 p.target_market                 || "",
        operating_model:               p.operating_model               || "",
        business_country:              p.business_country              || "",
        business_state:                p.business_state                || "",
        business_lga:                  p.business_lga                  || "",
        business_ward:                 p.business_ward                 || "",
        business_address:              p.business_address              || "",
        business_phone:                p.business_phone                || "",
        business_email:                p.business_email                || "",
        business_category:             p.business_category             || "",
        business_registration_number:  p.business_registration_number  || "",
        country_of_registration:       p.country_of_registration       || "",
        reg_status:                    p.reg_status                    || "",
        reg_doc_type:                  p.reg_doc_type                  || "",
        reg_doc_url:                   p.reg_doc_url                   || "",
      }));
    }

    // Cache up to 300 transactions for offline access
    saveCacheLS(`kt_store_${userId}${staffId ? `_${staffId}` : ""}`, {
      transactions: (txRes.data || []).slice(0, 300),
      credits:    crRes.data  || [],
      asoClients: asoRes.data || [],
      profile: profRes.data
        ? { business_name: profRes.data.business_name, dark_mode: profRes.data.dark_mode }
        : null,
    });
    const now = Date.now();
    setLastSyncTime(now);
    try { localStorage.setItem(`kt_last_sync_${userId}`, String(now)); } catch { }
    setFromCache(false);

    } catch {
      const cached = loadCacheLS(`kt_store_${userId}${staffId ? `_${staffId}` : ""}`);
      if (cached) {
        if (cached.transactions) setTransactions(cached.transactions);
        if (cached.credits)      setCredits(cached.credits);
        if (cached.asoClients)   setAsoClients(cached.asoClients);
        if (cached.profile) {
          const dk = cached.profile.dark_mode ?? (localStorage.getItem("kuditrack_dark") === "1");
          setProfileState(prev => ({
            ...prev,
            business_name: cached.profile.business_name || prev.business_name,
            dark_mode: dk,
          }));
        }
        setFromCache(true);
      } else {
        setLoadError("Couldn't load your data — check your connection");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userId, staffId, branchId, role]);

  useEffect(() => { loadData(); }, [loadData]);

  // Keep loadDataRef current so reconnect handler always calls latest version.
  useEffect(() => { loadDataRef.current = loadData; }, [loadData]);

  // ── Realtime: live sync for aso_clients balance changes ───────────────
  useEffect(() => {
    if (!userId) return;
    let rtReady = false;
    const channel = supabase.channel(`aso_clients_rt_${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "aso_clients", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!payload.new) return;
          const c = payload.new;
          // For staff: only react to updates on clients already in their scoped state.
          // The map() below will no-op for items not in state, so no extra guard needed.
          if (c.portal_active === false) {
            setAsoClients(prev => prev.filter(r => r.id !== c.id));
          } else {
            setAsoClients(prev => prev.map(r => r.id === c.id ? { ...r, ...c } : r));
          }
        })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (rtReady) loadData(true);
          else rtReady = true;
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [userId, staffId, branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: live sync for transactions (staff adds, other devices) ──
  useEffect(() => {
    if (!userId) return;
    let rtReady = false;
    const channel = supabase.channel(`transactions_rt_${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!payload.new) return;
          const t = payload.new;
          // Mirror the scope filter from loadData: manager sees branch, staff sees own only.
          if (staffId) {
            const isMine   = t.staff_id === staffId;
            const isBranch = role === "manager" && branchId && t.branch_id === branchId;
            if (!isMine && !isBranch) return;
          }
          setTransactions(prev => {
            if (prev.some(r => r.id === t.id || (t.client_txn_id && r.client_txn_id === t.client_txn_id))) return prev;
            return [t, ...prev];
          });
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!payload.new) return;
          // UPDATE: only mutates items already in state — safe without extra filter
          setTransactions(prev => prev.map(t => t.id === payload.new.id ? { ...t, ...payload.new } : t));
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "credits", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!payload.new) return;
          const c = payload.new;
          if (staffId) {
            const isMine   = c.staff_id === staffId;
            const isBranch = role === "manager" && branchId && c.branch_id === branchId;
            if (!isMine && !isBranch) return;
          }
          setCredits(prev => {
            if (prev.some(r => r.id === c.id)) return prev;
            return [c, ...prev];
          });
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "credits", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!payload.new) return;
          setCredits(prev => prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c));
        })
      .subscribe((status) => {
        setRtConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          if (rtReady) loadData(true);
          else rtReady = true;
        }
      });
    return () => { supabase.removeChannel(channel); setRtConnected(false); };
  }, [userId, staffId, branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Online / offline detection + queue flush ──────────────────
  useEffect(() => {
    const doSync = async () => {
      setSyncing(true);
      setSyncResult(null);
      try {
        const before = await getPendingCount(userId).catch(() => 0);
        if (before > 0) {
          const result = await syncPending(supabase, userId);
          if (result.synced > 0) {
            setTransactions(prev => prev.filter(tx => !tx._pending));
          }
        }
        await loadDataRef.current?.(true);
        const after = await getPendingCount(userId).catch(() => 0);
        setPendingCount(after);
        const syncedCount = before - after;
        setSyncResult(syncedCount > 0
          ? `Synced ${syncedCount} offline transaction${syncedCount === 1 ? "" : "s"}`
          : "Up to date"
        );
        setTimeout(() => setSyncResult(null), 5000);
      } catch { /* best-effort */ }
      setSyncing(false);
    };

    const on = async () => {
      setIsOnline(true);
      if (!wasOfflineRef.current) return;
      wasOfflineRef.current = false;
      await doSync();
    };
    const off = () => { setIsOnline(false); wasOfflineRef.current = true; };
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);

    // Prime the pending count and flush any ops left over from prior sessions.
    // Delay 1 s so the initial loadData() finishes first.
    getPendingCount(userId).then(count => {
      setPendingCount(count);
      if (count > 0 && navigator.onLine) setTimeout(doSync, 1000);
    }).catch(() => {});

    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Transactions ───────────────────────────────────────────────
  const addTransaction = async (t) => {
    const localId = uid();
    const tempId  = `tmp-${localId}`;
    const payload = {
      user_id:          userId,
      staff_id:         staffId  || null,
      branch_id:        branchId || null,
      type:             t.type,
      category:         t.category         || "sale",
      amount:           parseFloat(t.amount)   || 0,
      item_name:        t.item_name         != null ? t.item_name : null,
      quantity:         t.quantity          != null ? (parseInt(t.quantity) || 1) : null,
      customer_name:    t.customer_name     || "",
      payment_type:     t.payment_type      || "cash",
      note:             t.note              || "",
      transaction_date: t.transaction_date  || today(),
      bill_status:      t.bill_status       !== undefined ? t.bill_status : null,
      client_txn_id:    localId,
      line_items:       t.line_items        != null ? t.line_items : null,
    };

    setTransactions(p => [{ ...payload, id: tempId, _pending: true }, ...p]);
    setDbError(null);

    // ── Offline: queue the transaction in IndexedDB ───────────────
    if (!navigator.onLine) {
      try {
        await savePendingOp({ local_id: localId, table: "transactions", data: payload, user_id: userId });
        setPendingCount(p => p + 1);
        // Leave the optimistic row in state with _pending=true so the user sees it.
        // syncPending() will replace it with the real server row on reconnect.
        return { _queued: true, id: tempId, ...payload };
      } catch {
        setTransactions(p => p.filter(tx => tx.id !== tempId));
        setDbError("Couldn't queue — offline storage unavailable.");
        return;
      }
    }

    const { data, error } = await supabase
      .from("transactions").insert(payload).select().single();

    if (error) {
      setTransactions(p => p.filter(tx => tx.id !== tempId));
      setDbError(error.message || "Couldn't save the transaction. Please try again.");
      fireEmailTrigger("transaction_failed", {
        owner_id:      userId,
        business_name: profile.business_name || "",
        amount:        String(parseFloat(t.amount) || 0),
        description:   t.item_name || t.category || "Transaction",
        type:          t.type || "out",
        date:          t.transaction_date || today(),
        staff_id:      staffId || "",
        staff_name:    staffName || "",
        reason:        error.message || "Failed to save transaction",
      });
    } else {
      setTransactions(p => p.map(tx => tx.id === tempId ? data : tx));
      // Notification delivered via realtime channel (staff-originated only).
      // Email sent only when a staff member records — owner self-recordings are silent.
      if (staffId) {
        fireEmailTrigger(t.type === "in" ? "transaction_credit" : "transaction_debit", {
          owner_id:       userId,
          user_email:     authEmailRef.current || profile.email || "",
          business_name:  profile.business_name || "",
          business_phone: profile.phone || "",
          amount:         String(parseFloat(t.amount) || 0),
          description:    t.item_name || t.category || "Transaction",
          date:           t.transaction_date || today(),
          payment_method: t.payment_type || "cash",
          note:           t.note || "",
          quantity:       t.quantity || "",
          category:       t.category || "",
          customer_name:  t.customer_name || "",
          staff_id:       staffId || "",
          staff_name:     staffName || "",
          staff_email:    profile._staff_email || "",
        });
      }
      if (staffId) {
        const amt   = `${t.type === "in" ? "+" : "-"}₦${parseFloat(t.amount).toLocaleString()}`;
        const extra = [t.customer_name, t.payment_type].filter(Boolean).join(" · ");
        logAudit({ ownerId: userId, staffId, staffName: staffName || "Staff",
          action:  `${t.type === "in" ? "Sale" : "Expense"}: ${t.item_name}`,
          module:  "transactions",
          details: extra ? `${amt} · ${extra}` : amt });
        notify({
          type:         t.type === "in" ? "staff_cash_in" : "staff_cash_out",
          userId,
          originUserId: staffId,
          data: {
            ownerId:   userId,
            staffName: staffName || "Staff",
            amount:    parseFloat(t.amount) || 0,
            item:      t.item_name || t.category || "transaction",
            txId:      data.id,
          },
        });
        if (branchId) {
          notifyBranchManager(userId, branchId, {
            type:         t.type === "in" ? "staff_cash_in" : "staff_cash_out",
            originUserId: staffId,
            data: { ownerId: userId, staffName: staffName || "Staff", amount: parseFloat(t.amount) || 0 },
          });
        }
      }
      return data;
    }
  };

  const patchTransactionNote = (id, note) => {
    setTransactions(p => p.map(tx => tx.id === id ? { ...tx, note } : tx));
  };

  const deleteTransaction = async (id) => {
    const txToCancel = transactions.find(tx => tx.id === id);
    setTransactions(p => p.filter(tx => tx.id !== id));
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { console.error("deleteTransaction:", error); loadData(); return { error }; }
    if (txToCancel?.line_items && txToCancel.line_items.length > 0) {
      const stockLines = txToCancel.line_items.filter(li => li.productId);
      await Promise.all(stockLines.map(async li => {
        const { data: prod } = await supabase
          .from("products").select("quantity").eq("id", li.productId).single();
        if (!prod) return;
        const restored = (prod.quantity || 0) + (li.qty || 1);
        await Promise.all([
          supabase.from("products")
            .update({ quantity: restored, updated_at: new Date().toISOString() })
            .eq("id", li.productId),
          supabase.from("stock_movements").insert({
            id: uid(), user_id: userId, branch_id: branchId || null,
            product_id: li.productId, type: "return",
            quantity: li.qty || 1, unit_price: li.unitPrice || 0,
            notes: "Transaction reversal", staff_id: staffId || null,
            created_at: new Date().toISOString(),
          }),
        ]);
      }));
    }
    if (txToCancel) {
      fireEmailTrigger("transaction_cancelled", {
        owner_id:      userId,
        business_name: profile.business_name || "",
        amount:        String(txToCancel.amount || 0),
        description:   txToCancel.item_name || txToCancel.category || "Transaction",
        type:          txToCancel.type || "out",
        date:          txToCancel.transaction_date || today(),
        staff_id:      staffId || txToCancel.staff_id || "",
        staff_name:    staffName || "",
      });
    }
    return { error: null };
  };

  // ── Credits ────────────────────────────────────────────────────
  const addCredit = async (c) => {
    const tempId = "tmp-" + uid();
    const payload = {
      user_id:              userId,
      staff_id:             staffId  || null,
      branch_id:            branchId || null,
      customer_name:        c.customer_name,
      phone:                c.phone               || "",
      email:                c.email               || "",
      address:              c.address             || "",
      state:                c.state               || "",
      lga:                  c.lga                 || "",
      ward:                 c.ward                || "",
      nin:                  c.nin                 || "",
      next_of_kin:          c.next_of_kin         || "",
      next_of_kin_phone:    c.next_of_kin_phone   || "",
      next_of_kin_email:    c.next_of_kin_email   || "",
      next_of_kin_address:  c.next_of_kin_address || "",
      total_amount:         parseFloat(c.total_amount) || 0,
      amount_paid:          0,
      outstanding:          (parseFloat(c.total_amount) || 0) + (parseFloat(c.interest_amount) || 0),
      interest_type:        c.interest_type   || null,
      interest_value:       c.interest_value  ? parseFloat(c.interest_value)  : null,
      interest_amount:      c.interest_amount ? parseFloat(c.interest_amount) : null,
      date_given:           today(),
      due_date:             c.due_date             || null,
      status:               "active",
      notes:                c.notes               || "",
    };

    setCredits(p => [{ ...payload, id: tempId }, ...p]);
    setDbError(null);

    const { data, error } = await supabase
      .from("credits").insert(payload).select().single();

    if (error) {
      setCredits(p => p.filter(cr => cr.id !== tempId));
      setDbError(`Failed to save credit: ${error.message}`);
      return { data: null, error };
    } else {
      setCredits(p => {
        // If realtime beat the await and already inserted the real record, just drop the temp
        if (p.some(cr => cr.id === data.id)) return p.filter(cr => cr.id !== tempId);
        return p.map(cr => cr.id === tempId ? data : cr);
      });
      if (staffId) {
        const due = c.due_date ? ` · due ${c.due_date}` : "";
        logAudit({ ownerId: userId, staffId, staffName: staffName || "Staff",
          action:  `Credit client added: ${c.customer_name}`,
          module:  "credit",
          details: `₦${parseFloat(c.total_amount || 0).toLocaleString()} outstanding${due}` });
      }
      fireEmailTrigger("credit_added", {
        owner_id:        userId,
        owner_email:     authEmailRef.current || profile.email || "",
        staff_id:        staffId  || null,
        staff_name:      staffName || "",
        business_name:   profile.business_name || "",
        business_phone:  profile.phone || "",
        customer_name:   c.customer_name || "",
        customer_email:  c.email  || "",
        customer_phone:  c.phone  || "",
        customer_address:c.address || "",
        total_amount:    parseFloat(c.total_amount || 0),
        due_date:        c.due_date || null,
        notes:           c.notes || "",
        nin:             c.nin   || "",
        next_of_kin:     c.next_of_kin || "",
        next_of_kin_phone: c.next_of_kin_phone || "",
      });
      if (staffId) {
        const creditData = { ownerId: userId, staffName: staffName || "Staff", amount: parseFloat(c.total_amount) || 0, customerName: c.customer_name || "", creditId: data.id };
        notify({ type: "credit_created", userId, originUserId: staffId, data: creditData });
        if (branchId) notifyBranchManager(userId, branchId, { type: "credit_created", originUserId: staffId, data: creditData });
      }
      return { data, error: null };
    }
  };

  const repayCredit = async (id, amount, paymentMethod = "cash", notes = "", pin = "") => {
    // Guard: if a payment for this credit is already in-flight, silently drop the
    // duplicate call. This handles double-tap and slow-network re-submission.
    if (pendingRepayRef.current.has(id)) return;
    pendingRepayRef.current.add(id);

    let data, error;
    try {
      ({ data, error } = await supabase.functions.invoke("ajo-write", {
        body: {
          action:         "record_credit_repayment",
          credit_id:      id,
          amount,
          payment_method: paymentMethod,
          notes:          notes || null,
          pin,
        },
      }));
    } finally {
      pendingRepayRef.current.delete(id);
    }

    if (error || data?.error) {
      console.error("repayCredit:", data?.error || error?.message);
      loadData();
      return { error: data?.error || error?.message || "Payment failed" };
    }
    const { payment: dp, outstanding: newOutstanding, status: newStatus } = data;
    let updated;
    setCredits(p => p.map(c => {
      if (c.id !== id) return c;
      updated = { ...c, amount_paid: c.amount_paid + amount, outstanding: newOutstanding, status: newStatus };
      return updated;
    }));
    // Dedup guard: same pattern as setTransactions — only prepend if not already present
    if (dp) setDebtPayments(prev => prev.some(p => p.id === dp.id) ? prev : [dp, ...prev]);
    if (updated) {

        fireEmailTrigger("credit_repayment", {
          customer_name:  updated.customer_name || "",
          customer_email: updated.email         || "",
          customer_phone: updated.phone         || "",
          amount_paid:    amount,
          outstanding:    updated.outstanding,
          total_amount:   updated.total_amount,
          status:         updated.status,
          payment_method: paymentMethod || "cash",
          notes:          notes         || "",
          owner_id:       userId,
          owner_email:    authEmailRef.current || profile.email || "",
          business_name:  profile.business_name || "",
          business_phone: profile.phone || "",
          staff_id:       staffId  || "",
          staff_name:     staffName || "",
        });
        const repayData = { ownerId: userId, customerName: updated.customer_name || "", amount, outstanding: updated.outstanding, creditId: id };
        notify({ type: "credit_repayment", userId, originUserId: staffId || userId, data: repayData });
        if (branchId) notifyBranchManager(userId, branchId, { type: "credit_repayment", originUserId: staffId || userId, data: repayData });
        if (updated.status === "paid") {
          fireEmailTrigger("credit_fully_paid", {
            owner_id:       userId,
            owner_email:    authEmailRef.current || profile.email || "",
            business_name:  profile.business_name || "",
            business_phone: profile.phone || "",
            customer_name:  updated.customer_name || "",
            customer_email: updated.email  || "",
            customer_phone: updated.phone  || "",
            total_amount:   updated.total_amount,
            amount_paid:    amount,
            payment_method: paymentMethod || "cash",
            staff_id:       staffId || null,
            staff_name:     staffName || "",
          });
          const doneData = { ownerId: userId, customerName: updated.customer_name || "", total: updated.total_amount, creditId: id };
          notify({ type: "credit_completed", userId, originUserId: staffId || userId, data: doneData });
          if (branchId) notifyBranchManager(userId, branchId, { type: "credit_completed", originUserId: staffId || userId, data: doneData });
        }
    }
    return { error: null };
  };

  // ── Aso Clients ────────────────────────────────────────────────
  const addAsoClient = async (cl) => {
    const tempId = "tmp-" + uid();
    const d = new Date();
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    const membershipNumber = `AJO-${ym}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const portalPin = String(Math.floor(1000 + Math.random() * 9000));
    const payload = {
      user_id:                userId,
      staff_id:               staffId  || null,
      created_by:             staffId  || null,
      branch_id:              branchId || null,
      full_name:              cl.full_name,
      phone:                  cl.phone               || "",
      email:                  cl.email               || "",
      address:                cl.address             || "",
      state:                  cl.state               || "",
      lga:                    cl.lga                 || "",
      ward:                   cl.ward                || "",
      nin:                    cl.nin                 || "",
      next_of_kin:            cl.next_of_kin         || "",
      next_of_kin_phone:      cl.next_of_kin_phone   || "",
      next_of_kin_email:      cl.next_of_kin_email   || "",
      next_of_kin_address:    cl.next_of_kin_address || "",
      contribution_frequency: cl.contribution_frequency || "daily",
      contribution_amount:    cl.contribution_amount  || 0,
      registration_charge:    cl.registration_charge  || 0,
      withdrawal_fee_percent: cl.withdrawal_fee_percent || 5,
      commission_model:       cl.commission_model   || "none",
      commission_percent:     cl.commission_percent || null,
      total_saved:            0,
      total_withdrawn:        0,
      current_balance:        0,
      next_contribution_date: cl.next_contribution_date || today(),
      registration_date:      today(),
      notes:                  cl.notes   || "",
      status:                 "active",
      membership_number:      membershipNumber,
      portal_pin:             portalPin,
      portal_active:          true,
      ajo_group_id:           cl.ajo_group_id || null,
      bank_code:              cl.bank_code       || null,
      account_number:         cl.account_number  || null,
      account_name:           cl.account_name    || null,
      bank_name:              cl.bank_name       || null,
    };

    setAsoClients(p => [{ ...payload, id: tempId }, ...p]);
    setDbError(null);

    const { data, error } = await supabase
      .from("aso_clients").insert(payload).select().single();

    if (error) {
      setAsoClients(p => p.filter(c => c.id !== tempId));
      setDbError(`Failed to save client: ${error.message}`);
      return { data: null, error };
    } else {
      setAsoClients(p => p.map(c => c.id === tempId ? data : c));
      if (staffId) {
        logAudit({ ownerId: userId, staffId, staffName: staffName || "Staff",
          action:  `Aso client added: ${cl.full_name}`,
          module:  "aso",
          details: `${cl.contribution_frequency || "daily"} · ₦${parseFloat(cl.contribution_amount || 0).toLocaleString()}/period` });
        const regData = { ownerId: userId, staffName: staffName || "Staff", clientName: cl.full_name || "", clientId: data.id };
        notify({ type: "ajo_registration", userId, originUserId: staffId, data: regData });
        if (branchId) notifyBranchManager(userId, branchId, { type: "ajo_registration", originUserId: staffId, data: regData });
      }
      return { data, error: null };
    }
  };

  const asoContribute = async (id, amount, contributionContext = "personal_savings", cycleId = null, groupId = null) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "record_contribution", client_id: id, amount, owner_id: userId, recorded_by: staffId || null, contribution_context: contributionContext, ...(cycleId ? { cycle_id: cycleId } : {}), ...(groupId ? { group_id: groupId } : {}) },
    });
    if (error || !data?.ok) {
      console.error("asoContribute:", error?.message || data?.error);
      loadData();
      return { error: error?.message || data?.error || "Contribution failed" };
    }
    // Refresh local state from DB — RPC updated the row atomically
    loadData();
    return { error: null, data };
  };

  const asoCollectionRecord = async (clientId, amount, context, pin, cycleId = null) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "collection_record", client_id: clientId, amount, contribution_context: context, pin, ...(cycleId ? { cycle_id: cycleId } : {}) },
    });
    if (error) return { error: error.message || "Collection failed" };
    if (!data?.ok) return { error: data?.error || "Collection failed" };
    loadData();
    return { error: null, data };
  };

  const asoReverseContribution = async (contributionId, reason, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "reverse_contribution", original_id: contributionId, reason, pin },
    });
    if (error) return { error: error.message || "Reversal failed" };
    if (!data?.ok) return { error: data?.error || "Reversal failed" };
    loadData();
    return { error: null, data };
  };

  const asoWithdraw = async (id, amount, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: {
        action: "record_withdrawal", client_id: id, gross_amount: amount,
        pin, owner_id: userId, recorded_by: staffId || null,
      },
    });
    if (error || !data?.ok) {
      const msg = error?.message || data?.error || "Withdrawal failed";
      console.error("asoWithdraw:", msg);
      if (!data?.error?.includes("PIN") && !data?.error?.includes("balance")) loadData();
      return { error: msg };
    }
    loadData();
    return { error: null, data };
  };

  // ── Update Credit record ───────────────────────────────────────
  const updateCredit = async (id, updates) => {
    setCredits(p => p.map(c => c.id === id ? { ...c, ...updates } : c));
    const { error } = await supabase.from("credits").update(updates).eq("id", id);
    if (error) { console.error("updateCredit:", error); loadData(); return { error }; }
    return { error: null };
  };

  // ── Add extra credit to an existing credit customer ───────────
  // Wraps updateCredit and fires owner + manager notifications so the
  // "add credit to existing user" path matches the new-credit-user path.
  const addExtraCredit = async (id, updates, { amount, outstanding, customerName } = {}) => {
    const result = await updateCredit(id, updates);
    if (!result.error) {
      const credit = credits.find(c => c.id === id);
      // Email owner always; also email customer if they have an address on file
      fireEmailTrigger("credit_extended", {
        owner_id:       userId,
        owner_email:    authEmailRef.current,
        customer_email: credit?.email          || "",
        customer_name:  customerName           || credit?.customer_name || "",
        staff_name:     staffName              || "",
        business_name:  profile?.business_name || "",
        amount:         amount                 || 0,
        outstanding:    outstanding            || 0,
      });
      if (staffId) {
        const extData = {
          ownerId:      userId,
          staffName:    staffName || "Staff",
          amount:       amount       || 0,
          outstanding:  outstanding  || 0,
          customerName: customerName || "",
          creditId:     id,
        };
        notify({ type: "credit_extended", userId, originUserId: staffId, data: extData });
        if (branchId) notifyBranchManager(userId, branchId, { type: "credit_extended", originUserId: staffId, data: extData });
      }
    }
    return result;
  };

  // ── Update Aso Client record ───────────────────────────────────
  const updateAsoClient = async (id, updates) => {
    setAsoClients(p => p.map(c => c.id === id ? { ...c, ...updates } : c));
    const { error } = await supabase.from("aso_clients").update(updates).eq("id", id);
    if (error) { console.error("updateAsoClient:", error); loadData(); return { error }; }
    if (updates.staff_id) {
      const client = asoClients.find(c => c.id === id);
      const { data: newStaff } = await supabase.from("staff").select("user_id").eq("id", updates.staff_id).maybeSingle();
      if (newStaff?.user_id) {
        notify({
          type: "client_assigned",
          userId: newStaff.user_id,
          originUserId: userId,
          data: { clientName: client?.full_name || "A client", clientId: id, ownerId: userId },
        });
      }
    }
    return { error: null };
  };

  // ── Archive Aso Client (replaces hard-delete; zero-balance + PIN required) ──
  const deleteAsoClient = async (id, pin) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "archive_client", client_id: id, pin, owner_id: userId },
    });
    if (error || !data?.ok) {
      const msg = error?.message || data?.error || "Archive failed";
      loadData();
      return { error: msg };
    }
    // Remove from active list; archived clients are excluded by the archived_at filter
    setAsoClients(p => p.filter(c => c.id !== id));
    return { error: null };
  };

  // ── Request Aso Client Archive (approval-gated flow) ─────────────────────────
  // Submits a client_archive approval request — owner PIN-gated.
  // On success: flags the client as pending_archive locally so the card shows the badge.
  const requestAsoClientArchive = async (id, pin, reason) => {
    const { data, error } = await supabase.functions.invoke("ajo-write", {
      body: { action: "request_client_archive", client_id: id, pin, reason },
    });
    if (error || !data?.ok) {
      return { error: error?.message || data?.error || "Request failed" };
    }
    setAsoClients(p => p.map(c => c.id === id ? { ...c, pending_archive: true } : c));
    return { error: null };
  };

  const cancelAsoClientArchive = async (id) => {
    const { error } = await supabase.rpc("cancel_approval_request", {
      p_target_id: id,
      p_type: "client_archive",
    });
    if (error) return { error: error.message };
    setAsoClients(p => p.map(c => c.id === id ? { ...c, pending_archive: false } : c));
    return { error: null };
  };

  // ── Profile ────────────────────────────────────────────────────
  const setProfile = async (updater) => {
    const prev = profile;
    const next = typeof updater === "function" ? updater(prev) : updater;
    setProfileState(next);
    if (typeof next.dark_mode === "boolean") {
      localStorage.setItem("kuditrack_dark", next.dark_mode ? "1" : "0");
      // Synchronous — before React re-renders — so documentElement and wrapper div
      // are always consistent on the same paint frame. Eliminates the toggle flash.
      document.documentElement.classList.toggle("dark", next.dark_mode);
    }

    const { error } = await supabase.from("profiles").update({
      full_name:         next.full_name         || null,
      business_name:     next.business_name     || null,
      email:             next.email             || null,
      gender:            next.gender            || null,
      date_of_birth:     next.date_of_birth     || null,
      nin:               next.nin               || null,
      phone:             next.phone             || null,
      address:           next.address           || null,
      state:             next.state             || null,
      lga:               next.lga               || null,
      ward:              next.ward              || null,
      currency:          next.currency          || null,
      dark_mode:         next.dark_mode,
      profile_image_url:            next.profile_image_url            ? next.profile_image_url.split("?")[0] : null,
      store_image_url:              next.store_image_url              ? next.store_image_url.split("?")[0]   : null,
      business_category:            next.business_category            || null,
      business_registration_number: next.business_registration_number || null,
      business_phone:               next.business_phone               || null,
      business_email:               next.business_email               || null,
      working_capital_amount:       next.working_capital_amount       ?? null,
      working_capital_as_of:        next.working_capital_as_of        || null,
      industry:                     next.industry                     || null,
      business_type:                next.business_type                || null,
      reg_status:                   next.reg_status                   || null,
      business_country:             next.business_country             || null,
      business_state:               next.business_state               || null,
      business_lga:                 next.business_lga                 || null,
      business_ward:                next.business_ward                || null,
      business_address:             next.business_address             || null,
      operating_model:              next.operating_model              || null,
      reg_doc_url:                  next.reg_doc_url                  || null,
      reg_doc_type:                 next.reg_doc_type                 || null,
      business_size:                next.business_size                || null,
      products_services_type:       next.products_services_type       || null,
      target_market:                next.target_market                || null,
      country_of_registration:      next.country_of_registration      || null,
    }).eq("id", userId);

    if (error) {
      setProfileState(prev);
      if (typeof prev.dark_mode === "boolean") {
        localStorage.setItem("kuditrack_dark", prev.dark_mode ? "1" : "0");
        document.documentElement.classList.toggle("dark", prev.dark_mode);
      }
      setDbError(`Failed to save profile: ${error.message}`);
      return { error };
    }
    return { error: null };
  };

  return {
    transactions, credits, asoClients, profile, staffMap, staffList, branchList,
    setProfile, isOnline, loading, rtConnected,
    dbError, clearDbError: () => setDbError(null),
    loadError, clearLoadError: () => setLoadError(null), reloadData: loadData, silentRefresh: () => loadData(true),
    fromCache, lastSyncTime, syncing, syncResult, pendingCount,
    addTransaction,
    patchTransactionNote,
    // Staff cannot delete transactions — only business owners (no staffId) can
    deleteTransaction: staffId ? null : deleteTransaction,
    addCredit, repayCredit, updateCredit, addExtraCredit, debtPayments,
    addAsoClient, asoContribute, asoCollectionRecord, asoWithdraw, updateAsoClient, deleteAsoClient, requestAsoClientArchive, cancelAsoClientArchive,
    asoReverseContribution,
  };
}
