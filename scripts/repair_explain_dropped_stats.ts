/**
 * Repairs `saves`, `goals_conceded` and `clean_sheet` on a completed season's
 * `player_stats` rows, from the vaastav FPL archive.
 *
 *   node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs \
 *     scripts/repair_explain_dropped_stats.ts [--season 2025-26] [--apply]
 *
 * Why this exists
 * ───────────────
 * `/api/sync/stats` read these three fields out of FPL's `explain` block, which
 * only itemises stats that SCORED POINTS for that position. A stat worth
 * nothing there is absent from the payload entirely, and the `?? 0` fallback
 * turned every absence into a recorded zero:
 *
 *   saves           1 pt per 3, so 1- and 2-save games were absent
 *   goals_conceded  -1 per 2 and only for GK/DEF, so a single goal was absent
 *                   for them and EVERY goal was absent for MID/FWD
 *   clean_sheets    0 pts for a forward, so absent for FWD
 *
 * Measured on 2025-26: 276 of 757 keeper starts recorded 0 saves against a true
 * 54, and midfielders' mean goals_conceded read 0.21 against a mean xGC of 1.23
 * — which handed every midfielder an `xgcOutperf` bonus scaled to how many
 * chances the OPPOSITION created. The sync itself is fixed; this repairs the
 * rows already on record.
 *
 * FPL stops serving a season once it rolls over, so the source here is the
 * vaastav/Fantasy-Premier-League archive. It independently reproduces our data
 * exactly at 3+ saves and 2+ goals conceded, and diverges only at the values
 * the explain block drops — which is the signature the bug predicts.
 *
 * Joining
 * ───────
 * NOT on `players.fpl_id`. FPL reassigns element ids every season, so the
 * stored id is the CURRENT season's and matches the wrong player in an archived
 * one (79% of rows disagreed on minutes when tried). Instead each player is
 * fingerprinted by the set of (fixture, minutes, bps) values across the season,
 * with a shared name token as corroboration. Minutes agreement on the resulting
 * match is the validator and must be 100%; the script aborts if it is not.
 *
 * Safety: dry run by default, reports before it writes, and idempotent — a
 * second pass over repaired data reports nothing to write.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argOf = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SEASON = argOf('--season', '2025-26');
const APPLY = args.includes('--apply');
const CACHE = resolve(ROOT, `scratch/merged_gw_${SEASON}.csv`);
const ARCHIVE_URL = `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/${SEASON}/gws/merged_gw.csv`;

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
        const { data, error } = await apply(sb.from(table).select(select)).range(p * PAGE, (p + 1) * PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        if (!data?.length) break;
        out.push(...data);
        if (data.length < PAGE) break;
    }
    return out;
}

console.log(`season ${SEASON} — ${APPLY ? 'APPLY' : 'dry run'}`);

// ── archive ──────────────────────────────────────────────────────────────────
if (!existsSync(CACHE)) {
    console.log(`fetching ${ARCHIVE_URL}`);
    const res = await fetch(ARCHIVE_URL);
    if (!res.ok) throw new Error(`archive fetch failed: ${res.status}`);
    writeFileSync(CACHE, await res.text());
}
const splitCsv = (l: string) => {
    const out: string[] = []; let cur = '', q = false;
    for (const ch of l) {
        if (ch === '"') { q = !q; continue; }
        if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out;
};
const lines = readFileSync(CACHE, 'utf8').split('\n');
const head = splitCsv(lines[0]);
const ix = (n: string) => head.indexOf(n);
type Arc = { el: number; name: string; fixture: number; sv: number; gc: number; cs: number; min: number; bps: number };
const arch: Arc[] = [];
for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const r = splitCsv(lines[i]);
    arch.push({ el: +r[ix('element')], name: r[ix('name')], fixture: +r[ix('fixture')],
        sv: +r[ix('saves')], gc: +r[ix('goals_conceded')], cs: +r[ix('clean_sheets')],
        min: +r[ix('minutes')], bps: +r[ix('bps')] });
}
console.log(`archive rows: ${arch.length}`);

const archByEl = new Map<number, Arc[]>();
const fixMin = new Map<string, number[]>();
const fixMinBps = new Map<string, number[]>();
const nameByEl = new Map<number, string>();
for (const a of arch) {
    if (!archByEl.has(a.el)) archByEl.set(a.el, []);
    archByEl.get(a.el)!.push(a);
    nameByEl.set(a.el, a.name);
    const k = `${a.fixture}|${a.min}`;
    if (!fixMin.has(k)) fixMin.set(k, []);
    fixMin.get(k)!.push(a.el);
    const k2 = `${a.fixture}|${a.min}|${a.bps}`;
    if (!fixMinBps.has(k2)) fixMinBps.set(k2, []);
    fixMinBps.get(k2)!.push(a.el);
}

// ── ours ─────────────────────────────────────────────────────────────────────
const players = await page<any>('players', 'id, web_name, name, primary_position', (q) => q);
const pById = new Map(players.map((p) => [p.id, p]));
const rows = await page<any>('player_stats', 'id, player_id, match_id, stats', (q: any) => q.eq('season', SEASON));
console.log(`our rows: ${rows.length}`);

const byPlayer = new Map<string, any[]>();
for (const r of rows) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id)!.push(r);
}

const tokens = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((t) => t.length >= 4);

const map = new Map<string, number>();
let ambiguous = 0;
for (const [pid, rs] of byPlayer) {
    const votes = new Map<number, number>();
    for (const r of rs) {
        const m = r.stats?.minutes_played ?? 0, b = r.stats?.bps ?? 0;
        for (const el of fixMinBps.get(`${r.match_id}|${m}|${b}`) ?? []) votes.set(el, (votes.get(el) ?? 0) + 3);
        for (const el of fixMin.get(`${r.match_id}|${m}`) ?? []) votes.set(el, (votes.get(el) ?? 0) + 1);
    }
    if (!votes.size) { ambiguous++; continue; }
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [bestEl, bestN] = sorted[0];
    const second = sorted[1]?.[1] ?? 0;
    const p = pById.get(pid);
    const ourTok = new Set([...tokens(p?.name), ...tokens(p?.web_name)]);
    const nameHit = tokens(nameByEl.get(bestEl) ?? '').some((t) => ourTok.has(t));
    if ((bestN >= Math.max(3, rs.length) && bestN > second * 1.5) || (bestN > second && nameHit)) map.set(pid, bestEl);
    else ambiguous++;
}
console.log(`players mapped ${map.size} of ${byPlayer.size} (ambiguous ${ambiguous})`);

// ── diff ─────────────────────────────────────────────────────────────────────
type Fix = { id: string; stats: any };
const fixes: Fix[] = [];
let matched = 0, minutesMismatch = 0, dSv = 0, dGc = 0, dCs = 0;
const unmappedStarts: string[] = [];

for (const [pid, rs] of byPlayer) {
    const el = map.get(pid);
    if (el === undefined) {
        for (const r of rs) if ((r.stats?.minutes_played ?? 0) >= 60) unmappedStarts.push(pById.get(pid)?.web_name ?? pid);
        continue;
    }
    const byFix = new Map((archByEl.get(el) ?? []).map((a) => [a.fixture, a]));
    for (const r of rs) {
        const a = byFix.get(r.match_id);
        if (!a) { if ((r.stats?.minutes_played ?? 0) >= 60) unmappedStarts.push(pById.get(pid)?.web_name ?? pid); continue; }
        matched++;
        if ((r.stats?.minutes_played ?? 0) !== a.min) { minutesMismatch++; continue; }
        const s = r.stats ?? {};
        const sv = (s.saves ?? 0) !== a.sv, gc = (s.goals_conceded ?? 0) !== a.gc, cs = !!s.clean_sheet !== (a.cs > 0);
        if (sv) dSv++;
        if (gc) dGc++;
        if (cs) dCs++;
        if (sv || gc || cs) fixes.push({ id: r.id, stats: { ...s, saves: a.sv, goals_conceded: a.gc, clean_sheet: a.cs > 0 } });
    }
}

console.log(`\nrows matched ${matched} (${(100 * matched / rows.length).toFixed(1)}%), minutes mismatch ${minutesMismatch}`);
console.log(`unmapped 60+ min starts: ${unmappedStarts.length}${unmappedStarts.length ? ` — ${[...new Set(unmappedStarts)].slice(0, 10).join(', ')}` : ''}`);
console.log(`\n  saves to correct:          ${dSv}`);
console.log(`  goals_conceded to correct: ${dGc}`);
console.log(`  clean_sheet to correct:    ${dCs}`);
console.log(`  rows to write:             ${fixes.length}`);

if (minutesMismatch > 0) {
    console.error(`\nABORT: ${minutesMismatch} matched rows disagree on minutes. The join is unsound; do not write.`);
    process.exit(1);
}
if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply.');
    process.exit(0);
}

// ── write ────────────────────────────────────────────────────────────────────
console.log('\nwriting...');
const CONCURRENCY = 25;
const RETRIES = 4;
let written = 0;

async function writeOne(f: Fix): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            const { error } = await sb.from('player_stats').update({ stats: f.stats }).eq('id', f.id);
            if (error) throw new Error(error.message);
            written++;
            if (written % 500 === 0) console.log(`  ${written}/${fixes.length}`);
            return;
        } catch (e) {
            if (attempt > RETRIES) throw e;
            await new Promise((r) => setTimeout(r, 250 * attempt));
        }
    }
}

for (let i = 0; i < fixes.length; i += CONCURRENCY) {
    await Promise.all(fixes.slice(i, i + CONCURRENCY).map(writeOne));
}
console.log(`\ndone — ${written} rows written.`);
console.log('Next: re-score with scripts/backfill_rescore_season.ts, then reference stats, archive, ranks, snapshot.');
