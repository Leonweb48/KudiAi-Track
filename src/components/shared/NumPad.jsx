const KEY = [
  "flex items-center justify-center rounded-2xl",
  "bg-slate-100 dark:bg-slate-800",
  "border border-slate-200 dark:border-slate-700/60",
  "text-slate-800 dark:text-slate-100 font-bold text-[22px]",
  "active:scale-[.91] active:bg-slate-200 dark:active:bg-slate-700",
  "transition-transform duration-75 select-none touch-manipulation",
].join(" ");

function BackspaceIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/>
      <line x1="18" y1="9" x2="13" y2="14"/>
      <line x1="13" y1="9" x2="18" y2="14"/>
    </svg>
  );
}

export default function NumPad({ value = "", onChange, hasDot = true }) {
  const press = (key) => {
    const prev = value || "";
    let next;
    if (key === "backspace") {
      next = prev.slice(0, -1);
    } else if (key === ".") {
      next = prev.includes(".") ? prev : prev + ".";
    } else {
      if (prev === "" && key === "0") return onChange(prev);
      const candidate = prev + key;
      const parts = candidate.split(".");
      if (parts[1] !== undefined && parts[1].length > 2) return onChange(prev);
      if ((parts[0] || "").length > 10) return onChange(prev);
      next = candidate;
    }
    onChange(next);
  };

  return (
    <div className="grid grid-cols-3 gap-3">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
        <button key={n} type="button"
          onPointerDown={e => { e.preventDefault(); press(String(n)); }}
          className={KEY} style={{ minHeight: 68 }}>
          {n}
        </button>
      ))}
      <button type="button"
        onPointerDown={e => { e.preventDefault(); if (hasDot) press("."); }}
        className={hasDot ? KEY : `${KEY} opacity-0 pointer-events-none`}
        style={{ minHeight: 68 }}>
        .
      </button>
      <button type="button"
        onPointerDown={e => { e.preventDefault(); press("0"); }}
        className={KEY} style={{ minHeight: 68 }}>
        0
      </button>
      <button type="button"
        onPointerDown={e => { e.preventDefault(); press("backspace"); }}
        className={`${KEY} text-slate-500 dark:text-slate-400`}
        style={{ minHeight: 68 }}>
        <BackspaceIcon />
      </button>
    </div>
  );
}
