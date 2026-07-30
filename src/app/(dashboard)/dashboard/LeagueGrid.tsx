'use client';

import { useState, CSSProperties } from 'react';
import NavigationLink from '@/components/ui/NavigationLink';
import { Icon } from '@/components/ui/Icon';
import styles from './LeagueGrid.module.css';

export interface LeagueCardData {
  id: string;
  name: string;
  status: string;
  season: string;
  teamName: string;
  crestColor: string;
  crestInitials: string;
  isCommissioner: boolean;
  // active
  rank: number | null;
  faabBudget: number;
  managerCount: number;
  maxTeams: number;
  // drafting
  yourPickSlot: number | null;
  currentPickNumber: number | null;
  currentRound: number | null;
  totalRounds: number | null;
  isMyTurn: boolean;
}

type SortMode = 'recent' | 'rank' | 'az';

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STATUS_COLOR: Record<string, string> = {
  setup: 'var(--color-warning)',
  drafting: 'var(--color-accent-purple)',
  active: 'var(--color-accent)',
  offseason: 'var(--color-text-muted)',
};

function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? 'var(--color-text-muted)';
}

export default function LeagueGrid({ leagues }: { leagues: LeagueCardData[] }) {
  const [sort, setSort] = useState<SortMode>('recent');

  const sorted = [...leagues];
  if (sort === 'rank') {
    sorted.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  } else if (sort === 'az') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <>
      <div className={styles.controlsRow}>
        <span className={styles.sectionLabel}>Your Clubs</span>
        <div className={styles.sortField}>
          <span className={styles.sectionLabel}>Sort</span>
          <select
            className={styles.sortSelect}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
          >
            <option value="recent">Recently active</option>
            <option value="rank">Rank</option>
            <option value="az">A–Z</option>
          </select>
        </div>
      </div>

      <div className={styles.grid}>
        {sorted.map((league, i) => (
          <NavigationLink
            key={league.id}
            href={`/league/${league.id}`}
            className={styles.card}
            style={{ '--delay': `${i * 60}ms` } as CSSProperties}
          >
            <div className={styles.cardTop}>
              <div className={styles.crest} style={{ '--crest-color': league.crestColor } as CSSProperties} aria-hidden="true">
                {league.crestInitials}
              </div>
              <div className={styles.cardHeading}>
                <h3 className={styles.cardName}>{league.name}</h3>
                <span
                  className={styles.cardStatus}
                  style={{ '--pc': statusColor(league.status) } as CSSProperties}
                >
                  {capitalize(league.status)}
                </span>
              </div>
            </div>

            {league.status === 'drafting' ? (
              <DraftingBody league={league} />
            ) : league.status === 'setup' ? (
              <SetupBody league={league} />
            ) : (
              <ActiveBody league={league} />
            )}
          </NavigationLink>
        ))}
      </div>
    </>
  );
}

function ActiveBody({ league }: { league: LeagueCardData }) {
  return (
    <>
      <p className={styles.cardTeam}>Your club — <b>{league.teamName}</b></p>
      <div className={styles.cardStats}>
        <div className={styles.stat}>
          <span className={`${styles.statValue} ${league.rank === 1 ? styles.rankGold : ''}`}>
            {league.rank ? (
              <>
                {league.rank <= 3 && (
                  <Icon
                    name="trophy"
                    size={14}
                    strokeWidth={2}
                    className={league.rank === 1 ? styles.trophyGold : league.rank === 2 ? styles.trophySilver : styles.trophyBronze}
                  />
                )}
                {ordinal(league.rank)}
              </>
            ) : '—'}
          </span>
          <span className={styles.statLabel}>Rank</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>€{league.faabBudget}m</span>
          <span className={styles.statLabel}>Balance</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{league.managerCount}/{league.maxTeams}</span>
          <span className={styles.statLabel}>Managers</span>
        </div>
      </div>
      <div className={styles.cardFooter}>
        <span className={styles.cardCta}>
          Enter Club <Icon name="chevron-right" size={13} strokeWidth={2.2} />
        </span>
        <span className={styles.secondaryNote}>Season {league.season}</span>
      </div>
    </>
  );
}

function DraftingBody({ league }: { league: LeagueCardData }) {
  return (
    <>
      <p className={styles.cardTeam}>Draft in progress — round {league.currentRound} of {league.totalRounds}</p>
      <div className={styles.cardStats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{league.yourPickSlot ? ordinal(league.yourPickSlot) : '—'}</span>
          <span className={styles.statLabel}>Your Pick</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>€{league.faabBudget}m</span>
          <span className={styles.statLabel}>Budget</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{league.managerCount}/{league.maxTeams}</span>
          <span className={styles.statLabel}>Managers</span>
        </div>
      </div>
      <div className={styles.cardFooter}>
        <span className={styles.cardCta}>
          Enter Draft Room <Icon name="chevron-right" size={13} strokeWidth={2.2} />
        </span>
        {league.isMyTurn ? (
          <span className={styles.liveNote}>You&rsquo;re on the clock</span>
        ) : (
          <span className={styles.secondaryNote}>Pick {league.currentPickNumber}</span>
        )}
      </div>
    </>
  );
}

function SetupBody({ league }: { league: LeagueCardData }) {
  const pct = Math.round((league.managerCount / league.maxTeams) * 100);
  return (
    <>
      <p className={styles.cardTeam}>Waiting on managers to join</p>
      <div className={styles.meterWrap}>
        <div className={styles.meterLabels}>
          <span>{league.managerCount} of {league.maxTeams} joined</span>
          <span>{pct}%</span>
        </div>
        <div className={styles.meter} role="img" aria-label={`${league.managerCount} of ${league.maxTeams} managers joined`}>
          <div className={styles.meterFill} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className={styles.cardFooter}>
        <span className={styles.cardCta}>
          {league.isCommissioner ? 'Invite Managers' : 'View Setup'} <Icon name="chevron-right" size={13} strokeWidth={2.2} />
        </span>
        <span className={styles.secondaryNote}>{league.isCommissioner ? 'You’re commissioner' : 'Waiting on commissioner'}</span>
      </div>
    </>
  );
}
