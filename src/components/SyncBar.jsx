import Icon from "./Icon";

export default function SyncBar({ isOnline, fromCache, dbError, loadError }) {
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
  if (fromCache && !isOnline) return (
    <div className="flex-none flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800/30">
      <Icon name="warn" size={13} className="text-amber-500 flex-shrink-0" />
      <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Offline — showing cached data</span>
    </div>
  );
  if (!isOnline) return (
    <div className="flex-none flex items-center justify-center gap-2 py-1.5 px-3 bg-red-500 text-white text-xs font-semibold">
      <Icon name="warn" size={13} />
      <span>Offline — transactions unavailable until connection is restored</span>
    </div>
  );
  return null;
}
