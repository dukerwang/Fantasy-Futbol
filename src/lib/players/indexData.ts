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
import { computeFallbackFacets, stylesFor } from '@futbolpedia/engine';
import { loadSeasonLeaderboard } from '@/lib/stats/seasonStats';
import { loadFacetInputs } from '@/lib/outlook/facetInputs';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { fetchAllPages } from '@/lib/supabase/pagination';

/**
 * The players index: the same pool the stats table has always shown, plus the
 * scouting layer the cards view is built on.
 *
 * The two layers stay separate here for the same reason they do on the hub —
 * `scout` is Futbolpedia's real-world read, the numeric fields are Gaffa
 * scoring, and nothing derives one from the other.
 */

export interface IndexScout {
  quality: QualityTier;
  minutes_role: MinutesRole;
  career_phase: OutlookCareerPhase;
  dynasty_value: DynastyValue;
  pl_mobility: PlMobility;
  risk_flags: RiskFlag[];
  style: OutlookStyle[];
  set_pieces: SetPieceDuty[];
  /** The opening sentence, which is what a card shows. */
  lede: string;
  /** True when no outlook exists and the fact layer stood in. */
  fromFallback: boolean;
}

export interface IndexPlayer {
  id: string;
  scout: IndexScout | null;
}

/** First sentence of the outlook — a card shows the lede, the hub the paragraph. */
function lede(outlook: string): string {
  const match = /^[^.!?]*[.!?]/.exec(outlook.trim());
  return (match ? match[0] : outlook).trim();
}

/**
 * Scout data for the whole pool, keyed by player id.
 *
 * Players without an outlook get the computed fallback rather than nothing:
 * 263 of the 335 priority players are in that state, so it is the common case.
 * Its facets carry `fromFallback`, and it deliberately has no `quality` of its
 * own — quality is a judgment, and guessing it from output is the mistake that
 * called an elite centre-back "limited".
 */
export async function loadScoutIndex(admin: SupabaseClient): Promise<Map<string, IndexScout>> {
  const [rows, factBundle, positions] = await Promise.all([
    fetchAllPages<{ player_id: string; outlook: string; sidecar: Record<string, unknown> | null }>(
      (from, to) =>
        admin.from('player_outlooks').select('player_id, outlook, sidecar').range(from, to),
    ),
    loadFacetInputs(admin),
    fetchAllPages<{ id: string; primary_position: string; secondary_positions: string[] | null }>(
      (from, to) =>
        admin
          .from('players')
          .select('id, primary_position, secondary_positions')
          .eq('is_active', true)
          .range(from, to),
    ),
  ]);

  const positionsById = new Map(positions.map((p) => [p.id, p]));

  const out = new Map<string, IndexScout>();

  for (const row of rows) {
    const s = (row.sidecar ?? {}) as Record<string, unknown>;
    // A sidecar written before v0.3 has no judged facets and cannot be read;
    // those players fall through to the computed layer below.
    if (typeof s.quality !== 'string') continue;
    out.set(row.player_id, {
      quality: s.quality as QualityTier,
      minutes_role: (s.minutes_role as MinutesRole) ?? 'rotation_risk',
      career_phase: (s.career_phase as OutlookCareerPhase) ?? 'unknown',
      dynasty_value: (s.dynasty_value as DynastyValue) ?? 'win_now',
      pl_mobility: (s.pl_mobility as PlMobility) ?? 'unknown',
      risk_flags: (s.risk_flags as RiskFlag[]) ?? [],
      // See hubData: stored rows predate the position-scoped vocabulary.
      style: ((s.style as OutlookStyle[]) ?? []).filter((v) => {
        const pos = positionsById.get(row.player_id);
        if (!pos) return true;
        return stylesFor(pos.primary_position, pos.secondary_positions ?? []).includes(v);
      }),
      set_pieces: (s.set_pieces as SetPieceDuty[]) ?? [],
      lede: lede(row.outlook),
      fromFallback: false,
    });
  }

  for (const [playerId, inputs] of factBundle.inputs) {
    if (out.has(playerId)) continue;
    const f = computeFallbackFacets(inputs);
    out.set(playerId, {
      // Not judged, so not claimed. The card shows no quality chip for these.
      quality: 'solid',
      minutes_role: f.minutes_role,
      career_phase: f.career_phase,
      dynasty_value: f.dynasty_value,
      pl_mobility: 'unknown',
      risk_flags: f.risk_flags,
      style: [],
      set_pieces: f.set_pieces,
      lede: '',
      fromFallback: true,
    });
  }

  return out;
}

export { loadSeasonLeaderboard };

