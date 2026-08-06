/**
 * loadClubView — everything the club page renders, for ANY club in a league.
 *
 * Split out of `team/roster/page.tsx`, which keyed the whole page off
 * `user_id = me` and so could only ever draw one squad: your own. Rival rosters
 * existed nowhere in the product except a gameweek's worth of lineup on the
 * matchup page and the counterparty picker inside the propose modal — i.e. only
 * to someone already committed to making a deal.
 *
 * The viewer is now a parameter, not an assumption. `viewerIsOwner` decides
 * what the page is allowed to show, NOT how the data is fetched — see the
 * privacy notes at each guarded read below. Everything else is identical for
 * every club, which is the point: one code path, so the rival view can't drift
 * away from the owner's.
 */

import type { createAdminClient } from '@/lib/supabase/admin';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import type { Player, RosterStatus } from '@/types';
import type { CrestConfig } from '@/components/crest/types';
import {
  getCurrentFplSeason,
  isFplSeasonKickedOff,
  resolveDraftStatsSeason,
} from '@/lib/season/currentSeason';
import { listDecisions, getSlotUsage } from '@/lib/departures/decisions';
import { OPEN_STATUSES, RIGHTS_HELD_STATUSES } from '@/lib/departures/types';
import { CLUB_BY_SLUG } from '@/lib/clubs/registry';
import { resolveCurrentGw } from '@/lib/season/currentGameweek';

type AdminClient = ReturnType<typeof createAdminClient>;

// ── Shared prop types (re-exported by ClubClient for its children) ───────────

