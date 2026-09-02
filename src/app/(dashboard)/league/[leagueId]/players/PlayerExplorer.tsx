'use client';

import { useMemo, useState } from 'react';
import NavigationLink from '@/components/ui/NavigationLink';
import { POS_COLOR } from '@/lib/positions/spine';
import type { GranularPosition } from '@/types';
import type { ExplorerRow } from '@/lib/players/indexData';
import { fold } from '@/lib/text/fold';
import styles from './playerExplorer.module.css';

/**
 * The pool on two pickable axes.
 *
 * Defaults to market value against points per game, which reads as
 * value-for-money without instruction — the top-left quadrant is the bargain
 * bin. Floor-versus-ceiling was rejected as a default: too abstract to land on.
 *
 * Axes deliberately cross the football and league layers. That is fine here
 * precisely because each axis is labelled; the rule was never "don't compare",
 * it was "don't let league scoring pass silently as a football judgment".
 */

interface Metric {
  key: keyof ExplorerRow;
  label: string;
  axis: string;
  digits: number;
  /** Value spans €0.2m to €220m — linear would flatten everyone under Haaland. */
  log?: boolean;
}

const METRICS: Metric[] = [
  { key: 'value', label: 'Value', axis: 'Market value (€m)', digits: 1, log: true },
  { key: 'ppg', label: 'PPG', axis: 'Points per game', digits: 1 },
  { key: 'points', label: 'Points', axis: 'Total points', digits: 0 },
  { key: 'rating', label: 'Rating', axis: 'Average rating', digits: 2 },
  { key: 'xgi90', label: 'xGI/90', axis: 'Expected goal involvement per 90', digits: 2 },
  { key: 'minutes', label: 'Minutes', axis: 'Minutes played', digits: 0 },
  { key: 'ga', label: 'G+A', axis: 'Goals + assists', digits: 0 },
  { key: 'age', label: 'Age', axis: 'Age', digits: 0 },
];

/** Positions that genuinely share a hue are paired rather than repeated. */
const LEGEND: Array<{ label: string; positions: GranularPosition[] }> = [
  { label: 'GK', positions: ['GK'] },
  { label: 'CB', positions: ['CB'] },
  { label: 'LB · RB', positions: ['LB', 'RB'] },
  { label: 'LWB · RWB', positions: ['LWB', 'RWB'] },
  { label: 'DM', positions: ['DM'] },
  { label: 'CM', positions: ['CM'] },
  { label: 'AM', positions: ['AM'] },
  { label: 'LW · RW', positions: ['LW', 'RW'] },
  { label: 'ST', positions: ['ST'] },
];

function metricOf(key: string): Metric {
  return METRICS.find((m) => m.key === key) ?? METRICS[0];
}

