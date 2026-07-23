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

async function check() {
  console.log('Recalculating 2025-26 fantasy scores (last 5 limit)...');
  await supabase.rpc('update_player_fantasy_scores', { p_season: '2025-26' });

  console.log('Recalculating 2025-26 form ratings (last 5 rn limit)...');
  await supabase.rpc('update_player_form_ratings', { p_season: '2025-26' });

  console.log('Archiving 2025-26 (last 5 limits)...');
  await supabase.rpc('archive_player_season_stats', { p_season: '2025-26' });

  console.log('Resetting 2026-27 scores and ratings to 0...');
  await supabase.rpc('update_player_fantasy_scores', { p_season: '2026-27' });
  await supabase.rpc('update_player_form_ratings', { p_season: '2026-27' });

  const { data: bowen } = await supabase
    .from('players')
    .select('id')
    .eq('web_name', 'Bowen')
    .limit(1)
    .single();

  if (bowen) {
    const { data: bowenArch } = await supabase
      .from('season_player_stats_archive')
      .select('*')
      .eq('player_id', bowen.id)
      .eq('season', '2025-26')
      .single();
    console.log('Bowen 2025-26 Archive after last-5 recalculation:', bowenArch);
  }
}

check();
