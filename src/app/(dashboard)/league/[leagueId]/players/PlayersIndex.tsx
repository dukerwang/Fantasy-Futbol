'use client';

import { useEffect, useMemo, useState } from 'react';
import NavigationLink from '@/components/ui/NavigationLink';
import Portrait from '@/components/players/Portrait';
import PositionBadge from '@/components/players/PositionBadge';
import GlobalStatsTable from '../stats/GlobalStatsTable';
import PlayerExplorer from './PlayerExplorer';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { SPINE, POS_COLOR } from '@/lib/positions/spine';
import type { GranularPosition } from '@/types';
import { STYLE_LABEL } from '@futbolpedia/engine';
import type { OutlookStyle } from '@futbolpedia/engine';
import type { ExplorerRow, IndexScout } from '@/lib/players/indexData';
import type { IndexRowPlayer } from './page';
import { isPlayerMapped } from '@/lib/players/playerMapping';
import { POS_FILTER_OPTIONS, resolveActivePosition, type PosFilter, type PosType } from '@/lib/players/positionFilter';
import styles from './playersIndex.module.css';
import { fold } from '@/lib/text/fold';

/**
 * The players index. Cards is the default view.
 *
 * A table row can only say what a player scored. Four of the ten highest-value
 * players in the pool are worth nothing on points alone right now — injured,
 * suspended, or mid-transfer — and only the scouting lede says why. That is the
 * reason cards lead and the table is one click away rather than the reverse.
 */

interface Props {
  leagueId: string;
  leagueName: string;
  players: IndexRowPlayer[];
  scout: Record<string, IndexScout>;
  season: string;
  seasons: string[];
  view?: 'cards' | 'table' | 'explorer';
  explorerRows: ExplorerRow[];
  gameweeks: number[];
  gameweek: number | null;
  shadowMaps: React.ComponentProps<typeof GlobalStatsTable>['shadowMaps'];
  isSiteAdmin?: boolean;
}

const QUALITY_LABEL: Record<string, string> = {
  elite: 'Elite', high: 'High', solid: 'Solid', squad: 'Squad',
};

const MINUTES_LABEL: Record<string, string> = {
  nailed: 'Nailed',
  likely_starter: 'Likely starter',
  rotation_risk: 'Rotation risk',
  fringe: 'Fringe',
};

const RISK_LABEL: Record<string, string> = {
  injury_prone: 'Injury prone',
  minutes_competition: 'Minutes competition',
  contract_year: 'Contract year',
  tactical_misfit: 'Tactical misfit',
};

const MOBILITY_FLAG: Record<string, string> = {
  linked_exit: 'Linked with an exit',
  confirmed_exit: 'Leaving the league',
  linked_pl_move: 'Linked with a move',
};

const CARD_PAGE = 48;

/** Hoisted: defined inside the component it would remount on every keystroke. */
function Pill({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`${styles.pill} ${on ? styles.pillOn : ''}`}
      onClick={onClick}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}

