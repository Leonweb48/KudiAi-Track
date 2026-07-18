/**
 * Shareable KudiAI receipt — OPay-style ticket card.
 *
 * Capture-safety rules applied throughout:
 *  - All inline styles; no external CSS classes (html2canvas won't see them).
 *  - No display:table / table-cell (partial html2canvas support).
 *  - No borderRadius percentages — pixel values only.
 *  - No borderTop:dashed — SVG strokeDasharray instead.
 *  - No inset shorthand — explicit top/right/bottom/left.
 *  - No inline-block + background — flex centering only.
 *  - Transforms only on block/flex elements (not on <span>/<a>).
 *  - Pill uses explicit height + display:flex + alignItems:center
 *    (not padding-derived height) so background clips to the fixed box.
 *  - Amount formatted with locale-independent regex (toLocaleString('en-NG')
 *    is unavailable in some Android WebViews and falls back to period separators).
 */
import { getProviderLogo, getProviderBadge } from '../../utils/logoMap';

const NAVY       = '#0f1c45';
const GREEN      = '#3da829';
const OUTER_BG   = '#f1f5f9';
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

// Locale-independent: always produces ₦15,000.00 regardless of WebView locale.
function fmtAmt(n) {
  const [int, dec] = Number(n || 0).toFixed(2).split('.');
  return '₦' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

function statusProps(status) {
  if (status === 'success')                         return { label: 'Successful', color: '#0f7b3e', bg: '#dcfce7' };
  if (status === 'pending' || status === 'processing') return { label: 'Pending',    color: '#92400e', bg: '#fef3c7' };
  if (status === 'failed')                          return { label: 'Failed',     color: '#991b1b', bg: '#fee2e2' };
  if (status === 'reversed')                        return { label: 'Reversed',   color: '#374151', bg: '#f3f4f6' };
  if (status) console.warn('[ReceiptCard] Unknown status:', status);
  return { label: 'Pending', color: '#92400e', bg: '#fef3c7' };
}

// ── Diagonal "KudiAI" watermark ───────────────────────────────────────────────
// Uses <div> not <span>: html2canvas applies CSS transforms reliably to
// block-level elements. inset shorthand replaced with explicit sides.
function Watermark() {
  const items = [];
  for (let row = -1; row < 12; row++) {
    for (let col = -1; col < 5; col++) {
      items.push(
        <div key={`${row}-${col}`} style={{
          position:      'absolute',
          top:           `${row * 38 + 8}px`,
          left:          `${col * 70 - 8}px`,
          transform:     'rotate(-30deg)',
          fontSize:      '10px',
          fontWeight:    '800',
          fontFamily:    FONT_STACK,
          color:         (row + col) % 2 === 0 ? NAVY : GREEN,
          opacity:       0.042,
          whiteSpace:    'nowrap',
          userSelect:    'none',
          pointerEvents: 'none',
          letterSpacing: '0.08em',
        }}>KudiAI</div>
      );
    }
  }
  return (
    <div style={{
      position:      'absolute',
      top:           0,
      right:         0,
      bottom:        0,
      left:          0,
      overflow:      'hidden',
      pointerEvents: 'none',
      zIndex:        1,
    }}>
      {items}
    </div>
  );
}

// ── Scalloped edge (SVG semicircles cut from the white card) ─────────────────
function ScallopEdge({ flip }) {
  const count = 22, W = 340, H = 14, r = 7;
  const step  = W / count;
  const circles = Array.from({ length: count }, (_, i) => (
    <circle key={i} cx={(i + 0.5) * step} cy={flip ? 0 : H} r={r} fill={OUTER_BG} />
  ));
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      style={{ display: 'block', transform: flip ? 'scaleY(-1)' : 'none' }}
    >
      <rect width={W} height={H} fill="white" />
      {circles}
    </svg>
  );
}

// ── Ticket-style dashed divider with notch circles ────────────────────────────
// SVG strokeDasharray replaces borderTop:dashed (html2canvas renders dashed
// borders as solid). borderRadius pixel value replaces '50%' (percentage
// radii render inconsistently in html2canvas v1).
function DashedDivider() {
  return (
    <div style={{ position: 'relative', margin: '12px -20px', display: 'flex', alignItems: 'center' }}>
      <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: OUTER_BG, flexShrink: 0 }} />
      <div style={{ flex: 1, height: 2 }}>
        <svg
          viewBox="0 0 100 2"
          width="100%"
          height="2"
          preserveAspectRatio="none"
          style={{ display: 'block' }}
        >
          <line
            x1="0" y1="1" x2="100" y2="1"
            stroke="#e2e8f0"
            strokeWidth="2"
            strokeDasharray="6 4"
            strokeLinecap="butt"
          />
        </svg>
      </div>
      <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: OUTER_BG, flexShrink: 0 }} />
    </div>
  );
}

