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

async function backfillSofifaCommonNames() {
  console.log('--- STARTING SOFIFA COMMON NAME BACKFILL ---');

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

  const { data: dbPlayers, error: fetchErr } = await supabase
    .from('players')
    .select('id, name, web_name, full_name, pl_team, sofifa_common_name')
    .eq('is_active', true);

  if (fetchErr || !dbPlayers) {
    console.error('Failed to fetch DB players:', fetchErr);
    return;
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
    'Norberto Bercique Gomes Betuncal': 'Beto'
  };

  const updates = [];

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

    if (!match && MANUAL_OVERRIDES[p.name]) {
      const overrideNorm = normalizeName(MANUAL_OVERRIDES[p.name]);
      match = sofifaPlayers.find(sp => normalizeName(sp.fullName) === overrideNorm || normalizeName(sp.commonName) === overrideNorm);
    }

    if (match && match.commonName) {
      if (p.sofifa_common_name !== match.commonName) {
        updates.push({
          id: p.id,
          name: p.name,
          sofifa_common_name: match.commonName
        });
      }
    }
  }

  console.log(`Found ${updates.length} players to update with SoFIFA common names.`);

  let updatedCount = 0;
  const chunkSize = 50;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(u =>
        supabase
          .from('players')
          .update({ sofifa_common_name: u.sofifa_common_name })
          .eq('id', u.id)
      )
    );
    updatedCount += chunk.length;
  }

  console.log(`✅ Successfully backfilled ${updatedCount} sofifa_common_name values in Supabase DB!`);

  // Verify sample famous players (Beto, Rodri, Gabriel Jesus, David Raya, Pedro Porro)
  const { data: samples } = await supabase
    .from('players')
    .select('name, web_name, sofifa_common_name')
    .in('web_name', ['Beto', 'Rodri', 'G.Jesus', 'Pedro Porro', 'Raya', 'Casemiro', 'Jota', 'Evanilson', 'Estêvão'])
    .limit(20);

  console.log('\nSample verified players in DB:');
  console.table(samples);
}

backfillSofifaCommonNames().catch(console.error);
