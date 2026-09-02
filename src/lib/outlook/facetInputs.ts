import type { SupabaseClient } from '@supabase/supabase-js';
import type { FacetInputs, MinutesSample } from '@futbolpedia/engine';
import type { GranularPosition } from '@/types';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
import { resolveClub } from '@/lib/clubs/registry';
import { fetchAllPages } from '@/lib/supabase/pagination';

/**
 * Gathers the structured inputs the engine's facet layer needs.
 *
 * Everything here is real match data — FPL's bootstrap and per-gameweek stats.
 * Gaffa's derived columns (`fantasy_points`, `match_rating`) are deliberately
 * absent: a facet wearing the Futbolpedia name has to be a football judgment,
 * not a statement about this league's point curve.
 */

/** A start is 60+ minutes. Cameos are appearances, not evidence of a role. */
const START_MINUTES = 60;
/** Minutes before a season's xGI/90 is stable enough to rank a player on. */
const XGI_MINUTES_FLOOR = 600;
/** Minutes before the current season can supply xGI/90 in place of the prior one. */
const XGI_CURRENT_PREFERRED_MINUTES = 900;

type PositionGroup = 'GK' | 'DEF' | 'MID' | 'ATT';

export function positionGroup(position: GranularPosition): PositionGroup {
  if (position === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position)) return 'DEF';
  if (['DM', 'CM', 'AM'].includes(position)) return 'MID';
  return 'ATT';
}

function priorSeasonOf(season: string): string {
  const start = Number(season.slice(0, 4));
  if (!Number.isFinite(start)) return season;
  return `${start - 1}-${String(start % 100).padStart(2, '0')}`;
}

function ageFrom(dateOfBirth: string | null, asOf: Date): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = asOf.getFullYear() - dob.getFullYear();
  const m = asOf.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < dob.getDate())) age--;
  return age;
}

interface SeasonAggregate {
  minutes: number;
  starts: number;
  appearances: number;
  xgi: number;
}

async function loadSeasonAggregates(
  admin: SupabaseClient,
  season: string,
): Promise<Map<string, SeasonAggregate>> {
  const rows = await fetchAllPages<{ player_id: string; stats: Record<string, unknown> | null }>(
    (from, to) =>
      admin.from('player_stats').select('player_id, stats').eq('season', season).range(from, to),
  );

  const out = new Map<string, SeasonAggregate>();
  for (const row of rows) {
    const s = row.stats ?? {};
    const mins = Number(s.minutes_played ?? 0);
    if (!Number.isFinite(mins)) continue;
    const agg = out.get(row.player_id) ?? { minutes: 0, starts: 0, appearances: 0, xgi: 0 };
    agg.minutes += mins;
    if (mins > 0) agg.appearances += 1;
    if (mins >= START_MINUTES) agg.starts += 1;
    agg.xgi += Number(s.expected_goals ?? 0) + Number(s.expected_assists ?? 0);
    out.set(row.player_id, agg);
  }
  return out;
}

