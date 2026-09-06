/**
 * scripts/sync_projected_points.ts
 *
 * Computes matchday projected points for all active Premier League players for
 * the current or specified gameweek, and updates public.players.projected_points.
 *
 * Usage:
 *   npx tsx scripts/sync_projected_points.ts
 *   npx tsx scripts/sync_projected_points.ts --gameweek 3
 *   npx tsx scripts/sync_projected_points.ts --gameweek 3 --season 2026-27
 */

import fs from 'fs';
import path from 'path';

// Load .env.local before importing Supabase admin client
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[trimmed.slice(0, eq).trim()] = val;
    }
  }
}

import { createAdminClient } from '../src/lib/supabase/admin';
import { getCurrentFplSeason } from '../src/lib/season/currentSeason';
import { resolveCurrentGw } from '../src/lib/season/currentGameweek';
import { calculateGameweekProjections } from '../src/lib/projections/calculateGameweekProjections';

function parseArgs() {
  const args = process.argv.slice(2);
  let gameweek: number | null = null;
  let season: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--gameweek' && args[i + 1]) {
      gameweek = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--season' && args[i + 1]) {
      season = args[i + 1];
      i++;
    }
  }

  return { gameweek, season };
}

async function main() {
  const admin = createAdminClient();
  const { gameweek: argGw, season: argSeason } = parseArgs();

  const season = argSeason ?? (await getCurrentFplSeason());
  const gameweek = argGw ?? (await resolveCurrentGw());

  console.log(`Calculating projected fantasy points for Season ${season}, Gameweek ${gameweek}...`);

  const result = await calculateGameweekProjections(admin, season, gameweek);
  console.log(`Calculated projections for ${result.projections.size} active players across ${result.fixturesFound} fixtures.`);

  const updates: Array<{ id: string; projected_points: number }> = [];
  for (const [id, points] of result.projections.entries()) {
    updates.push({ id, projected_points: points });
  }

  const chunkSize = 50;
  console.log(`Applying updates to public.players in batches of ${chunkSize}...`);
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map((u) =>
        admin
          .from('players')
          .update({ projected_points: u.projected_points })
          .eq('id', u.id),
      ),
    );
  }

  console.log(`Successfully updated ${updates.length} players with Gameweek ${gameweek} projections.`);

  // Sample inspection
  const { data: topPlayers } = await admin
    .from('players')
    .select('web_name, pl_team, primary_position, market_value, projected_points')
    .order('projected_points', { ascending: false })
    .limit(15);

  console.log('\nTop 15 Projected Players:');
  console.table(
    (topPlayers ?? []).map((p) => ({
      Player: p.web_name,
      Team: p.pl_team,
      Pos: p.primary_position,
      Value: `€${p.market_value ?? 0}m`,
      'Projected Pts': p.projected_points,
    })),
  );
}

main().catch((err) => {
  console.error('Failed to sync projected points:', err);
  process.exit(1);
});
