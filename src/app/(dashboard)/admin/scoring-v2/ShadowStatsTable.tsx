'use client';

import { useMemo, useState } from 'react';
import type { GranularPosition } from '@/types';
import PosBadge from '@/components/players/PositionBadge';
import { formatPlayerName } from '@/lib/formatName';
import styles from './scoring-v2.module.css';

export interface ShadowStatsPayload {
  gp: number;
  ptsV1: number;
  ptsV2: number;
  ppgV1: number;
  ppgV2: number;
  p90V1: number;
  p90V2: number;
  /** Season avg v1 match rating; null when legacy `match_rating` was never stored on those rows. */
  avgRV1: number | null;
  /** Season avg v2 match rating over `gp`. */
  avgRV2: number;
  totalMinutes?: number;
}

/** Minimal player row — mirrors league Stats page fields used in the table. */
export interface ShadowStatsPlayer {
  id: string;
  primary_position: GranularPosition;
  secondary_positions: GranularPosition[] | null;
  web_name: string | null;
  name: string;
  full_name: string | null;
  pl_team: string;
  total_points: number | null;
  ppg: number | null;
  market_value: number;
  projected_points: number | null;
}

type SortKey =
  | 'pts_v2'
  | 'pts_v1'
  | 'delta_pts'
  | 'ppg_v2'
  | 'ppg_v1'
  | 'delta_ppg'
  | 'p90_v2'
  | 'p90_v1'
  | 'delta_p90'
  | 'avg_r_v1'
  | 'avg_r_v2'
  | 'delta_avg_r'
  | 'projected_points'
  | 'market_value'
  | 'total_minutes';

type SortDir = 'desc' | 'asc';

type PosFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT' | GranularPosition;

const DEF_POSITIONS: GranularPosition[] = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
const MID_POSITIONS: GranularPosition[] = ['DM', 'CM', 'AM'];
const ATT_POSITIONS: GranularPosition[] = ['LW', 'RW', 'ST'];

const POS_FILTER_OPTIONS: { label: string; value: PosFilter }[] = [
  { label: 'All Positions', value: 'ALL' },
  { label: 'GK', value: 'GK' },
  { label: 'DEF (CB/LB/RB/LWB/RWB)', value: 'DEF' },
  { label: 'MID (DM/CM/AM)', value: 'MID' },
  { label: 'ATT (LW/RW/ST)', value: 'ATT' },
  ...(['CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as GranularPosition[]).map((p) => ({
    label: p,
    value: p as PosFilter,
  })),
];

function groupContains(group: PosFilter, pos: GranularPosition): boolean {
  if (group === 'ALL') return true;
  if (group === 'GK') return pos === 'GK';
  if (group === 'DEF') return DEF_POSITIONS.includes(pos);
  if (group === 'MID') return MID_POSITIONS.includes(pos);
  if (group === 'ATT') return ATT_POSITIONS.includes(pos);
  return pos === group;
}

function resolveActivePosition(
  player: ShadowStatsPlayer,
  posFilter: PosFilter,
  posType: 'primary' | 'secondary' | 'both'
): GranularPosition | null {
  const primary = player.primary_position;
  const secondaries = player.secondary_positions ?? [];

  if (posType === 'primary') {
    if (groupContains(posFilter, primary)) {
      return primary;
    }
  } else if (posType === 'secondary') {
    const match = secondaries.find((pos) => groupContains(posFilter, pos));
    if (match) return match;
  } else if (posType === 'both') {
    if (groupContains(posFilter, primary)) {
      return primary;
    }
    const match = secondaries.find((pos) => groupContains(posFilter, pos));
    if (match) return match;
  }
  return null;
}

interface Props {
  statsSeason: string;
  players: ShadowStatsPlayer[];
  shadowMaps: {
    all: Record<string, Record<string, ShadowStatsPayload>>;
    gt45: Record<string, Record<string, ShadowStatsPayload>>;
  };
}

