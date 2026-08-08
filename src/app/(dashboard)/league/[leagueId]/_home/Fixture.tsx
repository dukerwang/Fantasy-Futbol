import NavigationLink from '@/components/ui/NavigationLink';
import CrestBadge from '@/components/crest/CrestBadge';
import PositionBadge from '@/components/players/PositionBadge';
import type { CrestConfig } from '@/components/crest/types';
import type { GranularPosition } from '@/types';
import type { HomeModel } from '@/lib/home/buildHomeModel';
import styles from './home.module.css';

/**
 * The hero, in four of the page's five characters (the fifth, close of
 * season, is `SeasonClosed` below).
 *
 *   build-up — the XI readiness strip, because the pre-deadline question is
 *              not "is my lineup set" but "who in it is doubtful, blank or
 *              already locked"
 *   live     — the margin meter and who is still to play
 *   full time— the result, the report, and the debrief
 *   midweek  — the settled result, stated plainly, with the market leading
 *              the page below it
 */
export default function Fixture({ model }: { model: HomeModel }) {
  const f = model.fixture;
  if (!f) return null;

  const isLive = model.phase === 'live';
  const isFt = model.phase === 'ft';
  const settled = isFt || model.phase === 'market';
  /**
   * Preview vs report is decided by the FIXTURE, not by the phase. Before GW1
   * the page is in the market phase while the fixture on show has not kicked
   * off, and calling that "settled" would state something untrue.
   */
  const preview = !model.heroPlayed;

  return (
    <section className={styles.hero} aria-label="Your fixture">
      <div className={styles.heroTop}>
        <span className={styles.heroWhen}>{f.when}</span>
        {isLive ? (
          <span className={styles.live}>In play</span>
        ) : (
          <span
            className={`${styles.tag} ${
              preview
                ? styles.tagWarn
                : f.outcome === 'ahead'
                  ? styles.tagOwn
                  : styles.tagPlain
            }`}
          >
            {preview
              ? 'Not yet locked'
              : f.outcome === 'ahead'
                ? 'Won'
                : f.outcome === 'behind'
                  ? 'Lost'
                  : 'Drawn'}
          </span>
        )}
      </div>

      <div className={styles.heroTeams}>
        <div className={styles.ht}>
          <CrestBadge config={f.home.crest as CrestConfig | null} size={32} teamName={f.home.name} />
          <div className={styles.htTx}>
            <div className={styles.htName}>{f.home.name}</div>
            <div className={styles.htMeta}>{f.homeMeta}</div>
          </div>
        </div>

        <div className={styles.scores}>
          {f.hasScores ? (
            <>
              <div className={f.outcome === 'behind' ? styles.scoreDim : styles.score}>
                {f.homeScore?.toFixed(2)}
              </div>
              <div className={styles.scoreSep} />
              <div className={f.outcome === 'ahead' ? styles.scoreDim : styles.score}>
                {f.awayScore?.toFixed(2)}
              </div>
            </>
          ) : (
            <div className={styles.vs}>vs</div>
          )}
        </div>

        <div className={`${styles.ht} ${styles.htAway}`}>
          <div className={styles.htTx}>
            <div className={styles.htName}>{f.away.name}</div>
            <div className={styles.htMeta}>{f.awayMeta}</div>
          </div>
          <CrestBadge config={f.away.crest as CrestConfig | null} size={32} teamName={f.away.name} />
        </div>
      </div>

      {/* The meter is live-only. Once the result is settled the distance to
          the next outcome is history, so it has no job and the verdict line
          carries the whole message on its own. */}
      {isLive && f.hasScores && (
        <div className={styles.meter}>
          <div className={styles.meterTrack}>
            <div className={styles.meterRail} />
            <div className={styles.meterBand} />
            <div className={styles.meterZero} />
            <div
              className={
                f.outcome === 'ahead'
                  ? styles.meterMarkAhead
                  : f.outcome === 'behind'
                    ? styles.meterMarkBehind
                    : styles.meterMark
              }
              style={{ left: `${f.markerPct.toFixed(2)}%` }}
            />
          </div>
          <div className={styles.meterAxis}>
            <span>+40 you</span>
            <span>&larr; draw band &plusmn;10 &rarr;</span>
            <span>them +40</span>
          </div>
          <div className={f.outcome === 'drawn' ? styles.verdictCalm : styles.verdict}>
            {f.verdict}
          </div>
        </div>
      )}

      {model.phase === 'market' && !preview && f.hasScores && (
        <div className={styles.meter}>
          <div className={styles.verdictCalm}>{f.verdict}</div>
        </div>
      )}

      {preview && model.xi.length > 0 && (
        <div className={styles.xi}>
          <div className={styles.xiHd}>
            <span className={styles.xiT}>Your XI</span>
            <span className={styles.xiS}>{model.xiSummary}</span>
          </div>
          <div className={styles.xiGrid}>
            {model.xi.map((slot, i) => (
              <div key={`${slot.playerId}-${i}`} className={styles.xiCell}>
                <PositionBadge position={slot.slot as GranularPosition} size="sm" />
                <span
                  className={
                    slot.state === 'flag'
                      ? styles.xiNameFlag
                      : slot.state === 'locked'
                        ? styles.xiNameLocked
                        : styles.xiName
                  }
                  title={slot.note ?? undefined}
                >
                  {slot.name}
                </span>
              </div>
            ))}
          </div>
          {model.xiFlags.length > 0 && (
            <div className={styles.xiFlags}>
              {model.xiFlags.slice(0, 3).map((flag, i) => (
                <span key={i} className={styles.xiFlag}>
                  <b>{flag}</b>
                </span>
              ))}
            </div>
          )}

          {/* A cover gap is a RISK, not a mistake, and it is only real if that
              starter records zero minutes. Stating the consequence and then
              showing the bench that produces it is the difference between a
              rule the reader learns and an error message they distrust —
              the bench categories (DEF/MID/ATT/FLEX) decide where a player
              sits, never what he can cover. */}
          {model.coverGaps.length > 0 && (
            <div className={styles.cover}>
              <div className={styles.coverLead}>
                {model.coverGaps.length === 1 ? (
                  <>
                    <b>
                      {model.coverGaps[0].starter} is doubtful and nobody on your bench can fill{' '}
                      {model.coverGaps[0].slot}
                    </b>{' '}
                    — if he records no minutes, that slot scores nothing.
                  </>
                ) : (
                  <>
                    <b>
                      {model.coverGaps.map((g) => `${g.starter} (${g.slot})`).join(', ')}
                    </b>{' '}
                    are doubtful with no eligible cover on your bench — any of those slots scores
                    nothing if the starter does not play.
                  </>
                )}
              </div>
              {model.benchSummary.length > 0 && (
                <div className={styles.coverBench}>
                  Your bench:{' '}
                  {model.benchSummary
                    .map((b) => `${b.name} (${b.positions.join('/')})`)
                    .join(', ')}
                  . A substitute has to match the slot exactly, by his primary or
                  secondary position.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isLive && (
        <div className={styles.heroFoot}>
          <div className={styles.heroFootA}>
            <b>
              {f.stillToPlay.mine} still to play
            </b>
          </div>
          <NavigationLink
            href={`/league/${model.leagueId}/matchups/${f.matchupId}`}
            className={styles.btnPrimary}
          >
            Open matchup
          </NavigationLink>
          <div className={styles.heroFootB} />
        </div>
      )}

      {isFt && (
        <>
          <div className={styles.report}>
            <div className={styles.verdict}>{f.verdict}</div>
            {model.matchReportHeadline && (
              <div className={styles.reportH}>{model.matchReportHeadline}</div>
            )}
            <div className={styles.reportB}>
              {model.matchReportByline ? `${model.matchReportByline} · ` : ''}
              <NavigationLink href={`/league/${model.leagueId}/matchups/${f.matchupId}`}>
                Read the report
              </NavigationLink>
            </div>
          </div>
          {model.debrief.length > 0 && (
            <div className={styles.debrief}>
              {model.debrief.map((d, i) => (
                <span key={i} className={styles.debriefItem}>
                  <b>{d.value}</b> {d.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {settled && !isFt && model.debrief.length > 0 && (
        <div className={styles.debrief}>
          {model.debrief.map((d, i) => (
            <span key={i} className={styles.debriefItem}>
              <b>{d.value}</b> {d.label}
            </span>
          ))}
        </div>
      )}

      {f.cupLine && (
        <div className={styles.cup}>
          <span className={`${styles.tag} ${styles.tagPlain}`}>Also</span>
          <span>{f.cupLine}</span>
        </div>
      )}
    </section>
  );
}

/**
 * Close of season — the three states Duke asked to merge, as one screen.
 *
 * The final table and the season's best deliberately do NOT appear here: in
 * the offseason those turn Home into a copy of /history. The space belongs to
 * the departure decisions, which are the mechanic that actually runs through
 * the summer.
 */
export function SeasonClosed({ model }: { model: HomeModel }) {
  const c = model.closed;
  if (!c) return null;

  return (
    <section className={styles.closed} aria-label="Season closed">
      <div className={styles.closedLead}>
        <CrestBadge
          config={model.club.crest as CrestConfig | null}
          size={46}
          teamName={model.club.name}
        />
        <div>
          <div className={styles.closedF}>{c.headline}</div>
          <div className={styles.closedS}>{c.sub}</div>
        </div>
      </div>

      <div className={styles.stages}>
        {c.stages.map((s, i) => (
          <div key={i} className={s.done ? styles.stageDone : styles.stageNow}>
            <div className={styles.stageH}>{s.name}</div>
            <div className={styles.stageS}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className={styles.closedMoney}>
        <div>
          <div className={styles.closedMv}>{c.prizes}</div>
          <div className={styles.closedMs}>{c.prizeSub}</div>
        </div>
        <div>
          <div className={styles.closedMvAccent}>{c.balance}</div>
          <div className={styles.closedMs}>Club Balance, carried over untouched</div>
        </div>
        <div>
          <div className={styles.closedMv}>{c.openDepartures}</div>
          <div className={styles.closedMs}>
            {c.openDepartures === 1 ? 'Departure decision' : 'Departure decisions'} open. Release
            takes the compensation and bars you from his return auction; retain keeps the claim and
            pays nothing.
          </div>
        </div>
      </div>
    </section>
  );
}