// ── Semantic icon for non-bill receipts (income, ajo, savings, credit, etc.) ──
function ReceiptTypeIcon({ iconType, direction, status }) {
  const failed  = status === 'failed';
  const pending = status === 'pending' || status === 'processing';

  const THEMES = {
    income:    { bg: failed ? '#fee2e2' : pending ? '#fef3c7' : '#dcfce7', fg: failed ? '#991b1b' : pending ? '#92400e' : '#0f7b3e' },
    expense:   { bg: failed ? '#fee2e2' : pending ? '#fef3c7' : '#e0e7ff', fg: failed ? '#991b1b' : pending ? '#92400e' : '#3730a3' },
    ajo:       { bg: failed ? '#fee2e2' : pending ? '#fef3c7' : '#fdf4ff', fg: failed ? '#991b1b' : pending ? '#92400e' : '#7c3aed' },
    savings:   { bg: failed ? '#fee2e2' : pending ? '#fef3c7' : '#eff6ff', fg: failed ? '#991b1b' : pending ? '#92400e' : '#1d4ed8' },
    credit:    { bg: failed ? '#fee2e2' : pending ? '#fef3c7' : '#fff7ed', fg: failed ? '#991b1b' : pending ? '#92400e' : '#c2410c' },
    statement: { bg: '#f1f5f9', fg: '#475569' },
  };
  const key   = iconType || (direction === 'in' ? 'income' : 'expense');
  const theme = THEMES[key] || THEMES.expense;
  const fg    = theme.fg;

  let icon;
  if (key === 'income') {
    icon = (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 16V4"/><path d="M8 12l4 4 4-4"/><path d="M4 20h16"/>
      </svg>
    );
  } else if (key === 'expense') {
    icon = (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8v12"/><path d="M8 12l4-4 4 4"/><path d="M4 4h16"/>
      </svg>
    );
  } else if (key === 'ajo') {
    icon = (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    );
  } else if (key === 'savings') {
    icon = (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    );
  } else if (key === 'credit') {
    icon = (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2"/>
        <line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
    );
  } else if (key === 'statement') {
    icon = (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2.5} strokeLinecap="round">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    );
  } else {
    icon = (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        {direction === 'in'
          ? <><path d="M12 16V4"/><path d="M8 12l4 4 4-4"/></>
          : <><path d="M12 8v12"/><path d="M8 12l4-4 4 4"/></>
        }
      </svg>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '10px 0 2px', position: 'relative', zIndex: 2 }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: theme.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
      }}>
        {icon}
      </div>
    </div>
  );
}

// ── Provider logo image or colored initials badge ─────────────────────────────
function ProviderBadge({ provider, category }) {
  const logoPath = getProviderLogo(provider, category);
  const badge    = getProviderBadge(provider, category);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '10px 0 2px', position: 'relative', zIndex: 2 }}>
      {logoPath ? (
        <img
          src={logoPath}
          alt={provider || ''}
          style={{ height: 40, width: 'auto', maxWidth: 88, objectFit: 'contain', borderRadius: 8 }}
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
      ) : (
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: badge.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: badge.fg, letterSpacing: '-0.01em' }}>
            {badge.initials}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main receipt card ─────────────────────────────────────────────────────────
