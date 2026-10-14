import { getPendingOps, markOpSynced } from "./offlineDb";

export async function syncPending(supabase, userId, onProgress) {
  if (!supabase || !userId) return { synced: 0, failed: 0, total: 0, errors: [] };

  const pending = await getPendingOps(userId);
  if (!pending.length) return { synced: 0, failed: 0, total: 0, errors: [] };

  let synced = 0;
  let failed = 0;
  const total = pending.length;
  const errors = [];

  for (const op of pending) {
    try {
      // Already has a supabase_id — just mark clean
      if (op.supabase_id) {
        await markOpSynced(op.local_id, op.supabase_id);
        synced++;
        onProgress?.({ synced, total, op });
        continue;
      }

      // A profile edit made offline (useStore.setProfile) — the newest one replaces older ones in the queue.
      if (op.table === "profile_update") {
        const { error: prErr } = await supabase.from("profiles").update(op.data || {}).eq("id", op.user_id);
        if (prErr) { errors.push(prErr.message || "Profile sync failed"); throw prErr; }
        await markOpSynced(op.local_id, "profile");
        synced++;
        onProgress?.({ synced, total, op });
        continue;
      }

      // A stock movement recorded offline (a sale's stock deduction, a restock, an adjustment — 2026-10-14). The movement
      // row keeps its own id, so a retry that finds it already saved changes nothing; only a first, successful insert
      // applies the quantity change — to the product's CURRENT quantity on the server (others may have sold meanwhile).
      if (op.table === "stock_movements") {
        const mov = op.data || {};
        const { error: insErr } = await supabase.from("stock_movements").insert(mov);
        if (insErr && insErr.code !== "23505") { errors.push(insErr.message || "Stock sync failed"); throw insErr; }
        if (!insErr) {
          const { data: prod, error: pErr } = await supabase.from("products").select("quantity").eq("id", mov.product_id).maybeSingle();
          if (pErr) throw pErr;
          if (prod) {
            const upd = { quantity: Math.max(0, Number(prod.quantity || 0) + Number(mov.quantity || 0)), updated_at: new Date().toISOString() };
            if (mov.type === "restock" && Number(mov.unit_price) > 0) Object.assign(upd, { cost_price: Number(mov.unit_price), needs_costing: false });
            const { error: uErr } = await supabase.from("products").update(upd).eq("id", mov.product_id);
            if (uErr) throw uErr;
          }
        }
        await markOpSynced(op.local_id, mov.id || "stock");
        synced++;
        onProgress?.({ synced, total, op });
        continue;
      }

      // Use upsert when the payload carries a client_txn_id so retries are
      // idempotent by construction — the unique index on the server prevents
      // a second row; the upsert returns the existing row so we get its id.
      const hasKey = !!op.data?.client_txn_id;
      const query = hasKey
        ? supabase.from(op.table).upsert(op.data, { onConflict: "client_txn_id" })
        : supabase.from(op.table).insert(op.data);

      const { data, error } = await query.select().single();

      if (error) {
        // Unique constraint (legacy rows without client_txn_id) → already inserted
        if (error.code === "23505") {
          await markOpSynced(op.local_id, "dedup");
          synced++;
          onProgress?.({ synced, total, op });
        } else {
          errors.push(error.message || error.code || "Unknown error");
          throw error;
        }
      } else {
        await markOpSynced(op.local_id, data.id);
        synced++;
        onProgress?.({ synced, total, data, op });
      }
    } catch (err) {
      const msg = err?.message || String(err);
      if (!errors.includes(msg)) errors.push(msg);
      console.warn("[sync] failed:", op.local_id, msg);
      failed++;
    }
  }

  return { synced, failed, total, errors };
}
