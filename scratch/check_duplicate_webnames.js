const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

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

async function findDuplicateWebNames() {
  const { data: dbPlayers } = await supabase.from('players').select('id, name, web_name, pl_team, fpl_id, photo_url');
  
  const webGroups = new Map();
  dbPlayers.forEach(p => {
    if (!p.web_name) return;
    const key = `${p.web_name.toLowerCase()}_${(p.pl_team || '').toLowerCase()}`;
    if (!webGroups.has(key)) webGroups.set(key, []);
    webGroups.get(key).push(p);
  });

  const dupes = Array.from(webGroups.entries()).filter(([_, list]) => list.length > 1);
  console.log(`Found ${dupes.length} duplicate web_name + team groups in DB:`);
  dupes.forEach(([key, list]) => {
    console.log(`\nGroup "${key}":`);
    console.table(list);
  });
}

findDuplicateWebNames();
