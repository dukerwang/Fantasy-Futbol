'use client';

import styles from './trades.module.css';

// Zone thresholds are expressed as multiples of the anchor value.
// When PPG is available it drives the anchor (performance-based).
// When not (early season / no data) we fall back to % of market value.
const ZONE_MULTIPLES = {
  lowEnd:     0.25,  // below this → Low
  fairEnd:    0.75,  // Low–Fair boundary
  premiumEnd: 1.5,   // Fair–Premium boundary
  // Steep = anything above premiumEnd
};

// PPG weekly anchor: 1 PPG ~ €0.08m (High Value tier)
const PPG_TO_ANCHOR = 0.08;

// MV weekly anchor fallback: MV * 0.008 (approx 0.8% of MV per week)
const MV_TO_ANCHOR = 0.008;

type ZoneLabel = 'Free' | 'Low' | 'Fair' | 'Premium' | 'Steep';

const ZONE_COLORS: Record<ZoneLabel, string> = {
  Free:    '#9ca3af',
  Low:     '#22c55e',
  Fair:    '#3b82f6',
  Premium: '#f59e0b',
  Steep:   '#ef4444',
};

interface ZoneThresholds {
  lowEnd: number;
  fairEnd: number;
  premiumEnd: number;
  anchor: 'ppg' | 'mv' | 'default';
}

function computeThresholds(
  ppg: number | null | undefined,
  mv: number | null | undefined,
  duration: number,
): ZoneThresholds {
  const effectiveDuration = Math.max(1, duration);
  if (ppg && ppg > 0) {
    const weeklyBase = ppg * PPG_TO_ANCHOR;
    const base = weeklyBase * effectiveDuration;
    return {
      lowEnd:     base * ZONE_MULTIPLES.lowEnd,
      fairEnd:    base * ZONE_MULTIPLES.fairEnd,
      premiumEnd: base * ZONE_MULTIPLES.premiumEnd,
      anchor:     'ppg',
    };
  }
  if (mv && mv > 0) {
    const weeklyBase = mv * MV_TO_ANCHOR;
    const base = weeklyBase * effectiveDuration;
    return {
      lowEnd:     base * ZONE_MULTIPLES.lowEnd,
      fairEnd:    base * ZONE_MULTIPLES.fairEnd,
      premiumEnd: base * ZONE_MULTIPLES.premiumEnd,
      anchor:     'mv',
    };
  }
  // Bare fallback — no player context (assuming €1.0m base weekly anchor)
  const base = 1.0 * effectiveDuration;
  return {
    lowEnd:     base * ZONE_MULTIPLES.lowEnd,
    fairEnd:    base * ZONE_MULTIPLES.fairEnd,
    premiumEnd: base * ZONE_MULTIPLES.premiumEnd,
    anchor:     'default',
  };
}

function getZoneLabel(value: number, t: ZoneThresholds): ZoneLabel {
  if (value === 0)      return 'Free';
  if (value < t.lowEnd) return 'Low';
  if (value < t.fairEnd) return 'Fair';
  if (value < t.premiumEnd) return 'Premium';
  return 'Steep';
}

interface Props {
  value: number;
  /** Points-per-game — used as primary anchor for zone thresholds */
  ppg?: number | null;
  /** Market value in €m — fallback anchor when PPG is unavailable */
  marketValue?: number | null;
  /** Duration of the loan in weeks */
  duration: number;
  onChange: (value: number) => void;
}

