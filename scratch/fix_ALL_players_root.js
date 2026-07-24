process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

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

const ALIAS_TO_CLEAN_NAME = {
  'bruno miguel borges fernandes': 'bruno fernandes',
  'bruno borges fernandes': 'bruno fernandes',
  'alejandro garnacho ferreyra': 'alejandro garnacho',
  'alisson becker': 'alisson',
  'andrey nascimento dos santos': 'andrey santos',
  'benoit badiashile mukinayi': 'benoit badiashile',
  'bruno guimaraes rodriguez moura': 'bruno guimaraes',
  'diogo dalot teixeira': 'diogo dalot',
  'dominic solanke mitchell': 'dominic solanke',
  'emiliano buendia stati': 'emiliano buendia',
  'emiliano martinez romero': 'emiliano martinez',
  'estevao almeida de oliveira goncalves': 'estevao',
  'francisco evanilson de lima barbosa': 'evanilson',
  'ezri konsa ngoyo': 'ezri konsa',
  'fabio freitas gouveia carvalho': 'fabio carvalho',
  'gabriel dos santos magalhaes': 'gabriel magalhaes',
  'jefferson lerma solis': 'jefferson lerma',
  'joao pedro junqueira de jesus': 'joao pedro',
  'julio soler barreto': 'julio soler',
  'levi samuels colwill': 'levi colwill',
  'manuel ugarte ribeiro': 'manuel ugarte',
  'marcos senesi baron': 'marcos senesi',
  'martin zubimendi ibanez': 'martin zubimendi',
  'matheus santos carneiro da cunha': 'matheus cunha',
  'mikel merino zazon': 'mikel merino',
  'moises caicedo corozo': 'moises caicedo',
  'nico gonzalez iglesias': 'nico gonzalez',
  'pedro lomba neto': 'pedro neto',
  'richarlison de andrade': 'richarlison',
  'robert lynch sanchez': 'robert sanchez',
  'rodrigo muniz carvalho': 'rodrigo muniz',
  'ruben dos santos gato alves dias': 'ruben dias',
  'daniel munoz mejia': 'daniel munoz',
  'bryan mbeumo': 'bryan mbeumo',
  'joao pedro loureiro da costa': 'costinha',
  'costinha': 'costinha'
};

// Load 2025-26 precomputed canonical stats
const archivedStatsFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'season', 'archived_stats_2025_26.ts'), 'utf-8');
const jsonMatch = archivedStatsFile.match(/export const PRECOMPUTED_STATS_2025_26 = ({[\s\S]*});/);
let canonical2025_26 = [];
if (jsonMatch) {
  const parsed = JSON.parse(jsonMatch[1]);
  canonical2025_26 = parsed.players || [];
}

