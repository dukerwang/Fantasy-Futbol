/**
 * sync_transfermarkt_gaps.ts
 *
 * Fills the gap left by `sync_transfermarkt.ts`, which only ever sees players
 * present in `scripts/players.json` — a dump of current Premier League club
 * squads. Any player who has LEFT the PL disappears from that dump, so their
 * `market_value` freezes at whatever it last held. That matters because
 * relegation / transfer-out compensation pays 80% of `market_value`: a player
 * whose row still carries a raw FPL cost (e.g. Salah at €5m) pays out €4m.
 *
 * Transfermarkt keeps a page for every player regardless of competition, so
 * these are all resolvable — they just need a per-player lookup instead of a
 * squad crawl. This script does that lookup for the rows that actually matter:
 * players sitting on a fantasy roster whose value looks unreliable.
 *
 * Two requests per player (search, then profile), issued sequentially with a
 * delay. Dry-run by default — review the proposed values before applying.
 *
 * Usage:
 *   node --experimental-strip-types scripts/sync_transfermarkt_gaps.ts
 *   node --experimental-strip-types scripts/sync_transfermarkt_gaps.ts --apply
 *   node --experimental-strip-types scripts/sync_transfermarkt_gaps.ts --all
 *
 *   --apply   write the values (default is dry run)
 *   --all     include unrostered players too (default: rostered only)
 */

