import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchupLineup } from '@/types';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';
import { generateValidLineup } from '@/lib/lineups/generateValidLineup';

/**
 * Checks if a stored lineup has 11 starters and at least 4 bench players,
 * each with an assigned player ID.
 */
export function isLineupComplete(lineup: unknown): boolean {
  const l = lineup as {
    starters?: Array<{ player_id?: string; slot?: string }>;
    bench?: Array<{ player_id?: string; slot?: string }>;
  } | null;

  if (!l) return false;
  if (!Array.isArray(l.starters) || l.starters.length !== 11) return false;
  if (l.starters.some((s) => !s?.player_id)) return false;
  if (!Array.isArray(l.bench) || l.bench.length < 4) return false;
  if (l.bench.slice(0, 4).some((b) => !b?.player_id)) return false;
  return true;
}

export interface MatchupLiteForCarry {
  id?: string;
  gameweek: number;
  team_a_id: string | null;
  team_b_id: string | null;
  lineup_a?: unknown;
  lineup_b?: unknown;
}

/**
 * Synchronously resolves a team's effective lineup from an existing in-memory array of matchups.
 * If the current matchup for `gameweek` has a complete lineup, it returns it.
 * Otherwise, it walks backwards through earlier gameweeks (< gameweek) and returns the most recent complete lineup.
 */
export function resolveEffectiveLineupFromMatchups({
  teamId,
  gameweek,
  allMatchups,
}: {
  teamId: string;
  gameweek: number;
  allMatchups: MatchupLiteForCarry[];
}): MatchupLineup | null {
  // 1. Check current gameweek matchup
  const currentMatch = allMatchups.find(
    (m) => m.gameweek === gameweek && (m.team_a_id === teamId || m.team_b_id === teamId),
  );

  if (currentMatch) {
    const raw = currentMatch.team_a_id === teamId ? currentMatch.lineup_a : currentMatch.lineup_b;
    if (isLineupComplete(raw)) {
      return normalizeMatchupLineup(raw as MatchupLineup);
    }
  }

  // 2. Look for most recent complete lineup in prior gameweeks
  const pastMatchups = allMatchups
    .filter(
      (m) => m.gameweek < gameweek && (m.team_a_id === teamId || m.team_b_id === teamId),
    )
    .sort((a, b) => b.gameweek - a.gameweek);

  for (const m of pastMatchups) {
    const raw = m.team_a_id === teamId ? m.lineup_a : m.lineup_b;
    if (isLineupComplete(raw)) {
      return normalizeMatchupLineup(raw as MatchupLineup);
    }
  }

  return null;
}

/**
 * Retrieves the effective lineup for a team at a specific gameweek from the database.
 * Falls back to the latest valid past lineup or generates one if needed.
 */
export async function getEffectiveLineupForTeam(
  admin: SupabaseClient,
  {
    teamId,
    gameweek,
    currentLineup,
  }: {
    teamId: string;
    gameweek: number;
    currentLineup?: MatchupLineup | null;
  },
): Promise<MatchupLineup | null> {
  if (currentLineup && isLineupComplete(currentLineup)) {
    return normalizeMatchupLineup(currentLineup);
  }

  // Fetch past matchups for this team
  const { data: pastMatchups } = await admin
    .from('matchups')
    .select('gameweek, team_a_id, team_b_id, lineup_a, lineup_b')
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .lt('gameweek', gameweek)
    .order('gameweek', { ascending: false })
    .limit(10);

  let candidate: MatchupLineup | null = null;
  for (const m of pastMatchups ?? []) {
    const raw = (m.team_a_id === teamId ? m.lineup_a : m.lineup_b) as MatchupLineup | null;
    if (isLineupComplete(raw)) {
      candidate = normalizeMatchupLineup(raw);
      break;
    }
  }

  // Fetch current non-IR active roster entries to ensure players are still with the team
  const { data: rosterEntries } = await admin
    .from('roster_entries')
    .select('player_id, status')
    .eq('team_id', teamId)
    .not('status', 'in', '("ir","taxi","loan_out")');

  const eligibleIds = new Set((rosterEntries ?? []).map((r) => r.player_id));

  if (candidate) {
    const allStartersEligible = candidate.starters.every((s) => eligibleIds.has(s.player_id));
    const allBenchEligible = (candidate.bench ?? []).slice(0, 4).every((b) => eligibleIds.has(b.player_id));

    if (allStartersEligible && allBenchEligible) {
      return candidate;
    }
  }

  // If past candidate had players who left or moved to IR, try to generate a valid lineup
  const generated = await generateValidLineup(admin, teamId);
  if (generated.lineup) {
    return generated.lineup;
  }

  return candidate;
}

/**
 * Carries forward lineups from previous gameweeks to the specified gameweek for any
 * matchup that is missing lineup_a or lineup_b.
 */
export async function carryForwardLineupsForGameweek(
  admin: SupabaseClient,
  {
    gameweek,
    leagueId,
  }: {
    gameweek: number;
    leagueId?: string;
  },
): Promise<{ updatedCount: number; details: string[] }> {
  let query = admin
    .from('matchups')
    .select('id, league_id, gameweek, team_a_id, team_b_id, lineup_a, lineup_b')
    .eq('gameweek', gameweek);

  if (leagueId) {
    query = query.eq('league_id', leagueId);
  }

  const { data: matchups, error } = await query;
  if (error || !matchups) {
    return { updatedCount: 0, details: [`Failed to query matchups: ${error?.message}`] };
  }

  let updatedCount = 0;
  const details: string[] = [];

  for (const m of matchups) {
    const updates: { lineup_a?: MatchupLineup; lineup_b?: MatchupLineup } = {};

    if (!isLineupComplete(m.lineup_a)) {
      const effectiveA = await getEffectiveLineupForTeam(admin, {
        teamId: m.team_a_id,
        gameweek,
        currentLineup: m.lineup_a as MatchupLineup | null,
      });
      if (effectiveA) {
        updates.lineup_a = effectiveA;
        details.push(`GW${gameweek} match ${m.id}: set lineup_a for team ${m.team_a_id}`);
      }
    }

    if (m.team_b_id && !isLineupComplete(m.lineup_b)) {
      const effectiveB = await getEffectiveLineupForTeam(admin, {
        teamId: m.team_b_id,
        gameweek,
        currentLineup: m.lineup_b as MatchupLineup | null,
      });
      if (effectiveB) {
        updates.lineup_b = effectiveB;
        details.push(`GW${gameweek} match ${m.id}: set lineup_b for team ${m.team_b_id}`);
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin
        .from('matchups')
        .update(updates)
        .eq('id', m.id);

      if (!updateError) {
        updatedCount++;
      } else {
        details.push(`Error updating matchup ${m.id}: ${updateError.message}`);
      }
    }
  }

  return { updatedCount, details };
}
