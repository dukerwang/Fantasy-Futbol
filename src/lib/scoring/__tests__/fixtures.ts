/**
 * Gaffa — scoring golden-test fixtures
 *
 * Hand-picked performances, one per distinct branch of calculateMatchRating().
 * Chosen for branch coverage rather than volume: the flex fork at each position
 * shape, the minutes cap, the zero-minutes early return, and the out-of-position
 * penalty.
 *
 * FPL live metric values (bps / influence / creativity / threat / xG / xA /
 * defensive_contribution) are the fields computeComponentScores() actually
 * reads, so they carry the signal here. Note that yellow_cards, red_cards,
 * own_goals and penalties_missed are NOT read by the rating engine — discipline
 * reaches scoring only through `bps` — so no fixture varies them.
 */

import type { GranularPosition, RawStats } from '@/types';

/** RawStats with every field zeroed, so each fixture states only what matters. */
function makeStats(overrides: Partial<RawStats>): RawStats {
    return {
        minutes_played: 0,
        goals: 0,
        assists: 0,
        shots_on_target: 0,
        key_passes: 0,
        tackles_total: 0,
        tackles_won: 0,
        saves: 0,
        goals_conceded: 0,
        penalty_saves: 0,
        yellow_cards: 0,
        red_cards: 0,
        own_goals: 0,
        penalties_missed: 0,
        clean_sheet: false,
        ...overrides,
    };
}

export interface ScoringCase {
    /** Stable key used as the golden-baseline lookup. */
    name: string;
    /** What this performance represents in plain language — read this when a diff appears. */
    describes: string;
    position: GranularPosition;
    primaryPosition?: GranularPosition;
    stats: RawStats;
}

export const CASES: ScoringCase[] = [
    {
        name: 'st-brace',
        describes: 'Striker scores twice and assists in a 90-minute win',
        position: 'ST',
        stats: makeStats({
            minutes_played: 90,
            goals: 2,
            assists: 1,
            bps: 45,
            influence: 85.4,
            creativity: 30.2,
            threat: 61,
            expected_goals: 1.24,
            expected_assists: 0.31,
            fpl_def_contrib: 2,
        }),
    },
    {
        name: 'st-quiet',
        describes: 'Striker plays 90, four shots, no return — near the positional median',
        position: 'ST',
        stats: makeStats({
            minutes_played: 90,
            shots_on_target: 1,
            bps: 12,
            influence: 15.2,
            creativity: 8.4,
            threat: 35,
            expected_goals: 0.58,
            expected_assists: 0.09,
            fpl_def_contrib: 3,
        }),
    },
    {
        name: 'gk-busy-loss',
        describes: 'Keeper makes eight saves but concedes three — save_score should win the flex',
        position: 'GK',
        stats: makeStats({
            minutes_played: 90,
            saves: 8,
            goals_conceded: 3,
            bps: 20,
            influence: 45.6,
            expected_goals_conceded: 2.41,
        }),
    },
    {
        name: 'gk-quiet-clean-sheet',
        describes: 'Keeper makes two saves in a clean sheet — defensive should win the flex instead',
        position: 'GK',
        stats: makeStats({
            minutes_played: 90,
            saves: 2,
            goals_conceded: 0,
            clean_sheet: true,
            bps: 30,
            influence: 30.2,
            expected_goals_conceded: 0.74,
        }),
    },
    {
        name: 'cb-clean-sheet',
        describes: 'Centre back keeps a clean sheet with heavy clearance and tackle volume',
        position: 'CB',
        stats: makeStats({
            minutes_played: 90,
            clean_sheet: true,
            goals_conceded: 0,
            bps: 31,
            influence: 35.8,
            creativity: 2.1,
            threat: 4,
            fpl_tackles: 4,
            fpl_cbi: 8,
            fpl_recoveries: 5,
            fpl_def_contrib: 12,
            expected_goals_conceded: 0.81,
        }),
    },
    {
        name: 'cm-assist',
        describes: 'Central midfielder assists once with high pass and recovery volume',
        position: 'CM',
        stats: makeStats({
            minutes_played: 90,
            assists: 1,
            bps: 28,
            influence: 40.2,
            creativity: 55.7,
            threat: 15,
            expected_assists: 0.52,
            fpl_tackles: 3,
            fpl_recoveries: 7,
            fpl_def_contrib: 10,
        }),
    },
    {
        name: 'am-two-assists',
        describes: 'Attacking midfielder creates two goals — creativity-dominant game',
        position: 'AM',
        stats: makeStats({
            minutes_played: 90,
            assists: 2,
            bps: 38,
            influence: 60.4,
            creativity: 90.3,
            threat: 26,
            expected_assists: 0.94,
            fpl_def_contrib: 4,
        }),
    },
    {
        name: 'st-hattrick',
        describes: 'Striker scores a hat-trick — exercises the goal/assist rare-feat kicker',
        position: 'ST',
        stats: makeStats({
            minutes_played: 90,
            goals: 3,
            bps: 52,
            influence: 92.0,
            creativity: 30.2,
            threat: 66,
            expected_goals: 1.24,
            expected_assists: 0.10,
            fpl_def_contrib: 2,
        }),
    },
    {
        name: 'am-elite-creativity',
        describes: 'Attacking midfielder posts an elite creativity figure — exercises the creativity rare-feat bonus (absolute bar, raw 90)',
        position: 'AM',
        stats: makeStats({
            minutes_played: 90,
            assists: 2,
            bps: 38,
            influence: 60.4,
            creativity: 107,
            threat: 26,
            expected_assists: 0.94,
            fpl_def_contrib: 4,
        }),
    },
    {
        name: 'lwb-assist-clean-sheet',
        describes:
            'Left wing back assists and keeps a clean sheet — exercises the widest flex list (5 components)',
        position: 'LWB',
        stats: makeStats({
            minutes_played: 90,
            assists: 1,
            clean_sheet: true,
            goals_conceded: 0,
            bps: 32,
            influence: 35.1,
            creativity: 41.6,
            threat: 11,
            expected_assists: 0.38,
            fpl_tackles: 3,
            fpl_cbi: 4,
            fpl_def_contrib: 9,
            expected_goals_conceded: 0.79,
        }),
    },
    {
        name: 'cm-poor-game',
        describes: 'Midfielder has a genuinely bad game — low bps and near-zero attacking output',
        position: 'CM',
        stats: makeStats({
            minutes_played: 90,
            bps: 3,
            influence: 5.2,
            creativity: 4.8,
            threat: 2,
            goals_conceded: 2,
            fpl_def_contrib: 2,
        }),
    },
    {
        name: 'oop-striker-at-cb',
        describes:
            'Striker slotted into a centre-back position — must take the 20% out-of-position penalty',
        position: 'CB',
        primaryPosition: 'ST',
        stats: makeStats({
            minutes_played: 90,
            goals: 1,
            bps: 30,
            influence: 50.2,
            creativity: 20.4,
            threat: 45,
            expected_goals: 0.71,
            fpl_def_contrib: 5,
        }),
    },
    {
        name: 'cameo-five-minutes',
        describes: 'Five-minute substitute appearance — exercises the minutes cap',
        position: 'ST',
        stats: makeStats({
            minutes_played: 5,
            bps: 2,
            influence: 2.4,
            creativity: 1.2,
            threat: 4,
            expected_goals: 0.05,
        }),
    },
    {
        name: 'did-not-play',
        describes: 'Unused substitute — must return exactly zero rating and zero points',
        position: 'CM',
        stats: makeStats({ minutes_played: 0 }),
    },
];
