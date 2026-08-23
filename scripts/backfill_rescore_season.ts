/**
 * Re-scores a completed season's `player_stats` through the current engine.
 *
 *   node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs \
 *     scripts/backfill_rescore_season.ts [--season 2025-26] [--apply]
 *
 * Written for the 2026-08-23 removal of the goalkeeper-only appearance credit,
 * which moved `fantasy_points` on every keeper appearance already on record. It
 * is not specific to that change — any engine change that moves stored points
 * needs the same pass.
 *
 * Why not /api/admin/backfill-scoring-v2: that route refetches
 * `event/{gw}/live` from FPL and writes the `_v2` shadow columns. FPL stops
 * serving a season once it rolls over, so it cannot reach 2025-26 at all. This
 * script re-scores from the `stats` JSON already stored on each row instead,
 * which is the same input the sync fed the engine in the first place.
 *
 * Safety: dry run by default, and it reports before it writes.
 *
 * It writes BOTH `match_rating` and `fantasy_points`, not just points. Measured
 * on 2025-26, 920 of 14,521 stored ratings (6.3%) do not reproduce from their
 * own stats blob — rows written at different points in the season by slightly
 * different engine revisions and never re-scored. Only one player drifts on
 * every row, so this is engine churn rather than a changed primary_position.
 * Writing points from a freshly-scored composite while leaving a stale rating
 * beside it would make those rows self-contradictory, so both move together.
 *
 * That correction is small: of 498 players with a season average, 53 move at
 * all, 3 move by 0.10 or more, and the mean absolute move is 0.0033. The two
 * largest movers have 4 and 2 appearances.
 *
 * Re-run whenever the engine moves stored points. It is idempotent: a second
 * pass over already-corrected data reports nothing to write.
 *
 * --check-only re-scores and reports without writing, and exits non-zero if any
 * rating fails to reproduce. Useful as a drift alarm once a season is settled.
 *
 * Scoring matches the sync exactly (src/app/api/sync/stats/route.ts): the row's
 * own stats blob, the player's primary position, reference stats from
 * getLatestReferenceStatsSeason, and NO primaryPosition argument, so the
 * out-of-position penalty is not applied — stored rows are always scored at the
 * player's own position.
 *
 * Afterwards, and in this order:
 *   1. select archive_player_season_stats('<season>')   -- rebuilds totals/ppg/ranks
 *   2. recomputePositionRanks(admin, '<season>')        -- position_ranks
 *   3. scratch/build_2025_26_json.mjs                   -- /share/stats snapshot
 * The snapshot reads both `player_stats` and the archive, so regenerating it
 * before those two leaves the page mixing an old scale with a new one.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateMatchRating } from '../src/lib/scoring/matchRating.ts';
import { loadReferenceStats } from '../src/lib/scoring/matchups.ts';
import { getLatestReferenceStatsSeason } from '../src/lib/season/currentSeason.ts';
import type { GranularPosition } from '../src/types/index.ts';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argOf = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SEASON = argOf('--season', '2025-26');
const APPLY = args.includes('--apply');
const CHECK_ONLY = args.includes('--check-only');

const env = Object.fromEntries(
    readFileSync(resolve(ROOT, '.env.local'), 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

const PAGE = 1000;
async function page<T>(table: string, select: string, apply: (q: any) => any): Promise<T[]> {
    const out: T[] = [];
    for (let p = 0; ; p++) {
        const { data, error } = await apply(sb.from(table).select(select))
            .range(p * PAGE, (p + 1) * PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        if (!data?.length) break;
        out.push(...data);
        if (data.length < PAGE) break;
    }
    return out;
}

console.log(`season ${SEASON} — ${APPLY ? 'APPLY' : 'dry run'}`);

const refSeason = await getLatestReferenceStatsSeason(sb as any);
const refStats = await loadReferenceStats(sb as any, refSeason);
console.log(`reference stats: ${refSeason}`);

const players = await page<any>('players', 'id, web_name, primary_position', (q) => q);
const posById = new Map(players.map((p) => [p.id, p.primary_position]));

const rows = await page<any>(
    'player_stats',
    'id, player_id, gameweek, match_rating, fantasy_points, stats',
    (q: any) => q.eq('season', SEASON),
);
console.log(`rows: ${rows.length}`);

type Change = { id: string; rating: number; points: number };
const changes: Change[] = [];
const pointDeltas: number[] = [];
const ratingDrift: Array<{ id: string; pos: string; stored: number; recomputed: number }> = [];
let skippedNoPos = 0;
let unchanged = 0;

for (const r of rows) {
    const pos = posById.get(r.player_id) as GranularPosition | undefined;
    if (!pos) { skippedNoPos++; continue; }
    if (!r.stats) { skippedNoPos++; continue; }

    const scored = calculateMatchRating(r.stats, pos, refStats as any);

    const storedRating = r.match_rating == null ? 0 : Number(r.match_rating);
    if (Math.abs(scored.rating - storedRating) > 0.005) {
        ratingDrift.push({ id: r.id, pos, stored: storedRating, recomputed: scored.rating });
    }

    const storedPts = Number(r.fantasy_points ?? 0);
    const ptsMoved = Math.abs(scored.fantasyPoints - storedPts) > 0.005;
    const rtgMoved = Math.abs(scored.rating - storedRating) > 0.005;
    if (ptsMoved || rtgMoved) {
        changes.push({ id: r.id, rating: scored.rating, points: scored.fantasyPoints });
        if (ptsMoved) pointDeltas.push(scored.fantasyPoints - storedPts);
    } else {
        unchanged++;
    }
}

console.log(`\nstale ratings corrected: ${ratingDrift.length} of ${rows.length} rows (${(100 * ratingDrift.length / rows.length).toFixed(1)}%)`);
for (const d of ratingDrift.slice(0, 5)) {
    console.log(`  e.g. ${d.pos}  ${d.stored} -> ${d.recomputed}`);
}
if (CHECK_ONLY) {
    console.log(ratingDrift.length ? '\ncheck-only: stored ratings are not reproducible.' : '\ncheck-only: all ratings reproduce.');
    process.exit(ratingDrift.length ? 1 : 0);
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)] ?? 0; };
console.log(`\nrows to write: ${changes.length}, unchanged ${unchanged}, skipped ${skippedNoPos} (no position or stats)`);
if (pointDeltas.length) {
    console.log(`points moved on ${pointDeltas.length} rows`);
    console.log(`  mean delta ${(sum(pointDeltas) / pointDeltas.length).toFixed(3)}`);
    console.log(`  min ${Math.min(...pointDeltas).toFixed(2)}  p50 ${pct(pointDeltas, 0.5).toFixed(2)}  max ${Math.max(...pointDeltas).toFixed(2)}`);
    console.log(`  negative deltas: ${pointDeltas.filter((d) => d < 0).length}`);
    console.log(`  total points added across the season: ${sum(pointDeltas).toFixed(0)}`);
}

if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.');
    process.exit(0);
}

console.log('\nwriting...');
let written = 0;
// One statement per row: the values differ per row, and PostgREST's upsert would
// need every NOT NULL column restated, which risks clobbering more than intended
// on a table this wide. Kept to a modest concurrency with retries — 500 in
// flight at once reliably tripped `fetch failed` partway through the season.
const CONCURRENCY = 25;
const RETRIES = 4;

async function writeOne(c: Change): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            const { error } = await sb.from('player_stats')
                .update({ fantasy_points: c.points, match_rating: c.rating })
                .eq('id', c.id);
            if (error) throw new Error(error.message);
            return;
        } catch (err) {
            if (attempt > RETRIES) throw new Error(`update ${c.id} failed after ${RETRIES} retries: ${err}`);
            await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
        }
    }
}

for (let i = 0; i < changes.length; i += CONCURRENCY) {
    await Promise.all(changes.slice(i, i + CONCURRENCY).map(writeOne));
    written += Math.min(CONCURRENCY, changes.length - i);
    if (written % 500 < CONCURRENCY) process.stdout.write(`\r  ${written}/${changes.length}`);
}
console.log(`\r  ${written}/${changes.length}\ndone — ${written} rows updated.`);
console.log('Re-run without --apply to confirm nothing is left to write.');
console.log('\nNext, in order:');
console.log(`  select archive_player_season_stats('${SEASON}');`);
console.log(`  recompute position ranks for ${SEASON}`);
console.log('  regenerate the /share/stats snapshot');
