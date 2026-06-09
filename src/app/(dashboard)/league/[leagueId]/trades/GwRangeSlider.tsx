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
  const visualRange = maxEnd - min;
  const startPct = visualRange > 0 ? ((startGw - min) / visualRange) * 100 : 0;
  const endPct   = visualRange > 0 ? ((endGw   - min) / visualRange) * 100 : 100;
  const duration = endGw - startGw;

  // Give the start handle a higher z-index when it's at its ceiling so the
  // user can still drag it left (prevents the end handle from blocking it).
  const startZ = startGw >= maxStart ? 5 : 3;
  const endZ   = startGw >= maxStart ? 3 : 4;

  function handleStart(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = parseInt(e.target.value, 10);
    const newStart = Math.min(raw, maxStart);
    // Keep end within [newStart + minDuration, newStart + maxDuration, maxEnd]
    const newEnd = Math.min(endGw, Math.min(newStart + maxDuration, maxEnd));
    onChange(newStart, Math.max(newEnd, newStart + minDuration));
  }

  function handleEnd(e: React.ChangeEvent<HTMLInputElement>) {
    const raw    = parseInt(e.target.value, 10);
    const newEnd = Math.min(raw, Math.min(startGw + maxDuration, maxEnd));
    onChange(startGw, Math.max(newEnd, startGw + minDuration));
  }

  return (
    <div>
      {/* GW display row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '10px' }}>
        <div style={{ textAlign: 'center', minWidth: '52px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
            From
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: "'Noto Serif', serif", color: 'var(--color-accent-blue)', lineHeight: 1.1 }}>
            GW{startGw}
          </div>
        </div>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: "'Noto Serif', serif", color: 'var(--color-text-secondary)', lineHeight: 1.1 }}>
            {duration} GW{duration !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>duration</div>
        </div>

        <div style={{ textAlign: 'center', minWidth: '52px' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
            To
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: "'Noto Serif', serif", color: 'var(--color-accent-blue)', lineHeight: 1.1 }}>
            GW{endGw}
          </div>
        </div>
      </div>

      {/* Dual-handle slider track */}
      <div style={{ position: 'relative', height: '44px' }}>
        {/* Background track (full range) */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: 0, right: 0,
          height: '6px', borderRadius: '3px',
          background: 'var(--color-border)',
        }} />

        {/* Highlighted fill between handles */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: `${startPct}%`,
          width: `${Math.max(0, endPct - startPct)}%`,
          height: '6px', borderRadius: '3px',
          background: 'var(--color-accent-blue)',
          transition: 'left 0.05s, width 0.05s',
        }} />

        {/* Start handle */}
        <input
          type="range"
          min={min}
          max={maxStart}
          step={1}
          value={startGw}
          onChange={handleStart}
          className={styles.gwRangeInput}
          style={{ zIndex: startZ }}
        />

        {/* End handle */}
        <input
          type="range"
          min={min}
          max={maxEnd}
          step={1}
          value={endGw}
          onChange={handleEnd}
          className={styles.gwRangeInput}
          style={{ zIndex: endZ }}
        />
      </div>

      {/* Floor / ceiling labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
        <span>GW{min}</span>
        <span>Min {minDuration} · Max {maxDuration} GWs</span>
        <span>GW{maxEnd}</span>
      </div>
    </div>
  );
}
