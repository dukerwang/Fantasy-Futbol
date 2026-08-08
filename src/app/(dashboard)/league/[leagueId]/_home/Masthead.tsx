import CrestBadge from '@/components/crest/CrestBadge';
import type { CrestConfig } from '@/components/crest/types';
import type { HomeModel } from '@/lib/home/buildHomeModel';
import styles from './home.module.css';

/**
 * The masthead names YOUR CLUB, not the league.
 *
 * The league name used to be the largest type on a page you can only reach by
 * already being in that league — it told the reader the one thing they could
 * not fail to know. The club is the subject of every region below it, so it is
 * the subject here.
 *
 * Each figure carries a stake rather than a label. "Points for" was dropped
 * outright: a raw cumulative nobody acts on, duplicated in the table's own For
 * column a few hundred pixels further down.
 */
export function Masthead({ model }: { model: HomeModel }) {
  return (
    <header className={styles.mast}>
      <div className={styles.mastId}>
        <CrestBadge
          config={model.club.crest as CrestConfig | null}
          size={46}
          teamName={model.club.name}
        />
        <div className={styles.mastTx}>
          <h1 className={styles.mastName}>{model.club.name}</h1>
          <div className={styles.mastSub}>{model.subtitle}</div>
        </div>
      </div>
      <div className={styles.figs}>
        {model.figures.map((f, i) => (
          <div key={i} className={styles.fig}>
            <div className={f.accent ? `${styles.figV} ${styles.figVAccent}` : styles.figV}>
              {f.value}
            </div>
            <div className={styles.figS}>{f.stake}</div>
          </div>
        ))}
      </div>
    </header>
  );
}