/**
 * One point on the explorer plot.
 *
 * Deliberately a flat tuple-ish shape: this ships ~500 rows to the client, and
 * the difference between this and a prose-carrying object is most of the
 * payload. Metrics mix the two layers on purpose — the axes are labelled, and
 * the rule was never "don't compare", it was "don't let league scoring pass
 * silently as a football judgment".
 */
export interface ExplorerRow {
  id: string;
  name: string;
  /** Granular tactical position — the plot colours by all twelve, not four buckets. */
  pos: string;
  club: string | null;
  /** League layer. */
  points: number;
  ppg: number;
  rating: number | null;
  /** Market layer — Transfermarkt, not Gaffa scoring. */
  value: number | null;
  /** Football layer. */
  minutes: number;
  ga: number;
  xgi90: number | null;
  age: number | null;
}

/**
 * Minutes before a player is worth plotting, in a completed season.
 *
 * Applied flat this would empty the plot on the live season: two gameweeks in,
 * nobody has 450 minutes, and the default view came back with zero points. The
 * floor scales with how far the season has actually run — a share of the most
 * minutes anyone has played — so it stays a meaningful bar in May and does not
 * exclude the entire league in August.
 */
const EXPLORER_MINUTES_FLOOR = 450;
const EXPLORER_SEASON_SHARE = 0.35;

export async function loadExplorerRows(
  admin: SupabaseClient,
  season: string,
): Promise<ExplorerRow[]> {
  const [statRows, players] = await Promise.all([
    fetchAllPages<{
      player_id: string;
      fantasy_points: number | null;
      match_rating: number | null;
      stats: Record<string, unknown> | null;
    }>((from, to) =>
      admin
        .from('player_stats')
        .select('player_id, fantasy_points, match_rating, stats')
        .eq('season', season)
        .range(from, to),
    ),
    fetchAllPages<{
      id: string;
      web_name: string | null;
      name: string;
      full_name: string | null;
      sofifa_common_name: string | null;
      primary_position: string;
      market_value: number | null;
      date_of_birth: string | null;
      pl_team: string | null;
    }>((from, to) =>
      admin
        .from('players')
        // getPlayerDisplayName needs all four name columns — handing it only
        // web_name and name produced bare surnames and raw feed spellings.
        .select(
          'id, web_name, name, full_name, sofifa_common_name, primary_position, market_value, date_of_birth, pl_team',
        )
        .eq('is_active', true)
        .range(from, to),
    ),
  ]);

  interface Agg {
    points: number;
    games: number;
    ratingSum: number;
    ratingCount: number;
    minutes: number;
    ga: number;
    xgi: number;
  }
  const agg = new Map<string, Agg>();
  for (const row of statRows) {
    const st = (row.stats ?? {}) as Record<string, unknown>;
    const mins = Number(st.minutes_played ?? 0);
    const a =
      agg.get(row.player_id) ??
      { points: 0, games: 0, ratingSum: 0, ratingCount: 0, minutes: 0, ga: 0, xgi: 0 };
    a.points += Number(row.fantasy_points ?? 0);
    a.minutes += mins;
    if (mins > 0) a.games += 1;
    if (row.match_rating != null) {
      a.ratingSum += Number(row.match_rating);
      a.ratingCount += 1;
    }
    a.ga += Number(st.goals ?? 0) + Number(st.assists ?? 0);
    a.xgi += Number(st.expected_goals ?? 0) + Number(st.expected_assists ?? 0);
    agg.set(row.player_id, a);
  }

  const maxMinutes = Math.max(0, ...[...agg.values()].map((a) => a.minutes));
  const floor = Math.min(EXPLORER_MINUTES_FLOOR, maxMinutes * EXPLORER_SEASON_SHARE);

  const now = new Date();
  const rows: ExplorerRow[] = [];
  for (const p of players) {
    const a = agg.get(p.id);
    if (!a || a.minutes < floor) continue;

    let age: number | null = null;
    if (p.date_of_birth) {
      const dob = new Date(p.date_of_birth);
      if (!Number.isNaN(dob.getTime())) {
        age = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
      }
    }

    rows.push({
      id: p.id,
      name: getPlayerDisplayName(p, 'full'),
      pos: p.primary_position,
      club: p.pl_team,
      points: Math.round(a.points * 10) / 10,
      ppg: a.games > 0 ? Math.round((a.points / a.games) * 10) / 10 : 0,
      rating: a.ratingCount > 0 ? Math.round((a.ratingSum / a.ratingCount) * 100) / 100 : null,
      value: p.market_value != null ? Number(p.market_value) : null,
      minutes: a.minutes,
      ga: a.ga,
      xgi90: a.minutes > 0 ? Math.round(((a.xgi * 90) / a.minutes) * 1000) / 1000 : null,
      age,
    });
  }
  return rows;
}
