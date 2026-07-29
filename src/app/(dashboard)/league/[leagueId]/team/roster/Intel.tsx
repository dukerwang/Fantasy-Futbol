'use client';

import { useMemo, useState } from 'react';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import type { SquadEntry } from './ClubClient';
import { seasonPts, ppgOf, ageOf } from './clubDerive';
import styles from './club.module.css';

const AGE_COLORS = ['var(--color-accent)', '#5A9F73', 'var(--color-gold)', 'var(--color-defeat)'];

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
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Age Profile</h2>
          <span className={styles.eyebrow}>Dynasty curve</span>
        </div>
        <div className={styles.ageSummary}>
          <span className={styles.ageBig}>{totals.avgAge ? totals.avgAge.toFixed(1) : '—'}</span>
          <span className={styles.ageNote}>average age · {ageVerdict(totals.avgAge)}</span>
        </div>
        <div className={styles.agebar}>
          {totals.buckets.map((b, i) => (b.n > 0 ? (
            <div key={b.label} className={styles.ageseg} style={{ flex: b.n, background: AGE_COLORS[i] }}>{b.n}</div>
          ) : null))}
        </div>
        <div className={styles.agekeys}>
          {totals.buckets.map((b, i) => (
            <span key={b.label} className={styles.agekey}>
              <i style={{ background: AGE_COLORS[i] }} />{b.label} — {b.n}
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
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Scoring Contribution</h2>
          <span className={styles.eyebrow}>Total points · this season</span>
        </div>
        <div className={styles.scoreRows}>
          {scorers.map((e) => {
            const starter = e.status === 'active';
            return (
              <div className={styles.srow} key={e.id}>
                <span className={styles.sname}>{getPlayerDisplayName(e.player, 'initial_last')}</span>
                <div className={styles.strack}>
                  <div className={styles.sbar} style={{
                    width: `${(seasonPts(e) / maxPts) * 100}%`,
                    background: starter ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    opacity: starter ? 0.9 : 0.5,
                  }} />
                </div>
                <span className={styles.sval}>{seasonPts(e)}<small>{ppgOf(e).toFixed(1)} pg</small></span>
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
          <span><i style={{ background: 'var(--color-accent)', opacity: 0.9 }} />Starting XI</span>
          <span><i style={{ background: 'var(--color-text-muted)', opacity: 0.5 }} />Rotation &amp; bench</span>
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
