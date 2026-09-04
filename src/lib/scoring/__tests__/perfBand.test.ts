/**
 * The performance block's data layer — the disclosure rules first, then the
 * rank anchors.
 *
 * These are structural tests. Each one guards a property that is easy to undo
 * by an innocuous-looking edit and that no type would catch.
 */
import { describe, expect, it } from 'vitest';
import type { GranularPosition, RatingBreakdownItem, RatingComponent, RawStats } from '@/types';
import { BAND_WIDTH, buildPerformanceGroups, perfBand, rankAnchor, type PerfGroupKey } from '../perfBand';
import { calculateMatchRating, featExcessFor } from '../matchRating';

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

/* The card's position chips re-score a game under each eligible slot and show
   the block for the one selected. That is only worth the payload if the block
   ACTUALLY MOVES with the slot — so this pins the three ways it can, using one
   real Luke Shaw shape (LB primary, LWB/CB secondary).

   It also guards a refresh: BAND_CUTS_BY_POS and ANCHOR_TIERS are regenerated
   whenever rating_reference_stats is, and a regeneration that collapsed these
   positions onto each other would silently turn the whole feature back into
   the bug it fixed. */
describe('a block differs by the slot it is built at', () => {
    const shawish = {
        minutes_played: 90, goals: 0, assists: 0, goals_conceded: 2,
        bps: 18, influence: 14.2, creativity: 26.5, threat: 6, ict_index: 4.7,
        expected_goals: 0.03, expected_assists: 0.26, expected_goals_conceded: 1.0,
        fpl_tackles: 1, fpl_cbi: 3, fpl_recoveries: 3, fpl_def_contrib: 7,
    } as unknown as RawStats;

    const blockAt = (pos: GranularPosition) => {
        const { breakdown } = calculateMatchRating(shawish, pos);
        return buildPerformanceGroups(breakdown, pos, shawish, featExcessFor(shawish, pos));
    };

    /* Both positions are graded on attacking — LB weights goal_involvement 0.10.
       The row differs because of the MUTE RULE, not the group map: LB's
       attacking has no continuously-varying member (threat 0.00), so on a game
       with no goal, no assist and xG 0.03 it has nothing to say and stands
       down. LWB weights threat 0.05, which is continuous, so its row is never
       mute-capable and always renders. */
    it('shows a different set of groups, because the mute rule fires per position', () => {
        expect(blockAt('LB').map((g) => g.key)).not.toContain('attacking');
        expect(blockAt('LWB').map((g) => g.key)).toContain('attacking');
    });

    it('reaches a different verdict and rank tier for the same afternoon', () => {
        const lb = blockAt('LB').find((g) => g.key === 'creating')!;
        const cb = blockAt('CB').find((g) => g.key === 'creating')!;
        expect(cb.verdict).not.toBe(lb.verdict);
        expect(cb.rank).not.toBe(lb.rank);
    });

    it('changes the evidence prose, not just the word above it', () => {
        // A centre-back's recoveries never enter his defensive score.
        expect(blockAt('LB').find((g) => g.key === 'defending')!.evidence).toContain('3 recoveries');
        expect(blockAt('CB').find((g) => g.key === 'defending')!.evidence).not.toContain('recover');
    });
});

