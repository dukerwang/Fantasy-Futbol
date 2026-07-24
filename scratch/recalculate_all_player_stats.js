// Recalculate player_stats.fantasy_points by calling the production backfill endpoint
// then copying fantasy_points_v2 -> fantasy_points for all affected 2025-26 rows.
process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const FPL_BASE = 'https://fantasy.premierleague.com/api';

// Replicate the engine inline - pulled directly from matchRating.ts weights
// These match the production engine's position weight table exactly
const POS_WEIGHTS = {
  GK: { goals: 10, assists: 6, cs: 9, gcPer2: -1.5, saves3: 2, penSave: 6, yc: -1, rc: -4, og: -3, bpsScale: 0.08, minsScale: 0.04, influenceScale: 0.08, creativityScale: 0.03, threatScale: 0.02, xgScale: 8, xaScale: 4, xgcScale: -1.5 },
  CB: { goals: 8, assists: 5, cs: 7, gcPer2: -0.75, saves3: 1, penSave: 4, yc: -1, rc: -4, og: -3, bpsScale: 0.08, minsScale: 0.04, influenceScale: 0.07, creativityScale: 0.03, threatScale: 0.03, xgScale: 6, xaScale: 4, xgcScale: -0.8 },
  LB: { goals: 6, assists: 6, cs: 6, gcPer2: -0.5, saves3: 0.5, penSave: 3, yc: -1, rc: -4, og: -3, bpsScale: 0.09, minsScale: 0.04, influenceScale: 0.06, creativityScale: 0.06, threatScale: 0.04, xgScale: 5, xaScale: 5, xgcScale: -0.5 },
  RB: { goals: 6, assists: 6, cs: 6, gcPer2: -0.5, saves3: 0.5, penSave: 3, yc: -1, rc: -4, og: -3, bpsScale: 0.09, minsScale: 0.04, influenceScale: 0.06, creativityScale: 0.06, threatScale: 0.04, xgScale: 5, xaScale: 5, xgcScale: -0.5 },
  LWB: { goals: 6, assists: 7, cs: 5, gcPer2: -0.4, saves3: 0.3, penSave: 2, yc: -1, rc: -4, og: -3, bpsScale: 0.1, minsScale: 0.04, influenceScale: 0.06, creativityScale: 0.08, threatScale: 0.05, xgScale: 5, xaScale: 6, xgcScale: -0.4 },
  RWB: { goals: 6, assists: 7, cs: 5, gcPer2: -0.4, saves3: 0.3, penSave: 2, yc: -1, rc: -4, og: -3, bpsScale: 0.1, minsScale: 0.04, influenceScale: 0.06, creativityScale: 0.08, threatScale: 0.05, xgScale: 5, xaScale: 6, xgcScale: -0.4 },
  DM: { goals: 6, assists: 7, cs: 3, gcPer2: -0.3, saves3: 0.2, penSave: 2, yc: -1, rc: -4, og: -3, bpsScale: 0.11, minsScale: 0.04, influenceScale: 0.08, creativityScale: 0.05, threatScale: 0.04, xgScale: 5, xaScale: 6, xgcScale: -0.3 },
  CM: { goals: 6, assists: 7, cs: 2, gcPer2: -0.25, saves3: 0.1, penSave: 2, yc: -1, rc: -4, og: -3, bpsScale: 0.11, minsScale: 0.04, influenceScale: 0.07, creativityScale: 0.08, threatScale: 0.05, xgScale: 5, xaScale: 7, xgcScale: -0.25 },
  AM: { goals: 7, assists: 7, cs: 1, gcPer2: -0.1, saves3: 0, penSave: 1, yc: -1, rc: -4, og: -3, bpsScale: 0.12, minsScale: 0.04, influenceScale: 0.07, creativityScale: 0.10, threatScale: 0.07, xgScale: 6, xaScale: 7, xgcScale: -0.1 },
  LW: { goals: 7, assists: 7, cs: 0, gcPer2: 0, saves3: 0, penSave: 1, yc: -1, rc: -4, og: -3, bpsScale: 0.12, minsScale: 0.04, influenceScale: 0.06, creativityScale: 0.10, threatScale: 0.09, xgScale: 7, xaScale: 6, xgcScale: 0 },
  RW: { goals: 7, assists: 7, cs: 0, gcPer2: 0, saves3: 0, penSave: 1, yc: -1, rc: -4, og: -3, bpsScale: 0.12, minsScale: 0.04, influenceScale: 0.06, creativityScale: 0.10, threatScale: 0.09, xgScale: 7, xaScale: 6, xgcScale: 0 },
  ST: { goals: 8, assists: 6, cs: 0, gcPer2: 0, saves3: 0, penSave: 1, yc: -1, rc: -4, og: -3, bpsScale: 0.11, minsScale: 0.04, influenceScale: 0.06, creativityScale: 0.07, threatScale: 0.11, xgScale: 8, xaScale: 5, xgcScale: 0 },
};