/** Matches each club actually played, from the fixture list rather than a guess. */
async function loadClubMatchCounts(
  admin: SupabaseClient,
  season: string,
): Promise<Map<string, number>> {
  const rows = await fetchAllPages<{ home_club: string; away_club: string }>((from, to) =>
    admin
      .from('pl_fixtures')
      .select('home_club, away_club')
      .eq('season', season)
      .eq('finished', true)
      .range(from, to),
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    for (const club of [r.home_club, r.away_club]) {
      if (club) out.set(club, (out.get(club) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Club per player for a season.
 *
 * `player_season_clubs` is the archive and the only correct source for a PAST
 * season — `players.pl_team` is overwritten by every sync and would attribute
 * every summer transfer to the wrong club. For the CURRENT season, though, that
 * is exactly what pl_team describes, and the archive is not written until the
 * season is over: it holds 2025-26 and nothing else. So the current season
 * falls back to pl_team, which is the documented rule rather than an exception
 * to it. Without this the current-season sample is always null and the
 * early-season blending never runs.
 */
async function loadSeasonClubs(
  admin: SupabaseClient,
  season: string,
): Promise<Map<string, string>> {
  const rows = await fetchAllPages<{ player_id: string; club_slug: string }>((from, to) =>
    admin
      .from('player_season_clubs')
      .select('player_id, club_slug')
      .eq('season', season)
      .range(from, to),
  );
  return new Map(rows.map((r) => [r.player_id, r.club_slug]));
}

function currentSeasonClubs(players: PlayerRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of players) {
    const slug = resolveClub(p.pl_team)?.slug;
    if (slug) out.set(p.id, slug);
  }
  return out;
}

/**
 * Rank each player's xGI/90 against his own position group, as a 0–1 percentile.
 *
 * Position-relative because raw xGI/90 is nearly a pure function of position —
 * 2025-26 medians ran ATT 0.388, MID 0.208, DEF 0.112, GK 0.002. Ranking
 * globally would just re-encode the position filter.
 */
function percentileByPosition(
  values: Map<string, { value: number; group: PositionGroup }>,
): Map<string, number> {
  const byGroup = new Map<PositionGroup, number[]>();
  for (const { value, group } of values.values()) {
    const list = byGroup.get(group) ?? [];
    list.push(value);
    byGroup.set(group, list);
  }
  for (const list of byGroup.values()) list.sort((a, b) => a - b);

  const out = new Map<string, number>();
  for (const [playerId, { value, group }] of values) {
    const list = byGroup.get(group)!;
    if (list.length < 2) {
      out.set(playerId, 0.5);
      continue;
    }
    // Share of the group strictly below this player.
    let below = 0;
    for (const v of list) {
      if (v < value) below += 1;
      else break;
    }
    out.set(playerId, below / (list.length - 1));
  }
  return out;
}

export interface FacetInputBundle {
  inputs: Map<string, FacetInputs>;
  season: string;
  priorSeason: string;
}

interface PlayerRow {
  id: string;
  date_of_birth: string | null;
  primary_position: GranularPosition;
  pl_team: string | null;
  fpl_penalties_order: number | null;
  fpl_direct_fk_order: number | null;
  fpl_corners_order: number | null;
}

export async function loadFacetInputs(
  admin: SupabaseClient,
  options: { playerIds?: string[]; asOf?: Date } = {},
): Promise<FacetInputBundle> {
  const season = await getCurrentFplSeason();
  const priorSeason = priorSeasonOf(season);
  const asOf = options.asOf ?? new Date();

  // The whole active pool, ALWAYS — never narrowed to options.playerIds.
  // The xGI percentile is a rank against a player's position group, so scoping
  // the pool to the requested players computes the rank against them: asking
  // for one player returned "50th percentile" for everybody, the single-member
  // fallback wearing a real number's clothes. `playerIds` filters what is
  // RETURNED, at the end, not what the ranking is measured against.
  const players = await fetchAllPages<PlayerRow>((from, to) =>
    admin
      .from('players')
      .select(
        'id, date_of_birth, primary_position, pl_team, fpl_penalties_order, fpl_direct_fk_order, fpl_corners_order',
      )
      .eq('is_active', true)
      .range(from, to),
  );

  const wanted = options.playerIds?.length ? new Set(options.playerIds) : null;

  const [curAgg, priorAgg, archivedCurClubs, priorClubs, curMatches, priorMatches] =
    await Promise.all([
      loadSeasonAggregates(admin, season),
      loadSeasonAggregates(admin, priorSeason),
      loadSeasonClubs(admin, season),
      loadSeasonClubs(admin, priorSeason),
      loadClubMatchCounts(admin, season),
      loadClubMatchCounts(admin, priorSeason),
    ]);

  // Prefer the archive when it exists; fall back to today's club for the
  // current season, which is what pl_team actually means.
  const curClubs = archivedCurClubs.size > 0 ? archivedCurClubs : currentSeasonClubs(players);

  // Two percentile tables, one per season. A player is ranked inside the season
  // his xGI/90 actually came from, so the comparison stays like-for-like.
  const curXgi = new Map<string, { value: number; group: PositionGroup }>();
  const priorXgi = new Map<string, { value: number; group: PositionGroup }>();
  for (const p of players) {
    const group = positionGroup(p.primary_position);
    const c = curAgg.get(p.id);
    if (c && c.minutes >= XGI_MINUTES_FLOOR) {
      curXgi.set(p.id, { value: (c.xgi * 90) / c.minutes, group });
    }
    const pr = priorAgg.get(p.id);
    if (pr && pr.minutes >= XGI_MINUTES_FLOOR) {
      priorXgi.set(p.id, { value: (pr.xgi * 90) / pr.minutes, group });
    }
  }
  const curPct = percentileByPosition(curXgi);
  const priorPct = percentileByPosition(priorXgi);

  const sample = (
    agg: SeasonAggregate | undefined,
    club: string | undefined,
    matches: Map<string, number>,
  ): MinutesSample | null => {
    if (!agg || !club) return null;
    const teamMatches = matches.get(club) ?? 0;
    if (teamMatches <= 0) return null;
    return { starts: agg.starts, appearances: agg.appearances, team_matches: teamMatches };
  };

  const inputs = new Map<string, FacetInputs>();
  for (const p of players) {
    if (wanted && !wanted.has(p.id)) continue;
    const cur = curAgg.get(p.id);
    const preferCurrent = (cur?.minutes ?? 0) >= XGI_CURRENT_PREFERRED_MINUTES;
    const xgi_percentile =
      (preferCurrent ? curPct.get(p.id) : undefined) ??
      priorPct.get(p.id) ??
      curPct.get(p.id) ??
      null;

    inputs.set(p.id, {
      age: ageFrom(p.date_of_birth, asOf),
      primary_position: p.primary_position,
      current: sample(cur, curClubs.get(p.id), curMatches),
      prior: sample(priorAgg.get(p.id), priorClubs.get(p.id), priorMatches),
      xgi_percentile,
      penalties_order: p.fpl_penalties_order,
      direct_fk_order: p.fpl_direct_fk_order,
      corners_order: p.fpl_corners_order,
      // Nothing stores availability over time — `fpl_status` is overwritten on
      // every sync — so a genuine injury history cannot be reconstructed from
      // what exists. Left null so the injury_prone flag stays silent rather
      // than firing on a guess. Needs an availability history table to become
      // real; benching and injury are indistinguishable in the stats alone.
      injury_gameweeks: null,
    });
  }

  return { inputs, season, priorSeason };
}
