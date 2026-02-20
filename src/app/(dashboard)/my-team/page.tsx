import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import PlayerCard from '@/components/players/PlayerCard';
import type { Player, RosterEntry } from '@/types';
import styles from './my-team.module.css';

export default async function MyTeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Get the first team the user belongs to
  const { data: team } = await admin
    .from('teams')
    .select(
      `
      id, team_name, faab_budget, total_points,
      league:leagues(id, name, season, status, scoring_rules)
    `
    )
    .eq('user_id', user.id)
    .limit(1)
    .single();

  let rosterEntries: (RosterEntry & { player: Player })[] = [];

  if (team) {
    const { data } = await admin
      .from('roster_entries')
      .select(
        `
        id, status, acquisition_type, acquisition_value, acquired_at,
        player:players(*)
      `
      )
      .eq('team_id', team.id)
      .order('status', { ascending: true });

    rosterEntries = (data ?? []) as unknown as (RosterEntry & { player: Player })[];
  }

  const starters = rosterEntries.filter((e) => e.status === 'active');
  const bench = rosterEntries.filter((e) => e.status === 'bench');
  const ir = rosterEntries.filter((e) => e.status === 'ir');

  if (!team) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyIcon}>👕</p>
        <h2 className={styles.emptyTitle}>No team yet</h2>
        <p className={styles.emptyText}>Join or create a league to get started.</p>
        <a href="/dashboard" className={styles.backLink}>
          ← Back to Dashboard
        </a>
      </div>
    );
  }

  return (
    <div>
      <header className={styles.header}>
        <div>
          <p className={styles.leagueName}>{(team.league as any).name}</p>
          <h1 className={styles.teamName}>{team.team_name}</h1>
        </div>
        <div className={styles.headerStats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{team.total_points.toFixed(1)}</span>
            <span className={styles.statLabel}>Total Pts</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>£{team.faab_budget}m</span>
            <span className={styles.statLabel}>FAAB Budget</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>{rosterEntries.length}</span>
            <span className={styles.statLabel}>Players</span>
          </div>
        </div>
      </header>

      <div className={styles.sections}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span className={styles.sectionDot} style={{ background: 'var(--color-accent-green)' }} />
            Starting XI ({starters.length})
          </h2>
          {starters.length > 0 ? (
            <div className={styles.playerList}>
              {starters.map((entry) => (
                <PlayerCard
                  key={entry.id}
                  player={entry.player}
                  rosterEntry={entry}
                />
              ))}
            </div>
          ) : (
            <p className={styles.emptySection}>No starters set. Set your lineup before gameweek locks.</p>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <span className={styles.sectionDot} style={{ background: 'var(--color-text-muted)' }} />
            Bench ({bench.length})
          </h2>
          {bench.length > 0 ? (
            <div className={styles.playerList}>
              {bench.map((entry) => (
                <PlayerCard
                  key={entry.id}
                  player={entry.player}
                  rosterEntry={entry}
                />
              ))}
            </div>
          ) : (
            <p className={styles.emptySection}>Bench is empty.</p>
          )}
        </section>

        {ir.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <span className={styles.sectionDot} style={{ background: 'var(--color-accent-red)' }} />
              Injured Reserve ({ir.length})
            </h2>
            <div className={styles.playerList}>
              {ir.map((entry) => (
                <PlayerCard
                  key={entry.id}
                  player={entry.player}
                  rosterEntry={entry}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
