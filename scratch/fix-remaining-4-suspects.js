/**
 * Final cleanup of the 4 remaining FB+winger-secondary suspects that the
 * merged sync couldn't resolve via name matching:
 *  - Mykolenko: real SoFIFA card exists (scraped-sofifa.json), just failed
 *    name-matching due to "Vitaliy" (SoFIFA) vs "Vitalii" (our DB) spelling.
 *    Apply the correct hybrid result by hand: LB/LM + role "Wingback +"
 *    (not attacking/inverted) -> primary=LB, secondary=[LWB].
 *  - Mingueza: real card exists ["RB","LM","RM"], hits the hasBothMid +
 *    hasOnlyOneFB branch -> primary=RWB, secondary=[LW,RW].
 *  - Palestra, Meunier: no SoFIFA card found in the current scrape at all —
 *    no real data to assign a secondary from. Clear the fabricated LW/RW
 *    secondary left over from the earlier flawed keyword search; leave
 *    primary_position (RB) alone since it's independently plausible.
 */
process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const updates = [
    { name: 'Vitalii Mykolenko', primary_position: 'LB', secondary_positions: ['LWB'], sofifa_common_name: 'V. Mykolenko' },
    { name: 'Oscar Mingueza', primary_position: 'RWB', secondary_positions: ['LW', 'RW'], sofifa_common_name: 'Mingueza' },
    { name: 'Marco Palestra', secondary_positions: [] },
    { name: 'Thomas Meunier', secondary_positions: [] },
  ];

  for (const u of updates) {
    const { name, ...patch } = u;
    const { data, error } = await supabase.from('players').update(patch).eq('name', name).eq('is_active', true).select('name, pl_team, primary_position, secondary_positions, sofifa_common_name');
    console.log(name, error ? error.message : JSON.stringify(data));
  }
})();
