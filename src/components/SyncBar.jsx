import { useState, useEffect, useRef } from "react";
import Icon from "./Icon";

export default function SyncBar({ isOnline, pending, isSyncing, onSync }) {
  const [justSynced, setJustSynced] = useState(false);
  const prevSyncing = useRef(false);

  // Flash "All synced" for 3 s after sync completes
  useEffect(() => {
    if (prevSyncing.current && !isSyncing && pending === 0 && isOnline) {
      setJustSynced(true);
      const t = setTimeout(() => setJustSynced(false), 3000);
      prevSyncing.current = false;
      return () => clearTimeout(t);
    }
    if (isSyncing) prevSyncing.current = true;
  }, [isSyncing, pending, isOnline]);

  if (isOnline && pending === 0 && !isSyncing && !justSynced) return null;

  // ── Offline ──────────────────────────────────────────────────
  if (!isOnline) {
    return (
      <div className="flex items-center justify-center gap-2 py-1.5 px-3 bg-red-500 text-white text-xs font-semibold">
        <Icon name="warn" size={13} />
        <span>
          Offline
          {pending > 0 && (
            <span className="ml-1 bg-white/25 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {pending} unsaved
            </span>
          )}
        </span>
        {pending > 0 && (
          <span className="ml-auto text-[10px] text-white/70 font-normal">
            Changes saved locally
          </span>
        )}
      </div>
    );
  }

  // ── Syncing in progress ───────────────────────────────────────
  if (isSyncing) {
    return (
      <div className="flex items-center justify-center gap-2 py-1.5 px-3 bg-amber-400 text-amber-900 text-xs font-semibold">
        <div className="w-3 h-3 border-2 border-amber-700/40 border-t-amber-900 rounded-full animate-spin flex-shrink-0" />
        <span>
          Syncing
          {pending > 0 && (
            <span className="ml-1 bg-amber-900/15 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {pending} left
            </span>
          )}
          …
        </span>
      </div>
    );
  }

  // ── Pending but not syncing (tap to retry) ────────────────────
  if (pending > 0) {
    return (
      <button
        onClick={onSync}
        className="w-full flex items-center justify-center gap-2 py-1.5 px-3 bg-amber-400 text-amber-900 text-xs font-semibold active:bg-amber-500 transition-colors"
      >
        <Icon name="warn" size={13} />
        <span>
          {pending} pending record{pending !== 1 ? "s" : ""} — tap to sync
        </span>
      </button>
    );
  }

  // ── Just synced flash ─────────────────────────────────────────
  return (
    <div className="flex items-center justify-center gap-2 py-1.5 px-3 bg-green-500 text-white text-xs font-semibold">
      <Icon name="check" size={13} />
      All records synced
    </div>
  );
}
