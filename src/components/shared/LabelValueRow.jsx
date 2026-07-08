/**
 * LabelValueRow — the standard label-left / value-right row primitive.
 * Used on receipts, detail modals, settings panels, and any key-value list.
 *
 * Guarantees:
 *   - Label gets a fixed max-width (45% default) and never pushes into the value
 *   - Value gets all remaining space with min-width: 0 so it can shrink
 *   - Long values wrap top-aligned to the label, never collide
 *   - Amount values use <AmountDisplay />; text values use <FitText />
 *
 * Props:
 *   label        — string
 *   value        — string | number
 *   isAmount     — boolean: use AmountDisplay for the value (default false)
 *   fromKobo     — boolean: pass through to AmountDisplay (default false)
 *   amountColorBy— 'in' | 'out' | 'neutral' | null (default null)
 *   lines        — max lines for text value (default 2)
 *   labelWidth   — CSS maxWidth for the label column (default '45%')
 *   copy         — boolean: show a copy-to-clipboard icon on the value (default false)
 *   className    — extra classes on the row wrapper
 *   dimLabel     — boolean: render label in muted grey (default true)
 *   bold         — boolean: bold value text (default false)
 */
import { useState, useCallback } from 'react';
import { AmountDisplay } from './AmountDisplay';
import { FitText } from './FitText';

export function LabelValueRow({
  label,
  value,
  isAmount     = false,
  fromKobo     = false,
  amountColorBy= null,
  lines        = 2,
  labelWidth   = '45%',
  copy         = false,
  className    = '',
  dimLabel     = true,
  bold         = false,
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = isAmount
      ? String(value ?? '')
      : String(value ?? '');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value, isAmount]);

  const displayValue = value !== undefined && value !== null && value !== '' ? value : '—';

  return (
    <div
      className={`flex items-start gap-2 py-1.5${className ? ` ${className}` : ''}`}
      style={{ minWidth: 0 }}
    >
      {/* Label column */}
      <span
        style={{
          flexShrink: 0,
          maxWidth:   labelWidth,
          minWidth:   0,
          fontSize:   13,
          fontWeight: 500,
          color:      dimLabel ? '#94a3b8' : '#475569',
          lineHeight: 1.4,
          paddingTop: 1,
        }}
      >
        {label}
      </span>

      {/* Value column */}
      <div
        style={{
          flex:     '1 1 0%',
          minWidth: 0,
          display:  'flex',
          alignItems: 'center',
          gap:      6,
          justifyContent: 'flex-end',
        }}
      >
        {isAmount ? (
          <AmountDisplay
            amount={displayValue === '—' ? 0 : Number(displayValue)}
            fromKobo={fromKobo}
            size="row"
            align="right"
            colorBy={amountColorBy}
            style={{ flex: '1 1 0%', minWidth: 0 }}
          />
        ) : (
          <FitText
            lines={lines}
            className={bold ? 'font-semibold' : ''}
            style={{
              flex:       '1 1 0%',
              minWidth:   0,
              fontSize:   13,
              fontWeight: bold ? 600 : 500,
              color:      '#1e293b',
              textAlign:  'right',
              lineHeight: 1.4,
            }}
          >
            {String(displayValue)}
          </FitText>
        )}

        {copy && displayValue !== '—' && (
          <button
            onClick={handleCopy}
            aria-label="Copy value"
            style={{
              flexShrink: 0,
              padding:    '2px 4px',
              borderRadius: 4,
              background: copied ? '#dcfce7' : '#f1f5f9',
              border:     'none',
              cursor:     'pointer',
              fontSize:   10,
              fontWeight: 700,
              color:      copied ? '#16a34a' : '#64748b',
              lineHeight: 1,
            }}
          >
            {copied ? '✓' : 'copy'}
          </button>
        )}
      </div>
    </div>
  );
}

export default LabelValueRow;
