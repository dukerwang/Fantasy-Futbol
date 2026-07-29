// Run with: node --env-file=.env.local scratch/check_transfers_queries.js
//
// READ ONLY. Executes every select buildTransfersModel and the free-agents route
// issue, against a real league, to prove the column names exist. tsc cannot
// catch these — the Supabase client is untyped here, so a wrong column is a
// runtime 500, not a compile error.

const { createClient } = require('@supabase/supabase-js');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const FULL_PLAYER_SELECT = `
  id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality,
  pl_team, pl_team_id, primary_position, secondary_positions, market_value,
  market_value_updated_at, projected_points, photo_url, height_cm, fpl_status,
  fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id,
  created_at, updated_at
`;

let failures = 0;
async function check(label, thunk) {
  const { error, data } = await thunk();
  if (error) {
    failures++;
    console.log(`  FAIL  ${label}\n          ${error.message}`);
  } else {
    console.log(`  ok    ${label}  (${Array.isArray(data) ? data.length + ' rows' : '1 row'})`);
  }
  return data;
}

async function main() {
  // Pick the league with the most going on.
  const { data: leagues } = await db.from('leagues').select('id, name');
  const { data: someTeam } = await db.from('teams').select('id, league_id, user_id').limit(1).single();
  const leagueId = someTeam.league_id;
  const teamId = someTeam.id;
  console.log(`Testing against league: ${leagues.find(l => l.id === leagueId)?.name} (${leagueId})\n`);

  console.log('buildTransfersModel:');
  await check('leagues (settings)', () => db.from('leagues')
    .select(`id, name, roster_size, taxi_size, taxi_age_limit, status, roster_locked,
             total_gameweeks, current_season, previous_season, loan_slot_buyback_fee,
             loan_bonus_cap_default, max_loan_outs, max_loan_ins`)
    .eq('id', leagueId).single());

  await check('teams', () => db.from('teams')
    .select('id, team_name, faab_budget').eq('league_id', leagueId));

  await check('auction_state (live)', () => db.from('auction_state')
    .select('*').eq('league_id', leagueId).eq('status', 'live')
    .order('expires_at', { ascending: true, nullsFirst: false }));

  await check('waiver_claims (my bids)', () => db.from('waiver_claims')
    .select('player_id, faab_bid, drop_player_id')
    .eq('league_id', leagueId).eq('team_id', teamId)
    .eq('status', 'pending').eq('is_auction', true));

  await check('player_sale_listings (gates)', () => db.from('player_sale_listings')
    .select(`id, seller_team_id, player_id, min_bid, ask_price, buy_now_price,
             open_to_trade, open_to_sale, status, auction_expires_at, created_at, updated_at`)
    .eq('league_id', leagueId).in('status', ['pending', 'active']));

  await check('roster_entries + player', () => db.from('roster_entries')
    .select(`team_id, status, player:players(${FULL_PLAYER_SELECT})`)
    .eq('team_id', teamId));

  await check('trade_proposals (offers)', () => db.from('trade_proposals')
    .select(`id, team_a_id, team_b_id, offered_players, requested_players,
             offered_faab, requested_faab, offered_rights, requested_rights,
             sale_listing_id, status, message, created_at, updated_at,
             team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
             team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)`)
    .eq('league_id', leagueId).or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`));

  await check('player_loans + teams + player', () => db.from('player_loans')
    .select(`*,
             lender_team:teams!lender_team_id(id, team_name, user_id),
             borrower_team:teams!borrower_team_id(id, team_name, user_id),
             player:players(${FULL_PLAYER_SELECT})`)
    .eq('league_id', leagueId));

  await check('season_standings_archive', () => db.from('season_standings_archive')
    .select('team_id, final_rank').eq('league_id', leagueId).eq('season', '2025-26'));

  await check('player_rankings (view)', () => db.from('player_rankings').select('*').limit(5));

  await check('season_player_stats_archive', () => db.from('season_player_stats_archive')
    .select('player_id, total_points, ppg, form_rating, overall_rank, position_ranks')
    .eq('season', '2025-26').limit(5));

  await check('player_stats (effective ppg)', () => db.from('player_stats')
    .select('player_id, fantasy_points, gameweek, stats, season')
    .in('season', ['2025-26', '2024-25']).limit(5));

  console.log('\nfree-agents route:');
  await check('players filtered + ilike', () => db.from('players')
    .select(FULL_PLAYER_SELECT).eq('is_active', true)
    .or('name.ilike.%sa%,web_name.ilike.%sa%,full_name.ilike.%sa%').limit(5));

  await check('auction_state player_ids', () => db.from('auction_state')
    .select('player_id').eq('league_id', leagueId).eq('status', 'live'));

  console.log(failures === 0
    ? '\nAll selects valid.\n'
    : `\n${failures} SELECT(S) FAILED — fix before wiring the UI.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
