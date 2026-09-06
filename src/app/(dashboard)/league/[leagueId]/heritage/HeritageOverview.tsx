'use client';

/**
 * Heritage — Overview.
 *
 * Built on League Home's grammar (`_home/home.module.css`): a section is a
 * serif title over a 2px ink rule with FLAT content beneath it, and only a
 * genuinely bounded object — the champion hero, the board, the table — gets a
 * 1px border box. Border, never shadow. No white panels on the cream ground
 * (docs/UI_RULES.md rules 5–7).
 *
 * Trophies split by surface: pips on the board and in the rail, because those
 * are list surfaces; full metal objects only on the studio sweep in the hero,
 * which is the treatment the old per-club cabinet shipped (removed with it;
 * see the studio-sweep note in heritage.module.css).
 */

import CrestBadge from '@/components/crest/CrestBadge';
import Trophy from '@/components/trophies/Trophy';
import NavigationLink from '@/components/ui/NavigationLink';
import HeritageNav from './HeritageNav';
import type { BoardClub, HonoursBoard } from '@/lib/heritage/honoursBoard';
import type { HeadToHead, Tally } from '@/lib/heritage/headToHead';
import styles from './heritage.module.css';

interface Props {
  leagueId: string;
  leagueName: string;
  currentSeason: string;
  board: HonoursBoard;
  champion: { club: BoardClub; season: string } | null;
  viewerTeamId: string | null;
  rivalries: HeadToHead[];
  record: Tally | null;
  winRate: number;
}

const pts = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Figure({ value, stake, accent }: { value: string; stake: string; accent?: boolean }) {
  return (
    <div className={styles.fig}>
      <div className={accent ? styles.figVAccent : styles.figV}>{value}</div>
      <div className={styles.figS}>{stake}</div>
    </div>
  );
}

function Section({ title, hint, more, moreHref }: {
  title: string; hint?: string; more?: string; moreHref?: string;
}) {
  return (
    <div className={styles.sect}>
      <h2 className={styles.sectT}>{title}</h2>
      {hint && <span className={styles.sectHint}>{hint}</span>}
      {more && moreHref && (
        <NavigationLink href={moreHref} className={styles.sectMore}>{more}</NavigationLink>
      )}
    </div>
  );
}

/** Won / drawn / lost as one bar. Proportions, so it reads at a glance. */
function ResultBar({ w, d, l }: { w: number; d: number; l: number }) {
  const total = w + d + l;
  if (!total) return null;
  return (
    <div className={styles.bar} role="presentation">
      {w > 0 && <i className={styles.barW} style={{ flexGrow: w }} />}
      {d > 0 && <i className={styles.barD} style={{ flexGrow: d }} />}
      {l > 0 && <i className={styles.barL} style={{ flexGrow: l }} />}
    </div>
  );
}

