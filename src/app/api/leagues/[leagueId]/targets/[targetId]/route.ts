import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { POSITION_FLEX_MAP } from '@/types';
import { MAX_PUBLIC_TARGETS, TARGET_NOTE_MAX, TARGET_TTL_MS } from '@/lib/transfers/targetLimits';
import { isTargetRole } from '@/lib/transfers/targetRole';

/**
 * One target: edit it or withdraw it.
 *
 * Neither verb notifies anybody. Creation is the only event that reaches a
 * player's owner — otherwise a manager could raise a budget by €1m eight
 * times and land in somebody's notifications eight times.
 */

interface Props {
  params: Promise<{ leagueId: string; targetId: string }>;
}

const VALID_POSITIONS = new Set(Object.keys(POSITION_FLEX_MAP));

async function loadOwnTarget(leagueId: string, targetId: string, userId: string) {
  const admin = createAdminClient();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!myTeam) return { admin, myTeam: null, target: null };

  const { data: target } = await admin
    .from('player_targets')
    .select('*')
    .eq('id', targetId)
    .eq('league_id', leagueId)
    .maybeSingle();

  return { admin, myTeam, target };
}

export async function PATCH(req: NextRequest, { params }: Props) {
  const { leagueId, targetId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { admin, myTeam, target } = await loadOwnTarget(leagueId, targetId, user.id);
  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });
  if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
  if (target.team_id !== myTeam.id) {
    return NextResponse.json({ error: 'Not your target' }, { status: 403 });
  }
  if (target.status !== 'active') {
    return NextResponse.json({ error: 'That target is closed' }, { status: 409 });
  }

  const body = await req.json();
  const { position, role, visibility, openToSale, openToTrade, openToLoan, budget, note } = body as {
    position?: string | null;
    role?: string | null;
    visibility?: string;
    openToSale?: boolean;
    openToTrade?: boolean;
    openToLoan?: boolean;
    budget?: number | null;
    note?: string | null;
  };

  const patch: Record<string, unknown> = {
    expires_at: new Date(Date.now() + TARGET_TTL_MS).toISOString(),
  };

  // The kind never changes. A named target and a profile are different
  // statements, and switching one into the other would silently reuse a row
  // the rest of the league may already have read as something else.
  if (position !== undefined) {
    if (target.target_kind !== 'profile') {
      return NextResponse.json({ error: 'A named target has no position to change' }, { status: 400 });
    }
    if (!VALID_POSITIONS.has(String(position))) {
      return NextResponse.json({ error: 'Pick one of the 12 tactical positions' }, { status: 400 });
    }
    patch.position = position;
  }

  if (role !== undefined) {
    if (target.target_kind !== 'profile') {
      return NextResponse.json({ error: 'A named target has no squad role' }, { status: 400 });
    }
    if (!isTargetRole(role)) {
      return NextResponse.json({ error: 'Pick a squad role' }, { status: 400 });
    }
    patch.role = role;
  }

  if (visibility !== undefined) {
    const goingPublic = visibility !== 'private';

    // Going public consumes a public slot, so it is capped like a fresh one.
    if (goingPublic && target.visibility === 'private') {
      const { data: live } = await admin
        .from('player_targets')
        .select('id')
        .eq('league_id', leagueId)
        .eq('team_id', myTeam.id)
        .eq('status', 'active')
        .eq('visibility', 'public')
        .gt('expires_at', new Date().toISOString());

      if ((live ?? []).length >= MAX_PUBLIC_TARGETS) {
        return NextResponse.json(
          { error: `You can show ${MAX_PUBLIC_TARGETS} targets to the league at once.` },
          { status: 409 },
        );
      }
    }

    patch.visibility = goingPublic ? 'public' : 'private';
  }

  if (openToSale !== undefined) patch.open_to_sale = !!openToSale;
  if (openToTrade !== undefined) patch.open_to_trade = !!openToTrade;
  if (openToLoan !== undefined) patch.open_to_loan = !!openToLoan;

  if (budget !== undefined) {
    if (budget != null && (!Number.isInteger(budget) || budget < 0)) {
      return NextResponse.json({ error: 'budget must be a non-negative whole number' }, { status: 400 });
    }
    patch.budget = budget ?? null;
  }

  if (note !== undefined) {
    const trimmed = typeof note === 'string' ? note.trim() : null;
    if (trimmed && trimmed.length > TARGET_NOTE_MAX) {
      return NextResponse.json({ error: `Keep the note to ${TARGET_NOTE_MAX} characters` }, { status: 400 });
    }
    patch.note = trimmed || null;
  }

  const { data: updated, error } = await admin
    .from('player_targets')
    .update(patch)
    .eq('id', targetId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, target: updated });
}

/**
 * Withdraw. Sets `withdrawn` rather than deleting, so a target that produced
 * a deal stays legible afterwards — the same reasoning that keeps resolved
 * auctions in `auction_state` instead of dropping them.
 */
export async function DELETE(req: NextRequest, { params }: Props) {
  const { leagueId, targetId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { admin, myTeam, target } = await loadOwnTarget(leagueId, targetId, user.id);
  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });
  if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
  if (target.team_id !== myTeam.id) {
    return NextResponse.json({ error: 'Not your target' }, { status: 403 });
  }

  // Already closed: nothing to do, and saying so beats a 409 the UI would
  // have to special-case on a double-tap.
  if (target.status !== 'active') return NextResponse.json({ ok: true, target });

  const { data: updated, error } = await admin
    .from('player_targets')
    .update({ status: 'withdrawn' })
    .eq('id', targetId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, target: updated });
}
