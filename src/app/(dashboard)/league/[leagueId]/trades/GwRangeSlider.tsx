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
  function handleStartChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10);
    let newStart = Math.max(min, Math.min(val, maxStart));
    
    if (newStart > maxEnd - minDuration) {
      newStart = maxEnd - minDuration;
    }

    let newEnd = endGw;
    if (newEnd - newStart < minDuration) {
      newEnd = Math.min(newStart + minDuration, maxEnd);
      if (newEnd - newStart < minDuration) {
        newStart = newEnd - minDuration;
      }
    }
    if (newEnd - newStart > maxDuration) {
      newEnd = newStart + maxDuration;
    }
    onChange(newStart, newEnd);
  }

  function handleEndChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10);
    let newEnd = Math.max(min + minDuration, Math.min(val, maxEnd));
    
    let newStart = startGw;
    if (newEnd - newStart < minDuration) {
      newStart = Math.max(newEnd - minDuration, min);
      if (newEnd - newStart < minDuration) {
        newEnd = newStart + minDuration;
      }
    }
    if (newEnd - newStart > maxDuration) {
      newStart = newEnd - maxDuration;
      if (newStart > maxStart) {
        newStart = maxStart;
        newEnd = newStart + maxDuration;
      }
    }
    onChange(newStart, newEnd);
  }

  const startPct = ((startGw - min) / (maxEnd - min || 1)) * 100;
  const widthPct = ((endGw - startGw) / (maxEnd - min || 1)) * 100;

  const sliderLabelStyle = {
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--color-text-muted)',
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

      {/* Dual overlapping range slider */}
      <div style={{ position: 'relative', height: '36px', marginTop: '10px', width: '100%' }}>
        {/* Track background */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          height: '6px',
          borderRadius: '3px',
          background: 'var(--color-border)',
          transform: 'translateY(-50%)',
          zIndex: 0
        }} />

        {/* Selected range highlight */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: `${startPct}%`,
          width: `${widthPct}%`,
          height: '6px',
          borderRadius: '3px',
          background: 'var(--color-accent-blue)',
          transform: 'translateY(-50%)',
          zIndex: 1
        }} />

        {/* Left handle for startGw */}
        <input
          type="range"
          min={min}
          max={maxEnd}
          step={1}
          value={startGw}
          onChange={handleStartChange}
          className={styles.gwRangeInput}
          style={{ zIndex: startGw > (min + maxEnd) / 2 ? 3 : 2 }}
        />

        {/* Right handle for endGw */}
        <input
          type="range"
          min={min}
          max={maxEnd}
          step={1}
          value={endGw}
          onChange={handleEndChange}
          className={styles.gwRangeInput}
          style={{ zIndex: startGw > (min + maxEnd) / 2 ? 2 : 3 }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
        <span>GW{min}</span>
        <span>Min Duration: 4 GWs · Max: 16 GWs</span>
        <span>GW{maxEnd}</span>
      </div>
    </div>
  );
}
