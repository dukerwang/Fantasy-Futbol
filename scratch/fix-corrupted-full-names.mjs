/**
 * Clears full_name values left corrupted by the earlier bad-match sync.
 *
 * `players.full_name` is a legacy display column formatName() prefers over
 * `name`. The sync never rewrites it, so when an earlier run mis-matched a row
 * it left another player's full_name in place — Mbeumo's card rendered
 * "João Pedro Loureiro da Costa". The syncPlayers fix now self-heals this
 * going forward, but the already-corrupted rows need clearing once.
 *
 * Nulls (not overwrites): FPL offers no richer name than `name` for these
 * players, so clearing makes display fall back to the correct `name`. Only
 * touches rows whose full_name shares no significant token with name — the
 * legitimately-richer full_names (David Raya → "David Raya Martín") are left.
 *
 * Usage:
 *   node scratch/fix-corrupted-full-names.mjs           # dry run
 *   node scratch/fix-corrupted-full-names.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const PARTICLES = new Set(['de','da','do','dos','das','van','von','del','della','di','la','le','el','al','den','der','ter','junior','santos','silva','costa']);
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((t) => t.length >= 3 && !PARTICLES.has(t)));
const coherent = (a, b) => { const A = tokens(a), B = tokens(b); for (const t of A) if (B.has(t)) return true; return false; };

const { data: rows } = await db.from('players').select('id,name,full_name').not('full_name', 'is', null);
const bad = rows.filter((p) => p.name && p.full_name && !coherent(p.name, p.full_name));

console.log(`=== FIX CORRUPTED full_name (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
console.log(`rows with full_name: ${rows.length} | incoherent (to clear): ${bad.length}\n`);
for (const p of bad) console.log(`   "${p.name}"  ✗ full_name="${p.full_name}"  → NULL`);

if (!APPLY) { console.log('\nDry run. Re-run with --apply to clear.'); process.exit(0); }

let cleared = 0;
for (const p of bad) {
  const { error } = await db.from('players').update({ full_name: null, updated_at: new Date().toISOString() }).eq('id', p.id);
  if (error) console.error(`  FAILED ${p.name}: ${error.message}`); else cleared++;
}
console.log(`\nCleared ${cleared} full_name value(s).`);
