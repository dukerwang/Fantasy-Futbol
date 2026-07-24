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

async function fixSofifaMatching() {
  console.log('--- ENHANCING SOFIFA POSITION MATCHING ---');

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
    .select('id, name, web_name, pl_team, primary_position, secondary_positions')
    .eq('is_active', true);

  let matched = 0;
  const updates = [];

  for (const dbP of dbPlayers) {
    const fnNorm = normalize(dbP.name);
    const wnNorm = normalize(dbP.web_name);

    // Reversed 2-word name (e.g., Endo Wataru <-> Wataru Endo)
    const parts = fnNorm.split(' ');
    const reversed = parts.length === 2 ? `${parts[1]} ${parts[0]}` : '';

    let match = null;

    for (const sp of sofifaPlayers) {
      const sFnNorm = normalize(sp.fullName);
      const sCnNorm = normalize(sp.commonName);

      if (
        sFnNorm === fnNorm || sCnNorm === fnNorm ||
        sFnNorm === wnNorm || sCnNorm === wnNorm ||
        (reversed && (sFnNorm === reversed || sCnNorm === reversed))
      ) {
        match = sp;
        break;
      }
    }

    if (!match) {
      // Token overlap match
      for (const sp of sofifaPlayers) {
        const sFnNorm = normalize(sp.fullName);
        const sCnNorm = normalize(sp.commonName);
        const sTokens = sFnNorm.split(' ');

        if (sTokens.length >= 2 && sTokens.every(st => fnNorm.includes(st) || wnNorm.includes(st))) {
          match = sp;
          break;
        }
      }
    }

    if (match) {
      const primaryRaw = match.positions[0];
      const primaryPos = SOFIFA_POS_MAP[primaryRaw] || 'CM';
      const secondaries = match.positions.slice(1).map(r => SOFIFA_POS_MAP[r]).filter(p => p && p !== primaryPos);

      matched++;
      updates.push({
        id: dbP.id,
        primary_position: primaryPos,
        secondary_positions: Array.from(new Set(secondaries))
      });
    }
  }

  console.log(`Matched ${matched} / ${dbPlayers.length} active players with SoFIFA EA FC data (${((matched / dbPlayers.length) * 100).toFixed(1)}%).`);

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({
      primary_position: u.primary_position,
      secondary_positions: u.secondary_positions
    }).eq('id', u.id)));
  }

  console.log('✅ Enhanced SoFIFA Position Sync Complete!');
}

fixSofifaMatching();
