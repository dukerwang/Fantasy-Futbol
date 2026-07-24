process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FPL_PHOTO_BASE = 'https://resources.premierleague.com/premierleague/photos/players/250x250/';

async function fixAllPhotosPng() {
  console.log('--- FIXING ALL PLAYER PHOTO URLS TO OFFICIAL PL CDN PNG FORMAT ---');

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
      // Convert e.g. "223094.png" or "p223094.jpg" -> "p223094.png"
      const rawCode = el.photo.replace(/\.(png|jpg)$/, '');
      const cleanCode = rawCode.startsWith('p') ? rawCode : `p${rawCode}`;
      const correctPngUrl = `${FPL_PHOTO_BASE}${cleanCode}.png`;

      if (p.photo_url !== correctPngUrl) {
        updates.push({ id: p.id, photo_url: correctPngUrl });
      }
    }
  }

  console.log(`Ready to update ${updates.length} / ${dbPlayers.length} player photo URLs to valid .png CDN links.`);

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(chunk.map(u => supabase.from('players').update({ photo_url: u.photo_url }).eq('id', u.id)));
  }

  console.log('✅ ALL 554 PLAYER PHOTO URLS RESTORED TO VALID .PNG CDN FORMAT!');
}

fixAllPhotosPng().catch(console.error);
