/**
 * AmountDisplay — the only permitted way to render currency values.
 *
 * Behaviour:
 *   1. Formats amount as ₦X,XXX.XX (full notation).
 *   2. Measures its container via ResizeObserver.
 *   3. If text doesn't fit, steps down font-size (up to 3 steps, min 11 px).
 *   4. If it still can't fit, switches to compact notation (₦35.9M, ₦1.2B).
 *   5. Full value always retrievable on tap (popover) when compact mode is active.
 *   6. Never wraps, never clips a sibling, never overflows its container.
 *
 * Props:
 *   amount     — number in naira (default) or kobo when fromKobo=true
 *   fromKobo   — boolean (default false)
 *   size       — 'hero' | 'stat' | 'row' | 'small'  (default 'stat')
 *   colorBy    — 'in' | 'out' | 'neutral' | null     (default null = inherit colour)
 *   align      — 'left' | 'right' | 'center'          (default 'left')
 *   className  — extra Tailwind classes on the root div
 *   style      — extra inline styles on the root div
 */
import { useState, useRef, useEffect, useCallback } from 'react';

const MIN_FONT_PX = 11;

const FMT = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function nairaFull(n) { return `₦${FMT.format(n)}`; }

function nairaCompact(n) {
  if (n >= 1e12) return `₦${(n / 1e12).toFixed(1).replace(/\.0$/, '')}T`;
  if (n >= 1e9)  return `₦${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6)  return `₦${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3)  return `₦${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return null;
}

const SIZE_CFG = {
  hero:  { base: 28, step: 4, weight: 800 },
  stat:  { base: 20, step: 3, weight: 700 },
  row:   { base: 15, step: 2, weight: 600 },
  small: { base: 13, step: 2, weight: 600 },
};

const COLOR = {
  in:      '#16a34a',
  out:     '#dc2626',
  neutral: '#64748b',
};

export function AmountDisplay({
  amount    = 0,
  fromKobo  = false,
  size      = 'stat',
  colorBy   = null,
  align     = 'left',
  hidden    = false,
  className = '',
  style     = {},
}) {
  const naira = fromKobo ? Number(amount || 0) / 100 : Number(amount || 0);
  const full   = nairaFull(naira);
  const cmpct  = nairaCompact(naira);
  const cfg    = SIZE_CFG[size] || SIZE_CFG.stat;

  const containerRef = useRef(null);
  const testSpanRef  = useRef(null);
  const [disp,       setDisp]       = useState({ text: full, isCompact: false, fontSize: cfg.base });
  const [tipVisible, setTipVisible] = useState(false);

  const fit = useCallback(() => {
    const el  = containerRef.current;
    const tst = testSpanRef.current;
    if (!el || !tst) return;
    const avail = el.clientWidth;
    if (avail <= 0) return;

    tst.style.fontWeight = String(cfg.weight);

    // Build the list of font-size steps to try (never below MIN_FONT_PX)
    const steps = [];
    for (let fs = cfg.base; fs >= MIN_FONT_PX; fs -= cfg.step) steps.push(fs);
    if (steps[steps.length - 1] > MIN_FONT_PX) steps.push(MIN_FONT_PX);

    // Try full notation at each step
    tst.textContent = full;
    for (const fs of steps) {
      tst.style.fontSize = `${fs}px`;
      if (tst.scrollWidth <= avail) {
        setDisp({ text: full, isCompact: false, fontSize: fs });
        return;
      }
    }

    // Fall back to compact notation at each step
    if (cmpct) {
      tst.textContent = cmpct;
      for (const fs of steps) {
        tst.style.fontSize = `${fs}px`;
        if (tst.scrollWidth <= avail) {
          setDisp({ text: cmpct, isCompact: true, fontSize: fs });
          return;
        }
      }
    }

    // Last resort — compact (or full) at minimum size
    setDisp({ text: cmpct || full, isCompact: !!cmpct, fontSize: MIN_FONT_PX });
  }, [full, cmpct, cfg]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Dismiss tooltip when tapping outside
  useEffect(() => {
    if (!tipVisible) return;
    const close = () => setTipVisible(false);
    document.addEventListener('pointerdown', close, { capture: true });
    return () => document.removeEventListener('pointerdown', close, { capture: true });
  }, [tipVisible]);

  const textAlign = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden${className ? ` ${className}` : ''}`}
      style={{ minWidth: 0, ...style }}
    >
      {/* Invisible measurement span — always in the DOM */}
      <span
        ref={testSpanRef}
        aria-hidden="true"
        style={{
          position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap',
          pointerEvents: 'none', top: 0, left: 0, fontFamily: 'inherit',
        }}
      />

      {/* Visible amount */}
      <span
        style={{
          display:           'block',
          fontSize:          `${disp.fontSize}px`,
          fontWeight:        cfg.weight,
          color:             colorBy ? COLOR[colorBy] : undefined,
          textAlign,
          whiteSpace:        'nowrap',
          lineHeight:        1.2,
          fontVariantNumeric:'tabular-nums',
          cursor:            (!hidden && disp.isCompact) ? 'pointer' : 'default',
          userSelect:        'none',
        }}
        onPointerDown={(!hidden && disp.isCompact) ? (e) => { e.stopPropagation(); setTipVisible(v => !v); } : undefined}
        title={(!hidden && disp.isCompact) ? full : undefined}
      >
        {hidden ? '••••••' : disp.text}
      </span>

      {/* Tap-to-reveal popover for compact mode */}
      {!hidden && disp.isCompact && tipVisible && (
        <div
          aria-live="polite"
          style={{
            position:  'absolute',
            bottom:    'calc(100% + 4px)',
            left:      textAlign === 'right' ? 'auto' : 0,
            right:     textAlign === 'right' ? 0 : 'auto',
            zIndex:    9999,
            background:'#0f172a',
            color:     '#f8fafc',
            borderRadius: 8,
            padding:   '4px 10px',
            fontSize:  12,
            fontWeight:600,
            whiteSpace:'nowrap',
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {full}
        </div>
      )}
    </div>
  );
}

export default AmountDisplay;
