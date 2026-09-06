'use client';

/**
 * Heritage — Record Book.
 *
 * A record is the holder, the context, and the two clubs closest to taking it
 * off them. One number alone reads as trivia; the chasing pack is what makes it
 * a record.
 *
 * The value leads on its own line and the holder sits beneath it as a small
 * crest inline with the club name. An earlier draft centred the crest against a
 * stacked value-and-name and it belonged to neither.
 */

import CrestBadge from '@/components/crest/CrestBadge';
import type { CrestConfig } from '@/components/crest/types';
import type { RecordBookEntry } from '@/lib/heritage/records';
import HeritageNav from '../HeritageNav';
import styles from '../heritage.module.css';

interface Club {
  teamId: string;
  teamName: string;
  crestConfig: CrestConfig | null;
}

interface Props {
  leagueId: string;
  records: RecordBookEntry[];
  clubs: Club[];
  titles: { teamId: string; count: number; seasons: string[] }[];
  viewerTeamId: string | null;
}

const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function RecordBookView({ leagueId, records, clubs, titles, viewerTeamId }: Props) {
  const byId = new Map(clubs.map((c) => [c.teamId, c]));
  const groups: RecordBookEntry['group'][] = ['Scoring', 'Runs'];

  function Entry({ r }: { r: RecordBookEntry }) {
    const [leader, ...chasers] = r.entries;
    const club = byId.get(leader.teamId);
    return (
      <div className={styles.record}>
        <div className={styles.recordLabel}>{r.label}</div>
        <div className={styles.recordValue}>{fmt(leader.value)}</div>
        <div className={styles.recordHolder}>
          {club && (
            <CrestBadge
              config={club.crestConfig}
              size={22}
              teamName={club.teamName}
              teamId={club.teamId}
              interactive={false}
            />
          )}
          <span className={leader.teamId === viewerTeamId ? styles.recordClubMine : styles.recordClub}>
            {club?.teamName ?? 'Unknown'}
          </span>
        </div>
        <div className={styles.recordContext}>{leader.context}</div>
        <div className={styles.chasers}>
          {chasers.length ? (
            chasers.map((c, i) => (
              <span key={c.teamId} className={styles.chaser}>
                <span className={styles.chaserRank}>{i === 0 ? '2nd' : '3rd'}</span>
                <span className={styles.chaserValue}>{fmt(c.value)}</span>
                <span className={styles.chaserClub}>{byId.get(c.teamId)?.teamName ?? 'Unknown'}</span>
              </span>
            ))
          ) : (
            <span className={styles.chaserNone}>No other club has one</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.mast}>
        <div className={styles.mastTx}>
          <h1 className={styles.title}>Record Book</h1>
          <p className={styles.subtitle}>
            Every competition and every season played, including the one in progress
          </p>
        </div>
      </div>

      <HeritageNav leagueId={leagueId} active="Record Book" />

      {records.length === 0 && titles.length === 0 ? (
        <p className={styles.empty}>
          Nothing is on record yet. The first completed gameweek sets every one of these.
        </p>
      ) : (
        <>
          {groups.map((g) => {
            const inGroup = records.filter((r) => r.group === g);
            if (!inGroup.length) return null;
            return (
              <div key={g} className={styles.block}>
                <div className={styles.sect}>
                  <h2 className={styles.sectT}>{g}</h2>
                  <span className={styles.sectHint}>
                    {g === 'Scoring' ? 'Points put on the board' : 'Gameweeks in a row'}
                  </span>
                </div>
                <div className={`${styles.box} ${styles.recordGrid}`}>
                  {inGroup.map((r) => <Entry key={r.key} r={r} />)}
                </div>
              </div>
            );
          })}

          {titles.length > 0 && (
            <div className={styles.block}>
              <div className={styles.sect}>
                <h2 className={styles.sectT}>Silverware</h2>
                <span className={styles.sectHint}>League titles won</span>
              </div>
              <div className={`${styles.box} ${styles.recordGrid}`}>
                <div className={styles.record}>
                  <div className={styles.recordLabel}>Most League Titles</div>
                  <div className={styles.recordValue}>{titles[0].count}</div>
                  <div className={styles.recordHolder}>
                    {byId.get(titles[0].teamId) && (
                      <CrestBadge
                        config={byId.get(titles[0].teamId)!.crestConfig}
                        size={22}
                        teamName={byId.get(titles[0].teamId)!.teamName}
                        teamId={titles[0].teamId}
                        interactive={false}
                      />
                    )}
                    <span className={titles[0].teamId === viewerTeamId ? styles.recordClubMine : styles.recordClub}>
                      {byId.get(titles[0].teamId)?.teamName ?? 'Unknown'}
                    </span>
                  </div>
                  <div className={styles.recordContext}>{titles[0].seasons.join(', ')}</div>
                  <div className={styles.chasers}>
                    {titles.length > 1 ? (
                      titles.slice(1).map((t, i) => (
                        <span key={t.teamId} className={styles.chaser}>
                          <span className={styles.chaserRank}>{i === 0 ? '2nd' : '3rd'}</span>
                          <span className={styles.chaserValue}>{t.count}</span>
                          <span className={styles.chaserClub}>{byId.get(t.teamId)?.teamName ?? 'Unknown'}</span>
                        </span>
                      ))
                    ) : (
                      <span className={styles.chaserNone}>No other club has one</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
