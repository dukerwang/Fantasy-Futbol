// Run with: node --env-file=.env.local scratch/check_promoted_clubs.js
// READ ONLY. What does the promoted-club rule actually compute today?

const { createClient } = require('@supabase/supabase-js');
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function main() {
  const { data: seasons } = await db.from('players').select('pl_season');
  const counts = {};
  for (const p of seasons ?? []) counts[String(p.pl_season)] = (counts[String(p.pl_season)] ?? 0) + 1;
  console.log('players.pl_season distribution:');
  for (const [s, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(s).padEnd(12)} ${c}`);
  }

  const { data: leagues } = await db.from('leagues').select('id, name, previous_season, current_season');
  const prevSeason = leagues?.[0]?.previous_season ?? '2025-26';
  console.log(`\nleagues[0].previous_season = ${prevSeason}`);
  console.log(`leagues[0].current_season  = ${leagues?.[0]?.current_season}`);

  // Exactly what computeEligibility does
  const { data: prevPlayers } = await db.from('players').select('pl_team').eq('pl_season', prevSeason);
  const { data: currPlayers } = await db.from('players').select('pl_team').eq('is_active', true);

  const prevClubs = new Set((prevPlayers ?? []).map(p => p.pl_team).filter(Boolean));
  const promoted = new Set();
  if (prevClubs.size > 0) {
    for (const p of currPlayers ?? []) {
      if (p.pl_team && !prevClubs.has(p.pl_team)) promoted.add(p.pl_team);
    }
  }

  console.log(`\nrows matching pl_season='${prevSeason}': ${prevPlayers?.length ?? 0}`);
  console.log(`distinct clubs derived for LAST season: ${prevClubs.size}`);
  console.log(`distinct clubs among active players:   ${new Set((currPlayers ?? []).map(p => p.pl_team).filter(Boolean)).size}`);
  console.log(`\n=> promotedClubs = [${[...promoted].join(', ') || '(empty)'}]`);
  console.log(promoted.size === 0
    ? '   The rule flags NOBODY. is_promoted_exclusive is false for every auction.'
    : `   ${promoted.size} club(s) flagged.`);

  // The sanctioned source, for comparison
  const { data: pscSeasons } = await db.from('player_season_clubs').select('season');
  const pc = {};
  for (const r of pscSeasons ?? []) pc[r.season] = (pc[r.season] ?? 0) + 1;
  console.log('\nplayer_season_clubs coverage (the sanctioned source):');
  const keys = Object.keys(pc).sort();
  if (!keys.length) console.log('  (no rows)');
  for (const s of keys) console.log(`  ${s.padEnd(12)} ${pc[s]}`);

  if (keys.length) {
    const latest = keys[keys.length - 1];
    const { data: prevPsc } = await db.from('player_season_clubs').select('club_slug').eq('season', prevSeason);
    const slugs = new Set((prevPsc ?? []).map(r => r.club_slug));
    console.log(`\n  distinct club_slugs for ${prevSeason}: ${slugs.size}${slugs.size ? ` -> ${[...slugs].slice(0, 25).join(', ')}` : ''}`);
    console.log(`  (latest season present: ${latest})`);
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
