import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound, redirect } from 'next/navigation';
import TradesClient from './TradesClient';
import { getCurrentFplSeason, isFplSeasonKickedOff } from '@/lib/season/currentSeason';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { buildEffectivePpgMap } from '@/lib/transfers/effectivePpg';

interface Props {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<Record<string, string>>;
}

export default async function TradesPage({ params, searchParams }: Props) {
  const { leagueId } = await params;
  const { tab: tabParam } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // ── Wave 1 ────────────────────────────────────────────────────────────────
  // Nothing here depends on anything else on this page. It used to run as ten
  // sequential awaits; the page waited for the sum of them.
  const [
    { data: league },
    { data: myTeam },
    { data: leagueTeams },
    { data: listings },
    { data: leagueTrades },
    { data: loans },
    currentFpl,
    kickedOff,
    currentGameweek,
  ] = await Promise.all([
    admin
      .from('leagues')
      .select('id, name, roster_size, status, loan_slot_buyback_fee, loan_bonus_cap_default, max_loan_outs, max_loan_ins, total_gameweeks, roster_locked, current_season, previous_season')
      .eq('id', leagueId)
      .single(),
    admin
      .from('teams')
      .select('id, team_name, faab_budget')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .maybeSingle(),
    // Fetched once for the whole league. `allTeams` (everyone but me) and
    // `allTeamsIncludingMine` were two queries returning overlapping rows.
    admin.from('teams').select('id, team_name, faab_budget').eq('league_id', leagueId),
    admin
      .from('player_sale_listings')
      .select(`
      id, seller_team_id, player_id, min_bid, buy_now_price, status,
      auction_expires_at, created_at,
      seller_team:teams!seller_team_id(id, team_name),
      player:players(${FULL_PLAYER_SELECT})
    `)
      .eq('league_id', leagueId)
      .in('status', ['pending', 'active'])
      .order('created_at', { ascending: false }),
    admin
      .from('trade_proposals')
      .select(`
      id, team_a_id, team_b_id,
      offered_players, requested_players, offered_faab, requested_faab,
      status, message, created_at, updated_at,
      team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
      team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)
    `)
      .eq('league_id', leagueId)
      .eq('status', 'accepted')
      .order('updated_at', { ascending: false })
      .limit(20),
    admin
      .from('player_loans')
      .select(`
      *,
      lender_team:teams!lender_team_id(id, team_name, user_id),
      borrower_team:teams!borrower_team_id(id, team_name, user_id),
      player:players(${FULL_PLAYER_SELECT})
    `)
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false }),
    getCurrentFplSeason(),
    isFplSeasonKickedOff(),
    resolveCurrentGameweek(),
  ]);

  if (!league) notFound();
  if (!myTeam) redirect('/dashboard');

  const allTeamsIncludingMine = leagueTeams ?? [];
  const allTeams = allTeamsIncludingMine.filter((t) => t.id !== myTeam.id);

  let currentSeason = league.current_season || currentFpl;
  if (currentSeason === currentFpl && !kickedOff) {
    currentSeason = league.previous_season || currentSeason;
  }
  const previousSeason = league.previous_season || '2024-25';

  // ── Wave 2 ────────────────────────────────────────────────────────────────
  // Needs an id from wave 1, nothing more.
  const allTeamIds = allTeams.map((t) => t.id);
  const rosterTeamIds = [...allTeamIds, myTeam.id];
  const listingIds = (listings ?? []).filter((l) => l.status === 'active').map((l) => l.id);

  const [{ data: trades }, { data: rosterRows }, { data: claims }] = await Promise.all([
    admin
      .from('trade_proposals')
      .select(`
      *,
      team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
      team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)
    `)
      .eq('league_id', leagueId)
      .or(`team_a_id.eq.${myTeam.id},team_b_id.eq.${myTeam.id}`)
      .order('created_at', { ascending: false }),
    // One roster read for the whole league, split by team_id below. This was
    // two queries against the same table — every other team, then mine.
    admin
      .from('roster_entries')
      .select(`team_id, status, on_trade_block, player:players(${FULL_PLAYER_SELECT})`)
      .in('team_id', rosterTeamIds),
    listingIds.length > 0
      ? admin
          .from('waiver_claims')
          .select('sale_listing_id, faab_bid')
          .in('sale_listing_id', listingIds)
          .eq('status', 'pending')
          .eq('is_auction', true)
          .order('faab_bid', { ascending: false })
      : Promise.resolve({ data: [] as { sale_listing_id: string; faab_bid: number }[] }),
  ]);

  const highestBids: Record<string, number> = {};
  for (const c of claims ?? []) {
    if (c.sale_listing_id && !(c.sale_listing_id in highestBids)) {
      highestBids[c.sale_listing_id] = c.faab_bid;
    }
  }

  const playerListingsMap: Record<string, any> = {};
  for (const l of listings ?? []) {
    playerListingsMap[l.player_id] = l;
  }

  const allRosters: Record<string, any[]> = {};
  const entries = (rosterRows ?? []).filter((e: any) => e.team_id !== myTeam.id);
  const myRosterEntries = (rosterRows ?? []).filter((e: any) => e.team_id === myTeam.id);

  // ── Wave 3 ────────────────────────────────────────────────────────────────
  const playerIds = new Set<string>();
  const playerMarketValueMap: Record<string, number> = {};
  for (const e of [...entries, ...myRosterEntries]) {
    const p = (e as any).player;
    if (p?.id) {
      playerIds.add(p.id);
      playerMarketValueMap[p.id] = Number(p.market_value) || 0;
    }
  }

  const allPlayerIds = new Set<string>();
  for (const t of [...(trades ?? []), ...(leagueTrades ?? [])]) {
    ((t as any).offered_players ?? []).forEach((id: string) => allPlayerIds.add(id));
    ((t as any).requested_players ?? []).forEach((id: string) => allPlayerIds.add(id));
  }

  // Every id whose rank/archive row this page merges in: roster players, the
  // players named in trade proposals, and the loan players. Scoped, rather
  // than reading the whole rankings view for a couple of hundred rows.
  const enrichIds = new Set<string>([...playerIds, ...allPlayerIds]);
  for (const l of loans ?? []) {
    const pid = (l as any).player?.id;
    if (pid) enrichIds.add(pid);
  }

  const [recentPpgMap, { data: proposalPlayers }, { data: rankings }, { data: archives }] =
    await Promise.all([
      buildEffectivePpgMap(
        admin,
        Array.from(playerIds),
        currentSeason,
        previousSeason,
        playerMarketValueMap,
      ),
      allPlayerIds.size > 0
        ? admin.from('players').select(FULL_PLAYER_SELECT).in('id', Array.from(allPlayerIds))
        : Promise.resolve({ data: [] as any[] }),
      enrichIds.size > 0
        ? admin.from('player_rankings').select('*').in('player_id', Array.from(enrichIds))
        : Promise.resolve({ data: [] as any[] }),
      enrichIds.size > 0
        ? admin
            .from('season_player_stats_archive')
            .select('player_id, ppg, form_rating, overall_rank, position_ranks')
            .eq('season', currentSeason)
            .in('player_id', Array.from(enrichIds))
        : Promise.resolve({ data: [] as any[] }),
    ]);

  const playerMap: Record<string, any> = {};
  for (const p of proposalPlayers ?? []) {
    playerMap[(p as any).id] = p;
  }

  // Populate allRosters with recent_ppg
  for (const e of entries) {
    if (!allRosters[e.team_id]) allRosters[e.team_id] = [];
    const p = e.player as any;
    if (p) {
      allRosters[e.team_id].push({
        ...p,
        status: e.status,
        recent_ppg: recentPpgMap[p.id] ?? Math.max(3.0, p.ppg ?? 3.0),
        on_trade_block: e.on_trade_block,
        listing: playerListingsMap[p.id] ?? null
      });
    }
  }

  const myRoster = (myRosterEntries ?? []).map((e: any) => {
    const p = e.player as any;
    if (!p) return null;
    return {
      ...p,
      status: e.status,
      recent_ppg: recentPpgMap[p.id] ?? Math.max(3.0, p.ppg ?? 3.0),
      on_trade_block: e.on_trade_block,
      listing: playerListingsMap[p.id] ?? null
    };
  }).filter(Boolean);

  const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));
  const archiveMap = new Map((archives ?? []).map((a: any) => [a.player_id, a]));

  const mergePlayerSeasonStats = (p: any) => {
    if (!p) return;
    const r = rankMap.get(p.id);
    const arch = archiveMap.get(p.id);
    p.overall_rank = arch ? arch.overall_rank : r?.overall_rank;
    p.position_ranks = arch ? arch.position_ranks : r?.position_ranks;
    p.ppg = arch ? Number(arch.ppg) : p.ppg;
    p.form_rating = arch ? Number(arch.form_rating) : p.form_rating;
  };

  // Inject rank and stats into myRoster
  for (const player of myRoster) {
    mergePlayerSeasonStats(player);
  }

  // Inject rank and stats into allRosters
  for (const teamId in allRosters) {
    for (const player of allRosters[teamId]) {
      mergePlayerSeasonStats(player);
    }
  }

  // Inject rank and stats into playerMap
  for (const pid in playerMap) {
    mergePlayerSeasonStats(playerMap[pid]);
  }

  for (const l of (loans ?? []) as any[]) {
    if (l.player) {
      mergePlayerSeasonStats(l.player);
      l.player.recent_ppg = recentPpgMap[l.player.id] ?? Math.max(3.0, l.player.ppg ?? 3.0);
    }
  }

  // Determine initial tab from searchParam
  const VALID_TABS = ['trades', 'league-feed', 'listings', 'loans'] as const;
  type ValidTab = typeof VALID_TABS[number];
  const initialTab: ValidTab = VALID_TABS.includes(tabParam as ValidTab) ? (tabParam as ValidTab) : 'league-feed';

  return (
    <TradesClient
      leagueId={leagueId}
      leagueName={league.name}
      myTeam={myTeam}
      myRoster={myRoster}
      allTeams={allTeams ?? []}
      allTeamsIncludingMine={allTeamsIncludingMine ?? []}
      allRosters={allRosters}
      initialTrades={trades ?? []}
      leagueTrades={(leagueTrades ?? []) as unknown as any[]}
      initialPlayerMap={playerMap}
      initialListings={listings ?? []}
      listingHighestBids={highestBids}
      initialLoans={loans ?? []}
      currentGameweek={currentGameweek}
      initialTab={initialTab}
      leagueSettings={{
        loan_slot_buyback_fee: league.loan_slot_buyback_fee ?? 25,
        loan_bonus_cap_default: league.loan_bonus_cap_default ?? 0,
        max_loan_outs: league.max_loan_outs ?? 1,
        max_loan_ins: league.max_loan_ins ?? 2,
        total_gameweeks: league.total_gameweeks ?? 38,
        roster_locked: league.roster_locked ?? false
      }}
    />
  );
}

/**
 * The latest gameweek whose deadline has passed, for the loan modal's GW
 * pickers. Hoisted out of the page body so it can join wave 1's Promise.all
 * rather than blocking behind every database read before it.
 */
async function resolveCurrentGameweek(): Promise<number> {
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return 1;
    const data = await res.json();
    const now = new Date();
    let gw = 1;
    for (const ev of data.events as { id: number; deadline_time: string }[]) {
      if (ev.deadline_time && new Date(ev.deadline_time) <= now) gw = Math.max(gw, ev.id);
    }
    return gw;
  } catch {
    return 1; // Silently fall back to GW1.
  }
}
