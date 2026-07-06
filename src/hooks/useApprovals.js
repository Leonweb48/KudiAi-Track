import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

/**
 * Approval workflow for refunds and discounts.
 *
 * Owner view: pass only ownerId — sees all pending requests.
 * Staff view: pass ownerId + staffId — sees own requests.
 */
export function useApprovals(ownerId, staffId = null) {
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    const q = supabase
      .from("approval_requests")
      .select("*, staff(full_name, role)")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (staffId) q.eq("staff_id", staffId);

    const { data } = await q;
    setRequests(data || []);
    setLoading(false);
  }, [ownerId, staffId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ownerId) return;
    const ch = supabase
      .channel(`approvals_${ownerId}${staffId || ""}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests",
          filter: `owner_id=eq.${ownerId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ownerId, staffId, load]);

  const submitRequest = useCallback(async ({ type, amount, discountPct, entityType, entityData, reason }) => {
    if (!staffId) return { error: { message: "No staff ID" } };
    const { data, error } = await supabase.from("approval_requests").insert({
      owner_id:    ownerId,
      staff_id:    staffId,
      type,
      amount:      amount      || null,
      discount_pct: discountPct || null,
      entity_type: entityType  || null,
      entity_data: entityData  || null,
      reason:      reason      || null,
    }).select().single();
    if (!error) await load();
    return { data, error };
  }, [ownerId, staffId, load]);

  const approve = useCallback(async (id, note = "") => {
    const { error } = await supabase.from("approval_requests").update({
      status:      "approved",
      actioned_at: new Date().toISOString(),
      action_note: note,
    }).eq("id", id).eq("owner_id", ownerId);
    if (!error) await load();
    return error;
  }, [ownerId, load]);

  const reject = useCallback(async (id, note = "") => {
    const { error } = await supabase.from("approval_requests").update({
      status:      "rejected",
      actioned_at: new Date().toISOString(),
      action_note: note,
    }).eq("id", id).eq("owner_id", ownerId);
    if (!error) await load();
    return error;
  }, [ownerId, load]);

  const pendingCount = requests.filter(r => r.status === "pending").length;
  const pending      = requests.filter(r => r.status === "pending");

  return { requests, pending, pendingCount, loading, submitRequest, approve, reject, reload: load };
}