export function ReceiptCard({ data, innerRef }) {
  const {
    title, direction, status, amount, datetime,
    fields = [], businessName, issuedBy, receiptRef,
    provider, category, processorName, iconType,
  } = data;

  const st           = statusProps(status);
  const showProvider = !!(provider || category);
  const amtColor     = status === 'success' ? '#0f7b3e' :
                       status === 'failed'  ? '#dc2626' : NAVY;

  const printFields = fields.filter(f => !f.retrievable);

  return (
    <div ref={innerRef} style={{ background: OUTER_BG, padding: '0 16px 16px', fontFamily: FONT_STACK }}>

      {/* Top scallop */}
      <ScallopEdge />

      {/* White receipt body */}
      <div style={{ background: 'white', position: 'relative', overflow: 'hidden', padding: '16px 20px 0' }}>
        <Watermark />

        {/* Header: flex row replaces display:table / table-cell (html2canvas
            partial support). Left group stacks logo + label via flex column. */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <img
              src="/logo.png" alt=""
              style={{ width: 20, height: 20, borderRadius: 4, display: 'block' }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
            <span style={{ display: 'block', fontSize: 9, fontWeight: 700, color: GREEN, letterSpacing: '-0.01em', lineHeight: '13px', whiteSpace: 'nowrap', marginTop: 2 }}>
              KudiAI Track
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            {category ? 'Bill' : 'Transaction'} Receipt
          </span>
        </div>

        {/* Provider logo (bills) or semantic type icon (all other receipts) */}
        {showProvider
          ? <ProviderBadge provider={provider} category={category} />
          : <ReceiptTypeIcon iconType={iconType} direction={direction} status={status} />
        }

        {/* Title subtitle */}
        <p style={{ margin: '6px 0 0', fontSize: 10.5, fontWeight: 600, color: '#64748b', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          {title}
        </p>

        {/* Separator */}
        <div style={{ height: 1, background: '#f1f5f9', margin: '10px 0 6px', position: 'relative', zIndex: 2 }} />

        {/* Amount hero */}
        <div style={{ textAlign: 'center', padding: '6px 0 4px', position: 'relative', zIndex: 2, overflow: 'hidden' }}>
          <p style={{ margin: 0, fontSize: 30, fontWeight: 800, color: amtColor, letterSpacing: '-0.03em', lineHeight: 1.1, wordBreak: 'break-all', maxWidth: '100%' }}>
            {fmtAmt(amount)}
          </p>

          {/* Status pill — capture-safe construction:
              • Outer flex centers without inline-block + background (the v1 blob bug).
              • Explicit height:28 + display:flex + alignItems:center — size is
                determined by the fixed box, not by asymmetric padding, so
                html2canvas clips background to the exact pixel box.
              • borderRadius:20px (pixel, not %) — percentage radii are
                mis-rendered by html2canvas v1. */}
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
            <div data-receipt-pill="true" style={{
              display:        'flex',
              alignItems:     'center',
              height:         28,
              paddingLeft:    18,
              paddingRight:   18,
              background:     st.bg,
              borderRadius:   20,
              fontSize:       11,
              fontWeight:     700,
              color:          st.color,
              lineHeight:     '28px',
              whiteSpace:     'nowrap',
            }}>
              {st.label}
            </div>
          </div>

          <p style={{ margin: '8px 0 0', fontSize: 10.5, color: '#94a3b8', fontWeight: 500 }}>
            {datetime}
          </p>
        </div>

        <DashedDivider />

        {/* Detail field rows */}
        <div style={{ position: 'relative', zIndex: 2 }}>
          {printFields.map((field, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              padding: '7px 0',
              borderBottom: i < printFields.length - 1 ? '0.5px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 500, flexShrink: 0, minWidth: 100, paddingRight: 8 }}>
                {field.label}
              </span>
              <span style={{ fontSize: 10.5, color: '#1e293b', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word', maxWidth: '55%', lineHeight: 1.5 }}>
                {field.value ?? '—'}
              </span>
            </div>
          ))}
        </div>

        <DashedDivider />

        {/* Issued by + tagline */}
        <div style={{ position: 'relative', zIndex: 2, paddingBottom: 14 }}>
          {(issuedBy || businessName) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 500 }}>Issued by</span>
              <span style={{ fontSize: 10.5, color: '#1e293b', fontWeight: 700, textAlign: 'right', maxWidth: '62%' }}>
                {issuedBy || businessName}
              </span>
            </div>
          )}
          <p style={{ margin: 0, fontSize: 9, color: '#cbd5e1', textAlign: 'center', fontStyle: 'italic', lineHeight: 1.5 }}>
            Talk your money. Track your profit. Grow your business.
          </p>
          {processorName && (
            <p style={{ margin: '6px 0 0', fontSize: 8, color: '#94a3b8', textAlign: 'center', lineHeight: 1.5 }}>
              Payments securely processed via {processorName}
            </p>
          )}
        </div>

        {/* Footer strip */}
        <div style={{
          margin: '0 -20px',
          background: '#dcfce7',
          padding: '10px 20px 8px',
          textAlign: 'center',
        }}>
          <div style={{ marginBottom: 4, textAlign: 'center' }}>
            <img
              src="/logo.png" alt=""
              style={{ width: 16, height: 16, borderRadius: 3, display: 'block', margin: '0 auto' }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
            <span style={{ display: 'block', fontSize: 9.5, fontWeight: 700, color: '#14532d', lineHeight: '14px', whiteSpace: 'nowrap', marginTop: 3 }}>
              KudiAI Track
            </span>
          </div>
          <p style={{ margin: '2px 0 0', fontSize: 8, fontWeight: 500, color: '#166534' }}>
            support@kudiai.app
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 7.5, color: '#166534' }}>
            A Product of Amaya &amp; Co. Technologies
          </p>
          <p style={{ margin: '1px 0 0', fontSize: 7.5, color: '#166534' }}>
            All Rights Reserved {'©'} {new Date().getFullYear()}
          </p>
        </div>

        {/* Ref bar */}
        <div style={{ margin: '0 -20px', background: '#bbf7d0', padding: '4px 20px', textAlign: 'center' }}>
          <span style={{ fontSize: 7.5, color: '#15803d', letterSpacing: '0.22em', fontWeight: 600, fontFamily: 'monospace' }}>
            {receiptRef || '—'}
          </span>
        </div>
      </div>

      {/* Bottom scallop */}
      <ScallopEdge flip />
    </div>
  );
}
