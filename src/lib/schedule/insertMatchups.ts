import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSchedule } from './generator';

interface InsertMatchupsResult {
  ok: true;
  matchups?: number;
  gameweeks?: number;
  skipped?: boolean;
}

/**
 * Generates and inserts a full head-to-head schedule for a league.
 * Idempotent: if matchups already exist for the league, returns { skipped: true }.
 */
export async function insertMatchups(
  admin: SupabaseClient,
  leagueId: string,
): Promise<InsertMatchupsResult> {
  // --- Idempotency check ---
  const { count } = await admin
    .from('matchups')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId);

  if ((count ?? 0) > 0) {
    return { ok: true, skipped: true };
  }

  // --- Fetch team IDs ---
  const { data: teams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);

  const teamIds = (teams ?? []).map((t: { id: string }) => t.id);
  if (teamIds.length < 2) return { ok: true, skipped: true };

  // --- Determine start GW ---
  const startGw = await getStartGw();
  if (startGw > 38) return { ok: true, skipped: true };

  // --- Build schedule ---
  const schedule = buildSchedule(teamIds, startGw);
  if (schedule.length === 0) return { ok: true, skipped: true };

  // --- Flatten and batch-insert ---
  const rows = schedule.flatMap(({ gw, pairs }) =>
    pairs.map(([a, b]) => ({
      league_id: leagueId,
      gameweek: gw,
      team_a_id: a,
      team_b_id: b,
    })),
  );

  const { error } = await admin.from('matchups').insert(rows);
  if (error) throw new Error(`insertMatchups: ${error.message}`);

  return { ok: true, matchups: rows.length, gameweeks: schedule.length };
}

/**
 * Fetches FPL bootstrap to determine which GW the schedule should start from.
 *
 * Rules:
 *  - current GW finished → startGw = currentGw + 1
 *  - current GW in progress AND any fixture has already kicked off → startGw = currentGw + 1
 *  - current GW in progress AND zero fixtures started → startGw = currentGw
 *  - pre-season (no current event) → startGw = 1
 *  - fallback on error → startGw = 1
 */
async function getStartGw(): Promise<number> {
  try {
    const res = await fetch(
      'https://fantasy.premierleague.com/api/bootstrap-static/',
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return 1;

    const data = await res.json();
    const events: Array<{ id: number; is_current: boolean; finished: boolean }> =
      data.events ?? [];

    const current = events.find((e) => e.is_current);
    if (!current) return 1; // pre-season

    // GW fully finished → start next
    if (current.finished) return Math.min(current.id + 1, 39);

    // GW in progress — check if any fixtures have already kicked off
    const fixturesRes = await fetch(
      `https://fantasy.premierleague.com/api/fixtures/?event=${current.id}`,
      { next: { revalidate: 300 } },
    );
    if (fixturesRes.ok) {
      const fixtures: Array<{ started: boolean; kickoff_time: string | null }> =
        await fixturesRes.json();
      const anyStarted = fixtures.some(
        (f) => f.started || (f.kickoff_time != null && new Date(f.kickoff_time) <= new Date()),
      );
      if (anyStarted) return Math.min(current.id + 1, 39);
    }

    return current.id; // GW in progress, no fixtures started yet — include it
  } catch {
    return 1;
  }
}
