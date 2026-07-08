/**
 * FitText — the only permitted way to render any dynamic name, title, or label.
 *
 * Modes:
 *   lines=1 (default) — single-line, truncates with ellipsis at container edge.
 *                        Full text shown as native `title` (web hover) and on
 *                        long-press (mobile tap-and-hold).
 *   lines>1            — wraps up to `lines` lines then clips with ellipsis.
 *   minFontPx set      — auto-shrinks font before truncating (great for names
 *                        in receipt headers where the text must stay readable).
 *
 * Props:
 *   children   — string content (or React nodes; auto-shrink only works on strings)
 *   as         — HTML tag to render (default 'span')
 *   lines      — max lines before truncation (default 1)
 *   minFontPx  — if set, shrinks font to this floor before falling back to truncation
 *   className  — extra classes
 *   style      — extra inline styles
 *   title      — override the native title (auto-derived from string children)
 */
import { useState, useRef, useEffect, useCallback } from 'react';

export function FitText({
  children,
  as: Tag   = 'span',
  lines     = 1,
  minFontPx = null,
  className = '',
  style     = {},
  title:    titleProp,
}) {
  const containerRef = useRef(null);
  const testRef      = useRef(null);
  const [fontSize,   setFontSize]   = useState(null); // null = inherit
  const [showTip,    setShowTip]    = useState(false);

  const text = typeof children === 'string' ? children : null;
  const titleAttr = titleProp ?? text ?? undefined;

  const measure = useCallback(() => {
    if (!minFontPx || !text) return;
    const el  = containerRef.current;
    const tst = testRef.current;
    if (!el || !tst) return;
    const avail = el.clientWidth;
    if (avail <= 0) return;

    const cs       = window.getComputedStyle(el);
    const inherited = parseFloat(cs.fontSize) || 14;
    tst.style.fontWeight = cs.fontWeight;
    tst.style.fontFamily = 'inherit';
    tst.textContent = text;

    for (let fs = inherited; fs >= minFontPx; fs -= 0.5) {
      tst.style.fontSize = `${fs}px`;
      if (tst.scrollWidth <= avail) {
        setFontSize(Math.abs(fs - inherited) < 0.25 ? null : fs);
        return;
      }
    }
    setFontSize(minFontPx);
  }, [text, minFontPx]);

  useEffect(() => {
    if (!minFontPx) return;
    const el = containerRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, minFontPx]);

  // Long-press to show full text on mobile
  useEffect(() => {
    if (!showTip) return;
    const off = () => setShowTip(false);
    const t   = setTimeout(off, 2500);
    document.addEventListener('pointerdown', off, { capture: true });
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', off, { capture: true }); };
  }, [showTip]);

  const truncStyle = lines > 1
    ? {
        display:           '-webkit-box',
        WebkitLineClamp:   lines,
        WebkitBoxOrient:   'vertical',
        overflow:          'hidden',
      }
    : {
        overflow:          'hidden',
        whiteSpace:        'nowrap',
        textOverflow:      'ellipsis',
      };

  return (
    <Tag
      ref={containerRef}
      className={className || undefined}
      style={{
        display:  'block',
        minWidth: 0,
        position: 'relative',
        ...(fontSize ? { fontSize: `${fontSize}px` } : {}),
        ...truncStyle,
        ...style,
      }}
      title={titleAttr}
      onContextMenu={text ? (e) => { e.preventDefault(); setShowTip(v => !v); } : undefined}
    >
      {/* Measurement span for auto-shrink (only rendered when minFontPx is set) */}
      {minFontPx && (
        <span
          ref={testRef}
          aria-hidden="true"
          style={{
            position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap',
            pointerEvents: 'none', top: 0, left: 0,
          }}
        />
      )}

      {children}

      {/* Mobile long-press tooltip */}
      {showTip && titleAttr && (
        <span
          aria-live="polite"
          style={{
            position:  'absolute',
            bottom:    'calc(100% + 4px)',
            left:      0,
            zIndex:    9999,
            background:'#0f172a',
            color:     '#f8fafc',
            borderRadius: 8,
            padding:   '4px 10px',
            fontSize:  12,
            fontWeight:600,
            whiteSpace:'normal',
            maxWidth:  220,
            boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {titleAttr}
        </span>
      )}
    </Tag>
  );
}

export default FitText;
