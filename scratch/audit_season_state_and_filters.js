// Run with: node --env-file=.env.local scratch/audit_season_state_and_filters.js
//
// Part A: what season is everything actually on, and is 2025-26 archived?
//         Distinguishes two competing explanations for form_rating = 0:
//           (i)  the RPC was run for 2026-27, which has no games yet
//           (ii) the RPC's `is_active = true` filter skips relegated/departed players
// Part B: how much does the >=15 minute filter actually change a TOTAL vs an AVERAGE?
const { createClient } = require('@supabase/supabase-js');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function main() {
  console.log('════════ PART A: season state ════════\n');

  // Distinct seasons present in player_stats (count per season, not sampled).
  for (const s of ['2024-25', '2025-26', '2026-27']) {
    const { count } = await db
      .from('player_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', s);
    console.log(`player_stats rows for ${s}: ${count ?? 0}`);
  }

  const { data: leagues } = await db
    .from('leagues')
    .select('id, name, current_season, previous_season, status');
  console.log('\nleagues:', JSON.stringify(leagues, null, 2));

  // Is 2025-26 archived, and does the archive hold a correct form_rating?
  for (const s of ['2024-25', '2025-26']) {
    const { count } = await db
      .from('season_player_stats_archive')
      .select('*', { count: 'exact', head: true })
      .eq('season', s);
    console.log(`\nseason_player_stats_archive rows for ${s}: ${count ?? 0}`);
  }

  const { data: bowen } = await db
    .from('players')
    .select('id, web_name, pl_team, is_active, fpl_status, total_points, form, form_rating, ppg')
    .eq('web_name', 'Bowen')
    .maybeSingle();
  if (bowen) {
    console.log('\nBowen live players row:', bowen);
    const { data: bowenArch } = await db
      .from('season_player_stats_archive')
      .select('season, total_points, ppg, form_rating, overall_rank')
      .eq('player_id', bowen.id);
    console.log('Bowen archive rows:', bowenArch);
  }

  // Decisive cross-tab: if explanation (i) were true, ALL players would be 0.
  const { data: players, error } = await db
    .from('players')
    .select('id, web_name, pl_team, is_active, total_points, form, form_rating, ppg');
  if (error) throw error;

  const tab = { activeZero: 0, activeNonZero: 0, inactiveZero: 0, inactiveNonZero: 0 };
  for (const p of players) {
    const zero = Number(p.form_rating ?? 0) === 0;
    const key = (p.is_active ? 'active' : 'inactive') + (zero ? 'Zero' : 'NonZero');
    tab[key]++;
  }
  console.log('\nform_rating zero/non-zero by is_active:', tab);
  console.log(`(if form zeroed because 2026-27 has no games, ALL ${players.length} would be zero)`);

  // Which clubs do the inactive players belong to? Relegation should dominate.
  const inactiveByClub = {};
  for (const p of players.filter(p => !p.is_active)) {
    inactiveByClub[p.pl_team] = (inactiveByClub[p.pl_team] ?? 0) + 1;
  }
  console.log('\ninactive players by club:',
    Object.entries(inactiveByClub).sort((a, b) => b[1] - a[1]));

  const activeByClub = {};
  for (const p of players.filter(p => p.is_active)) {
    activeByClub[p.pl_team] = (activeByClub[p.pl_team] ?? 0) + 1;
  }
  console.log('\nACTIVE players by club:',
    Object.entries(activeByClub).sort((a, b) => b[1] - a[1]));

  console.log('\n\n════════ PART B: what the >=15 min filter does to totals vs averages ════════\n');

  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e2 } = await db
      .from('player_stats')
      .select('player_id, gameweek, fantasy_points, match_rating, stats')
      .eq('season', '2025-26')
      .range(from, from + 999);
    if (e2) throw e2;
    all = all.concat(data ?? []);
    if (!data || data.length < 1000) break;
  }

  const pmap = new Map(players.map(p => [p.id, p]));
  const agg = new Map();
  for (const r of all) {
    const mins = Number(r.stats?.minutes_played ?? 0);
    if (mins <= 0) continue;
    const pts = Number(r.fantasy_points ?? 0);
    const rating = Number(r.match_rating ?? 0);
    let a = agg.get(r.player_id);
    if (!a) { a = { allN: 0, allPts: 0, allR: 0, f15N: 0, f15Pts: 0, f15R: 0, cameoN: 0, cameoPts: 0 }; agg.set(r.player_id, a); }
    a.allN++; a.allPts += pts; a.allR += rating;
    if (mins >= 15) { a.f15N++; a.f15Pts += pts; a.f15R += rating; }
    else { a.cameoN++; a.cameoPts += pts; }
  }

  const rows = [];
  for (const [pid, a] of agg) {
    const p = pmap.get(pid);
    if (!p || a.allN < 5) continue;
    const ppgAll = a.allPts / a.allN;
    const ppg15 = a.f15N > 0 ? a.f15Pts / a.f15N : 0;
    rows.push({
      name: p.web_name,
      apps: a.allN,
      cameos: a.cameoN,
      totalAll: a.allPts,
      total15: a.f15Pts,
      totalLostPct: a.allPts > 0 ? ((a.allPts - a.f15Pts) / a.allPts) * 100 : 0,
      ppgAll,
      ppg15,
      ppgDrag: ppg15 - ppgAll,
      cameoPPG: a.cameoN > 0 ? a.cameoPts / a.cameoN : null,
    });
  }

  // Does the cameo drag on AVERAGES that you described actually show up?
  const withCameos = rows.filter(r => r.cameos >= 3);
  const avgDrag = withCameos.reduce((s, r) => s + r.ppgDrag, 0) / withCameos.length;
  const cameoPPGs = withCameos.map(r => r.cameoPPG).filter(v => v != null);
  const avgCameoPPG = cameoPPGs.reduce((s, v) => s + v, 0) / cameoPPGs.length;
  const avg15PPG = withCameos.reduce((s, r) => s + r.ppg15, 0) / withCameos.length;
  console.log(`players with >=3 cameos: ${withCameos.length}`);
  console.log(`mean PPG on cameo (<15min) appearances : ${avgCameoPPG.toFixed(2)}`);
  console.log(`mean PPG on >=15min appearances        : ${avg15PPG.toFixed(2)}`);
  console.log(`=> filtering cameos RAISES mean PPG by  : ${avgDrag.toFixed(2)} pts/appearance`);

  console.log('\n--- Worst cameo drag on PPG (your argument for keeping the filter) ---');
  console.table(
    [...withCameos].sort((a, b) => b.ppgDrag - a.ppgDrag).slice(0, 10).map(r => ({
      name: r.name, apps: r.apps, cameos: r.cameos,
      ppg_all_apps: r.ppgAll.toFixed(2),
      ppg_15min: r.ppg15.toFixed(2),
      drag: `+${r.ppgDrag.toFixed(2)}`,
      cameo_ppg: r.cameoPPG?.toFixed(2),
    }))
  );

  console.log('\n--- Same filter applied to the TOTAL (points simply deleted) ---');
  console.table(
    [...rows].sort((a, b) => (b.totalAll - b.total15) - (a.totalAll - a.total15)).slice(0, 10).map(r => ({
      name: r.name, apps: r.apps, cameos: r.cameos,
      true_total: r.totalAll.toFixed(1),
      filtered_total: r.total15.toFixed(1),
      pts_hidden: (r.totalAll - r.total15).toFixed(1),
      pct_hidden: `${r.totalLostPct.toFixed(0)}%`,
    }))
  );

  const leagueAll = rows.reduce((s, r) => s + r.totalAll, 0);
  const league15 = rows.reduce((s, r) => s + r.total15, 0);
  console.log(`\nleague-wide: true total ${leagueAll.toFixed(0)} vs filtered ${league15.toFixed(0)} (${(((leagueAll - league15) / leagueAll) * 100).toFixed(1)}% of all points hidden by the filter)`);
}

main().catch(e => { console.error(e); process.exit(1); });
