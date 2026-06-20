import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../utils/supabase";
import { uid, today, fmt } from "../utils/helpers";
import { logAudit } from "../utils/auditLog";
import { savePendingOp, getPendingOps, getPendingCount } from "../utils/offlineDb";
import { syncPending } from "../utils/syncManager";

function fireEmailTrigger(event, data) {
  fetch("https://admin.kudiai.app/api/public/email-trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-trigger-secret": "kuditrack-email-trigger-2026-amaya" },
    body: JSON.stringify({ event, data }),
  })
    .then(r => r.json())
    .then(res => console.log("[KudiTrack Email]", event, res))
    .catch(err => console.warn("[KudiTrack Email] fetch failed:", err));
}

// ── localStorage cache ─────────────────────────────────────────────
function saveCacheLS(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /**/ }
}
function loadCacheLS(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

export function useStore(userId, staffId = null, staffName = null, onNotify = null, branchId = null) {
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
  const [loading,     setLoading]     = useState(true);
  const [isOnline,    setIsOnline]    = useState(navigator.onLine);
  const [dbError,     setDbError]     = useState(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [isSyncing,   setIsSyncing]   = useState(false);

  const syncRunning = useRef(false);
  const hasMounted  = useRef(false);
  const authEmailRef = useRef("");

  // ── Load all data ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    // ── Offline: serve from local cache ───────────────────────
    if (!navigator.onLine) {
      const cached = loadCacheLS(`kt_store_${userId}`);
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
      }
      // Merge pending (unsaved) transactions into the list
      try {
        const ops = await getPendingOps(userId);
        setPendingSync(ops.length);
        const pendingTxns = ops
          .filter(op => op.table === "transactions")
          .map(op => ({ ...op.data, id: `tmp-${op.local_id}`, _pending: true }));
        if (pendingTxns.length) {
          setTransactions(prev => {
            const ids = new Set(prev.map(t => t.id));
            return [...pendingTxns.filter(t => !ids.has(t.id)), ...prev];
          });
        }
      } catch { /**/ }
      setLoading(false);
      return;
    }

    // ── Online: fetch from Supabase ───────────────────────────
    let txQ  = supabase.from("transactions").select("*").eq("user_id", userId);
    let crQ  = supabase.from("credits").select("*").eq("user_id", userId);
    let asoQ = supabase.from("aso_clients").select("*").eq("user_id", userId);
    let dpQ  = supabase.from("debt_payments").select("*").eq("owner_id", userId);
    if (staffId) {
      txQ  = txQ.eq("staff_id",  staffId);
      crQ  = crQ.eq("staff_id",  staffId);
      asoQ = asoQ.eq("staff_id", staffId);
    }
    if (branchId) {
      txQ  = txQ.eq("branch_id", branchId);
      crQ  = crQ.eq("branch_id", branchId);
      asoQ = asoQ.eq("branch_id", branchId);
    }

    const [txRes, crRes, asoRes, profRes, staffRes, sessRes, dpRes] = await Promise.all([
      txQ.order("created_at",  { ascending: false }),
      crQ.order("created_at",  { ascending: false }),
      asoQ.order("created_at", { ascending: false }),
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      !staffId
        ? supabase.from("staff").select("id, full_name").eq("owner_id", userId)
        : Promise.resolve({ data: null }),
      supabase.auth.getSession(),
      dpQ.order("created_at", { ascending: false }),
    ]);
    authEmailRef.current = sessRes?.data?.session?.user?.email || "";

    if (txRes.data)  setTransactions(txRes.data);
    if (crRes.data)  setCredits(crRes.data);
    if (asoRes.data) setAsoClients(asoRes.data);
    if (dpRes.data)  setDebtPayments(dpRes.data);

    // Fire overdue contribution reminders — once per client per calendar day
    if (asoRes.data?.length) {
      const todayStr = today();
      const bizName  = profRes.data?.business_name || "";
      for (const cl of asoRes.data) {
        if (!cl.email) continue;
        if (!cl.next_contribution_date || cl.next_contribution_date >= todayStr) continue;
        if (["paid", "cancelled", "completed"].includes(cl.status)) continue;
        const lsKey = `ajo_overdue_${cl.id}_${todayStr}`;
        if (localStorage.getItem(lsKey)) continue;
        localStorage.setItem(lsKey, "1");
        fireEmailTrigger("ajo_contribution_overdue", {
          client_name:            cl.full_name             || "",
          client_email:           cl.email                 || "",
          next_contribution_date: cl.next_contribution_date,
          contribution_amount:    cl.contribution_amount   || 0,
          contribution_frequency: cl.contribution_frequency || "",
          current_balance:        cl.current_balance       || 0,
          group_name:             cl.group_name            || "",
          business_name:          bizName,
        });
      }
    }

    if (staffRes.data) {
      const map = {};
      staffRes.data.forEach(s => { map[s.id] = s.full_name; });
      setStaffMap(map);
    }

    if (profRes.data) {
      const p = profRes.data;
      const darkFromDb = p.dark_mode != null ? p.dark_mode : (localStorage.getItem("kuditrack_dark") === "1");
      localStorage.setItem("kuditrack_dark", darkFromDb ? "1" : "0");
      setProfileState({
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
        dark_mode:         darkFromDb,
        profile_image_url: p.profile_image_url
          ? `${p.profile_image_url.split("?")[0]}?v=${Date.now()}`
          : null,
        store_image_url: p.store_image_url
          ? `${p.store_image_url.split("?")[0]}?v=${Date.now()}`
          : null,
      });
    }

    // Cache up to 300 transactions for offline access
    saveCacheLS(`kt_store_${userId}`, {
      transactions: (txRes.data || []).slice(0, 300),
      credits:    crRes.data  || [],
      asoClients: asoRes.data || [],
      profile: profRes.data
        ? { business_name: profRes.data.business_name, dark_mode: profRes.data.dark_mode }
        : null,
    });

    try {
      const count = await getPendingCount(userId);
      setPendingSync(count);
    } catch { /**/ }

    setLoading(false);
  }, [userId, staffId, branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Realtime: live sync for aso_clients balance changes ───────────────
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`aso_clients_rt_${userId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "aso_clients", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.new) {
            setAsoClients(prev => prev.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // ── Online / offline detection ─────────────────────────────────
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Sync engine ────────────────────────────────────────────────
  const runSync = useCallback(async () => {
    if (syncRunning.current || !userId || !supabase) return;

    // Refresh session so the JWT is valid (prevents RLS failures after being offline)
    const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: null }));
    if (!sessionData?.session) {
      setDbError("Session expired — please log out and back in, then sync.");
      return;
    }

    const ops = await getPendingOps(userId).catch(() => []);
    if (!ops.length) return;

    syncRunning.current = true;
    setIsSyncing(true);

    const result = await syncPending(supabase, userId, ({ synced, total, data, op }) => {
      setPendingSync(Math.max(0, total - synced));
      if (op?.table === "transactions" && data) {
        setTransactions(prev => prev.map(t => t.id === `tmp-${op.local_id}` ? data : t));
      }
    }).catch(e => ({ synced: 0, failed: 1, total: 0, errors: [e?.message || String(e)] }));

    try {
      const remaining = await getPendingCount(userId);
      setPendingSync(remaining);
      if (result?.failed > 0 && result?.errors?.length) {
        setDbError(`Sync failed (${result.failed} record${result.failed !== 1 ? "s" : ""}): ${result.errors[0]}`);
      } else if (remaining === 0 && result?.synced > 0) {
        setDbError(null);
      }
    } catch { /**/ }

    syncRunning.current = false;
    setIsSyncing(false);
  }, [userId]);

  // Auto-sync when coming back online (skip initial mount)
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return; }
    if (isOnline && userId) {
      const t = setTimeout(() => runSync(), 800);
      return () => clearTimeout(t);
    }
  }, [isOnline, userId, runSync]);

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
      item_name:        t.item_name         || "",
      quantity:         parseInt(t.quantity)   || 1,
      customer_name:    t.customer_name     || "",
      payment_type:     t.payment_type      || "cash",
      note:             t.note              || "",
      transaction_date: t.transaction_date  || today(),
      bill_status:      t.bill_status       !== undefined ? t.bill_status : null,
    };

    setTransactions(p => [{ ...payload, id: tempId, _pending: true }, ...p]);
    setDbError(null);

    // Offline: queue locally and show pending indicator
    if (!navigator.onLine) {
      await savePendingOp({ local_id: localId, table: "transactions", data: payload, user_id: userId });
      setPendingSync(c => c + 1);
      return;
    }

    const { data, error } = await supabase
      .from("transactions").insert(payload).select().single();

    if (error) {
      // Online but request failed — queue for retry
      await savePendingOp({ local_id: localId, table: "transactions", data: payload, user_id: userId });
      setPendingSync(c => c + 1);
      setDbError("Saved locally — will sync when connection improves");
      fireEmailTrigger("transaction_failed", {
        owner_id:      userId,
        owner_email:   profile.email || "",
        owner_name:    profile.owner_name || profile.business_name || "",
        business_name: profile.business_name || "",
        amount:        String(parseFloat(t.amount) || 0),
        description:   t.item_name || t.category || "Transaction",
        type:          t.type || "out",
        date:          t.transaction_date || today(),
        staff_id:      staffId || "",
        staff_name:    staffName || "",
        error_msg:     error.message || "Failed to save transaction",
      });
    } else {
      setTransactions(p => p.map(tx => tx.id === tempId ? data : tx));
      const label = t.item_name || t.category || "Transaction";
      if (t.payment_type === "bill_payment") {
        onNotify?.("bills", "Bill Payment", `${fmt(parseFloat(t.amount))} · ${label}`);
      } else if (t.type === "in") {
        onNotify?.("sales", "Sale Recorded", `${fmt(parseFloat(t.amount))} · ${label}`);
      } else {
        onNotify?.("sales", "Expense Recorded", `${fmt(parseFloat(t.amount))} · ${label}`);
      }
      fireEmailTrigger(t.type === "in" ? "transaction_credit" : "transaction_debit", {
        owner_id: userId,
        user_email: profile.email || "",
        user_name: profile.owner_name || profile.business_name || "",
        business_name: profile.business_name || "",
        amount: String(parseFloat(t.amount) || 0),
        description: t.item_name || t.category || "Transaction",
        date: t.transaction_date || today(),
        customer_name: t.customer_name || "",
        staff_id: staffId || "",
        staff_name: staffName || "",
      });
      if (staffId) {
        const amt   = `${t.type === "in" ? "+" : "-"}₦${parseFloat(t.amount).toLocaleString()}`;
        const extra = [t.customer_name, t.payment_type].filter(Boolean).join(" · ");
        logAudit({ ownerId: userId, staffId, staffName: staffName || "Staff",
          action:  `${t.type === "in" ? "Sale" : "Expense"}: ${t.item_name}`,
          module:  "transactions",
          details: extra ? `${amt} · ${extra}` : amt });
      }
    }
  };

  const deleteTransaction = async (id) => {
    const txToCancel = transactions.find(tx => tx.id === id);
    setTransactions(p => p.filter(tx => tx.id !== id));
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { console.error("deleteTransaction:", error); loadData(); }
    else if (txToCancel) {
      fireEmailTrigger("transaction_cancelled", {
        owner_id:      userId,
        owner_email:   profile.email || "",
        owner_name:    profile.owner_name || profile.business_name || "",
        business_name: profile.business_name || "",
        amount:        String(txToCancel.amount || 0),
        description:   txToCancel.item_name || txToCancel.category || "Transaction",
        type:          txToCancel.type || "out",
        date:          txToCancel.transaction_date || today(),
        staff_id:      staffId || txToCancel.staff_id || "",
        staff_name:    staffName || "",
      });
    }
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
      outstanding:          parseFloat(c.total_amount) || 0,
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
      setCredits(p => p.map(cr => cr.id === tempId ? data : cr));
      onNotify?.("credits", "Credit Added", `${fmt(parseFloat(c.total_amount || 0))} · ${c.customer_name}`);
      if (staffId) {
        const due = c.due_date ? ` · due ${c.due_date}` : "";
        logAudit({ ownerId: userId, staffId, staffName: staffName || "Staff",
          action:  `Credit client added: ${c.customer_name}`,
          module:  "credit",
          details: `₦${parseFloat(c.total_amount || 0).toLocaleString()} outstanding${due}` });
        fireEmailTrigger("credit_added", {
          owner_id:      userId,
          staff_id:      staffId,
          staff_name:    staffName || "",
          business_name: profile.business_name || "",
          customer_name: c.customer_name || "",
          total_amount:  parseFloat(c.total_amount || 0),
          due_date:      c.due_date || null,
        });
      }
      return { data, error: null };
    }
  };

  const repayCredit = async (id, amount, paymentMethod = "cash", notes = "") => {
    let updated;
    setCredits(p => p.map(c => {
      if (c.id !== id) return c;
      const paid = c.amount_paid + amount;
      const out  = Math.max(0, c.total_amount - paid);
      updated = { ...c, amount_paid: paid, outstanding: out,
        status: out === 0 ? "paid" : paid > 0 ? "partially_paid" : "active" };
      return updated;
    }));
    if (updated) {
      const { error } = await supabase.from("credits")
        .update({ amount_paid: updated.amount_paid, outstanding: updated.outstanding, status: updated.status })
        .eq("id", id);
      if (error) { console.error("repayCredit:", error); loadData(); }
      else {
        // Record individual payment
        const paymentPayload = {
          credit_id:      id,
          owner_id:       userId,
          staff_id:       staffId  || null,
          amount,
          payment_method: paymentMethod,
          payment_date:   today(),
          notes:          notes    || null,
          recorded_by:    staffId  || null,
        };
        const { data: dp } = await supabase.from("debt_payments").insert(paymentPayload).select().single();
        if (dp) setDebtPayments(prev => [dp, ...prev]);

        onNotify?.("payments", "Payment Received", `${fmt(amount)} from ${updated.customer_name}`);
        fireEmailTrigger("credit_repayment", {
          creditor_name:  updated.customer_name || "",
          creditor_email: updated.email         || "",
          amount,
          outstanding:    updated.outstanding,
          total_amount:   updated.total_amount,
          status:         updated.status,
          owner_id:       userId,
          business_name:  profile.business_name || "",
          staff_id:       staffId  || "",
          staff_name:     staffName || "",
        });
      }
    }
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
      }
      return { data, error: null };
    }
  };

  const asoContribute = async (id, amount) => {
    let updated;
    let regFee = 0;
    setAsoClients(p => p.map(c => {
      if (c.id !== id) return c;
      const freqDays = { daily: 1, weekly: 7, monthly: 30 };
      const days  = freqDays[c.contribution_frequency] || 30;
      const base  = c.next_contribution_date || today();
      const d     = new Date(base);
      d.setDate(d.getDate() + days);
      const nextDate = d.toISOString().split("T")[0];
      const isFirst = (c.total_saved || 0) === 0;
      regFee = isFirst ? (c.registration_charge || 0) : 0;
      updated = {
        ...c,
        total_saved:            c.total_saved + amount,
        current_balance:        c.current_balance + amount - regFee,
        next_contribution_date: nextDate,
      };
      return updated;
    }));
    if (updated) {
      const { error } = await supabase.from("aso_clients")
        .update({ total_saved: updated.total_saved, current_balance: updated.current_balance, next_contribution_date: updated.next_contribution_date })
        .eq("id", id);
      if (error) { console.error("asoContribute:", error); loadData(); }
      else {
        supabase.from("ajo_contributions").insert({
          aso_client_id: id, owner_id: userId, amount,
          type: "contribution", payment_method: "cash", status: "completed",
          recorded_by: staffId || null,
        }).catch(console.error);
        if (regFee > 0) {
          supabase.from("ajo_contributions").insert({
            aso_client_id: id, owner_id: userId, amount: regFee,
            type: "registration_fee", payment_method: "cash", status: "completed",
            notes: "Registration fee deducted from first deposit",
            recorded_by: staffId || null,
          }).catch(console.error);
        }
        fireEmailTrigger("ajo_contribution", {
          user_email:    staffId ? (profile.email || "") : (authEmailRef.current || profile.email || ""),
          user_name:     profile.owner_name || profile.business_name || "",
          business_name: profile.business_name || "",
          client_email:  updated.email    || "",
          client_name:   updated.full_name || "",
          group_name:    updated.group_name || "",
          amount,
          balance:       updated.current_balance,
          reg_fee:       regFee || 0,
          date:          today(),
          staff_email:   staffId ? (authEmailRef.current || "") : "",
          staff_name:    staffName || "",
        });
        onNotify?.("aso", "Contribution Received", `${fmt(amount)} from ${updated.full_name}`);
      }
    }
  };

  const asoWithdraw = async (id, amount) => {
    let updated;
    let netAmount = amount;
    let feeAmount = 0;
    setAsoClients(p => p.map(c => {
      if (c.id !== id) return c;
      feeAmount = amount * ((c.withdrawal_fee_percent || 0) / 100);
      netAmount = amount - feeAmount;
      // Full withdrawal amount (gross) leaves the balance; client receives net; fee is owner's cut
      updated = { ...c, total_withdrawn: c.total_withdrawn + netAmount, current_balance: c.current_balance - amount };
      return updated;
    }));
    if (updated) {
      const { error } = await supabase.from("aso_clients")
        .update({ total_withdrawn: updated.total_withdrawn, current_balance: updated.current_balance })
        .eq("id", id);
      if (error) { console.error("asoWithdraw:", error); loadData(); }
      else {
        supabase.from("ajo_contributions").insert({
          aso_client_id: id, owner_id: userId, amount: netAmount,
          type: "withdrawal", payment_method: "cash", status: "completed",
          notes: feeAmount > 0 ? `Withdrawal fee deducted: ${fmt(feeAmount)}` : null,
          recorded_by: staffId || null,
        }).catch(console.error);
        fireEmailTrigger("ajo_withdrawal", {
          user_email:    staffId ? (profile.email || "") : (authEmailRef.current || profile.email || ""),
          user_name:     profile.owner_name || profile.business_name || "",
          business_name: profile.business_name || "",
          client_email:  updated.email    || "",
          client_name:   updated.full_name || "",
          group_name:    updated.group_name || "",
          gross_amount:  amount,
          fee_amount:    feeAmount,
          amount:        netAmount,
          balance_after: updated.current_balance,
          date:          today(),
          staff_email:   staffId ? (authEmailRef.current || "") : "",
          staff_name:    staffName || "",
        });
      }
    }
  };

  // ── Update Credit record ───────────────────────────────────────
  const updateCredit = async (id, updates) => {
    setCredits(p => p.map(c => c.id === id ? { ...c, ...updates } : c));
    const { error } = await supabase.from("credits").update(updates).eq("id", id);
    if (error) { console.error("updateCredit:", error); loadData(); return { error }; }
    return { error: null };
  };

  // ── Update Aso Client record ───────────────────────────────────
  const updateAsoClient = async (id, updates) => {
    setAsoClients(p => p.map(c => c.id === id ? { ...c, ...updates } : c));
    const { error } = await supabase.from("aso_clients").update(updates).eq("id", id);
    if (error) { console.error("updateAsoClient:", error); loadData(); return { error }; }
    return { error: null };
  };

  // ── Delete Aso Client (contributions + auth user via edge fn) ──
  const deleteAsoClient = async (id) => {
    setAsoClients(p => p.filter(c => c.id !== id));
    const { data, error } = await supabase.functions.invoke("delete-ajo-client", {
      body: { clientId: id },
    });
    if (error || data?.error) {
      loadData();
      return { error: error?.message || data?.error || "Delete failed" };
    }
    return { error: null };
  };

  // ── Profile ────────────────────────────────────────────────────
  const setProfile = async (updater) => {
    const prev = profile;
    const next = typeof updater === "function" ? updater(prev) : updater;
    setProfileState(next);
    if (typeof next.dark_mode === "boolean") {
      localStorage.setItem("kuditrack_dark", next.dark_mode ? "1" : "0");
    }

    const { error } = await supabase.from("profiles").update({
      full_name:         next.owner_name        || null,
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
      profile_image_url: next.profile_image_url ? next.profile_image_url.split("?")[0] : null,
      store_image_url:   next.store_image_url   ? next.store_image_url.split("?")[0]   : null,
    }).eq("id", userId);

    if (error) {
      setProfileState(prev);
      setDbError(`Failed to save profile: ${error.message}`);
      return { error };
    }
    return { error: null };
  };

  return {
    transactions, credits, asoClients, profile, staffMap,
    setProfile, isOnline, loading, pendingSync, isSyncing, runSync,
    dbError, clearDbError: () => setDbError(null), reloadData: loadData,
    addTransaction,
    // Staff cannot delete transactions — only business owners (no staffId) can
    deleteTransaction: staffId ? null : deleteTransaction,
    addCredit, repayCredit, updateCredit, debtPayments,
    addAsoClient, asoContribute, asoWithdraw, updateAsoClient, deleteAsoClient,
  };
}
