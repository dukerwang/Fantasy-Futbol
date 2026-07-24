/**
 * Gaffa — Season Kickoff Preflight
 *
 * Kickoff is irreversible and, until recently, failed silently in several
 * places at once: compensation paid nobody, auctions failed to insert, and the
 * "already owned" filter matched nothing. Every one of those was invisible
 * until it had already done damage.
 *
 * This module proves the run will work *before* the destructive half executes.
 * `runSeasonReset` has `runPreflightChecks`; this is the missing equivalent for
 * Kickoff. Blockers must be cleared; warnings are judgement calls the operator
 * acknowledges.
 *
 * Design rule: every check here corresponds to a failure that actually
 * happened. This is not speculative validation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { COMPENSATION_RATE } from '@/lib/transfers/compensation';
import { AUCTION_THRESHOLD, findPromotedClubsAndArrivals } from '@/lib/offseason/seasonKickoff';

/** Above this, an auction batch looks like a backlog release rather than a window. */
const AUCTION_SANITY_CEILING = 60;

export type PreflightSeverity = 'blocker' | 'warning';

export interface PreflightIssue {
  severity: PreflightSeverity;
  code: string;
  message: string;
  detail?: string[];
}

export interface KickoffPreflightResult {
  leagueId: string;
  leagueName: string;
  ready: boolean;
  issues: PreflightIssue[];
  summary: {
    auctionsToCreate: number;
    promotedClubs: string[];
    departuresToProcess: number;
    compensationTotal: number;
  };
}

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

const PARTICLES = new Set([
  'de', 'da', 'do', 'dos', 'das', 'van', 'von', 'del', 'della', 'di', 'la', 'le',
  'el', 'al', 'bin', 'ibn', 'den', 'der', 'ter', 'junior', 'santos', 'silva', 'costa',
]);

