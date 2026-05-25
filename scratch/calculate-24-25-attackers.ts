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
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9 ]/g, "") // remove special characters
    .trim();
}

(async () => {
  const { calculateMatchRating, DEFAULT_REFERENCE_STATS } = await import('../src/lib/scoring/matchRating.ts');
  const { loadReferenceStats } = await import('../src/lib/scoring/matchups.ts');

  console.log("Loading all player granular positions from DB...");
  const { data: dbPlayers, error: dbErr } = await supabase
    .from('players')
    .select('id, name, primary_position, secondary_positions')
    .not('fpl_id', 'is', null);
  
  if (dbErr) {
    console.error("Error loading players:", dbErr.message);
    return;
  }
  console.log(`Loaded ${dbPlayers.length} players from DB.`);

  // Load V2 reference stats from DB
  let refStats: any = {};
  try {
    refStats = await loadReferenceStats(supabase as any, '2025-26');
    console.log("Reference stats loaded successfully.");
  } catch (e) {
    refStats = DEFAULT_REFERENCE_STATS;
    console.log("Fallback to DEFAULT_REFERENCE_STATS.");
  }

  // Create mapping maps based on normalized names
  const nameToGranular = new Map<string, string>();
  const nameToRealName = new Map<string, string>();
  
  for (const p of dbPlayers) {
    const norm = normalizeName(p.name);
    nameToGranular.set(norm, p.primary_position);
    nameToRealName.set(norm, p.name);
  }

  // Read and parse Vaastav CSV
  console.log("Parsing scratch/merged_gw_24_25.csv...");
  const csvPath = path.resolve(process.cwd(), 'scratch/merged_gw_24_25.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = fileContent.split('\n');

  const header = parseCSVLine(lines[0]);
  const colIdx = (name: string) => header.indexOf(name);

  // Group raw rows by player (element)
  const playerRowsMap = new Map<number, any[]>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = parseCSVLine(line);
    if (parts.length < header.length) continue;

    const element = Number(parts[colIdx('element')]);
    if (!playerRowsMap.has(element)) {
      playerRowsMap.set(element, []);
    }
    playerRowsMap.get(element)!.push(parts);
  }
  console.log(`Grouped ${playerRowsMap.size} unique players from Vaastav logs.`);

  const POSITIONS = ['AM', 'LW', 'RW', 'ST'];
  const posLeaders: Record<string, any[]> = {};
  for (const pos of POSITIONS) {
    posLeaders[pos] = [];
  }

  // Process player-by-player
  let matchedCount = 0;
  for (const [element, rows] of playerRowsMap.entries()) {
    const rawCsvName = rows[0][colIdx('name')].replace(/"/g, '');
    const normName = normalizeName(rawCsvName);
    
    let pos = nameToGranular.get(normName);
    let name = nameToRealName.get(normName) || rawCsvName;

    if (!pos) {
      // Fallback position mapping using Vaastav position column if not in our players table
      const fplPos = rows[0][colIdx('position')];
      if (fplPos === 'FWD') {
        pos = 'ST';
      } else if (fplPos === 'MID') {
        pos = 'CM'; // default mid to CM
      } else {
        continue; // skip GK and DEF
      }
    } else {
      matchedCount++;
    }

    if (!POSITIONS.includes(pos)) continue; // only focus on AM, LW, RW, ST

    const played = rows.filter(r => Number(r[colIdx('minutes')]) > 0);
    if (played.length < 5) continue; // min 5 appearances

    let totalPointsV2 = 0;
    let sumV1 = 0;
    const teamName = rows[0][colIdx('team')];

    for (const r of played) {
      const rawStats = {
        minutes_played: Number(r[colIdx('minutes')]),
        goals: Number(r[colIdx('goals_scored')]),
        assists: Number(r[colIdx('assists')]),
        bps: Number(r[colIdx('bps')]),
        influence: Number(r[colIdx('influence')]),
        creativity: Number(r[colIdx('creativity')]),
        threat: Number(r[colIdx('threat')]),
        expected_goals: Number(r[colIdx('expected_goals')]),
        expected_assists: Number(r[colIdx('expected_assists')]),
        expected_goals_conceded: Number(r[colIdx('expected_goals_conceded')]),
        clean_sheet: Number(r[colIdx('clean_sheets')]) > 0,
        goals_conceded: Number(r[colIdx('goals_conceded')]),
        saves: Number(r[colIdx('saves')]),
        penalty_saves: Number(r[colIdx('penalties_saved')]),
        fpl_tackles: 0,
        fpl_cbi: 0,
        fpl_recoveries: 0,
        fpl_def_contrib: 0,
      };

      const rating = calculateMatchRating(rawStats as any, pos as any, refStats, pos as any);
      totalPointsV2 += rating.fantasyPoints;
      sumV1 += Number(r[colIdx('total_points')]);
    }

    const ppgV2 = totalPointsV2 / played.length;

    posLeaders[pos].push({
      name,
      team: teamName,
      ppgV2,
      totalV2: totalPointsV2,
      gp: played.length,
      ppgV1: sumV1 / played.length // this is the official FPL PPG from last season
    });
  }

  console.log("\n==========================================================================================");
  console.log("                VAASTAV 2024-25 HISTORICAL GAFFA V2 LEADERBOARDS (ATTACKERS & AMs)         ");
  console.log("==========================================================================================");

  for (const pos of POSITIONS) {
    console.log(`\n--- POSITION: ${pos} ---`);
    const sorted = posLeaders[pos].sort((a, b) => b.ppgV2 - a.ppgV2).slice(0, 10);
    const tableData = sorted.map((p, idx) => {
      return {
        Rank: idx + 1,
        Name: p.name,
        Team: p.team,
        GP: p.gp,
        'FPL PPG': p.ppgV1.toFixed(2),
        'Gaffa V2 PPG': p.ppgV2.toFixed(2),
        'Gaffa Total V2': p.totalV2.toFixed(1)
      };
    });
    console.table(tableData);
  }
})();
