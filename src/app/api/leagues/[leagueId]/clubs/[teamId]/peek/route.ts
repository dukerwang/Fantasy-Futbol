import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';
import { resolveCurrentGw } from '@/lib/season/currentGameweek';
import { FORMATION_SLOTS } from '@/types';
import type { BenchSlot, MatchupLineup, RosterStatus } from '@/types';
import type { PeekPlayer, SquadPeek } from '@/lib/teams/squadPeekTypes';

/**
 * A club at a glance — what the squad-peek drawer draws.
 *
 * Deliberately its own endpoint rather than a slice of `buildTransfersModel`:
 * that model is the whole transfer hub (every roster, every auction, every
 * proposal) and costs a dozen queries. A peek is one club, opened from a crest
 * anywhere in the app, and has to feel instant.
 *
 * ── On showing a rival's XI ────────────────────────────────────────────────
 * This returns the club's LAST SAVED lineup, which before a deadline is the
 * lineup they intend to play. That is a real strategy leak and a deliberate
 * product choice, not an oversight. If it should instead only ever show a
 * lineup that has already locked, flip LINEUP_VISIBILITY below to 'locked' —
 * the query and the shape stay the same.
 */
const LINEUP_VISIBILITY: 'last_saved' | 'locked' = 'last_saved';

interface Props {
  params: Promise<{ leagueId: string; teamId: string }>;
}

/**
 * Everyone outside the XI, grouped and labelled as the club page labels them.
 * 'active' is deliberately absent: an active player is either in the saved
 * lineup or falls through to "Not in the XI" below, which is the interesting
 * case (usually somebody signed after the lineup was last touched).
 */
const GROUP_LABELS: { key: RosterStatus; label: string }[] = [
  { key: 'bench', label: 'Reserves' },
  { key: 'taxi', label: 'Academy' },
  { key: 'ir', label: 'Injured Reserve' },
  { key: 'loan_in', label: 'On loan in' },
  { key: 'loan_out', label: 'Out on loan' },
];