describe('evidence lines', () => {
    /* Every one of these is a real miss found on a real row, not a hypothetical.
       The rule: an evidence line may only cite facts that moved the band. */
    const defOf = (pos: GranularPosition, raw: Partial<RawStats>) =>
        buildPerformanceGroups(flat(0.5), pos, { minutes_played: 90, ...raw } as RawStats, 0)
            .find((g) => g.key === 'defending')!.evidence;

    it('never calls CBI "clearances" — blocks and interceptions are in there too', () => {
        const line = defOf('CB', { fpl_tackles: 5, fpl_cbi: 10, goals_conceded: 0 });
        expect(line).toContain('clearances/blocks/interceptions');
    });

    /* The compound stat is slash-bound so it survives being one item in a
       comma list. A comma inside it made "1 tackle, 3 clearances, blocks and
       interceptions, 3 recoveries" read as five separate numbers. */
    it('binds CBI into one token, never splitting it on commas', () => {
        const line = defOf('LB', { fpl_tackles: 1, fpl_cbi: 3, fpl_recoveries: 3, goals_conceded: 2, expected_goals_conceded: 1.0 });
        expect(line).toContain('1 tackle, 3 clearances/blocks/interceptions, 3 recoveries');
        expect(line).not.toContain('clearances, blocks');
    });

    it('omits a centre-back\'s recoveries, which his score drops', () => {
        const line = defOf('CB', { fpl_tackles: 5, fpl_cbi: 10, fpl_recoveries: 6 });
        expect(line).not.toContain('recover');
    });

    it('keeps recoveries for a position that is graded on them', () => {
        for (const pos of ['LB', 'RB', 'DM', 'CM'] as GranularPosition[]) {
            expect(defOf(pos, { fpl_tackles: 2, fpl_recoveries: 6 }), pos).toContain('6 recoveries');
        }
    });

    it('states the outcome term that usually sets the band', () => {
        // The row that started this: actions came to 10, conceding 2 against
        // 1.33 xGC took 3.35 back off, and the line mentioned neither.
        const conceded = defOf('CB', {
            fpl_tackles: 5, fpl_cbi: 10, fpl_recoveries: 6,
            goals_conceded: 2, expected_goals_conceded: 1.33, clean_sheet: false,
        });
        expect(conceded).toContain('2 conceded against 1.3 expected');
        const clean = defOf('CB', { fpl_tackles: 5, fpl_cbi: 10, clean_sheet: true });
        expect(clean).toContain('clean sheet');
    });

    it('credits a defence that conceded fewer than the chances warranted', () => {
        const line = defOf('CB', { fpl_tackles: 3, goals_conceded: 1, expected_goals_conceded: 2.4 });
        expect(line).toContain('1 conceded, against 2.4 expected');
    });

    it('says something, or says nothing — never an empty sentence', () => {
        expect(defOf('CB', {})).toBe('Little defensive work.');
        for (const pos of ALL_POSITIONS) {
            for (const g of buildPerformanceGroups(flat(0.5), pos, { minutes_played: 90 } as RawStats, 0)) {
                expect(g.evidence === '' || /[.!]$/.test(g.evidence), `${pos}/${g.key}: ${g.evidence}`).toBe(true);
            }
        }
    });
});

