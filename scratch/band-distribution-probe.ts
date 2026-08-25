/* Band-distribution probe. Vitest only globs src/**/__tests__/**/*.test.ts,
   so to run this: copy to src/lib/scoring/__tests__/zz-band-probe.test.ts,
   run vitest on it, read /tmp/band-probe.txt, then delete the copy.
   Produced the BAND_CUTS table in src/lib/scoring/perfBand.ts. */
/* TEMPORARY probe — deleted after measuring. Not a test. */
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { calculateMatchRating, POSITION_WEIGHTS as POSW } from '../matchRating';
import { buildPerformanceGroups } from '../perfBand';

const MEMBERS: Record<string, string[]> = {
  attacking: ['goal_involvement', 'finishing', 'threat'], creating: ['creativity'],
  defending: ['defensive', 'save_score'], involvement: ['match_impact', 'influence'],
  shotStopping: ['save_score'], goalsPrevented: ['defensive'],
};

it('probe', { timeout: 300000 }, async () => {
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
  const bands = new Map<string, Map<string, number>>();
  let scored = 0;
  for (const r of rows) {
    const pos = (r as any).players?.primary_position; const s = (r as any).stats;
    if (!pos || !s || Number(s.minutes_played ?? 0) <= 0) continue;
    const mr = calculateMatchRating(s, pos, refStats);
    if (!mr.breakdown.length) continue;
    scored++;
    const by = new Map(mr.breakdown.map((b: any) => [b.key, b.score]));
    for (const g of buildPerformanceGroups(mr.breakdown, pos, s, 0)) {
      const w: any = (POSW as any)[pos] ?? {};
      const mem = MEMBERS[g.key];
      const wsum = mem.reduce((a, c) => a + (Number(w[c]) || 0), 0);
      const sc = wsum > 0
        ? mem.reduce((a, c) => a + Number(by.get(c) ?? 0) * (Number(w[c]) || 0), 0) / wsum
        : Math.max(...mem.map((c) => Number(by.get(c) ?? 0)));
      (scores.get(g.key) ?? scores.set(g.key, []).get(g.key)!).push(sc);
      const bc = bands.get(g.key) ?? bands.set(g.key, new Map()).get(g.key)!;
      bc.set(g.band, (bc.get(g.band) ?? 0) + 1);
    }
  }
  const out: string[] = [];
  const log = (x: string) => out.push(x);
  const pct = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  log(`scored ${scored} appearances\n`);
  log('group            n     p10   p25   p50   p75   p90   p97');
  for (const [k, arr] of scores) {
    arr.sort((a, b) => a - b);
    log(k.padEnd(16) + String(arr.length).padEnd(6) +
      [0.10,0.25,0.50,0.75,0.90,0.97].map((p) => pct(arr,p).toFixed(2).padEnd(6)).join(''));
  }
  log('');
  log('NEW band shares (weighted mean + percentile cuts):');
  log('group            poor    low     mid     good    best');
  for (const [k, bc] of bands) {
    const tot = [...bc.values()].reduce((a,b)=>a+b,0);
    log(k.padEnd(16) + ['poor','low','mid','good','best']
      .map((b)=>`${(100*(bc.get(b)??0)/tot).toFixed(1)}%`.padEnd(8)).join(''));
  }
  writeFileSync('/tmp/band-probe.txt', out.join('\n'));
});