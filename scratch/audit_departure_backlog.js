/**
 * Pre-flight audit for the Retained List rollout.
 *
 * The nightly sync now opens a departure decision for every inactive player
 * sitting on a roster. In an `active` league those carry a 72h deadline and
 * then AUTO-RELEASE — paying compensation and dropping the player. So any
 * stale `is_active = false` row that is really a data artefact (a duplicate
 * player row, a bad name match, a leftover from a previous season) will quietly
 * turn into a real payout three days after the first sync.
 *
 * This reports the backlog before that happens. Read it, confirm every name is
 * genuinely someone who left the Premier League, then let the cron run.
 *
 * Usage: node --env-file=.env.local scratch/audit_departure_backlog.js
 */

const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: node --env-file=.env.local scratch/audit_departure_backlog.js');
  process.exit(1);
}

const db = createClient(url, key);

async function main() {
  const { data: leagues, error: lErr } = await db
    .from('leagues')
    .select('id, name, status, retained_slots, departure_compensation_rate, current_season, previous_season')
    .in('status', ['active', 'offseason']);

  if (lErr) throw new Error(`leagues: ${lErr.message}`);

  if (!leagues?.length) {
    console.log('No active or offseason leagues found.');
    return;
  }

  for (const league of leagues) {
    console.log('\n' + '='.repeat(72));
    console.log(`${league.name}  [${league.status}]`);
    console.log(
      `  compensation rate: ${league.departure_compensation_rate}   ` +
        `retained slots: ${league.retained_slots}   season: ${league.current_season}`,
    );
    console.log('='.repeat(72));

    const { data: teams } = await db.from('teams').select('id, team_name').eq('league_id', league.id);
    const teamIds = (teams ?? []).map((t) => t.id);
    const teamName = new Map((teams ?? []).map((t) => [t.id, t.team_name]));

    if (!teamIds.length) {
      console.log('  (no teams)');
      continue;
    }

    const { data: entries } = await db
      .from('roster_entries')
      .select('team_id, player_id, status')
      .in('team_id', teamIds);

    const rosteredIds = [...new Set((entries ?? []).map((e) => e.player_id))];
    if (!rosteredIds.length) {
      console.log('  (no rostered players)');
      continue;
    }

    const { data: inactive } = await db
      .from('players')
      .select('id, name, pl_team, market_value, market_value_updated_at, fpl_status')
      .eq('is_active', false)
      .in('id', rosteredIds);

    const { data: decisions } = await db
      .from('departure_decisions')
      .select('player_id, status, compensation_offered')
      .eq('league_id', league.id);

    const decisionByPlayer = new Map((decisions ?? []).map((d) => [d.player_id, d]));

    if (!inactive?.length) {
      console.log('  No inactive players on rosters — nothing will be swept.');
    } else {
      const rate = Number(league.departure_compensation_rate ?? 0.8);
      let total = 0;

      console.log(`\n  ${inactive.length} inactive player(s) on rosters:\n`);
      for (const p of inactive) {
        const owner = (entries ?? []).find((e) => e.player_id === p.id && e.status !== 'loan_in');
        const existing = decisionByPlayer.get(p.id);
        const offer = Math.round(Number(p.market_value ?? 0) * rate * 100) / 100;
        if (!existing) total += offer;

        console.log(
          `    ${p.name}  (${p.pl_team ?? 'no club'})  €${p.market_value}m` +
            `  → offer €${offer}m` +
            `  owner: ${teamName.get(owner?.team_id) ?? 'UNKNOWN'}`,
        );
        console.log(
          `      fpl_status=${p.fpl_status ?? 'null'}` +
            `  priced=${p.market_value_updated_at ? 'yes' : 'NEVER — payout would be off raw FPL cost'}` +
            `  decision=${existing ? existing.status : 'none yet (will be created on next sync)'}`,
        );
      }

      console.log(`\n  Total that would be paid out if all are released: €${total.toFixed(2)}m`);
      if (league.status === 'active') {
        console.log('  ⚠ League is ACTIVE — undecided departures auto-release 72h after the decision opens.');
      } else {
        console.log('  League is OFFSEASON — undecided departures resolve at Kickoff, not on a timer.');
      }
    }

    const counts = {};
    for (const d of decisions ?? []) counts[d.status] = (counts[d.status] ?? 0) + 1;
    if (Object.keys(counts).length) {
      console.log('\n  Existing decisions:', counts);
    }
  }

  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
