import Icon from "./Icon";

export default function SyncBar({ isOnline, pending }) {
  if (isOnline && pending === 0) return null;

  return (
    <div
      className={`flex items-center justify-center gap-2 py-1.5 text-xs font-semibold ${
        isOnline ? "bg-amber-400 text-amber-900" : "bg-red-500 text-white"
      }`}
    >
      <Icon name={isOnline ? "refresh" : "warn"} size={13} />
      {isOnline
        ? `Syncing ${pending} pending record${pending > 1 ? "s" : ""}…`
        : "Offline mode — changes saved locally"}
    </div>
  );
}
