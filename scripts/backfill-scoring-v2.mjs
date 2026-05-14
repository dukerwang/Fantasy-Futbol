/**
 * scripts/backfill-scoring-v2.mjs
 *
 * Thin wrapper that POSTs to /api/admin/backfill-scoring-v2 to backfill the
 * v2 shadow columns across every completed GW of the current FPL season.
 *
 * Intended for use after the 25/26 season ends, before promoting v2 to
 * primary (Phase 3D). Can also be used to populate a single GW for ad-hoc
 * inspection.
 *
 * Usage:
 *   node scripts/backfill-scoring-v2.mjs                  # all completed GWs
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
const from = getArg('from');
const to = getArg('to');
const includeStats = getArg('stats') !== 'false';
const includeMatchups = getArg('matchups') !== 'false';
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('Missing CRON_SECRET in environment.');
  process.exit(1);
}

const params = new URLSearchParams();
if (from) params.set('from', from);
if (to) params.set('to', to);
if (!includeStats) params.set('stats', 'false');
if (!includeMatchups) params.set('matchups', 'false');

const url = `${base.replace(/\/$/, '')}/api/admin/backfill-scoring-v2${params.size ? `?${params}` : ''}`;
console.log(`POST ${url}`);

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'x-cron-secret': secret,
    'Content-Type': 'application/json',
  },
});
const body = await res.text();
console.log(`HTTP ${res.status}`);
console.log(body);
if (!res.ok) process.exit(1);
