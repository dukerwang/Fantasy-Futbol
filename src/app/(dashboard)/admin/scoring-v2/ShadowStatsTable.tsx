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
  /** Season average 1–10 match rating (same GP as pts). */
  avgRV1: number;
  avgRV2: number;
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
  | 'avg_r_v1'
  | 'avg_r_v2'
  | 'delta_avg_r'
  | 'projected_points'
  | 'market_value';

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

function matchesPos(player: ShadowStatsPlayer, filter: PosFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'DEF') return DEF_POSITIONS.includes(player.primary_position);
  if (filter === 'MID') return MID_POSITIONS.includes(player.primary_position);
  if (filter === 'ATT') return ATT_POSITIONS.includes(player.primary_position);
  return (
    player.primary_position === filter ||
    (player.secondary_positions?.includes(filter as GranularPosition) ?? false)
  );
}

interface Props {
  statsSeason: string;
  players: ShadowStatsPlayer[];
  shadowByPlayer: Record<string, ShadowStatsPayload>;
}

export default function ShadowStatsTable({ statsSeason, players, shadowByPlayer }: Props) {
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('pts_v2');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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
    return players.filter((p) => {
      if (q) {
        const full = formatPlayerName(p, 'full').toLowerCase();
        if (!full.includes(q) && !p.name.toLowerCase().includes(q)) return false;
      }
      if (!matchesPos(p, posFilter)) return false;
      return true;
    });
  }, [players, search, posFilter]);

  const sorted = useMemo(() => {
    const shadowRequired = sortKey !== 'projected_points' && sortKey !== 'market_value';

    return [...filtered].sort((a, b) => {
      const sa = shadowByPlayer[a.id];
      const sb = shadowByPlayer[b.id];

      if (shadowRequired) {
        if (!sa && !sb) return 0;
        if (!sa) return 1;
        if (!sb) return -1;
      }

      let av = 0;
      let bv = 0;
      if (sortKey === 'pts_v2') {
        av = sa!.ptsV2;
        bv = sb!.ptsV2;
      } else if (sortKey === 'pts_v1') {
        av = sa!.ptsV1;
        bv = sb!.ptsV1;
      } else if (sortKey === 'delta_pts') {
        av = sa!.ptsV2 - sa!.ptsV1;
        bv = sb!.ptsV2 - sb!.ptsV1;
      } else if (sortKey === 'ppg_v2') {
        av = sa!.ppgV2;
        bv = sb!.ppgV2;
      } else if (sortKey === 'ppg_v1') {
        av = sa!.ppgV1;
        bv = sb!.ppgV1;
      } else if (sortKey === 'delta_ppg') {
        av = sa!.ppgV2 - sa!.ppgV1;
        bv = sb!.ppgV2 - sb!.ppgV1;
      } else if (sortKey === 'avg_r_v1') {
        av = sa!.avgRV1;
        bv = sb!.avgRV1;
      } else if (sortKey === 'avg_r_v2') {
        av = sa!.avgRV2;
        bv = sb!.avgRV2;
      } else if (sortKey === 'delta_avg_r') {
        av = sa!.avgRV2 - sa!.avgRV1;
        bv = sb!.avgRV2 - sb!.avgRV1;
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
        <strong>GP</strong> is how many games that player has in <code>player_stats</code> for{' '}
        <strong>{statsSeason}</strong> where both engines are populated (after backfill, that is the full season for
        most players). <strong>Pts</strong> and <strong>PPG</strong> are the full-season sum and average over{' '}
        <em>those same GP</em>. <strong>Avg R v1 / v2</strong> is the season average 1–10 match rating over the same
        games — not a rolling 3-game window. League Stats &quot;Form&quot; is still last-3 there; here everything is
        apples-to-apples on the full shadow sample.
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
        <span className={styles.shadowResultCount}>{sorted.length} players</span>
      </div>

      <div className={styles.shadowTableWrap}>
        <table className={styles.shadowTable}>
          <thead>
            <tr>
              <th className={styles.shadowThPlayer}>Player</th>
              <th className={styles.shadowTh}>GP</th>
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
            {sorted.map((player) => {
              const s = shadowByPlayer[player.id];
              const dPts = s ? s.ptsV2 - s.ptsV1 : null;
              const dPpg = s ? s.ppgV2 - s.ppgV1 : null;
              const dAvgR = s ? s.avgRV2 - s.avgRV1 : null;
              const ppgV1s = s ? s.ppgV1.toFixed(1) : '—';
              const ppgV2s = s ? s.ppgV2.toFixed(1) : '—';

              return (
                <tr key={player.id} className={styles.shadowRow}>
                  <td className={styles.shadowTdPlayer}>
                    <PosBadge position={player.primary_position} />
                    <div className={styles.shadowPlayerInfo}>
                      <span className={styles.shadowPlayerName}>
                        {formatPlayerName(player, 'full')}
                      </span>
                      <span className={styles.shadowPlayerClub}>{player.pl_team}</span>
                    </div>
                  </td>
                  <td className={styles.shadowTdNum}>{s?.gp ?? '—'}</td>
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
                  <td className={styles.shadowTdNum}>{s ? s.avgRV1.toFixed(2) : '—'}</td>
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
                <td colSpan={13} className={styles.shadowEmpty}>
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
