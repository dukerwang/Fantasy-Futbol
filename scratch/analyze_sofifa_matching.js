const fs = require('fs');
const path = require('path');
process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

async function analyzeMatching() {
  const raw = fs.readFileSync(path.join(__dirname, '../scraped-sofifa.json'), 'utf-8');
  const teams = JSON.parse(raw);

  const sofifaPlayers = [];
  teams.forEach(t => {
    (t.players || []).forEach(p => {
      sofifaPlayers.push({
        id: p.id,
        commonName: p.commonName,
        fullName: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim(),
        team: t.name
      });
    });
  });

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, full_name, pl_team')
    .eq('is_active', true);

  const matched = [];
  const unmatched = [];

  for (const p of dbPlayers) {
    const normName = normalizeName(p.name);
    const normWeb = normalizeName(p.web_name);
    const normFull = normalizeName(p.full_name);

    let match = sofifaPlayers.find(sp => {
      const sfFull = normalizeName(sp.fullName);
      const sfCommon = normalizeName(sp.commonName);
      return (
        sfFull === normName ||
        (normFull && sfFull === normFull) ||
        sfCommon === normWeb ||
        sfCommon === normName ||
        firstLast(sfFull) === firstLast(normName)
      );
    });

    if (match) {
      matched.push({ player: p, sofifa: match });
    } else {
      unmatched.push(p);
    }
  }

  console.log(`Matched: ${matched.length} / ${dbPlayers.length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log('\nSample unmatched DB players (first 20):');
    console.table(unmatched.slice(0, 20).map(u => ({ name: u.name, web_name: u.web_name, pl_team: u.pl_team })));
  }
}

analyzeMatching().catch(console.error);
