import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

/**
 * Load commission rules and earnings for a staff member (staff view)
 * or all staff for an owner (owner view).
 *
 * @param {string} ownerId   - The business owner's user_id
 * @param {string} [staffId] - If provided, scopes earnings to this staff member
 */
export function useCommissions(ownerId, staffId = null) {
  const [rules,    setRules]    = useState([]);
  const [earnings, setEarnings] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    const [rulesRes, earningsRes] = await Promise.all([
      supabase
        .from("commission_rules")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false }),
      staffId
        ? supabase
            .from("commission_earnings")
            .select("*, transactions(item_name, transaction_date, type)")
            .eq("owner_id", ownerId)
            .eq("staff_id", staffId)
            .order("earned_at", { ascending: false })
            .limit(200)
        : supabase
            .from("commission_earnings")
            .select("*, staff(full_name)")
            .eq("owner_id", ownerId)
            .order("earned_at", { ascending: false })
            .limit(500),
    ]);
    setRules(rulesRes.data   || []);
    setEarnings(earningsRes.data || []);
    setLoading(false);
  }, [ownerId, staffId]);

  useEffect(() => { load(); }, [load]);

  // Real-time: re-fetch when commission_earnings changes
  useEffect(() => {
    if (!ownerId) return;
    const ch = supabase
      .channel(`commissions_${ownerId}${staffId || ""}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "commission_earnings",
          filter: `owner_id=eq.${ownerId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ownerId, staffId, load]);

  const addRule = useCallback(async (rule) => {
    const { error } = await supabase.from("commission_rules").upsert(
      { owner_id: ownerId, ...rule },
      { onConflict: "owner_id,staff_id,category,applies_to" },
    );
    if (!error) await load();
    return error;
  }, [ownerId, load]);

  const deleteRule = useCallback(async (id) => {
    const { error } = await supabase.from("commission_rules").delete().eq("id", id);
    if (!error) await load();
    return error;
  }, [load]);

  const recordEarning = useCallback(async ({ staffId: sid, transactionId, ruleId, amount, ratePercent, basisAmount }) => {
    const { error } = await supabase.from("commission_earnings").insert({
      owner_id:       ownerId,
      staff_id:       sid,
      transaction_id: transactionId || null,
      rule_id:        ruleId        || null,
      amount,
      rate_percent:   ratePercent,
      basis_amount:   basisAmount,
    });
    return error;
  }, [ownerId]);

  const markPaid = useCallback(async (ids) => {
    const { error } = await supabase
      .from("commission_earnings")
      .update({ status: "paid" })
      .in("id", ids);
    if (!error) await load();
    return error;
  }, [load]);

  // Derived totals
  const thisMonth = new Date().toISOString().slice(0, 7);
  const pendingTotal = earnings
    .filter(e => e.status === "pending")
    .reduce((s, e) => s + Number(e.amount), 0);
  const thisMonthTotal = earnings
    .filter(e => e.status !== "voided" && (e.earned_at || "").startsWith(thisMonth))
    .reduce((s, e) => s + Number(e.amount), 0);

  return { rules, earnings, loading, pendingTotal, thisMonthTotal, addRule, deleteRule, recordEarning, markPaid, reload: load };
}
