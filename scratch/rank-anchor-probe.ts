/* Rank-anchor probe. Produces the RANK_CUTS table in src/lib/scoring/perfBand.ts.
   Vitest only globs src/**​/__tests__/**​/*.test.ts, so to run this: copy to
   src/lib/scoring/__tests__/zz-rank-probe.test.ts, run vitest on it, read
   /tmp/rank-probe.txt, then delete the copy.

   RUN IT WITH scratch/band-distribution-probe.ts, never alone — BAND_CUTS and
   RANK_CUTS describe the same distribution and go stale together the moment
   rating_reference_stats is regenerated.

   The output needs one hand pass before it goes in the table: drop any tier
   whose ACHIEVED share is under half its label (a tie block has swallowed it)
   to `null`. Under 2025-26 that dropped four, all in `attacking`:
   CB top25 (7.6%), DM top5 (1.1%), LB/RB top25 (10.3%), LB/RB top10 (3.2%). */
/* TEMPORARY probe — not a test. */
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { calculateMatchRating, POSITION_WEIGHTS as POSW } from '../matchRating';

const MEMBERS: Record<string, string[]> = {
  attacking: ['goal_involvement', 'finishing', 'threat'], creating: ['creativity'],
  defending: ['defensive', 'save_score'], involvement: ['match_impact', 'influence'],
  shotStopping: ['save_score'], goalsPrevented: ['defensive'],
};
const ORDER: Record<string, string[]> = {
  GK: ['shotStopping','goalsPrevented','involvement'],
  CB: ['defending','involvement','attacking','creating'],
  LB: ['defending','involvement','creating','attacking'],
  RB: ['defending','involvement','creating','attacking'],
  LWB: ['defending','creating','involvement','attacking'],
  RWB: ['defending','creating','involvement','attacking'],
  DM: ['involvement','defending','creating','attacking'],
  CM: ['involvement','creating','attacking','defending'],
  AM: ['attacking','creating','involvement'],
  LW: ['attacking','creating','involvement'],
  RW: ['attacking','creating','involvement'],
  ST: ['attacking','creating','involvement'],
};
/* Pool positions whose weight vectors are IDENTICAL — same scale, more n. */
const POOL: Record<string,string> = {
  LB:'LB/RB', RB:'LB/RB', LWB:'LWB/RWB', RWB:'LWB/RWB', LW:'LW/RW', RW:'LW/RW',
};

it('rank probe', { timeout: 600000 }, async () => {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: refRows } = await db.from('rating_reference_stats').select('*').eq('season', '2025-26');
  const refStats: any = {};
  for (const r of refRows ?? []) {
    refStats[r.position_group] ??= {};
    refStats[r.position_group][r.component] = { median: Number(r.median), stddev: Number(r.stddev) };
  }
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('player_stats')
      .select('stats, players!inner(primary_position)').eq('season', '2025-26').range(from, from + 999);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const scores = new Map<string, number[]>();
  for (const r of rows) {
    const pos = (r as any).players?.primary_position; const s = (r as any).stats;
    if (!pos || !s || Number(s.minutes_played ?? 0) <= 0 || !ORDER[pos]) continue;
    const mr = calculateMatchRating(s, pos, refStats);
    if (!mr.breakdown.length) continue;
    const by = new Map(mr.breakdown.map((b: any) => [b.key, b.score]));
    const w: any = (POSW as any)[pos] ?? {};
    const bucket = POOL[pos] ?? pos;
    for (const g of ORDER[pos]) {
      const mem = MEMBERS[g];
      const wsum = mem.reduce((a, c) => a + (Number(w[c]) || 0), 0);
      if (wsum <= 0) continue;
      const sc = mem.reduce((a, c) => a + Number(by.get(c) ?? 0) * (Number(w[c]) || 0), 0) / wsum;
      const k = `${bucket}|${g}`;
      let a = scores.get(k); if (!a) { a = []; scores.set(k, a); }
      a.push(sc);
    }
  }

  /* TIE-SAFE: smallest observed value v where share(score >= v) <= target.
     Plain quantiles lie when the distribution has a tie block — CB attacking
     has p50 = p75 = p90 = 0.513, so "score >= p90" would decorate 40% of
     centre-backs with "Top 10%". */
  function tieSafe(sorted: number[], target: number) {
    const n = sorted.length;
    const maxCount = Math.floor(target * n);
    if (maxCount < 1) return null;
    let i = n - maxCount;
    const v = sorted[i];
    while (i < n && sorted[i] === v) i++;
    if (i >= n) return null; // the tie block runs to the top: no honest cut
    return { t: sorted[i], share: (n - i) / n };
  }

  const out: string[] = [];
  const log = (x: string) => out.push(x);
  const TARGETS = [0.25, 0.10, 0.05, 0.01];
  log('bucket|group           n     ' + TARGETS.map((t)=>`top${Math.round(t*100)}%`.padEnd(16)).join(''));
  const table: any = {};
  for (const k of [...scores.keys()].sort()) {
    const arr = scores.get(k)!; arr.sort((a,b)=>a-b);
    log(k.padEnd(22) + String(arr.length).padEnd(6) + TARGETS.map((t) => {
      const r = tieSafe(arr, t);
      return (r ? `${r.t.toFixed(3)} (${(100*r.share).toFixed(1)}%)` : '—').padEnd(16);
    }).join(''));
    const [bucket, g] = k.split('|');
    table[bucket] ??= {};
    table[bucket][g] = TARGETS.map((t) => {
      const r = tieSafe(arr, t);
      return r && r.share * 100 >= (t * 100) / 2 ? Number(r.t.toFixed(3)) : null;
    });
  }
  log('\n--- RANK_CUTS, tiers under half their label already nulled ---');
  log(JSON.stringify(table));
  writeFileSync('/tmp/rank-probe.txt', out.join('\n'));
});