function normalize(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(str: string | null | undefined): string[] {
  return normalize(str).split(' ').filter((t) => t.length >= 3 && !PARTICLES.has(t));
}

interface FplElement {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  team: number;
}

/**
 * Is this departed player actually still in the Premier League under a
 * different row? This is the Murillo / Joelinton failure: a stale row and a
 * live row for the same human, with the roster pointing at the stale one.
 * Kickoff would drop the player and pay compensation for someone who never
 * left. Mononyms are the tricky case — "Murillo" shares exactly one token with
 * "Murillo Costa dos Santos" — so a single shared token counts when it makes
 * up the whole of one side's name.
 */
function looksLikeSamePlayer(dbName: string, el: FplElement): boolean {
  // Deliberately ignores web_name. On exactly the rows this check inspects,
  // web_name is the field a bad sync overwrote — Konaté's row carries
  // "Endo", Gordon's carries "Bakwa" — so matching on it identifies the
  // player who corrupted the row rather than the player who owns it. `name`
  // is the field the sync preserves, which makes it the trustworthy signal.
  const a = significantTokens(dbName);
  const b = significantTokens(`${el.first_name} ${el.second_name}`);
  if (a.length === 0 || b.length === 0) return false;

  const shared = a.filter((t) => b.includes(t));
  if (shared.length >= 2) return true;
  return shared.length === 1 && (a.length === 1 || b.length === 1);
}

export async function runKickoffPreflight(
  admin: SupabaseClient,
  leagueId: string,
): Promise<KickoffPreflightResult> {
  const issues: PreflightIssue[] = [];

  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .select('id, name, status, roster_locked, previous_season, current_season')
    .eq('id', leagueId)
    .single();
  if (leagueErr || !league) throw new Error('League not found');

  if (league.status !== 'offseason') {
    issues.push({
      severity: 'blocker',
      code: 'league_not_offseason',
      message: `League is "${league.status}", not "offseason". Kickoff will refuse to run.`,
    });
  }

  // ── Roster-side checks ────────────────────────────────────────────────────
  const { data: teams } = await admin.from('teams').select('id, team_name').eq('league_id', leagueId);
  const teamIds = (teams ?? []).map((t) => t.id);

  let rosteredIds: string[] = [];
  if (teamIds.length > 0) {
    const { data: entries } = await admin
      .from('roster_entries')
      .select('player_id')
      .in('team_id', teamIds)
      .not('player_id', 'is', null);
    rosteredIds = [...new Set((entries ?? []).map((e) => e.player_id))];
  }

  const { data: rosteredPlayers } = rosteredIds.length
    ? await admin
        .from('players')
        .select('id, name, web_name, pl_team, market_value, market_value_updated_at, is_active, fpl_id')
        .in('id', rosteredIds)
    : { data: [] as never[] };

  const departures = (rosteredPlayers ?? []).filter((p) => !p.is_active);
  const compensationTotal = departures.reduce(
    (sum, p) => sum + Number(p.market_value ?? 0) * COMPENSATION_RATE,
    0,
  );

  // Departed players still present in the live FPL bootstrap = duplicate rows.
  let bootstrap: { elements: FplElement[] } | null = null;
  try {
    const res = await fetch(FPL_URL, { headers: { 'User-Agent': 'Gaffa/1.0' }, cache: 'no-store' });
    if (res.ok) bootstrap = await res.json();
  } catch {
    bootstrap = null;
  }

  if (!bootstrap) {
    issues.push({
      severity: 'warning',
      code: 'fpl_unreachable',
      message: 'Could not reach the FPL API — skipped the duplicate-player check.',
    });
  } else {
    const stillInPl: string[] = [];
    for (const p of departures) {
      const hit = bootstrap.elements.find((el) => looksLikeSamePlayer(p.name, el));
      if (hit) {
        stillInPl.push(`${p.name} → FPL "${hit.first_name} ${hit.second_name}" [${hit.web_name}]`);
      }
    }
    if (stillInPl.length > 0) {
      issues.push({
        severity: 'blocker',
        code: 'departed_player_still_in_pl',
        message:
          `${stillInPl.length} rostered player(s) are marked as departed but still appear in the FPL bootstrap. ` +
          'Kickoff would drop them and pay compensation for players who never left. ' +
          'Repoint the roster entries onto the live rows first.',
        detail: stillInPl,
      });
    }
  }

  // Compensation is paid straight from market_value — a junk value is a wrong payout.
  const unpriced = departures.filter((p) => !p.market_value_updated_at);
  if (unpriced.length > 0) {
    issues.push({
      severity: 'blocker',
      code: 'departure_never_priced',
      message:
        `${unpriced.length} departing player(s) have never had a Transfermarkt value written, ` +
        'so their compensation would be based on a raw FPL cost. Run scripts/sync_transfermarkt_gaps.ts.',
      detail: unpriced.map((p) => `${p.name} — €${p.market_value}m`),
    });
  }

  const worthless = departures.filter((p) => !(Number(p.market_value) > 0));
  if (worthless.length > 0) {
    issues.push({
      severity: 'blocker',
      code: 'departure_zero_value',
      message: `${worthless.length} departing player(s) have no market value and would be compensated €0.`,
      detail: worthless.map((p) => p.name),
    });
  }

  // ── Auction-side checks ───────────────────────────────────────────────────
  let auctionsToCreate = 0;
  let promotedClubs: string[] = [];
  try {
    const { data: preSync } = await admin.from('players').select('pl_team').eq('is_active', true);
    const previousClubs = new Set<string>(
      (preSync ?? []).map((p) => p.pl_team).filter(Boolean) as string[],
    );
    const found = await findPromotedClubsAndArrivals(
      admin,
      leagueId,
      league.previous_season,
      previousClubs,
    );
    auctionsToCreate = found.candidates.length;
    promotedClubs = [...found.promotedClubs];
  } catch (err) {
    issues.push({
      severity: 'blocker',
      code: 'candidate_query_failed',
      message: `Could not compute the auction list: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (auctionsToCreate > AUCTION_SANITY_CEILING) {
    issues.push({
      severity: 'warning',
      code: 'auction_count_implausible',
      message:
        `${auctionsToCreate} auctions would open at once (threshold €${AUCTION_THRESHOLD}m). ` +
        'A normal transfer window is a handful. This usually means a backlog rather than genuine new arrivals.',
    });
  }

  if (auctionsToCreate > 0) {
    // Prove the insert shape actually works before the destructive half runs.
    // A bad column name here is exactly what made Kickoff abort mid-run.
    const probe = await probeAuctionWrite(admin, leagueId);
    if (probe) {
      issues.push({
        severity: 'blocker',
        code: 'auction_write_failed',
        message: `A test auction row could not be written: ${probe}`,
      });
    }
  }

  const ready = !issues.some((i) => i.severity === 'blocker');

  return {
    leagueId,
    leagueName: league.name,
    ready,
    issues,
    summary: {
      auctionsToCreate,
      promotedClubs,
      departuresToProcess: departures.length,
      compensationTotal: Math.round(compensationTotal * 100) / 100,
    },
  };
}

/**
 * Writes and immediately removes a real waiver_claims row. Returns an error
 * string on failure, null on success. Uses a player the league has never
 * auctioned so it can't collide with the partial unique index on
 * (league_id, player_id) WHERE team_id IS NULL AND status='pending'.
 */
async function probeAuctionWrite(admin: SupabaseClient, leagueId: string): Promise<string | null> {
  const { data: existing } = await admin
    .from('waiver_claims')
    .select('player_id')
    .eq('league_id', leagueId)
    .eq('is_auction', true);
  const used = new Set((existing ?? []).map((r) => r.player_id));

  const { data: pool } = await admin.from('players').select('id').eq('is_active', true).limit(200);
  const victim = (pool ?? []).find((p) => !used.has(p.id));
  if (!victim) return null; // nothing safe to probe with; don't invent a failure

  const { data: inserted, error: insertErr } = await admin
    .from('waiver_claims')
    .insert({
      league_id: leagueId,
      team_id: null,
      player_id: victim.id,
      faab_bid: 0,
      priority: 999,
      status: 'pending',
      gameweek: 0,
      is_auction: true,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    })
    .select('id')
    .single();

  if (insertErr) return insertErr.message;

  const { error: deleteErr } = await admin.from('waiver_claims').delete().eq('id', inserted.id);
  if (deleteErr) return `probe row written but could not be removed (id ${inserted.id}): ${deleteErr.message}`;

  return null;
}
