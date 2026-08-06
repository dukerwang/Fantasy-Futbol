const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.substring(0, equalsIdx).trim();
      const val = trimmed.substring(equalsIdx + 1).trim();
      process.env[key] = val;
    }
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeName(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function syncAllTransfermarkt() {
  const tmRaw = fs.readFileSync(path.join(__dirname, '../scripts/players.json'), 'utf-8');
  const tmPlayers = JSON.parse(tmRaw);

  const { data: dbPlayers, error: fetchErr } = await supabase
    .from('players')
    .select('id, name, web_name, full_name, pl_team, market_value');

  if (fetchErr || !dbPlayers) {
    console.error('Failed to fetch players:', fetchErr);
    return;
  }

  console.log(`Loaded ${dbPlayers.length} DB players and ${tmPlayers.length} Transfermarkt JSON players.`);

  const updates = [];

  for (const tm of tmPlayers) {
    if (tm.market_value == null) continue;

    const tmNorm = normalizeName(tm.player_name);
    const tmClubNorm = normalizeName(tm.club_name);

    // Find DB player by name or web_name
    let match = dbPlayers.find(p => {
      const dbNorm = normalizeName(p.name);
      const dbFull = normalizeName(p.full_name);
      const dbWeb = normalizeName(p.web_name);

      if (dbNorm === tmNorm || (dbFull && dbFull === tmNorm)) return true;

      // Single word web_name check requires club match
      if (dbWeb && dbWeb === tmNorm) {
        const pClub = normalizeName(p.pl_team);
        if (pClub.includes(tmClubNorm) || tmClubNorm.includes(pClub)) return true;
      }
      return false;
    });

    if (match) {
      if (match.market_value !== tm.market_value) {
        updates.push({
          id: match.id,
          name: match.name,
          old_val: match.market_value,
          new_val: tm.market_value,
          tm_name: tm.player_name
        });
      }
    }
  }

  console.log(`\nFound ${updates.length} players needing Transfermarkt market value updates:`);
  console.table(updates.slice(0, 35));

  if (updates.length > 0) {
    console.log(`\nApplying ${updates.length} market value updates to Supabase...`);
    const chunkSize = 50;
    let updatedCount = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(u =>
          supabase
            .from('players')
            .update({
              market_value: u.new_val,
              market_value_updated_at: now
            })
            .eq('id', u.id)
        )
      );
      updatedCount += chunk.length;
    }
    console.log(`✅ Successfully updated ${updatedCount} player market values in DB!`);
  }
}

syncAllTransfermarkt();
