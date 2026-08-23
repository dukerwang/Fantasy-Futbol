/**
 * Gaffa — ICT imputation
 *
 * From 2026/27 FPL withholds the ICT block (influence / creativity / threat)
 * until the gameweek lockdown at 09:00 UK on the day after the final match, so
 * that post-match Opta review data can be folded into the BPS. Every one of
 * those three reads 0.0 for the whole live window.
 *
 * That is not a neutral gap. ICT carries between 6% (GK) and 50% (AM) of the
 * weight in POSITION_WEIGHTS, so scoring a live gameweek with the block zeroed
 * does not add noise evenly — it drags midfielders down roughly five times
 * harder than centre-backs. Measured on real 2025-26 stats, zeroing costs GK
 * −0.15 rating and AM −0.65, a systematic 0.51-point positional bias.
 *
 * The stats FPL *does* publish live (bps above all, plus xG, xA, xGC and the
 * granular defensive counts) predict the missing block well enough to close
 * most of that gap. Ridge regression per position, trained on 2025-26 GW1-30
 * and tested on GW31-38:
 *
 *                        zeroed    imputed
 *   mean Δ rating         −0.34      −0.01
 *   mean |Δ rating|        0.338      0.110
 *   Spearman vs final      0.909      0.973
 *   positional bias        0.51       0.05
 *   top-10 overlap/GW      4.4/10     8.0/10
 *
 * Influence is nearly fully recoverable (R² 0.83–0.96) because it and bps
 * measure much the same thing; creativity and threat are weaker (0.27–0.70)
 * but carry less weight. GK threat is unpredictable (R² ≈ 0.01) and its weight
 * is 0.00, so it never reaches a score.
 *
 * These are ESTIMATES and are always superseded. The post-lockdown stats pass
 * re-scores the gameweek from FPL's real numbers, and rows scored this way
 * carry `ict_imputed: true` in their stats JSON.
 *
 * Coefficients are fitted from real data by `scripts/fit_ict_imputation.ts` —
 * refit once a season has ~5 gameweeks of its own, because FPL tweaked the BPS
 * formula for 2026/27 and bps is the single strongest feature here.
 */

import coefficients from './ictImputation.json';
import { extractFeatures, FEATURE_COUNT, POSITION_GROUP } from './ictFeatures';
import type { GranularPosition } from '@/types';

export type IctTarget = 'influence' | 'creativity' | 'threat';

type CoefficientTable = Record<string, Record<IctTarget, number[]>>;
const MODELS = coefficients as unknown as CoefficientTable;

/**
 * Which fitted model applies to a position. Positions with enough training
 * rows get their own; the rest fall back to their position group, and anything
 * unrecognised falls back to MID.
 */
export function bucketFor(position: GranularPosition | string): string {
    if (MODELS[position]) return position;
    const group = POSITION_GROUP[position];
    if (group && MODELS[group]) return group;
    return MODELS.MID ? 'MID' : Object.keys(MODELS)[0];
}

/**
 * Estimate the ICT block for one player-match.
 *
 * Returns null when no model is available, so callers fall back to whatever
 * FPL gave them rather than silently scoring against a guess.
 */
export function imputeIct(
    stats: Record<string, unknown>,
    position: GranularPosition | string,
): Record<IctTarget, number> | null {
    const bucket = bucketFor(position);
    const model = MODELS[bucket];
    if (!model) return null;

    const x = extractFeatures(stats);
    const out = {} as Record<IctTarget, number>;
    for (const target of ['influence', 'creativity', 'threat'] as const) {
        const beta = model[target];
        if (!beta || beta.length !== FEATURE_COUNT + 1) return null;
        let v = beta[FEATURE_COUNT]; // intercept
        for (let i = 0; i < FEATURE_COUNT; i++) v += beta[i] * x[i];
        // The real metrics are non-negative and quoted to one decimal.
        out[target] = Math.round(Math.max(0, v) * 10) / 10;
    }
    return out;
}

/**
 * Return a copy of `stats` with the ICT block replaced by model estimates.
 *
 * Marked with `ict_imputed: true` so a row scored this way is never mistaken
 * for FPL's own numbers. Players with no minutes are returned untouched — they
 * score zero regardless.
 */
export function applyIctImputation<T extends Record<string, any>>(
    stats: T,
    position: GranularPosition | string,
): T {
    if ((Number(stats.minutes_played) || 0) <= 0) return stats;
    const est = imputeIct(stats, position);
    if (!est) return stats;
    return {
        ...stats,
        influence: est.influence,
        creativity: est.creativity,
        threat: est.threat,
        // FPL's own definition: the three components summed and scaled down.
        ict_index: Math.round((est.influence + est.creativity + est.threat)) / 10,
        ict_imputed: true,
    };
}

/**
 * Whether a gameweek's live payload is missing its ICT block entirely.
 *
 * Decided once per gameweek rather than per player on purpose: an individual
 * can legitimately post 0.0 across all three (a late substitute who touches
 * nothing), and roughly 2% of appearances do. Only a whole gameweek reading
 * zero means FPL is withholding rather than reporting.
 */
export function isIctBlockAbsent(
    rows: Array<{ minutes: number; ictIndex: number }>,
): boolean {
    const played = rows.filter((r) => r.minutes > 0);
    if (played.length === 0) return false;
    return played.every((r) => r.ictIndex === 0);
}
