process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalize(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"']/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function listUnmatchedSofifa() {
  const sofifaRaw = fs.readFileSync(path.join(__dirname, '..', 'scraped-sofifa.json'), 'utf-8');
  const sofifaTeams = JSON.parse(sofifaRaw);

  const sofifaNames = new Set();
  sofifaTeams.forEach(t => {
    (t.players || []).forEach(sp => {
      const fn = sp.fullName || `${sp.firstName || ''} ${sp.lastName || ''}`;
      const cn = sp.commonName || '';
      if (fn) sofifaNames.add(normalize(fn));
      if (cn) sofifaNames.add(normalize(cn));
    });
  });

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('name, web_name, pl_team, primary_position')
    .eq('is_active', true)
    .order('pl_team', { ascending: true });

  const unmatched = [];
  const matched = [];

  dbPlayers.forEach(p => {
    const fnNorm = normalize(p.name);
    const wnNorm = normalize(p.web_name);
    
    let isMatch = sofifaNames.has(fnNorm) || sofifaNames.has(wnNorm);
    if (!isMatch) {
      const parts = fnNorm.split(' ');
      if (parts.length > 2) {
        const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
        const firstSecond = `${parts[0]} ${parts[1]}`;
        if (sofifaNames.has(firstLast) || sofifaNames.has(firstSecond)) isMatch = true;
      }
    }

    if (isMatch) matched.push(p);
    else unmatched.push(p);
  });

  console.log(`=====================================================`);
  console.log(`   SOFIFA UNMATCHED PLAYERS REPORT`);
  console.log(`=====================================================`);
  console.log(`Total Active FPL Players: ${dbPlayers.length}`);
  console.log(`Matched to SoFIFA EA FC dataset: ${matched.length}`);
  console.log(`Unmatched (Using FPL position fallbacks): ${unmatched.length}\n`);

  // Group by club
  const byClub = {};
  unmatched.forEach(p => {
    byClub[p.pl_team] = byClub[p.pl_team] || [];
    byClub[p.pl_team].push(p);
  });

  Object.keys(byClub).forEach(club => {
    console.log(`\n### ${club} (${byClub[club].length} unmatched)`);
    byClub[club].forEach(p => {
      console.log(`  - ${p.name} (${p.web_name}) [Default Pos: ${p.primary_position}]`);
    });
  });
}

listUnmatchedSofifa();
