'use client';

/**
 * Heritage — one pairing, read from `subject`'s side.
 *
 * The header is a fixture line: two crests facing, the record between them.
 * Below it the record splits by competition, the two extremes, the cabinets
 * side by side, and every meeting ever played.
 */

import CrestBadge from '@/components/crest/CrestBadge';
import Trophy from '@/components/trophies/Trophy';
import NavigationLink from '@/components/ui/NavigationLink';
import type { CrestConfig } from '@/components/crest/types';
import type { HonourKind } from '@/lib/honours/getClubHonours';
import type { HeadToHead, Tally } from '@/lib/heritage/headToHead';
import { outcomeFor, type Result } from '@/lib/heritage/results';
import HeritageNav from '../../HeritageNav';
import styles from '../../heritage.module.css';

interface Side {
  teamId: string;
  teamName: string;
  managerName: string | null;
  crestConfig: CrestConfig | null;
  trophies: { kind: HonourKind; season: string }[];
}

interface Props {
  leagueId: string;
  h2h: HeadToHead;
  subject: Side;
  opponent: Side;
  isViewer: boolean;
}

const pts = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function SplitBar({ t }: { t: Tally }) {
  if (!t.played) return null;
  return (
    <div className={styles.bar} role="presentation">
      {t.won > 0 && <i className={styles.barW} style={{ flexGrow: t.won }} />}
      {t.drawn > 0 && <i className={styles.barD} style={{ flexGrow: t.drawn }} />}
      {t.lost > 0 && <i className={styles.barL} style={{ flexGrow: t.lost }} />}
    </div>
  );
}

