/**
 * The performance block's data layer — the disclosure rules first, then the
 * rank anchors.
 *
 * These are structural tests. Each one guards a property that is easy to undo
 * by an innocuous-looking edit and that no type would catch.
 */
import { describe, expect, it } from 'vitest';
import type { GranularPosition, RatingBreakdownItem, RatingComponent, RawStats } from '@/types';
import { BAND_WIDTH, buildPerformanceGroups, rankAnchor, type PerfGroupKey } from '../perfBand';

const ALL_POSITIONS: GranularPosition[] = [
    'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST',
];

const COMPONENTS: RatingComponent[] = [
    'match_impact', 'influence', 'creativity', 'threat',
    'defensive', 'goal_involvement', 'finishing', 'save_score',
];

/** A breakdown with every component pinned to one score. */
function flat(score: number): RatingBreakdownItem[] {
    return COMPONENTS.map((key) => ({ key, score } as RatingBreakdownItem));
}

const NO_STATS = { minutes_played: 90 } as unknown as RawStats;

describe('disclosure rules', () => {
    it('never emits a numeric score on a group', () => {
        for (const pos of ALL_POSITIONS) {
            for (const g of buildPerformanceGroups(flat(0.7314), pos, NO_STATS, 0)) {
                // The only number allowed out is the quantised bar width.
                expect(Object.values(BAND_WIDTH)).toContain(g.width);
                const leaked = JSON.stringify(g).match(/0\.7\d{2,}/);
                expect(leaked, `${pos}/${g.key} leaked a score`).toBeNull();
            }
        }
    });

    it('quantises every bar width to a band', () => {
        const widths = new Set<number>();
        for (let s = 0; s <= 1.0001; s += 0.01) {
            for (const pos of ALL_POSITIONS) {
                for (const g of buildPerformanceGroups(flat(s), pos, NO_STATS, 0)) widths.add(g.width);
            }
        }
        for (const w of widths) expect(Object.values(BAND_WIDTH)).toContain(w);
    });

    it('holds group order fixed per position, whatever the scores', () => {
        for (const pos of ALL_POSITIONS) {
            const low = buildPerformanceGroups(flat(0.1), pos, NO_STATS, 0).map((g) => g.key);
            const high = buildPerformanceGroups(flat(0.95), pos, NO_STATS, 0).map((g) => g.key);
            expect(high).toEqual(low);
        }
    });

    it('gives a keeper the keeper map and no attacking or creating group', () => {
        const keys = buildPerformanceGroups(flat(0.5), 'GK', NO_STATS, 0).map((g) => g.key);
        expect(keys).toEqual(['shotStopping', 'goalsPrevented', 'involvement']);
    });

    it('drops the defending group for positions weighted 0.00 there', () => {
        for (const pos of ['AM', 'LW', 'RW', 'ST'] as GranularPosition[]) {
            const keys = buildPerformanceGroups(flat(0.5), pos, NO_STATS, 0).map((g) => g.key);
            expect(keys).not.toContain('defending');
        }
    });
});

describe('mute groups', () => {
    const BLANK = { minutes_played: 90 } as unknown as RawStats;
    const SCORED = { minutes_played: 90, goals: 1 } as unknown as RawStats;
    const MISSED = { minutes_played: 90, expected_goals: 0.6 } as unknown as RawStats;

    /* LB, RB and DM weight threat 0.00 and finishing 0.00, so their attacking
       group is goal_involvement alone — 5 to 7 distinct values across a whole
       season, ~90% of them identical. CB is the same shape with two members. */
    it('hides an attacking group that cannot vary, on a blank', () => {
        for (const pos of ['LB', 'RB', 'DM', 'CB'] as GranularPosition[]) {
            const keys = buildPerformanceGroups(flat(0.5), pos, BLANK, 0).map((g) => g.key);
            expect(keys, pos).not.toContain('attacking');
        }
    });

    it('shows it again the moment there is something to report', () => {
        for (const pos of ['LB', 'RB', 'DM', 'CB'] as GranularPosition[]) {
            for (const stats of [SCORED, MISSED]) {
                const keys = buildPerformanceGroups(flat(0.5), pos, stats, 0).map((g) => g.key);
                expect(keys, pos).toContain('attacking');
            }
        }
    });

    /* The rule must not reach positions whose attacking group has a continuous
       member. A blanking striker reading ANONYMOUS is the row doing its job. */
    it('never hides attacking for a position that weights threat', () => {
        for (const pos of ['ST', 'LW', 'RW', 'AM', 'CM', 'LWB', 'RWB'] as GranularPosition[]) {
            const keys = buildPerformanceGroups(flat(0.5), pos, BLANK, 0).map((g) => g.key);
            expect(keys, pos).toContain('attacking');
        }
    });

    it('leaves the groups that carry a position, whatever the stat line', () => {
        // Nothing may mute a keeper's map, or the defining group of any position.
        expect(buildPerformanceGroups(flat(0.5), 'GK', BLANK, 0)).toHaveLength(3);
        for (const pos of ALL_POSITIONS) {
            const keys = buildPerformanceGroups(flat(0.5), pos, BLANK, 0).map((g) => g.key);
            expect(keys.length, pos).toBeGreaterThanOrEqual(3);
            expect(keys, pos).toContain('involvement');
        }
    });
});

