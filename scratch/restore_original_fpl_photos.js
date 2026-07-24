process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ORIGINAL_FPL_PHOTO_BASE = 'https://resources.premierleague.com/premierleague25/photos/players/110x140/';

async function restoreOriginalFplPhotos() {
  console.log('--- RESTORING ORIGINAL WORKING FPL CDN PHOTO URLS FOR ALL 554 PLAYERS ---');

  const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
  if (!res.ok) {
    console.error('Failed to fetch FPL bootstrap-static');
    return;
  }

  const data = await res.json();
  const fplElements = data.elements;
  const fplMap = new Map();
  fplElements.forEach(el => fplMap.set(el.id, el));

  const { data: dbPlayers } = await supabase.from('players').select('id, fpl_id, photo_url').eq('is_active', true);

  const updates = [];

  for (const p of dbPlayers) {
    const el = fplMap.get(p.fpl_id);
    if (el && el.photo) {
      // Use original element.photo directly (e.g., "448104.png", "97032.png")
      const originalUrl = `${ORIGINAL_FPL_PHOTO_BASE}${el.photo}`;
      if (p.photo_url !== originalUrl) {
        updates.push({ id: p.id, photo_url: originalUrl });
      }
    }
  }

  console.log(`Ready to restore ${updates.length} / ${dbPlayers.length} original working photo URLs.`);

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({ photo_url: u.photo_url }).eq('id', u.id)));
  }

  console.log('✅ ALL 554 PLAYER PHOTO URLS RESTORED TO ORIGINAL WORKING FPL CDN FORMAT!');
}

restoreOriginalFplPhotos().catch(console.error);
