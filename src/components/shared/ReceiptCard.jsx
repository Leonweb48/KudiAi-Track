/**
 * Shareable KudiAI receipt — OPay-style ticket card.
 * Uses inline styles throughout so html2canvas captures pixel-for-pixel.
 * Supports an optional provider logo/badge (for bill receipts).
 */
import { getProviderLogo, getProviderBadge } from '../../utils/logoMap';

const NAVY       = '#0f1c45';
const GREEN      = '#3da829';
const OUTER_BG   = '#f1f5f9';
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

function fmtAmt(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function statusProps(status) {
  if (status === 'success') return { label: 'Successful', color: '#16a34a', bg: '#dcfce7', icon: '✓' };
  if (status === 'pending') return { label: 'Processing',  color: '#d97706', bg: '#fef3c7', icon: '⏳' };
  if (status === 'failed')  return { label: 'Failed',      color: '#dc2626', bg: '#fee2e2', icon: '✕' };
  return                           { label: status || '?', color: '#64748b', bg: '#f1f5f9', icon: '?' };
}

// ── Diagonal "KudiAI" watermark ───────────────────────────────────────────────
function Watermark() {
  const items = [];
  for (let row = -1; row < 12; row++) {
    for (let col = -1; col < 5; col++) {
      items.push(
        <span key={`${row}-${col}`} style={{
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
        }}>KudiAI</span>
      );
    }
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}>
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
function DashedDivider() {
  return (
    <div style={{ position: 'relative', margin: '12px -20px', display: 'flex', alignItems: 'center' }}>
      <div style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: OUTER_BG, flexShrink: 0 }} />
      <div style={{ flex: 1, borderTop: '1.5px dashed #e2e8f0' }} />
      <div style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: OUTER_BG, flexShrink: 0 }} />
    </div>
  );
}

// ── Direction arrow icon (shown when no provider badge) ───────────────────────
function DirectionIcon({ direction, status }) {
  const bgColor =
    status === 'pending' ? '#fef3c7' :
    status === 'failed'  ? '#fee2e2' :
    direction === 'in'   ? '#dcfce7' : '#e0e7ff';
  const strokeColor =
    status === 'pending' ? '#d97706' :
    status === 'failed'  ? '#dc2626' :
    direction === 'in'   ? GREEN     : NAVY;
  const arrowPaths = direction === 'in'
    ? ['M12 19V5', 'M5 12l7 7 7-7']
    : ['M12 5v14', 'M19 12l-7-7-7 7'];

  return (
    <div style={{
      width: 40, height: 40, borderRadius: '50%',
      backgroundColor: bgColor,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      margin: '0 auto 10px',
    }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none"
        stroke={strokeColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        {arrowPaths.map((d, i) => <path key={i} d={d} />)}
      </svg>
    </div>
  );
}

// ── Provider logo image or colored initials badge ─────────────────────────────
function ProviderBadge({ provider, category }) {
  const logoPath = getProviderLogo(provider);
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
    provider, category,
  } = data;

  const st           = statusProps(status);
  const showProvider = !!(provider || category);
  const amtColor     = status === 'failed'  ? '#dc2626' :
                       status === 'pending' ? '#d97706' :
                       direction === 'in'   ? GREEN     : NAVY;

  // retrievable fields (electricity token) are shown in TransactionDetailModal, not the card
  const printFields = fields.filter(f => !f.retrievable);

  return (
    <div ref={innerRef} style={{ background: OUTER_BG, padding: '0 16px 16px', fontFamily: FONT_STACK }}>

      {/* Top scallop */}
      <ScallopEdge />

      {/* White receipt body */}
      <div style={{ background: 'white', position: 'relative', overflow: 'hidden', padding: '16px 20px 0' }}>
        <Watermark />

        {/* Header: logo + wordmark left · receipt type right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <img
              src="/logo.png" alt="" width={22} height={22}
              style={{ borderRadius: 4, flexShrink: 0 }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
            <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, letterSpacing: '-0.01em' }}>
              KudiAI Track
            </span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase', lineHeight: 1.4 }}>
              {category ? 'Bill' : 'Transaction'}
            </p>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase', lineHeight: 1.4 }}>
              Receipt
            </p>
          </div>
        </div>

        {/* Provider logo / badge — bill receipts only */}
        {showProvider && <ProviderBadge provider={provider} category={category} />}

        {/* Title subtitle */}
        <p style={{ margin: showProvider ? '6px 0 0' : '10px 0 0', fontSize: 10.5, fontWeight: 600, color: '#64748b', textAlign: 'center', position: 'relative', zIndex: 2 }}>
          {title}
        </p>

        {/* Separator */}
        <div style={{ height: 1, background: '#f1f5f9', margin: '10px 0 6px', position: 'relative', zIndex: 2 }} />

        {/* Amount hero */}
        <div style={{ textAlign: 'center', padding: '4px 0 2px', position: 'relative', zIndex: 2 }}>
          {!showProvider && <DirectionIcon direction={direction} status={status} />}

          <p style={{ margin: 0, fontSize: 30, fontWeight: 800, color: amtColor, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            {fmtAmt(amount)}
          </p>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 8, background: st.bg, borderRadius: 99, padding: '3px 12px',
          }}>
            <span style={{ fontSize: 11, color: st.color, fontWeight: 700 }}>
              {st.icon} {st.label}
            </span>
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
        </div>

        {/* Navy footer strip */}
        <div style={{
          margin: '0 -20px',
          background: NAVY,
          padding: '9px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <img
              src="/logo.png" alt="" width={13} height={13}
              style={{ borderRadius: 2, opacity: 0.85, flexShrink: 0 }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>
              Generated by KudiAI Track
            </span>
          </div>
          <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.45)' }}>kudiai.app</span>
        </div>

        {/* Ref bar */}
        <div style={{ margin: '0 -20px', background: '#081030', padding: '4px 20px', textAlign: 'center' }}>
          <span style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.22em', fontWeight: 600, fontFamily: 'monospace' }}>
            {receiptRef || '—'}
          </span>
        </div>
      </div>

      {/* Bottom scallop */}
      <ScallopEdge flip />
    </div>
  );
}
