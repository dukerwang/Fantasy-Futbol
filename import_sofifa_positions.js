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

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INPUT_FILE = path.join(__dirname, 'sofifa_positions.json');

// ── SoFIFA abbreviation → our GranularPosition ───────────────────────────────
const POS_MAP = {
  GK: 'GK',
  SW: 'CB',   // sweeper
  RWB: 'RB',
  RB: 'RB',
  RCB: 'CB',
  CB: 'CB',
  LCB: 'CB',
  LB: 'LB',
  LWB: 'LB',
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
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
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

  // Build name lookup — index every variant: full, web, and first+last shorthand
  const nameMap = new Map();
  const nameList = [];
  function addToMap(key, player) {
    if (!key) return;
    if (!nameMap.has(key)) {
      nameMap.set(key, player);
      nameList.push(key);
    }
  }
  for (const p of dbPlayers) {
    const normFull = normalizeName(p.name);
    const normWeb = p.web_name ? normalizeName(p.web_name) : null;
    addToMap(normFull, p);
    addToMap(normWeb, p);
    addToMap(firstLast(normFull), p);
    if (normWeb) addToMap(firstLast(normWeb), p);
  }

  // Process each sofifa player
  const updates = [];
  let matched = 0;
  let unmatched = [];

  for (const sp of sofifaPlayers) {
    if (!sp.positions || sp.positions.length === 0) continue;

    // Map positions to GranularPosition, deduplicate
    const granular = [...new Set(sp.positions.map(p => POS_MAP[p]).filter(Boolean))];
    if (granular.length === 0) continue;

    const primary = granular[0];
    const secondary = granular.slice(1);

    // Build match candidates: full name, short name, and first+last variants of each
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
      'Adilson Angel Abreu de Almeida Gomés': 'Angel Gomes',
      'James William McConnell': 'James McConnell',
      'Lewis William Orford': 'Lewis Orford'
    };

    if (!dbMatch && MANUAL_OVERRIDES[sp.full_name]) {
      const overrideName = normalizeName(MANUAL_OVERRIDES[sp.full_name]);
      dbMatch = nameMap.get(overrideName) ?? null;
    }

    if (!dbMatch && MANUAL_OVERRIDES[sp.short_name]) {
      const overrideName = normalizeName(MANUAL_OVERRIDES[sp.short_name]);
      dbMatch = nameMap.get(overrideName) ?? null;
    }

    if (!dbMatch) {
      // Fuzzy fallback
      for (const candidate of candidates) {
        if (nameList.length === 0) continue;
        const { bestMatch } = stringSimilarity.findBestMatch(candidate, nameList);
        if (bestMatch.rating > 0.82) {
          dbMatch = nameMap.get(bestMatch.target) ?? null;
          break;
        }
      }
    }

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
    await Promise.all(
      chunk.map(u =>
        supabase
          .from('players')
          .update({ primary_position: u.primary_position, secondary_positions: u.secondary_positions })
          .eq('id', u.id)
      )
    );
    process.stdout.write(`\rUpdated ${Math.min(i + CHUNK, updates.length)}/${updates.length}...`);
  }

  console.log(`\nDone — updated ${updates.length} players.`);
}

main().catch(err => { console.error(err); process.exit(1); });