describe('band calibration', () => {
    /* The score is positionally normalised by the sigmoid, so grading it
       against one league-wide table kills bands for a compressed position.
       Measured: a centre-back could not read below STEADY on Creating, and 36%
       of them read INCISIVE or MASTERFUL on a median raw creativity of 10.7. */
    it('spans every band for a centre-back\'s creating', () => {
        const bands = new Set<string>();
        for (let sc = 0; sc <= 1.0001; sc += 0.005) {
            bands.add(buildPerformanceGroups(flat(sc), 'CB', { minutes_played: 90 } as RawStats, 0)
                .find((g) => g.key === 'creating')!.band);
        }
        for (const b of ['poor', 'low', 'mid', 'good', 'best', 'elite', 'supreme']) expect(bands).toContain(b);
    });

    it('spans every band for every position and group it can', () => {
        // The exceptions are the near-binary attacking groups the mute rule
        // targets: their scores take 5-7 distinct values a season, so no cut
        // scheme can split them. Everything else must span.
        const exempt = new Set(['CB|attacking', 'DM|attacking', 'LB|attacking', 'RB|attacking']);
        for (const pos of ALL_POSITIONS) {
            const keys = buildPerformanceGroups(flat(0.5), pos, { minutes_played: 90, goals: 1 } as RawStats, 0)
                .map((g) => g.key);
            for (const key of keys) {
                if (exempt.has(`${pos}|${key}`)) continue;
                const bands = new Set<string>();
                for (let sc = 0; sc <= 1.0001; sc += 0.005) {
                    bands.add(buildPerformanceGroups(flat(sc), pos, { minutes_played: 90, goals: 1 } as RawStats, 0)
                        .find((g) => g.key === key)!.band);
                }
                for (const b of ['poor', 'low', 'mid', 'good', 'best', 'elite', 'supreme']) {
                    expect(bands, `${pos}/${key} cannot reach ${b}`).toContain(b);
                }
            }
        }
    });

    it('keeps a neutral word in every group\'s middle band', () => {
        // "Inventive" in creating's mid slot read as praise and fought the
        // evidence line beneath it.
        const NEUTRAL = ['Involved', 'Tidy', 'Steady', 'Busy', 'Held'];
        for (const pos of ALL_POSITIONS) {
            for (const g of buildPerformanceGroups(flat(0.5), pos, { minutes_played: 90, goals: 1 } as RawStats, 0)) {
                if (g.band !== 'mid') continue;
                expect(NEUTRAL, `${pos}/${g.key} mid = ${g.verdict}`).toContain(g.verdict);
            }
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

    it('states the share its band represents, and nothing else', () => {
        expect(rankAnchor('good', 'AM')).toBeUndefined();
        expect(rankAnchor('best', 'AM')).toBe('Top 15% for an AM');
        expect(rankAnchor('elite', 'AM')).toBe('Top 5% for an AM');
        expect(rankAnchor('supreme', 'AM')).toBe('Top 1% for an AM');
    });

    it('names the player position, not the pooled bucket', () => {
        expect(rankAnchor('supreme', 'LW')).toBe('Top 1% for an LW');
        expect(rankAnchor('supreme', 'RW')).toBe('Top 1% for an RW');
        expect(rankAnchor('supreme', 'LWB')).toBe('Top 1% for an LWB');
    });

    /* THE BUG THAT MADE SAKA AND PALMER LOOK IDENTICAL. Two independently
       measured ladders had no common boundary: bands at p85, anchors at p75.
       Saka's 0.8198 as an RW was inside the best band (floor .7437) but below
       the old top-10 cut (.835), so it printed "TOP 25%" beside a DECISIVE
       verdict that meant top 15%. The anchor is now derived FROM the band, so
       the two cannot disagree — this asserts that, not a set of numbers. */
    it('carries an anchor for exactly the three top bands', () => {
        for (const pos of ALL_POSITIONS) {
            const keys = buildPerformanceGroups(flat(0.5), pos, { minutes_played: 90, goals: 1 } as RawStats, 0)
                .map((g) => g.key);
            for (const key of keys) {
                for (let sc = 0; sc <= 1.0001; sc += 0.002) {
                    const band = perfBand(sc, key, pos);
                    const top = band === 'best' || band === 'elite' || band === 'supreme';
                    expect(Boolean(rankAnchor(band, pos)), `${pos}/${key} @ ${sc.toFixed(3)} band=${band}`)
                        .toBe(top);
                }
            }
        }
    });

    it('gives Saka and Palmer different words, not just different footnotes', () => {
        // Real GW1 attacking scores. Both used to read DECISIVE.
        const saka = buildPerformanceGroups(flat(0.8198), 'RW', { minutes_played: 90, goals: 1 } as RawStats, 0)
            .find((g) => g.key === 'attacking')!;
        const palmer = buildPerformanceGroups(flat(0.9622), 'AM', { minutes_played: 90, goals: 1, assists: 1 } as RawStats, 0)
            .find((g) => g.key === 'attacking')!;
        expect(saka.verdict).not.toBe(palmer.verdict);
        expect(saka.verdict).toBe('Decisive');
        expect(palmer.verdict).toBe('Ruthless');
        expect(saka.rank).toBe('Top 15% for an RW');
        expect(palmer.rank).toBe('Top 5% for an AM');
    });

    it('gives every top band its own word, per group', () => {
        for (const pos of ALL_POSITIONS) {
            const seen = new Map<string, Set<string>>();
            for (const sc of [0.5, 0.80, 0.87, 0.93, 0.995]) {
                for (const g of buildPerformanceGroups(flat(sc), pos, { minutes_played: 90, goals: 1 } as RawStats, 0)) {
                    const s = seen.get(g.key) ?? seen.set(g.key, new Set()).get(g.key)!;
                    if (g.band === 'best' || g.band === 'elite' || g.band === 'supreme') s.add(g.verdict);
                }
            }
            for (const [key, words] of seen) {
                // Three top bands must not collapse onto one word.
                expect(words.size, `${pos}/${key} top words: ${[...words]}`).toBeGreaterThan(1);
            }
        }
    });

    it('is monotone in score for every position and group', () => {
        /** 0 for no anchor, then 1..3 as the claim TIGHTENS. */
        const RANK_OF = (s: string | undefined) =>
            s === undefined ? 0 : [15, 5, 1].indexOf(Number(s.match(/(\d+)%/)![1])) + 1;
        for (const pos of ALL_POSITIONS) {
            const keys = buildPerformanceGroups(flat(0.5), pos, NO_STATS, 0).map((g) => g.key);
            for (const key of keys as PerfGroupKey[]) {
                let prev = 0;
                for (let s = 0; s <= 1.0001; s += 0.005) {
                    const cur = RANK_OF(rankAnchor(perfBand(s, key, pos), pos));
                    expect(cur, `${pos}/${key} at ${s.toFixed(3)}`).toBeGreaterThanOrEqual(prev);
                    prev = cur;
                }
            }
        }
    });

    /* The feat tiers sit ABOVE `supreme` and are reached only by the trigger.
       A first pass at the seven-band ladder promoted Devastating/Unplayable
       into elite/supreme, which stole them from the feats and left a hat-trick
       reading the same word as a top-1% percentile. */
    it('keeps feat vocabulary distinct from every ordinary band', () => {
        const stats = { minutes_played: 90, goals: 3, assists: 0 } as unknown as RawStats;
        const feat = buildPerformanceGroups(flat(0.95), 'ST', stats, 1.08)
            .find((g) => g.key === 'attacking')!;
        expect(feat.band).toBe('feat');
        const ordinary = new Set<string>();
        for (const sc of [0.1, 0.45, 0.55, 0.72, 0.80, 0.90, 0.99]) {
            ordinary.add(buildPerformanceGroups(flat(sc), 'ST', { minutes_played: 90, goals: 1 } as RawStats, 0)
                .find((g) => g.key === 'attacking')!.verdict);
        }
        expect(ordinary).not.toContain(feat.verdict);
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

    it('keeps a brace on the ordinary percentile ladder rather than triggering Devastating', () => {
        // 2 goals = 12 raw GI -> featExcess = (12 - 11.5) / 6 = 0.083
        const stats = {
            minutes_played: 90,
            goals: 2,
            assists: 0,
            threat: 75,
            expected_goals: 1.2,
        } as unknown as RawStats;
        const excess = featExcessFor(stats, 'ST');
        expect(excess).toBeCloseTo(0.083, 2);

        const groups = buildPerformanceGroups(flat(0.90), 'ST', stats, excess);
        const attacking = groups.find((g) => g.key === 'attacking')!;
        // Attacking stays on ordinary ladder (Ruthless or Rampant), with rank anchor shown
        expect(attacking.band).not.toBe('feat');
        expect(attacking.band).not.toBe('feat2');
        expect(['Decisive', 'Ruthless', 'Rampant']).toContain(attacking.verdict);
        expect(attacking.rank).toBeDefined();
    });

    it('triggers Devastating on a hat-trick and Unplayable on 4 goals', () => {
        const htStats = { minutes_played: 90, goals: 3, assists: 0 } as unknown as RawStats;
        const htExcess = featExcessFor(htStats, 'ST');
        expect(htExcess).toBeGreaterThanOrEqual(1.0);
        const htGroups = buildPerformanceGroups(flat(0.95), 'ST', htStats, htExcess);
        const htAttacking = htGroups.find((g) => g.key === 'attacking')!;
        expect(htAttacking.band).toBe('feat');
        expect(htAttacking.verdict).toBe('Devastating');

        const pokerStats = { minutes_played: 90, goals: 4, assists: 0 } as unknown as RawStats;
        const pokerExcess = featExcessFor(pokerStats, 'ST');
        expect(pokerExcess).toBeGreaterThanOrEqual(2.0);
        const pokerGroups = buildPerformanceGroups(flat(0.95), 'ST', pokerStats, pokerExcess);
        const pokerAttacking = pokerGroups.find((g) => g.key === 'attacking')!;
        expect(pokerAttacking.band).toBe('feat2');
        expect(pokerAttacking.verdict).toBe('Unplayable');
    });

    it('triggers Virtuoso for elite creativity even with sub-unit excess', () => {
        const creativeStats = { minutes_played: 90, goals: 0, assists: 0, creativity: 95 } as unknown as RawStats;
        const excess = featExcessFor(creativeStats, 'AM');
        expect(excess).toBeGreaterThan(0);
        expect(excess).toBeLessThan(1.0);
        const groups = buildPerformanceGroups(flat(0.95), 'AM', creativeStats, excess);
        const creating = groups.find((g) => g.key === 'creating')!;
        expect(creating.band).toBe('feat');
        expect(creating.verdict).toBe('Virtuoso');
    });
});
