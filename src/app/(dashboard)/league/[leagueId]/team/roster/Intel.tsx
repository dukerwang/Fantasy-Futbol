'use client';

import { useMemo, useState } from 'react';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import type { SquadEntry } from './ClubClient';
import { seasonPts, ppgOf, ageOf } from './clubDerive';
import styles from './club.module.css';

/**
 * The age bar is ONE hue in four steps, not four hues.
 *
 * It was accent / a raw #5A9F73 / --color-gold / --color-defeat: four colours
 * for what is an ordinal ramp, one of them invented, one a medal token, one a
 * match-result token with no dark value at all (1.89:1 on a dark card). The
 * palette has no four free hues, and age is not four categories — it runs young
 * to old. So the ramp holds the accent's hue and steps its strength, which is
 * what a progression looks like, and the counts moved out of the segments into
 * the key, which is what removes the ink-on-fill problem the four fills had.
 */
const AGE_STEPS = ['ageseg1', 'ageseg2', 'ageseg3', 'ageseg4'] as const;

interface Totals {
  avgAge: number;
  buckets: { label: string; n: number }[];
}

export default function Intel({ entries, totals }: { entries: SquadEntry[]; totals: Totals }) {
  const [showAll, setShowAll] = useState(false);

  const byAge = useMemo(
    () => entries.filter((e) => ageOf(e.player.date_of_birth) != null)
      .sort((a, b) => (ageOf(b.player.date_of_birth) ?? 0) - (ageOf(a.player.date_of_birth) ?? 0)),
    [entries],
  );
  const oldest = byAge[0];
  const youngest = byAge[byAge.length - 1];
  const u21 = entries.filter((e) => { const a = ageOf(e.player.date_of_birth); return a != null && a <= 21; }).length;

  const ranked = useMemo(() => entries.slice().sort((a, b) => seasonPts(b) - seasonPts(a)), [entries]);
  const maxPts = ranked.length ? Math.max(seasonPts(ranked[0]), 1) : 1;
  const scorers = showAll ? ranked : ranked.slice(0, 10);

  return (
    <div className={styles.intel}>
      {/* Age Profile */}
      <section className={`${styles.panel} g-panel`}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Age Profile</h2>
          <span className="g-label">Dynasty curve</span>
        </div>
        <div className={styles.ageSummary}>
          <span className={styles.ageBig}>{totals.avgAge ? totals.avgAge.toFixed(1) : '—'}</span>
          <span className={styles.ageNote}>average age · {ageVerdict(totals.avgAge)}</span>
        </div>
        <div className={styles.agebar}>
          {totals.buckets.map((b, i) => (b.n > 0 ? (
            <div key={b.label} className={`${styles.ageseg} ${styles[AGE_STEPS[i]]}`} style={{ flex: b.n } as React.CSSProperties} />
          ) : null))}
        </div>
        <div className={styles.agekeys}>
          {totals.buckets.map((b, i) => (
            <span key={b.label} className={styles.agekey}>
              <i className={styles[AGE_STEPS[i]]} />{b.label} — <span className={styles.agekeyN}>{b.n}</span>
            </span>
          ))}
        </div>
        <div className={styles.fileRows} style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 4 }}>
          {oldest && <Row k="Oldest" v={`${getPlayerDisplayName(oldest.player, 'initial_last')} · ${ageOf(oldest.player.date_of_birth)}`} />}
          {youngest && <Row k="Youngest" v={`${getPlayerDisplayName(youngest.player, 'initial_last')} · ${ageOf(youngest.player.date_of_birth)}`} />}
          <Row k="Academy eligible (U21)" v={`${u21} of ${entries.length}`} />
        </div>
      </section>

      {/* Scoring Contribution */}
      <section className={`${styles.panel} g-panel`}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Scoring Contribution</h2>
          <span className="g-label">Total points · this season</span>
        </div>
        <div className={styles.scoreRows}>
          {scorers.map((e) => {
            const starter = e.status === 'active';
            return (
              <div className={styles.srow} key={e.id}>
                <span className={styles.sname}>{getPlayerDisplayName(e.player, 'initial_last')}</span>
                {/* A recessed track, because a value is laid into it. The bar is
                    ink rather than accent: on your own club every player is
                    yours, so an accent bar distinguishes nothing, and on a
                    rival's club — the same component, same file — it is wrong. */}
                <div className={`${styles.strack} g-track`}>
                  <div
                    className={`${styles.sbar} ${starter ? '' : styles.sbarSub}`}
                    style={{ width: `${(seasonPts(e) / maxPts) * 100}%` }}
                  />
                </div>
                <span className={styles.sval}>{seasonPts(e)}<small>{ppgOf(e).toFixed(2)} pg</small></span>
              </div>
            );
          })}
          {scorers.length === 0 && <p className={styles.formsNote}>No scoring recorded yet this season.</p>}
        </div>
        {entries.length > 10 && (
          <button type="button" className={styles.showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show top 10' : `Show all ${entries.length} players`}
          </button>
        )}
        <div className={styles.legend}>
          <span><i className={styles.legendStarter} />Starting XI</span>
          <span><i className={styles.legendSub} />Rotation &amp; bench</span>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className={styles.fileRow}>
      <span className={styles.fileK}>{k}</span>
      <span className={styles.fileV}>{v}</span>
    </div>
  );
}

function ageVerdict(avg: number): string {
  if (!avg) return 'no ages on file';
  if (avg < 24) return 'a young, ascending squad';
  if (avg <= 27) return 'squad is in its prime window';
  return 'an experienced, win-now squad';
}
