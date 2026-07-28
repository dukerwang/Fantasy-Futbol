'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { GranularPosition, Player } from '@/types';
import type { StatPlayer } from './page';
import PlayerDetailsModal from '@/components/players/PlayerDetailsModal';
import PosBadge from '@/components/players/PositionBadge';
import FormArrow from '@/components/players/FormArrow';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { Icon } from '@/components/ui/Icon';
import styles from './stats.module.css';

interface PositionStats {
  gp: number;
  total_points: number;
  avg_rating: number;
  total_minutes: number;
}

interface Props {
  leagueId: string;
  leagueName: string;
  players: StatPlayer[];
  shadowMaps: {
    // Optional: archived/precomputed snapshots predate this bucket and fall back to `all`.
    played?: Record<string, Record<string, PositionStats>>;
    all: Record<string, Record<string, PositionStats>>;
    gt45: Record<string, Record<string, PositionStats>>;
  };
}

type SortKey =
  | 'total_points'
  | 'ppg'
  | 'avg_rating'
  | 'market_value'
  | 'form'
  | 'total_minutes';

type SortDir = 'desc' | 'asc';

type PosFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT' | 'WIDE_DEF' | 'WING' | GranularPosition;

const DEF_POSITIONS: GranularPosition[] = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
const MID_POSITIONS: GranularPosition[] = ['DM', 'CM', 'AM'];
const ATT_POSITIONS: GranularPosition[] = ['LW', 'RW', 'ST'];
const WIDE_DEF_POSITIONS: GranularPosition[] = ['LB', 'RB', 'LWB', 'RWB'];
const WING_POSITIONS: GranularPosition[] = ['LW', 'RW'];

const POS_FILTER_OPTIONS: { label: string; value: PosFilter }[] = [
  { label: 'All Positions', value: 'ALL' },
  { label: 'GK', value: 'GK' },
  { label: 'DEF (CB/LB/RB/LWB/RWB)', value: 'DEF' },
  { label: 'Wide Defenders (LB/RB/LWB/RWB)', value: 'WIDE_DEF' },
  { label: 'MID (DM/CM/AM)', value: 'MID' },
  { label: 'ATT (LW/RW/ST)', value: 'ATT' },
  { label: 'Wingers (LW/RW)', value: 'WING' },
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
  if (group === 'WIDE_DEF') return WIDE_DEF_POSITIONS.includes(pos);
  if (group === 'WING') return WING_POSITIONS.includes(pos);
  return pos === group;
}

function resolveActivePosition(
  player: StatPlayer,
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
    const match = secondaries.find((pos) => groupContains(posFilter, pos as GranularPosition));
    if (match) return match as GranularPosition;
  } else if (posType === 'both') {
    if (groupContains(posFilter, primary)) {
      return primary;
    }
    const match = secondaries.find((pos) => groupContains(posFilter, pos as GranularPosition));
    if (match) return match as GranularPosition;
  }
  return null;
}