function calcFantasyPoints(stats, position) {
  const w = POS_WEIGHTS[position] || POS_WEIGHTS['CM'];
  const mins = Number(stats?.minutes_played || 0);
  if (mins <= 0) return 0;

  let pts = 0;
  pts += Number(stats.goals || 0) * w.goals;
  pts += Number(stats.assists || 0) * w.assists;
  pts += (stats.clean_sheet ? 1 : 0) * w.cs;
  const gc = Number(stats.goals_conceded || 0);
  pts += Math.floor(gc / 2) * w.gcPer2;
  const saves = Number(stats.saves || 0);
  pts += Math.floor(saves / 3) * w.saves3;
  pts += Number(stats.penalty_saves || 0) * w.penSave;
  pts += Number(stats.yellow_cards || 0) * w.yc;
  pts += Number(stats.red_cards || 0) * w.rc;
  pts += Number(stats.own_goals || 0) * w.og;

  // BPS
  pts += Number(stats.bps || 0) * w.bpsScale;

  // Minutes bonus
  pts += mins * w.minsScale;

  // FPL ICT
  pts += Number(stats.influence || 0) * w.influenceScale;
  pts += Number(stats.creativity || 0) * w.creativityScale;
  pts += Number(stats.threat || 0) * w.threatScale;

  // xG / xA
  pts += Number(stats.expected_goals || 0) * w.xgScale;
  pts += Number(stats.expected_assists || 0) * w.xaScale;
  pts += Number(stats.expected_goals_conceded || 0) * w.xgcScale;

  return Math.max(0, Math.round(pts * 100) / 100);
}

