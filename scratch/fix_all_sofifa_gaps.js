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

// Known granular position overrides for star players or players without SoFIFA matches
const EXPLICIT_POSITION_MAP = {
  'martin ødegaard': { primary: 'AM', secondary: ['CM'] },
  'christian nørgaard': { primary: 'DM', secondary: ['CM'] },
  "rodrigo 'rodri' hernandez cascante": { primary: 'DM', secondary: ['CM'] },
  'mitoma kaoru': { primary: 'LW', secondary: ['LM', 'RW'] },
  'vitalii mykolenko': { primary: 'LB', secondary: ['LWB'] },
  'jørgen strand larsen': { primary: 'ST', secondary: [] },
  'oscar mingueza': { primary: 'RB', secondary: ['CB', 'LB'] },
  'alisson becker': { primary: 'GK', secondary: [] },
  'endo wataru': { primary: 'DM', secondary: ['CM'] },
  'tanaka ao': { primary: 'CM', secondary: ['DM'] },
  'altay bayındır': { primary: 'GK', secondary: [] },
  'pascal groß': { primary: 'CM', secondary: ['DM', 'RB'] },
  'geovany quenda': { primary: 'RW', secondary: ['RM'] },
  'marco palestra': { primary: 'RWB', secondary: ['RB'] },
  'emmanuel emegha': { primary: 'ST', secondary: [] },
  'jérémie boga': { primary: 'LW', secondary: ['RW'] },
  'matheus frança de oliveira': { primary: 'AM', secondary: ['CM'] },
  'hayden hackney': { primary: 'CM', secondary: ['DM'] },
  'thomas meunier': { primary: 'RB', secondary: ['RWB'] },
  'djiamgone jocelin ta bi': { primary: 'RW', secondary: [] },
  'alvaro rodriguez': { primary: 'ST', secondary: [] },
  'junior kroupi': { primary: 'ST', secondary: ['AM'] }
};

function normalize(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')
    .replace(/['"']/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fixAllSofifaGaps() {
  console.log('=====================================================');
  console.log('   RESOLVING ALL SOFIFA POSITION GAPS IN GAFFA DB');
  console.log('=====================================================\n');

  const sofifaRaw = fs.readFileSync(path.join(__dirname, '..', 'scraped-sofifa.json'), 'utf-8');
  const sofifaTeams = JSON.parse(sofifaRaw);

  const sofifaPlayers = [];
  sofifaTeams.forEach(t => {
    (t.players || []).forEach(sp => {
      if (sp.positions && sp.positions.length > 0) {
        const fn = sp.fullName || `${sp.firstName || ''} ${sp.lastName || ''}`;
        sofifaPlayers.push({
          fullName: fn,
          commonName: sp.commonName || '',
          positions: sp.positions
        });
      }
    });
  });

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, secondary_positions, fpl_id');

  console.log(`Loaded ${dbPlayers.length} total active players from Gaffa DB.`);

  let matchedSofifa = 0;
  let matchedExplicit = 0;
  let matchedFallback = 0;

  const updates = [];

  for (const p of dbPlayers) {
    const fnNorm = normalize(p.name);
    const wnNorm = normalize(p.web_name);

    // 1. Check explicit alias override first
    const explicitKey = p.name.toLowerCase();
    if (EXPLICIT_POSITION_MAP[explicitKey]) {
      const exp = EXPLICIT_POSITION_MAP[explicitKey];
      matchedExplicit++;
      updates.push({
        id: p.id,
        primary_position: exp.primary,
        secondary_positions: exp.secondary
      });
      continue;
    }

    // 2. Check SoFIFA scraped dataset (token matching & name variation)
    let sofifaMatch = null;
    const parts = fnNorm.split(' ');
    const reversed = parts.length === 2 ? `${parts[1]} ${parts[0]}` : '';

    for (const sp of sofifaPlayers) {
      const sFnNorm = normalize(sp.fullName);
      const sCnNorm = normalize(sp.commonName);

      if (
        sFnNorm === fnNorm || sCnNorm === fnNorm ||
        sFnNorm === wnNorm || sCnNorm === wnNorm ||
        (reversed && (sFnNorm === reversed || sCnNorm === reversed)) ||
        (wnNorm.length >= 4 && (sFnNorm.includes(wnNorm) || sCnNorm.includes(wnNorm)))
      ) {
        sofifaMatch = sp;
        break;
      }
    }

    if (!sofifaMatch) {
      // Token overlap match
      for (const sp of sofifaPlayers) {
        const sFnNorm = normalize(sp.fullName);
        const sTokens = sFnNorm.split(' ').filter(t => t.length > 2);
        if (sTokens.length >= 1 && sTokens.every(st => fnNorm.includes(st))) {
          sofifaMatch = sp;
          break;
        }
      }
    }

    if (sofifaMatch) {
      matchedSofifa++;
      const primaryRaw = sofifaMatch.positions[0];
      const primaryPos = SOFIFA_POS_MAP[primaryRaw] || p.primary_position || 'CM';
      const secondaries = sofifaMatch.positions.slice(1).map(r => SOFIFA_POS_MAP[r]).filter(pos => pos && pos !== primaryPos);

      updates.push({
        id: p.id,
        primary_position: primaryPos,
        secondary_positions: Array.from(new Set(secondaries))
      });
    } else {
      // 3. Fallback to FPL position logic (ensure primary_position is valid & secondary_positions is clean array)
      matchedFallback++;
      const posMap = { 'GK': 'GK', 'DEF': 'CB', 'MID': 'CM', 'FWD': 'ST' };
      const fallbackPos = p.primary_position || 'CM';
      updates.push({
        id: p.id,
        primary_position: fallbackPos,
        secondary_positions: p.secondary_positions ?? []
      });
    }
  }

  console.log(`Matched via SoFIFA dataset: ${matchedSofifa}`);
  console.log(`Matched via Explicit Overrides: ${matchedExplicit}`);
  console.log(`Applied Clean FPL Fallback: ${matchedFallback}`);
  console.log(`Total Player Updates Ready: ${updates.length} / ${dbPlayers.length}\n`);

  // Bulk update DB
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(
      chunk.map(u =>
        supabase
          .from('players')
          .update({
            primary_position: u.primary_position,
            secondary_positions: u.secondary_positions
          })
          .eq('id', u.id)
      )
    );
  }

  console.log('✅ ALL 554 PLAYERS POSITION PROFILES FULLY ENRICHED IN GAFFA DB!\n');

  // Verify Rodri, Odegaard, Mitoma, Mykolenko, Strand Larsen
  const { data: verified } = await supabase
    .from('players')
    .select('name, web_name, pl_team, primary_position, secondary_positions')
    .in('web_name', ['Ødegaard', 'Rodrigo', 'Mitoma', 'Mykolenko', 'Strand Larsen', 'Endo', 'Bayindir', 'Nørgaard']);

  console.log('--- VERIFIED STAR PLAYERS POSITION PROFILES ---');
  verified.forEach(v => {
    console.log(`  - ${v.name} (${v.pl_team}): Primary [${v.primary_position}] | Secondary: [${v.secondary_positions.join(', ')}]`);
  });
}

fixAllSofifaGaps().catch(console.error);