export default function PlayersIndex({
  leagueId, leagueName, players, scout, season, seasons, view: initialView, explorerRows, gameweeks, gameweek, shadowMaps, isSiteAdmin,
}: Props) {
  const [currentView, setCurrentView] = useState<'cards' | 'table' | 'explorer'>(initialView ?? 'cards');
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [posType, setPosType] = useState<PosType>('both');
  const [clubFilter, setClubFilter] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [minMins, setMinMins] = useState<'played' | 'all' | 'gt45'>('all');
  const [minGames, setMinGames] = useState<number>(0);
  const [quality, setQuality] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<string | null>(null);
  const [watch, setWatch] = useState<string | null>(null);
  const [syncFilter, setSyncFilter] = useState<'all' | 'synced' | 'unsynced'>('all');
  const [shown, setShown] = useState(CARD_PAGE);

  // Shared with the table view (same localStorage keys) so a preference set
  // in one carries over to the other.
  useEffect(() => {
    try {
      const savedMinMins = localStorage.getItem('gaffa:stats-min-mins') as 'played' | 'all' | 'gt45' | null;
      if (savedMinMins && ['played', 'all', 'gt45'].includes(savedMinMins)) setMinMins(savedMinMins);

      const savedPosType = localStorage.getItem('gaffa:stats-pos-type') as PosType | null;
      if (savedPosType && ['primary', 'secondary', 'both'].includes(savedPosType)) setPosType(savedPosType);
    } catch {
      /* ignore */
    }
  }, []);

  function handleSetMinMins(val: 'played' | 'all' | 'gt45') {
    setMinMins(val);
    setShown(CARD_PAGE);
    try { localStorage.setItem('gaffa:stats-min-mins', val); } catch { /* ignore */ }
  }

  function handleSetPosType(val: PosType) {
    setPosType(val);
    setShown(CARD_PAGE);
    try { localStorage.setItem('gaffa:stats-pos-type', val); } catch { /* ignore */ }
  }

  const clubOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) {
      if (p.pl_team) set.add(p.pl_team);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [players]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of players) {
      if (p.owner_team_id && p.owner_team_name) map.set(p.owner_team_id, p.owner_team_name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [players]);

  const shadowByPlayer =
    minMins === 'played' ? (shadowMaps.played ?? shadowMaps.all) : minMins === 'all' ? shadowMaps.all : shadowMaps.gt45;

  // Restore preferred view from localStorage if not explicitly requested in URL
  useEffect(() => {
    if (!initialView) {
      try {
        const saved = localStorage.getItem('gaffa:players-view') as 'cards' | 'table' | 'explorer' | null;
        if (saved && ['cards', 'table', 'explorer'].includes(saved)) {
          setCurrentView(saved);
        }
      } catch {
        /* ignore */
      }
    } else {
      setCurrentView(initialView);
    }
  }, [initialView]);

  const view = currentView;

  function handleViewSelect(nextView: 'cards' | 'table' | 'explorer') {
    setCurrentView(nextView);
    try {
      localStorage.setItem('gaffa:players-view', nextView);
    } catch {
      /* ignore */
    }
  }

  const filtered = useMemo(() => {
    const q = fold(search);
    return players.filter((p) => {
      if (isSiteAdmin) {
        const mapped = isPlayerMapped(p);
        if (syncFilter === 'synced' && !mapped) return false;
        if (syncFilter === 'unsynced' && mapped) return false;
      }
      if (q && !fold(getPlayerDisplayName(p, 'full')).includes(q)
            && !fold(p.pl_team).includes(q)) return false;
      if (clubFilter !== 'ALL' && p.pl_team !== clubFilter) return false;
      if (teamFilter !== 'ALL') {
        if (teamFilter === 'FREE' ? p.owner_team_id !== null : p.owner_team_id !== teamFilter) return false;
      }

      const activePos = resolveActivePosition(p, posFilter, posType);
      if (!activePos) return false;
      if (activePos !== 'N/A') {
        const s = shadowByPlayer[p.id]?.[activePos];
        if ((s?.gp ?? 0) < minGames) return false;
      } else if (minGames > 0) {
        return false;
      }

      const sc = scout[p.id];
      if (quality && (!sc || sc.fromFallback || sc.quality !== quality)) return false;
      if (minutes && (!sc || sc.minutes_role !== minutes)) return false;
      if (watch) {
        if (!sc) return false;
        const flagged =
          sc.risk_flags.includes(watch as never) ||
          (watch === 'exit' && (sc.pl_mobility === 'linked_exit' || sc.pl_mobility === 'confirmed_exit'));
        if (!flagged) return false;
      }
      return true;
    });
  }, [players, scout, search, posFilter, posType, clubFilter, teamFilter, quality, minutes, watch, syncFilter, isSiteAdmin, shadowByPlayer, minGames]);

  const activeFilters = [
    posFilter !== 'ALL' ? posFilter : null,
    posType !== 'both' ? posType : null,
    clubFilter !== 'ALL' ? clubFilter : null,
    teamFilter !== 'ALL' ? teamFilter : null,
    minMins !== 'all' ? minMins : null,
    minGames > 0 ? minGames : null,
    quality,
    minutes,
    watch,
    isSiteAdmin && syncFilter !== 'all' ? syncFilter : null,
  ].filter(Boolean).length;

  const header = (
    <>
      <div className={`g-spectrum ${styles.spectrum}`} aria-hidden>
        {SPINE.map((p) => <i key={p} style={{ background: POS_COLOR[p] }} />)}
      </div>

      <header className={styles.header}>
        <div>
          <div className={`g-label ${styles.kicker}`}>
            <NavigationLink href={`/league/${leagueId}`}>{leagueName}</NavigationLink>
          </div>
          <h1 className={styles.title}>Players</h1>
        </div>

        <div className={styles.headRight}>
          <div>
            <div className={styles.statValue}>
              {view === 'explorer' ? explorerRows.length : filtered.length}
            </div>
            <div className={`g-label-quiet ${styles.statLabel}`}>
              {view === 'explorer'
                ? 'plotted'
                : filtered.length === players.length
                  ? 'players'
                  : `shown of ${players.length}`}
            </div>
          </div>

          {seasons.length > 1 && (
            <nav className={styles.seasons} aria-label="Season">
              {seasons.map((s) => (
                <NavigationLink
                  key={s}
                  href={`/league/${leagueId}/players?view=${view}&season=${s}`}
                  className={`${styles.seasonTab} ${s === season ? styles.seasonTabOn : ''}`}
                  aria-current={s === season ? 'page' : undefined}
                >
                  {s.replace('-', '/')}
                </NavigationLink>
              ))}
            </nav>
          )}

          <nav className={styles.seg} aria-label="View">
            {(['cards', 'table', 'explorer'] as const).map((v) => (
              <NavigationLink
                key={v}
                href={`/league/${leagueId}/players?view=${v}&season=${season}${
                  v === 'table' && gameweek ? `&gw=${gameweek}` : ''
                }`}
                className={`${styles.segBtn} ${v === view ? styles.segOn : ''}`}
                aria-current={v === view ? 'page' : undefined}
                onClick={() => handleViewSelect(v)}
              >
                {v === 'cards' ? 'Cards' : v === 'table' ? 'Table' : 'Explorer'}
              </NavigationLink>
            ))}
          </nav>
        </div>
      </header>
    </>
  );

  if (view === 'explorer') {
    return (
      <div className="g-panel">
        {header}
        <PlayerExplorer leagueId={leagueId} rows={explorerRows} season={season} />
      </div>
    );
  }

  if (view === 'table') {
    return (
      <div className="g-panel">
        {header}
        {gameweeks.length > 0 && (
          <div className={styles.gwBar}>
            <span className={`g-label-quiet ${styles.facetLabel}`}>Gameweek</span>
            <div className={styles.rail}>
              <NavigationLink
                href={`/league/${leagueId}/players?view=table&season=${season}`}
                className={`${styles.pill} ${gameweek == null ? styles.pillOn : ''}`}
                aria-current={gameweek == null ? 'page' : undefined}
              >
                Season
              </NavigationLink>
              {gameweeks.map((n) => (
                <NavigationLink
                  key={n}
                  href={`/league/${leagueId}/players?view=table&season=${season}&gw=${n}`}
                  className={`${styles.pill} ${gameweek === n ? styles.pillOn : ''}`}
                  aria-current={gameweek === n ? 'page' : undefined}
                >
                  GW{n}
                </NavigationLink>
              ))}
            </div>
          </div>
        )}
        <GlobalStatsTable
          leagueId={leagueId}
          leagueName={leagueName}
          players={players}
          season={season}
          shadowMaps={shadowMaps}
          isSiteAdmin={isSiteAdmin}
        />
      </div>
    );
  }

  return (
    <div className="g-panel">
      {header}

      <div className={styles.tools}>
        <input
          className={styles.input}
          placeholder="Search player or club…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShown(CARD_PAGE); }}
          aria-label="Search player"
        />
        <select
          className={styles.select}
          value={posFilter}
          onChange={(e) => { setPosFilter(e.target.value as PosFilter); setShown(CARD_PAGE); }}
          aria-label="Position"
        >
          {POS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          className={styles.select}
          value={clubFilter}
          onChange={(e) => { setClubFilter(e.target.value); setShown(CARD_PAGE); }}
          aria-label="Club"
        >
          <option value="ALL">All clubs</option>
          {clubOptions.map((club) => (
            <option key={club} value={club}>{club}</option>
          ))}
        </select>
        <select
          className={styles.select}
          value={teamFilter}
          onChange={(e) => { setTeamFilter(e.target.value); setShown(CARD_PAGE); }}
          aria-label="Gaffa club"
        >
          <option value="ALL">All Gaffa clubs</option>
          <option value="FREE">Free agents</option>
          {teamOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select
          className={styles.select}
          value={minMins}
          onChange={(e) => handleSetMinMins(e.target.value as 'played' | 'all' | 'gt45')}
          aria-label="Minutes filter"
        >
          <option value="played">Played (&gt;0 mins)</option>
          <option value="all">Meaningful (&ge;15 mins)</option>
          <option value="gt45">Starters (&gt;45 mins)</option>
        </select>

        <div className={styles.slider}>
          <label className={styles.sliderLabel} htmlFor="cardsMinGames">Min games</label>
          <input
            id="cardsMinGames"
            type="range"
            min="0"
            max="38"
            value={minGames}
            onChange={(e) => { setMinGames(parseInt(e.target.value)); setShown(CARD_PAGE); }}
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
              onClick={() => handleSetPosType(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {activeFilters > 0 && (
          <button
            className={styles.clear}
            onClick={() => {
              setPosFilter('ALL'); handleSetPosType('both');
              setClubFilter('ALL'); setTeamFilter('ALL');
              handleSetMinMins('all'); setMinGames(0);
              setQuality(null); setMinutes(null); setWatch(null); setSyncFilter('all');
            }}
          >
            Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className={styles.facetBar}>
        {isSiteAdmin && (
          <div className={styles.facetRow}>
            <span className={`g-label-quiet ${styles.facetLabel}`}>Sync status</span>
            <div className={styles.rail}>
              <Pill label="All" on={syncFilter === 'all'} onClick={() => { setSyncFilter('all'); setShown(CARD_PAGE); }} />
              <Pill label="Synced only" on={syncFilter === 'synced'} onClick={() => { setSyncFilter('synced'); setShown(CARD_PAGE); }} />
              <Pill label="Unsynced only" on={syncFilter === 'unsynced'} onClick={() => { setSyncFilter('unsynced'); setShown(CARD_PAGE); }} />
            </div>
          </div>
        )}
        <div className={styles.facetRow}>
          <span className={`g-label-quiet ${styles.facetLabel}`}>Quality</span>
          <div className={styles.rail}>
            {(['elite', 'high', 'solid', 'squad'] as const).map((v) => (
              <Pill key={v} label={QUALITY_LABEL[v]} on={quality === v}
                onClick={() => { setQuality(quality === v ? null : v); setShown(CARD_PAGE); }} />
            ))}
          </div>
        </div>
        <div className={styles.facetRow}>
          <span className={`g-label-quiet ${styles.facetLabel}`}>Minutes</span>
          <div className={styles.rail}>
            {(['nailed', 'likely_starter', 'rotation_risk', 'fringe'] as const).map((v) => (
              <Pill key={v} label={MINUTES_LABEL[v]} on={minutes === v}
                onClick={() => { setMinutes(minutes === v ? null : v); setShown(CARD_PAGE); }} />
            ))}
          </div>
        </div>
        <div className={styles.facetRow}>
          <span className={`g-label-quiet ${styles.facetLabel}`}>Watch for</span>
          <div className={styles.rail}>
            <Pill label="Exit risk" on={watch === 'exit'}
              onClick={() => { setWatch(watch === 'exit' ? null : 'exit'); setShown(CARD_PAGE); }} />
            {(['injury_prone', 'minutes_competition', 'contract_year'] as const).map((v) => (
              <Pill key={v} label={RISK_LABEL[v]} on={watch === v}
                onClick={() => { setWatch(watch === v ? null : v); setShown(CARD_PAGE); }} />
            ))}
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        {filtered.slice(0, shown).map((p) => {
          const s = scout[p.id];
          const pos = p.primary_position;
          const colour = pos ? POS_COLOR[pos as GranularPosition] : 'var(--color-border-subtle)';
          const flag = s ? MOBILITY_FLAG[s.pl_mobility] : undefined;
          return (
            <NavigationLink
              key={p.id}
              href={`/league/${leagueId}/players/${p.id}`}
              className={styles.card}
            >
              <i className={styles.cardRule} style={{ background: colour }} />

              <div className={styles.cardTop}>
                <Portrait
                  photoUrl={p.photo_url}
                  name={getPlayerDisplayName(p, 'full')}
                  club={p.pl_team}
                  size="md"
                  headTopPct={p.portrait_head_top_pct}
                  headWidthPct={p.portrait_head_width_pct}
                  photoVersion={p.photo_version}
                />
                <div className={styles.cardId}>
                  <div className={styles.cardChips}>
                    <PositionBadge position={pos ?? 'N/A'} size="sm" />
                    {s && !s.fromFallback && (
                      <span className={`${styles.qual} ${styles[`q_${s.quality}`]}`}>
                        {QUALITY_LABEL[s.quality]}
                      </span>
                    )}
                  </div>
                  <div className={styles.cardName}>{getPlayerDisplayName(p, 'full')}</div>
                  <div className={`g-label-quiet ${styles.cardClub}`}>{p.pl_team}</div>
                </div>
              </div>

              {/* The lede is the whole reason cards are the default. Without an
                  outlook the card degrades to identity plus figures rather than
                  rendering an empty well — the state most of the pool is in. */}
              {s?.lede && (
                /* The clamp lives on the <p>, the padding on the wrapper.
                   With both on one element, overflow:hidden clips at the
                   padding edge and a fourth line paints into the padding —
                   which is what was colliding with the tags below. */
                <div className={styles.ledeWrap}>
                  <p className={styles.lede}>{s.lede}</p>
                </div>
              )}

              {flag && (
                <div className={styles.flag}>
                  <i />
                  {flag}
                </div>
              )}

              {s && (
                <div className={styles.tags}>
                  <span className={styles.tag}>{MINUTES_LABEL[s.minutes_role]}</span>
                  {s.style.slice(0, 1).map((st) => (
                    <span key={st} className={styles.tag}>
                      {STYLE_LABEL[st as OutlookStyle] ?? st.replace(/_/g, ' ')}
                    </span>
                  ))}
                  {s.fromFallback && <span className={styles.tagQuiet}>Not yet scouted</span>}
                </div>
              )}

              <div className={styles.cardFoot}>
                <span className={styles.footStat}>
                  <b>{p.total_points != null ? Number(p.total_points).toFixed(1) : '—'}</b>
                  <span className="g-label-quiet">Pts</span>
                </span>
                <span className={styles.footStat}>
                  <b>{p.market_value != null ? `€${Number(p.market_value).toFixed(0)}m` : '—'}</b>
                  <span className="g-label-quiet">Value</span>
                </span>
                <span className={p.owner_team_name ? styles.owner : styles.ownerFree}>
                  {p.owner_team_name ?? 'Free agent'}
                </span>
              </div>
            </NavigationLink>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className={styles.empty}>No players match these filters.</p>
      )}

      {shown < filtered.length && (
        <div className={styles.more}>
          <button className={styles.moreBtn} onClick={() => setShown(shown + CARD_PAGE)}>
            Show {Math.min(CARD_PAGE, filtered.length - shown)} more
          </button>
        </div>
      )}
    </div>
  );
}
