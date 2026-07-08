/**
 * StressTest — visual QA for the global text & amount containment system.
 * Open on a 320px viewport at 130% OS font scale to verify zero overflow.
 * Only import/render this in DEV builds.
 */
import { AmountDisplay } from '../shared/AmountDisplay';
import { FitText }       from '../shared/FitText';
import { LabelValueRow } from '../shared/LabelValueRow';

const AMOUNTS = [
  999_999_999_999.99,
  999_999_999.99,
  123_456_789.50,
  12_345.67,
  0.01,
];

const LONG_NAME = 'Adekunle Olamide Babatunde-Fasanya';
const LONG_BIZ  = 'Sunrise General Merchandise & Agricultural Supplies Ltd.';

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 8 }}>
        {title}
      </p>
      {children}
    </div>
  );
}

export function StressTest() {
  return (
    <div style={{ padding: '16px 12px', background: '#f8fafc', minHeight: '100vh' }}>
      <p style={{ fontSize: 16, fontWeight: 800, color: '#1e293b', marginBottom: 4 }}>Overflow Stress Test</p>
      <p style={{ fontSize: 11, color: '#64748b', marginBottom: 20 }}>
        320px viewport · 130% font scale · zero overflow expected
      </p>

      <Section title="AmountDisplay — hero">
        {AMOUNTS.map((a, i) => (
          <div key={i} style={{ background: '#1B2A5E', borderRadius: 12, padding: '10px 14px', marginBottom: 8 }}>
            <AmountDisplay amount={a} size="hero" align="left" style={{ color: '#fff' }} />
          </div>
        ))}
      </Section>

      <Section title="AmountDisplay — stat (grid-cols-2)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {AMOUNTS.slice(0, 4).map((a, i) => (
            <div key={i} style={{ background: '#1B2A5E', borderRadius: 10, padding: '8px 10px', minWidth: 0 }}>
              <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>Stat {i + 1}</p>
              <AmountDisplay amount={a} size="stat" align="left" style={{ color: '#fff' }} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="AmountDisplay — row (flex)">
        <div style={{ background: '#fff', borderRadius: 12, padding: '8px 14px', border: '1px solid #e2e8f0' }}>
          {AMOUNTS.map((a, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < AMOUNTS.length - 1 ? '0.5px solid #f1f5f9' : 'none', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#64748b', flexShrink: 0 }}>Amount {i + 1}</span>
              <AmountDisplay amount={a} size="row" align="right" colorBy={i % 2 === 0 ? 'in' : 'out'} style={{ flex: '1 1 0%', minWidth: 0 }} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="FitText — long names">
        <div style={{ background: '#fff', borderRadius: 12, padding: '10px 14px', border: '1px solid #e2e8f0' }}>
          <FitText lines={1} style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>
            {LONG_NAME}
          </FitText>
          <FitText lines={2} style={{ fontSize: 13, color: '#64748b' }}>
            {LONG_BIZ}
          </FitText>
        </div>
      </Section>

      <Section title="LabelValueRow — detail rows">
        <div style={{ background: '#fff', borderRadius: 12, padding: '10px 14px', border: '1px solid #e2e8f0' }}>
          <LabelValueRow label="Customer Name" value={LONG_NAME} copy />
          <LabelValueRow label="Business" value={LONG_BIZ} lines={2} />
          <LabelValueRow label="Amount" value={999_999_999.99} isAmount amountColorBy="in" />
          <LabelValueRow label="Outstanding" value={123_456_789.50} isAmount amountColorBy="out" />
          <LabelValueRow label="Token" value="4538-2891-7364-2910-5847" copy bold />
        </div>
      </Section>

      <Section title="Grid-cols-3 hero">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {['Total Debt', 'Recovered', 'Balance'].map((label, i) => (
            <div key={i} style={{ background: '#1B2A5E', borderRadius: 10, padding: '8px 6px', minWidth: 0 }}>
              <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>{label}</p>
              <AmountDisplay amount={AMOUNTS[i]} size="small" align="left" style={{ color: '#fff' }} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export default StressTest;
