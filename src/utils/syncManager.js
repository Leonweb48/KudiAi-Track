import { getPendingOps, markOpSynced } from "./offlineDb";

export async function syncPending(supabase, userId, onProgress) {
  if (!supabase || !userId) return { synced: 0, failed: 0, total: 0 };

  const pending = await getPendingOps(userId);
  if (!pending.length) return { synced: 0, failed: 0, total: 0 };

  let synced = 0;
  let failed = 0;
  const total = pending.length;

  for (const op of pending) {
    try {
      // Already has a supabase_id — just mark clean
      if (op.supabase_id) {
        await markOpSynced(op.local_id, op.supabase_id);
        synced++;
        onProgress?.({ synced, total, op });
        continue;
      }

      const { data, error } = await supabase
        .from(op.table)
        .insert(op.data)
        .select()
        .single();

      if (error) {
        // Unique constraint → already inserted, mark clean
        if (error.code === "23505") {
          await markOpSynced(op.local_id, "dedup");
          synced++;
          onProgress?.({ synced, total, op });
        } else {
          throw error;
        }
      } else {
        await markOpSynced(op.local_id, data.id);
        synced++;
        onProgress?.({ synced, total, data, op });
      }
    } catch (err) {
      console.warn("[sync] failed:", op.local_id, err?.message);
      failed++;
    }
  }

  return { synced, failed, total };
}
