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

async function fix() {
  console.log('Starting stats DB fix...');

  // 1. Update player_stats rows for GW38 from '2026-27' to '2025-26'
  const { data: updatedStats, error: updateErr } = await supabase
    .from('player_stats')
    .update({ season: '2025-26' })
    .eq('season', '2026-27')
    .eq('gameweek', 38)
    .select('id');

  if (updateErr) {
    console.error('Error updating player_stats:', updateErr);
    return;
  }
  console.log(`Updated ${updatedStats?.length ?? 0} player_stats rows from 2026-27 to 2025-26.`);

  // 2. Recalculate 2025-26 player scoring and form ratings
  console.log('Recalculating player fantasy scores for 2025-26...');
  const { error: err1 } = await supabase.rpc('update_player_fantasy_scores', { p_season: '2025-26' });
  if (err1) console.error('Error update_player_fantasy_scores 2025-26:', err1);

  console.log('Recalculating player form ratings for 2025-26...');
  const { error: err2 } = await supabase.rpc('update_player_form_ratings', { p_season: '2025-26' });
  if (err2) console.error('Error update_player_form_ratings 2025-26:', err2);

  // 3. Re-archive the correct 2025-26 stats
  console.log('Archiving player season stats for 2025-26...');
  const { error: err3 } = await supabase.rpc('archive_player_season_stats', { p_season: '2025-26' });
  if (err3) console.error('Error archive_player_season_stats 2025-26:', err3);

  // 4. Recalculate/reset 2026-27 player scoring and form ratings to 0/empty
  console.log('Resetting player fantasy scores for 2026-27...');
  const { error: err4 } = await supabase.rpc('update_player_fantasy_scores', { p_season: '2026-27' });
  if (err4) console.error('Error update_player_fantasy_scores 2026-27:', err4);

  console.log('Resetting player form ratings for 2026-27...');
  const { error: err5 } = await supabase.rpc('update_player_form_ratings', { p_season: '2026-27' });
  if (err5) console.error('Error update_player_form_ratings 2026-27:', err5);

  console.log('Stats DB fix complete!');
}

fix();