describe('rank anchors', () => {
    it('stays silent through the whole bottom half', () => {
        for (const pos of ALL_POSITIONS) {
            for (const g of buildPerformanceGroups(flat(0.45), pos, NO_STATS, 0)) {
                expect(g.rank, `${pos}/${g.key}`).toBeUndefined();
            }
        }
    });

    it('reports the tightest tier a score clears, never a looser one', () => {
        // AM attacking cuts: 25% .634, 10% .814, 5% .883, 1% .975
        expect(rankAnchor(0.60, 'AM', 'attacking')).toBeUndefined();
        expect(rankAnchor(0.70, 'AM', 'attacking')).toBe('Top 25% for an AM');
        expect(rankAnchor(0.85, 'AM', 'attacking')).toBe('Top 10% for an AM');
        expect(rankAnchor(0.90, 'AM', 'attacking')).toBe('Top 5% for an AM');
        expect(rankAnchor(0.99, 'AM', 'attacking')).toBe('Top 1% for an AM');
    });

    it('skips a dropped tier instead of falling back to a looser claim', () => {
        // CB attacking has no honest 25% cut — the blanks tie at one value.
        // A score between the 10% and 5% cuts must read 10%, never 25%.
        expect(rankAnchor(0.70, 'CB', 'attacking')).toBe('Top 10% for a CB');
        expect(rankAnchor(0.60, 'CB', 'attacking')).toBeUndefined();
    });

    it('names the player position, not the pooled bucket', () => {
        expect(rankAnchor(0.99, 'LW', 'creating')).toBe('Top 1% for an LW');
        expect(rankAnchor(0.99, 'RW', 'creating')).toBe('Top 1% for an RW');
        expect(rankAnchor(0.99, 'LWB', 'defending')).toBe('Top 1% for an LWB');
    });

    it('is monotone in score for every position and group', () => {
        /** 0 for no anchor, then 1..4 as the claim TIGHTENS. */
        const RANK_OF = (s: string | undefined) =>
            s === undefined ? 0 : [25, 10, 5, 1].indexOf(Number(s.match(/(\d+)%/)![1])) + 1;
        for (const pos of ALL_POSITIONS) {
            const keys = buildPerformanceGroups(flat(0.5), pos, NO_STATS, 0).map((g) => g.key);
            for (const key of keys as PerfGroupKey[]) {
                let prev = 0;
                for (let s = 0; s <= 1.0001; s += 0.005) {
                    const cur = RANK_OF(rankAnchor(s, pos, key));
                    expect(cur, `${pos}/${key} at ${s.toFixed(3)}`).toBeGreaterThanOrEqual(prev);
                    prev = cur;
                }
            }
        }
    });

    it('suppresses the anchor on a feat row, which is rarer than 1%', () => {
        const stats = { minutes_played: 90, goals: 3, assists: 0 } as unknown as RawStats;
        const groups = buildPerformanceGroups(flat(0.95), 'ST', stats, 1.08);
        const attacking = groups.find((g) => g.key === 'attacking')!;
        expect(attacking.band).toBe('feat');
        expect(attacking.rank).toBeUndefined();
        // A non-feat group on the same match still anchors.
        expect(groups.find((g) => g.key === 'involvement')!.rank).toBeDefined();
    });
});
