import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import FinanceClient from './FinanceClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function FinancePage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, season, current_season, faab_budget, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam && league.commissioner_id !== user.id) redirect('/dashboard');

  if (!myTeam) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        You do not have a team in this league.
      </div>
    );
  }

  // Fetch all transactions for this team (no limit — finance page is a ledger)
  const { data: transactions } = await admin
    .from('transactions')
    .select(
      `id, type, faab_bid, compensation_amount, notes, processed_at,
       player:players(id, name, web_name, primary_position, pl_team)`
    )
    .eq('league_id', leagueId)
    .eq('team_id', myTeam.id)
    .order('processed_at', { ascending: false });

  // Starting FAAB for this team: leagues.faab_budget is the starting value
  // We compute net from transactions rather than trusting a static "starting" value
  const startingBudget = league.faab_budget ?? 100;

  return (
    <FinanceClient
      leagueId={leagueId}
      leagueName={league.name}
      season={league.current_season ?? league.season}
      teamName={myTeam.team_name}
      currentBudget={myTeam.faab_budget}
      startingBudget={startingBudget}
      transactions={(transactions ?? []) as any[]}
    />
  );
}
