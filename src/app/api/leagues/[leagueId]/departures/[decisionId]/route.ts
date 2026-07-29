/**
 * POST /api/leagues/[leagueId]/departures/[decisionId]
 *
 * The four manager verbs on a departure:
 *   release     — take the compensation, let the player go
 *   retain      — forfeit the compensation, keep his rights
 *   relinquish  — abandon held rights for nothing, freeing the slot
 *   reinstate   — claim a returned player back onto the roster
 *   decline     — give up a returned player; he goes to auction
 *
 * Ownership is checked against `team_id` (the current rights holder) so a
 * traded right is actionable by whoever holds it now.
 *
 * Note these are NOT blocked by `roster_locked`. The whole point of the feature
 * is that the offseason — when rosters are locked and the rest of the app is
 * inert — is exactly when these decisions get made.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  DepartureError,
  lapseReturn,
  reinstateReturned,
  relinquishRights,
  releaseDeparture,
  retainDeparture,
} from '@/lib/departures/decisions';

interface Props {
  params: Promise<{ leagueId: string; decisionId: string }>;
}

type Action = 'release' | 'retain' | 'relinquish' | 'reinstate' | 'decline';

const ACTIONS: Action[] = ['release', 'retain', 'relinquish', 'reinstate', 'decline'];

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId, decisionId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action as Action | undefined;

  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  const { data: decision } = await admin
    .from('departure_decisions')
    .select('id, league_id, team_id, status')
    .eq('id', decisionId)
    .single();

  if (!decision || decision.league_id !== leagueId) {
    return NextResponse.json({ error: 'Departure not found' }, { status: 404 });
  }

  if (decision.team_id !== myTeam.id) {
    return NextResponse.json({ error: 'That decision is not yours to make' }, { status: 403 });
  }

  // Reject the wrong verb for the state up front, so the RPC's silent no-op on
  // an already-resolved decision can't read to the manager as a success.
  const expected: Record<Action, string[]> = {
    release: ['pending'],
    retain: ['pending'],
    relinquish: ['retained'],
    reinstate: ['return_pending'],
    decline: ['return_pending'],
  };

  if (!expected[action].includes(decision.status)) {
    return NextResponse.json(
      { error: `Cannot ${action} a departure that is "${decision.status}".` },
      { status: 409 },
    );
  }

  try {
    switch (action) {
      case 'release': {
        const result = await releaseDeparture(admin, decisionId);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'retain': {
        const result = await retainDeparture(admin, decisionId);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'relinquish': {
        await relinquishRights(admin, decisionId);
        return NextResponse.json({ ok: true });
      }
      case 'reinstate': {
        const result = await reinstateReturned(admin, decisionId);
        return NextResponse.json({ ok: true, ...result });
      }
      case 'decline': {
        await lapseReturn(admin, decisionId, 'declined');
        return NextResponse.json({ ok: true });
      }
    }
  } catch (err) {
    if (err instanceof DepartureError) {
      const status = err.code === 'RETAINED_SLOTS_FULL' || err.code === 'ROSTER_FULL' ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
