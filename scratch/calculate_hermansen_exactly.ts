import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: player } = await supabase
    .from('players')
    .select('id, name, pl_team')
    .ilike('name', '%Hermansen%')
    .single();

  if (!player) {
    console.log("Mads Hermansen not found!");
    return;
  }

  const { data: stats } = await supabase
    .from('player_stats')
    .select('gameweek, stats, fantasy_points, fantasy_points_v2, match_rating, match_rating_v2')
    .eq('player_id', player.id)
    .order('gameweek', { ascending: true });

  console.log(`Mads Hermansen total matches in DB: ${stats?.length}`);

  let totalFpl = 0;
  let playedCount = 0;
  const rows = [];

  for (const s of stats || []) {
    const st = s.stats;
    const mins = st.minutes_played ?? 0;
    if (mins === 0) continue;

    playedCount++;
    let fplPt = 0;
    if (mins >= 60) {
      fplPt += 2;
    } else {
      fplPt += 1;
    }

    if (st.clean_sheet === true && mins >= 60) {
      fplPt += 4;
    }

    const saves = st.saves ?? 0;
    fplPt += Math.floor(saves / 3);

    const psav = st.penalty_saves ?? 0;
    fplPt += psav * 5;

    const pmis = st.penalties_missed ?? 0;
    fplPt -= pmis * 2;

    const gc = st.goals_conceded ?? 0;
    fplPt -= Math.floor(gc / 2);

    const og = st.own_goals ?? 0;
    fplPt -= og * 2;

    const yc = st.yellow_cards ?? 0;
    fplPt -= yc;

    const rc = st.red_cards ?? 0;
    fplPt -= rc * 3;

    totalFpl += fplPt;
    rows.push({
      GW: s.gameweek,
      Mins: mins,
      Saves: saves,
      CS: st.clean_sheet,
      GC: gc,
      FPL: fplPt,
      V2: s.fantasy_points_v2
    });
  }

  console.table(rows);
  console.log(`Total FPL Points (calculated): ${totalFpl}`);
  console.log(`Total V2 Points (in DB): ${rows.reduce((sum, r) => sum + (r.V2 ?? 0), 0).toFixed(1)}`);
  console.log(`FPL PPG: ${(totalFpl / playedCount).toFixed(2)}`);
  console.log(`V2 PPG: ${(rows.reduce((sum, r) => sum + (r.V2 ?? 0), 0) / playedCount).toFixed(2)}`);
}

main().catch(console.error);
