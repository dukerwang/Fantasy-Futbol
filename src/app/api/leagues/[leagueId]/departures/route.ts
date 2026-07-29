/**
 * GET /api/leagues/[leagueId]/departures
 *
 * Everything the Retained List UI needs in one call:
 *   - decisions the caller still has to answer (pending, or a return window)
 *   - the rights they currently hold
 *   - their slot usage
 *   - every other team's live rights, because rights are tradeable and so must
 *     be discoverable across the league (real clubs publish retained lists)
 *
 * Read-only. All mutations go through /departures/[decisionId].
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listDecisions, getSlotUsage } from '@/lib/departures/decisions';
import { OPEN_STATUSES, RIGHTS_HELD_STATUSES } from '@/lib/departures/types';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  const decisions = await listDecisions(admin, leagueId, {
    statuses: [...new Set([...OPEN_STATUSES, ...RIGHTS_HELD_STATUSES])],
  });

  // Hydrate separately: `player_rankings` is a view and cannot be nested-joined
  // through PostgREST, and the departures UI wants the same player shape the
  // rest of the app uses.
  const playerIds = [...new Set(decisions.map((d) => d.player_id))];
  const teamIds = [...new Set(decisions.map((d) => d.team_id))];

  const [{ data: players }, { data: teams }] = await Promise.all([
    playerIds.length
      ? admin
          .from('players')
          .select('id, name, web_name, pl_team, primary_position, photo_url, market_value, is_active')
          .in('id', playerIds)
      : Promise.resolve({ data: [] as never[] }),
    teamIds.length
      ? admin.from('teams').select('id, team_name').in('id', teamIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const playerById = new Map((players ?? []).map((p) => [p.id as string, p]));
  const teamById = new Map((teams ?? []).map((t) => [t.id as string, t]));

  const hydrated = decisions.map((d) => ({
    ...d,
    player: playerById.get(d.player_id) ?? null,
    teamName: teamById.get(d.team_id)?.team_name ?? 'Unknown',
    isMine: d.team_id === myTeam.id,
  }));

  const slots = await getSlotUsage(admin, leagueId, myTeam.id);

  return NextResponse.json({
    teamId: myTeam.id,
    slots,
    // Awaiting my action: a retain-or-release choice, or a returning player.
    actionRequired: hydrated.filter(
      (d) => d.isMine && (d.status === 'pending' || d.status === 'return_pending'),
    ),
    myRights: hydrated.filter((d) => d.isMine && RIGHTS_HELD_STATUSES.includes(d.status)),
    leagueRights: hydrated.filter((d) => !d.isMine && RIGHTS_HELD_STATUSES.includes(d.status)),
  });
}
