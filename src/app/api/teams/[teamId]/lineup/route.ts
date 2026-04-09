import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORMATION_SLOTS, POSITION_FLEX_MAP, BENCH_FLEX_MAP, getExpectedBenchSlots } from '@/types';
import type { Formation, GranularPosition, MatchupLineup, BenchSlot } from '@/types';

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

  // Fetch all non-IR roster entries with player positions
  const { data: entries } = await admin
    .from('roster_entries')
    .select('id, player_id, status, player:players(id, primary_position, secondary_positions, pl_team_id, web_name, full_name)')
    .eq('team_id', teamId)
    .neq('status', 'ir');

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

  // Find next scheduled matchup for this team to determine the target gameweek
  const { data: matchup } = await admin
    .from('matchups')
    .select('id, team_a_id, team_b_id, gameweek')
    .eq('status', 'scheduled')
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .order('gameweek', { ascending: true })
    .limit(1)
    .single();

  // --- Kickoff lock: block moves if a player's club has already kicked off this GW ---
  if (matchup) {
    const targetGameweek = (matchup as any).gameweek;
    const currentStatusMap = new Map<string, string>(
      entries.map((e: any) => [e.player_id as string, e.status as string]),
    );

    // A player is "moved" if their active/bench status is changing
    const movedPlayerIds = allPlayerIds.filter((pid) => {
      const currentStatus = currentStatusMap.get(pid);
      const newStatus = starterSet.has(pid) ? 'active' : 'bench';
      return currentStatus !== newStatus;
    });

    if (movedPlayerIds.length > 0) {
      const movedTeamIds = [
        ...new Set(
          movedPlayerIds
            .map((pid) => (playerMap.get(pid) as any)?.pl_team_id)
            .filter((id): id is number => id != null),
        ),
      ];

      if (movedTeamIds.length > 0) {
        // Fetch FPL fixtures for the target gameweek to check kickoff times
        try {
          const res = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${targetGameweek}`, {
            next: { revalidate: 60 } // cache for 1 minute
          });
          
          if (res.ok) {
            const fixtures = await res.json();
            const now = new Date();
            
            const startedTeamIds = new Set<number>();
            for (const f of fixtures) {
              if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
                startedTeamIds.add(f.team_h);
                startedTeamIds.add(f.team_a);
              }
            }

            const lockedNames = movedPlayerIds
              .filter((pid) => {
                const pl = playerMap.get(pid) as any;
                return pl && startedTeamIds.has(pl.pl_team_id);
              })
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
        } catch (err) {
          console.error('[lineup] Failed to fetch FPL fixtures for lock check:', err);
          // Fail open to allow lineup submission if FPL API is down
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
