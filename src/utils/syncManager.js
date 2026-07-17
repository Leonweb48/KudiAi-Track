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
