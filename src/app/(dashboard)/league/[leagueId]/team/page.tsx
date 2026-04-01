import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import InteractivePlayerCard from '@/components/players/InteractivePlayerCard';
import type { Player, RosterEntry, Formation, GranularPosition, MatchupLineup, BenchSlot } from '@/types';
import { FORMATION_SLOTS, POSITION_FLEX_MAP } from '@/types';
import PitchUI from './PitchUI';
import RosterManager from './RosterManager';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import styles from './my-team.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ mode?: string }>;
}

export default async function MyTeamPage({ params, searchParams }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Fetch full team data
  const { data: team } = await admin
    .from('teams')
    .select(`
      id, team_name, faab_budget, league_id,
      league:leagues(id, name, season, status, scoring_rules, bench_size)
    `)
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!team) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyIcon}>&#128085;</p>
        <h2 className={styles.emptyTitle}>No team found</h2>
        <p className={styles.emptyText}>You do not have a team in this league.</p>
        <a href="/dashboard" className={styles.backLink}>
          &larr; Back to Dashboard
        </a>
      </div>
    );
  }

  // Fetch rank separately from view
  // Fetch rank separately from view
  const { data: standingData } = await admin
    .from('league_standings')
    .select('rank')
    .eq('team_id', team.id)
    .single();

  const teamRank = standingData?.rank;

  // Fetch all player rankings for mapping
  const { data: rankings } = await admin.from('player_rankings').select('*');
  const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));


  // Fetch roster entries with full player data (including rankings)
  const { data: rosterData } = await admin
    .from('roster_entries')
    .select(
      `
      id, team_id, player_id, status, acquisition_type, acquisition_value, acquired_at, on_trade_block,
      player:players(${FULL_PLAYER_SELECT})
    `
    )
    .eq('team_id', team.id)
    .order('status', { ascending: true });

  const rosterEntries = (rosterData ?? []).map((e: any) => {
    const player = e.player as any;
    if (player) {
      const ranks = rankMap.get(player.id);
      player.overall_rank = ranks?.overall_rank;
      player.position_ranks = ranks?.position_ranks;
    }
    return e;
  });
  const starters = rosterEntries.filter((e) => e.status === 'active');
  const bench = rosterEntries.filter((e) => e.status === 'bench');
  const ir = rosterEntries.filter((e) => e.status === 'ir');
  const nonIrEntries = rosterEntries.filter((e) => e.status !== 'ir');

  // Fetch current GW player points for score overlay
  let scoreMap: Record<string, number> = {};
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 300 } });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      let currentGw = 0;
      for (const ev of fplData.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          currentGw = Math.max(currentGw, ev.id);
        }
      }
      if (currentGw) {
        const playerIds = rosterEntries.map((e) => e.player.id);
        const { data: statsRows } = await admin
          .from('player_stats')
          .select('player_id, fantasy_points')
          .eq('gameweek', currentGw)
          .in('player_id', playerIds);
        for (const s of statsRows ?? []) {
          scoreMap[s.player_id] = (scoreMap[s.player_id] ?? 0) + Number(s.fantasy_points);
        }
      }
    }
  } catch { /* non-critical — silently skip */ }

  // Determine initial formation and assignments from upcoming matchup lineup
  let initialFormation: Formation = '4-3-3';
  let initialAssignments: Record<number, string> = {};
  let initialBench: Record<string, string | null> = {
    DEF: null,
    MID: null,
    ATT: null,
    FLEX: null,
  };

  // Try to load existing lineup from next scheduled matchup
  const { data: matchup } = await admin
    .from('matchups')
    .select('id, team_a_id, team_b_id, lineup_a, lineup_b, gameweek')
    .eq('status', 'scheduled')
    .or(`team_a_id.eq.${team.id},team_b_id.eq.${team.id}`)
    .order('gameweek', { ascending: true })
    .limit(1)
    .single();

  let lockedTeamIds = new Set<number>();

  // Build a set of active (non-IR) player IDs for sanitization
  const nonIrPlayerIds = new Set(nonIrEntries.map((e) => e.player.id));

  if (matchup) {
    const isTeamA = (matchup as any).team_a_id === team.id;
    const existingLineup = (isTeamA ? matchup.lineup_a : matchup.lineup_b) as MatchupLineup | null;

    if (existingLineup) {
      initialFormation = existingLineup.formation;
      const slots = FORMATION_SLOTS[existingLineup.formation];
      for (let i = 0; i < slots.length; i++) {
        const starter = existingLineup.starters[i];
        // Skip players who have since been moved to IR
        if (starter && nonIrPlayerIds.has(starter.player_id)) {
          initialAssignments[i] = starter.player_id;
        }
      }
      for (const b of existingLineup.bench || []) {
        // Skip players who have since been moved to IR
        if (b.slot && b.player_id && nonIrPlayerIds.has(b.player_id)) {
          initialBench[b.slot] = b.player_id;
        }
      }
    }

    // Identify which teams have locked for this matchup's gameweek
    try {
      const res = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${(matchup as any).gameweek}`, {
        next: { revalidate: 60 }
      });
      if (res.ok) {
        const fixtures = await res.json();
        const now = new Date();
        for (const f of fixtures) {
          if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
            lockedTeamIds.add(f.team_h);
            lockedTeamIds.add(f.team_a);
          }
        }
      }
    } catch { /* Fail open */ }
  }

  // If no existing lineup, auto-assign starters based on current roster statuses
  if (Object.keys(initialAssignments).length === 0 && starters.length > 0) {
    const slots = FORMATION_SLOTS[initialFormation];
    const used = new Set<string>();

    for (let i = 0; i < slots.length; i++) {
      const slotPos = slots[i];
      const allowed = POSITION_FLEX_MAP[slotPos];
      const candidate = starters.find((e) => {
        if (used.has(e.player.id)) return false;
        const positions: GranularPosition[] = [
          e.player.primary_position,
          ...(e.player.secondary_positions ?? []),
        ];
        return positions.some((p) => allowed.includes(p));
      });
      if (candidate) {
        initialAssignments[i] = candidate.player.id;
        used.add(candidate.player.id);
      }
    }

    // Auto-assign bench slots
    const benchUsed = new Set<string>();
    const benchPool = bench; // Roster entries with status 'bench'
    for (const slot of ['DEF', 'MID', 'ATT', 'FLEX']) {
      const candidate = benchPool.find(e => !benchUsed.has(e.player.id));
      if (candidate) {
        initialBench[slot] = candidate.player.id;
        benchUsed.add(candidate.player.id);
      }
    }
  }

  // Now, anyone who isn't a starter and isn't on the 4-man bench is a reserve.
  const assignedStarterIds = new Set(Object.values(initialAssignments));
  const assignedBenchIds = new Set(Object.values(initialBench).filter(Boolean));
  const reserves = nonIrEntries.filter(
    (e) => !assignedStarterIds.has(e.player.id) && !assignedBenchIds.has(e.player.id)
  );

  return (
    <div>
      <header className={styles.header}>
        <div>
          <div className={styles.headerTop}>
            <p className={styles.leagueName}>{(team.league as any).name}</p>
          </div>
          <h1 className={styles.teamName}>{team.team_name}</h1>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.headerStats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>
                {teamRank ? (teamRank === 1 ? '🥇 1st' : teamRank === 2 ? '🥈 2nd' : teamRank === 3 ? '🥉 3rd' : `${teamRank}th`) : '—'}
              </span>
              <span className={styles.statLabel}>League Rank</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>&pound;{team.faab_budget}m</span>
              <span className={styles.statLabel}>FAAB Budget</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>{rosterEntries.length}</span>
              <span className={styles.statLabel}>Players</span>
            </div>
          </div>
        </div>
      </header>

      <PitchUI
        teamId={team.id}
        allEntries={nonIrEntries}
        irEntries={ir}
        initialFormation={initialFormation}
        initialAssignments={initialAssignments}
        initialBench={initialBench as Record<BenchSlot, string | null>}
        scoreMap={scoreMap}
        lockedTeamIds={lockedTeamIds}
      />

      <div className={styles.sections}>
        <RosterManager teamId={team.id} rosterEntries={rosterEntries} />
      </div>
    </div>
  );
}
