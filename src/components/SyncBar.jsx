import { useState, useEffect } from "react";
import Icon from "./Icon";
import { formatSyncTime } from "../utils/offlineCache";

export default function SyncBar({ isOnline, fromCache, dbError, loadError, lastSyncTime, syncing, syncResult }) {
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (!syncResult) { setShowResult(false); return; }
    setShowResult(true);
    const t = setTimeout(() => setShowResult(false), 4000);
    return () => clearTimeout(t);
  }, [syncResult]);

  if (dbError) return (
    <div className="flex-none flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800/30">
      <Icon name="warn" size={13} className="text-red-500 flex-shrink-0" />
      <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">Save failed — check connection</span>
    </div>
  );
  if (loadError) return (
    <div className="flex-none flex items-center gap-2 px-4 py-2 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-800/30">
      <Icon name="warn" size={13} className="text-orange-500 flex-shrink-0" />
      <span className="text-[11px] font-semibold text-orange-700 dark:text-orange-300">Data couldn't be loaded — pull down to retry</span>
    </div>
  );
  if (!isOnline && fromCache) return (
    <div className="flex-none flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800/30">
      <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
      <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
        No network — showing your data{lastSyncTime ? ` from ${formatSyncTime(lastSyncTime)}` : ""}
      </span>
    </div>
  );
  if (!isOnline) return (
    <div className="flex-none flex items-center justify-center gap-2 py-1.5 px-3 bg-red-500 text-white text-xs font-semibold">
      <Icon name="warn" size={13} />
      <span>Offline — transactions unavailable until connection is restored</span>
    </div>
  );
  if (syncing) return (
    <div className="flex-none flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800/30">
      <svg className="animate-spin h-3 w-3 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">Back online — syncing…</span>
    </div>
  );
  if (showResult && syncResult) return (
    <div className="flex-none flex items-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-green-100 dark:border-green-800/30">
      <Icon name="check" size={13} className="text-green-500 flex-shrink-0" />
      <span className="text-[11px] font-semibold text-green-700 dark:text-green-300">{syncResult}</span>
    </div>
  );
  return null;
}
