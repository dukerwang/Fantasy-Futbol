/**
 * scripts/backfill-scoring-v2.mjs
 *
 * Calls POST /api/admin/backfill-scoring-v2 one GW at a time to backfill the
 * v2 shadow columns across every completed GW of the current FPL season.
 *
 * Calling one GW per request avoids Node.js undici's 30-second headers
 * timeout that fires when the entire season backfill is requested in a single
 * HTTP call against gaffa.live (Vercel).
 *
 * Usage:
 *   node scripts/backfill-scoring-v2.mjs                  # all GWs 1-38
 *   node scripts/backfill-scoring-v2.mjs --from=1 --to=38
 *   node scripts/backfill-scoring-v2.mjs --from=37        # GW 37 onward
 *   node scripts/backfill-scoring-v2.mjs --base=https://gaffa.live
 *
 * Reads CRON_SECRET and (optionally) NEXT_PUBLIC_APP_URL from .env.local.
 */

import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const getArg = (k) => {
  const inline = args.find((a) => a.startsWith(`--${k}=`));
  if (inline) return inline.split('=').slice(1).join('=');
  const idx = args.indexOf(`--${k}`);
  return idx >= 0 ? args[idx + 1] : null;
};

const base = getArg('base')
  ?? process.env.NEXT_PUBLIC_APP_URL
  ?? 'https://gaffa.live';
const fromArg = parseInt(getArg('from') ?? '1', 10);
const toArg   = parseInt(getArg('to')   ?? '38', 10);
const includeStats = getArg('stats') !== 'false';
const includeMatchups = getArg('matchups') !== 'false';
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('Missing CRON_SECRET in environment.');
  process.exit(1);
}

const baseUrl = base.replace(/\/$/, '');

async function callOneGw(gw) {
  const params = new URLSearchParams({ from: String(gw), to: String(gw) });
  if (!includeStats) params.set('stats', 'false');
  if (!includeMatchups) params.set('matchups', 'false');
  const url = `${baseUrl}/api/admin/backfill-scoring-v2?${params}`;

  process.stdout.write(`  GW${String(gw).padStart(2, '0')} → POST ${url} … `);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'x-cron-secret': secret, 'Content-Type': 'application/json' },
      // 90s timeout: each single-GW call should complete well within this.
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    console.error(`FAILED (network: ${err.message})`);
    return false;
  }

  const body = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}\n${body}`);
    return false;
  }

  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }

  const s = parsed?.summary?.[0];
  if (s) {
    console.log(`HTTP ${res.status} — stats:${s.statsUpdated} matchups:${s.matchupsUpdated} errors:${s.statsErrors + s.matchupErrors}`);
  } else {
    console.log(`HTTP ${res.status}`);
  }
  return true;
}

console.log(`Backfilling GW${fromArg}–GW${toArg} (one request per GW) against ${baseUrl}`);
let failures = 0;
for (let gw = fromArg; gw <= toArg; gw++) {
  const ok = await callOneGw(gw);
  if (!ok) failures++;
}
console.log(`\nDone. ${toArg - fromArg + 1} GWs attempted, ${failures} failures.`);
if (failures > 0) process.exit(1);
