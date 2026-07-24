process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

const FPL_DEFAULT_POSITION = {
  1: 'GK',
  2: 'CB',
  3: 'CM',
  4: 'ST',
};

async function performCleanSeasonSync() {
  console.log('--- Starting Clean 2026/27 FPL Season Sync ---');

  // 1. Fetch official FPL bootstrap data
  const res = await fetch(FPL_URL, { headers: { 'User-Agent': 'FantasyFutbol/1.0' } });
  const fplData = await res.json();
  const teamMap = new Map(fplData.teams.map(t => [t.id, t.name]));

  // 2. Clear fpl_id across existing players so unique constraint on fpl_id doesn't block re-assignment
  console.log('Clearing old fpl_id values from DB...');
  const { error: clearErr } = await supabase.from('players').update({ fpl_id: null }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (clearErr) {
    console.error('Error clearing old fpl_id:', clearErr);
    return;
  }

  // 3. Fetch all existing players from DB
  const { data: dbPlayers, error: dbErr } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, secondary_positions, market_value');
  
  if (dbErr) {
    console.error('Error fetching DB players:', dbErr);
    return;
  }

  // Map existing DB players by lowercased name & web_name
  const dbByName = new Map();
  const dbByWebAndTeam = new Map();

  dbPlayers.forEach(p => {
    if (p.name) dbByName.set(p.name.trim().toLowerCase(), p);
    if (p.web_name && p.pl_team) {
      dbByWebAndTeam.set(`${p.web_name.trim().toLowerCase()}_${p.pl_team.toLowerCase()}`, p);
    }
  });

  const fplElements = fplData.elements.filter(el => el.element_type >= 1 && el.element_type <= 4);
  console.log(`Processing ${fplElements.length} FPL players against ${dbPlayers.length} DB records...`);

  const matchedIds = new Set();
  const updates = [];
  const inserts = [];

  for (const el of fplElements) {
    const fullName = `${el.first_name} ${el.second_name}`.trim();
    const fullNameKey = fullName.toLowerCase();
    const plTeam = teamMap.get(el.team) ?? 'Unknown';
    const webTeamKey = `${el.web_name.trim().toLowerCase()}_${plTeam.toLowerCase()}`;

    // Look for match by full name or web_name + team
    let existing = dbByName.get(fullNameKey) || dbByWebAndTeam.get(webTeamKey);

    const photoCode = el.photo?.replace('.jpg', '') ?? null;
    const photoUrl = photoCode
      ? `https://resources.premierleague.com/premierleague25/photos/players/110x140/${photoCode}.png`
      : null;

    const position = existing?.primary_position || FPL_DEFAULT_POSITION[el.element_type] || 'CM';

    const rowData = {
      fpl_id: el.id,
      name: fullName,
      web_name: el.web_name,
      pl_team: plTeam,
      pl_team_id: el.team,
      primary_position: position,
      market_value: (el.now_cost / 10),
      photo_url: photoUrl,
      fpl_status: el.status,
      fpl_news: el.news || null,
      is_active: el.status !== 'u',
      updated_at: new Date().toISOString()
    };

    if (existing && !matchedIds.has(existing.id)) {
      matchedIds.add(existing.id);
      updates.push({
        id: existing.id,
        ...rowData,
        secondary_positions: existing.secondary_positions ?? []
      });
    } else {
      inserts.push({
        ...rowData,
        secondary_positions: []
      });
    }
  }

  console.log(`Found ${updates.length} existing player updates and ${inserts.length} new player inserts.`);

  // Perform updates in batches
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100);
    const { error: err } = await supabase.from('players').upsert(batch, { onConflict: 'id' });
    if (err) console.error(`Update batch ${i} error:`, err.message);
  }

  // Perform inserts in batches
  if (inserts.length > 0) {
    for (let i = 0; i < inserts.length; i += 100) {
      const batch = inserts.slice(i, i + 100);
      const { error: err } = await supabase.from('players').insert(batch);
      if (err) console.error(`Insert batch ${i} error:`, err.message);
    }
  }

  // Deactivate any DB players that were NOT matched and have fpl_id null
  const { error: deactErr } = await supabase
    .from('players')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .is('fpl_id', null)
    .neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('Deactivated un-matched players result:', { deactErr });

  console.log('--- Clean Season Sync Complete ---');

  // Verify Morgan Rogers, Tzolis, Ipswich
  const { data: rogers } = await supabase.from('players').select('name, web_name, pl_team, market_value, fpl_id').ilike('name', '%rogers%');
  console.log('\nMorgan Rogers in DB:', rogers);

  const { data: tzolis } = await supabase.from('players').select('name, web_name, pl_team').ilike('name', '%tzolis%');
  console.log('Tzolis in DB:', tzolis);

  const { data: ipswich } = await supabase.from('players').select('name, web_name, pl_team, primary_position, market_value').eq('pl_team', 'Ipswich Town').eq('is_active', true);
  console.log(`\nIpswich Town active count in DB: ${ipswich?.length}`);
  console.log('Ipswich sample players:', ipswich?.slice(0, 8));

  // Check Chelsea roster in DB
  const { data: chelsea } = await supabase.from('players').select('name, web_name, pl_team').eq('pl_team', 'Chelsea').eq('is_active', true);
  console.log(`\nChelsea active count in DB: ${chelsea?.length}`);
  console.log('Chelsea Rogers check:', chelsea?.filter(p => p.name.includes('Rogers')));
}

performCleanSeasonSync();
