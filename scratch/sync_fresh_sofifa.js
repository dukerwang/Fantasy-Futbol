process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

async function syncFreshSofifa() {
  console.log('=====================================================');
  console.log('   APPLYING FRESHLY SCRAPED SOFIFA DATA TO DB');
  console.log('=====================================================\n');

  const dataPath = path.join(__dirname, '..', 'scraped-sofifa.json');
  if (!fs.existsSync(dataPath)) {
    console.error('scraped-sofifa.json not found!');
    return;
  }

  const teams = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`Loaded ${teams.length} team rosters from freshly scraped dataset.`);

  const { data: dbPlayers } = await supabase.from('players').select('id, name, web_name, primary_position').eq('is_active', true);
  const nameMap = new Map();
  (dbPlayers || []).forEach(p => {
    nameMap.set(normalizeName(p.name), p);
    if (p.web_name) nameMap.set(normalizeName(p.web_name), p);
  });

  let matched = 0;
  const updates = [];

  for (const team of teams) {
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

      const dbMatch = nameMap.get(normFull) || nameMap.get(normCommon);
      if (dbMatch) {
        matched++;
        updates.push({
          id: dbMatch.id,
          primary_position: primaryPos,
          secondary_positions: Array.from(new Set(secondaries))
        });
      }
    }
  }

  console.log(`Matched ${matched} / ${dbPlayers.length} active players with fresh live SoFIFA positions.`);

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({
      primary_position: u.primary_position,
      secondary_positions: u.secondary_positions
    }).eq('id', u.id)));
  }

  console.log('✅ Fresh Live SoFIFA Position Sync Complete!');
}

syncFreshSofifa().catch(console.error);