import { createClient } from '@supabase/supabase-js';
import stringSimilarity from 'string-similarity';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Runs as an ES module under `node --experimental-strip-types`, so __dirname
// isn't defined the way it is in the CommonJS sibling script.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
// scratch-only variant: scope to currently-active players regardless of
// roster ownership, so an unrostered-but-active new signing (Palestra) is
// covered without dragging in 341 departed/legacy rows nobody is looking at.
const ACTIVE_ONLY = process.argv.includes('--active-only');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const REQUEST_DELAY_MS = 1500;
const NAME_THRESHOLD = 0.6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadEnvLocal(): void {
  const envPath = path.join(HERE, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}

/** "€22.00m" / "€900k" / "€1.20bn" -> millions */
function parseValue(num: string, unit: string): number | null {
  const n = parseFloat(num.replace(/,/g, ''));
  if (isNaN(n)) return null;
  const u = unit.toLowerCase();
  if (u === 'bn') return n * 1000;
  if (u === 'k' || u === 'th.') return n / 1000;
  return n;
}

async function tmFetch(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

interface Candidate { tmId: string; name: string; url: string }

/**
 * Our `name` column holds FPL's registered full name, while Transfermarkt uses
 * the common name — "Carlos Henrique Casimiro" vs "Casemiro",
 * "André Trindade da Costa Neto" vs "André". Whole-string similarity scores
 * those pairs at 0.3-0.4 and throws away correct matches, so also compare the
 * best individual name token and keep whichever reading is stronger. Token
 * matches are reported separately so they get a second look in the dry run.
 */
function scoreName(dbName: string, tmName: string): { score: number; how: 'full' | 'token' } {
  const a = dbName.toLowerCase();
  const b = tmName.toLowerCase();
  const full = stringSimilarity.compareTwoStrings(a, b);

  const aTokens = a.split(/\s+/).filter((t) => t.length >= 4);
  const bTokens = b.split(/\s+/).filter((t) => t.length >= 4);
  let token = 0;
  for (const at of aTokens) {
    for (const bt of bTokens) {
      token = Math.max(token, stringSimilarity.compareTwoStrings(at, bt));
    }
  }

  return full >= token ? { score: full, how: 'full' } : { score: token, how: 'token' };
}

async function searchOnce(query: string): Promise<Candidate[]> {
  const html = await tmFetch(
    `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(query)}`,
  );
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const m of html.matchAll(/href="(\/[^"]+\/profil\/spieler\/(\d+))"[^>]*>([^<]*)</g)) {
    const [, url, tmId, label] = m;
    const clean = label.trim();
    if (!clean || seen.has(tmId)) continue;
    seen.add(tmId);
    out.push({ tmId, name: clean, url });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Transfermarkt's quick search matches the common name, not the registered
 * one, and returns nothing at all rather than degrading — "Yéremy Pino Santos"
 * finds zero results while "Yéremy Pino" finds him immediately. Our `name`
 * column holds FPL's registered form, which is routinely a token or two
 * longer, so fall back through shorter readings before giving up.
 */
async function searchPlayer(name: string): Promise<Candidate[]> {
  const tokens = name.split(/\s+/).filter(Boolean);
  const queries = [name];
  if (tokens.length > 2) {
    queries.push(tokens.slice(0, 2).join(' '));
    queries.push(tokens.slice(-2).join(' '));
  }
  if (tokens.length > 1) queries.push(tokens[tokens.length - 1]);

  for (const [i, q] of queries.entries()) {
    const hits = await searchOnce(q);
    if (hits.length > 0) return hits;
    if (i < queries.length - 1) await sleep(REQUEST_DELAY_MS);
  }
  return [];
}

async function fetchProfile(url: string): Promise<{ value: number | null; club: string; asOf: string | null }> {
  const html = await tmFetch(`https://www.transfermarkt.com${url}`);
  const block = html.match(/data-header__market-value-wrapper[^>]*>([\s\S]{0,400}?)<\/a>/);
  let value: number | null = null;
  if (block) {
    const m = block[1].match(/<span class="waehrung">€<\/span>\s*([\d.,]+)\s*<span class="waehrung">([^<]+)<\/span>/);
    if (m) value = parseValue(m[1], m[2]);
  }
  const clubMatch = html.match(/data-header__club[^>]*>[\s\S]{0,250}?title="([^"]+)"/);
  const asOfMatch = block?.[1].match(/Last update:\s*([\d/]+)/);
  return { value, club: clubMatch?.[1] ?? 'Unknown', asOf: asOfMatch?.[1] ?? null };
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[error] Missing Supabase env');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Which rows have an unreliable value? A value identical to the player's raw
  // FPL cost means Transfermarkt never reached them. Departed players have no
  // FPL row left to compare against, so treat every inactive row as suspect.
  const boot = await (await fetch('https://fantasy.premierleague.com/api/bootstrap-static/')).json();
  const fplCost = new Map<number, number>(
    (boot.elements as { id: number; now_cost: number }[]).map((e) => [e.id, e.now_cost / 10]),
  );

  const { data: players, error } = await db
    .from('players')
    .select('id, name, pl_team, market_value, market_value_updated_at, is_active, fpl_id');
  if (error || !players) {
    console.error('[db] fetch failed:', error?.message);
    process.exit(1);
  }

  const { data: entries } = await db.from('roster_entries').select('player_id');
  const rosterCount = new Map<string, number>();
  for (const e of entries ?? []) rosterCount.set(e.player_id, (rosterCount.get(e.player_id) ?? 0) + 1);

  const targets = players.filter((p) => {
    if (ACTIVE_ONLY && !p.is_active) return false;
    const owned = rosterCount.get(p.id) ?? 0;
    if (!ALL && !ACTIVE_ONLY && owned === 0) return false;
    // Never had a Transfermarkt value written — the most reliable signal there
    // is. Comparing against the *current* FPL cost misses rows carrying a stale
    // cost from an earlier sync (a mis-matched row can inherit another player's
    // old price, which matches nothing and looks legitimate).
    if (!p.market_value_updated_at) return true;
    if (!p.is_active) return true;
    // An active row with no fpl_id isn't in the FPL bootstrap at all — a
    // leftover from a previous season the sync hasn't retired yet, its value as
    // stale as any departed player's. (Salah and Hartman fall into this class.)
    if (p.fpl_id == null) return true;
    const cost = fplCost.get(p.fpl_id);
    return cost != null && Math.abs(Number(p.market_value) - cost) < 0.001;
  });

  console.log(`[scope] ${targets.length} player(s) need a Transfermarkt lookup${ALL ? '' : ' (rostered only)'}`);
  console.log(`[mode]  ${APPLY ? 'APPLY — will write' : 'DRY RUN'}\n`);

  const results: { id: string; name: string; from: number; to: number; club: string; matched: string; score: number; how: 'full' | 'token'; asOf: string | null }[] = [];
  const failures: { name: string; reason: string }[] = [];

  for (const [i, p] of targets.entries()) {
    process.stdout.write(`[${i + 1}/${targets.length}] ${p.name} … `);
    try {
      const candidates = await searchPlayer(p.name);
      await sleep(REQUEST_DELAY_MS);
      if (candidates.length === 0) {
        console.log('no search results');
        failures.push({ name: p.name, reason: 'no search results' });
        continue;
      }
      const scored = candidates
        .map((c) => ({ c, ...scoreName(p.name, c.name) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (best.score < NAME_THRESHOLD) {
        console.log(`weak match "${best.c.name}" (${best.score.toFixed(2)}) — skipped`);
        failures.push({ name: p.name, reason: `weak match "${best.c.name}" ${best.score.toFixed(2)}` });
        continue;
      }
      const profile = await fetchProfile(best.c.url);
      await sleep(REQUEST_DELAY_MS);
      if (profile.value == null) {
        console.log('no market value on profile');
        failures.push({ name: p.name, reason: 'no value on profile' });
        continue;
      }
      console.log(`€${p.market_value}m -> €${profile.value}m  [${profile.club}]`);
      results.push({
        id: p.id, name: p.name, from: Number(p.market_value), to: profile.value,
        club: profile.club, matched: best.c.name, score: best.score, how: best.how, asOf: profile.asOf,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`error: ${msg}`);
      failures.push({ name: p.name, reason: msg });
    }
  }

  console.log(`\n=== ${results.length} value(s) resolved, ${failures.length} unresolved ===\n`);
  for (const r of results) {
    const delta = r.to - r.from;
    const flags = [
      Math.abs(delta) >= 20 ? 'large change' : '',
      r.how === 'token' ? 'token match' : '',
    ].filter(Boolean);
    const flag = flags.length ? ` <== ${flags.join(' + ')}, verify` : '';
    console.log(
      `  ${r.name.padEnd(32)} €${String(r.from).padStart(6)}m -> €${String(r.to).padStart(6)}m  ` +
      `(pays €${(r.to * 0.8).toFixed(1)}m)  match:"${r.matched}" ${r.score.toFixed(2)} [${r.club}]${flag}`,
    );
  }
  if (failures.length) {
    console.log('\n  UNRESOLVED (leave as-is or set by hand):');
    for (const f of failures) console.log(`    ${f.name} — ${f.reason}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write these values.');
    return;
  }

  let written = 0;
  for (const r of results) {
    const { error: upErr } = await db
      .from('players')
      .update({ market_value: r.to, market_value_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', r.id);
    if (upErr) console.error(`  FAILED ${r.name}: ${upErr.message}`);
    else written++;
  }
  console.log(`\nWrote ${written} value(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