/** A `player_sale_listings` row, shaped for the ListingEditor modal Inspector opens inline. */
export interface SquadListing {
  id: string;
  status: 'pending' | 'active' | 'sold' | 'expired' | 'cancelled';
  /** The auction floor. Null (114) means this listing has no open auction. */
  min_bid: number | null;
  ask_price: number | null;
  buy_now_price: number | null;
  open_to_trade: boolean;
  open_to_sale: boolean;
  open_to_loan: boolean;
  auction_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SquadEntry {
  id: string;
  playerId: string;
  status: RosterStatus;
  acquisitionType: 'draft' | 'waiver' | 'free_agent' | 'trade' | 'retained_return';
  acquisitionValue: number | null;
  acquiredAt: string;
  isPendingDrop: boolean;
  listing: SquadListing | null;
  form: number[];
  player: Player;
}

export interface DepartureView {
  id: string;
  status: string;
  name: string;
  webName: string;
  pos: string;
  photoUrl: string | null;
  lastClub: string;
  backClub: string | null;
  seasonFrom: string;
  marketValue: number;
  compensation: number;
  decideBy: string | null;
  reinstateBy: string | null;
}

/** One entry in the club switcher — every club in the league, in table order. */
export interface ClubSwitcherEntry {
  teamId: string;
  name: string;
  crestConfig: CrestConfig | null;
  rank: number | null;
  isMine: boolean;
}

export interface ClubProps {
  leagueId: string;
  teamId: string;
  /** Every club in the league, so the page you're on is also the way to the next one. */
  clubs: ClubSwitcherEntry[];
  /**
   * False when browsing a rival's club. Gates every action and every private
   * read below — a rival page is a reading surface, never a control panel.
   */
  viewerIsOwner: boolean;
  club: {
    name: string;
    manager: string;
    leagueName: string;
    season: string;
    balance: number;
    rosterMax: number;
    academyMax: number;
    retainedMax: number;
    academyAgeLimit: number;
    gw: number;
    crestConfig: CrestConfig | null;
  };
  standing: {
    rank: number | null;
    w: number;
    d: number;
    l: number;
    pointsFor: number;
    pointsForRank: number;
    ofTeams: number;
  };
  entries: SquadEntry[];
  departures: {
    pending: DepartureView[];
    held: DepartureView[];
    slots: { used: number; total: number; remaining: number };
    /** True if the decisions or slot-usage query failed — the lists below are empty defaults, not "nothing to show". */
    error: boolean;
  };
}

// ── Loader ───────────────────────────────────────────────────────────────────

/** Identifies the club to load: by its own id, or by whoever manages it. */
export type ClubSelector = { teamId: string } | { userId: string };

export async function loadClubView(
  admin: AdminClient,
  leagueId: string,
  selector: ClubSelector,
  viewerUserId: string,
): Promise<ClubProps | null> {
  let query = admin
    .from('teams')
    .select(
      `
      id, user_id, team_name, faab_budget, crest_config, league_id,
      league:leagues(id, name, season, current_season, previous_season, status,
        roster_size, taxi_size, taxi_age_limit, retained_slots)
    `,
    )
    .eq('league_id', leagueId);

  query = 'teamId' in selector ? query.eq('id', selector.teamId) : query.eq('user_id', selector.userId);

  const { data: team } = await query.maybeSingle();
  if (!team) return null;

  const viewerIsOwner = (team as { user_id: string }).user_id === viewerUserId;

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
  // Preseason club card must show the completed stats season (2025-26), not
  // a stale previous_season default (2024-25) or the empty upcoming year.
  let season = league.current_season ?? league.season ?? currentFpl;
  if (season === currentFpl && !kickedOff) {
    season = await resolveDraftStatsSeason(admin, league);
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
  // player_stats keeps every past season's rows uncleared, and gameweek numbers
  // repeat every season — the form/gameweek window must be season-scoped too.
  const statsSeason = await getCurrentFplSeason(undefined, true);

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
    // PRIVATE: a pending drop is an intention, not a transaction — it says
    // "I am about to cut this player" before anyone has been cut. Surfacing it
    // on a rival's page would leak the manager's hand.
    viewerIsOwner
      ? admin.from('pending_drops').select('player_id').eq('team_id', team.id)
      : Promise.resolve({ data: [] as never[] }),
    rosterIds.length && currentGw > 0
      ? admin
          .from('player_stats')
          .select('player_id, gameweek, fantasy_points')
          .eq('season', statsSeason)
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

  // ── Standings (rank, record, points-for) + the league's other clubs ─────────
  const [{ data: standingsRows }, { data: leagueTeams }] = await Promise.all([
    admin
      .from('league_standings')
      .select('team_id, team_name, username, rank, wins, draws, losses, league_points, points_for')
      .eq('league_id', leagueId),
    admin.from('teams').select('id, team_name, user_id, crest_config').eq('league_id', leagueId),
  ]);

  const rows = standingsRows ?? [];
  const mine = rows.find((r: any) => r.team_id === team.id) as any;
  const pointsForSorted = [...rows].sort((a: any, b: any) => Number(b.points_for) - Number(a.points_for));
  const pointsForRank = mine ? pointsForSorted.findIndex((r: any) => r.team_id === team.id) + 1 : 0;

  // Table order, with clubs that have no rank yet (nothing completed) sorted
  // alphabetically at the back rather than floated to the top by a null.
  const rankByTeam = new Map(rows.map((r: any) => [r.team_id, r.rank as number | null]));
  const clubs: ClubSwitcherEntry[] = (leagueTeams ?? [])
    .map((t: any) => ({
      teamId: t.id,
      name: t.team_name,
      crestConfig: (t.crest_config ?? null) as CrestConfig | null,
      rank: rankByTeam.get(t.id) ?? null,
      isMine: t.user_id === viewerUserId,
    }))
    .sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank;
      if (a.rank != null) return -1;
      if (b.rank != null) return 1;
      return a.name.localeCompare(b.name);
    });

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
      console.error('[club-view] Failed to load departure decisions:', err);
      return { ok: false as const, data: [] };
    },
  );
  const decisions = decisionsResult.data;

  const teamDecisions = decisions.filter((d: any) => d.team_id === team.id);
  const depPlayerIds = [...new Set(teamDecisions.map((d: any) => d.player_id))];

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
      console.error('[club-view] Failed to load retained slot usage:', err);
      return { ok: false as const, data: { used: 0, total: 0, remaining: 0 } };
    },
  );

  const departures = {
    // PRIVATE: an open decision is a choice this manager has not made yet
    // (release for compensation vs. retain the rights). Held rights, below, are
    // the opposite — settled, tradeable assets the whole league can bid on.
    pending: viewerIsOwner ? teamDecisions.filter((d: any) => d.status === 'pending').map(depView) : [],
    held: teamDecisions.filter((d: any) => RIGHTS_HELD_STATUSES.includes(d.status)).map(depView),
    slots: slotsResult.data,
    error: !decisionsResult.ok || !slotsResult.ok,
  };

  return {
    leagueId,
    teamId: team.id,
    clubs,
    viewerIsOwner,
    club: {
      name: team.team_name,
      manager: mine?.username ?? 'Manager',
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
}

/** "2025-26" → "2025/26" for display. */
function fmtSeason(s: string): string {
  return s.replace('-', '/');
}