export default function LoanFeeSlider({ value, ppg, marketValue: mv, duration, onChange }: Props) {
  const t = computeThresholds(ppg, mv, duration);

  // Slider ceiling: a bit above "Steep" threshold, min €8m
  const maxFee = Math.max(8, Math.ceil(t.premiumEnd * 2));

  const zoneLabel = getZoneLabel(value, t);
  const zoneColor = ZONE_COLORS[zoneLabel];

  // Show a secondary context line (PPG or % of MV)
  const contextLine = (() => {
    if (t.anchor === 'ppg' && ppg && ppg > 0) {
      const weeklyBase = ppg * PPG_TO_ANCHOR;
      const base = weeklyBase * duration;
      return value > 0 ? `${(value / base).toFixed(1)}× base anchor` : null;
    }
    if (t.anchor === 'mv' && mv && mv > 0 && value > 0) {
      return `${Math.round((value / mv) * 100)}% of market value`;
    }
    return null;
  })();

  // Gradient: zone boundaries mapped proportionally across slider range
  const gradient = (() => {
    const low     = Math.min(100, (t.lowEnd     / maxFee) * 100).toFixed(1);
    const fair    = Math.min(100, (t.fairEnd    / maxFee) * 100).toFixed(1);
    const premium = Math.min(100, (t.premiumEnd / maxFee) * 100).toFixed(1);
    return `linear-gradient(to right,
      #9ca3af 0%,
      #22c55e ${low}%,
      #3b82f6 ${fair}%,
      #f59e0b ${premium}%,
      #ef4444 100%)`;
  })();

  // Percentages for label rendering
  const lowPct = (t.lowEnd / maxFee) * 100;
  const fairPct = ((t.fairEnd - t.lowEnd) / maxFee) * 100;
  const premiumPct = ((t.premiumEnd - t.fairEnd) / maxFee) * 100;
  const steepPct = ((maxFee - t.premiumEnd) / maxFee) * 100;

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
          {contextLine && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
              {contextLine}
            </span>
          )}
          <span style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: '2px',
            background: `${zoneColor}22`, color: zoneColor,
          }}>
            {zoneLabel}
          </span>
        </div>
      </div>

      {/* Gradient track + thumb */}
      <div style={{ position: 'relative' }}>
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

      {/* Zone legend with mathematically aligned absolute positioning */}
      <div style={{ position: 'relative', height: '14px', marginTop: '6px', fontSize: '8px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        <span style={{ position: 'absolute', left: '0%', transform: 'translateX(0%)', color: ZONE_COLORS.Free }}>Free</span>
        
        {lowPct > 8 && (
          <span style={{ 
            position: 'absolute', 
            left: `${((t.lowEnd / 2) / maxFee * 100).toFixed(1)}%`, 
            transform: 'translateX(-50%)', 
            color: ZONE_COLORS.Low 
          }}>
            Low
          </span>
        )}
        
        {fairPct > 8 && (
          <span style={{ 
            position: 'absolute', 
            left: `${(((t.lowEnd + t.fairEnd) / 2) / maxFee * 100).toFixed(1)}%`, 
            transform: 'translateX(-50%)', 
            color: ZONE_COLORS.Fair 
          }}>
            Fair
          </span>
        )}
        
        {premiumPct > 8 && (
          <span style={{ 
            position: 'absolute', 
            left: `${(((t.fairEnd + t.premiumEnd) / 2) / maxFee * 100).toFixed(1)}%`, 
            transform: 'translateX(-50%)', 
            color: ZONE_COLORS.Premium 
          }}>
            Premium
          </span>
        )}
        
        {steepPct > 8 && (
          <span style={{ 
            position: 'absolute', 
            left: `${(((t.premiumEnd + maxFee) / 2) / maxFee * 100).toFixed(1)}%`, 
            transform: 'translateX(-50%)', 
            color: ZONE_COLORS.Steep 
          }}>
            Steep
          </span>
        )}
      </div>

      {/* Context line: what's driving zones */}
      <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--color-text-muted)' }}>
        {t.anchor === 'ppg' && ppg && ppg > 0 ? (
          <>Zones based on <strong>{ppg.toFixed(1)} PPG</strong> over {duration} GWs — Fair ≈ €{t.fairEnd.toFixed(1)}m</>
        ) : t.anchor === 'mv' && mv && mv > 0 ? (
          <>Zones based on <strong>€{mv.toFixed(1)}m market value</strong> over {duration} GWs</>
        ) : (
          <>Zones are estimates — no player data available</>
        )}
        {' · '}Range: €0 – €{maxFee}m
      </div>
    </div>
  );
}
