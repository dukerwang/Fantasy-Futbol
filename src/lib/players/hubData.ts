import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DynastyValue,
  MinutesRole,
  OutlookStyle,
  PlMobility,
  QualityTier,
  RiskFlag,
  SetPieceDuty,
} from '@futbolpedia/engine';
import type { OutlookCareerPhase } from '@futbolpedia/engine';
import type { Player, PlayerOwnership } from '@/types';
import { fetchPlayerFront } from '@/lib/players/cardData';
import { loadFacetInputs } from '@/lib/outlook/facetInputs';
import { fetchAllPages } from '@/lib/supabase/pagination';

/**
 * Everything the player hub renders, in the two layers the page is built on.
 *
 * The split is not presentational. `football` is real-world only and portable
 * back to Futbolpedia; `league` is Gaffa's scoring and never feeds the outlook.
 * Keeping them apart in the data shape is what stops a league artifact being
 * read as a football claim on the way to the screen.
 */

export interface HubScoutingReport {
  outlook: string;
  quality: QualityTier;
  minutes_role: MinutesRole;
  career_phase: OutlookCareerPhase;
  dynasty_value: DynastyValue;
  pl_mobility: PlMobility;
  risk_flags: RiskFlag[];
  style: OutlookStyle[];
  set_pieces: SetPieceDuty[];
  confidence: 'high' | 'medium' | 'low';
  evidence_gaps: string[];
  /** Generation date, shown on the panel. Prose beside live numbers must be pinned. */
  generatedAt: string;
  /** True when no outlook exists and the fact layer stood in. */
  fromFallback: boolean;
}

export interface HubRealWorldForm {
  season: string;
  minutes: number;
  starts: number;
  appearances: number;
  /** Share of appearances that were starts — role, independent of fitness. */
  startRate: number | null;
  goalContributions: number;
  xgiPer90: number | null;
  /**
   * Percentile within his own position group, or null for goalkeepers and
   * defenders — shown as a stat, never as a verdict, and not shown at all
   * where it says nothing. Elite centre-backs rank near the bottom of it.
   */
  xgiPercentile: number | null;
  setPieces: SetPieceDuty[];
}

export interface HubLeagueRecord {
  season: string;
  points: number;
  gamesPlayed: number;
  averageRating: number | null;
  pointsPerGame: number | null;
  ownership: PlayerOwnership | null;
}

export interface PlayerHubData {
  player: Player;
  football: { report: HubScoutingReport | null; form: HubRealWorldForm | null };
  league: HubLeagueRecord;
  /** Seasons this player actually has data for, newest first. */
  availableSeasons: string[];
  /** The season the two stat layers are showing. */
  season: string;
  /**
   * The club he played for in that season, from player_season_clubs — NOT
   * players.pl_team, which is overwritten by every sync and describes today.
   */
  seasonClub: string | null;
}

/** Positions whose job is attacking, and can fairly be ranked on attacking output. */
const RANKABLE_ON_ATTACK = new Set(['DM', 'CM', 'AM', 'LW', 'RW', 'ST']);

interface StoredOutlookRow {
  outlook: string;
  sidecar: Record<string, unknown> | null;
  generated_at: string;
}

function toReport(row: StoredOutlookRow | null): HubScoutingReport | null {
  if (!row?.outlook) return null;
  const s = (row.sidecar ?? {}) as Record<string, unknown>;
  return {
    outlook: row.outlook,
    quality: (s.quality as QualityTier) ?? 'solid',
    minutes_role: (s.minutes_role as MinutesRole) ?? 'rotation_risk',
    career_phase: (s.career_phase as OutlookCareerPhase) ?? 'unknown',
    dynasty_value: (s.dynasty_value as DynastyValue) ?? 'win_now',
    pl_mobility: (s.pl_mobility as PlMobility) ?? 'unknown',
    risk_flags: (s.risk_flags as RiskFlag[]) ?? [],
    style: (s.style as OutlookStyle[]) ?? [],
    set_pieces: (s.set_pieces as SetPieceDuty[]) ?? [],
    confidence: (s.confidence as 'high' | 'medium' | 'low') ?? 'medium',
    evidence_gaps: (s.evidence_gaps as string[]) ?? [],
    generatedAt: row.generated_at,
    fromFallback: s.from_fallback === true,
  };
}

