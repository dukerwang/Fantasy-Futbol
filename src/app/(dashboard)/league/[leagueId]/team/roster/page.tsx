import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import type { Player, RosterStatus } from '@/types';
import { getCurrentFplSeason, isFplSeasonKickedOff } from '@/lib/season/currentSeason';
import { listDecisions, getSlotUsage } from '@/lib/departures/decisions';
import { OPEN_STATUSES, RIGHTS_HELD_STATUSES } from '@/lib/departures/types';
import { CLUB_BY_SLUG } from '@/lib/clubs/registry';
import ClubClient, {
  type ClubProps,
  type SquadEntry,
  type DepartureView,
} from './ClubClient';
import styles from './club.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function MyClubPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: team } = await admin
    .from('teams')
    .select(
      `
      id, team_name, faab_budget, crest_config, league_id,
      league:leagues(id, name, season, current_season, previous_season, status,
        roster_size, taxi_size, taxi_age_limit, retained_slots)
    `,
    )
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!team) {
    return (
      <div className={styles.empty}>
        <h2>No team found</h2>
        <Link href="/dashboard">&larr; Back to Dashboard</Link>
      </div>
    );
  }

  const league = team.league as unknown as {
    name: string;
    season: string | null;
    current_season: string | null;
    previous_season: string | null;
    roster_size: number | null;
    taxi_size: number | null;
    taxi_age_limit: number | null;
    retained_slots: number | null;
  };

  const currentFpl = await getCurrentFplSeason();
  const kickedOff = await isFplSeasonKickedOff();
  let season = league.current_season ?? league.season ?? currentFpl;
  if (season === currentFpl && !kickedOff) {
    season = league.previous_season ?? season;
  }

  // ── Roster + player data ────────────────────────────────────────────────────
  const { data: rosterRaw } = await admin
    .from('roster_entries')
    .select(
      `
      id, team_id, player_id, status, acquisition_type, acquisition_value, acquired_at,
      player:players(${FULL_PLAYER_SELECT})
    `,
    )
    .eq('team_id', team.id)
    .order('status', { ascending: true });

  const rosterEntries = (rosterRaw ?? []) as unknown as {
    id: string;
    team_id: string;
    player_id: string;
    status: RosterStatus;
    acquisition_type: 'draft' | 'waiver' | 'free_agent' | 'trade' | 'retained_return';
    acquisition_value: number | null;
    acquired_at: string;
    player: Player;
  }[];

  const rosterIds = rosterEntries.map((e) => e.player_id);

  // Rankings (a view — fetch separately, FILTERED to this roster) + archive overlay,
  // listings, pending drops, last-5 form, all in parallel.
  const currentGw = await resolveCurrentGw();
  const formFrom = Math.max(1, currentGw - 4);

  const [
    { data: rankings },
    { data: archives },
    { data: listings },
    { data: pendingDrops },
    { data: formRows },
  ] = await Promise.all([
    rosterIds.length
      ? admin.from('player_rankings').select('player_id, overall_rank, position_ranks').in('player_id', rosterIds)
      : Promise.resolve({ data: [] as never[] }),
    rosterIds.length
      ? admin
          .from('season_player_stats_archive')
          .select('player_id, ppg, form_rating, overall_rank, position_ranks')
          .eq('season', season)
          .in('player_id', rosterIds)
      : Promise.resolve({ data: [] as never[] }),
    admin
      .from('player_sale_listings')
      .select(
        `id, player_id, status, min_bid, ask_price, buy_now_price,
         open_to_trade, open_to_sale, open_to_loan, auction_expires_at,
         created_at, updated_at`,
      )
      .eq('league_id', leagueId)
      .in('status', ['pending', 'active']),
    admin.from('pending_drops').select('player_id').eq('team_id', team.id),
    rosterIds.length && currentGw > 0
      ? admin
          .from('player_stats')
          .select('player_id, gameweek, fantasy_points')
          .in('player_id', rosterIds)
          .gte('gameweek', formFrom)
          .lte('gameweek', currentGw)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));
  const archiveMap = new Map((archives ?? []).map((a: any) => [a.player_id, a]));
  const listingsMap = new Map((listings ?? []).map((l: any) => [l.player_id, l]));
  const pendingDropIds = new Set((pendingDrops ?? []).map((d: any) => d.player_id));

  // Last-5 form array per player (fantasy points, oldest → newest).
  const formByPlayer = new Map<string, number[]>();
  if (currentGw > 0) {
    const byPlayer = new Map<string, Map<number, number>>();
    for (const s of (formRows ?? []) as any[]) {
      if (!byPlayer.has(s.player_id)) byPlayer.set(s.player_id, new Map());
      byPlayer.get(s.player_id)!.set(s.gameweek, (byPlayer.get(s.player_id)!.get(s.gameweek) ?? 0) + Number(s.fantasy_points));
    }
    for (const pid of rosterIds) {
      const gwMap = byPlayer.get(pid);
      const arr: number[] = [];
      for (let gw = formFrom; gw <= currentGw; gw++) arr.push(Number((gwMap?.get(gw) ?? 0).toFixed(2)));
      formByPlayer.set(pid, arr);
    }
  }

  const entries: SquadEntry[] = rosterEntries.map((e) => {
    const player = e.player;
    if (player) {
      const ranks = rankMap.get(player.id);
      const arch = archiveMap.get(player.id);
      player.overall_rank = arch ? arch.overall_rank : ranks?.overall_rank;
      player.position_ranks = (arch ? arch.position_ranks : ranks?.position_ranks) as any;
      player.ppg = arch ? Number(arch.ppg) : player.ppg;
      player.form_rating = arch ? Number(arch.form_rating) : player.form_rating;
    }
    return {
      id: e.id,
      playerId: e.player_id,
      status: e.status,
      acquisitionType: e.acquisition_type,
      acquisitionValue: e.acquisition_value,
      acquiredAt: e.acquired_at,
      isPendingDrop: pendingDropIds.has(e.player_id),
      listing: listingsMap.get(e.player_id) ?? null,
      form: formByPlayer.get(e.player_id) ?? [],
      player,
    };
  });

  // ── Standings (rank, record, points-for) ────────────────────────────────────
  const { data: standingsRows } = await admin
    .from('league_standings')
    .select('team_id, team_name, username, rank, wins, draws, losses, league_points, points_for')
    .eq('league_id', leagueId);

  const rows = standingsRows ?? [];
  const mine = rows.find((r: any) => r.team_id === team.id) as any;
  const pointsForSorted = [...rows].sort((a: any, b: any) => Number(b.points_for) - Number(a.points_for));
  const pointsForRank = mine ? pointsForSorted.findIndex((r: any) => r.team_id === team.id) + 1 : 0;

  const standing = {
    rank: mine?.rank ?? null,
    w: mine?.wins ?? 0,
    d: mine?.draws ?? 0,
    l: mine?.losses ?? 0,
    pointsFor: Number(mine?.points_for ?? 0),
    pointsForRank,
    ofTeams: rows.length,
  };

  // ── Departures / Retained List ───────────────────────────────────────────────
  // Failures here must not vanish silently — an empty Retained List reads as
  // "you hold no rights", not "this query broke". Log for diagnosis and carry
  // an error flag through so the UI can tell the manager the difference.
  const decisionsResult = await listDecisions(admin, leagueId, {
    statuses: [...new Set([...OPEN_STATUSES, ...RIGHTS_HELD_STATUSES])],
  }).then(
    (data) => ({ ok: true as const, data }),
    (err) => {
      console.error('[my-club] Failed to load departure decisions:', err);
      return { ok: false as const, data: [] };
    },
  );
  const decisions = decisionsResult.data;

  const mineDecisions = decisions.filter((d: any) => d.team_id === team.id);
  const depPlayerIds = [...new Set(mineDecisions.map((d: any) => d.player_id))];

  const { data: depPlayers } = depPlayerIds.length
    ? await admin
        .from('players')
        .select('id, name, web_name, pl_team, primary_position, photo_url')
        .in('id', depPlayerIds)
    : { data: [] as any[] };
  const depPlayerById = new Map((depPlayers ?? []).map((p: any) => [p.id, p]));

  // Last PL club per departed player, keyed on the season they left.
  const { data: seasonClubs } = depPlayerIds.length
    ? await admin
        .from('player_season_clubs')
        .select('player_id, season, club_slug')
        .in('player_id', depPlayerIds)
    : { data: [] as any[] };
  const clubByPlayerSeason = new Map(
    (seasonClubs ?? []).map((r: any) => [`${r.player_id}:${r.season}`, r.club_slug]),
  );

  function lastClubName(playerId: string, seasonFrom: string, fallback: string | null): string {
    const slug = clubByPlayerSeason.get(`${playerId}:${seasonFrom}`);
    const byRegistry = slug ? CLUB_BY_SLUG.get(slug)?.name : null;
    return byRegistry ?? fallback ?? 'a Premier League club';
  }

  const depView = (d: any): DepartureView => {
    const p = depPlayerById.get(d.player_id);
    return {
      id: d.id,
      status: d.status,
      name: p?.name ?? p?.web_name ?? 'Unknown',
      webName: p?.web_name ?? p?.name ?? 'Unknown',
      pos: p?.primary_position ?? 'CM',
      photoUrl: p?.photo_url ?? null,
      lastClub: lastClubName(d.player_id, d.season_from, p?.pl_team ?? null),
      backClub: p?.pl_team ?? null,
      seasonFrom: d.season_from,
      marketValue: Number(d.market_value_at_departure ?? 0),
      compensation: Number(d.compensation_offered ?? 0),
      decideBy: d.decide_by ?? null,
      reinstateBy: d.reinstate_by ?? null,
    };
  };

  const slotsResult = await getSlotUsage(admin, leagueId, team.id).then(
    (data) => ({ ok: true as const, data }),
    (err) => {
      console.error('[my-club] Failed to load retained slot usage:', err);
      return { ok: false as const, data: { used: 0, total: 0, remaining: 0 } };
    },
  );

  const departures = {
    pending: mineDecisions.filter((d: any) => d.status === 'pending').map(depView),
    held: mineDecisions.filter((d: any) => RIGHTS_HELD_STATUSES.includes(d.status)).map(depView),
    slots: slotsResult.data,
    error: !decisionsResult.ok || !slotsResult.ok,
  };

  const props: ClubProps = {
    leagueId,
    teamId: team.id,
    club: {
      name: team.team_name,
      manager: mine?.username ?? user.user_metadata?.username ?? user.email?.split('@')[0] ?? 'Manager',
      leagueName: league.name,
      season: fmtSeason(season),
      balance: Number(team.faab_budget ?? 0),
      rosterMax: league.roster_size ?? 20,
      academyMax: league.taxi_size ?? 3,
      retainedMax: league.retained_slots ?? 3,
      academyAgeLimit: league.taxi_age_limit ?? 21,
      gw: currentGw,
      crestConfig: (team as any).crest_config ?? null,
    },
    standing,
    entries,
    departures,
  };

  return <ClubClient {...props} />;
}

/** "2025-26" → "2025/26" for display. */
function fmtSeason(s: string): string {
  return s.replace('-', '/');
}

/** Latest kicked-off FPL gameweek (deadline passed). 0 if unavailable. */
async function resolveCurrentGw(): Promise<number> {
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 300 },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const now = new Date();
    let gw = 0;
    for (const ev of data.events as any[]) {
      if (ev.deadline_time && new Date(ev.deadline_time) <= now) gw = Math.max(gw, ev.id);
    }
    return gw;
  } catch {
    return 0;
  }
}
