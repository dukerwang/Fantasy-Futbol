const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables from .env.local
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INPUT_FILE = path.join(__dirname, '..', 'sofifa_positions.json');

const POS_MAP = {
  GK: 'GK',
  SW: 'CB',
  RWB: 'RWB',
  RB: 'RB',
  RCB: 'CB',
  CB: 'CB',
  LCB: 'CB',
  LB: 'LB',
  LWB: 'LWB',
  RDM: 'DM',
  CDM: 'DM',
  LDM: 'DM',
  RM: 'RM',
  RCM: 'CM',
  CM: 'CM',
  LCM: 'CM',
  LM: 'LM',
  RAM: 'AM',
  CAM: 'AM',
  LAM: 'AM',
  RF: 'RW',
  CF: 'ST',
  LF: 'LW',
  RW: 'RW',
  RS: 'ST',
  ST: 'ST',
  LS: 'ST',
  LW: 'LW',
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

function firstLast(name) {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

async function main() {
  const sofifaPlayers = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Load active wingbacks/fullbacks from DB
  const { data: dbPlayers, error } = await supabase
    .from('players')
    .select('id, name, web_name, primary_position, secondary_positions')
    .eq('is_active', true);

  if (error || !dbPlayers) {
    console.error('Failed to fetch players:', error);
    process.exit(1);
  }

  const nameMap = new Map();
  function addToMap(key, player) {
    if (!key) return;
    if (!nameMap.has(key)) {
      nameMap.set(key, player);
    }
  }
  for (const p of dbPlayers) {
    const normFull = normalizeName(p.name);
    const normWeb = p.web_name ? normalizeName(p.web_name) : null;
    addToMap(normFull, p);
    addToMap(normWeb, p);
    addToMap(firstLast(normFull), p);
    if (normWeb) addToMap(firstLast(normWeb), p);

    const fullParts = normFull.split(' ').filter(Boolean);
    if (fullParts.length === 2) {
      addToMap(`${fullParts[1]} ${fullParts[0]}`, p);
    }
    if (normWeb) {
      const webParts = normWeb.split(' ').filter(Boolean);
      if (webParts.length === 2) {
        addToMap(`${webParts[1]} ${webParts[0]}`, p);
      }
    }
  }

  const MANUAL_OVERRIDES = {
    'Louis Jordan Beyer': 'Jordan Beyer',
    'Toluwalase Emmanuel Arokodare': 'Tolu Arokodare',
    'Alejandro Jiménez Sánchez': 'Álex Jiménez Sánchez',
    'Tóth Alex László': 'Alex Tóth',
    'Xavier Quentin Shay Simons': 'Xavi Simons',
    'Valentín Mariano José Castellanos Giménez': 'Valentín Castellanos',
    'Abdul-Nasir Oluwatosin Oluwadoyinsolami Adarabioyo': 'Tosin Adarabioyo',
    'Eli Junior Eric Anat Kroupi': 'Junior Kroupi',
    'Eli Junior Kroupi': 'Junior Kroupi',
    'Adilson Angel Abreu de Almeida Gomés': 'Angel Gomes',
    'James William McConnell': 'James McConnell',
    'Lewis William Orford': 'Lewis Orford',
    'Daniel Muñoz Mejía': 'Daniel Muñoz'
  };

  const results = [];

  for (const sp of sofifaPlayers) {
    if (!sp.positions || sp.positions.length === 0) continue;

    const rawPositions = sp.positions.map(p => POS_MAP[p]).filter(Boolean);
    if (rawPositions.length === 0) continue;

    const allRaw = new Set(sp.positions);
    const hasLB = allRaw.has('LB') || allRaw.has('LWB');
    const hasLM = allRaw.has('LM');
    const hasLW = allRaw.has('LW') || allRaw.has('LF');
    const isLWB = hasLB && hasLM;
    
    const hasRB = allRaw.has('RB') || allRaw.has('RWB');
    const hasRM = allRaw.has('RM');
    const hasRW = allRaw.has('RW') || allRaw.has('RF');
    const isRWB = hasRB && hasRM;

    const finalSet = new Set();
    
    if (isLWB) {
      finalSet.add('LWB');
      if (!hasLW) finalSet.add('LB');
    } else {
      if (hasLB) finalSet.add('LB');
      if (hasLM) finalSet.add('LW');
    }
    if (hasLW) finalSet.add('LW');

    if (isRWB) {
      finalSet.add('RWB');
      if (!hasRW) finalSet.add('RB');
    } else {
      if (hasRB) finalSet.add('RB');
      if (hasRM) finalSet.add('RW');
    }
    if (hasRW) finalSet.add('RW');

    for (const raw of sp.positions) {
      const mapped = POS_MAP[raw];
      if (mapped && !['LB', 'RB', 'LW', 'RW', 'LWB', 'RWB', 'LM', 'RM', 'LF', 'RF'].includes(raw)) {
        finalSet.add(mapped);
      }
    }

    const allFinal = Array.from(finalSet);
    const sofifaPrimaryRaw = sp.positions[0];
    let primary = POS_MAP[sofifaPrimaryRaw];
    
    if (sofifaPrimaryRaw === 'LM') primary = isLWB ? 'LWB' : 'LW';
    if (sofifaPrimaryRaw === 'RM') primary = isRWB ? 'RWB' : 'RW';

    const isDefender = ['CB', 'LB', 'RB'].includes(POS_MAP[sofifaPrimaryRaw]);
    if (isLWB && hasLW) primary = isDefender ? 'LWB' : 'LW';
    if (isRWB && hasRW) primary = isDefender ? 'RWB' : 'RW';

    if (isLWB && !hasLW && ['LB', 'LWB'].includes(primary)) primary = 'LWB';
    if (isRWB && !hasRW && ['RB', 'RWB'].includes(primary)) primary = 'RWB';

    const secondary = allFinal.filter(p => p !== primary);
    const normFull = normalizeName(sp.full_name || sp.short_name);
    const normShort = normalizeName(sp.short_name);
    const candidates = [...new Set([
      normFull, normShort,
      firstLast(normFull), firstLast(normShort),
    ])].filter(Boolean);

    let dbMatch = null;
    for (const c of candidates) {
      dbMatch = nameMap.get(c) ?? null;
      if (dbMatch) break;
    }

    if (!dbMatch && MANUAL_OVERRIDES[sp.full_name]) {
      const overrideName = normalizeName(MANUAL_OVERRIDES[sp.full_name]);
      dbMatch = nameMap.get(overrideName) ?? null;
    }
    if (!dbMatch && MANUAL_OVERRIDES[sp.short_name]) {
      const overrideName = normalizeName(MANUAL_OVERRIDES[sp.short_name]);
      dbMatch = nameMap.get(overrideName) ?? null;
    }

    if (dbMatch) {
      results.push({
        name: dbMatch.name,
        dbPrimary: dbMatch.primary_position,
        dbSecondary: dbMatch.secondary_positions,
        sofifaPrimary: primary,
        sofifaSecondary: secondary,
        matchPositions: sp.positions
      });
    }
  }

  // Filter for fullback/wingback primary position in DB
  const audited = results.filter(r => ['LWB', 'RWB', 'LB', 'RB'].includes(r.dbPrimary));
  console.log(`Auditing ${audited.length} matched fullbacks/wingbacks:`);
  
  const mismatched = audited.filter(a => {
    const primDiff = a.dbPrimary !== a.sofifaPrimary;
    const secDiff = JSON.stringify(a.dbSecondary || []) !== JSON.stringify(a.sofifaSecondary || []);
    return primDiff || secDiff;
  });

  console.log(`\nFound ${mismatched.length} players with mismatches in primary or secondary positions.`);
  mismatched.forEach(m => {
    console.log(`\nPlayer: ${m.name}`);
    console.log(`  SoFIFA raw positions: ${JSON.stringify(m.matchPositions)}`);
    console.log(`  DB primary: ${m.dbPrimary} | Expected: ${m.sofifaPrimary}`);
    console.log(`  DB secondary: ${JSON.stringify(m.dbSecondary)} | Expected: ${JSON.stringify(m.sofifaSecondary)}`);
  });
}

main().catch(console.error);
