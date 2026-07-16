import { useState, useRef, useEffect } from "react";
import { AmountDisplay } from "./AmountDisplay";

/* ── Tiny SVG renderer ──────────────────────────────────────────────── */
function Svg({ d, size = 18, color = "currentColor", sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/* ── Capitalise first character ─────────────────────────────────────── */
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

/* ── Icon / colour map — single source of truth for all six variants ── */
export function getTxStyle(tx) {
  if (tx.payment_type === "bill_payment") return {
    bg:    "bg-cyan-100 dark:bg-cyan-900/30",
    color: "#0891b2",
    icon:  "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2|M9 5a2 2 0 002 2h2a2 2 0 002-2|M9 5a2 2 0 012-2h2a2 2 0 012 2|M9 13h6|M9 17h4",
  };
  if (tx.category === "credit sale") return {
    bg:    "bg-amber-100 dark:bg-amber-900/30",
    color: "#d97706",
    icon:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2|M9 11a4 4 0 100-8 4 4 0 000 8",
  };
  if (tx.category === "debt repayment") return {
    bg:    "bg-blue-100 dark:bg-blue-900/30",
    color: "#2563eb",
    icon:  "M3 22h18|M6 18v-7|M10 18v-7|M14 18v-7|M18 18v-7|M12 2L2 7h20L12 2z",
  };
  if (tx.category === "stock") return {
    bg:    "bg-slate-100 dark:bg-slate-700/60",
    color: "#475569",
    icon:  "M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z|M3.27 6.96L12 12.01l8.73-5.05|M12 22.08V12",
  };
  if (tx.type === "in") return {
    bg:    "bg-green-100 dark:bg-green-900/30",
    color: "#16a34a",
    icon:  "M12 19V5|M5 12l7-7 7 7",
  };
  return {
    bg:    "bg-red-100 dark:bg-red-900/30",
    color: "#ef4444",
    icon:  "M12 5v14|M19 12l-7 7-7-7",
  };
}

const RECEIPT_ICON = "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z|M14 2v6h6|M16 13H8|M16 17H8";
const TRASH_ICON   = "M3 6h18|M8 6V4h8v2|M19 6l-1 14H6L5 6";

/* ═══════════════════════════════════════════════════════════════════════
   Home variant — compact, no swipe
   ═══════════════════════════════════════════════════════════════════════ */
function TxRowHome({ tx, hidden, onClick }) {
  const isIn  = tx.type === "in";
  const style = getTxStyle(tx);
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-card border border-slate-100 dark:border-slate-700/50 active:scale-[0.98] transition-transform">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${style.bg}`}>
        <Svg d={style.icon} size={15} color={style.color} sw={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{tx.item_name || "Transaction"}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate capitalize">
          {tx.category} · {tx.payment_type}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <AmountDisplay
          amount={tx.amount} size="row" align="right" hidden={hidden}
          className={isIn ? "text-green-600 dark:text-green-400" : "text-[#16255A] dark:text-blue-300"}
        />
        <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5">{tx.transaction_date}</p>
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Transactions variant — richer subtitle, swipe-to-reveal Receipt+Delete
   ═══════════════════════════════════════════════════════════════════════ */
function TxRowTransactions({ tx, hidden, onClick, staffName, onSwipeReceipt, onSwipeDelete }) {
  const isIn   = tx.type === "in";
  const style  = getTxStyle(tx);
  const ACTION = 88; // 2 × 44 px buttons

  const [offset,  setOffset]  = useState(0);
  const offsetRef             = useRef(0);
  const touchRef              = useRef({ startX: 0, startY: 0, intent: null, base: 0 });
  const didSwipe              = useRef(false);
  const wrapRef               = useRef(null);

  /* Keep offsetRef in sync so touch handler can read current value */
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  /* Attach { passive: false } touchmove so preventDefault works */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const onStart = (e) => {
      const t = e.touches[0];
      touchRef.current = { startX: t.clientX, startY: t.clientY, intent: null, base: offsetRef.current };
      didSwipe.current = false;
    };

    const onMove = (e) => {
      const t  = e.touches[0];
      const dx = t.clientX - touchRef.current.startX;
      const dy = t.clientY - touchRef.current.startY;
      if (touchRef.current.intent === null) {
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax > ay * 1.5 && ax > 8)     touchRef.current.intent = "h";
        else if (ay > ax * 1.5 && ay > 8) touchRef.current.intent = "v";
      }
      if (touchRef.current.intent === "h") {
        e.preventDefault();
        didSwipe.current = true;
        setOffset(Math.max(-ACTION, Math.min(0, touchRef.current.base + dx)));
      }
    };

    const onEnd = () => {
      if (touchRef.current.intent === "h") {
        setOffset(o => (o < -(ACTION / 2) ? -ACTION : 0));
      }
    };

    el.addEventListener("touchstart", onStart,  { passive: true });
    el.addEventListener("touchmove",  onMove,   { passive: false });
    el.addEventListener("touchend",   onEnd,    { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove",  onMove);
      el.removeEventListener("touchend",   onEnd);
    };
  }, []);

  const close = () => setOffset(0);
  const isSnapped = offset === 0 || offset === -ACTION;

  const handleRowClick = () => {
    if (didSwipe.current) { didSwipe.current = false; return; }
    if (offset < -4) { close(); return; }
    onClick?.();
  };

  const parts = [tx.customer_name, cap(tx.category), tx.payment_type].filter(Boolean);

  return (
    <div
      ref={wrapRef}
      className="relative rounded-2xl overflow-hidden shadow-card border border-slate-100 dark:border-slate-700/50 mb-2"
      style={{ contain: "layout" }}>

      {/* ── Action strip (sits behind the sliding row) ── */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: ACTION }}>
        <button
          onClick={() => { close(); onSwipeReceipt?.(); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-slate-700 dark:bg-slate-600 active:opacity-70 min-h-[44px]">
          <Svg d={RECEIPT_ICON} size={16} color="white" sw={2} />
          <span className="text-[9px] font-bold text-white">Receipt</span>
        </button>
        <button
          onClick={() => { onSwipeDelete?.(tx.id); close(); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-red-500 active:opacity-70 min-h-[44px]">
          <Svg d={TRASH_ICON} size={16} color="white" sw={2} />
          <span className="text-[9px] font-bold text-white">Delete</span>
        </button>
      </div>

      {/* ── Sliding row content ── */}
      <div
        onClick={handleRowClick}
        role="button"
        tabIndex={0}
        className="relative flex items-start gap-3 bg-white dark:bg-slate-800 px-4 py-3.5"
        style={{
          transform:  `translateX(${offset}px)`,
          transition: isSnapped ? "transform 0.2s cubic-bezier(0.25,0.46,0.45,0.94)" : "none",
          zIndex:     1,
          willChange: "transform",
          cursor:     "pointer",
        }}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${style.bg}`}>
          <Svg d={style.icon} size={15} color={style.color} sw={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate flex-1">
              {tx.item_name || "Transaction"}
            </p>
            <div className="text-right flex-shrink-0 ml-2">
              <AmountDisplay
                amount={tx.amount} size="row" align="right" hidden={hidden}
                className={isIn ? "text-green-600 dark:text-green-400" : "text-[#16255A] dark:text-blue-300"}
              />
              <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5">{tx.transaction_date}</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
            {parts.join(" · ")}
          </p>
          {(tx.quantity > 1 || staffName) && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {tx.quantity > 1 && (
                <span className="text-[9px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full font-semibold">
                  ×{tx.quantity}
                </span>
              )}
              {staffName && (
                <span className="text-[9px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full font-semibold">
                  {staffName}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Public export — variant prop routes to the correct implementation
   ═══════════════════════════════════════════════════════════════════════ */
export function TxRow({ tx, hidden = false, onClick, variant = "home", staffName, onSwipeReceipt, onSwipeDelete }) {
  if (variant === "transactions") {
    return (
      <TxRowTransactions
        tx={tx} hidden={hidden} onClick={onClick}
        staffName={staffName}
        onSwipeReceipt={onSwipeReceipt}
        onSwipeDelete={onSwipeDelete}
      />
    );
  }
  return <TxRowHome tx={tx} hidden={hidden} onClick={onClick} />;
}

export default TxRow;