export async function GET(_req: NextRequest, { params }: Props) {
  const { leagueId, teamId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Rosters are league-visible, not world-visible: the caller must be in this
  // league (or be its commissioner) before any of it is returned.
  const [{ data: league }, { data: membership }] = await Promise.all([
    admin.from('leagues').select('id, commissioner_id').eq('id', leagueId).single(),
    admin.from('teams').select('id').eq('league_id', leagueId).eq('user_id', user.id).maybeSingle(),
  ]);
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });
  if (!membership && league.commissioner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: team } = await admin
    .from('teams')
    .select('id, user_id, team_name, faab_budget, crest_config')
    .eq('id', teamId)
    .eq('league_id', leagueId)
    .maybeSingle();
  if (!team) return NextResponse.json({ error: 'Club not found' }, { status: 404 });

  const [{ data: rosterRaw }, { data: standings }, { data: matchupRows }] = await Promise.all([
    admin
      .from('roster_entries')
      .select(`player_id, status, player:players(${FULL_PLAYER_SELECT})`)
      .eq('team_id', teamId),
    admin
      .from('league_standings')
      .select('team_id, username, rank, wins, draws, losses, points_for')
      .eq('league_id', leagueId),
    // ONLY rows where this club actually has a lineup stored, ascending.
    //
    // The obvious version of this query — every matchup for the club, newest
    // first, take the first with a lineup — is wrong here and silently so. A
    // league's full 38-gameweek schedule is generated up front, so "newest"
    // means GW38: an unplayed fixture with a null lineup, as are the twenty
    // after it. The one real lineup sat at GW1 and was never reached, and the
    // drawer told managers with a saved side that they hadn't set one.
    admin
      .from('matchups')
      .select('team_a_id, team_b_id, lineup_a, lineup_b, gameweek, status')
      .eq('league_id', leagueId)
      .or(
        `and(team_a_id.eq.${teamId},lineup_a.not.is.null),` +
          `and(team_b_id.eq.${teamId},lineup_b.not.is.null)`,
      )
      .order('gameweek', { ascending: true }),
  ]);

  const byId = new Map<string, PeekPlayer>();
  const counts = { squad: 0, academy: 0, ir: 0 };
  for (const e of (rosterRaw ?? []) as any[]) {
    const p = e.player;
    if (!p) continue;
    if (e.status === 'taxi') counts.academy += 1;
    else if (e.status === 'ir') counts.ir += 1;
    else counts.squad += 1;
    byId.set(p.id, {
      id: p.id,
      name: p.name,
      webName: p.web_name ?? null,
      pos: p.primary_position,
      plTeam: p.pl_team ?? null,
      status: e.status,
      ppg: Number(p.ppg ?? 0),
      points: Number(p.total_points ?? 0),
      value: Number(p.market_value ?? 0),
      fplStatus: p.fpl_status ?? null,
      photoUrl: p.photo_url ?? null,
    });
  }

  const standingRows = standings ?? [];
  const mine = standingRows.find((s: any) => s.team_id === teamId) as any;

  // ── The lineup to show ─────────────────────────────────────────────────────
  // Of the saved lineups, the one for the gameweek being played — falling back
  // to the most recent before it, and finally to the earliest saved one at all
  // (which is the preseason case: nothing has kicked off, so `resolveCurrentGw`
  // is 0 and the only lineup on file is GW1's).
  const saved = ((matchupRows ?? []) as any[]).filter((m) =>
    LINEUP_VISIBILITY === 'last_saved' ? true : m.status !== 'scheduled',
  );
  const currentGw = await resolveCurrentGw();
  const upTo = saved.filter((m) => m.gameweek <= Math.max(currentGw, 1));
  const chosen = upTo.length > 0 ? upTo[upTo.length - 1] : saved[0];

  let lineup: SquadPeek['lineup'] = null;
  if (chosen) {
    const raw = (chosen.team_a_id === teamId ? chosen.lineup_a : chosen.lineup_b) as MatchupLineup | null;
    const normalized = normalizeMatchupLineup(raw);
    if (normalized && Array.isArray(normalized.starters) && normalized.starters.length > 0) {
      const slots = FORMATION_SLOTS[normalized.formation] ?? [];
      lineup = {
        formation: normalized.formation,
        gameweek: chosen.gameweek,
        played: chosen.status !== 'scheduled',
        // Walk the FORMATION template rather than the stored array so a lineup
        // saved short (or with a player since dropped) renders as an empty shirt
        // in the right place instead of collapsing the shape.
        starters: slots.map((slot, i) => {
          const s = normalized.starters[i];
          return { slot, player: s ? byId.get(s.player_id) ?? null : null };
        }),
        bench: (['DEF', 'MID', 'ATT', 'FLEX'] as BenchSlot[]).map((slot) => {
          const b = (normalized.bench ?? []).find((x: any) => x.slot === slot);
          return { slot, player: b?.player_id ? byId.get(b.player_id) ?? null : null };
        }),
      };
    }
  }

  const namedIds = new Set<string>();
  for (const s of lineup?.starters ?? []) if (s.player) namedIds.add(s.player.id);
  for (const b of lineup?.bench ?? []) if (b.player) namedIds.add(b.player.id);

  const groups = GROUP_LABELS.map(({ key, label }) => ({
    key: String(key),
    label,
    players: [...byId.values()]
      .filter((p) => p.status === key && !namedIds.has(p.id))
      .sort((a, b) => b.points - a.points),
  })).filter((g) => g.players.length > 0);

  // Anyone left over: on the roster as 'active' but not in the saved lineup —
  // usually a player signed after the lineup was last touched.
  const unplaced = [...byId.values()]
    .filter((p) => !namedIds.has(p.id) && !GROUP_LABELS.some((g) => g.key === p.status))
    .sort((a, b) => b.points - a.points);
  if (unplaced.length > 0) {
    // With a lineup on file these are the leftovers; without one they ARE the
    // side, as far as `roster_entries.status` knows it.
    groups.unshift({ key: 'unplaced', label: lineup ? 'Not in the XI' : 'First XI', players: unplaced });
  }

  const payload: SquadPeek = {
    team: {
      id: team.id,
      name: team.team_name,
      manager: mine?.username ?? 'Manager',
      crestConfig: (team as any).crest_config ?? null,
      balance: Number(team.faab_budget ?? 0),
      isMine: (team as any).user_id === user.id,
    },
    standing: {
      rank: mine?.rank ?? null,
      ofTeams: standingRows.length,
      w: mine?.wins ?? 0,
      d: mine?.draws ?? 0,
      l: mine?.losses ?? 0,
      pointsFor: Number(mine?.points_for ?? 0),
    },
    lineup,
    groups,
    counts,
  };

  return NextResponse.json(payload);
}
