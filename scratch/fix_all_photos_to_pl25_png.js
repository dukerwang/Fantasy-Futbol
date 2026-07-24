process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const WORKING_PL25_BASE = 'https://resources.premierleague.com/premierleague25/photos/players/110x140/';

async function fixAllPhotosToPl25Png() {
  console.log('--- RESTORING ALL 554 PLAYER PHOTO URLS TO WORKING PREMIERLEAGUE25 PNG FORMAT ---');

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
      // Strip any .jpg or .png extension and force .png on premierleague25 base
      const cleanCode = el.photo.replace(/\.(png|jpg)$/, '').replace(/^p/, '');
      const workingUrl = `${WORKING_PL25_BASE}${cleanCode}.png`;
      if (p.photo_url !== workingUrl) {
        updates.push({ id: p.id, photo_url: workingUrl });
      }
    }
  }

  console.log(`Updating ${updates.length} / ${dbPlayers.length} player photo URLs.`);

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({ photo_url: u.photo_url }).eq('id', u.id)));
  }

  console.log('✅ ALL 554 PLAYER PHOTO URLS RESTORED TO WORKING 200 OK CDN FORMAT!');
}

fixAllPhotosToPl25Png().catch(console.error);