export default function GlobalStatsTable({ leagueId, leagueName, players, shadowMaps }: Props) {
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [minMins, setMinMins] = useState<'played' | 'all' | 'gt45'>('all');
  const [minGames, setMinGames] = useState<number>(0);
  // 'both' by default so a position's table lists everyone who plays there,
  // which is the pool the card's "ST #4" pill ranks over. Under the ALL filter
  // it behaves identically to 'primary' — it only differs once a position is
  // picked, which is exactly when hiding secondaries made the rank unreadable.
  const [posType, setPosType] = useState<'primary' | 'secondary' | 'both'>('both');
  const [sortKey, setSortKey] = useState<SortKey>('total_points');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  // Own modal so /share/stats works on public share pages without the dashboard card provider.
  const [viewingPlayer, setViewingPlayer] = useState<StatPlayer | null>(null);

  const shadowByPlayer =
    minMins === 'played' ? (shadowMaps.played ?? shadowMaps.all) : minMins === 'all' ? shadowMaps.all : shadowMaps.gt45;

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
    return players
      .map((p) => {
        const activePos = resolveActivePosition(p, posFilter, posType);
        return { player: p, activePos };
      })
      .filter((item): item is { player: StatPlayer; activePos: GranularPosition } => {
        const { player: p, activePos } = item;
        if (!activePos) return false;

        if (q) {
          const full = getPlayerDisplayName(p, 'full').toLowerCase();
          if (!full.includes(q) && !p.name.toLowerCase().includes(q)) return false;
        }

        const s = shadowByPlayer[p.id]?.[activePos];
        const gp = s?.gp ?? 0;
        if (gp < minGames) return false;

        return true;
      });
  }, [players, search, posFilter, posType, shadowByPlayer, minGames]);

  const sorted = useMemo(() => {
    return [...filtered].sort((aObj, bObj) => {
      let av = 0;
      let bv = 0;

      const sa = shadowByPlayer[aObj.player.id]?.[aObj.activePos];
      const sb = shadowByPlayer[bObj.player.id]?.[bObj.activePos];

      if (sortKey === 'total_points') {
        av = sa ? sa.total_points : 0;
        bv = sb ? sb.total_points : 0;
      } else if (sortKey === 'ppg') {
        // Always Pts/GP for the active minutes filter — never a frozen archive
        // column, or PPG drifts from the Pts and GP cells in the same row.
        av = sa && sa.gp > 0 ? sa.total_points / sa.gp : 0;
        bv = sb && sb.gp > 0 ? sb.total_points / sb.gp : 0;
      } else if (sortKey === 'avg_rating') {
        av = sa ? sa.avg_rating : 0;
        bv = sb ? sb.avg_rating : 0;
      } else if (sortKey === 'market_value') {
        av = aObj.player.market_value ?? 0;
        bv = bObj.player.market_value ?? 0;
      } else if (sortKey === 'form') {
        av = aObj.player.form_rating ?? 0;
        bv = bObj.player.form_rating ?? 0;
      } else if (sortKey === 'total_minutes') {
        av = sa ? sa.total_minutes : 0;
        bv = sb ? sb.total_minutes : 0;
      }

      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [filtered, shadowByPlayer, sortKey, sortDir]);

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) {
      return (
        <span className={styles.sortNeutral}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 15 5 5 5-5" />
            <path d="m7 9 5-5 5 5" />
          </svg>
        </span>
      );
    }
    return (
      <span className={styles.sortActive}>
        {sortDir === 'desc' ? (
          <Icon name="arrow-down" size={12} strokeWidth={2.5} />
        ) : (
          <Icon name="arrow-up" size={12} strokeWidth={2.5} />
        )}
      </span>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          {leagueId && (
            <p className={styles.breadcrumb}>
              <Link href={`/league/${leagueId}`}>{leagueName}</Link> / Stats
            </p>
          )}
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
        <select
          className={styles.posSelect}
          value={minMins}
          onChange={(e) => setMinMins(e.target.value as 'played' | 'all' | 'gt45')}
        >
          <option value="played">Played (&gt;0 mins)</option>
          <option value="all">Meaningful (&ge;15 mins)</option>
          <option value="gt45">Starters (&gt;45 mins)</option>
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

        <span className={styles.resultCount}>{sorted.length} players</span>
      </div>

      {/* Table */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thPlayer}>Player</th>
              <th className={styles.th}>Owner</th>
              <th className={`${styles.th} ${styles.thNum} ${styles.sortable}`} onClick={() => handleSort('total_minutes')}>
                GP {sortIndicator('total_minutes')}
              </th>
              <th className={`${styles.th} ${styles.thNum} ${styles.sortable}`} onClick={() => handleSort('total_points')}>
                Pts {sortIndicator('total_points')}
              </th>
              <th className={`${styles.th} ${styles.thNum} ${styles.sortable}`} onClick={() => handleSort('ppg')}>
                PPG {sortIndicator('ppg')}
              </th>
              <th className={`${styles.th} ${styles.thNum} ${styles.sortable}`} onClick={() => handleSort('avg_rating')}>
                Avg Rating {sortIndicator('avg_rating')}
              </th>
              <th className={`${styles.th} ${styles.thNum} ${styles.sortable}`} onClick={() => handleSort('form')}>
                Form {sortIndicator('form')}
              </th>
              <th className={`${styles.th} ${styles.thNum} ${styles.sortable}`} onClick={() => handleSort('market_value')}>
                Value {sortIndicator('market_value')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ player, activePos }) => {
              const s = shadowByPlayer[player.id]?.[activePos];
              const gp = s ? s.gp : 0;
              const totalPoints = s ? s.total_points : 0;
              // PPG must equal Pts/GP under the active minutes filter.
              const ppg = s && s.gp > 0 ? (s.total_points / s.gp).toFixed(2) : 'n/a';
              const avgRating = s && s.gp > 0 ? s.avg_rating.toFixed(2) : 'n/a';
              const isOwned = player.owner_team_name !== null;

              return (
                <tr
                  key={player.id}
                  className={styles.row}
                  onClick={() => setViewingPlayer(player)}
                  title="Click to scout player"
                >
                  <td className={styles.tdPlayer}>
                    <div className={styles.badgeWrapper}>
                      <PosBadge position={player.primary_position as GranularPosition} />
                      {player.primary_position !== activePos && (
                        <>
                          <span className={styles.secArrow} title={`Primary position: ${player.primary_position} — evaluated as ${activePos}`}>→</span>
                          <PosBadge position={activePos} />
                        </>
                      )}
                    </div>
                    <div className={styles.playerInfo}>
                      <span className={styles.playerName}>
                        {getPlayerDisplayName(player, 'full')}
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
                  <td className={`${styles.td} ${styles.tdNum}`}>{s ? gp : 'n/a'}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>
                    {s ? totalPoints.toFixed(2) : 'n/a'}
                  </td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{ppg}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{avgRating}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>
                    <FormArrow rating={player.form_rating} size={14} />
                  </td>
                  <td className={`${styles.td} ${styles.tdNum}`}>
                    {player.market_value != null ? `€${Number(player.market_value).toFixed(1)}m` : 'n/a'}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.emptyRow}>
                  No players match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PlayerDetailsModal
        player={viewingPlayer as unknown as Player | null}
        onClose={() => setViewingPlayer(null)}
      />
    </div>
  );
}
