import { createAdminClient } from '@/lib/supabase/admin';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';
import { resolveCurrentGw } from '@/lib/season/currentGameweek';
import { FORMATION_SLOTS } from '@/types';
import type { BenchSlot, MatchupLineup } from '@/types';
import type { FutbolpediaClubContextResponse } from './futbolpediaContextTypes';

const LINEUP_VISIBILITY: 'last_saved' | 'locked' = 'last_saved';

/**
 * Build the Futbolpedia club context bag. Identity/status only — no fantasy
 * points or private match ratings (scoring-data firewall for the chat bag).
 */
export async function buildFutbolpediaClubContext(
  leagueId: string,
  teamId: string,
): Promise<FutbolpediaClubContextResponse | null> {
  const admin = createAdminClient();

  const [{ data: league }, { data: team }] = await Promise.all([
    admin.from('leagues').select('id, name').eq('id', leagueId).maybeSingle(),
    admin
      .from('teams')
      .select('id, team_name, faab_budget, league_id')
      .eq('id', teamId)
      .eq('league_id', leagueId)
      .maybeSingle(),
  ]);

  if (!league || !team) return null;

  const currentGw = await resolveCurrentGw();

  const [{ data: rosterRaw }, { data: standings }, { data: matchupRows }, { data: currentMatchup }] =
    await Promise.all([
      admin
        .from('roster_entries')
        .select(`player_id, status, player:players(${FULL_PLAYER_SELECT})`)
        .eq('team_id', teamId),
      admin
        .from('league_standings')
        .select('team_id, rank, wins, draws, losses, points_for, points_against')
        .eq('league_id', leagueId),
      admin
        .from('matchups')
        .select('team_a_id, team_b_id, lineup_a, lineup_b, gameweek, status')
        .eq('league_id', leagueId)
        .or(
          `and(team_a_id.eq.${teamId},lineup_a.not.is.null),` +
            `and(team_b_id.eq.${teamId},lineup_b.not.is.null)`,
        )
        .order('gameweek', { ascending: true }),
      admin
        .from('matchups')
        .select('team_a_id, team_b_id, score_a, score_b, gameweek, status')
        .eq('league_id', leagueId)
        .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
        .eq('gameweek', Math.max(currentGw, 1))
        .order('gameweek', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  const roster: FutbolpediaClubContextResponse['roster'] = [];
  const byId = new Map<string, { id: string; name: string; pos: string }>();

  for (const e of (rosterRaw ?? []) as any[]) {
    const p = e.player;
    if (!p) continue;
    const display = (p.web_name as string | null)?.trim() || (p.name as string);
    roster.push({
      player_id: p.id,
      name: p.name,
      display_name: display,
      primary_position: p.primary_position,
      secondary_positions: Array.isArray(p.secondary_positions) ? p.secondary_positions : [],
      status: e.status,
      pl_team: p.pl_team ?? null,
    });
    byId.set(p.id, { id: p.id, name: display, pos: p.primary_position });
  }

  const standingRows = standings ?? [];
  const mine = standingRows.find((s: { team_id: string }) => s.team_id === teamId) as
    | {
        rank: number | null;
        wins: number;
        draws: number;
        losses: number;
        points_for: number;
        points_against?: number;
      }
    | undefined;

  // Current GW matchup + opponent name
  let matchup: FutbolpediaClubContextResponse['matchup'] = null;
  if (currentMatchup) {
    const isA = currentMatchup.team_a_id === teamId;
    const oppId = isA ? currentMatchup.team_b_id : currentMatchup.team_a_id;
    let oppName: string | null = null;
    if (oppId) {
      const { data: opp } = await admin
        .from('teams')
        .select('team_name')
        .eq('id', oppId)
        .maybeSingle();
      oppName = opp?.team_name ?? null;
    }
    matchup = {
      gameweek: currentMatchup.gameweek,
      opponent_club_name: oppName,
      status: currentMatchup.status,
      your_score: isA ? Number(currentMatchup.score_a) : Number(currentMatchup.score_b),
      opponent_score: isA ? Number(currentMatchup.score_b) : Number(currentMatchup.score_a),
    };
  }

  // Lineup (same selection logic as squad peek)
  const saved = ((matchupRows ?? []) as Array<{
    team_a_id: string;
    team_b_id: string;
    lineup_a: MatchupLineup | null;
    lineup_b: MatchupLineup | null;
    gameweek: number;
    status: string;
  }>).filter((m) => (LINEUP_VISIBILITY === 'last_saved' ? true : m.status !== 'scheduled'));
  const upTo = saved.filter((m) => m.gameweek <= Math.max(currentGw, 1));
  const chosen = upTo.length > 0 ? upTo[upTo.length - 1] : saved[0];

  let lineup: FutbolpediaClubContextResponse['lineup'] = null;
  if (chosen) {
    const raw = (chosen.team_a_id === teamId ? chosen.lineup_a : chosen.lineup_b) as MatchupLineup | null;
    const normalized = normalizeMatchupLineup(raw);
    if (normalized && Array.isArray(normalized.starters) && normalized.starters.length > 0) {
      const slots = FORMATION_SLOTS[normalized.formation] ?? [];
      lineup = {
        formation: normalized.formation,
        gameweek: chosen.gameweek,
        starters: slots
          .map((slot, i) => {
            const s = normalized.starters[i];
            const player = s?.player_id ? byId.get(s.player_id) : null;
            if (!player) return null;
            return { player_id: player.id, name: player.name, slot };
          })
          .filter((x): x is NonNullable<typeof x> => x != null),
        bench: (['DEF', 'MID', 'ATT', 'FLEX'] as BenchSlot[])
          .map((slot) => {
            const b = (normalized.bench ?? []).find((x) => x.slot === slot);
            const player = b?.player_id ? byId.get(b.player_id) : null;
            if (!player) return null;
            return { player_id: player.id, name: player.name, slot };
          })
          .filter((x): x is NonNullable<typeof x> => x != null),
      };
    }
  }

  return {
    league_id: league.id,
    club_id: team.id,
    league_name: league.name,
    club_name: team.team_name,
    budget_eur_m: Number(team.faab_budget ?? 0),
    roster,
    standings: {
      rank: mine?.rank ?? null,
      of_teams: standingRows.length,
      wins: mine?.wins ?? 0,
      draws: mine?.draws ?? 0,
      losses: mine?.losses ?? 0,
      points_for: Number(mine?.points_for ?? 0),
      points_against: mine?.points_against != null ? Number(mine.points_against) : undefined,
    },
    matchup,
    lineup,
    synced_at: new Date().toISOString(),
  };
}
