'use client';

import { useEffect, useMemo, useState } from 'react';
import NavigationLink from '@/components/ui/NavigationLink';
import type { GranularPosition } from '@/types';
import type { StatPlayer } from './page';
import { playerHoverProps, usePlayerCard } from '@/components/players/PlayerCardProvider';
import PosBadge from '@/components/players/PositionBadge';
import FormArrow from '@/components/players/FormArrow';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { SPINE, POS_COLOR } from '@/lib/positions/spine';
import { Icon } from '@/components/ui/Icon';
import styles from './stats.module.css';
import { fold } from '@/lib/text/fold';

interface PositionStats {
  gp: number;
  total_points: number;
  avg_rating: number;
  total_minutes: number;
  goals: number;
  assists: number;
}

interface Props {
  leagueId: string;
  leagueName: string;
  players: StatPlayer[];
  /** "YYYY-YY". Optional so a caller that doesn't resolve one still renders. */
  season?: string;
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
  | 'total_minutes'
  | 'goals'
  | 'assists';

type SortDir = 'desc' | 'asc';

type PosFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT' | 'WIDE_DEF' | 'WING' | GranularPosition;

const DEF_POSITIONS: GranularPosition[] = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
const MID_POSITIONS: GranularPosition[] = ['DM', 'CM', 'AM'];
const ATT_POSITIONS: GranularPosition[] = ['LW', 'RW', 'ST'];
const WIDE_DEF_POSITIONS: GranularPosition[] = ['LB', 'RB', 'LWB', 'RWB'];
const WING_POSITIONS: GranularPosition[] = ['LW', 'RW'];

const POS_FILTER_OPTIONS: { label: string; value: PosFilter }[] = [
  { label: 'All positions', value: 'ALL' },
  { label: 'GK', value: 'GK' },
  { label: 'DEF (CB/LB/RB/LWB/RWB)', value: 'DEF' },
  { label: 'Wide defenders (LB/RB/LWB/RWB)', value: 'WIDE_DEF' },
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

export default function GlobalStatsTable({ leagueId, leagueName, players, season, shadowMaps }: Props) {
  const { openPlayer, prefetchPlayer, primePlayers } = usePlayerCard();
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [clubFilter, setClubFilter] = useState<string>('ALL');
  const [minMins, setMinMins] = useState<'played' | 'all' | 'gt45'>('all');
  const [minGames, setMinGames] = useState<number>(0);
  // 'both' by default so a position's table lists everyone who plays there,
  // which is the pool the card's "ST #4" pill ranks over. Under the ALL filter
  // it behaves identically to 'primary' — it only differs once a position is
  // picked, which is exactly when hiding secondaries made the rank unreadable.
  const [posType, setPosType] = useState<'primary' | 'secondary' | 'both'>('both');
  const [sortKey, setSortKey] = useState<SortKey>('total_points');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    if (players.length) primePlayers(players);
  }, [players, primePlayers]);

  const shadowByPlayer =
    minMins === 'played' ? (shadowMaps.played ?? shadowMaps.all) : minMins === 'all' ? shadowMaps.all : shadowMaps.gt45;

