'use client';

import styles from './trades.module.css';

// Fee zones defined as % of market value
const ZONES = [
  { label: 'Free',    color: '#9ca3af', minPct: 0,   maxPct: 0   },
  { label: 'Low',     color: '#22c55e', minPct: 0,   maxPct: 10  },
  { label: 'Fair',    color: '#3b82f6', minPct: 10,  maxPct: 20  },
  { label: 'Premium', color: '#f59e0b', minPct: 20,  maxPct: 30  },
  { label: 'Steep',   color: '#ef4444', minPct: 30,  maxPct: Infinity },
] as const;

function getZone(value: number, mv: number | null | undefined) {
  if (value === 0) return ZONES[0];
  if (!mv || mv <= 0) return ZONES[2]; // no MV context — call it "fair"
  const pct = (value / mv) * 100;
  if (pct < 10) return ZONES[1];
  if (pct < 20) return ZONES[2];
  if (pct < 30) return ZONES[3];
  return ZONES[4];
}

interface Props {
  value: number;
  marketValue?: number | null; // in €m
  onChange: (value: number) => void;
}

export default function LoanFeeSlider({ value, marketValue: mv, onChange }: Props) {
  // Slider ceiling: 40% of MV, minimum ceiling of €8m
  const maxFee = mv ? Math.max(8, Math.ceil(mv * 0.4)) : 10;
  const zone = getZone(value, mv);
  const mvPct = mv && mv > 0 && value > 0 ? Math.round((value / mv) * 100) : null;

  // Build a proportional gradient where zone boundaries are expressed as
  // percentages of the slider range (0 → maxFee)
  const gradient = (() => {
    if (!mv || mv <= 0) {
      return 'linear-gradient(to right, #9ca3af 0%, #22c55e 20%, #3b82f6 45%, #f59e0b 70%, #ef4444 100%)';
    }
    const low     = Math.min(100, (mv * 0.10 / maxFee) * 100).toFixed(1);
    const fair    = Math.min(100, (mv * 0.20 / maxFee) * 100).toFixed(1);
    const premium = Math.min(100, (mv * 0.30 / maxFee) * 100).toFixed(1);
    return `linear-gradient(to right,
      #9ca3af 0%,
      #22c55e ${low}%,
      #3b82f6 ${fair}%,
      #f59e0b ${premium}%,
      #ef4444 100%)`;
  })();

  return (
    <div>
      {/* Current value + zone badge */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{
          fontSize: '24px', fontWeight: 700,
          fontFamily: "'Noto Serif', serif",
          color: 'var(--color-text-primary)',
        }}>
          {value === 0 ? 'Free' : `€${value}m`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {mvPct !== null && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
              {mvPct}% of MV
            </span>
          )}
          <span style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: '2px',
            background: `${zone.color}22`, color: zone.color,
          }}>
            {zone.label}
          </span>
        </div>
      </div>

      {/* Gradient track + thumb */}
      <div style={{ position: 'relative' }}>
        {/* Gradient background track */}
        <div style={{
          position: 'absolute', top: '10px', left: 0, right: 0,
          height: '6px', borderRadius: '3px',
          background: gradient,
        }} />
        <input
          type="range"
          min={0}
          max={maxFee}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className={styles.feeRangeInput}
        />
      </div>

      {/* Zone legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
        {ZONES.map((z) => (
          <span key={z.label} style={{
            fontSize: '8px', fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: z.color,
          }}>
            {z.label}
          </span>
        ))}
      </div>

      {/* Range hint */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: 'var(--color-text-muted)' }}>
        <span>€0 (free)</span>
        <span>€{maxFee}m max</span>
      </div>
    </div>
  );
}
