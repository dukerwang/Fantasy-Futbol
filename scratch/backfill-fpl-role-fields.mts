/**
 * Narrow backfill of the migration-147 columns from FPL's bootstrap.
 *
 * Deliberately NOT syncPlayersFromFpl: that also detects permanent departures,
 * writes compensation decisions and seeds system auctions, which must not fire
 * out of band against live alpha leagues. This touches nine new columns and
 * nothing else. The regular sync populates them from now on.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const num = (v: string | undefined) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
  headers: { 'User-Agent': 'FantasyFutbol/1.0' },
});
const boot = await res.json();

const byFplId = new Map<number, any>(boot.elements.map((e: any) => [e.id, e]));
console.log(`fpl elements: ${byFplId.size}`);

const { data: players } = await admin
  .from('players')
  .select('id, fpl_id')
  .not('fpl_id', 'is', null);

let updated = 0;
let withPens = 0;
const rows = (players ?? [])
  .map((p) => {
    const el = byFplId.get(p.fpl_id as number);
    if (!el) return null;
    if (el.penalties_order === 1) withPens += 1;
    return {
      id: p.id,
      fpl_penalties_order: el.penalties_order ?? null,
      fpl_direct_fk_order: el.direct_freekicks_order ?? null,
      fpl_corners_order: el.corners_and_indirect_freekicks_order ?? null,
      fpl_chance_next_round: el.chance_of_playing_next_round ?? null,
      fpl_starts: el.starts ?? null,
      fpl_minutes: el.minutes ?? null,
      fpl_xg: num(el.expected_goals),
      fpl_xa: num(el.expected_assists),
      fpl_selected_by_pct: num(el.selected_by_percent),
    };
  })
  .filter(Boolean) as Record<string, unknown>[];

// Per-row UPDATE, not upsert: a partial row sent through upsert is validated
// as an INSERT first and dies on players.name being NOT NULL.
const CONCURRENCY = 20;
for (let i = 0; i < rows.length; i += CONCURRENCY) {
  const chunk = rows.slice(i, i + CONCURRENCY);
  await Promise.all(
    chunk.map(async (r) => {
      const { id, ...patch } = r as { id: string } & Record<string, unknown>;
      const { error } = await admin.from('players').update(patch).eq('id', id);
      if (error) throw new Error(`${id}: ${error.message}`);
      updated += 1;
    }),
  );
}
console.log(`updated ${updated} players; ${withPens} first-choice penalty takers`);
