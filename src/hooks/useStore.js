import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { uid, today, fmt } from "../utils/helpers";
import { logAudit } from "../utils/auditLog";

export function useStore(userId, staffId = null, staffName = null, onNotify = null, branchId = null) {
  const [transactions, setTransactions] = useState([]);
  const [credits,      setCredits]      = useState([]);
  const [asoClients,   setAsoClients]   = useState([]);
  const [profile,      setProfileState] = useState({
    business_name: "", owner_name: "", email: "",
    gender: "", date_of_birth: "", nin: "",
    phone: "", address: "", state: "", lga: "", ward: "",
    currency: "Nigerian Naira (₦)",
    dark_mode: localStorage.getItem("kuditrack_dark") === "1",
    profile_image_url: null, store_image_url: null,
  });
  const [staffMap,  setStaffMap]  = useState({}); // { staffId: staffName } — owner view only
  const [loading,  setLoading]  = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [dbError,  setDbError]  = useState(null);

  // ── Load all data ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    let txQ  = supabase.from("transactions").select("*").eq("user_id", userId);
    let crQ  = supabase.from("credits").select("*").eq("user_id", userId);
    let asoQ = supabase.from("aso_clients").select("*").eq("user_id", userId);
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

    const [txRes, crRes, asoRes, profRes, staffRes] = await Promise.all([
      txQ.order("created_at",  { ascending: false }),
      crQ.order("created_at",  { ascending: false }),
      asoQ.order("created_at", { ascending: false }),
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      !staffId
        ? supabase.from("staff").select("id, full_name").eq("owner_id", userId)
        : Promise.resolve({ data: null }),
    ]);

    if (txRes.data)  setTransactions(txRes.data);
    if (crRes.data)  setCredits(crRes.data);
    if (asoRes.data) setAsoClients(asoRes.data);
    if (staffRes.data) {
      const map = {};
      staffRes.data.forEach(s => { map[s.id] = s.full_name; });
      setStaffMap(map);
    }

    if (profRes.data) {
      const p = profRes.data;
      // Prefer DB value for dark_mode; fall back to localStorage if DB column is missing
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
        // Strip any stale ?v= and add a fresh one so the browser always fetches
        // the current image rather than a cached version from a previous session.
        profile_image_url: p.profile_image_url
          ? `${p.profile_image_url.split("?")[0]}?v=${Date.now()}`
          : null,
        store_image_url: p.store_image_url
          ? `${p.store_image_url.split("?")[0]}?v=${Date.now()}`
          : null,
      });
    }
    setLoading(false);
  }, [userId, staffId, branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Online / offline ───────────────────────────────────────────
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Transactions ───────────────────────────────────────────────
  const addTransaction = async (t) => {
    const tempId = "tmp-" + uid();
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
    };

    setTransactions((p) => [{ ...payload, id: tempId }, ...p]);
    setDbError(null);

    const { data, error } = await supabase
      .from("transactions").insert(payload).select().single();

    if (error) {
      setTransactions((p) => p.filter((tx) => tx.id !== tempId));
      setDbError(`Failed to save transaction: ${error.message}`);
    } else {
      setTransactions((p) => p.map((tx) => tx.id === tempId ? data : tx));
      const label = t.item_name || t.category || "Transaction";
      if (t.payment_type === "bill_payment") {
        onNotify?.("bills", "Bill Payment", `${fmt(parseFloat(t.amount))} · ${label}`);
      } else if (t.type === "in") {
        onNotify?.("sales", "Sale Recorded", `${fmt(parseFloat(t.amount))} · ${label}`);
      } else {
        onNotify?.("sales", "Expense Recorded", `${fmt(parseFloat(t.amount))} · ${label}`);
      }
      if (staffId) {
        const amt = `${t.type === "in" ? "+" : "-"}₦${parseFloat(t.amount).toLocaleString()}`;
        const extra = [t.customer_name, t.payment_type].filter(Boolean).join(" · ");
        logAudit({ ownerId: userId, staffId, staffName: staffName || "Staff",
          action: `${t.type === "in" ? "Sale" : "Expense"}: ${t.item_name}`,
          module: "transactions",
          details: extra ? `${amt} · ${extra}` : amt });
      }
    }
  };

  const deleteTransaction = async (id) => {
    setTransactions((p) => p.filter((tx) => tx.id !== id));
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { console.error("deleteTransaction:", error); loadData(); }
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

    setCredits((p) => [{ ...payload, id: tempId }, ...p]);
    setDbError(null);

    const { data, error } = await supabase
      .from("credits").insert(payload).select().single();

    if (error) {
      setCredits((p) => p.filter((cr) => cr.id !== tempId));
      setDbError(`Failed to save credit: ${error.message}`);
      return { data: null, error };
    } else {
      setCredits((p) => p.map((cr) => cr.id === tempId ? data : cr));
      onNotify?.("credits", "Credit Added", `${fmt(parseFloat(c.total_amount || 0))} · ${c.customer_name}`);
      if (staffId) {
        const due = c.due_date ? ` · due ${c.due_date}` : "";
        logAudit({ ownerId: userId, staffId, staffName: staffName || "Staff",
          action: `Credit client added: ${c.customer_name}`,
          module: "credit",
          details: `₦${parseFloat(c.total_amount || 0).toLocaleString()} outstanding${due}` });
      }
      return { data, error: null };
    }
  };

  const repayCredit = async (id, amount) => {
    let updated;
    setCredits((p) => p.map((c) => {
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
      else { onNotify?.("payments", "Payment Received", `${fmt(amount)} from ${updated.customer_name}`); }
    }
  };

  // ── Aso Clients ────────────────────────────────────────────────
  const addAsoClient = async (cl) => {
    const tempId = "tmp-" + uid();
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
    };

    setAsoClients((p) => [{ ...payload, id: tempId }, ...p]);
    setDbError(null);

    const { data, error } = await supabase
      .from("aso_clients").insert(payload).select().single();

    if (error) {
      setAsoClients((p) => p.filter((c) => c.id !== tempId));
      setDbError(`Failed to save client: ${error.message}`);
      return { data: null, error };
    } else {
      setAsoClients((p) => p.map((c) => c.id === tempId ? data : c));
      if (staffId) {
        logAudit({ ownerId: userId, staffId, staffName: staffName || "Staff",
          action: `Aso client added: ${cl.full_name}`,
          module: "aso",
          details: `${cl.contribution_frequency || "daily"} · ₦${parseFloat(cl.contribution_amount || 0).toLocaleString()}/period` });
      }
      return { data, error: null };
    }
  };

  const asoContribute = async (id, amount) => {
    let updated;
    setAsoClients((p) => p.map((c) => {
      if (c.id !== id) return c;
      const freqDays = { daily: 1, weekly: 7, monthly: 30 };
      const days = freqDays[c.contribution_frequency] || 30;
      const base = c.next_contribution_date || today();
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      const nextDate = d.toISOString().split("T")[0];
      updated = {
        ...c,
        total_saved:            c.total_saved + amount,
        current_balance:        c.current_balance + amount,
        next_contribution_date: nextDate,
      };
      return updated;
    }));
    if (updated) {
      const { error } = await supabase.from("aso_clients")
        .update({
          total_saved:            updated.total_saved,
          current_balance:        updated.current_balance,
          next_contribution_date: updated.next_contribution_date,
        })
        .eq("id", id);
      if (error) { console.error("asoContribute:", error); loadData(); }
      else { onNotify?.("aso", "Contribution Received", `${fmt(amount)} from ${updated.full_name}`); }
    }
  };

  const asoWithdraw = async (id, amount) => {
    let updated;
    setAsoClients((p) => p.map((c) => {
      if (c.id !== id) return c;
      const fee = amount * (c.withdrawal_fee_percent / 100);
      const net = amount - fee;
      updated = { ...c, total_withdrawn: c.total_withdrawn + net, current_balance: c.current_balance - net };
      return updated;
    }));
    if (updated) {
      const { error } = await supabase.from("aso_clients")
        .update({ total_withdrawn: updated.total_withdrawn, current_balance: updated.current_balance })
        .eq("id", id);
      if (error) { console.error("asoWithdraw:", error); loadData(); }
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

  // ── Profile ────────────────────────────────────────────────────
  const setProfile = async (updater) => {
    const prev = profile;
    const next = typeof updater === "function" ? updater(prev) : updater;
    setProfileState(next);
    // Mirror dark_mode to localStorage so it's instant and works as a fallback
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
      // Store the clean URL (no ?v= query param) so the DB value stays stable.
      profile_image_url: next.profile_image_url
        ? next.profile_image_url.split("?")[0]
        : null,
      store_image_url: next.store_image_url
        ? next.store_image_url.split("?")[0]
        : null,
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
    setProfile, isOnline, loading, pendingSync: 0,
    dbError, clearDbError: () => setDbError(null), reloadData: loadData,
    addTransaction, deleteTransaction,
    addCredit, repayCredit, updateCredit,
    addAsoClient, asoContribute, asoWithdraw, updateAsoClient,
  };
}
