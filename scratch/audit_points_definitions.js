/**
 * Ad-hoc audit: quantify how much players.total_points diverges from the
 * position-scoped "Pts" the stats/draft tables compute, and check whether
 * players.form carries any signal beyond players.form_rating.
 */
// Run with: node --env-file=.env.local scratch/audit_points_definitions.js
const { createClient } = require('@supabase/supabase-js');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function main() {
  // Which seasons actually have stat rows?
  const { data: seasonRows } = await db
    .from('player_stats')
    .select('season')
    .limit(20000);
  const seasonCounts = {};
  for (const r of seasonRows ?? []) seasonCounts[r.season] = (seasonCounts[r.season] ?? 0) + 1;
  console.log('player_stats rows by season (sampled):', seasonCounts);

  const season = Object.entries(seasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  console.log('\nUsing season:', season, '\n');

  // Pull every stat row for the season, paginated past the 1000-row default.
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('player_stats')
      .select('player_id, gameweek, fantasy_points, match_rating, stats')
      .eq('season', season)
      .range(from, from + 999);
    if (error) throw error;
    all = all.concat(data ?? []);
    if (!data || data.length < 1000) break;
  }
  console.log('stat rows fetched:', all.length);

  const { data: players } = await db
    .from('players')
    .select('id, web_name, pl_team, primary_position, secondary_positions, total_points, form, form_rating, ppg')
    .not('total_points', 'is', null);
  const pmap = new Map((players ?? []).map(p => [p.id, p]));

  // Aggregate raw sum vs the >=15 minute sum the tables use.
  const agg = new Map();
  for (const r of all) {
    const mins = Number(r.stats?.minutes_played ?? 0);
    const pts = Number(r.fantasy_points ?? 0);
    let a = agg.get(r.player_id);
    if (!a) { a = { raw: 0, gte15: 0, cameoGames: 0, ratings: [] }; agg.set(r.player_id, a); }
    a.raw += pts;
    if (mins >= 15) {
      a.gte15 += pts;
      a.ratings.push({ gw: r.gameweek, rating: Number(r.match_rating ?? 0) });
    } else if (mins > 0) {
      a.cameoGames += 1;
    }
  }

  // Biggest gaps between players.total_points and the >=15min figure.
  const rows = [];
  for (const [pid, a] of agg) {
    const p = pmap.get(pid);
    if (!p) continue;
    const diff = Number(p.total_points) - a.gte15;
    rows.push({
      name: p.web_name,
      club: p.pl_team,
      pos: p.primary_position,
      sec: (p.secondary_positions ?? []).join('/') || '—',
      stored: Number(p.total_points).toFixed(1),
      gte15: a.gte15.toFixed(1),
      diff: diff.toFixed(1),
      cameos: a.cameoGames,
    });
  }
  rows.sort((x, y) => Math.abs(Number(y.diff)) - Math.abs(Number(x.diff)));
  console.log('\n=== players.total_points vs >=15min sum (top 15 divergences) ===');
  console.table(rows.slice(0, 15));

  const nonZero = rows.filter(r => Math.abs(Number(r.diff)) >= 0.05);
  console.log(`players where the two Pts definitions disagree: ${nonZero.length} / ${rows.length}`);

  // Blast radius of the secondary-position re-score.
  const dual = (players ?? []).filter(p => (p.secondary_positions ?? []).length > 0);
  console.log(`players with >=1 secondary position (subject to re-scored Pts): ${dual.length} / ${players.length}`);

  // Does players.form carry signal beyond form_rating?
  const withForm = (players ?? []).filter(p => p.form != null);
  const withFormRating = (players ?? []).filter(p => p.form_rating != null);
  console.log(`\nplayers.form non-null: ${withForm.length}; players.form_rating non-null: ${withFormRating.length}`);
  console.log('\n=== form vs form_rating sample (top 10 by total_points) ===');
  console.table(
    (players ?? [])
      .sort((a, b) => Number(b.total_points) - Number(a.total_points))
      .slice(0, 10)
      .map(p => ({
        name: p.web_name,
        pos: p.primary_position,
        total_points: Number(p.total_points).toFixed(1),
        ppg: p.ppg != null ? Number(p.ppg).toFixed(2) : '—',
        form_pts_l5: p.form != null ? Number(p.form).toFixed(2) : '—',
        form_rating_l5: p.form_rating != null ? Number(p.form_rating).toFixed(2) : '—',
      }))
  );

  // Spread of (last-5 rating - season avg rating): drives the arrow's usable range.
  const deltas = [];
  for (const [pid, a] of agg) {
    const p = pmap.get(pid);
    if (!p || a.ratings.length < 5) continue;
    const sorted = a.ratings.sort((x, y) => y.gw - x.gw);
    const l5 = sorted.slice(0, 5);
    const l5avg = l5.reduce((s, r) => s + r.rating, 0) / l5.length;
    const seasonAvg = sorted.reduce((s, r) => s + r.rating, 0) / sorted.length;
    deltas.push({ name: p.web_name, pos: p.primary_position, games: sorted.length, l5avg, seasonAvg, delta: l5avg - seasonAvg });
  }
  deltas.sort((a, b) => b.delta - a.delta);
  const q = (arr, f) => arr[Math.floor((arr.length - 1) * f)]?.delta ?? 0;
  const byDelta = [...deltas].sort((a, b) => a.delta - b.delta);
  console.log(`\n=== arrow input: (last5 avg rating - season avg rating), n=${deltas.length} ===`);
  console.log('min', q(byDelta, 0).toFixed(2), '| p10', q(byDelta, 0.1).toFixed(2), '| p25', q(byDelta, 0.25).toFixed(2),
    '| median', q(byDelta, 0.5).toFixed(2), '| p75', q(byDelta, 0.75).toFixed(2), '| p90', q(byDelta, 0.9).toFixed(2),
    '| max', q(byDelta, 1).toFixed(2));
  const fmt = d => ({ name: d.name, pos: d.pos, games: d.games, l5avg: d.l5avg.toFixed(2), seasonAvg: d.seasonAvg.toFixed(2), delta: d.delta.toFixed(2) });
  console.log('\nHottest 8:');
  console.table(deltas.slice(0, 8).map(fmt));
  console.log('Coldest 8:');
  console.table(byDelta.slice(0, 8).map(fmt));

  // How many players would have too few games for a meaningful arrow?
  const gameCounts = [...agg.values()].map(a => a.ratings.length);
  const under3 = gameCounts.filter(c => c < 3).length;
  console.log(`\nplayers with <3 qualifying appearances (arrow needs a no-data state): ${under3} / ${gameCounts.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