export default function HeritageOverview({
  leagueId, leagueName, currentSeason, board, champion,
  viewerTeamId, rivalries, record, winRate,
}: Props) {
  const viewer = board.clubs.find((c) => c.teamId === viewerTeamId) ?? null;
  const viewerRank = viewer ? board.clubs.indexOf(viewer) + 1 : null;
  const seasonCount = board.seasons.length;
  const byId = new Map(board.clubs.map((c) => [c.teamId, c]));

  return (
    <div className={styles.page}>
      <div className={styles.mast}>
        <div className={styles.mastTx}>
          <h1 className={styles.title}>Heritage</h1>
          <p className={styles.subtitle}>
            {leagueName}
            {seasonCount > 0
              ? ` · ${seasonCount} ${seasonCount === 1 ? 'season' : 'seasons'} completed`
              : ` · first season in progress`}
          </p>
        </div>
        <div className={styles.figs}>
          <Figure value={String(seasonCount)} stake="Seasons completed" />
          <Figure value={String(board.totalTrophies)} stake="Trophies awarded" />
          <Figure value={String(board.clubs.length)} stake="Clubs" />
        </div>
      </div>

      <HeritageNav leagueId={leagueId} active="Overview" />

      {champion ? (
        <div className={styles.hero}>
          <div className={styles.heroTx}>
            <div className={styles.heroId}>
              <CrestBadge
                config={champion.club.crestConfig}
                size={72}
                teamName={champion.club.teamName}
                teamId={champion.club.teamId}
                interactive={false}
              />
              <div>
                <div className={styles.heroName}>{champion.club.teamName}</div>
                <p className={styles.heroSub}>
                  Champions of {champion.season}
                  {champion.club.managerName ? ` · ${champion.club.managerName}` : ''}
                </p>
              </div>
            </div>
            <div className={styles.heroFigs}>
              <Figure
                value={String(champion.club.trophies.filter((t) => t.kind === 'league_title').length)}
                stake="League titles"
              />
              <Figure value={String(champion.club.total)} stake="Trophies in total" />
            </div>
          </div>
          {/* The display is a studio sweep, not a cabinet — see
              heritage.module.css, which records the two treatments the old
              per-club cabinet tried and rejected before this one. */}
          <div className={styles.display}>
            <div className={styles.pool} aria-hidden="true" />
            <div className={styles.stage}>
              {champion.club.trophies.slice(0, 3).map((t, i) => (
                <div key={`${t.kind}-${t.season}-${i}`} className={styles.stand}>
                  <Trophy kind={t.kind} size="hero" height={158} season={t.season} />
                  <div className={styles.plate}>{t.season}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.hero}>
          <div className={styles.heroTx}>
            <div className={styles.heroName}>No champion yet</div>
            <p className={styles.heroSub}>
              {leagueName} crowns its first champion at the end of {currentSeason}. Until then the
              board below is a wall waiting to be filled.
            </p>
          </div>
        </div>
      )}

      <div className={styles.block}>
        <Section title="Honours Board" hint="Most decorated first" />
        <div className={styles.box}>
          {board.clubs.map((c, i) => (
            <div
              key={c.teamId}
              className={c.teamId === viewerTeamId ? styles.boardRowMine : styles.boardRow}
            >
              <span className={styles.boardRank}>{i + 1}</span>
              <CrestBadge
                config={c.crestConfig}
                size={38}
                teamName={c.teamName}
                teamId={c.teamId}
                interactive={false}
              />
              <div className={styles.boardId}>
                <div className={c.teamId === viewerTeamId ? styles.boardNameMine : styles.boardName}>
                  {c.teamName}
                </div>
                <div className={styles.boardMgr}>
                  {c.managerName ?? '—'}{c.teamId === viewerTeamId ? ' · you' : ''}
                </div>
              </div>
              <div className={styles.shelf}>
                {c.trophies.map((t, n) => (
                  <div key={`${t.kind}-${t.season}-${n}`} className={styles.pipStand}>
                    <Trophy kind={t.kind} size="pip" height={32} className={styles.pip} />
                    <span className={styles.pipYear}>{t.season}</span>
                  </div>
                ))}
              </div>
              <div className={styles.boardCount}>
                <div className={styles.figV}>{c.total}</div>
                <div className={styles.figS}>{c.total === 1 ? 'trophy' : 'trophies'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.main}>
          <Section
            title="Head-to-Head"
            hint={viewer ? `${viewer.teamName}, league and cups` : 'League and cups'}
            more={rivalries.length ? 'All rivalries' : undefined}
            moreHref={`/league/${leagueId}/heritage/head-to-head`}
          />
          {rivalries.length ? (
            <div className={styles.box}>
              {rivalries.map((h) => {
                const opp = byId.get(h.opponentId);
                if (!opp) return null;
                return (
                  <NavigationLink
                    key={h.opponentId}
                    href={`/league/${leagueId}/heritage/head-to-head/${h.opponentId}`}
                    className={styles.rivalRow}
                  >
                    <CrestBadge
                      config={opp.crestConfig}
                      size={30}
                      teamName={opp.teamName}
                      teamId={opp.teamId}
                      interactive={false}
                    />
                    <div className={styles.rivalId}>
                      <div className={styles.rivalName}>{opp.teamName}</div>
                      {h.streak && h.streak.length > 1 && (
                        <div className={styles.rivalNote}>
                          {h.streak.length} {h.streak.outcome === 'win' ? 'wins' : h.streak.outcome === 'loss' ? 'defeats' : 'draws'} in a row
                        </div>
                      )}
                    </div>
                    <div className={styles.rivalRec}>
                      {h.won}<span className={styles.sep}>·</span>{h.drawn}<span className={styles.sep}>·</span>{h.lost}
                      <span className={styles.rivalOf}>of {h.played}</span>
                    </div>
                    <ResultBar w={h.won} d={h.drawn} l={h.lost} />
                    <span className={styles.chev} aria-hidden="true">›</span>
                  </NavigationLink>
                );
              })}
            </div>
          ) : (
            <p className={styles.empty}>
              {viewerTeamId
                ? 'No completed fixtures yet. Your record fills in as the season is scored.'
                : 'Head-to-head records are shown for managers with a club in this league.'}
            </p>
          )}
        </div>

        <aside className={styles.rail}>
          {viewer && record && (
            <div className={styles.box}>
              <div className={styles.railPad}>
                <div className={styles.railId}>
                  <CrestBadge
                    config={viewer.crestConfig}
                    size={44}
                    teamName={viewer.teamName}
                    teamId={viewer.teamId}
                    interactive={false}
                  />
                  <div>
                    <div className={styles.railName}>{viewer.teamName}</div>
                    <div className={styles.boardMgr}>
                      {viewer.managerName ?? '—'}
                      {viewerRank ? ` · ${viewerRank} on the board` : ''}
                    </div>
                  </div>
                </div>
                {viewer.trophies.length > 0 && (
                  <div className={styles.railTrophies}>
                    {viewer.trophies.map((t, n) => (
                      <Trophy key={`${t.kind}-${t.season}-${n}`} kind={t.kind} size="pip" height={34} className={styles.pip} />
                    ))}
                  </div>
                )}
                <div className={styles.railFigs}>
                  <Figure value={String(record.played)} stake="Matches played" />
                  <Figure value={`${Math.round(winRate * 1000) / 10}%`} stake="Win rate" />
                  <Figure value={`${record.won}–${record.drawn}–${record.lost}`} stake="All-time record" />
                  <Figure value={pts(record.pointsFor)} stake="Points scored" accent />
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
