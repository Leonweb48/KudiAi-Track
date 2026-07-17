import Icon from "./Icon";

export default function SyncBar({ isOnline }) {
  if (isOnline) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-1.5 px-3 bg-red-500 text-white text-xs font-semibold">
      <Icon name="warn" size={13} />
      <span>Offline — transactions unavailable until connection is restored</span>
    </div>
  );
}
