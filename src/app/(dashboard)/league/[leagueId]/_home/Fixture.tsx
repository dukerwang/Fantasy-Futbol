'use client';

import NavigationLink from '@/components/ui/NavigationLink';
import CrestBadge from '@/components/crest/CrestBadge';
import PositionBadge from '@/components/players/PositionBadge';
import type { CrestConfig } from '@/components/crest/types';
import type { GranularPosition } from '@/types';
import type { HomeModel } from '@/lib/home/buildHomeModel';
import { useHeroTab } from './HeroTabContext';
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
 *
 * Whichever the phase machine did not pick as primary — last week's result
 * during build-up, or next week's fixture during full time/market — is one
 * tap away via the tabs below, rather than hidden until the phase turns
 * over. `preferSecondary` opens on whichever side is more relevant: once
 * the next deadline is close, that is the one worth seeing first.
 */
export default function Fixture({ model }: { model: HomeModel }) {
  const f = model.fixture;
  if (!f) return null;

  const hasSecondary = !!model.secondaryFixture && !!model.secondaryKind;
  const { tab, setTab } = useHeroTab();
  const showingSecondary = hasSecondary && tab === 'secondary';
  const view = showingSecondary ? model.secondaryFixture! : f;

  const isLive = !showingSecondary && model.phase === 'live';
  const isFt = !showingSecondary && model.phase === 'ft';
  const settled = !showingSecondary && (isFt || model.phase === 'market');
  /**
   * Preview vs report is decided by the FIXTURE on show, not by the phase.
   * Before GW1 the page is in the market phase while the fixture on show has
   * not kicked off, and calling that "settled" would state something untrue.
   */
  const preview = showingSecondary ? !model.secondaryPlayed : !model.heroPlayed;

  const xi = showingSecondary ? model.secondaryXi : model.xi;
  const xiFlags = showingSecondary ? model.secondaryXiFlags : model.xiFlags;
  const xiSummary = showingSecondary ? model.secondaryXiSummary : model.xiSummary;
  const coverGaps = showingSecondary ? model.secondaryCoverGaps : model.coverGaps;
  const benchSummary = showingSecondary ? model.secondaryBenchSummary : model.benchSummary;
  const debrief = showingSecondary ? model.secondaryDebrief : model.debrief;

  const primaryLabel = model.secondaryKind === 'preview' ? 'Last week' : 'Up next';
  const secondaryLabel = model.secondaryKind === 'preview' ? 'Up next' : 'Last week';

  return (
    <section className={styles.hero} aria-label="Your fixture">
      {hasSecondary && (
        <div className={styles.heroTabs} role="tablist" aria-label="Switch fixture">
          <button
            type="button"
            role="tab"
            aria-selected={!showingSecondary}
            className={!showingSecondary ? styles.heroTabActive : styles.heroTab}
            onClick={() => setTab('primary')}
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showingSecondary}
            className={showingSecondary ? styles.heroTabActive : styles.heroTab}
            onClick={() => setTab('secondary')}
          >
            {secondaryLabel}
          </button>
        </div>
      )}

      <div className={styles.heroTop}>
        <span className={styles.heroWhen}>{view.when}</span>
        {isLive ? (
          <span className={styles.live}>In play</span>
        ) : (
          <span
            className={`${styles.tag} ${
              preview
                ? styles.tagWarn
                : view.outcome === 'ahead'
                  ? styles.tagOwn
                  : styles.tagPlain
            }`}
          >
            {preview
              ? 'Not yet locked'
              : view.outcome === 'ahead'
                ? 'Won'
                : view.outcome === 'behind'
                  ? 'Lost'
                  : 'Drawn'}
          </span>
        )}
      </div>

      <div className={styles.heroTeams}>
        <div className={styles.ht}>
          <CrestBadge config={view.home.crest as CrestConfig | null} size={32} teamName={view.home.name} teamId={view.home.id} />
          <div className={styles.htTx}>
            <div className={styles.htName}>{view.home.name}</div>
            <div className={styles.htMeta}>{view.homeMeta}</div>
          </div>
        </div>

        <div className={styles.scores}>
          {view.hasScores ? (
            <>
              <div className={view.outcome === 'behind' ? styles.scoreDim : styles.score}>
                {view.homeScore?.toFixed(2)}
              </div>
              <div className={styles.scoreSep} />
              <div className={view.outcome === 'ahead' ? styles.scoreDim : styles.score}>
                {view.awayScore?.toFixed(2)}
              </div>
            </>
          ) : (
            <div className={styles.vs}>vs</div>
          )}
        </div>

        <div className={`${styles.ht} ${styles.htAway}`}>
          <div className={styles.htTx}>
            <div className={styles.htName}>{view.away.name}</div>
            <div className={styles.htMeta}>{view.awayMeta}</div>
          </div>
          <CrestBadge config={view.away.crest as CrestConfig | null} size={32} teamName={view.away.name} teamId={view.away.id} />
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

      {!showingSecondary && model.phase === 'market' && !preview && f.hasScores && (
        <div className={styles.meter}>
          <div className={styles.verdictCalm}>{f.verdict}</div>
        </div>
      )}

      {preview && xi.length > 0 && (
        <div className={styles.xi}>
          <div className={styles.xiHd}>
            <span className={styles.xiT}>Your XI</span>
            <span className={styles.xiS}>{xiSummary}</span>
          </div>
          <div className={styles.xiGrid}>
            {xi.map((slot, i) => (
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
          {xiFlags.length > 0 && (
            <div className={styles.xiFlags}>
              {xiFlags.slice(0, 3).map((flag, i) => (
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
          {coverGaps.length > 0 && (
            <div className={styles.cover}>
              <div className={styles.coverLead}>
                {coverGaps.length === 1 ? (
                  <>
                    <b>
                      {coverGaps[0].starter} is doubtful and nobody on your bench can fill{' '}
                      {coverGaps[0].slot}
                    </b>{' '}
                    — if he records no minutes, that slot scores nothing.
                  </>
                ) : (
                  <>
                    <b>{coverGaps.map((g) => `${g.starter} (${g.slot})`).join(', ')}</b> are
                    doubtful with no eligible cover on your bench — any of those slots scores
                    nothing if the starter does not play.
                  </>
                )}
              </div>
              {benchSummary.length > 0 && (
                <div className={styles.coverBench}>
                  Your bench:{' '}
                  {benchSummary.map((b) => `${b.name} (${b.positions.join('/')})`).join(', ')}. A
                  substitute has to match the slot exactly, by his primary or secondary position.
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

      {showingSecondary && model.secondaryKind === 'result' && view.hasScores && (
        <>
          <div className={styles.report}>
            <div className={styles.verdict}>{view.verdict}</div>
            <div className={styles.reportB}>
              <NavigationLink href={`/league/${model.leagueId}/matchups/${view.matchupId}`}>
                Open matchup
              </NavigationLink>
            </div>
          </div>
          {debrief.length > 0 && (
            <div className={styles.debrief}>
              {debrief.map((d, i) => (
                <span key={i} className={styles.debriefItem}>
                  <b>{d.value}</b> {d.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {!showingSecondary && f.cupLine && (
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
          teamId={model.club.id}
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