export default function PairingView({ leagueId, h2h, subject, opponent, isViewer }: Props) {
  const scoreline = (r: Result) => {
    const isA = r.teamAId === subject.teamId;
    return { mine: isA ? r.scoreA : r.scoreB, theirs: isA ? r.scoreB : r.scoreA };
  };

  const Cabinet = ({ side }: { side: Side }) => (
    <div className={styles.cabinetSide}>
      <div className={styles.cabinetId}>
        <CrestBadge config={side.crestConfig} size={26} teamName={side.teamName} teamId={side.teamId} interactive={false} />
        <span className={styles.cabinetName}>{side.teamName}</span>
      </div>
      {side.trophies.length ? (
        <div className={styles.cabinetStage}>
          {side.trophies.map((t, i) => (
            <div key={`${t.kind}-${t.season}-${i}`} className={styles.stand}>
              <Trophy kind={t.kind} size="hero" height={112} season={t.season} />
              <div className={styles.plate}>{t.season}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.cabinetEmpty}>Nothing won yet</p>
      )}
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.mast}>
        <div className={styles.mastTx}>
          <h1 className={styles.title}>Head-to-Head</h1>
          <p className={styles.subtitle}>
            {subject.teamName} against {opponent.teamName}
          </p>
        </div>
      </div>

      <HeritageNav leagueId={leagueId} active="Head-to-Head" />

      <div className={`${styles.box} ${styles.fixture}`}>
        <div className={styles.fixtureRow}>
          <div className={styles.fixtureSideA}>
            <div className={styles.fixtureTx}>
              <div className={styles.fixtureName}>{subject.teamName}</div>
              <div className={styles.boardMgr}>
                {subject.managerName ?? '—'}{isViewer ? ' · you' : ''}
              </div>
            </div>
            <CrestBadge config={subject.crestConfig} size={72} teamName={subject.teamName} teamId={subject.teamId} interactive={false} />
          </div>

          <div className={styles.fixtureMid}>
            <div className={styles.fixtureMeta}>
              {h2h.played} {h2h.played === 1 ? 'meeting' : 'meetings'}
            </div>
            <div className={styles.fixtureTally}>
              <div>
                <div className={styles.tallyW}>{h2h.won}</div>
                <div className={styles.figS}>Won</div>
              </div>
              <div>
                <div className={styles.tallyD}>{h2h.drawn}</div>
                <div className={styles.figS}>Drawn</div>
              </div>
              <div>
                <div className={styles.tallyL}>{h2h.lost}</div>
                <div className={styles.figS}>Lost</div>
              </div>
            </div>
          </div>

          <div className={styles.fixtureSideB}>
            <CrestBadge config={opponent.crestConfig} size={72} teamName={opponent.teamName} teamId={opponent.teamId} interactive={false} />
            <div className={styles.fixtureTx}>
              <div className={styles.fixtureName}>{opponent.teamName}</div>
              <div className={styles.boardMgr}>{opponent.managerName ?? '—'}</div>
            </div>
          </div>
        </div>

        {h2h.played > 0 && (
          <div className={styles.fixtureFoot}>
            <div className={styles.fixtureFor}>
              <div className={styles.figV}>{pts(h2h.pointsFor)}</div>
              <div className={styles.figS}>Points for</div>
            </div>
            <SplitBar t={h2h} />
            <div>
              <div className={styles.figV}>{pts(h2h.pointsAgainst)}</div>
              <div className={styles.figS}>Points against</div>
            </div>
          </div>
        )}
      </div>

      {h2h.played === 0 ? (
        <p className={styles.empty}>
          These two have not met in a completed fixture yet.
        </p>
      ) : (
        <>
          <div className={styles.block}>
            <div className={styles.sect}>
              <h2 className={styles.sectT}>League &amp; Cups</h2>
              <span className={styles.sectHint}>Where the meetings were played</span>
            </div>
            <div className={`${styles.box} ${styles.splitGrid}`}>
              <div className={styles.splitCell}>
                <div className={styles.splitRow}>
                  <span className={styles.splitLabel}>League</span>
                  <SplitBar t={h2h.league} />
                  <span className={styles.splitRec}>{h2h.league.won}–{h2h.league.drawn}–{h2h.league.lost}</span>
                </div>
                <div className={styles.splitRow}>
                  <span className={styles.splitLabel}>Cups</span>
                  <SplitBar t={h2h.cups} />
                  <span className={styles.splitRec}>{h2h.cups.won}–{h2h.cups.drawn}–{h2h.cups.lost}</span>
                </div>
                {h2h.streak && h2h.streak.length > 1 && (
                  <p className={styles.splitNote}>
                    {subject.teamName} {h2h.streak.outcome === 'win' ? 'have won' : h2h.streak.outcome === 'loss' ? 'have lost' : 'have drawn'}{' '}
                    the last {h2h.streak.length}.
                  </p>
                )}
              </div>

              <div className={styles.splitCell}>
                <div className={styles.recordLabel}>Biggest Win</div>
                {h2h.biggestWin ? (
                  <>
                    <div className={styles.splitScore}>
                      {pts(scoreline(h2h.biggestWin).mine)}
                      <span className={styles.dash}>–</span>
                      {pts(scoreline(h2h.biggestWin).theirs)}
                    </div>
                    <div className={styles.recordContext}>
                      {h2h.biggestWin.stage}, {h2h.biggestWin.season}
                      {h2h.biggestWin.competition !== 'league' ? ` · ${h2h.biggestWin.competitionLabel}` : ''}
                    </div>
                  </>
                ) : (
                  <p className={styles.cabinetEmpty}>No win yet</p>
                )}
              </div>

              <div className={styles.splitCell}>
                <div className={styles.recordLabel}>Heaviest Defeat</div>
                {h2h.heaviestDefeat ? (
                  <>
                    <div className={styles.splitScore}>
                      {pts(scoreline(h2h.heaviestDefeat).mine)}
                      <span className={styles.dash}>–</span>
                      {pts(scoreline(h2h.heaviestDefeat).theirs)}
                    </div>
                    <div className={styles.recordContext}>
                      {h2h.heaviestDefeat.stage}, {h2h.heaviestDefeat.season}
                      {h2h.heaviestDefeat.competition !== 'league' ? ` · ${h2h.heaviestDefeat.competitionLabel}` : ''}
                    </div>
                  </>
                ) : (
                  <p className={styles.cabinetEmpty}>No defeat yet</p>
                )}
              </div>
            </div>
          </div>

          <div className={styles.block}>
            <div className={styles.sect}>
              <h2 className={styles.sectT}>Trophy Cabinets</h2>
            </div>
            <div className={styles.box}>
              <div className={styles.cabinets}>
                <div className={styles.pool} aria-hidden="true" />
                <div className={styles.cabinetsInner}>
                  <Cabinet side={subject} />
                  <div className={styles.cabinetDivider} aria-hidden="true" />
                  <Cabinet side={opponent} />
                </div>
              </div>
            </div>
          </div>

          <div className={styles.block}>
            <div className={styles.sect}>
              <h2 className={styles.sectT}>Previous Meetings</h2>
              <span className={styles.sectHint}>Newest first</span>
            </div>
            <div className={styles.box}>
              {h2h.meetings.map((r, i) => {
                const s = scoreline(r);
                const o = outcomeFor(r, subject.teamId);
                const drawBand = r.competition === 'league' && o === 'draw';
                return (
                  <div key={`${r.season}-${r.stage}-${i}`} className={styles.meetRow}>
                    <span className={styles.meetSeason}>{r.season}</span>
                    <span className={styles.meetStage}>{r.stage}</span>
                    <span className={styles.meetComp}>{r.competitionLabel}</span>
                    <span className={styles.meetScore}>
                      <span className={s.mine >= s.theirs ? styles.meetLead : styles.meetTrail}>{pts(s.mine)}</span>
                      <span className={styles.dash}>–</span>
                      <span className={s.theirs >= s.mine ? styles.meetLead : styles.meetTrail}>{pts(s.theirs)}</span>
                    </span>
                    <span className={styles.meetNote}>{drawBand ? 'Inside the draw band' : ''}</span>
                    <span className={o === 'win' ? styles.dotW : o === 'draw' ? styles.dotD : styles.dotL}>
                      {o === 'win' ? 'W' : o === 'draw' ? 'D' : 'L'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className={styles.backRow}>
        <NavigationLink href={`/league/${leagueId}/heritage/head-to-head`} className={styles.sectMore}>
          All rivalries
        </NavigationLink>
      </div>
    </div>
  );
}
