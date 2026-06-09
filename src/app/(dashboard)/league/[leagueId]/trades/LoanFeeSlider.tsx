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

// PPG multiplier: 1 PPG ~ €0.5m "anchor unit"
// e.g. 8 PPG → anchor = 4 → Fair zone = €1–3m
const PPG_TO_ANCHOR = 0.5;

// MV fallback: anchor = MV × 0.18  (so "Fair" ≈ 9–13.5% of MV, typical range)
const MV_TO_ANCHOR = 0.18;

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
): ZoneThresholds {
  if (ppg && ppg > 0) {
    const base = ppg * PPG_TO_ANCHOR;
    return {
      lowEnd:     base * ZONE_MULTIPLES.lowEnd,
      fairEnd:    base * ZONE_MULTIPLES.fairEnd,
      premiumEnd: base * ZONE_MULTIPLES.premiumEnd,
      anchor:     'ppg',
    };
  }
  if (mv && mv > 0) {
    const base = mv * MV_TO_ANCHOR;
    return {
      lowEnd:     base * ZONE_MULTIPLES.lowEnd,
      fairEnd:    base * ZONE_MULTIPLES.fairEnd,
      premiumEnd: base * ZONE_MULTIPLES.premiumEnd,
      anchor:     'mv',
    };
  }
  // Bare fallback — no player context
  return { lowEnd: 0.5, fairEnd: 2, premiumEnd: 4, anchor: 'default' };
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
  onChange: (value: number) => void;
}

export default function LoanFeeSlider({ value, ppg, marketValue: mv, onChange }: Props) {
  const t = computeThresholds(ppg, mv);

  // Slider ceiling: a bit above "Steep" threshold, min €8m
  const maxFee = Math.max(8, Math.ceil(t.premiumEnd * 2));

  const zoneLabel = getZoneLabel(value, t);
  const zoneColor = ZONE_COLORS[zoneLabel];

  // Show a secondary context line (PPG or % of MV)
  const contextLine = (() => {
    if (t.anchor === 'ppg' && ppg && ppg > 0) {
      return value > 0 ? `${(value / (ppg * PPG_TO_ANCHOR)).toFixed(1)}× PPG anchor` : null;
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

      {/* Zone legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
        {(['Free', 'Low', 'Fair', 'Premium', 'Steep'] as ZoneLabel[]).map((z) => (
          <span key={z} style={{
            fontSize: '8px', fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: ZONE_COLORS[z],
          }}>
            {z}
          </span>
        ))}
      </div>

      {/* Context line: what's driving zones */}
      <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--color-text-muted)' }}>
        {t.anchor === 'ppg' && ppg && ppg > 0 ? (
          <>Zones based on <strong>{ppg.toFixed(1)} PPG</strong> — Fair ≈ €{t.fairEnd.toFixed(1)}m{t.anchor === 'ppg' ? '' : ''}</>
        ) : t.anchor === 'mv' && mv && mv > 0 ? (
          <>Zones based on <strong>€{mv.toFixed(1)}m market value</strong> — limited match data</>
        ) : (
          <>Zones are estimates — no player data available</>
        )}
        {' · '}Range: €0 – €{maxFee}m
      </div>
    </div>
  );
}