function project(m: Metric, v: number): number {
  return m.log ? Math.log10(Math.max(v, 0.2)) : v;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export default function PlayerExplorer({
  leagueId,
  rows,
  season,
}: {
  leagueId: string;
  rows: ExplorerRow[];
  season: string;
}) {
  const [xKey, setXKey] = useState<string>('value');
  const [yKey, setYKey] = useState<string>('ppg');
  const [group, setGroup] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [club, setClub] = useState<string>('ALL');
  const [selected, setSelected] = useState<string | null>(null);

  const mx = metricOf(xKey);
  const my = metricOf(yKey);

  const clubOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.club) set.add(r.club);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const view = useMemo(() => {
    const active = LEGEND.find((g) => g.label === group);
    const q = fold(search);
    const visible = rows.filter((r) => {
      if (active && !active.positions.includes(r.pos as GranularPosition)) return false;
      if (club !== 'ALL' && r.club !== club) return false;
      if (q && !fold(r.name).includes(q)) return false;
      return r[mx.key] != null && r[my.key] != null;
    });
    if (visible.length === 0) return null;

    const xs = visible.map((r) => project(mx, Number(r[mx.key])));
    const ys = visible.map((r) => project(my, Number(r[my.key])));
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    const padX = (x1 - x0) * 0.06 || 1;
    const padY = (y1 - y0) * 0.06 || 1;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;

    const px = (v: number) => ((v - x0) / (x1 - x0)) * 100;
    const py = (v: number) => ((v - y0) / (y1 - y0)) * 100;

    const minMins = Math.min(...visible.map((r) => r.minutes));
    const maxMins = Math.max(...visible.map((r) => r.minutes));

    return {
      visible,
      // Descending by size, so the smallest paint LAST and sit on top. A small
      // dot rendered under a large one is otherwise unclickable.
      points: visible
        .map((r) => ({
          row: r,
          left: px(project(mx, Number(r[mx.key]))),
          bottom: py(project(my, Number(r[my.key]))),
          size: 7 + ((r.minutes - minMins) / (maxMins - minMins || 1)) * 6,
          colour: POS_COLOR[r.pos as GranularPosition] ?? 'var(--color-text-muted)',
        }))
        .sort((a, b) => b.size - a.size),
      medianX: px(project(mx, median(visible.map((r) => Number(r[mx.key]))))),
      medianY: py(project(my, median(visible.map((r) => Number(r[my.key]))))),
      medianXValue: median(visible.map((r) => Number(r[mx.key]))),
      medianYValue: median(visible.map((r) => Number(r[my.key]))),
      bounds: {
        xMin: mx.log ? Math.pow(10, x0) : x0,
        xMax: mx.log ? Math.pow(10, x1) : x1,
        yMin: my.log ? Math.pow(10, y0) : y0,
        yMax: my.log ? Math.pow(10, y1) : y1,
      },
    };
  }, [rows, mx, my, group, club, search]);

  const chosen = selected ? rows.find((r) => r.id === selected) ?? null : null;

  return (
    <div className={styles.root}>
      <div className={styles.tools}>
        <input
          className={styles.input}
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search player"
        />
        <select
          className={styles.select}
          value={club}
          onChange={(e) => setClub(e.target.value)}
          aria-label="Club"
        >
          <option value="ALL">All clubs</option>
          {clubOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className={styles.axisBar}>
        {(['x', 'y'] as const).map((axis) => (
          <div key={axis} className={styles.axisRow}>
            <span className={`g-label-quiet ${styles.axisKey}`}>{axis.toUpperCase()}</span>
            <div className={styles.rail}>
              {METRICS.map((m) => {
                const on = (axis === 'x' ? xKey : yKey) === m.key;
                return (
                  <button
                    key={String(m.key)}
                    className={`${styles.pill} ${on ? styles.pillOn : ''}`}
                    aria-pressed={on}
                    onClick={() => {
                      if (axis === 'x') setXKey(String(m.key));
                      else setYKey(String(m.key));
                      setSelected(null);
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!view ? (
        <p className={styles.empty}>No players with data on both axes for {season.replace('-', '/')}.</p>
      ) : (
        <>
          <div className={styles.plotBox}>
            <span className={styles.axisY}>{my.axis}</span>
            <div className={styles.plot}>
              <span className={`${styles.tickY} ${styles.tickTop}`}>
                {view.bounds.yMax.toFixed(my.digits)}
              </span>
              <span className={`${styles.tickY} ${styles.tickBottom}`}>
                {view.bounds.yMin.toFixed(my.digits)}
              </span>
              <span className={`${styles.tickX} ${styles.tickLeft}`}>
                {view.bounds.xMin.toFixed(mx.digits)}
              </span>
              <span className={`${styles.tickX} ${styles.tickRight}`}>
                {view.bounds.xMax.toFixed(mx.digits)}
              </span>

              <i className={styles.medianV} style={{ left: `${view.medianX}%` }} />
              <i className={styles.medianH} style={{ bottom: `${view.medianY}%` }} />
              <span className={styles.medianLabelX} style={{ left: `${view.medianX}%` }}>
                med {view.medianXValue.toFixed(mx.digits)}
              </span>
              <span className={styles.medianLabelY} style={{ bottom: `${view.medianY}%` }}>
                med {view.medianYValue.toFixed(my.digits)}
              </span>

              {/* Built from the axis names so they stay correct for any pair. */}
              <span className={`${styles.quad} ${styles.quadTL}`}>
                High {my.label} · low {mx.label}
              </span>
              <span className={`${styles.quad} ${styles.quadTR}`}>
                High {my.label} · high {mx.label}
              </span>

              {view.points.map((p) => (
                <button
                  key={p.row.id}
                  type="button"
                  className={`${styles.dot} ${selected === p.row.id ? styles.dotSel : ''}`}
                  style={{
                    left: `${p.left}%`,
                    bottom: `${p.bottom}%`,
                    ['--d' as string]: `${p.size.toFixed(1)}px`,
                    ['--c' as string]: p.colour,
                  }}
                  title={`${p.row.name} — ${mx.label} ${Number(p.row[mx.key]).toFixed(mx.digits)}, ${my.label} ${Number(p.row[my.key]).toFixed(my.digits)}`}
                  aria-label={p.row.name}
                  onClick={() => setSelected(selected === p.row.id ? null : p.row.id)}
                />
              ))}
            </div>
            <span className={styles.axisX}>{mx.axis}</span>
          </div>

          <div className={styles.below}>
            <div className={styles.legend}>
              {LEGEND.map((g) => (
                <button
                  key={g.label}
                  className={`${styles.lg} ${group === g.label ? styles.lgOn : ''}`}
                  aria-pressed={group === g.label}
                  onClick={() => {
                    setGroup(group === g.label ? null : g.label);
                    setSelected(null);
                  }}
                >
                  <i style={{ background: POS_COLOR[g.positions[0]] }} />
                  {g.label}
                </button>
              ))}
            </div>

            {chosen ? (
              <div className={styles.selected}>
                <span className={styles.selName}>{chosen.name}</span>
                <span className={styles.selStats}>
                  {METRICS.map((m) => (
                    <span key={String(m.key)} className={styles.selStat}>
                      <b>
                        {chosen[m.key] == null ? '—' : Number(chosen[m.key]).toFixed(m.digits)}
                      </b>
                      <span className="g-label-quiet">{m.label}</span>
                    </span>
                  ))}
                </span>
                <NavigationLink
                  href={`/league/${leagueId}/players/${chosen.id}`}
                  className={styles.selLink}
                >
                  Open hub →
                </NavigationLink>
              </div>
            ) : (
              <span className={styles.hint}>
                {view.visible.length} players · click any point to inspect. Dot size is minutes
                played.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
