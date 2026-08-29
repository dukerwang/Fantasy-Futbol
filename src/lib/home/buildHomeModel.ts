/**
 * buildHomeModel — the whole League Home page in one server-side read.
 *
 * Replaces the 716-line page component's inline fetch sprawl, following the
 * `buildTransfersModel` precedent: the page becomes a thin renderer over a
 * fully-resolved view model, and every rule lives here rather than being
 * re-derived in JSX.
 *
 * The page it serves is organised around YOUR CLUB, not the league. The old
 * home spent seven of nine regions on league-wide information that
 * /standings, /activity, /stats and /matchups already carry in more depth;
 * this model is shaped so each region answers "what does this mean for me".
 *
 * It also models FIVE phases, not four. A gameweek is roughly three days of
 * football and four days of transfers, and the old page's "full time" state
 * persisted through all four of those market days. `market` is that phase.
 */

import type { createAdminClient } from '@/lib/supabase/admin';
import type { GranularPosition } from '@/types';
import { getFplStatus } from '@/lib/fpl/api';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import {
  computeSeasonPrize,
  DEFAULT_PRIZE_CONFIG,
  type PrizeConfig,
} from '@/lib/offseason/prizeDistribution';
import {
  periodIndexForGameweek,
  gameweeksInPeriod,
  computeMeritPayment,
  DEFAULT_MERIT_RATES,
  type MeritRates,
} from '@/lib/economy/meritPayments';
import { generateTransactionHeadline } from '@/lib/narrative/generators';
import { OPEN_STATUSES, SLOT_CONSUMING_STATUSES } from '@/lib/departures/types';
import {
  calculateTeamScore,
  loadReferenceStats,
  emptyTeamScoreDetail,
  POSITION_FLEX_MAP,
  type PlayerScoreRecord,
} from '@/lib/scoring/matchups';

import { resolveClub } from '@/lib/clubs/registry';
import { DRAW_THRESHOLD } from '@/lib/scoring/drawBand';

type AdminClient = ReturnType<typeof createAdminClient>;

/** The draw band. `league_standings` encodes the same number in SQL. */
const DRAW_BAND = DRAW_THRESHOLD;

// ── Public shapes ─────────────────────────────────────────────

export type HomePhase = 'buildup' | 'live' | 'ft' | 'market' | 'closed';

export interface HomeFigure {
  value: string;
  /** A stake, not a label. "Points for" was a cumulative nobody acts on. */
  stake: string;
  accent?: boolean;
}

export type AttentionTone = 'warn' | 'plain';

export interface AttentionItem {
  id: string;
  tag: string;
  tone: AttentionTone;
  text: string;
  when: string;
  /** null when the item has no clock at all (a trade offer never expires). */
  whenAt: string | null;
  action: string;
  href: string;
  /** Sort key in ms. Items with no deadline sort last. */
  order: number;
}

export interface HomeClub {
  id: string;
  name: string;
  abbreviation: string | null;
  crest: unknown;
  manager: string | null;
}

export interface XiSlot {
  slot: string;
  playerId: string;
  name: string;
  /** flag = doubtful/injured/no fixture; locked = his club has kicked off. */
  state: 'ok' | 'flag' | 'locked';
  note: string | null;
}

export interface HomeFixtureModel {
  matchupId: string;
  gameweek: number;
  when: string;
  home: HomeClub;
  away: HomeClub;
  homeMeta: string;
  awayMeta: string;
  hasScores: boolean;
  homeScore: number | null;
  awayScore: number | null;
  /** Yours minus theirs. Signed, so a defeat is representable. */
  margin: number;
  verdict: string;
  outcome: 'drawn' | 'ahead' | 'behind';
  /** Marker position 2-98. Leans toward whoever leads; you sit on the left. */
  markerPct: number;
  stillToPlay: { mine: number; theirs: number };
  topMine: string | null;
  topTheirs: string | null;
  cupLine: string | null;
}

/** A slot whose starter has no eligible replacement on the bench. */
export interface CoverGap {
  slot: string;
  starter: string;
}

/** The bench as it actually is, so a cover gap can be seen rather than asserted. */
export interface BenchPlayer {
  name: string;
  positions: string[];
}

export interface DebriefItem {
  value: string;
  label: string;
}

export interface MarketLot {
  playerId: string;
  name: string;
  position: string;
  meta: string;
  bid: string;
  floor: string;
  hasBids: boolean;
  holder: string;
  expiresAt: string | null;
  /** true when you hold the top bid on this lot. */
  leading: boolean;
  /** true when you have a bid on it but are not top. */
  outbid: boolean;
  isMine: boolean;
  nextBid: string;
  href: string;
}

export interface FrontTile {
  competition: string;
  value: string;
  sub: string;
  prize: string;
  tone: 'live' | 'out' | 'won' | 'plain';
}

export interface OtherFixture {
  id: string;
  home: HomeClub;
  away: HomeClub;
  homeScore: number | null;
  awayScore: number | null;
  tag: string;
  drawn: boolean;
  live: boolean;
}

export interface TableRow {
  teamId: string;
  rank: number;
  movement: number;
  club: HomeClub;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: string;
  leaguePoints: number;
  form: ('W' | 'D' | 'L')[];
  prize: string;
  isMe: boolean;
}

export interface TopPerformerRow {
  playerId: string;
  name: string;
  position: string;
  club: string;
  points: string;
  /** The fantasy team that rosters him, or 'Free agent' if no one does. */
  owner: string;
}

export interface WireItem {
  id: string;
  text: string;
  at: string;
  tone: string;
}

export interface OpponentCard {
  club: HomeClub;
  /** All-time across archived seasons plus the live one. */
  record: string;
  lastMeeting: string;
  title: string;
}

export interface ClubFact {
  label: string;
  value: string;
  gold?: boolean;
}

export interface ClosedState {
  headline: string;
  sub: string;
  stages: { name: string; sub: string; done: boolean }[];
  prizes: string;
  prizeSub: string;
  balance: string;
  openDepartures: number;
}

export interface HomeModel {
  /** Clock-skew anchor. Every countdown offsets against this, not Date.now(). */
  serverNow: string;
  phase: HomePhase;
  leagueId: string;
  leagueName: string;
  season: string;
  gameweek: number;
  totalGameweeks: number;
  club: HomeClub;
  subtitle: string;
  figures: HomeFigure[];
  attention: AttentionItem[];
  fixture: HomeFixtureModel | null;
  xi: XiSlot[];
  xiFlags: string[];
  xiSummary: string;
  coverGaps: CoverGap[];
  benchSummary: BenchPlayer[];
  /** The fixture on show has not kicked off: preview it, don't report it. */
  heroPlayed: boolean;
  debrief: DebriefItem[];
  matchReportHeadline: string | null;
  matchReportByline: string | null;
  /**
   * The one the phase machine did not pick.
   *
   * `ft`/`market` show the settled result as primary, so `secondaryKind` is
   * `'preview'` and this carries the next fixture you can still influence.
   * `buildup` shows that upcoming fixture as primary, so `secondaryKind` is
   * `'result'` and this carries last week's report instead. `live` and
   * `closed` never have one — there is nothing else worth surfacing mid-match
   * or once the season is shut.
   */
  secondaryKind: 'result' | 'preview' | null;
  secondaryFixture: HomeFixtureModel | null;
  secondaryPlayed: boolean;
  secondaryXi: XiSlot[];
  secondaryXiFlags: string[];
  secondaryXiSummary: string;
  secondaryCoverGaps: CoverGap[];
  secondaryBenchSummary: BenchPlayer[];
  secondaryDebrief: DebriefItem[];
  secondaryOpponent: OpponentCard | null;
  /** True when the secondary view should open by default — next week is close. */
  preferSecondary: boolean;
  market: MarketLot[];
  marketSummary: string;
  marketBudget: string;
  fronts: FrontTile[];
  matchweek: OtherFixture[];
  table: TableRow[];
  topPerformers: TopPerformerRow[];
  topPerformersGw: number | null;
  wire: WireItem[];
  opponent: OpponentCard | null;
  clubFacts: ClubFact[];
  closed: ClosedState | null;
}

// ── Small helpers ─────────────────────────────────────────────

const money = (n: number) => `€${Math.round(n)}m`;
const money1 = (n: number) => `€${(Math.round(n * 10) / 10).toFixed(1)}m`;

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function countdown(from: string, to: string | null): string {
  if (!to) return 'No clock';
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms <= 0) return 'Now';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs ? `${days}d ${remHrs}h` : `${days}d`;
}

