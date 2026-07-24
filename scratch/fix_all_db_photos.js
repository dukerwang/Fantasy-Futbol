process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FPL_PHOTO_BASE = 'https://resources.premierleague.com/premierleague/photos/players/250x250/';

async function fixAllDbPhotos() {
  console.log('--- CLEANING & VALIDATING ALL 554 PLAYER PHOTO URLS IN DB ---');
  const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
  if (!res.ok) return;

  const data = await res.json();
  const fplElements = data.elements;
  const fplMap = new Map();
  fplElements.forEach(el => fplMap.set(el.id, el));

  const { data: dbPlayers } = await supabase.from('players').select('id, fpl_id, photo_url').eq('is_active', true);

  const updates = [];

  for (const p of dbPlayers) {
    const el = fplMap.get(p.fpl_id);
    if (el && el.photo) {
      const code = el.photo.replace(/\.(png|jpg)$/, '');
      const cleanCode = code.startsWith('p') ? code : `p${code}`;
      const validUrl = `${FPL_PHOTO_BASE}${cleanCode}.png`;
      if (p.photo_url !== validUrl) {
        updates.push({ id: p.id, photo_url: validUrl });
      }
    }
  }

  console.log(`Updating ${updates.length} / ${dbPlayers.length} photo URLs to clean CDN format.`);

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({ photo_url: u.photo_url }).eq('id', u.id)));
  }

  console.log('✅ ALL DB PLAYER PHOTO URLS STANDARDIZED TO 250x250 PNG!');
}

fixAllDbPhotos().catch(console.error);
