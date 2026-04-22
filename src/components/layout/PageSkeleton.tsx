import styles from './PageSkeleton.module.css';

/**
 * Generic shimmer skeleton for Cream Editorial pages.
 * Renders immediately (via loading.tsx) while the server fetches data.
 */
export default function PageSkeleton({ variant = 'default' }: { variant?: 'table' | 'cards' | 'default' | 'home' }) {
  return (
    <div className={styles.skeleton}>
      {/* Page header kicker + title (Not used on Home dashboard) */}
      {variant !== 'home' && (
        <div className={styles.cardBlock}>
          <div className={styles.cardHeader} />
          <div className={styles.cardTitle} />
          <div className={`${styles.cardRow} ${styles.rowWide}`} />
        </div>
      )}

      {variant === 'table' ? (
        /* Standings / Stats variant */
        <div className={styles.cardBlock}>
          <div className={styles.cardHeader} />
          <div className={styles.tableRows}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className={styles.tableRow} />
            ))}
          </div>
        </div>
      ) : variant === 'cards' ? (
        /* Trades / Free Agency card grid */
        <>
          <div className={styles.bodyRow}>
            <div className={styles.cardBlock}>
              <div className={styles.cardHeader} />
              <div className={styles.cardTitle} />
              <div className={styles.tableRows}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={styles.tableRow} />
                ))}
              </div>
            </div>
            <div className={styles.cardBlock}>
              <div className={styles.cardHeader} />
              <div className={styles.tableRows}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.tableRow} />
                ))}
              </div>
            </div>
          </div>
        </>
      ) : variant === 'home' ? (
        /* Home: Three column layout */
        <div className={styles.homeRow}>
          <div className={styles.col}>
            <div className={styles.cardBlock}>
              <div className={styles.cardHeader} />
              <div className={styles.cardTitle} />
              <div className={styles.tableRows}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className={styles.tableRow} />
                ))}
              </div>
            </div>
          </div>
          <div className={styles.col}>
            <div className={styles.heroBlock} />
            <div className={styles.cardBlock}>
              <div className={styles.cardHeader} />
              <div className={styles.cardTitle} />
              <div className={styles.tableRows}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.tableRow} />
                ))}
              </div>
            </div>
          </div>
          <div className={styles.col}>
            <div className={styles.cardBlock}>
              <div className={styles.cardHeader} />
              <div className={styles.cardTitle} />
              <div className={styles.tableRows}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={styles.tableRow} />
                ))}
              </div>
            </div>
            <div className={styles.cardBlock}>
              <div className={styles.cardHeader} />
              <div className={styles.cardTitle} />
              <div className={styles.tableRows}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.tableRow} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Default: two column layout */
        <div className={styles.bodyRow}>
          <div className={styles.col}>
            <div className={styles.cardBlock}>
              <div className={styles.cardHeader} />
              <div className={styles.cardTitle} />
              <div className={styles.tableRows}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={styles.tableRow} />
                ))}
              </div>
            </div>
          </div>
          <div className={styles.col}>
            <div className={styles.cardBlock}>
              <div className={styles.cardHeader} />
              <div className={styles.cardTitle} />
              <div className={styles.tableRows}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.tableRow} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
