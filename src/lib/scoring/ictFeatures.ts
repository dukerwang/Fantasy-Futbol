/**
 * Feature definition for ICT imputation — see `ictImputation.ts` for why this
 * exists at all.
 *
 * Kept separate from the model itself so `scripts/fit_ict_imputation.ts` can
 * import the feature extractor without pulling in the fitted coefficients.
 * Training and scoring must build the vector identically; sharing this one
 * function is what guarantees they do.
 */

/**
 * Stat keys FPL publishes DURING the live window. Nothing here may reference
 * influence, creativity, threat or ict_index — those are what we're predicting.
 */
export const NUMERIC_FEATURES = [
    'minutes_played',
    'goals',
    'assists',
    'expected_goals',
    'expected_assists',
    'expected_goals_conceded',
    'saves',
    'bps',
    'fpl_tackles',
    'fpl_cbi',
    'fpl_recoveries',
    'fpl_def_contrib',
    'goals_conceded',
    'yellow_cards',
    'red_cards',
    'own_goals',
    'penalties_missed',
    'penalty_saves',
] as const;

/** The numeric keys above plus the three derived terms in extractFeatures. */
export const FEATURE_COUNT = NUMERIC_FEATURES.length + 3;

/** Build the feature vector for one player-match. */
export function extractFeatures(stats: Record<string, unknown>): number[] {
    const num = (k: string) => Number(stats[k]) || 0;
    const f: number[] = NUMERIC_FEATURES.map(num);
    f.push(stats.clean_sheet ? 1 : 0);
    f.push(num('minutes_played') / 90);
    // bps dominates influence, and the relationship flattens at the top end —
    // a sqrt term lets a linear fit follow it without overshooting big scores.
    f.push(Math.sqrt(Math.max(0, num('bps'))));
    return f;
}

/** Position → group, for falling back when a position lacks its own model. */
export const POSITION_GROUP: Record<string, string> = {
    GK: 'GK',
    CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
    DM: 'MID', CM: 'MID', AM: 'MID',
    LW: 'ATT', RW: 'ATT', ST: 'ATT',
};
