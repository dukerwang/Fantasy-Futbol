import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORMATION_SLOTS, POSITION_FLEX_MAP, BENCH_FLEX_MAP, getExpectedBenchSlots } from '@/types';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { resolveLineupEditMatchup } from '@/lib/lineups/editTarget';
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
    .not('status', 'in', '("ir","taxi","loan_out")');

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
  // After that GW's last kickoff, writes go to next week — not the frozen row.
  let currentFplGw = 0;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 3600 },
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
    // fail closed into resolveLineupEditMatchup's scheduled/live fallback
  }

  const matchup = await resolveLineupEditMatchup(admin, teamId, currentFplGw);

  // --- Kickoff lock: when a saved GW lineup exists, compare XI/bench/reserve placement vs FPL kickoffs.
  // (Roster status alone misses bench↔reserve moves — both are `bench` in DB.)
  if (matchup) {
    const targetGameweek = (matchup as any).gameweek;
    const isTeamA = (matchup as any).team_a_id === teamId;
    let prevLineup = (isTeamA ? (matchup as any).lineup_a : (matchup as any).lineup_b) as MatchupLineup | null;

    const { getLockedPlTeamIds } = await import('@/lib/fixtures/lockout');
    const startedTeamIds = await getLockedPlTeamIds(admin, targetGameweek);

    if (startedTeamIds.size > 0) {
      const plStarted = (pid: string) => {
        const pl = playerMap.get(pid) as any;
        return pl && pl.pl_team_id != null && startedTeamIds.has(pl.pl_team_id);
      };

      if (!prevLineup) {
        // Construct a virtual previous lineup using the same auto-assignment rules as the UI
        const startersFromRoster = entries.filter((e) => e.status === 'active');
        const benchFromRoster = entries.filter((e) => e.status === 'bench');

        const virtualFormation: Formation = '4-3-3';
        const slots = FORMATION_SLOTS[virtualFormation];
        
        const virtualStarters: { player_id: string; slot: GranularPosition }[] = [];
        const used = new Set<string>();

        for (let i = 0; i < slots.length; i++) {
          const slotPos = slots[i];
          const allowed = POSITION_FLEX_MAP[slotPos];
          const candidate = startersFromRoster.find((e) => {
            if (used.has(e.player_id)) return false;
            const player = playerMap.get(e.player_id);
            if (!player) return false;
            const positions: GranularPosition[] = [
              player.primary_position,
              ...(player.secondary_positions ?? []),
            ];
            return positions.some((p) => allowed.includes(p));
          });
          if (candidate) {
            virtualStarters.push({ player_id: candidate.player_id, slot: slotPos });
            used.add(candidate.player_id);
          } else {
            virtualStarters.push({ player_id: '', slot: slotPos });
          }
        }

        const virtualBench: { player_id: string; slot: BenchSlot }[] = [];
        const benchUsed = new Set<string>();
        for (const slot of ['DEF', 'MID', 'ATT', 'FLEX'] as BenchSlot[]) {
          const allowed = BENCH_FLEX_MAP[slot];
          const candidate = benchFromRoster.find((e) => {
            if (benchUsed.has(e.player_id)) return false;
            const player = playerMap.get(e.player_id);
            if (!player) return false;
            const positions: GranularPosition[] = [
              player.primary_position,
              ...(player.secondary_positions ?? []),
            ];
            return positions.some((p) => allowed.includes(p));
          });
          if (candidate) {
            virtualBench.push({ player_id: candidate.player_id, slot });
            benchUsed.add(candidate.player_id);
          } else {
            virtualBench.push({ player_id: '', slot });
          }
        }

        prevLineup = {
          formation: virtualFormation,
          starters: virtualStarters,
          bench: virtualBench,
        };
      }

      if (prevLineup.formation !== formation) {
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
          lockedNames.push(pl ? getPlayerDisplayName(pl, 'initial_last') : pid);
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
    }
  }

  // Bulk update roster_entries status (IR entries untouched since we only fetched non-IR)
  const starterEntryIds = entries
    .filter((e: any) => starterSet.has(e.player_id as string) && e.status !== 'loan_in')
    .map((e: any) => e.id as string);
  const benchEntryIds = entries
    .filter((e: any) => benchSet.has(e.player_id as string) && e.status !== 'loan_in')
    .map((e: any) => e.id as string);
  const unassignedEntryIds = entries
    .filter((e: any) => !starterSet.has(e.player_id as string) && !benchSet.has(e.player_id as string) && e.status !== 'loan_in')
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