export async function loadPlayerHub(
  admin: SupabaseClient,
  playerId: string,
  leagueId: string,
  requestedSeason?: string | null,
): Promise<PlayerHubData | null> {
  const front = await fetchPlayerFront(admin, playerId, leagueId, requestedSeason ?? null);
  if (!front) return null;
  const { player, ownership, season } = front;

  const [outlookRes, allStatRows, factBundle, seasonClubRows] = await Promise.all([
    admin
      .from('player_outlooks')
      .select('outlook, sidecar, generated_at')
      .eq('player_id', playerId)
      .maybeSingle(),
    fetchAllPages<{
      season: string;
      fantasy_points: number | null;
      match_rating: number | null;
      stats: Record<string, unknown> | null;
    }>((from, to) =>
      admin
        .from('player_stats')
        .select('season, fantasy_points, match_rating, stats')
        .eq('player_id', playerId)
        .range(from, to),
    ),
    loadFacetInputs(admin, { playerIds: [playerId] }),
    fetchAllPages<{ season: string; club_slug: string }>((from, to) =>
      admin
        .from('player_season_clubs')
        .select('season, club_slug')
        .eq('player_id', playerId)
        .range(from, to),
    ),
  ]);

  const availableSeasons = [...new Set(allStatRows.map((r) => r.season))].sort().reverse();
  const statRows = allStatRows.filter((r) => r.season === season);

  // --- league layer: Gaffa scoring, for the selected season ---
  let points = 0;
  let games = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  for (const row of statRows) {
    points += Number(row.fantasy_points ?? 0);
    const mins = Number((row.stats as { minutes_played?: number } | null)?.minutes_played ?? 0);
    if (mins > 0) games += 1;
    if (row.match_rating != null) {
      ratingSum += Number(row.match_rating);
      ratingCount += 1;
    }
  }

  // --- football layer: the measured record, from real match data ---
  const inputs = factBundle.inputs.get(playerId);
  const rankable = RANKABLE_ON_ATTACK.has(player.primary_position);

  const report = toReport((outlookRes.data as StoredOutlookRow | null) ?? null);

  // The real-world panel follows the same season the ledger is showing, so the
  // two layers never describe different years on one screen.
  let minutes = 0;
  let goalContributions = 0;
  let xgi = 0;
  for (const row of allStatRows) {
    if (row.season !== season) continue;
    const st = (row.stats ?? {}) as Record<string, unknown>;
    minutes += Number(st.minutes_played ?? 0);
    goalContributions += Number(st.goals ?? 0) + Number(st.assists ?? 0);
    xgi += Number(st.expected_goals ?? 0) + Number(st.expected_assists ?? 0);
  }

  const seasonSample = season === factBundle.season ? inputs?.current : inputs?.prior;
  const form: HubRealWorldForm | null =
    minutes > 0
      ? {
          season,
          minutes,
          starts: seasonSample?.starts ?? 0,
          appearances: seasonSample?.appearances ?? 0,
          startRate:
            seasonSample && seasonSample.appearances > 0
              ? seasonSample.starts / seasonSample.appearances
              : null,
          goalContributions,
          xgiPer90: (xgi * 90) / minutes,
          xgiPercentile: rankable ? (inputs?.xgi_percentile ?? null) : null,
          setPieces: report?.set_pieces ?? [],
        }
      : null;

  return {
    player,
    availableSeasons,
    season,
    seasonClub: seasonClubRows.find((r) => r.season === season)?.club_slug ?? null,
    football: { report, form },
    league: {
      season,
      points,
      gamesPlayed: games,
      averageRating: ratingCount > 0 ? ratingSum / ratingCount : null,
      pointsPerGame: games > 0 ? points / games : null,
      ownership,
    },
  };
}
