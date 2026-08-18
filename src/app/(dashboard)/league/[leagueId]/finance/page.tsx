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
      <div
        style={{
          padding: 'var(--s16) var(--s8)',
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--t-13)',
          color: 'var(--color-text-muted)',
        }}
      >
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

  // 'in' / 'out' drive this club's own spent-vs-earned totals.
  // Five types were previously absent from this map — sale_proceeds, loan_fee,
  // loan_bonus, loan_recall_penalty and loan_slot_buyback — so they resolved to
  // undefined and were silently counted as neither.
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
    merit_payment:         'in',
    solidarity_payment:    'in',
    sale_proceeds:         'in',
    loan_fee:              'in',
    loan_bonus:            'out',
    loan_recall_penalty:   'out',
    loan_slot_buyback:     'out',
  };

  // Whether a movement changes the league's TOTAL money supply, as opposed to
  // moving it between clubs. This is the readout that tells you whether the
  // economy is inflating: if 'created' consistently exceeds 'destroyed',
  // balances drift upward every season and money loses meaning.
  //
  // Note this is per-club data, so it is one club's share of league-wide
  // creation, not the league total. Trades, sales, loan fees and solidarity
  // payments are all transfers between clubs, so none of them are counted.
  const TX_SUPPLY: Record<string, 'created' | 'destroyed' | 'neutral'> = {
    prize_payout:          'created',
    merit_payment:         'created',
    transfer_out:          'created',
    transfer_compensation: 'created',
    rebate:                'created',
    waiver_claim:          'destroyed',
    drop:                  'destroyed',
    loan_slot_buyback:     'destroyed',
  };

  let netCreated = 0;
  let netDestroyed = 0;

  for (const tx of txList) {
    const amount = tx.faab_bid != null && tx.faab_bid > 0
      ? tx.faab_bid
      : tx.compensation_amount != null && Number(tx.compensation_amount) > 0
        ? Number(tx.compensation_amount)
        : 0;
    if (amount <= 0) continue;

    const dir = TX_DIRECTIONS[tx.type as string];
    if (dir === 'out') totalSpent += amount;
    else if (dir === 'in') totalEarned += amount;

    const supply = TX_SUPPLY[tx.type as string] ?? 'neutral';
    if (supply === 'created') netCreated += amount;
    else if (supply === 'destroyed') netDestroyed += amount;
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
      netCreated={netCreated}
      netDestroyed={netDestroyed}
      transactions={txList as any[]}
    />
  );
}
