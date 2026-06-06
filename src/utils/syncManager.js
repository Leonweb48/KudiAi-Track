/**
 * KudiTrack AI — Sync Manager
 * Detects online/offline state and pushes pending transactions to backend.
 */

import { getPendingTransactions, markTransactionSynced } from "./offlineDb";

/**
 * Attempt to sync all pending offline transactions to the backend.
 * Replace the fetch URL and logic with your real API endpoint.
 */
export async function syncPendingTransactions(onProgress) {
  const pending = await getPendingTransactions();
  if (!pending.length) return 0;

  let synced = 0;
  for (const tx of pending) {
    try {
      // Replace with real API call, e.g.:
      // await fetch("/api/transactions", { method: "POST", body: JSON.stringify(tx) });
      await new Promise((r) => setTimeout(r, 200)); // simulated network delay
      await markTransactionSynced(tx.local_id);
      synced++;
      if (onProgress) onProgress(synced, pending.length);
    } catch (err) {
      console.warn("Sync failed for tx:", tx.local_id, err);
    }
  }
  return synced;
}
