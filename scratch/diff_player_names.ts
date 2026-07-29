import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { getPlayerDisplayName } from '../src/lib/players/displayName';

process.loadEnvFile('.env.local');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function diffPlayerNames() {
  console.log('--- COMPARING PLAYER DISPLAY NAMES BEFORE VS AFTER SOFIFA COMMON NAMES ---');

  const { data: dbPlayers, error } = await supabase
    .from('players')
    .select('id, name, web_name, full_name, sofifa_common_name, pl_team')
    .eq('is_active', true)
    .order('name');

  if (error || !dbPlayers) {
    console.error('Failed to fetch players:', error);
    return;
  }

  const diffs: Array<{
    pl_team: string;
    db_name: string;
    fpl_web_name: string | null;
    sofifa_common: string | null;
    old_full: string;
    new_full: string;
    old_initial: string;
    new_initial: string;
  }> = [];

  for (const p of dbPlayers) {
    // OLD display: simulate having no sofifa_common_name
    const oldPlayer = { ...p, sofifa_common_name: null };
    const oldFull = getPlayerDisplayName(oldPlayer, 'full');
    const oldInitial = getPlayerDisplayName(oldPlayer, 'initial_last');

    // NEW display: with sofifa_common_name populated
    const newFull = getPlayerDisplayName(p, 'full');
    const newInitial = getPlayerDisplayName(p, 'initial_last');

    if (oldFull !== newFull || oldInitial !== newInitial) {
      diffs.push({
        pl_team: p.pl_team,
        db_name: p.name,
        fpl_web_name: p.web_name,
        sofifa_common: p.sofifa_common_name,
        old_full: oldFull,
        new_full: newFull,
        old_initial: oldInitial,
        new_initial: newInitial,
      });
    }
  }

  console.log(`\nFound ${diffs.length} players out of ${dbPlayers.length} active players whose display name changed:\n`);

  console.table(
    diffs.map((d) => ({
      Team: d.pl_team,
      'Full DB Name': d.db_name,
      'FPL web_name': d.fpl_web_name,
      'SoFIFA common': d.sofifa_common,
      'Old Display (Full / Compact)': `${d.old_full}  |  ${d.old_initial}`,
      'New Display (Full / Compact)': `${d.new_full}  |  ${d.new_initial}`,
    }))
  );
}

diffPlayerNames().catch(console.error);