  const clubOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) {
      if (p.pl_team) set.add(p.pl_team);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [players]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(() => {
    const q = fold(search);
    return players
      .map((p) => {
        const activePos = resolveActivePosition(p, posFilter, posType);
        return { player: p, activePos };
      })
      .filter((item): item is { player: StatPlayer; activePos: GranularPosition } => {
        const { player: p, activePos } = item;
        if (!activePos) return false;

        if (clubFilter !== 'ALL' && p.pl_team !== clubFilter) return false;

        if (q) {
          const full = fold(getPlayerDisplayName(p, 'full'));
          if (!full.includes(q) && !fold(p.name).includes(q)) return false;
        }

        const s = shadowByPlayer[p.id]?.[activePos];
        const gp = s?.gp ?? 0;
        if (gp < minGames) return false;

        return true;
      });
  }, [players, search, posFilter, posType, clubFilter, shadowByPlayer, minGames]);

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
      } else if (sortKey === 'goals') {
        av = sa ? sa.goals : 0;
        bv = sb ? sb.goals : 0;
      } else if (sortKey === 'assists') {
        av = sa ? sa.assists : 0;
        bv = sb ? sb.assists : 0;
      }

      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [filtered, shadowByPlayer, sortKey, sortDir]);

  /**
   * A sortable column head. It is a real <button> inside the <th>, not a click
   * handler on the <th> — eight of this table's ten columns are sortable and
   * none of them could be reached from the keyboard before.
   */
  function SortHead({ label, sortBy, title }: { label: string; sortBy: SortKey; title?: string }) {
    const active = sortKey === sortBy;
    return (
      <button
        type="button"
        className={styles.sortable}
        onClick={() => handleSort(sortBy)}
        title={title}
      >
        {label}
        <span className={`${styles.sortIcon} ${active ? styles.sortIconOn : ''}`} aria-hidden>
          {active ? (
            <Icon name={sortDir === 'desc' ? 'arrow-down' : 'arrow-up'} size={11} strokeWidth={2.5} />
          ) : (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7 15 5 5 5-5" />
              <path d="m7 9 5-5 5 5" />
            </svg>
          )}
        </span>
      </button>
    );
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none';
    return sortDir === 'desc' ? 'descending' : 'ascending';
  }

  return (
    <div className={`${styles.page} g-page`}>
      {/* The spectrum. Rationed to a panel representing a whole squad or the
          whole player database. Third use in the app, after the pitch board
          and the depth chart. */}
      <div className={`g-spectrum ${styles.spectrum}`} aria-hidden>
        {SPINE.map((p) => <i key={p} style={{ background: POS_COLOR[p] }} />)}
      </div>

      <header className={styles.header}>
        <div>
          <div className={`g-label ${styles.kicker}`}>
            {leagueId ? (
              <NavigationLink href={`/league/${leagueId}`}>{leagueName}</NavigationLink>
            ) : (
              leagueName
            )}
          </div>
          <h1 className={styles.title}>
            Player Stats{season ? ` ${season.replace('-', '/')}` : ''}
          </h1>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statAccent}`}>{sorted.length}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>
              {sorted.length === players.length ? 'Players' : `Shown of ${players.length}`}
            </div>
          </div>
        </div>
      </header>

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
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value as PosFilter)}
          aria-label="Position"
        >
          {POS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={clubFilter}
          onChange={(e) => setClubFilter(e.target.value)}
          aria-label="Club"
        >
          <option value="ALL">All clubs</option>
          {clubOptions.map((club) => (
            <option key={club} value={club}>
              {club}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={minMins}
          onChange={(e) => setMinMins(e.target.value as 'played' | 'all' | 'gt45')}
          aria-label="Minutes filter"
        >
          <option value="played">Played (&gt;0 mins)</option>
          <option value="all">Meaningful (&ge;15 mins)</option>
          <option value="gt45">Starters (&gt;45 mins)</option>
        </select>

        <div className={styles.slider}>
          <label className={styles.sliderLabel} htmlFor="minGames">Min games</label>
          <input
            id="minGames"
            type="range"
            min="0"
            max="38"
            value={minGames}
            onChange={(e) => setMinGames(parseInt(e.target.value))}
            className={styles.sliderInput}
          />
          <span className={styles.sliderValue}>{minGames}</span>
        </div>

        <div className={styles.segmented} role="group" aria-label="Which positions count">
          {(['primary', 'secondary', 'both'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.segment} ${posType === t ? styles.segmentOn : ''}`}
              aria-pressed={posType === t}
              onClick={() => setPosType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thPlayer}>Player</th>
              <th className={styles.thOwner}>Owner</th>
              <th className={`${styles.thNarrow} ${styles.num}`} aria-sort={ariaSort('total_minutes')}>
                <SortHead label="GP" sortBy="total_minutes" title="Games played — sorted by minutes" />
              </th>
              <th className={`${styles.thNarrow} ${styles.num}`} aria-sort={ariaSort('goals')}>
                <SortHead label="G" sortBy="goals" title="Goals" />
              </th>
              <th className={`${styles.thNarrow} ${styles.num}`} aria-sort={ariaSort('assists')}>
                <SortHead label="A" sortBy="assists" title="Assists" />
              </th>
              <th className={`${styles.thWide} ${styles.num}`} aria-sort={ariaSort('total_points')}>
                <SortHead label="Pts" sortBy="total_points" />
              </th>
              <th className={`${styles.thWide} ${styles.num}`} aria-sort={ariaSort('ppg')}>
                <SortHead label="PPG" sortBy="ppg" />
              </th>
              <th className={`${styles.thNarrow} ${styles.num}`} aria-sort={ariaSort('avg_rating')}>
                <SortHead label="Rating" sortBy="avg_rating" />
              </th>
              <th className={`${styles.thNarrow} ${styles.num}`} aria-sort={ariaSort('form')}>
                <SortHead label="Form" sortBy="form" />
              </th>
              <th className={`${styles.thWide} ${styles.num}`} aria-sort={ariaSort('market_value')}>
                <SortHead label="Value" sortBy="market_value" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ player, activePos }) => {
              const s = shadowByPlayer[player.id]?.[activePos];
              const gp = s ? s.gp : 0;
              const totalPoints = s ? s.total_points : 0;
              // PPG must equal Pts/GP under the active minutes filter.
              const ppg = s && s.gp > 0 ? (s.total_points / s.gp).toFixed(2) : null;
              const avgRating = s && s.gp > 0 ? s.avg_rating.toFixed(2) : null;
              const isOwned = player.owner_team_name !== null;

              return (
                <tr
                  key={player.id}
                  className={`g-row ${styles.row}`}
                  style={{ ['--pf' as string]: POS_COLOR[activePos] }}
                  onClick={() => openPlayer(player)}
                  {...playerHoverProps(prefetchPlayer, player)}
                  title="Click to scout player"
                >
                  <td className={styles.tdPlayer}>
                    <div className={styles.playerRow}>
                      <span className={`g-namerow ${styles.playerBadges}`}>
                        <PosBadge position={player.primary_position as GranularPosition} />
                        {player.primary_position !== activePos && (
                          <>
                            <span
                              className={styles.asArrow}
                              title={`Primary position: ${player.primary_position} — evaluated as ${activePos}`}
                            >
                              →
                            </span>
                            <PosBadge position={activePos} />
                          </>
                        )}
                      </span>
                      <div className={styles.playerText}>
                        <span className={styles.playerName}>
                          {getPlayerDisplayName(player, 'full')}
                        </span>
                        <div className={`g-label-quiet ${styles.playerClub}`}>{player.pl_team}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {isOwned ? (
                      <div className={styles.owner}>{player.owner_team_name}</div>
                    ) : (
                      <div className={`${styles.owner} ${styles.free}`}>Free agent</div>
                    )}
                  </td>
                  <td className={`${styles.num} ${s ? '' : styles.na}`}>{s ? gp : '—'}</td>
                  <td className={`${styles.num} ${s ? '' : styles.na}`}>{s ? s.goals : '—'}</td>
                  <td className={`${styles.num} ${s ? '' : styles.na}`}>{s ? s.assists : '—'}</td>
                  <td className={`${styles.num} ${s ? '' : styles.na}`}>
                    {s ? totalPoints.toFixed(2) : '—'}
                  </td>
                  <td className={`${styles.num} ${ppg ? '' : styles.na}`}>{ppg ?? '—'}</td>
                  <td className={`${styles.num} ${avgRating ? '' : styles.na}`}>{avgRating ?? '—'}</td>
                  <td className={styles.num}>
                    <FormArrow rating={player.form_rating} size={14} />
                  </td>
                  <td className={`${styles.num} ${player.market_value != null ? '' : styles.na}`}>
                    {player.market_value != null ? `€${Number(player.market_value).toFixed(1)}m` : '—'}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className={styles.empty}>
                  No players match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
