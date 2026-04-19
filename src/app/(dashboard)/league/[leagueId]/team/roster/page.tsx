import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import RosterTable from './RosterTable';
import styles from './roster.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function RosterPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: team } = await admin
    .from('teams')
    .select(`
      id, team_name, faab_budget, league_id,
      league:leagues(id, name, season, status, roster_size, taxi_size, taxi_age_limit)
    `)
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!team) {
    return (
      <div className={styles.empty}>
        <h2>No team found</h2>
        <Link href="/dashboard">← Back to Dashboard</Link>
      </div>
    );
  }

  const { data: rosterRaw } = await admin
    .from('roster_entries')
    .select(`
      id, team_id, player_id, status, acquisition_type, acquisition_value, acquired_at, on_trade_block,
      player:players(${FULL_PLAYER_SELECT})
    `)
    .eq('team_id', team.id)
    .order('status', { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rosterData = (rosterRaw ?? []) as any[];

  const league = team.league as any;
  const taxiAgeLimit: number = league?.taxi_age_limit ?? 21;
  const taxiSize: number = league?.taxi_size ?? 3;

  // Compute taxi eligibility cutoff year client-side (matches server constant SEASON_START_YEAR=2025)
  const SEASON_START_YEAR = 2025;
  const taxiAgeCutoffYear = SEASON_START_YEAR - taxiAgeLimit;

  const currentTaxiCount = rosterData.filter((e) => e.status === 'taxi').length;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <Link href={`/league/${leagueId}/team`} className={styles.backLink}>
            ← My Team
          </Link>
          <h1 className={styles.pageTitle}>Roster Management</h1>
          <p className={styles.pageSub}>{team.team_name} · {(rosterData ?? []).length} players</p>
        </div>
        <div className={styles.headerMeta}>
          <div className={styles.metaStat}>
            <span className={styles.metaValue}>£{team.faab_budget}m</span>
            <span className={styles.metaLabel}>FAAB Budget</span>
          </div>
          <div className={styles.metaDivider} />
          <div className={styles.metaStat}>
            <span className={styles.metaValue}>{currentTaxiCount}/{taxiSize}</span>
            <span className={styles.metaLabel}>Taxi Slots</span>
          </div>
        </div>
      </div>

      <RosterTable
        teamId={team.id}
        leagueId={leagueId}
        rosterEntries={rosterData}
        taxiAgeCutoffYear={taxiAgeCutoffYear}
        taxiSize={taxiSize}
      />
    </div>
  );
}
