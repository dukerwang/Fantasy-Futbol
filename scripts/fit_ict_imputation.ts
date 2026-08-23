/**
 * Fits the ICT imputation coefficients used by src/lib/scoring/ictImputation.ts
 * and writes them to src/lib/scoring/ictImputation.json.
 *
 *   node --experimental-strip-types scripts/fit_ict_imputation.ts [--season 2025-26]
 *                                                                 [--holdout 31]
 *
 * Ridge regression per position, predicting influence / creativity / threat
 * from the stats FPL publishes during the live window. With --holdout it also
 * reports out-of-sample R² on gameweeks at or after that number; without it,
 * every row is used for the final fit.
 *
 * Refit once a season has ~5 gameweeks of its own data. FPL tweaked the BPS
 * formula for 2026/27 "to reduce overlap with defensive contribution points",
 * and bps is the strongest feature here, so coefficients trained on 2025-26
 * are a cold start rather than a permanent answer.
 *
 * Feature extraction is imported, never re-implemented — that is what keeps the
 * fitted coefficients aligned with what scoring actually feeds them.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractFeatures, FEATURE_COUNT } from '../src/lib/scoring/ictFeatures.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'src/lib/scoring/ictImputation.json');

const args = process.argv.slice(2);
const argOf = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SEASON = argOf('--season', '2025-26');
const HOLDOUT = args.includes('--holdout') ? parseInt(argOf('--holdout', '31'), 10) : null;

// ── env ──────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
    readFileSync(resolve(ROOT, '.env.local'), 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

// ── load ─────────────────────────────────────────────────────────────────────
type Row = { gameweek: number; stats: Record<string, unknown>; position: string };
const rows: Row[] = [];
for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
        .from('player_stats')
        .select('gameweek, stats, players!inner(primary_position)')
        .eq('season', SEASON)
        .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as any[]) {
        if ((r.stats?.minutes_played ?? 0) > 0 && r.players?.primary_position) {
            rows.push({ gameweek: r.gameweek, stats: r.stats, position: r.players.primary_position });
        }
    }
    if (data.length < 1000) break;
}
console.log(`season ${SEASON}: ${rows.length} appearances`);
if (rows.length < 500) throw new Error('not enough data to fit');

// ── ridge via normal equations on standardised features ──────────────────────
const TARGETS = ['influence', 'creativity', 'threat'] as const;
const P = FEATURE_COUNT;
const LAMBDA = 1.0;

function ridge(X: number[][], y: number[]): number[] {
    const n = X.length;
    const mu = new Array(P).fill(0);
    const sd = new Array(P).fill(0);
    for (const r of X) for (let j = 0; j < P; j++) mu[j] += r[j] / n;
    for (const r of X) for (let j = 0; j < P; j++) sd[j] += (r[j] - mu[j]) ** 2 / n;
    for (let j = 0; j < P; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    const ym = y.reduce((a, b) => a + b, 0) / n;

    const A = Array.from({ length: P }, () => new Array(P + 1).fill(0));
    for (let i = 0; i < n; i++) {
        const z = X[i].map((v, j) => (v - mu[j]) / sd[j]);
        const yc = y[i] - ym;
        for (let a = 0; a < P; a++) {
            for (let b = a; b < P; b++) A[a][b] += z[a] * z[b];
            A[a][P] += z[a] * yc;
        }
    }
    for (let a = 0; a < P; a++) {
        for (let b = 0; b < a; b++) A[a][b] = A[b][a];
        A[a][a] += (LAMBDA * n) / 100;
    }
    // Gauss-Jordan with partial pivoting
    for (let c = 0; c < P; c++) {
        let piv = c;
        for (let r = c + 1; r < P; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
        [A[c], A[piv]] = [A[piv], A[c]];
        if (Math.abs(A[c][c]) < 1e-9) continue;
        for (let r = 0; r < P; r++) {
            if (r === c) continue;
            const f = A[r][c] / A[c][c];
            for (let k = c; k <= P; k++) A[r][k] -= f * A[c][k];
        }
    }
    const bStd = new Array(P).fill(0);
    for (let c = 0; c < P; c++) if (Math.abs(A[c][c]) > 1e-9) bStd[c] = A[c][P] / A[c][c];

    // de-standardise back onto raw feature scale, intercept last
    const beta = bStd.map((b, j) => b / sd[j]);
    beta.push(ym - bStd.reduce((a, b, j) => a + (b * mu[j]) / sd[j], 0));
    return beta;
}

const predict = (beta: number[], x: number[]) =>
    Math.max(0, x.reduce((a, v, j) => a + v * beta[j], 0) + beta[P]);

// ── bucketing: own model where the data supports it, else position group ─────
const GROUP: Record<string, string> = {
    GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
    DM: 'MID', CM: 'MID', AM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT',
};
const MIN_ROWS_FOR_OWN_MODEL = 250;
const counts = new Map<string, number>();
for (const r of rows) counts.set(r.position, (counts.get(r.position) ?? 0) + 1);
const bucketOf = (pos: string) =>
    (counts.get(pos) ?? 0) >= MIN_ROWS_FOR_OWN_MODEL ? pos : (GROUP[pos] ?? 'MID');

const train = HOLDOUT ? rows.filter((r) => r.gameweek < HOLDOUT) : rows;
const test = HOLDOUT ? rows.filter((r) => r.gameweek >= HOLDOUT) : [];
console.log(`train ${train.length}` + (HOLDOUT ? `, holdout ${test.length} (GW>=${HOLDOUT})` : ''));

const out: Record<string, Record<string, number[]>> = {};
const buckets = [...new Set(rows.map((r) => bucketOf(r.position)))].sort();
for (const bucket of buckets) {
    const tr = train.filter((r) => bucketOf(r.position) === bucket);
    if (tr.length < 50) { console.warn(`  skip ${bucket}: only ${tr.length} rows`); continue; }
    const X = tr.map((r) => extractFeatures(r.stats));
    out[bucket] = {};
    for (const t of TARGETS) {
        out[bucket][t] = ridge(X, tr.map((r) => Number(r.stats[t]) || 0)).map(
            (v) => Math.round(v * 1e6) / 1e6,
        );
    }
}
// Always provide a MID fallback for unrecognised positions.
if (!out.MID) {
    const tr = train.filter((r) => GROUP[r.position] === 'MID');
    if (tr.length >= 50) {
        const X = tr.map((r) => extractFeatures(r.stats));
        out.MID = {};
        for (const t of TARGETS) {
            out.MID[t] = ridge(X, tr.map((r) => Number(r.stats[t]) || 0)).map(
                (v) => Math.round(v * 1e6) / 1e6,
            );
        }
    }
}

if (HOLDOUT && test.length) {
    console.log('\nout-of-sample R²');
    console.log('bucket    n       ' + TARGETS.map((t) => t.padStart(11)).join(''));
    for (const bucket of Object.keys(out)) {
        const te = test.filter((r) => bucketOf(r.position) === bucket);
        if (!te.length) continue;
        const r2 = TARGETS.map((t) => {
            const y = te.map((r) => Number(r.stats[t]) || 0);
            const yh = te.map((r) => predict(out[bucket][t], extractFeatures(r.stats)));
            const ym = y.reduce((a, b) => a + b, 0) / y.length;
            const ss = y.reduce((a, v, i) => a + (v - yh[i]) ** 2, 0);
            const st = y.reduce((a, v) => a + (v - ym) ** 2, 0);
            return st > 0 ? 1 - ss / st : 0;
        });
        console.log(bucket.padEnd(9), String(te.length).padEnd(7), r2.map((v) => v.toFixed(3).padStart(11)).join(''));
    }
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\nwrote ${Object.keys(out).length} buckets → ${OUT}`);