export default function ShadowStatsTable({ statsSeason, players, shadowMaps }: Props) {
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [minMins, setMinMins] = useState<'all' | 'gt45'>('all');
  const [minGames, setMinGames] = useState<number>(0);
  const [posType, setPosType] = useState<'primary' | 'secondary' | 'both'>('primary');
  const [sortKey, setSortKey] = useState<SortKey>('pts_v2');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const shadowByPlayer = minMins === 'all' ? shadowMaps.all : shadowMaps.gt45;

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return <span className={styles.shadowSortNeutral}>↕</span>;
    return <span className={styles.shadowSortActive}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .map((p) => {
        const activePos = resolveActivePosition(p, posFilter, posType);
        return { player: p, activePos };
      })
      .filter((item): item is { player: ShadowStatsPlayer; activePos: GranularPosition } => {
        const { player: p, activePos } = item;
        if (!activePos) return false;

        if (q) {
          const full = formatPlayerName(p, 'full').toLowerCase();
          if (!full.includes(q) && !p.name.toLowerCase().includes(q)) return false;
        }

        const s = shadowByPlayer[p.id]?.[activePos];
        const gp = s?.gp ?? 0;
        if (gp < minGames) return false;

        return true;
      });
  }, [players, search, posFilter, posType, shadowByPlayer, minGames]);

  const sorted = useMemo(() => {
    const shadowRequired = sortKey !== 'projected_points' && sortKey !== 'market_value';

    return [...filtered].sort((aObj, bObj) => {
      const a = aObj.player;
      const b = bObj.player;
      const activePosA = aObj.activePos;
      const activePosB = bObj.activePos;

      const sa = shadowByPlayer[a.id]?.[activePosA];
      const sb = shadowByPlayer[b.id]?.[activePosB];

      if (shadowRequired) {
        if (!sa && !sb) return 0;
        if (!sa) return 1;
        if (!sb) return -1;
      }

      let av = 0;
      let bv = 0;
      if (sortKey === 'pts_v2') {
        av = sa?.ptsV2 ?? 0;
        bv = sb?.ptsV2 ?? 0;
      } else if (sortKey === 'pts_v1') {
        av = sa?.ptsV1 ?? 0;
        bv = sb?.ptsV1 ?? 0;
      } else if (sortKey === 'delta_pts') {
        av = sa ? sa.ptsV2 - sa.ptsV1 : 0;
        bv = sb ? sb.ptsV2 - sb.ptsV1 : 0;
      } else if (sortKey === 'ppg_v2') {
        av = sa?.ppgV2 ?? 0;
        bv = sb?.ppgV2 ?? 0;
      } else if (sortKey === 'ppg_v1') {
        av = sa?.ppgV1 ?? 0;
        bv = sb?.ppgV1 ?? 0;
      } else if (sortKey === 'delta_ppg') {
        av = sa ? sa.ppgV2 - sa.ppgV1 : 0;
        bv = sb ? sb.ppgV2 - sb.ppgV1 : 0;
      } else if (sortKey === 'p90_v2') {
        av = sa?.p90V2 ?? 0;
        bv = sb?.p90V2 ?? 0;
      } else if (sortKey === 'p90_v1') {
        av = sa?.p90V1 ?? 0;
        bv = sb?.p90V1 ?? 0;
      } else if (sortKey === 'delta_p90') {
        av = sa ? sa.p90V2 - sa.p90V1 : 0;
        bv = sb ? sb.p90V2 - sb.p90V1 : 0;
      } else if (sortKey === 'total_minutes') {
        av = sa?.totalMinutes ?? 0;
        bv = sb?.totalMinutes ?? 0;
      } else if (sortKey === 'avg_r_v1') {
        av = sa?.avgRV1 ?? -1e9;
        bv = sb?.avgRV1 ?? -1e9;
      } else if (sortKey === 'avg_r_v2') {
        av = sa?.avgRV2 ?? 0;
        bv = sb?.avgRV2 ?? 0;
      } else if (sortKey === 'delta_avg_r') {
        av = sa && sa.avgRV1 != null ? sa.avgRV2 - sa.avgRV1 : -1e9;
        bv = sb && sb.avgRV1 != null ? sb.avgRV2 - sb.avgRV1 : -1e9;
      } else if (sortKey === 'projected_points') {
        av = a.projected_points ?? -1e9;
        bv = b.projected_points ?? -1e9;
      } else if (sortKey === 'market_value') {
        av = a.market_value ?? 0;
        bv = b.market_value ?? 0;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [filtered, shadowByPlayer, sortKey, sortDir]);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Full season leaderboard (v1 vs v2)</h2>
      <p className={styles.sectionHint}>
        Every active player, same filters/sort UX as league <strong>Stats</strong>.{' '}
        <strong>GP</strong> counts v2-populated fixtures in <strong>{statsSeason}</strong> where the player had
        minutes (&gt; 0) — DNPs are excluded, matching league <strong>Stats</strong> PPG. <strong>Pts</strong> and{' '}
        <strong>PPG</strong> are the season sum and average over those played fixtures. <strong>Avg R v1</strong>{' '}
        averages only played rows that also have legacy <code>match_rating</code>. <strong>Avg R v2</strong> uses the
        same played-fixture sample as Pts/PPG.
      </p>

      <div className={styles.shadowControls}>
        <input
          className={styles.shadowSearch}
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={styles.shadowSelect}
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value as PosFilter)}
        >
          {POS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className={styles.shadowSelect}
          value={minMins}
          onChange={(e) => setMinMins(e.target.value as 'all' | 'gt45')}
        >
          <option value="all">All Played Games (&gt;0 mins)</option>
          <option value="gt45">Starter Games (&gt;45 mins only)</option>
        </select>

        {/* Dynamic Games Played Slider */}
        <div className={styles.sliderContainer}>
          <span className={styles.sliderLabel}>Min Games: <strong>{minGames}</strong></span>
          <input
            type="range"
            min="0"
            max="38"
            value={minGames}
            onChange={(e) => setMinGames(parseInt(e.target.value))}
            className={styles.sliderInput}
          />
        </div>

        {/* Position Type Segmented Control */}
        <div className={styles.segmentedToggle}>
          <button
            type="button"
            className={`${styles.toggleButton} ${posType === 'primary' ? styles.activeToggle : ''}`}
            onClick={() => setPosType('primary')}
          >
            Primary
          </button>
          <button
            type="button"
            className={`${styles.toggleButton} ${posType === 'secondary' ? styles.activeToggle : ''}`}
            onClick={() => setPosType('secondary')}
          >
            Secondary
          </button>
          <button
            type="button"
            className={`${styles.toggleButton} ${posType === 'both' ? styles.activeToggle : ''}`}
            onClick={() => setPosType('both')}
          >
            Both
          </button>
        </div>

        <span className={styles.shadowResultCount}>{sorted.length} players</span>
      </div>

      <div className={styles.shadowTableWrap}>
        <table className={styles.shadowTable}>
          <thead>
            <tr>
              <th className={styles.shadowThPlayer}>Player</th>
              <th className={styles.shadowTh}>GP</th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('total_minutes')}>
                Mins {sortIndicator('total_minutes')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('pts_v1')}>
                Pts v1 {sortIndicator('pts_v1')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('pts_v2')}>
                Pts v2 {sortIndicator('pts_v2')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('delta_pts')}>
                Δ pts {sortIndicator('delta_pts')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('ppg_v1')}>
                PPG v1 {sortIndicator('ppg_v1')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('ppg_v2')}>
                PPG v2 {sortIndicator('ppg_v2')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('delta_ppg')}>
                Δ PPG {sortIndicator('delta_ppg')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('p90_v1')}>
                P90 v1 {sortIndicator('p90_v1')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('p90_v2')}>
                P90 v2 {sortIndicator('p90_v2')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('delta_p90')}>
                Δ P90 {sortIndicator('delta_p90')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('avg_r_v1')}>
                Avg R v1 {sortIndicator('avg_r_v1')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('avg_r_v2')}>
                Avg R v2 {sortIndicator('avg_r_v2')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('delta_avg_r')}>
                Δ Avg R {sortIndicator('delta_avg_r')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('projected_points')}>
                Proj {sortIndicator('projected_points')}
              </th>
              <th className={`${styles.shadowTh} ${styles.shadowSortable}`} onClick={() => handleSort('market_value')}>
                Value {sortIndicator('market_value')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ player, activePos }) => {
              const s = shadowByPlayer[player.id]?.[activePos];
              const dPts = s ? s.ptsV2 - s.ptsV1 : null;
              const dPpg = s ? s.ppgV2 - s.ppgV1 : null;
              const dP90 = s ? s.p90V2 - s.p90V1 : null;
              const dAvgR =
                s != null && s.avgRV1 != null ? s.avgRV2 - s.avgRV1 : null;
              const ppgV1s = s ? s.ppgV1.toFixed(1) : '—';
              const ppgV2s = s ? s.ppgV2.toFixed(1) : '—';
              const p90V1s = s ? s.p90V1.toFixed(1) : '—';
              const p90V2s = s ? s.p90V2.toFixed(1) : '—';
              const avgR1s = s?.avgRV1 != null ? s.avgRV1.toFixed(2) : '—';

              return (
                <tr key={player.id} className={styles.shadowRow}>
                  <td className={styles.shadowTdPlayer}>
                    <div className={styles.badgeWrapper}>
                      <PosBadge position={player.primary_position} />
                      {player.primary_position !== activePos && (
                        <>
                          <span className={styles.secArrow}>→</span>
                          <span className={styles.activeSecBadge} title={`Evaluated at secondary role: ${activePos}`}>
                            {activePos}
                          </span>
                        </>
                      )}
                    </div>
                    <div className={styles.shadowPlayerInfo}>
                      <span className={styles.shadowPlayerName}>
                        {formatPlayerName(player, 'full')}
                      </span>
                      <span className={styles.shadowPlayerClub}>{player.pl_team}</span>
                    </div>
                  </td>
                  <td className={styles.shadowTdNum}>{s?.gp ?? '—'}</td>
                  <td className={styles.shadowTdNum}>{s?.totalMinutes ?? '—'}</td>
                  <td className={styles.shadowTdNum}>{s ? s.ptsV1.toFixed(1) : '—'}</td>
                  <td className={styles.shadowTdNum}>{s ? s.ptsV2.toFixed(1) : '—'}</td>
                  <td className={`${styles.shadowTdNum} ${dPts != null ? (dPts >= 0 ? styles.cellNumPos : styles.cellNumNeg) : ''}`}>
                    {dPts != null ? `${dPts >= 0 ? '+' : ''}${dPts.toFixed(1)}` : '—'}
                  </td>
                  <td className={styles.shadowTdNum}>{ppgV1s}</td>
                  <td className={styles.shadowTdNum}>{ppgV2s}</td>
                  <td className={`${styles.shadowTdNum} ${dPpg != null ? (dPpg >= 0 ? styles.cellNumPos : styles.cellNumNeg) : ''}`}>
                    {dPpg != null ? `${dPpg >= 0 ? '+' : ''}${dPpg.toFixed(2)}` : '—'}
                  </td>
                  <td className={styles.shadowTdNum}>{p90V1s}</td>
                  <td className={styles.shadowTdNum}>{p90V2s}</td>
                  <td className={`${styles.shadowTdNum} ${dP90 != null ? (dP90 >= 0 ? styles.cellNumPos : styles.cellNumNeg) : ''}`}>
                    {dP90 != null ? `${dP90 >= 0 ? '+' : ''}${dP90.toFixed(2)}` : '—'}
                  </td>
                  <td className={styles.shadowTdNum}>{avgR1s}</td>
                  <td className={styles.shadowTdNum}>{s ? s.avgRV2.toFixed(2) : '—'}</td>
                  <td className={`${styles.shadowTdNum} ${dAvgR != null ? (dAvgR >= 0 ? styles.cellNumPos : styles.cellNumNeg) : ''}`}>
                    {dAvgR != null ? `${dAvgR >= 0 ? '+' : ''}${dAvgR.toFixed(2)}` : '—'}
                  </td>
                  <td className={styles.shadowTdNum}>
                    {player.projected_points != null ? Number(player.projected_points).toFixed(1) : '—'}
                  </td>
                  <td className={styles.shadowTdNum}>£{Number(player.market_value ?? 0).toFixed(1)}m</td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={17} className={styles.shadowEmpty}>
                  No players match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
