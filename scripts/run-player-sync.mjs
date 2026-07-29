/**
 * Runs syncPlayersFromFpl() directly, without going through the HTTP route.
 *
 * The route is the normal entry point, but it can only run inside a Next dev
 * or production server, and a shared dev server may be serving a stale module.
 * This calls the same function against the same database, so what runs is
 * exactly what is on disk.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs \
 *     scripts/run-player-sync.mjs
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
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

const { syncPlayersFromFpl } = await import('../src/lib/players/syncPlayers.ts');

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const result = await syncPlayersFromFpl(admin);
console.log(JSON.stringify(result, null, 2));
if (result.error) process.exit(1);
