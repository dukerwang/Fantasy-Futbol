const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.substring(0, equalsIdx).trim();
      const val = trimmed.substring(equalsIdx + 1).trim();
      process.env[key] = val;
    }
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// We will run the exact share/stats calculation and see how fast it runs and how small the resulting JSON is!
async function generatePrecomputedStats() {
  const season = '2025-26';
  
  // 1. Fetch active players and rankings/archives
  const [{ data: playersData }, { data: rankings }, { data: archives }] = await Promise.all([
    supabase.from('players').select('id, name, web_name, first_name, second_name, primary_position, secondary_positions, pl_team, market_value, total_points, ppg, form_rating').eq('is_active', true).order('total_points', { ascending: false, nullsFirst: false }),
    supabase.from('player_rankings').select('*'),
    supabase.from('season_player_stats_archive').select('player_id, ppg, form_rating, overall_rank, position_ranks').eq('season', season),
  ]);

  const archiveMap = new Map((archives || []).map(a => [a.player_id, a]));
  const rankMap = new Map((rankings || []).map(r => [r.player_id, r]));

  const players = (playersData || []).map(p => {
    const ranks = rankMap.get(p.id);
    const arch = archiveMap.get(p.id);
    return {
      ...p,
      ppg: arch ? Number(arch.ppg) : p.ppg,
      form_rating: arch ? Number(arch.form_rating) : p.form_rating,
      overall_rank: arch ? arch.overall_rank : ranks?.overall_rank,
      position_ranks: arch ? arch.position_ranks : ranks?.position_ranks,
      owner_team_id: null,
      owner_team_name: null,
    };
  });

  const playerMap = new Map(players.map(p => [p.id, p]));

  // 2. Fetch all stats from player_stats for 2025-26
  const allStats = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data } = await supabase
      .from('player_stats')
      .select('player_id, match_rating, fantasy_points, stats')
      .eq('season', season)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (!data || data.length === 0) break;
    allStats.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  // Load Reference Stats
  const { data: refData } = await supabase.from('rating_reference_stats').select('*');
  const refStats = {};
  if (refData && refData.length > 0) {
    for (const r of refData) {
      refStats[r.position] = {
        match_impact: { median: r.match_impact_median, stddev: r.match_impact_stddev },
        influence: { median: r.influence_median, stddev: r.influence_stddev },
        creativity: { median: r.creativity_median, stddev: r.creativity_stddev },
        threat: { median: r.threat_median, stddev: r.threat_stddev },
        defensive: { median: r.defensive_median, stddev: r.defensive_stddev },
        goal_involvement: { median: r.goal_involvement_median, stddev: r.goal_involvement_stddev },
        finishing: { median: r.finishing_median, stddev: r.finishing_stddev },
        save_score: { median: r.save_score_median, stddev: r.save_score_stddev },
      };
    }
  }

  // Helper calculation
  function calculateMatchRating(stats, posKey, refStatsMap, primPos) {
    // simplified calculation matching matchRating.ts or full function
    return { rating: 7.0, fantasyPoints: 5.0 }; // placeholder for timing test
  }

  function buildStatsAgg(minMins) {
    const shadowAgg = new Map();
    for (const r of allStats) {
      const minutes = Number(r.stats?.minutes_played ?? 0);
      if (minutes < minMins) continue;
      const p = playerMap.get(r.player_id);
      if (!p) continue;

      let playerEntry = shadowAgg.get(r.player_id);
      if (!playerEntry) {
        playerEntry = new Map();
        shadowAgg.set(r.player_id, playerEntry);
      }

      const primPos = p.primary_position ? String(p.primary_position).toUpperCase() : '';
      if (primPos) {
        let primAcc = playerEntry.get(primPos);
        if (!primAcc) {
          primAcc = { gp: 0, pts: 0, sumR: 0, mins: 0 };
          playerEntry.set(primPos, primAcc);
        }
        primAcc.gp += 1;
        primAcc.pts += Number(r.fantasy_points ?? 0);
        primAcc.sumR += Number(r.match_rating ?? 0);
        primAcc.mins += minutes;
      }
    }

    const result = {};
    for (const [pid, playerEntry] of shadowAgg) {
      result[pid] = {};
      for (const [pos, ex] of playerEntry) {
        result[pid][pos] = {
          gp: ex.gp,
          total_points: ex.pts,
          avg_rating: ex.gp > 0 ? ex.sumR / ex.gp : 0,
          total_minutes: ex.mins,
        };
      }
    }
    return result;
  }

  const startTime = Date.now();
  const shadowMaps = {
    all: buildStatsAgg(15),
    gt45: buildStatsAgg(45),
  };
  const duration = Date.now() - startTime;

  console.log(`Precomputing stats took ${duration}ms. Total players: ${players.length}, total stats: ${allStats.length}`);

  const output = {
    season,
    players,
    shadowMaps,
  };

  const jsonStr = JSON.stringify(output);
  console.log(`JSON size: ${(jsonStr.length / 1024).toFixed(2)} KB`);
}

generatePrecomputedStats();
