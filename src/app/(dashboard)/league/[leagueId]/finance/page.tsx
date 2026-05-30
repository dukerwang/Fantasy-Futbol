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

  // Derive starting budget algebraically from the transaction log:
  //   startingBudget = currentBudget + totalSpent - totalEarned
  // This is always correct regardless of the league's stored default, which may be
  // stale for older leagues created before the budget default was updated.
  const txList = transactions ?? [];
  let totalSpent = 0;
  let totalEarned = 0;
  const TX_DIRECTIONS: Record<string, 'in' | 'out' | 'none'> = {
    waiver_claim:          'out',
    free_agent_pickup:     'none',
    drop:                  'out',
    trade:                 'none',
    transfer_out:          'in',
    transfer_compensation: 'in',
    rebate:                'in',
    draft_pick:            'none',
    prize_payout:          'in',
  };
  for (const tx of txList) {
    const dir = TX_DIRECTIONS[tx.type as string];
    const amount = tx.faab_bid != null && tx.faab_bid > 0
      ? tx.faab_bid
      : tx.compensation_amount != null && Number(tx.compensation_amount) > 0
        ? Number(tx.compensation_amount)
        : 0;
    if (amount > 0) {
      if (dir === 'out') totalSpent += amount;
      else if (dir === 'in') totalEarned += amount;
    }
  }
  const startingBudget = myTeam.faab_budget + totalSpent - totalEarned;

  return (
    <FinanceClient
      leagueId={leagueId}
      leagueName={league.name}
      season={league.current_season ?? league.season}
      teamName={myTeam.team_name}
      currentBudget={myTeam.faab_budget}
      startingBudget={startingBudget}
      transactions={txList as any[]}
    />
  );
}
