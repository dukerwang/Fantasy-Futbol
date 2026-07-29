import { createClient } from '@supabase/supabase-js';
import { getPlayerDisplayName } from '../src/lib/players/displayName';

process.loadEnvFile('.env.local');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function generateDiffReport() {
  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, full_name, sofifa_common_name, pl_team')
    .eq('is_active', true)
    .order('name');

  if (!dbPlayers) return;

  const diffs: Array<{
    team: string;
    db_name: string;
    web_name: string | null;
    sofifa_common: string | null;
    old_full: string;
    new_full: string;
    old_compact: string;
    new_compact: string;
  }> = [];

  for (const p of dbPlayers) {
    const oldPlayer = { ...p, sofifa_common_name: null };
    const oldFull = getPlayerDisplayName(oldPlayer, 'full');
    const oldCompact = getPlayerDisplayName(oldPlayer, 'initial_last');

    const newFull = getPlayerDisplayName(p, 'full');
    const newCompact = getPlayerDisplayName(p, 'initial_last');

    if (oldFull !== newFull || oldCompact !== newCompact) {
      diffs.push({
        team: p.pl_team,
        db_name: p.name,
        web_name: p.web_name,
        sofifa_common: p.sofifa_common_name,
        old_full: oldFull,
        new_full: newFull,
        old_compact: oldCompact,
        new_compact: newCompact,
      });
    }
  }

  console.log(`TOTAL_CHANGED: ${diffs.length}`);
  diffs.forEach((d, idx) => {
    console.log(
      `${idx + 1}. [${d.team}] ${d.db_name} (FPL web_name: "${d.web_name}", SoFIFA common: "${d.sofifa_common}")\n` +
      `   Old: Full = "${d.old_full}" | Compact = "${d.old_compact}"\n` +
      `   New: Full = "${d.new_full}" | Compact = "${d.new_compact}"\n`
    );
  });
}

generateDiffReport().catch(console.error);
