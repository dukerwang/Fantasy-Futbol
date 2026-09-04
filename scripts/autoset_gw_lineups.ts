import { createAdminClient } from '../src/lib/supabase/admin';
import { carryForwardLineupsForGameweek } from '../src/lib/lineups/carryForward';

async function main() {
  const admin = createAdminClient();
  const targetGw = 3;
  console.log(`Running autoset / carry-forward for GW ${targetGw}...`);

  const result = await carryForwardLineupsForGameweek(admin, { gameweek: targetGw });
  console.log(`GW ${targetGw} autoset complete. Updated matchups: ${result.updatedCount}`);
  for (const detail of result.details) {
    console.log(' -', detail);
  }

  // Also check GW 2 if any were missing
  const result2 = await carryForwardLineupsForGameweek(admin, { gameweek: 2 });
  console.log(`GW 2 autoset complete. Updated matchups: ${result2.updatedCount}`);

  // Inspect GW 3 matchups now
  const { data: matchups } = await admin.from('matchups')
    .select('id, gameweek, team_a_id, team_b_id, lineup_a, lineup_b, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
    .eq('gameweek', targetGw);

  console.log(`\nVerifying GW ${targetGw} matchups:`);
  for (const m of matchups || []) {
    const hasA = Boolean(m.lineup_a);
    const hasB = Boolean(m.lineup_b);
    const teamAName = (m.team_a as any)?.team_name ?? (Array.isArray(m.team_a) ? (m.team_a[0] as any)?.team_name : 'Team A');
    const teamBName = (m.team_b as any)?.team_name ?? (Array.isArray(m.team_b) ? (m.team_b[0] as any)?.team_name : 'Team B');
    console.log(`Matchup: ${teamAName} (set: ${hasA}) vs ${teamBName} (set: ${hasB})`);
  }
}

main().catch((err) => {
  console.error('Error running autoset:', err);
  process.exit(1);
});
