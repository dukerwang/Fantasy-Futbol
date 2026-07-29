// Run with: node --env-file=.env.local scratch/audit_archive_coverage.js
//
// The app is in offseason (current_season 2026-27, no games yet) and pages fall back
// to the 2025-26 archive. So the zeroed live players.form_rating may be masked already.
// Real question: does the archive actually COVER everyone who played in 2025-26?
const { createClient } = require('@supabase/supabase-js');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function main() {
  for (const s of ['2024-25', '2025-26', '2026-27']) {
    const { count } = await db.from('player_stats')
      .select('*', { count: 'exact', head: true }).eq('season', s);
    console.log(`player_stats rows for ${s}: ${count ?? 0}`);
  }

  // Everyone with real 2025-26 minutes.
  let stats = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('player_stats')
      .select('player_id, fantasy_points, stats').eq('season', '2025-26').range(from, from + 999);
    if (error) throw error;
    stats = stats.concat(data ?? []);
    if (!data || data.length < 1000) break;
  }
  const played = new Map();
  for (const r of stats) {
    const mins = Number(r.stats?.minutes_played ?? 0);
    if (mins <= 0) continue;
    const cur = played.get(r.player_id) ?? { apps: 0, pts: 0 };
    cur.apps++; cur.pts += Number(r.fantasy_points ?? 0);
    played.set(r.player_id, cur);
  }
  console.log(`\nplayers with >=1 real appearance in 2025-26: ${played.size}`);

  let arch = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('season_player_stats_archive')
      .select('player_id, total_points, ppg, form_rating, overall_rank')
      .eq('season', '2025-26').range(from, from + 999);
    if (error) throw error;
    arch = arch.concat(data ?? []);
    if (!data || data.length < 1000) break;
  }
  const archSet = new Set(arch.map(a => a.player_id));
  console.log(`archive rows for 2025-26: ${arch.length}`);

  const { data: players } = await db.from('players')
    .select('id, web_name, pl_team, is_active, total_points, form_rating, ppg');
  const pmap = new Map(players.map(p => [p.id, p]));

  const missing = [...played.entries()]
    .filter(([pid]) => !archSet.has(pid))
    .map(([pid, v]) => ({ pid, ...v, p: pmap.get(pid) }))
    .filter(x => x.p)
    .sort((a, b) => b.pts - a.pts);

  console.log(`\nplayed in 2025-26 but MISSING from the archive: ${missing.length}`);
  console.table(missing.slice(0, 15).map(x => ({
    name: x.p.web_name, club: x.p.pl_team, is_active: x.p.is_active,
    apps_25_26: x.apps, true_pts_25_26: x.pts.toFixed(1),
    live_form_rating: x.p.form_rating, live_ppg: x.p.ppg,
  })));

  const missingInactive = missing.filter(x => !x.p.is_active).length;
  console.log(`of those missing, is_active = false: ${missingInactive} / ${missing.length}`);

  // For players who ARE archived, does the archive hold a usable form_rating?
  const archZero = arch.filter(a => Number(a.form_rating ?? 0) === 0).length;
  console.log(`\narchived rows with form_rating = 0: ${archZero} / ${arch.length}`);

  // Net effect: after archive fallback, who still shows no form?
  let stillBroken = [];
  for (const [pid, v] of played) {
    const a = arch.find(x => x.player_id === pid);
    const effectiveForm = a ? Number(a.form_rating ?? 0) : 0;
    if (effectiveForm === 0 && v.pts > 50) {
      const p = pmap.get(pid);
      if (p) stillBroken.push({ name: p.web_name, club: p.pl_team, is_active: p.is_active, apps: v.apps, pts: v.pts.toFixed(1), archived: !!a });
    }
  }
  stillBroken.sort((a, b) => Number(b.pts) - Number(a.pts));
  console.log(`\nAFTER archive fallback, players with >50 true pts still showing form 0: ${stillBroken.length}`);
  console.table(stillBroken.slice(0, 15));
}

main().catch(e => { console.error(e); process.exit(1); });
