'use client';

import NavigationLink from '@/components/ui/NavigationLink';
import CrestBadge from '@/components/crest/CrestBadge';
import type { CrestConfig } from '@/components/crest/types';
import type { HomeModel } from '@/lib/home/buildHomeModel';
import { useHeroTab } from './HeroTabContext';
import styles from './home.module.css';

/**
 * The opponent as a person — for whichever fixture the hero card is
 * currently showing. Shares HeroTabContext with Fixture so the two never
 * show two different opponents at once.
 */
export default function OpponentCard({ model }: { model: HomeModel }) {
  const hasSecondary = !!model.secondaryOpponent && !!model.secondaryFixture;
  const { tab } = useHeroTab();
  const opponent = hasSecondary && tab === 'secondary' ? model.secondaryOpponent : model.opponent;
  if (!opponent) return null;

  return (
    <div className={styles.railCard}>
      <div className={styles.railHd}>
        <h2 className={styles.railT}>{opponent.title}</h2>
      </div>
      <div className={styles.opp}>
        <div className={styles.oppId}>
          <CrestBadge
            config={opponent.club.crest as CrestConfig | null}
            size={32}
            teamName={opponent.club.name}
            teamId={opponent.club.id}
          />
          <div>
            <div className={styles.oppName}>{opponent.club.name}</div>
            <div className={styles.oppManager}>
              {opponent.club.manager ? `@${opponent.club.manager}` : 'Unclaimed'}
            </div>
          </div>
        </div>
        <div className={styles.oppH2h}>
          <div>
            <div className={styles.oppH2hV}>{opponent.record}</div>
            <div className={styles.oppH2hL}>All-time, W-D-L</div>
          </div>
          <div>
            <div className={styles.oppH2hV}>{opponent.lastMeeting}</div>
            <div className={styles.oppH2hL}>Last meeting</div>
          </div>
        </div>
        <NavigationLink href={`/league/${model.leagueId}/chat`} className={styles.btn}>
          {opponent.club.manager ? `Message @${opponent.club.manager}` : 'Open chat'}
        </NavigationLink>
      </div>
    </div>
  );
}
