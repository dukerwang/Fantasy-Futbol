import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import stringSimilarity from 'string-similarity';
import type { GranularPosition } from '../src/types';

// Load env variables manually from .env.local
const envContent = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const POS_MAP: Record<string, GranularPosition | 'LM' | 'RM'> = {
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
  DM: 'DM',
  AM: 'AM',
};

function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ß/g, 'ss')             // German Eszett
    .replace(/-/g, ' ')              // Replace hyphens with space
    .replace(/[^a-z0-9 ]/g, '')      // Strip other non-alphanumeric except spaces
    .replace(/\s+/g, ' ')            // Normalize multiple spaces
    .trim();
}

function firstLast(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Fetch DB players
  const { data: dbPlayers, error: fetchError } = await supabase
    .from('players')
    .select('id, name, web_name, primary_position, secondary_positions')
    .eq('is_active', true);

  if (fetchError || !dbPlayers) {
    console.error('Failed to fetch players from DB:', fetchError);
    return;
  }
  console.log(`Loaded ${dbPlayers.length} active players from DB.`);

  const nameMap = new Map<string, any>();
  const nameList: string[] = [];

  function addToMap(key: string | null, player: any) {
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

  // 2. Load scraped data
  const scrapedPath = path.join(__dirname, '../scraped-sofifa.json');
  if (!fs.existsSync(scrapedPath)) {
    console.error('Missing scraped-sofifa.json');
    return;
  }
  const teams = JSON.parse(fs.readFileSync(scrapedPath, 'utf8'));
  console.log(`Loaded ${teams.length} teams from scraped-sofifa.json.`);

  const updates: Array<{
    id: string;
    name: string;
    primary_position: GranularPosition;
    secondary_positions: GranularPosition[];
  }> = [];
  let matched = 0;

  for (const t of teams) {
    for (const sp of t.players || []) {
      if (!sp.positions || sp.positions.length === 0) continue;

      // Rule logic identical to route.ts
      const positionsRaw: string[] = [...sp.positions];
      const sofifaPrimaryRaw = positionsRaw[0];
      const roles: string[] = sp.roles || [];

      const allRaw = new Set(positionsRaw);
      const hasLB = allRaw.has('LB') || allRaw.has('LWB');
      const hasLM = allRaw.has('LM');
      const hasLW = allRaw.has('LW') || allRaw.has('LF');
      const hasRB = allRaw.has('RB') || allRaw.has('RWB');
      const hasRM = allRaw.has('RM');
      const hasRW = allRaw.has('RW') || allRaw.has('RF');
      const hasBothMid = hasLM && hasRM;
      const hasOnlyOneFB = (hasLB && !hasRB) || (!hasLB && hasRB);

      const finalSet = new Set<GranularPosition>();
      let primary: GranularPosition = POS_MAP[sofifaPrimaryRaw] as GranularPosition;

      const applySide = (
        side: 'L' | 'R',
        hasFB: boolean,
        hasMid: boolean,
        hasWing: boolean
      ) => {
        const fb = `${side}B` as GranularPosition;
        const wb = `${side}WB` as GranularPosition;
        const wing = `${side}W` as GranularPosition;
        const midRaw = `${side}M`;
        const fbRaw = `${side}B`;
        const wingRaw = `${side}W`;

        const pCat = sofifaPrimaryRaw === midRaw ? 'mid' : sofifaPrimaryRaw === wingRaw ? 'wing' : sofifaPrimaryRaw === fbRaw ? 'fb' : 'other';

        // Special Case: both lm/rm, but only one lb/rb -> evaluate before roles
        if (hasBothMid && hasOnlyOneFB) {
          if (hasMid) {
            finalSet.add(wing);
            if (pCat === 'mid' || pCat === 'wing') primary = wing;
          }
          if (hasFB) {
            finalSet.add(wb);
            if (pCat === 'fb') primary = wb;
          }
          return;
        }

        // 1. Does not have both FB and Mid for this side
        if (!hasFB || !hasMid) {
          if (hasMid) {
            finalSet.add(wing);
            if (pCat === 'mid') primary = wing;
          }
          if (hasWing) {
            finalSet.add(wing);
            if (pCat === 'wing') primary = wing;
          }
          if (hasFB) {
            finalSet.add(fb);
            if (pCat === 'fb') primary = fb;
          }
          return;
        }

        // 2. Has FB, Mid, and Wing -> Check Primary Position
        if (hasFB && hasMid && hasWing) {
          if (pCat === 'mid' || pCat === 'wing') {
            primary = wing;
            finalSet.add(wing);
            finalSet.add(wb);
          } else if (pCat === 'fb') {
            primary = wb;
            finalSet.add(wb);
            finalSet.add(wing);
          } else {
            finalSet.add(wing);
            finalSet.add(wb);
          }
          return;
        }

        // 3. Has FB and Mid but no Wing -> Look at roles
        if (hasFB && hasMid && !hasWing) {
          const firstRoleLower = (roles[0] || '').toLowerCase();
          const isAttackingOrInverted = firstRoleLower.includes('attacking wingback') || firstRoleLower.includes('inverted wingback');

          if (isAttackingOrInverted) {
            if (pCat === 'fb' || pCat === 'mid') primary = wb;
            finalSet.add(wb);
            finalSet.add(fb);
          } else {
            if (pCat === 'fb' || pCat === 'mid') primary = fb;
            finalSet.add(fb);
            finalSet.add(wb);
          }
          return;
        }
      };

      applySide('L', hasLB, hasLM, hasLW);
      applySide('R', hasRB, hasRM, hasRW);

      // Add other positions (GK, CB, DM, CM, AM, ST)
      for (const raw of positionsRaw) {
        const mapped = POS_MAP[raw];
        if (mapped && !['LB', 'RB', 'LW', 'RW', 'LWB', 'RWB', 'LM', 'RM', 'LF', 'RF'].includes(raw)) {
          finalSet.add(mapped as GranularPosition);
        }
      }

      if (primary && !finalSet.has(primary)) {
        finalSet.add(primary);
      }

      const finalSecondary = Array.from(finalSet).filter(p => p !== primary);

      const fullName = sp.fullName || [sp.firstName, sp.lastName].filter(Boolean).join(' ');
      const common = sp.commonName || '';
      const normFull = normalizeName(fullName);
      const normCommon = normalizeName(common);

      const candidates = Array.from(new Set([
        normFull, normCommon,
        firstLast(normFull), firstLast(normCommon),
      ])).filter(Boolean);

      let dbMatch = null;
      for (const c of candidates) {
        dbMatch = nameMap.get(c) ?? null;
        if (dbMatch) break;
      }

      const MANUAL_OVERRIDES: Record<string, string> = {
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
        'Lewis William Orford': 'Lewis Orford'
      };

      if (!dbMatch && MANUAL_OVERRIDES[fullName]) {
        dbMatch = nameMap.get(normalizeName(MANUAL_OVERRIDES[fullName])) ?? null;
      }
      if (!dbMatch && common && MANUAL_OVERRIDES[common]) {
        dbMatch = nameMap.get(normalizeName(MANUAL_OVERRIDES[common])) ?? null;
      }

      // Fuzzy matching is disabled as per zero false positive guideline
      if (dbMatch) {
        matched++;
        updates.push({
          id: dbMatch.id,
          name: dbMatch.name,
          primary_position: primary,
          secondary_positions: finalSecondary
        });
      }
    }
  }

  console.log(`\nMatched ${matched} players total.`);
  console.log(`Writing updates to Supabase...`);

  const CHUNK = 50;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(u =>
        supabase
          .from('players')
          .update({
            primary_position: u.primary_position,
            secondary_positions: u.secondary_positions,
          })
          .eq('id', u.id)
          .then(({ error }) => {
            if (error) console.error(`Error updating ${u.name}:`, error);
          })
      )
    );
    process.stdout.write(`\rUpdated ${Math.min(i + CHUNK, updates.length)}/${updates.length}...`);
  }
  console.log(`\nAll done!`);
}

main().catch(console.error);
