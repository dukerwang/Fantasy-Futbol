import NavigationLink from '@/components/ui/NavigationLink';
import CrestBadge from '@/components/crest/CrestBadge';
import type { CrestConfig } from '@/components/crest/types';
import type { HomeModel } from '@/lib/home/buildHomeModel';
import { renderBoldedText } from '@/lib/narrative/boldText';
import styles from './home.module.css';

/**
 * The rail.
 *
 * It carries three things the old page's rail did not: the opponent as a
 * PERSON, a shortened Wire, and the dynasty. What it deliberately no longer
 * carries is the "desk summary" — four unrelated numbers where "Squad 23 of
 * 25" was a My Club stat and "Unread messages 3" was a nav badge. That block
 * existed because the rail ran short, which is a content problem; the honest
 * fix is better content, not a sticky column.
 */
export default function Rail({ model }: { model: HomeModel }) {
  return (
    <aside className={styles.rail} aria-label="League feed">
      {model.opponent && (
        <div className={styles.railCard}>
          <div className={styles.railHd}>
            <h2 className={styles.railT}>{model.opponent.title}</h2>
          </div>
          <div className={styles.opp}>
            <div className={styles.oppId}>
              <CrestBadge
                config={model.opponent.club.crest as CrestConfig | null}
                size={32}
                teamName={model.opponent.club.name}
                teamId={model.opponent.club.id}
              />
              <div>
                <div className={styles.oppName}>{model.opponent.club.name}</div>
                <div className={styles.oppManager}>
                  {model.opponent.club.manager ? `@${model.opponent.club.manager}` : 'Unclaimed'}
                </div>
              </div>
            </div>
            <div className={styles.oppH2h}>
              <div>
                <div className={styles.oppH2hV}>{model.opponent.record}</div>
                <div className={styles.oppH2hL}>All-time, W-D-L</div>
              </div>
              <div>
                <div className={styles.oppH2hV}>{model.opponent.lastMeeting}</div>
                <div className={styles.oppH2hL}>Last meeting</div>
              </div>
            </div>
            <NavigationLink href={`/league/${model.leagueId}/chat`} className={styles.btn}>
              {model.opponent.club.manager
                ? `Message @${model.opponent.club.manager}`
                : 'Open chat'}
            </NavigationLink>
          </div>
        </div>
      )}

      <div className={styles.railCard}>
        <div className={styles.railHd}>
          <h2 className={styles.railT}>The Wire</h2>
        </div>
        {model.wire.length === 0 ? (
          <div className={styles.ev}>
            <span className={styles.evDot} />
            <div className={styles.evText}>Nothing has moved yet this season.</div>
          </div>
        ) : (
          model.wire.map((e) => (
            <div key={e.id} className={styles.ev}>
              <span className={styles.evDot} />
              <div>
                {/* The generators mark emphasis with **…** and encode player
                    references as **p:{id}:{Name}**. Printing the raw string
                    leaks both. renderBoldedText is the parser the rest of the
                    app already uses; with no click handler it degrades to
                    <strong>, which is exactly right for a digest. */}
                <div className={styles.evText}>{renderBoldedText(e.text)}</div>
                <div className={styles.evTime}>{e.at}</div>
              </div>
            </div>
          ))
        )}
        <NavigationLink href={`/league/${model.leagueId}/activity`} className={styles.railMore}>
          Full activity &rarr;
        </NavigationLink>
      </div>

      <div className={styles.railCard}>
        <div className={styles.railHd}>
          <h2 className={styles.railT}>The club</h2>
        </div>
        <div className={styles.dyn}>
          {model.clubFacts.map((f, i) => (
            <div key={i} className={styles.dynRow}>
              <span className={styles.dynL}>{f.label}</span>
              <span className={f.gold ? styles.dynVGold : styles.dynV}>{f.value}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
