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
import { computeFallbackFacets } from '@futbolpedia/engine';
import { loadSeasonLeaderboard } from '@/lib/stats/seasonStats';
import { loadFacetInputs } from '@/lib/outlook/facetInputs';
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
  const [rows, factBundle] = await Promise.all([
    fetchAllPages<{ player_id: string; outlook: string; sidecar: Record<string, unknown> | null }>(
      (from, to) =>
        admin.from('player_outlooks').select('player_id, outlook, sidecar').range(from, to),
    ),
    loadFacetInputs(admin),
  ]);

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
      style: (s.style as OutlookStyle[]) ?? [],
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
