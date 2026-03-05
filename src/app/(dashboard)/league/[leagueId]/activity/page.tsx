import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import styles from './activity.module.css';

interface Props {
  params: Promise<{ leagueId: string }>;
}

type TxColor = 'green' | 'red' | 'blue' | 'purple' | 'amber' | 'gray';

const TYPE_CONFIG: Record<string, { label: string; color: TxColor; icon: string }> = {
  waiver_claim:            { label: 'Auction Win',            color: 'green',  icon: '🏆' },
  free_agent_pickup:       { label: 'Free Agent Pickup',      color: 'blue',   icon: '✋' },
  drop:                    { label: 'Drop',                   color: 'red',    icon: '❌' },
  transfer_out:            { label: 'Transferred Out',        color: 'red',    icon: '✈️' },
  trade:                   { label: 'Trade',                  color: 'blue',   icon: '🔄' },
  transfer_compensation:   { label: 'Transfer Compensation',  color: 'purple', icon: '💰' },
  draft_pick:              { label: 'Draft Pick',             color: 'gray',   icon: '📋' },
  rebate:                  { label: "Scout's Rebate",         color: 'amber',  icon: '💸' },
};

export default async function ActivityPage({ params }: Props) {
  const { leagueId } = await params;

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Verify league exists
  const { data: league } = await admin
    .from('leagues')
    .select('name, commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Verify membership
  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // Fetch 50 most recent transactions
  const { data: transactions } = await admin
    .from('transactions')
    .select(`
      id,
      type,
      faab_bid,
      compensation_amount,
      notes,
      processed_at,
      team:teams(team_name),
      player:players(name, web_name, primary_position)
    `)
    .eq('league_id', leagueId)
    .order('processed_at', { ascending: false })
    .limit(50);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.breadcrumb}>
          <Link href={`/league/${leagueId}`}>{league.name}</Link> / Activity
        </p>
        <h1 className={styles.title}>League Activity</h1>
        <p className={styles.subtitle}>50 most recent transactions across the league</p>
      </header>

      {!transactions || transactions.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No transactions recorded yet.</p>
        </div>
      ) : (
        <div className={styles.timeline}>
          {transactions.map((tx) => {
            const cfg = TYPE_CONFIG[tx.type] ?? { label: tx.type, color: 'gray' as TxColor, icon: '•' };
            const team = tx.team as unknown as { team_name: string } | null;
            const player = tx.player as unknown as { name: string; web_name?: string | null; primary_position: string } | null;
            const date = new Date(tx.processed_at);
            const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            return (
              <div key={tx.id} className={`${styles.txRow} ${styles[`color_${cfg.color}`]}`}>
                <div className={styles.txDot} />
                <div className={styles.txBody}>
                  <div className={styles.txTop}>
                    <span className={`${styles.txBadge} ${styles[`badge_${cfg.color}`]}`}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span className={styles.txDate}>{dateStr} · {timeStr}</span>
                  </div>
                  <p className={styles.txDesc}>
                    {team?.team_name && <strong>{team.team_name}</strong>}
                    {tx.notes ? ` — ${tx.notes}` : player ? ` — ${player.web_name ?? player.name}` : ''}
                  </p>
                  {tx.faab_bid != null && (
                    <span className={styles.txFaab}>FAAB: £{tx.faab_bid}m</span>
                  )}
                  {tx.compensation_amount != null && Number(tx.compensation_amount) > 0 && (
                    <span className={styles.txFaab}>Amount: £{Number(tx.compensation_amount)}m</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
