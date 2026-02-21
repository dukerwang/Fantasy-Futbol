import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import PlayerCard from '@/components/players/PlayerCard';
import TeamSwitcher from '@/components/teams/TeamSwitcher';
import type { TeamOption } from '@/components/teams/TeamSwitcher';
import type { Player, RosterEntry, Formation, GranularPosition, MatchupLineup } from '@/types';
import { FORMATION_SLOTS, POSITION_FLEX_MAP } from '@/types';
import LineupEditor from './LineupEditor';
import MyTeamClient from './MyTeamClient';
import styles from './my-team.module.css';

interface Props {
  searchParams: Promise<{ teamId?: string; mode?: string }>;
}

export default async function MyTeamPage({ searchParams }: Props) {
  const { teamId: requestedTeamId, mode } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Fetch all teams the user belongs to (for the switcher)
  const { data: allTeams } = await admin
    .from('teams')
    .select(
      `
      id, team_name,
      league:leagues(id, name)
    `
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  const teamOptions: TeamOption[] = (allTeams ?? []).map((t: any) => ({
    id: t.id,
    team_name: t.team_name,
    league_name: t.league?.name ?? 'Unknown League',
  }));

  if (teamOptions.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyIcon}>&#128085;</p>
        <h2 className={styles.emptyTitle}>No team yet</h2>
        <p className={styles.emptyText}>Join or create a league to get started.</p>
        <a href="/dashboard" className={styles.backLink}>
          &larr; Back to Dashboard
        </a>
      </div>
    );
  }

  // Determine which team to display
  let activeTeamId = teamOptions[0].id;
  if (requestedTeamId) {
    const match = teamOptions.find((t) => t.id === requestedTeamId);
    if (match) activeTeamId = match.id;
  }

  // Fetch full team data
  const { data: team } = await admin
    .from('teams')
    .select(
      `
      id, team_name, faab_budget, total_points, league_id,
      league:leagues(id, name, season, status, scoring_rules, bench_size)
    `
    )
    .eq('id', activeTeamId)
    .single();

  if (!team) {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>Team not found</h2>
        <a href="/dashboard" className={styles.backLink}>
          &larr; Back to Dashboard
        </a>
      </div>
    );
  }

  // Fetch roster entries with player data
  const { data: rosterData } = await admin
    .from('roster_entries')
    .select(
      `
      id, team_id, player_id, status, acquisition_type, acquisition_value, acquired_at,
      player:players(*)
    `
    )
    .eq('team_id', team.id)
    .order('status', { ascending: true });

  const rosterEntries = (rosterData ?? []) as unknown as (RosterEntry & { player: Player })[];
  const starters = rosterEntries.filter((e) => e.status === 'active');
  const bench = rosterEntries.filter((e) => e.status === 'bench');
  const ir = rosterEntries.filter((e) => e.status === 'ir');
  const nonIrEntries = rosterEntries.filter((e) => e.status !== 'ir');

  const isEditMode = mode === 'edit';

  // For edit mode: determine initial formation and assignments from upcoming matchup lineup
  let initialFormation: Formation = '4-3-3';
  let initialAssignments: Record<number, string> = {};

  if (isEditMode) {
    // Try to load existing lineup from next scheduled matchup
    const { data: matchup } = await admin
      .from('matchups')
      .select('id, team_a_id, team_b_id, lineup_a, lineup_b')
      .eq('status', 'scheduled')
      .or(`team_a_id.eq.${team.id},team_b_id.eq.${team.id}`)
      .order('gameweek', { ascending: true })
      .limit(1)
      .single();

    if (matchup) {
      const isTeamA = (matchup as any).team_a_id === team.id;
      const existingLineup = (isTeamA ? matchup.lineup_a : matchup.lineup_b) as MatchupLineup | null;

      if (existingLineup) {
        initialFormation = existingLineup.formation;
        const slots = FORMATION_SLOTS[existingLineup.formation];
        for (let i = 0; i < slots.length; i++) {
          const starter = existingLineup.starters[i];
          if (starter) {
            initialAssignments[i] = starter.player_id;
          }
        }
      }
    }

    // If no existing lineup, auto-assign starters based on current roster statuses
    if (Object.keys(initialAssignments).length === 0 && starters.length > 0) {
      const slots = FORMATION_SLOTS[initialFormation];
      const used = new Set<string>();

      for (let i = 0; i < slots.length; i++) {
        const slotPos = slots[i];
        const allowed = POSITION_FLEX_MAP[slotPos];
        const candidate = starters.find((e) => {
          if (used.has(e.player.id)) return false;
          const positions: GranularPosition[] = [
            e.player.primary_position,
            ...(e.player.secondary_positions ?? []),
          ];
          return positions.some((p) => allowed.includes(p));
        });
        if (candidate) {
          initialAssignments[i] = candidate.player.id;
          used.add(candidate.player.id);
        }
      }
    }
  }

  return (
    <div>
      <header className={styles.header}>
        <div>
          <div className={styles.headerTop}>
            <p className={styles.leagueName}>{(team.league as any).name}</p>
            {teamOptions.length > 1 && (
              <TeamSwitcher teams={teamOptions} activeTeamId={activeTeamId} />
            )}
          </div>
          <h1 className={styles.teamName}>{team.team_name}</h1>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.headerStats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{Number(team.total_points).toFixed(1)}</span>
              <span className={styles.statLabel}>Total Pts</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>&pound;{team.faab_budget}m</span>
              <span className={styles.statLabel}>FAAB Budget</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>{rosterEntries.length}</span>
              <span className={styles.statLabel}>Players</span>
            </div>
          </div>
          <MyTeamClient
            teamId={activeTeamId}
            isEditMode={isEditMode}
          />
        </div>
      </header>

      {isEditMode ? (
        <LineupEditor
          teamId={team.id}
          allEntries={nonIrEntries}
          irEntries={ir}
          initialFormation={initialFormation}
          initialAssignments={initialAssignments}
          benchSize={(team.league as any).bench_size ?? 4}
        />
      ) : (
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
      )}
    </div>
  );
}
