/**
 * Gaffa — Relegation / Departure Resolution at Kickoff
 *
 * Kickoff is the deadline for the summer's retain-or-release decisions. By the
 * time it runs, every departed player on a roster has a decision row (opened by
 * `recordDepartures` as soon as the sync marked him inactive) and the manager
 * has had the whole offseason to answer it.
 *
 * This module resolves whatever is still outstanding:
 *   - `pending`  → released, compensation paid at the snapshotted offer
 *   - `retained` → left alone; the manager already chose, and the player stays
 *                  theirs as rights rather than as a squad member
 *
 * Release is the default for anyone who never answered. It pays them something
 * rather than silently consuming a scarce retained slot they never asked to
 * spend, and it returns the player to circulation.
 *
 * Idempotent throughout: `recordDepartures` skips players who already have an
 * open decision, and the release RPC no-ops on any decision that is not still
 * pending, so a second Kickoff run finds nothing left to do.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordDepartures } from '@/lib/departures/detect';
import { listDecisions, releaseDeparture } from '@/lib/departures/decisions';
import { getPlayerDisplayName } from '@/lib/players/displayName';

interface RelegationResult {
  playerId: string;
  playerName: string;
  club: string;
  compensationFaab: number;
  affectedRosters: {
    teamId: string;
    teamName: string;
    leagueId: string;
    newFaab: number;
  }[];
}

interface RelegationPreview {
  playerId: string;
  playerName: string;
  club: string;
  marketValue: number;
  compensationFaab: number;
  ownedBy: { teamName: string; leagueId: string }[];
}

interface DecisionWithPlayer {
  id: string;
  team_id: string;
  player_id: string;
  status: string;
  market_value_at_departure: number | null;
  compensation_offered: number | null;
}

/**
 * What Kickoff will actually do, for the admin confirmation screen.
 *
 * Reads decisions rather than scanning `players` for inactive rows: only
 * players still awaiting a choice get paid out, so a player whose manager
 * already chose to retain him must not appear here as an imminent cost.
 */
export async function previewRelegationCompensation(
  admin: SupabaseClient,
  leagueId: string,
): Promise<RelegationPreview[]> {
  const pending = (await listDecisions(admin, leagueId, {
    statuses: ['pending'],
  })) as unknown as DecisionWithPlayer[];

  if (pending.length === 0) return [];

  const playerIds = [...new Set(pending.map((d) => d.player_id))];
  const teamIds = [...new Set(pending.map((d) => d.team_id))];

  const [{ data: players }, { data: teams }] = await Promise.all([
    admin.from('players').select('id, name, web_name, pl_team').in('id', playerIds),
    admin.from('teams').select('id, team_name').in('id', teamIds),
  ]);

  const playerById = new Map((players ?? []).map((p) => [p.id as string, p]));
  const teamById = new Map((teams ?? []).map((t) => [t.id as string, t]));

  return pending.map((d) => {
    const player = playerById.get(d.player_id);
    const team = teamById.get(d.team_id);
    return {
      playerId: d.player_id,
      playerName: getPlayerDisplayName(player, 'full'),
      club: player?.pl_team ?? 'Unknown',
      marketValue: Number(d.market_value_at_departure ?? 0),
      compensationFaab: Number(d.compensation_offered ?? 0),
      ownedBy: [{ teamName: team?.team_name ?? 'Unknown', leagueId }],
    };
  });
}

/**
 * Resolves every outstanding departure decision in this league.
 *
 * Opens decisions for anything the sync has marked departed but not yet
 * recorded (a player sold abroad the night before Kickoff), then releases
 * everything still pending.
 */
export async function processRelegationCompensation(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
  seasonTo: string,
): Promise<RelegationResult[]> {
  // Catch late departures. No deadline — Kickoff is the deadline, and it is
  // happening right now.
  await recordDepartures(admin, leagueId, { seasonFrom, decideBy: null, notify: false });

  const pending = (await listDecisions(admin, leagueId, {
    statuses: ['pending'],
  })) as unknown as DecisionWithPlayer[];

  if (pending.length === 0) return [];

  const playerIds = [...new Set(pending.map((d) => d.player_id))];
  const teamIds = [...new Set(pending.map((d) => d.team_id))];

  const [{ data: players }, { data: teams }] = await Promise.all([
    admin.from('players').select('id, name, web_name, pl_team').in('id', playerIds),
    admin.from('teams').select('id, team_name').in('id', teamIds),
  ]);

  const playerById = new Map((players ?? []).map((p) => [p.id as string, p]));
  const teamById = new Map((teams ?? []).map((t) => [t.id as string, t]));

  const results: RelegationResult[] = [];
  const transitionRows: Record<string, unknown>[] = [];

  for (const decision of pending) {
    const player = playerById.get(decision.player_id);
    const team = teamById.get(decision.team_id);
    const name = getPlayerDisplayName(player, 'full');
    const club = player?.pl_team ?? 'Unknown';

    let paid: { compensation: number; newFaab: number } | null = null;
    try {
      paid = await releaseDeparture(admin, decision.id);
    } catch (err) {
      console.error(`[relegation] Failed to release ${name}:`, err);
      continue;
    }

    // Null means the decision was already resolved by a concurrent run.
    if (!paid) continue;

    // Audit marker. Deliberately not used as a processing guard — it is a
    // global column on `players`, so using it to decide what to skip meant the
    // first league processed consumed the flag for every other league.
    await admin
      .from('players')
      .update({ pl_status: 'relegated', pl_season: seasonFrom, updated_at: new Date().toISOString() })
      .eq('id', decision.player_id);

    transitionRows.push({
      league_id: leagueId,
      season_from: seasonFrom,
      season_to: seasonTo,
      event_type: 'relegated',
      player_id: decision.player_id,
      team_id: decision.team_id,
      team_name: team?.team_name ?? 'Unknown',
      notes: `${name} (${club}) left the Premier League. €${paid.compensation}m compensation paid.`,
    });

    results.push({
      playerId: decision.player_id,
      playerName: name,
      club,
      compensationFaab: paid.compensation,
      affectedRosters: [
        {
          teamId: decision.team_id,
          teamName: team?.team_name ?? 'Unknown',
          leagueId,
          newFaab: paid.newFaab,
        },
      ],
    });
  }

  if (transitionRows.length > 0) {
    const { error: transErr } = await admin.from('season_transitions').insert(transitionRows);
    if (transErr) {
      console.error('[relegation] Failed to write season_transitions:', transErr);
    }
  }

  return results;
}