function timeAgo(iso: string, now: string): string {
  const diff = new Date(now).getTime() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Result of one matchup from a given team's side, using the draw band. */
function resultFor(teamId: string, m: MatchupLite): 'W' | 'D' | 'L' | null {
  const isA = m.team_a_id === teamId;
  const isB = m.team_b_id === teamId;
  if (!isA && !isB) return null;
  const mine = Number(isA ? m.score_a : m.score_b) || 0;
  const theirs = Number(isA ? m.score_b : m.score_a) || 0;
  if (Math.abs(mine - theirs) <= DRAW_BAND) return 'D';
  return mine > theirs ? 'W' : 'L';
}

interface MatchupLite {
  id: string;
  gameweek: number;
  team_a_id: string | null;
  team_b_id: string | null;
  score_a: number | string | null;
  score_b: number | string | null;
  status: string;
  lineup_a?: unknown;
  lineup_b?: unknown;
}

/**
 * Rank every team as the standings view does, from a set of matchups.
 * Used to recompute last week's table so rank movement is real rather than
 * assumed — there is no rank snapshot anywhere in the schema (`team_stats`
 * exists but is empty), so this is the only honest source for the arrows.
 */
function rankAsOf(
  matchups: MatchupLite[],
  teams: { id: string; team_name: string }[],
): Map<string, number> {
  const agg = new Map<string, { pts: number; gd: number; pf: number; name: string }>();
  for (const t of teams) agg.set(t.id, { pts: 0, gd: 0, pf: 0, name: t.team_name });

  for (const m of matchups) {
    if (!m.team_a_id || !m.team_b_id) continue;
    const a = Number(m.score_a) || 0;
    const b = Number(m.score_b) || 0;
    const drawn = Math.abs(a - b) <= DRAW_BAND;
    const sideA = agg.get(m.team_a_id);
    const sideB = agg.get(m.team_b_id);
    if (sideA) {
      sideA.pts += drawn ? 1 : a > b ? 3 : 0;
      sideA.gd += a - b;
      sideA.pf += a;
    }
    if (sideB) {
      sideB.pts += drawn ? 1 : b > a ? 3 : 0;
      sideB.gd += b - a;
      sideB.pf += b;
    }
  }

  const ordered = [...agg.entries()].sort((x, y) => {
    if (y[1].pts !== x[1].pts) return y[1].pts - x[1].pts;
    if (y[1].gd !== x[1].gd) return y[1].gd - x[1].gd;
    if (y[1].pf !== x[1].pf) return y[1].pf - x[1].pf;
    return x[1].name.localeCompare(y[1].name);
  });

  const out = new Map<string, number>();
  ordered.forEach(([id], i) => out.set(id, i + 1));
  return out;
}

// ── Builder ───────────────────────────────────────────────────

export async function buildHomeModel(
  admin: AdminClient,
  leagueId: string,
  userId: string,
): Promise<HomeModel | null> {
  const serverNow = new Date().toISOString();

  const { data: league } = await admin
    .from('leagues')
    .select(
      `id, name, status, season, current_season, previous_season, total_gameweeks,
       roster_size, taxi_size, taxi_age_limit, retained_slots, prize_config,
       merit_win, merit_draw, merit_loss, merit_bye, free_agent_bid_floor`,
    )
    .eq('id', leagueId)
    .single();
  if (!league) return null;

  const { data: myTeamRow } = await admin
    .from('teams')
    .select('id, team_name, abbreviation, crest_config, faab_budget, user_id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .single();
  if (!myTeamRow) return null;

  const myTeamId = myTeamRow.id as string;
  const season = (league.current_season ?? league.season) as string;
  const totalGameweeks = (league.total_gameweeks as number) ?? 38;

  const fpl = await getFplStatus();
  const gameweek = fpl.currentGw;

  const [
    teamsRes,
    standingsRes,
    matchupsRes,
    tournamentsRes,
    auctionsRes,
    departuresRes,
    offersRes,
    listingsRes,
    rosterRes,
    txRes,
    archiveStandingsRes,
    archiveCupsRes,
    archiveMatchupsRes,
  ] = await Promise.all([
    admin
      .from('teams')
      .select('id, team_name, abbreviation, crest_config, faab_budget, user:users(id, username)')
      .eq('league_id', leagueId),
    admin
      .from('league_standings')
      .select('team_id, team_name, rank, league_points, wins, draws, losses, played, points_for')
      .eq('league_id', leagueId)
      .order('rank', { ascending: true }),
    admin
      .from('matchups')
      .select('id, gameweek, team_a_id, team_b_id, score_a, score_b, status, lineup_a, lineup_b')
      .eq('league_id', leagueId)
      .order('gameweek', { ascending: true }),
    admin.from('tournaments').select('id, name, type, status').eq('league_id', leagueId),
    admin
      .from('auction_state')
      .select(
        'player_id, kind, status, seller_team_id, sale_listing_id, highest_bid, highest_bidder_team_id, bid_count, bids, expires_at',
      )
      .eq('league_id', leagueId)
      .eq('status', 'live'),
    admin
      .from('departure_decisions')
      .select('id, player_id, status, market_value_at_departure, compensation_offered, decide_by, reinstate_by')
      .eq('league_id', leagueId)
      .eq('team_id', myTeamId)
      .in('status', OPEN_STATUSES),
    admin
      .from('trade_proposals')
      .select('id, status, team_a_id')
      .eq('team_b_id', myTeamId)
      .eq('status', 'pending'),
    admin
      .from('player_sale_listings')
      .select('id, player_id, status, auction_expires_at')
      .eq('league_id', leagueId)
      .eq('seller_team_id', myTeamId)
      .in('status', ['pending', 'active']),
    admin
      .from('roster_entries')
      .select('player_id, status, player:players(id, web_name, name, primary_position, secondary_positions, pl_team, fpl_status, date_of_birth, market_value)')
      .eq('team_id', myTeamId),
    admin
      .from('transactions')
      .select('id, type, faab_bid, compensation_amount, notes, processed_at, team:teams(id, team_name), player:players(id, web_name, name, primary_position)')
      .eq('league_id', leagueId)
      .order('processed_at', { ascending: false })
      .limit(20),
    admin
      .from('season_standings_archive')
      .select('season, team_id, final_rank')
      .eq('league_id', leagueId),
    admin
      .from('season_cup_winners_archive')
      .select('season, tournament_name, winner_id')
      .eq('league_id', leagueId),
    admin
      .from('season_matchups_archive')
      .select('team_a_id, team_b_id, score_a, score_b, season, gameweek')
      .eq('league_id', leagueId),
  ]);

  const teams = (teamsRes.data ?? []) as any[];
  const standings = (standingsRes.data ?? []) as any[];
  const allMatchups = (matchupsRes.data ?? []) as MatchupLite[];
  const tournaments = (tournamentsRes.data ?? []) as any[];
  // A listing is a listing, not an auction, until someone actually bids on it —
  // the anchor seeded at creation (migration 080) holds the 14-day expiry clock,
  // but untouched listings must not show as live auctions on the home page.
  const rawLiveAuctions = (auctionsRes.data ?? []) as any[];
  const liveAuctions = rawLiveAuctions.filter(
    (a) => a.kind !== 'listing' || (a.bid_count ?? 0) > 0,
  );
  const departures = (departuresRes.data ?? []) as any[];
  const offers = (offersRes.data ?? []) as any[];
  const myListings = (listingsRes.data ?? []) as any[];
  const roster = (rosterRes.data ?? []) as any[];
  const transactions = (txRes.data ?? []) as any[];
  const archiveStandings = (archiveStandingsRes.data ?? []) as any[];
  const archiveCups = (archiveCupsRes.data ?? []) as any[];
  const archiveMatchups = (archiveMatchupsRes.data ?? []) as any[];

  const clubOf = (id: string | null | undefined): HomeClub => {
    const t = teams.find((x) => x.id === id);
    return {
      id: id ?? '',
      name: t?.team_name ?? 'Unknown',
      abbreviation: t?.abbreviation ?? null,
      crest: t?.crest_config ?? null,
      manager: t?.user?.username ?? null,
    };
  };

  const myClub = clubOf(myTeamId);
  const myStanding = standings.find((s) => s.team_id === myTeamId);
  const teamCount = teams.length || standings.length || 10;

  // ── phase ───────────────────────────────────────────────────
  const completed = allMatchups.filter((m) => m.status === 'completed');
  const myMatchups = allMatchups.filter(
    (m) => m.team_a_id === myTeamId || m.team_b_id === myTeamId,
  );
  const currentMine = myMatchups.find((m) => m.gameweek === gameweek) ?? null;
  const seasonOver =
    league.status === 'offseason' ||
    (allMatchups.length > 0 && allMatchups.every((m) => m.status === 'completed'));

  /**
   * Five phases, because the week has five.
   *
   *   live    — the deadline has passed and scores are moving
   *   ft      — the gameweek I am in has resolved; the result is fresh
   *   market  — that result is now days old and the next deadline is far
   *             away. This is the LONGEST phase of the week and the one the
   *             old page had nothing for: it kept showing a match report
   *             that had already been read.
   *   buildup — the next deadline is close enough to act on
   *   closed  — the season is over
   */
  const deadlinePassed =
    !!fpl.nextDeadline && new Date(fpl.nextDeadline).getTime() <= new Date(serverNow).getTime();

  let phase: HomePhase;
  if (seasonOver) {
    phase = 'closed';
  } else if (currentMine?.status === 'live') {
    phase = 'live';
  } else if (currentMine?.status === 'completed') {
    phase = 'ft';
  } else if (currentMine && !fpl.isFinished && deadlinePassed) {
    // Matches are under way but nothing has been scored into this fixture yet.
    phase = 'live';
  } else if (fpl.nextGwIsClose) {
    phase = 'buildup';
  } else {
    phase = 'market';
  }

  const lastCompletedMine =
    [...myMatchups].reverse().find((m) => m.status === 'completed') ?? null;

  // Build-up looks forward to the fixture you can still influence; the market
  // window looks back at the one that settled.
  const heroMatchup =
    phase === 'buildup'
      ? myMatchups.find((m) => m.gameweek === gameweek && m.status !== 'completed') ??
        myMatchups.find((m) => m.gameweek === gameweek + 1) ??
        myMatchups.find((m) => m.status === 'scheduled') ??
        currentMine
      : phase === 'market'
        ? lastCompletedMine ?? currentMine
        : currentMine ?? lastCompletedMine;

  // ── form + rank movement ────────────────────────────────────
  const formMap = new Map<string, ('W' | 'D' | 'L')[]>();
  for (const s of standings) {
    const results: ('W' | 'D' | 'L')[] = [];
    for (const m of [...completed].reverse()) {
      if (results.length >= 5) break;
      const r = resultFor(s.team_id, m);
      if (r) results.push(r);
    }
    formMap.set(s.team_id, results);
  }

  const latestCompletedGw = completed.length
    ? Math.max(...completed.map((m) => m.gameweek))
    : 0;
  const nowRanks = rankAsOf(completed, teams);
  const prevRanks = rankAsOf(
    completed.filter((m) => m.gameweek < latestCompletedGw),
    teams,
  );

  // ── the table ───────────────────────────────────────────────
  const table: TableRow[] = standings.map((s) => {
    const prev = prevRanks.get(s.team_id);
    const now = nowRanks.get(s.team_id) ?? s.rank;
    // Before a second gameweek exists there is no previous table to move from.
    const movement = latestCompletedGw > 1 && prev != null ? prev - now : 0;
    return {
      teamId: s.team_id,
      rank: s.rank,
      movement,
      club: clubOf(s.team_id),
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      pointsFor: Number(s.points_for).toLocaleString(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
      leaguePoints: s.league_points,
      form: formMap.get(s.team_id) ?? [],
      prize: money(computeSeasonPrize(s.rank, teamCount)),
      isMe: s.team_id === myTeamId,
    };
  });

  // ── merit block: what is riding on this week ────────────────
  const rates: MeritRates = {
    win: Number(league.merit_win ?? DEFAULT_MERIT_RATES.win),
    draw: Number(league.merit_draw ?? DEFAULT_MERIT_RATES.draw),
    loss: Number(league.merit_loss ?? DEFAULT_MERIT_RATES.loss),
    bye: Number(league.merit_bye ?? DEFAULT_MERIT_RATES.bye),
  };
  const periodIdx = periodIndexForGameweek(gameweek);
  let meritSoFar = 0;
  let meritGws: number[] = [];
  if (periodIdx != null) {
    meritGws = gameweeksInPeriod(periodIdx);
    const inPeriod = completed.filter(
      (m) => meritGws.includes(m.gameweek) && (m.team_a_id === myTeamId || m.team_b_id === myTeamId),
    );
    const rec = { wins: 0, draws: 0, losses: 0, byes: 0 };
    for (const m of inPeriod) {
      const r = resultFor(myTeamId, m);
      if (r === 'W') rec.wins++;
      else if (r === 'D') rec.draws++;
      else if (r === 'L') rec.losses++;
    }
    meritSoFar = computeMeritPayment(rec, rates);
  }

  // ── figures ─────────────────────────────────────────────────
  const myRank = myStanding?.rank ?? table.find((r) => r.isMe)?.rank ?? teamCount;
  const leader = table[0];
  const gapToLeader = leader ? leader.leaguePoints - (myStanding?.league_points ?? 0) : 0;
  const balance = Number(myTeamRow.faab_budget ?? 0);
  const richerThan = teams.filter((t) => Number(t.faab_budget ?? 0) < balance).length;
  const balanceRank = teams.length - richerThan;

  const recentForm = formMap.get(myTeamId) ?? [];
  let unbeaten = 0;
  for (const r of recentForm) {
    if (r === 'L') break;
    unbeaten++;
  }

  const figures: HomeFigure[] = seasonOver
    ? [
        { value: ordinal(myRank), stake: `Finished, of ${teamCount}` },
        {
          value: String(archiveCups.filter((c) => c.winner_id === myTeamId).length || '—'),
          stake: 'Trophies in the cabinet',
        },
        { value: money(computeSeasonPrize(myRank, teamCount)), stake: 'Placement prize' },
        { value: money(balance), stake: 'Club Balance', accent: true },
      ]
    : [
        {
          value: ordinal(myRank),
          stake:
            myRank === 1
              ? `${money(computeSeasonPrize(1, teamCount))} if it holds · top of the table`
              : `${money(computeSeasonPrize(myRank, teamCount))} if it holds · ${gapToLeader} behind ${leader?.club.name.split(' ')[0] ?? 'the leader'}`,
        },
        {
          value: `${myStanding?.wins ?? 0}-${myStanding?.draws ?? 0}-${myStanding?.losses ?? 0}`,
          stake: unbeaten >= 2 ? `Unbeaten in ${unbeaten}` : 'Won-drawn-lost',
        },
        {
          value: money1(meritSoFar),
          stake: meritGws.length
            ? `GW${meritGws[0]}–${meritGws[meritGws.length - 1]} so far · ${money1(rates.win)} riding on this one`
            : 'Match revenue this block',
        },
        {
          value: money(balance),
          stake: `Club Balance · ${ordinal(balanceRank)}-richest`,
          accent: true,
        },
      ];

  // ── squad, availability and the XI ──────────────────────────
  const rosterPlayers = roster.map((r) => ({ ...r, player: r.player })).filter((r) => r.player);
  const playerById = new Map<string, any>();
  for (const r of rosterPlayers) playerById.set(r.player.id, r.player);

  // ── top performers, league-wide ────────────────────────────
  // The five highest fantasy-point scores of the most recently completed
  // gameweek, whoever owns them. Not actionable, but it's the one thing
  // every manager in the league experienced this week.
  const topPerformersGw = lastCompletedMine?.gameweek ?? null;
  const topPerformers: TopPerformerRow[] = [];
  if (topPerformersGw) {
    const { data: rawPerf } = await admin
      .from('player_stats')
      .select(
        'fantasy_points, player:players!player_id(id, web_name, name, primary_position, pl_team)',
      )
      .eq('gameweek', topPerformersGw)
      .eq('season', season)
      .order('fantasy_points', { ascending: false })
      .limit(5);

    const perfRows = (rawPerf ?? []) as any[];
    const perfPlayerIds = perfRows.map((r) => r.player?.id).filter(Boolean);
    // Must scope to this league's teams — the same player is rostered in every
    // test/militia league too, and an unfiltered lookup picks whichever row
    // PostgREST returns first (Bot FC 4, Tea FC, …).
    const leagueTeamIds = teams.map((t) => t.id as string);
    const { data: ownerRows } =
      perfPlayerIds.length && leagueTeamIds.length
        ? await admin
            .from('roster_entries')
            .select('player_id, team:teams(team_name)')
            .in('player_id', perfPlayerIds)
            .in('team_id', leagueTeamIds)
        : { data: [] as any[] };
    const ownerByPlayer = new Map<string, string>();
    for (const o of ownerRows ?? []) {
      if (!ownerByPlayer.has(o.player_id)) {
        ownerByPlayer.set(o.player_id, (o.team as any)?.team_name ?? 'Free agent');
      }
    }

    for (const r of perfRows) {
      const p = r.player;
      if (!p) continue;
      topPerformers.push({
        playerId: p.id,
        name: getPlayerDisplayName(p, 'full'),
        position: p.primary_position,
        club: p.pl_team ?? '',
        points: Number(r.fantasy_points ?? 0).toFixed(2),
        owner: ownerByPlayer.get(p.id) ?? 'Free agent',
      });
    }
  }

  const heroGameweek = heroMatchup?.gameweek ?? gameweek;

  /**
   * Has the fixture on show actually been played?
   *
   * This is a separate question from the phase. Before GW1 — and in any week
   * where the league's schedule and FPL's gameweek disagree — the page can be
   * in the market phase while the fixture it is showing has not kicked off.
   * Framing that as "settled" would state something false, and it is also the
   * moment a manager most wants the readiness strip.
   */
  const heroPlayed =
    !!heroMatchup && (heroMatchup.status === 'live' || heroMatchup.status === 'completed');

  /**
   * Who is locked, and who has a fixture at all.
   *
   * Two independent lockouts (§1): the FORMATION locks when any squad player's
   * match kicks off, but an individual PLAYER locks only when his own club
   * does. Both are read off `pl_fixtures` in one query rather than through
   * getLockedPlTeamIds, which resolves slugs back to seasonal FPL team ids via
   * a bootstrap fetch — ids this page has no use for, since it already knows
   * each player's club by name.
   *
   * A club with no row here has a blank gameweek, which is a different and
   * equally actionable problem from being injured.
   */
  const lockedSlugs = new Set<string>();
  const clubsWithFixture = new Set<string>();
  {
    const { data: plFixtures } = await admin
      .from('pl_fixtures')
      .select('home_club, away_club, kickoff_time')
      .eq('season', season)
      .eq('gameweek', heroGameweek);
    const nowMs = new Date(serverNow).getTime();
    for (const f of plFixtures ?? []) {
      clubsWithFixture.add(f.home_club);
      clubsWithFixture.add(f.away_club);
      if (f.kickoff_time && new Date(f.kickoff_time).getTime() <= nowMs) {
        lockedSlugs.add(f.home_club);
        lockedSlugs.add(f.away_club);
      }
    }
  }

  const slugFor = (plTeam: string | null | undefined): string | null => {
    if (!plTeam) return null;
    try {
      return resolveClub(plTeam)?.slug ?? null;
    } catch {
      return null;
    }
  };

  const heroLineupRaw =
    heroMatchup && heroMatchup.team_a_id === myTeamId
      ? (heroMatchup.lineup_a as any)
      : (heroMatchup?.lineup_b as any);

  const xi: XiSlot[] = [];
  const xiFlags: string[] = [];
  const coverGaps: CoverGap[] = [];
  const benchSummary: BenchPlayer[] = [];
  if (heroLineupRaw?.starters?.length) {
    for (const s of heroLineupRaw.starters) {
      const p = playerById.get(s.player_id);
      const name = p ? getPlayerDisplayName(p, 'initial_last') : 'Unknown';
      const slug = slugFor(p?.pl_team);
      const locked = slug ? lockedSlugs.has(slug) : false;
      const hasFixture = clubsWithFixture.size === 0 || (slug ? clubsWithFixture.has(slug) : true);
      const doubtful = p?.fpl_status && ['i', 'd', 's', 'u'].includes(p.fpl_status);

      let state: XiSlot['state'] = 'ok';
      let note: string | null = null;
      if (doubtful) {
        state = 'flag';
        note = p.fpl_status === 'i' ? 'injured' : p.fpl_status === 's' ? 'suspended' : 'doubtful';
      } else if (!hasFixture) {
        state = 'flag';
        note = 'no fixture';
      } else if (locked) {
        state = 'locked';
        note = 'locked';
      }
      xi.push({ slot: s.slot, playerId: s.player_id, name, state, note });
    }

    for (const slot of xi) {
      if (slot.state === 'flag' && slot.note) {
        xiFlags.push(`${slot.name} ${slot.note}`);
      }
    }

    /**
     * Bench cover.
     *
     * Eligibility is decided by POSITION_FLEX_MAP — the engine's OWN map,
     * imported rather than reimplemented, so this can never quietly disagree
     * with the auto-sub that actually runs. Today that map is exact-position
     * (`LB: ['LB']`), matched against a bench player's primary OR secondary.
     *
     * The four bench SLOTS are categories (DEF/MID/ATT/FLEX) and they decide
     * only where a player may sit, never what he can cover. That distinction
     * is the most common squad-building mistake in the guide, and it is
     * genuinely counter-intuitive: a bench CB sitting in the DEF slot does
     * not cover LB. So the model reports the bench itself alongside the gap,
     * because a bare verdict reads as a bug rather than as a rule.
     */
    const benchIds: string[] = (heroLineupRaw.bench ?? []).map((b: any) => b.player_id);
    for (const id of benchIds) {
      const p = playerById.get(id);
      if (!p) continue;
      benchSummary.push({
        name: getPlayerDisplayName(p, 'initial_last'),
        positions: [p.primary_position, ...(p.secondary_positions ?? [])].filter(
          Boolean,
        ) as string[],
      });
    }

    /**
     * A gap is only reported where the starter is ALSO at risk.
     *
     * Four bench slots cannot cover twelve positions, so uncovered slots are
     * the normal state of every squad in the league — reporting all of them
     * would flag five or six things every week, which is noise, and noise is
     * what makes a warning easy to disbelieve. The gap only costs points when
     * the starter records no minutes, so the useful signal is the
     * intersection: this man may not play, and nobody can replace him.
     */
    for (const s of xi) {
      if (s.state !== 'flag') continue;
      // SAFETY: lineup slots are always one of the 12 GranularPosition values, never an arbitrary string.
      const eligible = POSITION_FLEX_MAP[s.slot as GranularPosition] ?? [s.slot];
      const covered = benchSummary.some((b) => b.positions.some((pos) => eligible.includes(pos)));
      if (!covered) coverGaps.push({ slot: s.slot, starter: s.name });
    }
  }

  const lockedCount = xi.filter((s) => s.state === 'locked').length;
  const xiSummary = xi.length
    ? `${lockedCount} locked, ${xi.length - lockedCount} still yours to change`
    : 'No lineup saved yet';

  // ── attention ───────────────────────────────────────────────
  const attention: AttentionItem[] = [];
  const base = `/league/${leagueId}`;
  const FAR = Number.MAX_SAFE_INTEGER;

  const lineupIncomplete =
    !heroLineupRaw ||
    !Array.isArray(heroLineupRaw.starters) ||
    heroLineupRaw.starters.length !== 11 ||
    heroLineupRaw.starters.some((s: any) => !s.player_id);

  if (!heroPlayed && lineupIncomplete) {
    attention.push({
      id: 'lineup',
      tag: 'Lineup',
      tone: 'warn',
      text: 'Your XI is not set — last week’s carries forward and it won’t know about this week’s injuries',
      when: countdown(serverNow, fpl.nextDeadline),
      whenAt: fpl.nextDeadline,
      action: 'Set XI',
      href: `${base}/team`,
      order: fpl.nextDeadline ? new Date(fpl.nextDeadline).getTime() : FAR,
    });
  } else if (!heroPlayed && xiFlags.length) {
    attention.push({
      id: 'lineup-flags',
      tag: 'Lineup',
      tone: 'warn',
      text: xiFlags.slice(0, 2).join(' · '),
      when: countdown(serverNow, fpl.nextDeadline),
      whenAt: fpl.nextDeadline,
      action: 'Review XI',
      href: `${base}/team`,
      order: fpl.nextDeadline ? new Date(fpl.nextDeadline).getTime() : FAR,
    });
  }

  // IR gates BIDDING, not roster space — a fit player sitting on IR blocks
  // every bid you try to place, and nothing else in the app surfaces that.
  const blockedByIr = rosterPlayers.find(
    (r) => r.status === 'ir' && r.player?.fpl_status === 'a',
  );
  if (blockedByIr) {
    attention.push({
      id: 'ir',
      tag: 'Bids',
      tone: 'warn',
      text: `${getPlayerDisplayName(blockedByIr.player, 'initial_last')} is fit on IR — every bid you place is blocked`,
      when: 'Now',
      whenAt: null,
      action: 'Move',
      href: `${base}/team/roster`,
      order: 0,
    });
  }

  // Auctions where you have bid and are no longer top.
  for (const a of liveAuctions) {
    const bids = Array.isArray(a.bids) ? a.bids : [];
    const iBid = bids.some((b: any) => b.team_id === myTeamId);
    if (!iBid || a.highest_bidder_team_id === myTeamId) continue;
    const p = playerById.get(a.player_id);
    attention.push({
      id: `outbid-${a.player_id}`,
      tag: 'Bid',
      tone: 'warn',
      text: `Outbid on ${p ? getPlayerDisplayName(p, 'initial_last') : 'a player'} at ${money(Number(a.highest_bid))}`,
      when: countdown(serverNow, a.expires_at),
      whenAt: a.expires_at,
      action: 'Raise',
      href: `${base}/transfers/auctions`,
      order: a.expires_at ? new Date(a.expires_at).getTime() : FAR,
    });
  }

  if (offers.length) {
    attention.push({
      id: 'offers',
      tag: 'Offers',
      tone: 'plain',
      // trade_proposals has no expires_at — an offer sits pending forever.
      text: `${offers.length === 1 ? 'One offer' : `${offers.length} offers`} waiting on your answer`,
      when: 'No clock',
      whenAt: null,
      action: 'Review',
      href: `${base}/transfers/deals`,
      order: FAR - 2,
    });
  }

  for (const d of departures.filter((x) => x.status === 'pending')) {
    const p = playerById.get(d.player_id);
    const comp = Number(d.compensation_offered ?? 0);
    attention.push({
      id: `dep-${d.id}`,
      tag: 'Departure',
      tone: 'warn',
      text: `${p ? getPlayerDisplayName(p, 'initial_last') : 'A player'} has left the Premier League — release for ${money(comp)} or retain his rights`,
      when: countdown(serverNow, d.decide_by),
      whenAt: d.decide_by,
      action: 'Decide',
      href: `${base}/team/roster`,
      order: d.decide_by ? new Date(d.decide_by).getTime() : FAR - 1,
    });
  }

  for (const l of myListings.filter((x) => x.auction_expires_at)) {
    const p = playerById.get(l.player_id);
    attention.push({
      id: `listing-${l.id}`,
      tag: 'Listing',
      tone: 'plain',
      text: `Your listing for ${p ? getPlayerDisplayName(p, 'initial_last') : 'a player'} closes`,
      when: countdown(serverNow, l.auction_expires_at),
      whenAt: l.auction_expires_at,
      action: 'Manage',
      href: `${base}/transfers/listings`,
      order: new Date(l.auction_expires_at).getTime(),
    });
  }

  // Academy age-out: an age threshold, not a clock, so it has no countdown.
  const ageLimit = Number(league.taxi_age_limit ?? 21);
  for (const r of rosterPlayers.filter((x) => x.status === 'taxi')) {
    if (!r.player?.date_of_birth) continue;
    const dob = new Date(r.player.date_of_birth);
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age >= ageLimit) {
      attention.push({
        id: `academy-${r.player.id}`,
        tag: 'Academy',
        tone: 'plain',
        text: `${getPlayerDisplayName(r.player, 'initial_last')} ages out of the Academy`,
        when: 'Season end',
        whenAt: null,
        action: 'Review',
        href: `${base}/team/roster`,
        order: FAR - 3,
      });
    }
  }

  attention.sort((a, b) => a.order - b.order);

  // ── the hero fixture ────────────────────────────────────────
  let fixture: HomeFixtureModel | null = null;
  let debrief: DebriefItem[] = [];
  let matchReportHeadline: string | null = null;
  let matchReportByline: string | null = null;

  if (heroMatchup) {
    const iAmA = heroMatchup.team_a_id === myTeamId;
    const oppId = iAmA ? heroMatchup.team_b_id : heroMatchup.team_a_id;
    const mineScore = Number(iAmA ? heroMatchup.score_a : heroMatchup.score_b) || 0;
    const theirScore = Number(iAmA ? heroMatchup.score_b : heroMatchup.score_a) || 0;
    const hasScores = heroMatchup.status !== 'scheduled' || mineScore > 0 || theirScore > 0;
    const settled = phase === 'ft' || phase === 'market' || heroMatchup.status === 'completed';
    const margin = mineScore - theirScore;
    const mag = Math.abs(margin);
    const inBand = mag <= DRAW_BAND;

    let verdict: string;
    let outcome: HomeFixtureModel['outcome'];
    if (!hasScores) {
      verdict = '';
      outcome = 'drawn';
    } else if (inBand) {
      outcome = 'drawn';
      verdict = settled
        ? `Drawn · ${mag.toFixed(2)} apart, inside the ten-point band`
        : margin >= 0
          ? `Drawn · ${(DRAW_BAND - mag).toFixed(2)} more and you win`
          : `Drawn · ${(DRAW_BAND - mag).toFixed(2)} from a defeat`;
    } else if (margin > 0) {
      outcome = 'ahead';
      verdict = `${settled ? 'Won by' : 'You lead by'} ${mag.toFixed(2)} · ${(mag - DRAW_BAND).toFixed(2)} clear of the band`;
    } else {
      outcome = 'behind';
      verdict = `${settled ? 'Lost by' : 'Behind by'} ${mag.toFixed(2)} · ${(mag - DRAW_BAND).toFixed(2)} outside the band`;
    }

    const oppStanding = standings.find((s) => s.team_id === oppId);
    const markerPct = Math.min(98, Math.max(2, 50 - (margin / 40) * 50));

    fixture = {
      matchupId: heroMatchup.id,
      gameweek: heroMatchup.gameweek,
      when: !heroPlayed
        ? `Matchweek ${heroMatchup.gameweek} · locks ${countdown(serverNow, fpl.nextDeadline)}`
        : heroMatchup.status === 'completed'
          ? `Matchweek ${heroMatchup.gameweek} · full time`
          : `Matchweek ${heroMatchup.gameweek}`,
      home: myClub,
      away: clubOf(oppId),
      homeMeta: `${ordinal(myRank)} · ${myStanding?.wins ?? 0}-${myStanding?.draws ?? 0}-${myStanding?.losses ?? 0}`,
      awayMeta: oppStanding
        ? `${ordinal(oppStanding.rank)} · ${oppStanding.wins}-${oppStanding.draws}-${oppStanding.losses}`
        : '',
      hasScores,
      homeScore: hasScores ? mineScore : null,
      awayScore: hasScores ? theirScore : null,
      margin,
      verdict,
      outcome,
      markerPct,
      stillToPlay: { mine: 0, theirs: 0 },
      topMine: null,
      topTheirs: null,
      cupLine: null,
    };

    // ── your gameweek + the debrief ───────────────────────────
    // Both come from the same scoring call the matchup itself uses, so the
    // explanation can never disagree with the score it is explaining.
    if (hasScores && heroLineupRaw?.starters?.length) {
      const lineupIds: string[] = [
        ...heroLineupRaw.starters.map((s: any) => s.player_id),
        ...((heroLineupRaw.bench ?? []).map((b: any) => b.player_id) as string[]),
      ].filter(Boolean);

      const { data: statRows } = await admin
        .from('player_stats')
        .select('player_id, fantasy_points, match_rating, stats, gameweek, season')
        .eq('season', season)
        .eq('gameweek', heroMatchup.gameweek)
        .in('player_id', lineupIds);

      const rows = (statRows ?? []) as any[];
      const record = new Map<string, PlayerScoreRecord>();
      for (const r of rows) {
        const entry = record.get(r.player_id) ?? { fixtures: [] };
        entry.fixtures.push({
          minutes: Number(r.stats?.minutes_played ?? 0),
          fantasyPoints: Number(r.fantasy_points ?? 0),
          stats: r.stats ?? null,
        });
        record.set(r.player_id, entry);
      }

      const positions = new Map<string, string[]>();
      for (const id of lineupIds) {
        const p = playerById.get(id);
        positions.set(
          id,
          [p?.primary_position, ...(p?.secondary_positions ?? [])].filter(Boolean) as string[],
        );
      }

      const detail = emptyTeamScoreDetail();
      try {
        const refStats = await loadReferenceStats(admin, season);
        calculateTeamScore(
          heroLineupRaw,
          record,
          positions,
          new Map(),
          refStats,
          settled,
          new Set(),
          detail,
        );
      } catch {
        // Reference stats are the only failure path here and they are a
        // presentation nicety; the score itself is already stored.
      }

      const blanked = detail.blanked.length;
      if (settled) {
        debrief = [
          { value: String(detail.subs.length), label: detail.subs.length === 1 ? 'auto-sub fired' : 'auto-subs fired' },
          { value: String(blanked), label: blanked === 1 ? 'starter blanked' : 'starters blanked' },
          { value: `+${detail.benchBonusTotal.toFixed(2)}`, label: 'bench depth bonus' },
          {
            value: String(detail.outOfPosition.length),
            label: detail.outOfPosition.length === 1 ? 'out-of-position penalty' : 'out-of-position penalties',
          },
        ];
      }

      // Still to play: a starter with no stat row for this gameweek has not
      // been scored yet.
      const played = new Set(rows.map((r) => r.player_id));
      fixture.stillToPlay.mine = heroLineupRaw.starters.filter(
        (s: any) => !played.has(s.player_id),
      ).length;

      /**
       * The generated match report headline.
       *
       * `matchReport.ts` has existed since long before this page and never
       * appeared anywhere except the matchup detail screen. It is the one
       * moment where a result reads as an event rather than a number, so it
       * is worth the two extra queries — and they only fire at full time,
       * not on every render of every phase.
       */
      if (phase === 'ft') {
        const theirLineup = (iAmA ? heroMatchup.lineup_b : heroMatchup.lineup_a) as any;
        const theirIds: string[] = [
          ...((theirLineup?.starters ?? []).map((s: any) => s.player_id) as string[]),
          ...((theirLineup?.bench ?? []).map((b: any) => b.player_id) as string[]),
        ].filter(Boolean);

        if (theirIds.length) {
          const [{ data: theirPlayers }, { data: theirStats }] = await Promise.all([
            admin
              .from('players')
              .select('id, web_name, name, primary_position, pl_team')
              .in('id', theirIds),
            admin
              .from('player_stats')
              .select('player_id, fantasy_points, stats')
              .eq('season', season)
              .eq('gameweek', heroMatchup.gameweek)
              .in('player_id', theirIds),
          ]);

          const playerMap: Record<string, any> = {};
          for (const [id, p] of playerById.entries()) playerMap[id] = p;
          for (const p of theirPlayers ?? []) playerMap[p.id] = p;

          const detailMap: Record<string, { points: number; stats?: any }> = {};
          for (const r of [...rows, ...((theirStats ?? []) as any[])]) {
            const prev = detailMap[r.player_id]?.points ?? 0;
            detailMap[r.player_id] = {
              points: prev + Number(r.fantasy_points ?? 0),
              stats: r.stats ?? undefined,
            };
          }

          try {
            const { generateMatchReport } = await import('@/lib/narrative/matchReport');
            const report = generateMatchReport(
              {
                ...heroMatchup,
                team_a: { team_name: clubOf(heroMatchup.team_a_id).name },
                team_b: { team_name: clubOf(heroMatchup.team_b_id).name },
              },
              heroMatchup.lineup_a,
              heroMatchup.lineup_b,
              playerMap,
              detailMap,
              // This call only ever fires at 'ft' (see comment above), so the
              // persisted score is already the final word — no live recompute
              // needed here the way the matchup detail page needs one.
              Number(heroMatchup.score_a) || 0,
              Number(heroMatchup.score_b) || 0,
            );
            // The generator marks emphasis with **...**; the hero renders the
            // headline as plain serif, so the markers come out here.
            matchReportHeadline = report.headline.replace(/\*\*/g, '');
            matchReportByline = report.byline ?? null;
          } catch {
            // A missing report is a missing flourish, never a broken page.
          }
        }
      }
    }

    // ── cups: the fixture, not a status noun ──────────────────
    const tourneyIds = tournaments.map((t) => t.id);
    if (tourneyIds.length) {
      const { data: rounds } = await admin
        .from('tournament_rounds')
        .select('id, tournament_id, name, round_number, start_gameweek, end_gameweek, is_two_leg')
        .in('tournament_id', tourneyIds);
      const activeRounds = (rounds ?? []).filter(
        (r: any) => r.start_gameweek <= heroMatchup.gameweek && r.end_gameweek >= heroMatchup.gameweek,
      );
      if (activeRounds.length) {
        const { data: ties } = await admin
          .from('tournament_matchups')
          .select('round_id, team_a_id, team_b_id')
          .in('round_id', activeRounds.map((r: any) => r.id));
        const mine = (ties ?? []).find(
          (t: any) => t.team_a_id === myTeamId || t.team_b_id === myTeamId,
        );
        if (mine) {
          const round = activeRounds.find((r: any) => r.id === mine.round_id);
          const comp = tournaments.find((t) => t.id === round?.tournament_id);
          const oppCup = clubOf(mine.team_a_id === myTeamId ? mine.team_b_id : mine.team_a_id);
          const leg = round?.is_two_leg
            ? heroMatchup.gameweek === round.start_gameweek
              ? ', first leg'
              : ', second leg'
            : '';
          fixture.cupLine = `${comp?.name ?? 'Cup'} ${round?.name?.toLowerCase() ?? 'tie'}${leg} against ${oppCup.name}. Cups never draw — a level tie goes to the best individual performer.`;
        }
      }
    }
  }

  // ── the secondary fixture ───────────────────────────────────
  // Whichever the phase machine did not pick is still one tap away: full
  // time and the market window no longer hide next week, and build-up no
  // longer hides last week's result.
  let secondaryKind: 'result' | 'preview' | null = null;
  let secondaryFixture: HomeFixtureModel | null = null;
  let secondaryPlayed = false;
  const secondaryXi: XiSlot[] = [];
  const secondaryXiFlags: string[] = [];
  let secondaryXiSummary = '';
  const secondaryCoverGaps: CoverGap[] = [];
  const secondaryBenchSummary: BenchPlayer[] = [];
  let secondaryDebrief: DebriefItem[] = [];

  const upcomingMine =
    myMatchups.find((m) => m.gameweek === gameweek && m.status !== 'completed') ??
    myMatchups.find((m) => m.gameweek === gameweek + 1) ??
    myMatchups.find((m) => m.status === 'scheduled') ??
    null;

  const secondaryMatchup =
    (phase === 'ft' || phase === 'market') && upcomingMine && upcomingMine.id !== heroMatchup?.id
      ? upcomingMine
      : phase === 'buildup' && lastCompletedMine && lastCompletedMine.id !== heroMatchup?.id
        ? lastCompletedMine
        : null;

  if (secondaryMatchup) {
    secondaryKind = secondaryMatchup.status === 'completed' ? 'result' : 'preview';

    const iAmA = secondaryMatchup.team_a_id === myTeamId;
    const oppId = iAmA ? secondaryMatchup.team_b_id : secondaryMatchup.team_a_id;
    const mineScore = Number(iAmA ? secondaryMatchup.score_a : secondaryMatchup.score_b) || 0;
    const theirScore = Number(iAmA ? secondaryMatchup.score_b : secondaryMatchup.score_a) || 0;
    const hasScores = secondaryMatchup.status !== 'scheduled' || mineScore > 0 || theirScore > 0;
    const played = secondaryMatchup.status === 'live' || secondaryMatchup.status === 'completed';
    const settledSecondary = secondaryMatchup.status === 'completed';
    const margin = mineScore - theirScore;
    const mag = Math.abs(margin);
    const inBand = mag <= DRAW_BAND;

    let verdict: string;
    let outcome: HomeFixtureModel['outcome'];
    if (!hasScores) {
      verdict = '';
      outcome = 'drawn';
    } else if (inBand) {
      outcome = 'drawn';
      verdict = settledSecondary
        ? `Drawn · ${mag.toFixed(2)} apart, inside the ten-point band`
        : margin >= 0
          ? `Drawn · ${(DRAW_BAND - mag).toFixed(2)} more and you win`
          : `Drawn · ${(DRAW_BAND - mag).toFixed(2)} from a defeat`;
    } else if (margin > 0) {
      outcome = 'ahead';
      verdict = `${settledSecondary ? 'Won by' : 'You lead by'} ${mag.toFixed(2)} · ${(mag - DRAW_BAND).toFixed(2)} clear of the band`;
    } else {
      outcome = 'behind';
      verdict = `${settledSecondary ? 'Lost by' : 'Behind by'} ${mag.toFixed(2)} · ${(mag - DRAW_BAND).toFixed(2)} outside the band`;
    }

    const oppStanding = standings.find((s) => s.team_id === oppId);
    const markerPct = Math.min(98, Math.max(2, 50 - (margin / 40) * 50));

    secondaryPlayed = played;
    secondaryFixture = {
      matchupId: secondaryMatchup.id,
      gameweek: secondaryMatchup.gameweek,
      when: !played
        ? `Matchweek ${secondaryMatchup.gameweek} · locks ${countdown(serverNow, fpl.nextDeadline)}`
        : secondaryMatchup.status === 'completed'
          ? `Matchweek ${secondaryMatchup.gameweek} · full time`
          : `Matchweek ${secondaryMatchup.gameweek}`,
      home: myClub,
      away: clubOf(oppId),
      homeMeta: `${ordinal(myRank)} · ${myStanding?.wins ?? 0}-${myStanding?.draws ?? 0}-${myStanding?.losses ?? 0}`,
      awayMeta: oppStanding
        ? `${ordinal(oppStanding.rank)} · ${oppStanding.wins}-${oppStanding.draws}-${oppStanding.losses}`
        : '',
      hasScores,
      homeScore: hasScores ? mineScore : null,
      awayScore: hasScores ? theirScore : null,
      margin,
      verdict,
      outcome,
      markerPct,
      stillToPlay: { mine: 0, theirs: 0 },
      topMine: null,
      topTheirs: null,
      cupLine: null,
    };

    const secondaryLineupRaw = (iAmA ? secondaryMatchup.lineup_a : secondaryMatchup.lineup_b) as any;

    if (!played && secondaryLineupRaw?.starters?.length) {
      // Reuse the primary's lock state only when it shares this gameweek —
      // otherwise those locks belong to a different set of PL fixtures.
      let locked = lockedSlugs;
      let withFixture = clubsWithFixture;
      if (secondaryMatchup.gameweek !== heroGameweek) {
        const { data: plFixtures } = await admin
          .from('pl_fixtures')
          .select('home_club, away_club, kickoff_time')
          .eq('season', season)
          .eq('gameweek', secondaryMatchup.gameweek);
        locked = new Set();
        withFixture = new Set();
        const nowMs = new Date(serverNow).getTime();
        for (const pf of plFixtures ?? []) {
          withFixture.add(pf.home_club);
          withFixture.add(pf.away_club);
          if (pf.kickoff_time && new Date(pf.kickoff_time).getTime() <= nowMs) {
            locked.add(pf.home_club);
            locked.add(pf.away_club);
          }
        }
      }

      for (const s of secondaryLineupRaw.starters) {
        const p = playerById.get(s.player_id);
        const name = p ? getPlayerDisplayName(p, 'initial_last') : 'Unknown';
        const slug = slugFor(p?.pl_team);
        const isLocked = slug ? locked.has(slug) : false;
        const hasFixture = withFixture.size === 0 || (slug ? withFixture.has(slug) : true);
        const doubtful = p?.fpl_status && ['i', 'd', 's', 'u'].includes(p.fpl_status);

        let state: XiSlot['state'] = 'ok';
        let note: string | null = null;
        if (doubtful) {
          state = 'flag';
          note = p.fpl_status === 'i' ? 'injured' : p.fpl_status === 's' ? 'suspended' : 'doubtful';
        } else if (!hasFixture) {
          state = 'flag';
          note = 'no fixture';
        } else if (isLocked) {
          state = 'locked';
          note = 'locked';
        }
        secondaryXi.push({ slot: s.slot, playerId: s.player_id, name, state, note });
      }

      for (const slot of secondaryXi) {
        if (slot.state === 'flag' && slot.note) secondaryXiFlags.push(`${slot.name} ${slot.note}`);
      }

      const benchIds: string[] = (secondaryLineupRaw.bench ?? []).map((b: any) => b.player_id);
      for (const id of benchIds) {
        const p = playerById.get(id);
        if (!p) continue;
        secondaryBenchSummary.push({
          name: getPlayerDisplayName(p, 'initial_last'),
          positions: [p.primary_position, ...(p.secondary_positions ?? [])].filter(Boolean) as string[],
        });
      }

      for (const s of secondaryXi) {
        if (s.state !== 'flag') continue;
        const eligible = POSITION_FLEX_MAP[s.slot as GranularPosition] ?? [s.slot];
        const covered = secondaryBenchSummary.some((b) =>
          b.positions.some((pos) => eligible.includes(pos)),
        );
        if (!covered) secondaryCoverGaps.push({ slot: s.slot, starter: s.name });
      }

      const lockedCount = secondaryXi.filter((s) => s.state === 'locked').length;
      secondaryXiSummary = secondaryXi.length
        ? `${lockedCount} locked, ${secondaryXi.length - lockedCount} still yours to change`
        : 'No lineup saved yet';
    }

    if (settledSecondary && hasScores && secondaryLineupRaw?.starters?.length) {
      const lineupIds: string[] = [
        ...secondaryLineupRaw.starters.map((s: any) => s.player_id),
        ...((secondaryLineupRaw.bench ?? []).map((b: any) => b.player_id) as string[]),
      ].filter(Boolean);

      const { data: statRows } = await admin
        .from('player_stats')
        .select('player_id, fantasy_points, match_rating, stats, gameweek, season')
        .eq('season', season)
        .eq('gameweek', secondaryMatchup.gameweek)
        .in('player_id', lineupIds);

      const rows = (statRows ?? []) as any[];
      const record = new Map<string, PlayerScoreRecord>();
      for (const r of rows) {
        const entry = record.get(r.player_id) ?? { fixtures: [] };
        entry.fixtures.push({
          minutes: Number(r.stats?.minutes_played ?? 0),
          fantasyPoints: Number(r.fantasy_points ?? 0),
          stats: r.stats ?? null,
        });
        record.set(r.player_id, entry);
      }

      const positions = new Map<string, string[]>();
      for (const id of lineupIds) {
        const p = playerById.get(id);
        positions.set(
          id,
          [p?.primary_position, ...(p?.secondary_positions ?? [])].filter(Boolean) as string[],
        );
      }

      const detail = emptyTeamScoreDetail();
      try {
        const refStats = await loadReferenceStats(admin, season);
        calculateTeamScore(
          secondaryLineupRaw,
          record,
          positions,
          new Map(),
          refStats,
          settledSecondary,
          new Set(),
          detail,
        );
        const blanked = detail.blanked.length;
        secondaryDebrief = [
          {
            value: String(detail.subs.length),
            label: detail.subs.length === 1 ? 'auto-sub fired' : 'auto-subs fired',
          },
          { value: String(blanked), label: blanked === 1 ? 'starter blanked' : 'starters blanked' },
          { value: `+${detail.benchBonusTotal.toFixed(2)}`, label: 'bench depth bonus' },
          {
            value: String(detail.outOfPosition.length),
            label:
              detail.outOfPosition.length === 1 ? 'out-of-position penalty' : 'out-of-position penalties',
          },
        ];
      } catch {
        // Same presentation-only failure path as the primary debrief.
      }
    }
  }

  // The opponent as a person, for whichever fixture the secondary view shows.
  let secondaryOpponent: OpponentCard | null = null;
  if (secondaryFixture) {
    const oppId = secondaryFixture.away.id;
    const meetings = [
      ...archiveMatchups.map((m) => ({ ...m, live: false })),
      ...completed.map((m) => ({ ...m, live: true })),
    ].filter(
      (m) =>
        (m.team_a_id === myTeamId && m.team_b_id === oppId) ||
        (m.team_b_id === myTeamId && m.team_a_id === oppId),
    );
    let w = 0;
    let d = 0;
    let l = 0;
    for (const m of meetings) {
      const r = resultFor(myTeamId, m as MatchupLite);
      if (r === 'W') w++;
      else if (r === 'D') d++;
      else if (r === 'L') l++;
    }
    const previous = meetings
      .filter((m) => m.id !== secondaryMatchup?.id)
      .sort((a, b) => (b.gameweek ?? 0) - (a.gameweek ?? 0))[0];
    let lastMeeting = 'First meeting';
    if (previous) {
      const isA = previous.team_a_id === myTeamId;
      const mine = Number(isA ? previous.score_a : previous.score_b) || 0;
      const theirs = Number(isA ? previous.score_b : previous.score_a) || 0;
      const r = resultFor(myTeamId, previous as MatchupLite);
      lastMeeting = `${r === 'W' ? 'Won' : r === 'L' ? 'Lost' : 'Drew'} ${Math.round(mine)}–${Math.round(theirs)}`;
    }
    const title: string = !secondaryFixture.hasScores
      ? 'You play'
      : secondaryFixture.outcome === 'ahead'
        ? 'You beat'
        : secondaryFixture.outcome === 'behind'
          ? 'You lost to'
          : 'You drew with';

    secondaryOpponent = {
      club: secondaryFixture.away,
      record: `${w}-${d}-${l}`,
      lastMeeting,
      title,
    };
  }

  const preferSecondary = secondaryKind === 'preview' && fpl.nextGwIsClose;

  // ── fronts ──────────────────────────────────────────────────
  const fronts: FrontTile[] = [];
  fronts.push({
    competition: 'League',
    value: ordinal(myRank),
    sub:
      myRank === 1
        ? `Top of the table, ${table[1] ? (myStanding?.league_points ?? 0) - table[1].leaguePoints : 0} clear`
        : `${gapToLeader} behind ${leader?.club.name ?? 'the leader'}`,
    prize: `${seasonOver ? 'Paid' : 'Pays'} ${money(computeSeasonPrize(myRank, teamCount))}`,
    tone: 'plain',
  });

  /**
   * Cup prize money comes from the league's own config, falling back to
   * DEFAULT_PRIZE_CONFIG — never hardcoded here. These numbers move: the
   * 2026-08 pass took the Champions Cup from 40 to 50 and the other two from
   * 20 to 25, and a copy in this file would have quietly kept paying the old
   * figures on screen while the reset paid the new ones.
   */
  const prizeConfig: PrizeConfig = {
    ...DEFAULT_PRIZE_CONFIG,
    ...((league.prize_config as PrizeConfig | null) ?? {}),
  };
  const cupPrizes = {
    primary_cup: prizeConfig.champions_cup_winner,
    secondary_cup: prizeConfig.league_cup_winner,
    consolation_cup: prizeConfig.consolation_cup_winner,
  } satisfies Record<string, number>;
  for (const t of tournaments) {
    const won = archiveCups.some(
      (c) => c.tournament_name === t.name && c.winner_id === myTeamId && c.season === season,
    );
    fronts.push({
      competition: t.name,
      value: won ? 'Winners' : t.status === 'completed' ? 'Out' : 'In it',
      sub: won ? 'Champions' : t.status === 'completed' ? 'Knocked out' : 'Still alive',
      // SAFETY: t.type is always one of the three cup tournament types (see TournamentType in @/types).
      prize: `${seasonOver ? 'Paid' : 'Pays'} ${money(cupPrizes[t.type as keyof typeof cupPrizes] ?? 25)}`,
      tone: won ? 'won' : t.status === 'completed' ? 'out' : 'plain',
    });
  }

  // ── elsewhere in the matchweek ──────────────────────────────
  const matchweek: OtherFixture[] =
    phase === 'live' || phase === 'ft' || phase === 'market'
      ? allMatchups
          .filter(
            (m) =>
              m.gameweek === (heroMatchup?.gameweek ?? gameweek) &&
              m.id !== heroMatchup?.id &&
              m.team_a_id &&
              m.team_b_id,
          )
          .map((m) => {
            const a = Number(m.score_a) || 0;
            const b = Number(m.score_b) || 0;
            const shown = m.status !== 'scheduled';
            const drawn = shown && Math.abs(a - b) <= DRAW_BAND;
            return {
              id: m.id,
              home: clubOf(m.team_a_id),
              away: clubOf(m.team_b_id),
              homeScore: shown ? a : null,
              awayScore: shown ? b : null,
              tag: drawn ? 'Draw' : m.status === 'live' ? 'Live' : shown ? 'FT' : '',
              drawn,
              live: m.status === 'live',
            };
          })
      : [];

  // ── the market ──────────────────────────────────────────────
  const lotPlayerIds = liveAuctions.map((a) => a.player_id);
  const lotPlayers = new Map<string, any>();
  if (lotPlayerIds.length) {
    const { data: lp } = await admin
      .from('players')
      .select('id, web_name, name, primary_position, pl_team, market_value')
      .in('id', lotPlayerIds);
    for (const p of lp ?? []) lotPlayers.set(p.id, p);
  }

  const lotListingIds = liveAuctions.map((a) => a.sale_listing_id).filter(Boolean);
  const minBidByListing = new Map<string, number | null>();
  if (lotListingIds.length) {
    const { data: sl } = await admin
      .from('player_sale_listings')
      .select('id, min_bid')
      .in('id', lotListingIds);
    for (const l of sl ?? []) minBidByListing.set(l.id, l.min_bid);
  }

  const freeAgentBidFloor = Number(league.free_agent_bid_floor) || 0.5;

  const market: MarketLot[] = [...liveAuctions]
    .sort((a, b) => {
      const at = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
      const bt = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
      return at - bt;
    })
    .slice(0, 5)
    .map((a) => {
      const p = lotPlayers.get(a.player_id);
      const bids = Array.isArray(a.bids) ? a.bids : [];
      const isMine = a.seller_team_id === myTeamId;
      const leading = a.highest_bidder_team_id === myTeamId;
      const outbid = !leading && bids.some((b: any) => b.team_id === myTeamId);
      const holderClub = a.highest_bidder_team_id ? clubOf(a.highest_bidder_team_id) : null;
      const sellerClub = a.seller_team_id ? clubOf(a.seller_team_id) : null;
      const highest = Number(a.highest_bid ?? 0);
      const listingMinBid = a.sale_listing_id ? minBidByListing.get(a.sale_listing_id) : undefined;
      const marketVal = Number(p?.market_value ?? 0);
      const floorVal = listingMinBid != null ? listingMinBid : Math.floor(marketVal * freeAgentBidFloor);
      const next = highest > 0 ? highest + 1 : floorVal;

      return {
        playerId: a.player_id,
        name: p ? getPlayerDisplayName(p, 'initial_last') : 'Unknown player',
        position: p?.primary_position ?? '',
        meta: `${p?.pl_team ?? ''}${sellerClub ? ` · ${sellerClub.name}` : ' · free agent'}`,
        bid: highest > 0 ? money(highest) : 'No bids',
        floor: highest > 0 ? `from ${money(floorVal)}` : `floor ${money(floorVal)}`,
        hasBids: highest > 0,
        holder: isMine
          ? 'Your lot'
          : leading
            ? `You lead · ${a.bid_count} ${a.bid_count === 1 ? 'bid' : 'bids'}`
            : holderClub
              ? `${holderClub.name.split(' ')[0]} lead · ${a.bid_count} ${a.bid_count === 1 ? 'bid' : 'bids'}`
              : 'No bids yet',
        expiresAt: a.expires_at,
        leading,
        outbid,
        isMine,
        nextBid: money(next),
        href: `${base}/transfers/auctions`,
      };
    });

  const closingToday = liveAuctions.filter(
    (a) =>
      a.expires_at &&
      new Date(a.expires_at).getTime() - new Date(serverNow).getTime() < 24 * 3600 * 1000,
  ).length;
  const iLead = liveAuctions.filter((a) => a.highest_bidder_team_id === myTeamId).length;
  const marketSummary = liveAuctions.length
    ? `${liveAuctions.length} ${liveAuctions.length === 1 ? 'lot' : 'lots'} live · ${closingToday} closing today · you lead ${iLead}`
    : 'Nothing on the board right now';

  const richest = [...teams].sort(
    (a, b) => Number(b.faab_budget ?? 0) - Number(a.faab_budget ?? 0),
  )[0];
  const marketBudget =
    richest && richest.id !== myTeamId
      ? `${money(balance)} to spend · ${richest.team_name.split(' ')[0]} hold ${money(Number(richest.faab_budget ?? 0))}`
      : `${money(balance)} to spend · the most in the league`;

  // ── the wire ────────────────────────────────────────────────
  // A single auction/drop can fan out one solidarity_payment row per recipient club, all
  // with identical notes/timing — collapse those into one Wire entry so the feed doesn't
  // read as spam.
  const seenSolidarityNotes = new Set<string>();
  const dedupedTransactions = transactions.filter((tx) => {
    if (tx.type !== 'solidarity_payment') return true;
    if (seenSolidarityNotes.has(tx.notes)) return false;
    seenSolidarityNotes.add(tx.notes);
    return true;
  });

  const wire: WireItem[] = dedupedTransactions.slice(0, 5).map((tx) => ({
    id: tx.id,
    text: generateTransactionHeadline({
      type: tx.type,
      faab_bid: tx.faab_bid,
      compensation_amount: tx.compensation_amount,
      notes: tx.notes,
      team: tx.team,
      player: tx.player,
    } as any),
    at: timeAgo(tx.processed_at, serverNow),
    tone: tx.type,
  }));

  // ── the opponent, as a person ───────────────────────────────
  let opponent: OpponentCard | null = null;
  if (fixture) {
    const oppId = fixture.away.id;
    const meetings = [
      ...archiveMatchups.map((m) => ({ ...m, live: false })),
      ...completed.map((m) => ({ ...m, live: true })),
    ].filter(
      (m) =>
        (m.team_a_id === myTeamId && m.team_b_id === oppId) ||
        (m.team_b_id === myTeamId && m.team_a_id === oppId),
    );
    let w = 0;
    let d = 0;
    let l = 0;
    for (const m of meetings) {
      const r = resultFor(myTeamId, m as MatchupLite);
      if (r === 'W') w++;
      else if (r === 'D') d++;
      else if (r === 'L') l++;
    }
    const previous = meetings
      .filter((m) => m.id !== heroMatchup?.id)
      .sort((a, b) => (b.gameweek ?? 0) - (a.gameweek ?? 0))[0];
    let lastMeeting = 'First meeting';
    if (previous) {
      const isA = previous.team_a_id === myTeamId;
      const mine = Number(isA ? previous.score_a : previous.score_b) || 0;
      const theirs = Number(isA ? previous.score_b : previous.score_a) || 0;
      const r = resultFor(myTeamId, previous as MatchupLite);
      lastMeeting = `${r === 'W' ? 'Won' : r === 'L' ? 'Lost' : 'Drew'} ${Math.round(mine)}–${Math.round(theirs)}`;
    }
    let title: string;
    if (!fixture.hasScores) {
      title = phase === 'live' ? 'You are playing' : 'You play';
    } else if (phase === 'live') {
      title =
        fixture.outcome === 'ahead'
          ? 'You lead'
          : fixture.outcome === 'behind'
            ? 'You trail'
            : 'You are playing';
    } else {
      title =
        fixture.outcome === 'ahead'
          ? 'You beat'
          : fixture.outcome === 'behind'
            ? 'You lost to'
            : 'You drew with';
    }

    opponent = {
      club: fixture.away,
      record: `${w}-${d}-${l}`,
      lastMeeting,
      title,
    };
  }

  // ── the dynasty block ───────────────────────────────────────
  const mySeasons = archiveStandings.filter((a) => a.team_id === myTeamId);
  const myTrophies = archiveCups.filter((c) => c.winner_id === myTeamId);
  const slotsUsed = departures.filter((d) =>
    SLOT_CONSUMING_STATUSES.includes(d.status),
  ).length;

  const clubFacts: ClubFact[] = [
    {
      label: 'Season',
      value: `${ordinal(mySeasons.length + 1)} of the dynasty`,
    },
    {
      label: 'Trophies',
      value: myTrophies.length
        ? myTrophies.map((t) => `${t.tournament_name} ${t.season}`).join(', ')
        : 'None yet',
      gold: myTrophies.length > 0,
    },
    {
      label: 'Finishes',
      value: mySeasons.length
        ? mySeasons
            .sort((a, b) => String(a.season).localeCompare(String(b.season)))
            .map((s) => ordinal(s.final_rank))
            .join(', ')
        : 'First season',
    },
    {
      label: 'Retained rights',
      value: `${slotsUsed} of ${league.retained_slots ?? 3} slots used`,
    },
  ];

  // ── close of season ─────────────────────────────────────────
  let closed: ClosedState | null = null;
  if (seasonOver) {
    const cupWins = archiveCups.filter((c) => c.winner_id === myTeamId && c.season === season);
    const resetRun = archiveStandings.some((a) => a.season === season);
    closed = {
      headline: cupWins.length
        ? `${ordinal(myRank)} of ${teamCount}, and the ${cupWins[0].tournament_name}`
        : `${ordinal(myRank)} of ${teamCount}`,
      sub: `${myStanding?.league_points ?? 0} pts · ${myStanding?.wins ?? 0}-${myStanding?.draws ?? 0}-${myStanding?.losses ?? 0}`,
      stages: [
        { name: 'Season complete', sub: 'All matchweeks and cups finished', done: true },
        {
          name: 'Reset run',
          sub: 'Records archived, prizes paid, balances untouched',
          done: resetRun,
        },
        {
          name: 'Kickoff pending',
          sub: 'Waiting on the Gaffa admin to seed the summer auctions',
          done: false,
        },
      ],
      prizes: money(computeSeasonPrize(myRank, teamCount)),
      prizeSub: `Placement ${money(computeSeasonPrize(myRank, teamCount))}${
        cupWins.length
          ? ` · ${cupWins
              .map((c) => {
                const t = tournaments.find((x) => x.name === c.tournament_name);
                // SAFETY: a missing/unmatched type falls through to the `?? 0` default below.
                return `${c.tournament_name} ${money(cupPrizes[(t?.type ?? '') as keyof typeof cupPrizes] ?? 0)}`;
              })
              .join(' · ')}`
          : ''
      }`,
      balance: money(balance),
      openDepartures: departures.filter((d) => d.status === 'pending').length,
    };
  }

  const subtitle = seasonOver
    ? `${league.name} · ${season} closed · managed by ${myClub.manager ?? 'you'}`
    : `${league.name} · Matchweek ${gameweek} of ${totalGameweeks} · managed by ${myClub.manager ?? 'you'}`;

  return {
    serverNow,
    phase,
    leagueId,
    leagueName: league.name as string,
    season,
    gameweek,
    totalGameweeks,
    club: myClub,
    subtitle,
    figures,
    attention,
    fixture,
    xi,
    xiFlags,
    xiSummary,
    coverGaps,
    benchSummary,
    heroPlayed,
    debrief,
    matchReportHeadline,
    matchReportByline,
    secondaryKind,
    secondaryFixture,
    secondaryPlayed,
    secondaryXi,
    secondaryXiFlags,
    secondaryXiSummary,
    secondaryCoverGaps,
    secondaryBenchSummary,
    secondaryDebrief,
    secondaryOpponent,
    preferSecondary,
    market,
    marketSummary,
    marketBudget,
    fronts,
    matchweek,
    table,
    topPerformers,
    topPerformersGw,
    wire,
    opponent,
    clubFacts,
    closed,
  };
}
