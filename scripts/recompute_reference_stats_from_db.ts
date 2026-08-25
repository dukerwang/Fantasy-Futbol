/**
 * Recomputes `rating_reference_stats` for a season from the stored
 * `player_stats` rows, by instrumenting the scoring engine itself.
 *
 *   node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs \
 *     scripts/recompute_reference_stats_from_db.ts [--season 2025-26] [--apply]
 *
 * Why not scripts/recompute_reference_stats.mjs
 * ─────────────────────────────────────────────
 * Two reasons.
 *
 * 1. It fetches `event/{gw}/live` from FPL, which stops serving a season once
 *    it rolls over. It cannot reach an archived season at all.
 * 2. It DUPLICATES the engine's component formulas in its own code, and has
 *    silently drifted from them before — it computed GK `defensive` as
 *    `recoveries*0.5 + cbi*0.5 + 16 - gc*4.0` against the engine's own very
 *    different expression, and stored a stddev of 10.72 where the engine's real
 *    output spread was 17.18, so the sigmoid ran ~60% too steep for keepers.
 *
 * This script removes that failure mode: it patches a temporary copy of
 * matchRating.ts that records each component's pre-sigmoid raw value, runs the
 * real engine over the stored rows, and takes medians and stddevs of what the
 * engine actually produced. The formulas cannot drift because they are never
 * restated here.
 *
 * Population and pooling mirror the original script: appearances of 45+
 * minutes; LW/RW pooled; LB/RB/LWB/RWB pooled into one wide-defender bucket.
 * `goal_involvement` and `finishing` are normalised against GLOBAL constants in
 * the engine rather than per-position reference rows, so they are written
 * through unchanged from whatever is already stored.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argOf = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const SEASON = argOf('--season', '2025-26');
const APPLY = args.includes('--apply');
const MIN_MINUTES = 45;

const env = Object.fromEntries(
    readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

// ── instrument the engine ────────────────────────────────────────────────────
// Each replacement records the raw value the engine is about to hand to
// sigmoidNormalize, keyed by component. `goal_involvement` and `finishing` are
// skipped: they normalise against global constants, not per-position rows.
const SRC = resolve(ROOT, 'src/lib/scoring/matchRating.ts');
const TMP = resolve(ROOT, 'src/lib/scoring/matchRating.__refstats.ts');
const rec = (comp: string, expr: string) =>
    `((globalThis as any).__raws && (globalThis as any).__raws.push(['${comp}', ${expr}]), ${expr})`;

let src = readFileSync(SRC, 'utf8');
const patches: Array<[string, string]> = [
    ['sigmoidNormalize(adjustedBps, ref.match_impact.median',
     `sigmoidNormalize(${rec('match_impact', 'adjustedBps')}, ref.match_impact.median`],
    ['sigmoidNormalize(infl, ref.influence.median',
     `sigmoidNormalize(${rec('influence', 'infl')}, ref.influence.median`],
    ['sigmoidNormalize(crea, ref.creativity.median',
     `sigmoidNormalize(${rec('creativity', 'crea')}, ref.creativity.median`],
    ['sigmoidNormalize(thr, ref.threat.median',
     `sigmoidNormalize(${rec('threat', 'thr')}, ref.threat.median`],
    ['score: sigmoidNormalize(defensiveRaw, ref.defensive.median',
     `score: sigmoidNormalize(${rec('defensive', 'defensiveRaw')}, ref.defensive.median`],
    ['sigmoidNormalize(saveVolRaw, ref.save_score.median',
     `sigmoidNormalize(${rec('save_score', 'saveVolRaw')}, ref.save_score.median`],
];
for (const [find, repl] of patches) {
    if (!src.includes(find)) throw new Error(`instrumentation anchor not found: ${find}`);
    src = src.replace(find, repl);
}
writeFileSync(TMP, src);

let mod: any;
try {
    mod = await import(TMP);

    console.log(`season ${SEASON} — ${APPLY ? 'APPLY' : 'dry run'}`);

    const PAGE = 1000;
    async function page<T>(table: string, select: string, apply: (q: any) => any): Promise<T[]> {
        const out: T[] = [];
        for (let p = 0; ; p++) {
            const { data, error } = await apply(sb.from(table).select(select)).range(p * PAGE, (p + 1) * PAGE - 1);
            if (error) throw new Error(`${table}: ${error.message}`);
            if (!data?.length) break;
            out.push(...data);
            if (data.length < PAGE) break;
        }
        return out;
    }

    const players = await page<any>('players', 'id, primary_position', (q) => q);
    const posById = new Map(players.map((p) => [p.id, p.primary_position]));
    const rows = await page<any>('player_stats', 'player_id, stats', (q: any) => q.eq('season', SEASON));
    console.log(`rows: ${rows.length}`);

    const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
    const COMPONENTS = ['match_impact', 'influence', 'creativity', 'threat', 'defensive', 'save_score'];
    const buckets: Record<string, Record<string, number[]>> = Object.fromEntries(
        POSITIONS.map((p) => [p, Object.fromEntries(COMPONENTS.map((c) => [c, [] as number[]]))]),
    );

    // Reference stats are an input to scoring, but the raws we collect are
    // pre-sigmoid and so do not depend on them. Any map will do.
    const seedRef = mod.DEFAULT_REFERENCE_STATS;
    let kept = 0;
    for (const r of rows) {
        const pos = posById.get(r.player_id);
        if (!pos || !POSITIONS.includes(pos) || !r.stats) continue;
        if ((r.stats.minutes_played ?? 0) < MIN_MINUTES) continue;
        (globalThis as any).__raws = [];
        mod.calculateMatchRating(r.stats, pos, seedRef);
        for (const [comp, val] of (globalThis as any).__raws as Array<[string, number]>) {
            if (buckets[pos][comp]) buckets[pos][comp].push(val);
        }
        kept++;
    }
    (globalThis as any).__raws = null;
    console.log(`kept ${kept} appearances of ${MIN_MINUTES}+ minutes`);

    const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const pstdev = (a: number[]) => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / a.length); };
    const pooled = (pos: string, comp: string) => {
        if (pos === 'LW' || pos === 'RW') return [...buckets.LW[comp], ...buckets.RW[comp]];
        if (['LB', 'RB', 'LWB', 'RWB'].includes(pos)) return [...buckets.LB[comp], ...buckets.RB[comp], ...buckets.LWB[comp], ...buckets.RWB[comp]];
        return buckets[pos][comp];
    };

    const existing = await page<any>('rating_reference_stats', 'position_group, component, median, stddev', (q: any) => q.eq('season', SEASON));
    const old = new Map(existing.map((e) => [`${e.position_group}|${e.component}`, e]));

    const out: any[] = [];
    console.log('\nposition  component        median     stddev        (was)            n');
    for (const pos of POSITIONS) {
        for (const comp of COMPONENTS) {
            const vals = pooled(pos, comp);
            if (!vals.length) continue;
            const med = Number(median(vals).toFixed(4));
            const sd = Number(pstdev(vals).toFixed(4));
            const o = old.get(`${pos}|${comp}`);
            const moved = o && (Math.abs(Number(o.median) - med) > 0.005 || Math.abs(Number(o.stddev) - sd) > 0.005);
            console.log(`${pos.padEnd(9)} ${comp.padEnd(15)} ${med.toFixed(3).padStart(8)} ${sd.toFixed(3).padStart(10)}   ${o ? `(${Number(o.median).toFixed(2)}, ${Number(o.stddev).toFixed(2)})`.padEnd(18) : '(new)'.padEnd(18)} ${String(vals.length).padStart(5)}${moved ? '  <-- moved' : ''}`);
            out.push({ position_group: pos, component: comp, median: med, stddev: sd, sample_size: vals.length, season: SEASON });
        }
    }

    if (!APPLY) {
        console.log('\ndry run — nothing written. Re-run with --apply.');
    } else {
        console.log('\nwriting...');
        for (const row of out) {
            const { error } = await sb.from('rating_reference_stats')
                .upsert(row, { onConflict: 'season,position_group,component' });
            if (error) throw new Error(`${row.position_group}/${row.component}: ${error.message}`);
        }
        console.log(`done — ${out.length} reference rows written.`);
    }
} finally {
    try { unlinkSync(TMP); } catch { /* already gone */ }
}
