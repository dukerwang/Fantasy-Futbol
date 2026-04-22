const fs = require('fs');
const path = './src/app/(dashboard)/league/[leagueId]/page.tsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Update Promise.all to fetch taxi and tournaments
const promiseAllMatch = code.match(/const \[\s*standingsResult,[\s\S]*?\] = await Promise\.all\(\[[\s\S]*?\n  \]\);/);
if (!promiseAllMatch) {
  console.log("Could not find Promise.all");
  process.exit(1);
}

const newPromiseAll = `const [
    standingsResult,
    myMatchupsResult,
    auctionsResult,
    teamsResult,
    activityResult,
    taxiResult,
    tournamentsResult,
  ] = await Promise.all([
    // Full standings
    admin
      .from('league_standings')
      .select('team_id, team_name, rank, league_points, wins, draws, losses, played')
      .eq('league_id', leagueId)
      .order('rank', { ascending: true }),

    // All matchups for user's team
    myTeamId ? admin
      .from('matchups')
      .select('*, team_a:teams!team_a_id(id, team_name), team_b:teams!team_b_id(id, team_name)')
      .eq('league_id', leagueId)
      .or(\`team_a_id.eq.\${myTeamId},team_b_id.eq.\${myTeamId}\`)
      .order('gameweek', { ascending: true }) : Promise.resolve({ data: null }),

    // Live auctions
    admin
      .from('waiver_claims')
      .select(\`
        id, team_id, faab_bid, expires_at,
        player:players!player_id(id, web_name, name, primary_position, pl_team, photo_url),
        team:teams(id, team_name)
      \`)
      .eq('league_id', leagueId)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .order('faab_bid', { ascending: false })
      .limit(4),

    // All teams
    admin
      .from('teams')
      .select('id, team_name, draft_order')
      .eq('league_id', leagueId),

    // Recent activity
    admin
      .from('transactions')
      .select(\`
        id, type, faab_bid, notes, processed_at,
        team:teams(id, team_name),
        player:players(id, web_name, name, primary_position)
      \`)
      .eq('league_id', leagueId)
      .order('processed_at', { ascending: false })
      .limit(5),

    // Taxi Squad
    myTeamId ? admin
      .from('roster_entries')
      .select('player:players(id, web_name, name, primary_position, pl_team, photo_url)')
      .eq('team_id', myTeamId)
      .eq('roster_status', 'taxi') : Promise.resolve({ data: [] }),

    // Tournaments
    admin
      .from('tournaments')
      .select('id, name, status, current_round')
      .eq('league_id', leagueId)
  ]);`;

code = code.replace(promiseAllMatch[0], newPromiseAll);

// 2. Add variable extraction
const varsMatch = code.match(/const activity = activityResult\.data \?\? \[\];\n  const initialTeams = \[\s\S\]*?\]\);/);
if (varsMatch) {
  const newVars = `const activity = activityResult.data ?? [];
  const initialTeams = (teamsResult.data ?? []) as Array<{ id: string; team_name: string; draft_order: number | null }>;
  const taxiSquad = taxiResult?.data ?? [];
  const tournaments = tournamentsResult?.data ?? [];`;
  code = code.replace(varsMatch[0], newVars);
}

fs.writeFileSync(path, code);
console.log("updated page.tsx data fetches");
