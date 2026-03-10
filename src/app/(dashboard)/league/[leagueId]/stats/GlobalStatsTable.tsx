'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { GranularPosition } from '@/types';
import type { StatPlayer } from './page';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import PosBadge from '@/components/players/PositionBadge';
import { formatPlayerName } from '@/lib/formatName';
import styles from './stats.module.css';

interface Props {
  leagueId: string;
  leagueName: string;
  players: StatPlayer[];
}

type SortKey = 'total_points' | 'ppg' | 'projected_points' | 'market_value' | 'form';
type SortDir = 'desc' | 'asc';

const DEF_POSITIONS: GranularPosition[] = ['CB', 'LB', 'RB'];
const MID_POSITIONS: GranularPosition[] = ['DM', 'CM', 'AM', 'LM', 'RM'];
const ATT_POSITIONS: GranularPosition[] = ['LW', 'RW', 'ST'];
const ALL_GRANULAR: GranularPosition[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST'];

type PosFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT' | GranularPosition;

const POS_FILTER_OPTIONS: { label: string; value: PosFilter }[] = [
  { label: 'All Positions', value: 'ALL' },
  { label: 'GK', value: 'GK' },
  { label: 'DEF (CB/LB/RB)', value: 'DEF' },
  { label: 'MID (DM/CM/AM)', value: 'MID' },
  { label: 'ATT (LW/RW/ST)', value: 'ATT' },
  ...(['CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST'] as GranularPosition[]).map((p) => ({
    label: p,
    value: p as PosFilter,
  })),
];

function matchesPos(player: StatPlayer, filter: PosFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'DEF') return DEF_POSITIONS.includes(player.primary_position);
  if (filter === 'MID') return MID_POSITIONS.includes(player.primary_position);
  if (filter === 'ATT') return ATT_POSITIONS.includes(player.primary_position);
  return player.primary_position === filter || player.secondary_positions?.includes(filter as GranularPosition);
}

export default function GlobalStatsTable({ leagueId, leagueName, players }: Props) {
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('total_points');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [viewingPlayer, setViewingPlayer] = useState<StatPlayer | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter((p) => {
      if (q && !formatPlayerName(p, 'full').toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
      if (!matchesPos(p, posFilter)) return false;
      return true;
    });
  }, [players, search, posFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = 0;
      let bv = 0;
      if (sortKey === 'total_points') {
        av = a.total_points ?? 0;
        bv = b.total_points ?? 0;
      } else if (sortKey === 'ppg') {
        av = a.games_played > 0 ? (a.total_points ?? 0) / a.games_played : 0;
        bv = b.games_played > 0 ? (b.total_points ?? 0) / b.games_played : 0;
      } else if (sortKey === 'projected_points') {
        av = a.projected_points ?? 0;
        bv = b.projected_points ?? 0;
      } else if (sortKey === 'market_value') {
        av = a.market_value ?? 0;
        bv = b.market_value ?? 0;
      } else if (sortKey === 'form') {
        av = a.form ?? 0;
        bv = b.form ?? 0;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [filtered, sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return <span className={styles.sortNeutral}>↕</span>;
    return <span className={styles.sortActive}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <p className={styles.breadcrumb}>
            <Link href={`/league/${leagueId}`}>{leagueName}</Link> / Stats
          </p>
          <h1 className={styles.title}>Player Stats</h1>
          <p className={styles.subtitle}>
            {players.length} players · season totals · click a row to scout
          </p>
        </div>
      </header>

      {/* Controls */}
      <div className={styles.controls}>
        <input
          className={styles.searchInput}
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={styles.posSelect}
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value as PosFilter)}
        >
          {POS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className={styles.resultCount}>{sorted.length} players</span>
      </div>

      {/* Table */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thPlayer}>Player</th>
              <th className={styles.th}>Owner</th>
              <th className={`${styles.th} ${styles.sortable}`} onClick={() => handleSort('total_points')}>
                Pts {sortIndicator('total_points')}
              </th>
              <th className={`${styles.th} ${styles.sortable}`} onClick={() => handleSort('ppg')}>
                PPG {sortIndicator('ppg')}
              </th>
              <th className={`${styles.th} ${styles.sortable}`} onClick={() => handleSort('projected_points')}>
                Proj {sortIndicator('projected_points')}
              </th>
              <th className={`${styles.th} ${styles.sortable}`} onClick={() => handleSort('form')}>
                Form {sortIndicator('form')}
              </th>
              <th className={`${styles.th} ${styles.sortable}`} onClick={() => handleSort('market_value')}>
                Value {sortIndicator('market_value')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((player) => {
              const ppg = player.ppg != null ? player.ppg.toFixed(1) : '—';
              const isOwned = player.owner_team_name !== null;

              return (
                <tr
                  key={player.id}
                  className={styles.row}
                  onClick={() => setViewingPlayer(player)}
                  title="Click to scout player"
                >
                  <td className={styles.tdPlayer}>
                    <PosBadge position={player.primary_position} />
                    <div className={styles.playerInfo}>
                      <span className={styles.playerName}>
                        {formatPlayerName(player, 'full')}
                      </span>
                      <span className={styles.playerClub}>{player.pl_team}</span>
                    </div>
                  </td>
                  <td className={styles.td}>
                    {isOwned ? (
                      <span className={styles.ownerTag}>{player.owner_team_name}</span>
                    ) : (
                      <span className={styles.freeAgentTag}>Free Agent</span>
                    )}
                  </td>
                  <td className={`${styles.td} ${styles.tdNum}`}>
                    {player.total_points != null ? Number(player.total_points).toFixed(1) : '—'}
                  </td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{ppg}</td>
                  <td className={`${styles.td} ${styles.tdNum}`} style={{ color: 'var(--color-text-secondary)', fontWeight: 'var(--font-medium)' }}>
                    {player.projected_points != null ? Number(player.projected_points).toFixed(1) : '—'}
                  </td>
                  <td className={`${styles.td} ${styles.tdNum}`}>
                    {player.form != null ? Number(player.form).toFixed(1) : '—'}
                  </td>
                  <td className={`${styles.td} ${styles.tdNum}`}>
                    £{Number(player.market_value ?? 0).toFixed(1)}m
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className={styles.emptyRow}>
                  No players match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PlayerDetailsModal
        player={viewingPlayer}
        onClose={() => setViewingPlayer(null)}
      />
    </div>
  );
}
