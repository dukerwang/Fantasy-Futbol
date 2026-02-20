import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import PlayerCard from '@/components/players/PlayerCard';
import type { Player } from '@/types';
import styles from './transfers.module.css';

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pos?: string }>;
}) {
  const { q, pos } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Build query for free-agent players (not on any team's roster in the user's leagues)
  let query = admin
    .from('players')
    .select('*')
    .eq('is_active', true)
    .order('market_value', { ascending: false })
    .limit(50);

  if (q) {
    query = query.ilike('name', `%${q}%`);
  }

  if (pos) {
    query = query.or(`primary_position.eq.${pos},secondary_positions.cs.{${pos}}`);
  }

  const { data: players } = await query;

  const positions = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Transfer Market</h1>
          <p className={styles.subtitle}>Browse available players and make your moves</p>
        </div>
      </header>

      {/* Filters */}
      <div className={styles.filters}>
        <form method="get" className={styles.filterForm}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search player name…"
            className={styles.searchInput}
          />
          <div className={styles.posFilters}>
            <a href="/transfers" className={`${styles.posFilter} ${!pos ? styles.posFilterActive : ''}`}>
              All
            </a>
            {positions.map((p) => (
              <a
                key={p}
                href={`/transfers?pos=${p}${q ? `&q=${q}` : ''}`}
                className={`${styles.posFilter} ${pos === p ? styles.posFilterActive : ''}`}
              >
                {p}
              </a>
            ))}
          </div>
          <button type="submit" className={styles.searchBtn}>
            Search
          </button>
        </form>
      </div>

      {/* Results */}
      <section>
        <p className={styles.resultCount}>
          {players?.length ?? 0} player{players?.length !== 1 ? 's' : ''} found
        </p>
        <div className={styles.playerList}>
          {(players ?? []).map((player: Player) => (
            <PlayerCard key={player.id} player={player} />
          ))}
          {(!players || players.length === 0) && (
            <p className={styles.empty}>No players found. Try adjusting your search.</p>
          )}
        </div>
      </section>
    </div>
  );
}
