'use client';

import styles from './ProposeBuilder.module.css';

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

  return (
    <div>
      <div className={styles.gwSummary}>
        <div className={styles.gwStat}>
          <div className={styles.gwStatLabel}>Start Week</div>
          <div className={styles.gwStatValue}>GW{startGw}</div>
        </div>

        <div className={styles.gwStat}>
          <div className={`${styles.gwStatValue} ${styles.duration}`}>{endGw - startGw} GWs</div>
          <div className={styles.gwStatLabel}>Duration</div>
        </div>

        <div className={styles.gwStat}>
          <div className={styles.gwStatLabel}>End Week</div>
          <div className={styles.gwStatValue}>GW{endGw}</div>
        </div>
      </div>

      <div className={styles.gwTrackWrap}>
        <div className={styles.gwTrackBg} />
        <div className={styles.gwTrackFill} style={{ left: `${startPct}%`, width: `${widthPct}%` }} />

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

      <div className={styles.gwFooter}>
        <span>GW{min}</span>
        <span>Min {minDuration} GWs · Max {maxDuration} GWs</span>
        <span>GW{maxEnd}</span>
      </div>
    </div>
  );
}
