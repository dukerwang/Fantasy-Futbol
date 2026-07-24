process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SOFIFA_POS_MAP = {
  GK: 'GK', SW: 'CB', RWB: 'RWB', RB: 'RB', RCB: 'CB', CB: 'CB', LCB: 'CB', LB: 'LB', LWB: 'LWB',
  RDM: 'DM', CDM: 'DM', LDM: 'DM', RM: 'RW', RCM: 'CM', CM: 'CM', LCM: 'CM', LM: 'LW', RAM: 'AM',
  CAM: 'AM', LAM: 'AM', RF: 'RW', CF: 'ST', LF: 'LW', RW: 'RW', RS: 'ST', ST: 'ST', LS: 'ST', LW: 'LW',
  DM: 'DM', AM: 'AM'
};

function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMarketValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return isNaN(raw) ? null : raw;
  const s = String(raw).trim().replace(/,/g, '').replace(/\s/g, '');
  if (!s || s === '-' || s === 'N/A') return null;
  const clean = s.replace(/^[€$£]/, '');
  const lower = clean.toLowerCase();
  if (lower.endsWith('bn')) return parseFloat(lower) * 1000;
  if (lower.endsWith('m')) return parseFloat(lower);
  if (lower.endsWith('k')) return parseFloat(lower) / 1000;
  const num = parseFloat(clean);
  return isNaN(num) ? null : num;
}

async function runFullSync() {
  console.log('=====================================================');
  console.log('   STARTING FULL GAFFA 2026/27 SEASON SYNC');
  console.log('=====================================================\n');

  // STEP 0: Safety Check - verify legacy stats tables
  const { count: archivedCount } = await supabase.from('season_player_stats_archive').select('*', { count: 'exact', head: true });
  const { count: gwStatsCount } = await supabase.from('player_stats').select('*', { count: 'exact', head: true });
  console.log(`[Safety Check] Season Player Stats Archive Count: ${archivedCount ?? 0}`);
  console.log(`[Safety Check] Player Stats Count: ${gwStatsCount ?? 0}\n`);

  // STEP 1: FPL Import & Deactivation Sync
  console.log('--- Step 1: FPL Player Sync ---');
  // Dynamically load tsx to run syncPlayersFromFpl
  const { syncPlayersFromFpl } = await import('../src/lib/players/syncPlayers.ts');
  const syncRes = await syncPlayersFromFpl(supabase);
  console.log('FPL Player Sync result:', syncRes);
  console.log('FPL Player Sync complete.\n');

  // STEP 2: Transfermarkt Market Values Sync
  console.log('--- Step 2: Transfermarkt Market Value Sync ---');
  const tmRaw = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'players.json'), 'utf-8');
  const tmData = JSON.parse(tmRaw);

  const { data: activePlayers } = await supabase.from('players').select('id, name, web_name, pl_team, market_value').eq('is_active', true);
  const activeNames = (activePlayers || []).map(p => p.name);

  let tmMatched = 0;
  const tmUpdates = [];

  for (const tmRow of tmData) {
    if (!tmRow.player_name) continue;
    const mv = parseMarketValue(tmRow.market_value_raw);
    if (mv == null) continue;

    const match = stringSimilarity.findBestMatch(tmRow.player_name, activeNames);
    if (match.bestMatch.rating >= 0.75) {
      const dbP = activePlayers.find(p => p.name === match.bestMatch.target);
      if (dbP) {
        tmMatched++;
        tmUpdates.push({
          id: dbP.id,
          market_value: mv,
          market_value_updated_at: new Date().toISOString()
        });
      }
    }
  }

  console.log(`Transfermarkt Sync: Matched ${tmMatched} players with market values.`);
  for (let i = 0; i < tmUpdates.length; i += 100) {
    const chunk = tmUpdates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({ market_value: u.market_value, market_value_updated_at: u.market_value_updated_at }).eq('id', u.id)));
  }
  console.log('Transfermarkt Market Value Sync complete.\n');

  // STEP 3: SoFIFA Position Sync
  console.log('--- Step 3: SoFIFA Position Sync ---');
  const sofifaRaw = fs.readFileSync(path.join(__dirname, '..', 'scraped-sofifa.json'), 'utf-8');
  const sofifaTeams = JSON.parse(sofifaRaw);

  const { data: currentDbPlayers } = await supabase.from('players').select('id, name, web_name, primary_position').eq('is_active', true);
  const dbNameMap = new Map();
  (currentDbPlayers || []).forEach(p => {
    dbNameMap.set(normalizeName(p.name), p);
    if (p.web_name) dbNameMap.set(normalizeName(p.web_name), p);
  });

  let sofifaMatched = 0;
  const posUpdates = [];

  for (const team of sofifaTeams) {
    for (const sp of (team.players || [])) {
      const rawPositions = sp.positions || [];
      if (rawPositions.length === 0) continue;

      const primaryRaw = rawPositions[0];
      const primaryPos = SOFIFA_POS_MAP[primaryRaw];
      if (!primaryPos) continue;

      const secondaries = rawPositions.slice(1).map(r => SOFIFA_POS_MAP[r]).filter(p => p && p !== primaryPos);

      const fullName = sp.fullName || `${sp.firstName || ''} ${sp.lastName || ''}`.trim();
      const normFull = normalizeName(fullName);
      const normCommon = normalizeName(sp.commonName || '');

      const dbMatch = dbNameMap.get(normFull) || dbNameMap.get(normCommon);
      if (dbMatch) {
        sofifaMatched++;
        posUpdates.push({
          id: dbMatch.id,
          primary_position: primaryPos,
          secondary_positions: Array.from(new Set(secondaries))
        });
      }
    }
  }

  console.log(`SoFIFA Sync: Matched positions for ${sofifaMatched} players.`);
  for (let i = 0; i < posUpdates.length; i += 100) {
    const chunk = posUpdates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({ primary_position: u.primary_position, secondary_positions: u.secondary_positions }).eq('id', u.id)));
  }
  console.log('SoFIFA Position Sync complete.\n');

  // STEP 4: Post-sync Safety Check
  const { count: postArchivedCount } = await supabase.from('season_player_stats_archive').select('*', { count: 'exact', head: true });
  const { count: postGwStatsCount } = await supabase.from('player_stats').select('*', { count: 'exact', head: true });
  
  console.log('=====================================================');
  console.log('   FULL SYNC COMPLETE & VERIFIED');
  console.log('=====================================================');
  console.log(`Season Player Stats Archive intact: ${postArchivedCount === archivedCount} (${postArchivedCount} records)`);
  console.log(`Player Stats intact: ${postGwStatsCount === gwStatsCount} (${postGwStatsCount} records)`);
}

runFullSync().catch(console.error);
