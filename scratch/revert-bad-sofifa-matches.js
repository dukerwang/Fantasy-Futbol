/**
 * fill-stray-unmatched-sofifa.js took the FIRST row of a SoFIFA keyword search
 * without verifying the returned card actually names the queried player.
 * These 8 got a different real person's position written onto them — revert
 * each back to the pre-scrape FPL-default state (captured from the
 * list_unmatched_sofifa.js run before any scraping happened).
 */
process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const REVERTS = [
  { name: 'Álvaro Rodríguez', primary_position: 'RB' }, // search returned "Álex Baena" — unrelated
  { name: 'Alfie McNally', primary_position: 'GK' },     // search returned "L. McNally" — initial mismatch
  { name: 'Jeremy Monga', primary_position: 'RB' },      // search returned "I. Mbula-Monga" — different surname
  { name: 'Victor Munoz', primary_position: 'RB' },      // search returned "D. Muñoz" — initial mismatch
  { name: 'Ewen Jaouen', primary_position: 'CB' },       // search returned "J. Hadjam" — unrelated
  { name: 'Aladji Bamba', primary_position: 'CM' },      // search returned "J. Bamba" — initial mismatch
  { name: 'Endo Wataru', primary_position: 'DM' },       // search returned "M. Guendouzi" — unrelated
  { name: 'Jannik Schuster', primary_position: 'CM' },   // search returned "M. Schuster" — initial mismatch
];

(async () => {
  for (const r of REVERTS) {
    const { data, error } = await supabase
      .from('players')
      .update({ primary_position: r.primary_position, secondary_positions: [] })
      .eq('name', r.name)
      .eq('is_active', true)
      .select('id, name, pl_team, primary_position, secondary_positions');
    if (error) {
      console.log(`ERROR reverting ${r.name}:`, error.message);
    } else {
      console.log(`Reverted ${r.name}:`, JSON.stringify(data));
    }
  }
})();