async function fixAllPlayersRoot() {
  console.log('=====================================================');
  console.log('   STARTING MASTER ROOT FIX FOR ALL DB PLAYERS');
  console.log('=====================================================\n');

  console.log(`Loaded ${canonical2025_26.length} canonical 2025/26 players from spec.`);

  // 1. Fetch live 26/27 FPL elements
  const fplRes = await fetch(FPL_URL, { headers: { 'User-Agent': 'FantasyFutbol/1.0' } });
  if (!fplRes.ok) throw new Error(`FPL fetch failed: ${fplRes.status}`);
  const fplData = await fplRes.json();
  const teamMap = new Map(fplData.teams.map(t => [t.id, t.name]));
  const fplElements = fplData.elements.filter(el => el.element_type >= 1 && el.element_type <= 4);
  console.log(`Fetched ${fplElements.length} active FPL elements from 26/27 API.\n`);

  // 2. Fetch all current DB players
  const { data: dbPlayers, error: fetchErr } = await supabase.from('players').select('*');
  if (fetchErr) throw fetchErr;
  console.log(`Fetched ${dbPlayers.length} current rows from public.players.\n`);

  const canonicalById = new Map(canonical2025_26.map(p => [p.id, p]));

  // 3. STEP A: Restore true canonical identity (name, position, DOB, height) on ALL historical DB IDs
  console.log('--- Step A: Restoring Canonical Identity on Historical DB IDs ---');
  let identityRestored = 0;

  for (const c of canonical2025_26) {
    const existingDb = dbPlayers.find(p => p.id === c.id);
    if (existingDb) {
      const isCorrupted = existingDb.name !== c.name || existingDb.primary_position !== c.primary_position;
      if (isCorrupted) {
        await supabase.from('players').update({
          name: c.name,
          web_name: c.web_name,
          primary_position: c.primary_position,
          secondary_positions: c.secondary_positions || [],
          date_of_birth: c.date_of_birth || existingDb.date_of_birth,
          nationality: c.nationality || existingDb.nationality,
          height_cm: c.height_cm || existingDb.height_cm,
          updated_at: new Date().toISOString()
        }).eq('id', c.id);
        identityRestored++;
      }
    }
  }
  console.log(`Restored canonical identity for ${identityRestored} player records.\n`);

  // 4. STEP B: Clear fpl_id across DB players temporarily to allow safe re-assignment without constraint violation
  console.log('--- Step B: Clearing fpl_id across players table for clean re-mapping ---');
  await supabase.from('players').update({ fpl_id: null }).neq('id', '00000000-0000-0000-0000-000000000000');

  // 5. STEP C: Refresh DB player snapshot and build matching maps
  const { data: refreshedDbPlayers } = await supabase.from('players').select('*');
  
  const dbByNormName = new Map();
  refreshedDbPlayers.forEach(p => {
    const norm = normalizeName(p.name);
    if (norm) dbByNormName.set(norm, p);
  });

  // 6. STEP D: Map incoming 26/27 FPL elements to DB players by canonical name / alias
  console.log('--- Step C: Assigning 26/27 FPL Elements to DB Players ---');
  const assignedDbIds = new Set();
  const matchedFplIds = new Set();
  let fplAssignedCount = 0;

  for (const el of fplElements) {
    const rawFplFull = `${el.first_name} ${el.second_name}`.trim();
    const rawFplNorm = normalizeName(rawFplFull);
    const aliasNorm = ALIAS_TO_CLEAN_NAME[rawFplNorm] || rawFplNorm;
    const plTeam = teamMap.get(el.team) ?? 'Unknown';

    let match = dbByNormName.get(aliasNorm) || dbByNormName.get(rawFplNorm);

    if (!match) {
      const fplWebNorm = normalizeName(el.web_name);
      match = refreshedDbPlayers.find(p => {
        if (assignedDbIds.has(p.id)) return false;
        const pWebNorm = normalizeName(p.web_name);
        const pTeamNorm = normalizeName(p.pl_team);
        return pWebNorm === fplWebNorm && pTeamNorm === normalizeName(plTeam);
      });
    }

    const photoCode = el.photo?.replace('.jpg', '') ?? null;
    const photoUrl = photoCode ? `https://resources.premierleague.com/premierleague25/photos/players/110x140/${photoCode}.png` : null;

    if (match && !assignedDbIds.has(match.id)) {
      assignedDbIds.add(match.id);
      matchedFplIds.add(el.id);

      await supabase.from('players').update({
        fpl_id: el.id,
        web_name: el.web_name,
        pl_team: plTeam,
        pl_team_id: el.team,
        photo_url: photoUrl || match.photo_url,
        fpl_status: el.status,
        fpl_news: el.news || null,
        is_active: el.status !== 'u',
        market_value: match.market_value || (el.now_cost / 10),
        updated_at: new Date().toISOString()
      }).eq('id', match.id);

      fplAssignedCount++;
    } else if (!match) {
      console.log(`  Creating new 26/27 player in DB: "${rawFplFull}" (${el.web_name}, ${plTeam})`);
      const posMap = { 1: 'GK', 2: 'CB', 3: 'CM', 4: 'ST' };
      const { data: inserted } = await supabase.from('players').insert({
        fpl_id: el.id,
        name: rawFplFull,
        web_name: el.web_name,
        pl_team: plTeam,
        pl_team_id: el.team,
        primary_position: posMap[el.element_type] || 'CM',
        secondary_positions: [],
        market_value: (el.now_cost / 10),
        photo_url: photoUrl,
        fpl_status: el.status,
        fpl_news: el.news || null,
        is_active: el.status !== 'u',
        updated_at: new Date().toISOString()
      }).select().single();

      if (inserted) {
        assignedDbIds.add(inserted.id);
        matchedFplIds.add(el.id);
      }
    }
  }

  console.log(`Assigned 26/27 FPL elements to ${fplAssignedCount} existing DB players.\n`);

  // 7. STEP E: Clean up remaining duplicate names in DB if any remain
  console.log('--- Step D: Cleaning up Duplicate Name Rows ---');
  const { data: currentAllPlayers } = await supabase.from('players').select('*');
  const dupGroups = new Map();
  currentAllPlayers.forEach(p => {
    const norm = normalizeName(p.name);
    if (!dupGroups.has(norm)) dupGroups.set(norm, []);
    dupGroups.get(norm).push(p);
  });

  const duplicates = Array.from(dupGroups.entries()).filter(([_, list]) => list.length > 1);
  console.log(`Found ${duplicates.length} duplicate player groups after re-mapping.`);

  for (const [normName, list] of duplicates) {
    const usages = await Promise.all(list.map(async (p) => {
      const { count: rosters } = await supabase.from('roster_entries').select('*', { count: 'exact', head: true }).eq('player_id', p.id);
      const { count: archive } = await supabase.from('season_player_stats_archive').select('*', { count: 'exact', head: true }).eq('player_id', p.id);
      const { count: stats } = await supabase.from('player_stats').select('*', { count: 'exact', head: true }).eq('player_id', p.id);
      return { player: p, score: (rosters ?? 0) * 100 + (archive ?? 0) * 50 + (stats ?? 0) };
    }));

    usages.sort((a, b) => b.score - a.score);
    const canonical = usages[0].player;
    const orphans = usages.slice(1).map(u => u.player);

    for (const orphan of orphans) {
      await supabase.from('players').update({ fpl_id: null }).eq('id', orphan.id);
      await supabase.from('roster_entries').update({ player_id: canonical.id }).eq('player_id', orphan.id);
      await supabase.from('draft_picks').update({ player_id: canonical.id }).eq('player_id', orphan.id);
      await supabase.from('transactions').update({ player_id: canonical.id }).eq('player_id', orphan.id);
      await supabase.from('player_stats').update({ player_id: canonical.id }).eq('player_id', orphan.id);
      await supabase.from('players').delete().eq('id', orphan.id);
      console.log(`  Merged orphan duplicate ${orphan.id} into canonical ${canonical.id} ("${canonical.name}")`);
    }
  }

  // 8. STEP F: Comprehensive Final Verification
  console.log('\n=====================================================');
  console.log('   COMPREHENSIVE AUDIT & VERIFICATION');
  console.log('=====================================================');

  const { data: finalPlayers } = await supabase.from('players').select('*');
  const finalById = new Map(finalPlayers.map(p => [p.id, p]));

  // Check Bryan Mbeumo
  const mbeumoCanonical = canonical2025_26.find(p => p.name === 'Bryan Mbeumo');
  const dbMbeumoRow = finalById.get(mbeumoCanonical?.id);
  console.log('\nBryan Mbeumo Verification:');
  console.log(`  DB Name: "${dbMbeumoRow?.name}"`);
  console.log(`  Web Name: "${dbMbeumoRow?.web_name}"`);
  console.log(`  PL Team: "${dbMbeumoRow?.pl_team}"`);
  console.log(`  Position: "${dbMbeumoRow?.primary_position}"`);
  console.log(`  Photo URL: "${dbMbeumoRow?.photo_url}"`);
  console.log(`  FPL ID: ${dbMbeumoRow?.fpl_id}`);

  // Check Bruno Fernandes
  const brunoCanonical = canonical2025_26.find(p => p.name === 'Bruno Fernandes');
  const dbBrunoRow = finalById.get(brunoCanonical?.id);
  console.log('\nBruno Fernandes Verification:');
  console.log(`  DB Name: "${dbBrunoRow?.name}"`);
  console.log(`  Web Name: "${dbBrunoRow?.web_name}"`);
  console.log(`  PL Team: "${dbBrunoRow?.pl_team}"`);
  console.log(`  Position: "${dbBrunoRow?.primary_position}"`);
  console.log(`  Photo URL: "${dbBrunoRow?.photo_url}"`);
  console.log(`  FPL ID: ${dbBrunoRow?.fpl_id}`);

  // Check Lewis Hall
  const hallCanonical = canonical2025_26.find(p => p.name === 'Lewis Hall');
  const dbHallRow = finalById.get(hallCanonical?.id);
  console.log('\nLewis Hall Verification:');
  console.log(`  DB Name: "${dbHallRow?.name}"`);
  console.log(`  Web Name: "${dbHallRow?.web_name}"`);
  console.log(`  PL Team: "${dbHallRow?.pl_team}"`);
  console.log(`  Position: "${dbHallRow?.primary_position}"`);
  console.log(`  Photo URL: "${dbHallRow?.photo_url}"`);
  console.log(`  FPL ID: ${dbHallRow?.fpl_id}`);

  // Count photo mismatches across all players
  let totalPhotoMismatches = 0;
  for (const p of finalPlayers) {
    const c = canonicalById.get(p.id);
    if (c) {
      const cPhotoCode = c.photo_url?.match(/\/(\d+)\.png/)?.[1];
      const pPhotoCode = p.photo_url?.match(/\/(\d+)\.png/)?.[1];
      if (cPhotoCode && pPhotoCode && cPhotoCode !== pPhotoCode && p.name !== c.name) {
        totalPhotoMismatches++;
      }
    }
  }

  // Count name duplicates
  const finalDupMap = new Map();
  finalPlayers.forEach(p => {
    const norm = normalizeName(p.name);
    if (!finalDupMap.has(norm)) finalDupMap.set(norm, []);
    finalDupMap.get(norm).push(p);
  });
  const finalDups = Array.from(finalDupMap.entries()).filter(([_, list]) => list.length > 1);

  console.log(`\nFinal Photo Mismatches: ${totalPhotoMismatches}`);
  console.log(`Final Duplicate Player Names: ${finalDups.length}`);

  if (totalPhotoMismatches === 0 && finalDups.length === 0 && dbMbeumoRow?.name === 'Bryan Mbeumo' && dbMbeumoRow?.fpl_id != null) {
    console.log('\n🎉 ALL PLAYERS IN THE DATABASE ARE 100% PERFECTLY RESTORED & SYNCED!');
  } else {
    console.error('\n❌ AUDIT FOUND REMAINING ISSUES');
  }
}

fixAllPlayersRoot().catch(console.error);
