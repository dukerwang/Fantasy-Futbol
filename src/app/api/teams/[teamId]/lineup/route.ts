import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORMATION_SLOTS, POSITION_FLEX_MAP, BENCH_FLEX_MAP, getExpectedBenchSlots } from '@/types';
import type { Formation, GranularPosition, MatchupLineup, BenchSlot } from '@/types';

type LineupPlacement = { kind: 'starter'; slot: GranularPosition } | { kind: 'bench'; slot: BenchSlot };

function placementMapFromLineup(lineup: MatchupLineup | null | undefined): Map<string, LineupPlacement> {
  const m = new Map<string, LineupPlacement>();
  if (!lineup) return m;
  for (const s of lineup.starters ?? []) {
    m.set(s.player_id, { kind: 'starter', slot: s.slot });
  }
  for (const b of lineup.bench ?? []) {
    if (b.player_id && b.slot) m.set(b.player_id, { kind: 'bench', slot: b.slot as BenchSlot });
  }
  return m;
}

function placementMapFromPayload(
  starters: { player_id: string; slot: GranularPosition }[],
  bench: { player_id: string; slot: BenchSlot }[],
): Map<string, LineupPlacement> {
  const m = new Map<string, LineupPlacement>();
  for (const s of starters) m.set(s.player_id, { kind: 'starter', slot: s.slot });
  for (const b of bench) m.set(b.player_id, { kind: 'bench', slot: b.slot });
  return m;
}

function placementKey(p: LineupPlacement | undefined): string {
  if (!p) return 'out';
  return p.kind === 'starter' ? `starter:${p.slot}` : `bench:${p.slot}`;
}