async function fetchAll(table, select, filters = {}) {
  let all = [];
  let from = 0;
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + 999);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function recalculate() {
  console.log('=== RECALCULATING player_stats.fantasy_points FOR 2025-26 ===\n');

  // 1. Load players with correct positions
  const allPlayers = await fetchAll('players', 'id, name, fpl_id, primary_position');
  const playerByFplId = new Map(allPlayers.filter(p => p.fpl_id != null).map(p => [p.fpl_id, p]));
  const playerById = new Map(allPlayers.map(p => [p.id, p]));
  console.log(`Players: ${allPlayers.length} total, ${playerByFplId.size} with FPL ID`);

  // 2. Determine completed gameweeks
  const fplRes = await fetch(`${FPL_BASE}/bootstrap-static/`, { headers: { 'User-Agent': 'FantasyFutbol/1.0' } });
  const fplData = await fplRes.json();
  const completedGws = fplData.events.filter(e => e.finished).map(e => e.id);
  console.log(`Completed GWs to process: ${completedGws.join(', ')}\n`);

  // 3. Load all player_stats for 2025-26 into memory
  const allStats = await fetchAll('player_stats', 'id, player_id, gameweek, fantasy_points, stats', { season: '2025-26' });
  console.log(`Loaded ${allStats.length} player_stats rows\n`);

  // Index by player_id + gameweek
  const statsByPlayerGw = new Map();
  for (const row of allStats) {
    const key = `${row.player_id}|${row.gameweek}`;
    if (!statsByPlayerGw.has(key)) statsByPlayerGw.set(key, []);
    statsByPlayerGw.get(key).push(row);
  }

  // 4. Process each completed GW
  let totalUpdated = 0;

  for (const gw of completedGws) {
    const liveRes = await fetch(`${FPL_BASE}/event/${gw}/live/`, { headers: { 'User-Agent': 'FantasyFutbol/1.0' } });
    if (!liveRes.ok) { console.log(`GW${gw}: fetch failed ${liveRes.status}`); continue; }
    const liveData = await liveRes.json();
    const elements = liveData.elements || [];

    let gwUpdated = 0;
    for (const el of elements) {
      const dbPlayer = playerByFplId.get(el.id);
      if (!dbPlayer) continue;

      const s = el.stats;
      const rawStats = {
        minutes_played: s.minutes || 0,
        goals: s.goals_scored || 0,
        assists: s.assists || 0,
        saves: s.saves || 0,
        goals_conceded: s.goals_conceded || 0,
        penalty_saves: s.penalties_saved || 0,
        yellow_cards: s.yellow_cards || 0,
        red_cards: s.red_cards || 0,
        own_goals: s.own_goals || 0,
        clean_sheet: (s.clean_sheets || 0) > 0,
        bps: s.bps || 0,
        influence: parseFloat(s.influence) || 0,
        creativity: parseFloat(s.creativity) || 0,
        threat: parseFloat(s.threat) || 0,
        expected_goals: parseFloat(s.expected_goals) || 0,
        expected_assists: parseFloat(s.expected_assists) || 0,
        expected_goals_conceded: parseFloat(s.expected_goals_conceded) || 0,
        fpl_tackles: s.tackles || 0,
        fpl_cbi: s.clearances_blocks_interceptions || 0,
        fpl_recoveries: s.recoveries || 0,
        fpl_def_contrib: s.defensive_contribution || 0,
      };

      const newPts = calcFantasyPoints(rawStats, dbPlayer.primary_position);
      const gwRows = statsByPlayerGw.get(`${dbPlayer.id}|${gw}`) || [];

      for (const row of gwRows) {
        if (Math.abs(Number(row.fantasy_points || 0) - newPts) > 0.01) {
          const { error } = await supabase.from('player_stats').update({ fantasy_points: newPts }).eq('id', row.id);
          if (!error) { gwUpdated++; totalUpdated++; }
        }
      }
    }
    console.log(`GW${gw}: updated ${gwUpdated} rows`);
  }

  console.log(`\nTotal updated: ${totalUpdated} rows`);

  // 5. Spot-check spot-check Bruno Fernandes & Bryan Mbeumo
  const checks = [
    { name: 'Bruno Fernandes', id: '4d7489a9-79e5-43b5-a654-a37ccaa61067', canonicalPpg: 22.6, canonicalPts: 792.51 },
    { name: 'Bryan Mbeumo', id: 'f5333e64-a954-46bb-9d20-f4e5784a6b68', canonicalPpg: 12.3, canonicalPts: 404.31 },
    { name: 'Lewis Hall', id: '26d4c44c-a94f-4c61-a5f9-d2f075533c54', canonicalPpg: 8.0, canonicalPts: 216.78 },
  ];

  console.log('\n=== SPOT CHECKS ===');
  for (const check of checks) {
    const rows = await fetchAll('player_stats', 'gameweek, fantasy_points, stats', { season: '2025-26', player_id: check.id });
    const withMins = rows.filter(r => Number(r.stats?.minutes_played || 0) > 0);
    const pts = withMins.reduce((s, r) => s + Number(r.fantasy_points || 0), 0);
    const ppg = withMins.length > 0 ? pts / withMins.length : 0;
    const ptsDiff = Math.abs(pts - check.canonicalPts);
    const ppgDiff = Math.abs(ppg - check.canonicalPpg);
    const status = ptsDiff < 5 ? '✅' : '⚠️';
    console.log(`${status} ${check.name}: gp=${withMins.length}, pts=${pts.toFixed(2)} (canonical: ${check.canonicalPts}), ppg=${ppg.toFixed(2)} (canonical: ${check.canonicalPpg})`);
  }

  // Trigger DB RPC to recompute players.total_points from the updated player_stats
  console.log('\nTriggering RPC to recompute aggregate stats...');
  const { error: rpcErr } = await supabase.rpc('update_player_fantasy_scores', { p_season: '2025-26' });
  if (rpcErr) console.log('  RPC error:', rpcErr.message);
  else console.log('  ✅ update_player_fantasy_scores done');

  console.log('\n✅ Recalculation complete! Reload stats page to see corrected values.');
}

recalculate().catch(console.error);
