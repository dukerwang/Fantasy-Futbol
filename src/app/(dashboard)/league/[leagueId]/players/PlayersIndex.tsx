'use client';

import { useMemo, useState } from 'react';
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
  view: 'cards' | 'table' | 'explorer';
  explorerRows: ExplorerRow[];
  gameweeks: number[];
  gameweek: number | null;
  shadowMaps: React.ComponentProps<typeof GlobalStatsTable>['shadowMaps'];
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
  leagueId, leagueName, players, scout, season, seasons, view, explorerRows, gameweeks, gameweek, shadowMaps,
}: Props) {
  const [search, setSearch] = useState('');
  const [quality, setQuality] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<string | null>(null);
  const [watch, setWatch] = useState<string | null>(null);
  const [shown, setShown] = useState(CARD_PAGE);

  const filtered = useMemo(() => {
    const q = fold(search);
    return players.filter((p) => {
      if (q && !fold(getPlayerDisplayName(p, 'full')).includes(q)
            && !fold(p.pl_team).includes(q)) return false;
      const s = scout[p.id];
      if (quality && (!s || s.fromFallback || s.quality !== quality)) return false;
      if (minutes && (!s || s.minutes_role !== minutes)) return false;
      if (watch) {
        if (!s) return false;
        const flagged =
          s.risk_flags.includes(watch as never) ||
          (watch === 'exit' && (s.pl_mobility === 'linked_exit' || s.pl_mobility === 'confirmed_exit'));
        if (!flagged) return false;
      }
      return true;
    });
  }, [players, scout, search, quality, minutes, watch]);

  const activeFilters = [quality, minutes, watch].filter(Boolean).length;

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
        {activeFilters > 0 && (
          <button
            className={styles.clear}
            onClick={() => { setQuality(null); setMinutes(null); setWatch(null); }}
          >
            Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className={styles.facetBar}>
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
          const pos = p.primary_position as GranularPosition;
          const colour = POS_COLOR[pos];
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
                  {/* NOT g-namerow: that lifts .g-poschip 2.25px for optical
                      alignment beside a NAME. There is no name in this row, so
                      the lift only desynced the badge from the quality chip. */}
                  <div className={styles.cardChips}>
                    <PositionBadge position={pos} size="sm" />
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