interface Props {
  params: Promise<{ teamId: string }>;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { teamId } = await params;

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Verify user owns this team
  const { data: team } = await admin
    .from('teams')
    .select('id, user_id')
    .eq('id', teamId)
    .single();

  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  if (team.user_id !== user.id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Parse body
  const body = await req.json();
  const { formation, starters, bench } = body as {
    formation: Formation;
    starters: { player_id: string; slot: GranularPosition }[];
    bench: { player_id: string; slot: BenchSlot }[];
  };

  // Validate formation
  const validFormations = Object.keys(FORMATION_SLOTS) as Formation[];
  if (!formation || !validFormations.includes(formation)) {
    return NextResponse.json({ error: 'Invalid formation' }, { status: 400 });
  }

  // Validate starters length
  if (!Array.isArray(starters) || starters.length !== 11) {
    return NextResponse.json({ error: 'Must have exactly 11 starters' }, { status: 400 });
  }

  // Fetch league to get bench_size
  const { data: teamWithLeague } = await admin
    .from('teams')
    .select('league_id, league:leagues(bench_size)')
    .eq('id', teamId)
    .single();

  if (!teamWithLeague || !teamWithLeague.league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  if (!Array.isArray(bench) || bench.length !== 4) {
    return NextResponse.json({ error: 'Must have exactly 4 bench players (DEF, MID, ATT, FLEX)' }, { status: 400 });
  }

  // Validate slots match formation (same multiset)
  const expectedSlots = [...FORMATION_SLOTS[formation]].sort();
  const givenSlots = starters.map((s) => s.slot).sort();
  if (JSON.stringify(expectedSlots) !== JSON.stringify(givenSlots)) {
    return NextResponse.json({ error: 'Starter slots do not match formation' }, { status: 400 });
  }

  // Validate bench slots match expected bench configuration
  const expectedBenchSlots = getExpectedBenchSlots().sort();
  const givenBenchSlots = bench.map((b) => b.slot).sort();
  if (JSON.stringify(expectedBenchSlots) !== JSON.stringify(givenBenchSlots)) {
    return NextResponse.json({ error: 'Bench slots do not match league rules' }, { status: 400 });
  }

  // No duplicate player IDs across starters and bench
  const starterIds = starters.map((s) => s.player_id);
  const benchIds = bench.map((b) => b.player_id);
  const allPlayerIds = [...starterIds, ...benchIds];
  if (new Set(allPlayerIds).size !== allPlayerIds.length) {
    return NextResponse.json({ error: 'Duplicate players in lineup' }, { status: 400 });
  }

  // Fetch all active/bench roster entries (exclude IR and taxi — neither can be in a lineup)
  const { data: entries } = await admin
    .from('roster_entries')
    .select('id, player_id, status, player:players(id, primary_position, secondary_positions, pl_team_id, web_name, full_name)')
    .eq('team_id', teamId)
    .not('status', 'in', '("ir","taxi")');

  if (!entries) {
    return NextResponse.json({ error: 'Failed to fetch roster' }, { status: 500 });
  }

  const rosterPlayerIds = new Set(entries.map((e: any) => e.player_id as string));
  const playerMap = new Map<string, any>(entries.map((e: any) => [e.player_id as string, e.player]));

  // Validate all starter player IDs are on roster and not IR, and check position eligibility
  for (const starter of starters) {
    if (!rosterPlayerIds.has(starter.player_id)) {
      return NextResponse.json(
        { error: `Player ${starter.player_id} not on roster` },
        { status: 400 }
      );
    }
    const player = playerMap.get(starter.player_id);
    if (!player) {
      return NextResponse.json(
        { error: `Player ${starter.player_id} not found` },
        { status: 400 }
      );
    }
    const allowed = POSITION_FLEX_MAP[starter.slot];
    const positions: GranularPosition[] = [
      player.primary_position,
      ...(player.secondary_positions ?? []),
    ];
    const eligible = positions.some((p) => allowed.includes(p));
    if (!eligible) {
      return NextResponse.json(
        { error: `Player cannot play in ${starter.slot} slot` },
        { status: 400 }
      );
    }
  }

  // Validate bench players
  for (const b of bench) {
    if (!rosterPlayerIds.has(b.player_id)) {
      return NextResponse.json(
        { error: `Player ${b.player_id} not on roster` },
        { status: 400 }
      );
    }
    const player = playerMap.get(b.player_id);
    if (!player) {
      return NextResponse.json(
        { error: `Player ${b.player_id} not found` },
        { status: 400 }
      );
    }
    const allowed = BENCH_FLEX_MAP[b.slot as BenchSlot];
    const positions: GranularPosition[] = [
      player.primary_position,
      ...(player.secondary_positions ?? []),
    ];
    const eligible = positions.some((p) => allowed.includes(p));
    if (!eligible) {
      return NextResponse.json(
        { error: `Player cannot play in ${b.slot} slot` },
        { status: 400 }
      );
    }
  }

  const starterSet = new Set(starterIds);
  const benchSet = new Set(benchIds);

  // Prefer current FPL GW matchup for lock checks and lineup writes.
  // Fallback to next scheduled matchup if current GW row is unavailable.
  let currentFplGw = 0;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      next: { revalidate: 60 },
    });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      for (const ev of fplData.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          currentFplGw = Math.max(currentFplGw, ev.id);
        }
      }
    }
  } catch {
    // fail open; fallback query below
  }

  let matchup: any = null;
  if (currentFplGw > 0) {
    const { data: currentGwMatchup } = await admin
      .from('matchups')
      .select('id, team_a_id, team_b_id, gameweek, status, lineup_a, lineup_b')
      .eq('gameweek', currentFplGw)
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .maybeSingle();
    // Only use the current GW matchup if it's not already completed
    if (currentGwMatchup && currentGwMatchup.status !== 'completed') {
      matchup = currentGwMatchup;
    }
  }

  if (!matchup) {
    const { data: nextScheduled } = await admin
      .from('matchups')
      .select('id, team_a_id, team_b_id, gameweek, status, lineup_a, lineup_b')
      .eq('status', 'scheduled')
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .order('gameweek', { ascending: true })
      .limit(1)
      .maybeSingle();
    matchup = nextScheduled ?? null;
  }

  // --- Kickoff lock: when a saved GW lineup exists, compare XI/bench/reserve placement vs FPL kickoffs.
  // (Roster status alone misses bench↔reserve moves — both are `bench` in DB.)
  if (matchup) {
    const targetGameweek = (matchup as any).gameweek;
    const isTeamA = (matchup as any).team_a_id === teamId;
    const prevLineup = (isTeamA ? (matchup as any).lineup_a : (matchup as any).lineup_b) as MatchupLineup | null;

    let startedTeamIds = new Set<number>();
    try {
      const res = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${targetGameweek}`, {
        next: { revalidate: 60 },
      });
      if (res.ok) {
        const fixtures = await res.json();
        const now = new Date();
        for (const f of fixtures) {
          if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
            startedTeamIds.add(f.team_h);
            startedTeamIds.add(f.team_a);
          }
        }
      }
    } catch (err) {
      console.error('[lineup] Failed to fetch FPL fixtures for lock check:', err);
    }

    if (startedTeamIds.size > 0) {
      const plStarted = (pid: string) => {
        const pl = playerMap.get(pid) as any;
        return pl && pl.pl_team_id != null && startedTeamIds.has(pl.pl_team_id);
      };

      if (prevLineup && prevLineup.formation !== formation) {
        for (const pid of placementMapFromLineup(prevLineup).keys()) {
          if (plStarted(pid)) {
            return NextResponse.json(
              {
                error:
                  'Cannot change formation after a match involving one of your squad players has kicked off.',
              },
              { status: 400 },
            );
          }
        }
      }

      if (prevLineup) {
        const prevMap = placementMapFromLineup(prevLineup);
        const newMap = placementMapFromPayload(starters, bench);
        const touched = new Set<string>([...prevMap.keys(), ...newMap.keys()]);
        const lockedNames: string[] = [];
        for (const pid of touched) {
          if (!plStarted(pid)) continue;
          const prevKey = placementKey(prevMap.get(pid));
          const nextKey = placementKey(newMap.get(pid));
          if (prevKey !== nextKey) {
            const pl = playerMap.get(pid) as any;
            lockedNames.push((pl?.web_name || pl?.full_name || pid) as string);
          }
        }
        if (lockedNames.length > 0) {
          return NextResponse.json(
            {
              error: `Cannot change lineup for players whose club has already kicked off: ${[...new Set(lockedNames)].join(', ')}`,
            },
            { status: 400 },
          );
        }
      } else {
        const currentStatusMap = new Map<string, string>(
          entries.map((e: any) => [e.player_id as string, e.status as string]),
        );
        const movedPlayerIds = allPlayerIds.filter((pid) => {
          const currentStatus = currentStatusMap.get(pid);
          const newStatus = starterSet.has(pid) ? 'active' : 'bench';
          return currentStatus !== newStatus;
        });

        if (movedPlayerIds.length > 0) {
          const lockedNames = movedPlayerIds
            .filter((pid) => plStarted(pid))
            .map((pid) => {
              const pl = playerMap.get(pid) as any;
              return pl.web_name || pl.full_name || pid;
            });
          if (lockedNames.length > 0) {
            return NextResponse.json(
              {
                error: `Cannot move players whose club has already kicked off: ${lockedNames.join(', ')}`,
              },
              { status: 400 },
            );
          }
        }
      }
    }
  }

  // Bulk update roster_entries status (IR entries untouched since we only fetched non-IR)
  const starterEntryIds = entries
    .filter((e: any) => starterSet.has(e.player_id as string))
    .map((e: any) => e.id as string);
  const benchEntryIds = entries
    .filter((e: any) => benchSet.has(e.player_id as string))
    .map((e: any) => e.id as string);
  const unassignedEntryIds = entries
    .filter((e: any) => !starterSet.has(e.player_id as string) && !benchSet.has(e.player_id as string))
    .map((e: any) => e.id as string);

  if (starterEntryIds.length > 0) {
    await admin.from('roster_entries').update({ status: 'active' }).in('id', starterEntryIds);
  }
  if (benchEntryIds.length > 0) {
    await admin.from('roster_entries').update({ status: 'bench' }).in('id', benchEntryIds);
  }
  if (unassignedEntryIds.length > 0) {
    await admin.from('roster_entries').update({ status: 'bench' }).in('id', unassignedEntryIds);
  }

  if (matchup) {
    const lineup: MatchupLineup = { formation, starters, bench };
    const column = (matchup as any).team_a_id === teamId ? 'lineup_a' : 'lineup_b';
    await admin.from('matchups').update({ [column]: lineup }).eq('id', (matchup as any).id);
  }

  return NextResponse.json({ ok: true });
}
