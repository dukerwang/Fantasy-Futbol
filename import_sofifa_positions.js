/**
 * Reads sofifa_positions.json (output from scrape_sofifa_positions.py) and
 * updates primary_position + secondary_positions for all matched players in DB.
 *
 * Usage:
 *   node import_sofifa_positions.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const stringSimilarity = require('string-similarity');

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

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INPUT_FILE = path.join(__dirname, 'sofifa_positions.json');

// ── SoFIFA abbreviation → our GranularPosition ───────────────────────────────
const POS_MAP = {
  GK: 'GK',
  SW: 'CB',   // sweeper
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
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .toLowerCase()
    .replace(/ß/g, 'ss')             // German Eszett
    .replace(/-/g, ' ')              // Replace hyphens with space
    .replace(/[^a-z0-9 ]/g, '')      // Strip other non-alphanumeric except spaces
    .replace(/\s+/g, ' ')            // Normalize multiple spaces
    .trim();
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Missing ${INPUT_FILE} — run scrape_sofifa_positions.py first`);
    process.exit(1);
  }

  const sofifaPlayers = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  console.log(`Loaded ${sofifaPlayers.length} players from sofifa_positions.json`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Load active players from DB
  const { data: dbPlayers, error } = await supabase
    .from('players')
    .select('id, name, web_name')
    .eq('is_active', true);

  if (error || !dbPlayers) {
    console.error('Failed to fetch players from DB:', error);
    process.exit(1);
  }
  console.log(`Loaded ${dbPlayers.length} players from DB`);

  // Returns "first last" by taking only the first and last word of a multi-word name.
  // Handles middle names on either side (SoFIFA full names and FPL DB names).
  function firstLast(name) {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length <= 2) return name;
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }

  // Build name lookup — index every variant: full, web, first+last, and reversed 2-word names
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

    // Reverse 2-word names to support order variations (e.g. Endo Wataru <-> Wataru Endo)
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

  // Process each sofifa player
  const updates = [];
  let matched = 0;
  let unmatched = [];

  for (const sp of sofifaPlayers) {
    if (!sp.positions || sp.positions.length === 0) continue;

    const rawPositions = sp.positions.map(p => POS_MAP[p]).filter(Boolean);
    if (rawPositions.length === 0) continue;

    // ── New Hybrid Wide Player Rules ───────────────────────────────────────────
    const allRaw = new Set(sp.positions);
    
    // Left Side Traits
    const hasLB = allRaw.has('LB') || allRaw.has('LWB');
    const hasLM = allRaw.has('LM');
    const hasLW = allRaw.has('LW') || allRaw.has('LF');
    const isLWB = hasLB && hasLM;
    
    // Right Side Traits
    const hasRB = allRaw.has('RB') || allRaw.has('RWB');
    const hasRM = allRaw.has('RM');
    const hasRW = allRaw.has('RW') || allRaw.has('RF');
    const isRWB = hasRB && hasRM;

    // Build Final Positions set
    const finalSet = new Set();
    
    // Process Left Side
    if (isLWB) {
      finalSet.add('LWB');
      if (!hasLW) finalSet.add('LB'); // Keep LB only if no LW
    } else {
      if (hasLB) finalSet.add('LB');
      if (hasLM) finalSet.add('LW'); // LM -> LW if no FB
    }
    if (hasLW) finalSet.add('LW');

    // Process Right Side
    if (isRWB) {
      finalSet.add('RWB');
      if (!hasRW) finalSet.add('RB'); // Keep RB only if no RW
    } else {
      if (hasRB) finalSet.add('RB');
      if (hasRM) finalSet.add('RW'); // RM -> RW if no FB
    }
    if (hasRW) finalSet.add('RW');

    // Add other positions (GK, CB, DM, CM, AM, ST)
    for (const raw of sp.positions) {
      const mapped = POS_MAP[raw];
      if (mapped && !['LB', 'RB', 'LW', 'RW', 'LWB', 'RWB', 'LM', 'RM', 'LF', 'RF'].includes(raw)) {
        finalSet.add(mapped);
      }
    }

    const allFinal = Array.from(finalSet);
    
    // Determine Primary
    const sofifaPrimaryRaw = sp.positions[0];
    let primary = POS_MAP[sofifaPrimaryRaw];
    
    // Basic conversion for primary if it was LM/RM
    if (sofifaPrimaryRaw === 'LM') primary = isLWB ? 'LWB' : 'LW';
    if (sofifaPrimaryRaw === 'RM') primary = isRWB ? 'RWB' : 'RW';

    // Refinement Logic
    const isDefender = ['CB', 'LB', 'RB'].includes(POS_MAP[sofifaPrimaryRaw]);
    
    // Rule: LW/RW vs LWB/RWB dominance
    if (isLWB && hasLW) {
      primary = isDefender ? 'LWB' : 'LW';
    }
    if (isRWB && hasRW) {
      primary = isDefender ? 'RWB' : 'RW';
    }

    // Rule: LWB/RWB priority over LB/RB if no winger exists
    if (isLWB && !hasLW && ['LB', 'LWB'].includes(primary)) primary = 'LWB';
    if (isRWB && !hasRW && ['RB', 'RWB'].includes(primary)) primary = 'RWB';

    // Final primary/secondary split
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

    if (!dbMatch && MANUAL_OVERRIDES[sp.full_name]) {
      const overrideName = normalizeName(MANUAL_OVERRIDES[sp.full_name]);
      dbMatch = nameMap.get(overrideName) ?? null;
    }

    if (!dbMatch && MANUAL_OVERRIDES[sp.short_name]) {
      const overrideName = normalizeName(MANUAL_OVERRIDES[sp.short_name]);
      dbMatch = nameMap.get(overrideName) ?? null;
    }

    // Fuzzy matching is completely disabled to guarantee 100% precision and zero false positives.

    if (dbMatch) {
      matched++;
      updates.push({ id: dbMatch.id, primary_position: primary, secondary_positions: secondary });
    } else {
      unmatched.push(sp.full_name || sp.short_name);
    }
  }

  console.log(`Matched: ${matched}, Unmatched: ${unmatched.length}`);
  if (unmatched.length > 0 && unmatched.length <= 20) {
    console.log('Unmatched:', unmatched);
  }

  // Batch update DB
  if (updates.length === 0) {
    console.log('No updates to write.');
    return;
  }

  const CHUNK = 50;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(u =>
        supabase
          .from('players')
          .update({ primary_position: u.primary_position, secondary_positions: u.secondary_positions })
          .eq('id', u.id)
      )
    );
    for (const r of results) {
      if (r.error) console.error('Update error:', r.error);
    }
    process.stdout.write(`\rUpdated ${Math.min(i + CHUNK, updates.length)}/${updates.length}...`);
  }

  console.log(`\nDone — updated ${updates.length} players.`);
}

main().catch(err => { console.error(err); process.exit(1); });
