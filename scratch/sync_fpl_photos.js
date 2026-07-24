process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FPL_PHOTO_BASE = 'https://resources.premierleague.com/premierleague/photos/players/250x250/';

async function syncFplPhotosBatch() {
  console.log('--- BATCH SYNCING OFFICIAL 2026/27 FPL PLAYER PHOTOS ---');
  const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
  if (!res.ok) return;

  const data = await res.json();
  const fplElements = data.elements;

  const { data: dbPlayers } = await supabase.from('players').select('id, fpl_id, photo_url').eq('is_active', true);
  const fplMap = new Map();
  fplElements.forEach(el => fplMap.set(el.id, el));

  const updates = [];
  for (const dbP of dbPlayers) {
    const el = fplMap.get(dbP.fpl_id);
    if (el && el.photo) {
      const cleanPhoto = el.photo.startsWith('p') ? el.photo : `p${el.photo}`;
      const fullUrl = `${FPL_PHOTO_BASE}${cleanPhoto}`;
      if (dbP.photo_url !== fullUrl) {
        updates.push({ id: dbP.id, photo_url: fullUrl });
      }
    }
  }

  console.log(`Ready to update ${updates.length} / ${dbPlayers.length} photo URLs.`);

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({ photo_url: u.photo_url }).eq('id', u.id)));
  }

  console.log('✅ ALL FPL PLAYER PHOTOS BATCH UPDATED!');
}

syncFplPhotosBatch().catch(console.error);
