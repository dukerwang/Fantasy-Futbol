'use client';

import styles from './trades.module.css';

interface Props {
  /** Earliest selectable GW (usually currentGameweek) */
  min: number;
  /** Latest selectable start GW */
  maxStart: number;
  /** Latest selectable end GW */
  maxEnd: number;
  startGw: number;
  endGw: number;
  minDuration?: number;
  maxDuration?: number;
  onChange: (start: number, end: number) => void;
}

export default function GwRangeSlider({
  min,
  maxStart,
  maxEnd,
  startGw,
  endGw,
  minDuration = 4,
  maxDuration = 16,
  onChange,
}: Props) {
  // Clamp maxStart to ensure it is at least min (preventing min > max in inputs)
  const effectiveMaxStart = Math.max(min, maxStart);

  // Bounds for End Gameweek slider
  const minEnd = startGw + minDuration;
  const maxEndBound = Math.min(startGw + maxDuration, maxEnd);

  function handleStartChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newStart = parseInt(e.target.value, 10);
    // Keep end within [newStart + minDuration, newStart + maxDuration]
    const nextMinEnd = newStart + minDuration;
    const nextMaxEnd = Math.min(newStart + maxDuration, maxEnd);
    let newEnd = endGw;
    if (newEnd < nextMinEnd) {
      newEnd = nextMinEnd;
    } else if (newEnd > nextMaxEnd) {
      newEnd = nextMaxEnd;
    }
    onChange(newStart, newEnd);
  }

  function handleEndChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newEnd = parseInt(e.target.value, 10);
    onChange(startGw, newEnd);
  }

  // Calculate percentages for visual track fills
  const startPct = ((startGw - min) / (effectiveMaxStart - min || 1)) * 100;
  const endPct = ((endGw - minEnd) / (maxEndBound - minEnd || 1)) * 100;

  const sliderContainerStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    marginTop: '10px',
  };

  const sliderRowStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  };

  const sliderHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--color-text-secondary)',
  };

  const sliderLabelStyle = {
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--color-text-muted)',
  };

  const valueDisplayStyle = {
    fontWeight: 700,
    color: 'var(--color-accent-blue)',
    fontSize: '12px',
  };

  return (
    <div>
      {/* GW summary display row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px dashed var(--color-border)', paddingBottom: '12px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={sliderLabelStyle}>Start Week</div>
          <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: "'Noto Serif', serif", color: 'var(--color-accent-blue)' }}>
            GW{startGw}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: "'Noto Serif', serif", color: 'var(--color-text-secondary)' }}>
            {endGw - startGw} GWs
          </div>
          <div style={sliderLabelStyle}>Duration</div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={sliderLabelStyle}>End Week</div>
          <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: "'Noto Serif', serif", color: 'var(--color-accent-blue)' }}>
            GW{endGw}
          </div>
        </div>
      </div>

      <div style={sliderContainerStyle}>
        {/* Slider 1: Start Gameweek */}
        <div style={sliderRowStyle}>
          <div style={sliderHeaderStyle}>
            <span>Start Gameweek</span>
            <span style={valueDisplayStyle}>GW{startGw}</span>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', top: '10px', left: 0, right: 0,
              height: '6px', borderRadius: '3px',
              background: 'var(--color-border)',
            }} />
            <div style={{
              position: 'absolute', top: '10px', left: 0,
              width: `${startPct}%`,
              height: '6px', borderRadius: '3px 0 0 3px',
              background: 'var(--color-accent-blue)',
            }} />
            <input
              type="range"
              min={min}
              max={effectiveMaxStart}
              step={1}
              value={startGw}
              onChange={handleStartChange}
              className={styles.feeRangeInput}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--color-text-muted)' }}>
            <span>GW{min}</span>
            <span>Latest allowed start: GW{effectiveMaxStart}</span>
          </div>
        </div>

        {/* Slider 2: End Gameweek */}
        <div style={sliderRowStyle}>
          <div style={sliderHeaderStyle}>
            <span>End Gameweek</span>
            <span style={valueDisplayStyle}>GW{endGw}</span>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', top: '10px', left: 0, right: 0,
              height: '6px', borderRadius: '3px',
              background: 'var(--color-border)',
            }} />
            <div style={{
              position: 'absolute', top: '10px', left: 0,
              width: `${endPct}%`,
              height: '6px', borderRadius: '3px 0 0 3px',
              background: 'var(--color-accent-blue)',
            }} />
            <input
              type="range"
              min={minEnd}
              max={maxEndBound}
              step={1}
              value={endGw}
              onChange={handleEndChange}
              className={styles.feeRangeInput}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--color-text-muted)' }}>
            <span>Min: GW{minEnd} (4 GWs)</span>
            <span>Max: GW{maxEndBound} (16 GWs)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
