#!/usr/bin/env node
/**
 * Batch-generate Futbolpedia player outlooks into player_outlooks.
 *
 * Usage:
 *   API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
 *     npx tsx scripts/generate-outlooks.ts --limit 20
 *
 * Flags:
 *   --limit N         cap player count
 *   --player-id UUID  single player
 *   --regulars        regulars pool (default when no player-id)
 *   --force           ignore TTL / hash freshness
 *   --dry-run         list target player ids only
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadRegularPlayerIds } from '../src/lib/outlook/population';
import { runOutlookBatch } from '../src/lib/outlook/batch';

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

function parseArgs(argv: string[]) {
  const args: {
    limit?: number;
    playerId?: string;
    regulars: boolean;
    force: boolean;
    dryRun: boolean;
    groundedRequestBudget?: number;
  } = { regulars: true, force: false, dryRun: false };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--player-id') {
      args.playerId = argv[++i];
      args.regulars = false;
    } else if (a === '--regulars') args.regulars = true;
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--grounded-budget') args.groundedRequestBudget = Number(argv[++i]);
  }
  return args;
}

async function main() {
  loadEnvLocal();
  const args = parseArgs(process.argv);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const admin = createClient(url, key);

  if (args.dryRun) {
    const ids = args.playerId
      ? [args.playerId]
      : await loadRegularPlayerIds(admin, args.limit);
    console.log(`Target players: ${ids.length}`);
    for (const id of ids) console.log(id);
    return;
  }

  if (!process.env.API_KEY) {
    console.error('Missing API_KEY');
    process.exit(1);
  }

  const report = await runOutlookBatch(admin, {
    playerIds: args.playerId ? [args.playerId] : undefined,
    regulars: args.regulars,
    limit: args.limit,
    force: args.force,
    groundedRequestBudget: args.groundedRequestBudget,
  });

  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
