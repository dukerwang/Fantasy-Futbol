process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');

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
  'daniel munoz mejia': 'daniel munoz'
};

async function fixRootPlayerSyncAndDb() {
  console.log('=====================================================');
  console.log('   STARTING ROOT PLAYER SYNC & DB REPAIR PROCESS');
  console.log('=====================================================\n');

  // 1. Fetch live FPL bootstrap
  console.log('Fetching live FPL bootstrap API...');
  const fplRes = await fetch(FPL_URL, { headers: { 'User-Agent': 'FantasyFutbol/1.0' } });
  if (!fplRes.ok) {
    throw new Error(`Failed to fetch FPL API: ${fplRes.status}`);
  }
  const fplData = await fplRes.json();
  const teamMap = new Map(fplData.teams.map(t => [t.id, t.name]));
  const fplElements = fplData.elements.filter(el => el.element_type >= 1 && el.element_type <= 4);

  // 2. Fetch all DB players
  const { data: dbPlayers, error: dbErr } = await supabase.from('players').select('*');
  if (dbErr) throw dbErr;

  // 3. Find duplicate name groups
  const nameGroups = new Map();
  dbPlayers.forEach(p => {
    const norm = normalizeName(p.name);
    if (!nameGroups.has(norm)) nameGroups.set(norm, []);
    nameGroups.get(norm).push(p);
  });

  const duplicateGroups = Array.from(nameGroups.entries()).filter(([_, list]) => list.length > 1);
  console.log(`Found ${duplicateGroups.length} duplicate player name groups in DB.`);

  let mergedCount = 0;
  let statsRelinkedCount = 0;

  for (const [normName, playersList] of duplicateGroups) {
    console.log(`\n--- Resolving duplicate group: "${playersList[0].name}" (${playersList.length} records) ---`);
    
    const usages = await Promise.all(playersList.map(async (p) => {
      const { count: rosters } = await supabase.from('roster_entries').select('*', { count: 'exact', head: true }).eq('player_id', p.id);
      const { count: archive } = await supabase.from('season_player_stats_archive').select('*', { count: 'exact', head: true }).eq('player_id', p.id);
      const { count: drafts } = await supabase.from('draft_picks').select('*', { count: 'exact', head: true }).eq('player_id', p.id);
      const { count: txs } = await supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('player_id', p.id);
      const { count: stats } = await supabase.from('player_stats').select('*', { count: 'exact', head: true }).eq('player_id', p.id);

      return {
        player: p,
        rostersCount: rosters ?? 0,
        archiveCount: archive ?? 0,
        draftsCount: drafts ?? 0,
        txsCount: txs ?? 0,
        statsCount: stats ?? 0,
        score: (rosters ?? 0) * 100 + (archive ?? 0) * 50 + (drafts ?? 0) * 10 + (txs ?? 0) * 5 + (stats ?? 0)
      };
    }));

    usages.sort((a, b) => b.score - a.score);
    const canonical = usages[0].player;
    const orphans = usages.slice(1).map(u => u.player);

    console.log(`  Canonical DB ID: ${canonical.id} (Rosters: ${usages[0].rostersCount}, Archive: ${usages[0].archiveCount}, Stats: ${usages[0].statsCount})`);

    let fplMatch = fplElements.find(el => {
      const fplFullNorm = normalizeName(`${el.first_name} ${el.second_name}`);
      const mappedNorm = ALIAS_TO_CLEAN_NAME[fplFullNorm] || fplFullNorm;
      if (mappedNorm === normName) return true;

      const fplWebNorm = normalizeName(el.web_name);
      const canonicalWebNorm = normalizeName(canonical.web_name);
      const plTeam = teamMap.get(el.team) ?? 'Unknown';
      if (fplWebNorm === canonicalWebNorm && plTeam.toLowerCase() === (canonical.pl_team || '').toLowerCase()) return true;

      return false;
    });

    if (!fplMatch) {
      fplMatch = fplElements.find(el => {
        const fplFullNorm = normalizeName(`${el.first_name} ${el.second_name}`);
        return fplFullNorm.includes(normName) || normName.includes(normalizeName(el.second_name));
      });
    }

    // Clear fpl_id on orphan records FIRST so unique constraint doesn't block canonical update
    for (const orphan of orphans) {
      console.log(`  Orphan DB ID to remove: ${orphan.id} (fpl_id: ${orphan.fpl_id})`);
      await supabase.from('players').update({ fpl_id: null }).eq('id', orphan.id);

      const { data: orphanStats } = await supabase.from('player_stats').select('id, match_id').eq('player_id', orphan.id);
      if (orphanStats && orphanStats.length > 0) {
        for (const st of orphanStats) {
          const { data: existingStat } = await supabase.from('player_stats').select('id').eq('player_id', canonical.id).eq('match_id', st.match_id).maybeSingle();
          if (!existingStat) {
            await supabase.from('player_stats').update({ player_id: canonical.id }).eq('id', st.id);
            statsRelinkedCount++;
          }
        }
      }

      await supabase.from('roster_entries').update({ player_id: canonical.id }).eq('player_id', orphan.id);
      await supabase.from('draft_picks').update({ player_id: canonical.id }).eq('player_id', orphan.id);
      await supabase.from('transactions').update({ player_id: canonical.id }).eq('player_id', orphan.id);
      await supabase.from('waiver_claims').update({ player_id: canonical.id }).eq('player_id', orphan.id);

      const { error: delErr } = await supabase.from('players').delete().eq('id', orphan.id);
      if (delErr) {
        console.error(`  Error deleting orphan player ${orphan.id}:`, delErr.message);
      } else {
        console.log(`  Successfully deleted orphan player record ${orphan.id}`);
      }
    }

    if (fplMatch) {
      // Clear fpl_id on ANY existing player before assigning to canonical ID to guarantee no unique constraint conflict
      await supabase.from('players').update({ fpl_id: null }).eq('fpl_id', fplMatch.id);

      const plTeam = teamMap.get(fplMatch.team) ?? canonical.pl_team ?? 'Unknown';
      const photoCode = fplMatch.photo?.replace('.jpg', '') ?? null;
      const photoUrl = photoCode ? `https://resources.premierleague.com/premierleague25/photos/players/110x140/${photoCode}.png` : canonical.photo_url;
      const posMap = { 1: 'GK', 2: 'CB', 3: 'CM', 4: 'ST' };
      const defaultPos = posMap[fplMatch.element_type] || 'CM';

      const updateData = {
        fpl_id: fplMatch.id,
        name: canonical.name,
        web_name: fplMatch.web_name,
        pl_team: plTeam,
        pl_team_id: fplMatch.team,
        primary_position: canonical.primary_position || defaultPos,
        photo_url: photoUrl,
        fpl_status: fplMatch.status,
        fpl_news: fplMatch.news || null,
        is_active: fplMatch.status !== 'u',
        market_value: canonical.market_value || (fplMatch.now_cost / 10),
        updated_at: new Date().toISOString()
      };

      const { error: updateErr } = await supabase.from('players').update(updateData).eq('id', canonical.id);
      if (updateErr) {
        console.error(`  Error updating canonical player ${canonical.id}:`, updateErr.message);
      } else {
        console.log(`  ✅ Successfully restored canonical player "${canonical.name}" (${canonical.id}) with fpl_id ${fplMatch.id}, photo ${photoUrl}, team ${plTeam}`);
      }
    }

    mergedCount++;
  }

  // 4. Re-evaluate FPL assignment across all DB players
  const { data: currentPlayers } = await supabase.from('players').select('*');
  console.log(`\nRe-evaluating FPL assignment across all ${currentPlayers.length} DB players...`);

  for (const p of currentPlayers) {
    const pNorm = normalizeName(p.name);
    const fplMatch = fplElements.find(el => {
      const fplFullNorm = normalizeName(`${el.first_name} ${el.second_name}`);
      const mappedNorm = ALIAS_TO_CLEAN_NAME[fplFullNorm] || fplFullNorm;
      return mappedNorm === pNorm || fplFullNorm === pNorm;
    });

    if (fplMatch && (p.fpl_id !== fplMatch.id || !p.photo_url || p.web_name !== fplMatch.web_name)) {
      await supabase.from('players').update({ fpl_id: null }).eq('fpl_id', fplMatch.id);

      const plTeam = teamMap.get(fplMatch.team) ?? p.pl_team ?? 'Unknown';
      const photoCode = fplMatch.photo?.replace('.jpg', '') ?? null;
      const photoUrl = photoCode ? `https://resources.premierleague.com/premierleague25/photos/players/110x140/${photoCode}.png` : p.photo_url;
      const posMap = { 1: 'GK', 2: 'CB', 3: 'CM', 4: 'ST' };
      const defaultPos = posMap[fplMatch.element_type] || 'CM';

      await supabase.from('players').update({
        fpl_id: fplMatch.id,
        web_name: fplMatch.web_name,
        pl_team: plTeam,
        pl_team_id: fplMatch.team,
        photo_url: photoUrl,
        primary_position: p.primary_position || defaultPos,
        fpl_status: fplMatch.status,
        fpl_news: fplMatch.news || null,
        is_active: fplMatch.status !== 'u',
        updated_at: new Date().toISOString()
      }).eq('id', p.id);
    }
  }

  // 5. Final check of duplicates
  const { data: finalPlayers } = await supabase.from('players').select('id, name');
  const finalGroups = new Map();
  finalPlayers.forEach(p => {
    const norm = normalizeName(p.name);
    if (!finalGroups.has(norm)) finalGroups.set(norm, []);
    finalGroups.get(norm).push(p);
  });
  const remainingDuplicates = Array.from(finalGroups.entries()).filter(([_, list]) => list.length > 1);

  console.log(`\n=====================================================`);
  console.log(`   REPAIR COMPLETE`);
  console.log(`   Remaining duplicate player names in DB: ${remainingDuplicates.length}`);
  console.log(`=====================================================\n`);
}

fixRootPlayerSyncAndDb().catch(console.error);
