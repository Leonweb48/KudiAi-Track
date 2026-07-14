const INDICATOR_H = 48;

export default function PullIndicator({ pullY, refreshing, dragging }) {
  const progress = Math.min(pullY / 56, 1);
  const visible  = pullY > 0 || refreshing;
  if (!visible) return null;

  return (
    <div
      style={{
        height: refreshing ? INDICATOR_H : pullY,
        overflow: "hidden",
        flexShrink: 0,
        // Only animate the collapse (finger-up). No transition while dragging/refreshing.
        transition: !dragging && !refreshing ? "height 0.28s cubic-bezier(0.16,1,0.3,1)" : "none",
      }}
    >
      <div style={{
        height: INDICATOR_H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: refreshing ? 1 : Math.min(progress * 1.6, 1),
      }}>
        <div className="w-8 h-8 rounded-full bg-white dark:bg-slate-800 shadow-md flex items-center justify-center">
          {refreshing ? (
            <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg
              width={14} height={14} viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
              className="text-brand-500"
              style={{ transform: `rotate(${progress * 360}deg)`, transition: "none" }}
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-4.5" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
