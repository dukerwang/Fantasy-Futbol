import NavigationLink from '@/components/ui/NavigationLink';
import CrestBadge from '@/components/crest/CrestBadge';
import PositionBadge from '@/components/players/PositionBadge';
import type { CrestConfig } from '@/components/crest/types';
import type { GranularPosition } from '@/types';
import type { HomeModel } from '@/lib/home/buildHomeModel';
import Countdown from './Countdown';
import styles from './home.module.css';

/**
 * In the market.
 *
 * The biggest addition to the page, and the reason the midweek phase exists
 * at all. A gameweek is roughly three days of football and four days of
 * transfers; through the longer half the old home showed a static hero, four
 * rows of em-dashes, and the market only as past-tense prose in the feed.
 *
 * `auction_state` is a trigger-maintained projection and is already on the
 * Realtime publication, so this is one indexed query.
 */
export function Market({ model }: { model: HomeModel }) {
  if (model.phase === 'closed') return null;

  return (
    <section aria-label="In the market">
      <div className={styles.sect}>
        <h2 className={styles.sectT}>
          {model.phase === 'market' ? 'The week in the market' : 'In the market'}
        </h2>
        {model.phase === 'market' && (
          <span className={styles.sectHint}>nothing kicks off for days</span>
        )}
        <NavigationLink href={`/league/${model.leagueId}/transfers`} className={styles.sectMore}>
          Transfers &rarr;
        </NavigationLink>
      </div>

      <div className={styles.mkt}>
        <div className={styles.mktHd}>
          <span className={styles.mktSummary}>{model.marketSummary}</span>
          <span className={styles.mktBudget}>{model.marketBudget}</span>
        </div>

        {model.market.length === 0 ? (
          <div className={styles.mktEmpty}>
            Nothing is on the board. Opening an auction pays a 10% Scout&rsquo;s Fee if someone
            else wins it.
          </div>
        ) : (
          model.market.map((lot) => (
            <div
              key={lot.playerId}
              className={lot.leading ? styles.mktRowMine : styles.mktRow}
            >
              {lot.position ? (
                <PositionBadge position={lot.position as GranularPosition} size="sm" />
              ) : (
                <span />
              )}
              <div className={styles.mktName}>
                <div className={styles.mktNameN}>{lot.name}</div>
                <div className={styles.mktNameM}>{lot.meta}</div>
              </div>
              <div className={styles.mktBid}>
                <div className={styles.mktBidV}>{lot.bid}</div>
                <div className={styles.mktBidL}>{lot.holder}</div>
              </div>
              <Countdown to={lot.expiresAt} serverNow={model.serverNow} />
              <NavigationLink
                href={lot.href}
                className={lot.outbid ? styles.btnPrimary : styles.btn}
              >
                {lot.outbid ? 'Raise' : lot.leading ? 'Leading' : 'Bid'}
              </NavigationLink>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * On all fronts — the league and the three cups.
 *
 * Each tile states a FIXTURE and its stakes, not a status noun. "Round 2" is
 * near-worthless, and the old page could not even render that correctly: it
 * read `tournaments.current_round`, which is not a column, so every active cup
 * showed "Round 1" forever.
 */
export function Fronts({ model }: { model: HomeModel }) {
  return (
    <section aria-label="Competitions">
      <div className={styles.sect}>
        <h2 className={styles.sectT}>
          {model.phase === 'closed' ? 'How it finished' : 'On all fronts'}
        </h2>
      </div>
      <div className={styles.fronts}>
        {model.fronts.map((fr, i) => (
          <div
            key={i}
            className={
              fr.tone === 'won'
                ? styles.frontWon
                : fr.tone === 'out'
                  ? styles.frontOut
                  : styles.front
            }
          >
            <span className={styles.frontLabel}>{fr.competition}</span>
            <div
              className={
                fr.tone === 'won'
                  ? styles.frontVGold
                  : fr.tone === 'out'
                    ? styles.frontVMuted
                    : styles.frontV
              }
            >
              {fr.value}
            </div>
            <div className={styles.frontS}>{fr.sub}</div>
            <div className={styles.frontP}>{fr.prize}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Elsewhere in the matchweek. Live and settled only — in build-up this was a
 * full section of club names and em-dashes carrying no information at all.
 */
export function Matchweek({ model }: { model: HomeModel }) {
  if (model.matchweek.length === 0) return null;

  return (
    <section aria-label="Other fixtures">
      <div className={styles.sect}>
        <h2 className={styles.sectT}>
          Elsewhere in Matchweek {model.fixture?.gameweek ?? model.gameweek}
        </h2>
        <NavigationLink href={`/league/${model.leagueId}/matchups`} className={styles.sectMore}>
          All fixtures &rarr;
        </NavigationLink>
      </div>
      <div className={styles.mw}>
        {model.matchweek.map((m) => (
          <NavigationLink
            key={m.id}
            href={`/league/${model.leagueId}/matchups/${m.id}`}
            className={styles.mwRow}
          >
            <CrestBadge config={m.home.crest as CrestConfig | null} size={21} teamName={m.home.name} teamId={m.home.id} />
            <span className={styles.mwName}>{m.home.name}</span>
            <span
              className={
                m.homeScore == null
                  ? styles.mwScoreDim
                  : m.drawn || m.homeScore >= (m.awayScore ?? 0)
                    ? styles.mwScore
                    : styles.mwScoreDim
              }
            >
              {m.homeScore == null ? '—' : m.homeScore.toFixed(2)}
            </span>
            <span
              className={
                m.drawn ? styles.mwTagBand : m.live ? styles.mwTagLive : styles.mwTag
              }
            >
              {m.tag}
            </span>
            <span
              className={
                m.awayScore == null
                  ? styles.mwScoreDim
                  : m.drawn || m.awayScore >= (m.homeScore ?? 0)
                    ? styles.mwScore
                    : styles.mwScoreDim
              }
            >
              {m.awayScore == null ? '—' : m.awayScore.toFixed(2)}
            </span>
            <span className={styles.mwNameB}>{m.away.name}</span>
            <CrestBadge config={m.away.crest as CrestConfig | null} size={21} teamName={m.away.name} teamId={m.away.id} />
          </NavigationLink>
        ))}
      </div>
    </section>
  );
}

/**
 * The table — a real `<table>`, ten rows, with what each position is worth.
 *
 * The prize column is `computeSeasonPrize`, a pure function with no database
 * access, so it costs nothing. It is also what stops the table being inert
 * for six days out of seven: a rank is abstract, €34m is not.
 */
export function StandingsTable({ model }: { model: HomeModel }) {
  return (
    <section aria-label="Standings">
      <div className={styles.sect}>
        <h2 className={styles.sectT}>
          {model.phase === 'closed' ? 'The final table' : 'The table'}
        </h2>
        <NavigationLink href={`/league/${model.leagueId}/standings`} className={styles.sectMore}>
          Full standings &rarr;
        </NavigationLink>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption>
            Pays is the placement prize at that finish, on today&rsquo;s table. Form reads newest
            first.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.alignLeft}>Rk</th>
              <th scope="col" className={styles.alignLeft}>Club</th>
              <th scope="col">W</th>
              <th scope="col">D</th>
              <th scope="col">L</th>
              <th scope="col">For</th>
              <th scope="col">Pts</th>
              <th scope="col">Form</th>
              <th scope="col">Pays</th>
            </tr>
          </thead>
          <tbody>
            {model.table.map((r) => (
              <tr key={r.teamId} className={r.isMe ? styles.rowMe : undefined}>
                <td className={styles.alignLeft}>
                  <span className={styles.num}>{r.rank}</span>{' '}
                  {/* The rank is data and must stay in primary ink; only the
                      glyph is tinted, and it is a shape first. */}
                  <span
                    className={
                      r.movement > 0
                        ? styles.moveUp
                        : r.movement < 0
                          ? styles.moveDown
                          : styles.moveFlat
                    }
                    aria-label={
                      r.movement > 0
                        ? `up ${r.movement}`
                        : r.movement < 0
                          ? `down ${Math.abs(r.movement)}`
                          : 'no change'
                    }
                  >
                    {r.movement > 0 ? '▲' : r.movement < 0 ? '▼' : '–'}
                  </span>
                </td>
                <td className={styles.alignLeft}>
                  <span className={styles.club}>
                    <CrestBadge
                      config={r.club.crest as CrestConfig | null}
                      size={21}
                      teamName={r.club.name}
                      teamId={r.teamId}
                    />
                    <span className={r.isMe ? styles.clubNameMe : styles.clubName}>
                      {r.club.name}
                    </span>
                    {r.isMe && <span className={styles.you}>You</span>}
                  </span>
                </td>
                <td>{r.wins}</td>
                <td>{r.draws}</td>
                <td>{r.losses}</td>
                <td>{r.pointsFor}</td>
                <td>
                  <span className={styles.num}>{r.leaguePoints}</span>
                </td>
                <td>
                  <span className={styles.form}>
                    {r.form.map((p, i) => (
                      <span
                        key={i}
                        className={p === 'W' ? styles.pipW : p === 'D' ? styles.pipD : styles.pipL}
                      >
                        {p}
                      </span>
                    ))}
                  </span>
                </td>
                <td>
                  <span className={styles.prize}>{r.prize}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Your gameweek.
 *
 * Replaces a league-wide top five — three of whom you did not own, none of
 * whom you could act on, all of it duplicating /stats. What a manager
 * actually wants after a gameweek is their own: who won it, who lost it.
 *
 * The bar is the BASELINE RULE, and it is the only place in the app where the
 * scoring model becomes legible. A stat is never a bar filling toward a
 * maximum: the median for the player's own position is engraved as a fixed
 * tick and his rating is laid over it, so you read "against his role" rather
 * than "out of some total".
 */
export function YourGameweek({ model }: { model: HomeModel }) {
  if (model.yourGameweek.length === 0) return null;

  return (
    <section aria-label="Your gameweek">
      <div className={styles.sect}>
        <h2 className={styles.sectT}>
          {model.phase === 'closed' ? 'Your season' : 'Your gameweek'}
        </h2>
        <span className={styles.sectHint}>against the median for each position</span>
        <NavigationLink
          href={
            model.fixture
              ? `/league/${model.leagueId}/matchups/${model.fixture.matchupId}`
              : `/league/${model.leagueId}/matchups`
          }
          className={styles.sectMore}
        >
          Full box score &rarr;
        </NavigationLink>
      </div>
      <div className={styles.yg}>
        {model.yourGameweek.map((p) => (
          <div key={p.playerId} className={styles.ygRow}>
            <div className={styles.ygPlayer}>
              <PositionBadge position={p.position as GranularPosition} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div className={styles.ygName}>{p.name}</div>
                <div className={styles.ygClub}>{p.club}</div>
              </div>
            </div>
            <div className={styles.baseline}>
              <div className={styles.baselineTrack}>
                <div
                  className={styles.baselineInk}
                  style={{
                    width: `${p.inkPct}%`,
                    background: `var(--color-pos-${p.position.toLowerCase()})`,
                  }}
                />
                <div className={styles.baselineMedian} style={{ left: `${p.medianPct}%` }} />
              </div>
            </div>
            <div className={styles.ygVal}>
              <div className={styles.ygValV}>{p.points}</div>
              <div className={styles.ygValL}>{p.ratingLabel}</div>
            </div>
          </div>
        ))}
        <div className={styles.ygKey}>
          <span className={styles.ygKeyItem}>
            <i className={styles.keyTick} /> Median for his position
          </span>
          <span className={styles.ygKeyItem}>
            <i className={styles.keyInk} /> His rating this week
          </span>
          {model.yourGameweekNote && (
            <span className={styles.ygKeyItem}>{model.yourGameweekNote}</span>
          )}
        </div>
      </div>
    </section>
  );
}
