import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import type { Player, RosterStatus } from '@/types';
import RosterTable from './RosterTable';
import { Icon } from '@/components/ui/Icon';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
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

  // Fetch all player rankings for mapping
  const { data: rankings } = await admin.from('player_rankings').select('*');
  const rankMap = new Map((rankings ?? []).map((r: { player_id: string; overall_rank?: number; position_ranks?: string }) => [r.player_id, r]));

  // Fetch active listings for this league to inject listing state into roster entries
  const { data: listings } = await admin
    .from('player_sale_listings')
    .select('id, player_id, status, min_bid, buy_now_price')
    .eq('league_id', leagueId)
    .in('status', ['pending', 'active']);

  const listingsMap = new Map((listings ?? []).map((l: any) => [l.player_id, l]));

  const season = (team.league as any).season ?? await getCurrentFplSeason();

  const [{ data: rosterRaw }, { data: archives }] = await Promise.all([
    admin
      .from('roster_entries')
      .select(`
        id, team_id, player_id, status, acquisition_type, acquisition_value, acquired_at, on_trade_block,
        player:players(${FULL_PLAYER_SELECT})
      `)
      .eq('team_id', team.id)
      .order('status', { ascending: true }),
    admin
      .from('season_player_stats_archive')
      .select('player_id, ppg, form_rating')
      .eq('season', season)
  ]);

  const archiveMap = new Map((archives ?? []).map((a: any) => [a.player_id, a]));

  const { data: pendingDrops } = await admin
    .from('pending_drops')
    .select('player_id')
    .eq('team_id', team.id);

  const pendingDropPlayerIds = new Set((pendingDrops ?? []).map((d: { player_id: string }) => d.player_id));

  const rosterData = (rosterRaw as unknown as {
    id: string;
    team_id: string;
    player_id: string;
    status: RosterStatus;
    acquisition_type: 'draft' | 'waiver' | 'free_agent' | 'trade';
    acquisition_value: number | null;
    acquired_at: string;
    on_trade_block: boolean;
    player: Player;
    is_pending_drop?: boolean;
  }[] ?? []).map((e) => {
    const player = e.player;
    if (player) {
      const ranks = rankMap.get(player.id);
      const arch = archiveMap.get(player.id);
      player.overall_rank = ranks?.overall_rank;
      player.position_ranks = ranks?.position_ranks as unknown as { position: string; rank: number; }[] | null | undefined;
      player.ppg = arch ? Number(arch.ppg) : player.ppg;
      player.form_rating = arch ? Number(arch.form_rating) : player.form_rating;
    }
    e.is_pending_drop = pendingDropPlayerIds.has(e.player_id);
    (e as any).listing = listingsMap.get(e.player_id) ?? null;
    return e;
  });

  const league = team.league as { taxi_age_limit?: number; taxi_size?: number; roster_size?: number } | null;
  const taxiAgeLimit: number = league?.taxi_age_limit ?? 21;
  const taxiSize: number = league?.taxi_size ?? 3;
  const maxRosterSize: number = league?.roster_size ?? 20;

  const currentTaxiCount = rosterData.filter((e) => e.status === 'taxi').length;
  const loanInCount = rosterData.filter((e) => e.status === 'loan_in').length;
  const activeRosterCount = rosterData.filter((e) => e.status !== 'ir' && e.status !== 'taxi' && e.status !== 'loan_in').length;

  const { data: pendingActivations } = await admin
    .from('player_loans')
    .select('id, player:players(name)')
    .eq('lender_team_id', team.id)
    .eq('status', 'pending_activation');

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <Link href={`/league/${leagueId}/team`} className={styles.backLink}>
            ← My Team
          </Link>
          <h1 className={styles.pageTitle}>Roster Management</h1>
          <p className={styles.pageSub}>
            {team.team_name} · {activeRosterCount} active
            {loanInCount > 0 && ` (+${loanInCount} loan${loanInCount > 1 ? 's' : ''})`} / {maxRosterSize} limit
          </p>
        </div>
        <div className={styles.headerMeta}>
          <div className={styles.metaStat}>
            <span className={styles.metaValue}>€{team.faab_budget}m</span>
            <span className={styles.metaLabel}>Club Balance</span>
          </div>
          <div className={styles.metaDivider} />
          <div className={styles.metaStat}>
            <span className={styles.metaValue}>{activeRosterCount}/{maxRosterSize}</span>
            <span className={styles.metaLabel}>Active Roster</span>
          </div>
          <div className={styles.metaDivider} />
          <div className={styles.metaStat}>
            <span className={styles.metaValue}>{currentTaxiCount}/{taxiSize}</span>
            <span className={styles.metaLabel}>Academy Slots</span>
          </div>
        </div>
      </div>

      {pendingActivations && pendingActivations.length > 0 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '4px',
          padding: '12px 16px',
          marginBottom: '20px',
          color: '#ef4444',
          fontSize: '14px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span style={{ display: 'flex', alignItems: 'center' }}><Icon name="alert" size={16} /></span>
          <span>
            Roster Over Capacity. Drop a player to activate returned loan: {pendingActivations.map(p => (p.player as any)?.name).join(', ')}.
          </span>
        </div>
      )}

      <RosterTable
        teamId={team.id}
        leagueId={leagueId}
        rosterEntries={rosterData}
        taxiAgeLimit={taxiAgeLimit}
        taxiSize={taxiSize}
      />
    </div>
  );
}
