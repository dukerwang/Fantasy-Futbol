import { describe, expect, it } from 'vitest';
import {
  FACET_THRESHOLDS,
  computeCareerPhase,
  computeFacets,
  computeMinutesRole,
  computeSetPieces,
  resolveStartShare,
} from '../facets/compute';
import type { FacetInputs } from '../facets/types';

/** Minimal valid inputs; each test overrides only what it is about. */
function inputs(overrides: Partial<FacetInputs> = {}): FacetInputs {
  return {
    age: 26,
    primary_position: 'CM',
    current: null,
    prior: null,
    xgi_percentile: null,
    penalties_order: null,
    direct_fk_order: null,
    corners_order: null,
    injury_gameweeks: null,
    ...overrides,
  };
}

describe('minutes_role', () => {
  it('reads an ever-present as nailed', () => {
    // Tarkowski 2025-26: 3,330 minutes, effectively every match.
    const role = computeMinutesRole(inputs({ prior: { starts: 37, appearances: 37, team_matches: 38 } }));
    expect(role).toBe('nailed');
  });

  it('does not call a half-season starter nailed', () => {
    // Palmer 2025-26: 21 starts of 38 — a first-choice player who missed time,
    // which is materially different from one who plays every week.
    const role = computeMinutesRole(inputs({ prior: { starts: 21, appearances: 34, team_matches: 38 } }));
    expect(role).toBe('likely_starter');
  });

  it('treats an absent sample as fringe, not nailed', () => {
    // The optimistic default is the harmful one: an unknown player has not
    // shown he starts.
    expect(computeMinutesRole(inputs())).toBe('fringe');
  });
});

describe('early-season blending', () => {
  it('barely moves off the prior season after one match', () => {
    const share = resolveStartShare(
      inputs({
        current: { starts: 0, appearances: 1, team_matches: 1 },
        prior: { starts: 36, appearances: 37, team_matches: 38 },
      }),
    );
    // One benched appearance must not turn an ever-present into a fringe player.
    expect(share).toBeGreaterThan(0.7);
  });

  it('ignores the prior season once the current one can speak for itself', () => {
    const share = resolveStartShare(
      inputs({
        current: { starts: 0, appearances: 6, team_matches: 6 },
        prior: { starts: 38, appearances: 38, team_matches: 38 },
      }),
    );
    expect(share).toBe(0);
  });

  it('weights proportionally in between', () => {
    const share = resolveStartShare(
      inputs({
        current: { starts: 0, appearances: 3, team_matches: 3 },
        prior: { starts: 38, appearances: 38, team_matches: 38 },
      }),
    );
    expect(share).toBeCloseTo(0.5, 5);
  });
});

describe('career_phase', () => {
  it('does not call an ever-present veteran a decline risk', () => {
    // Tarkowski at 33 played essentially every minute. Age alone would be wrong.
    const phase = computeCareerPhase(
      inputs({ age: 33, prior: { starts: 37, appearances: 37, team_matches: 38 } }),
    );
    expect(phase).toBe('plateau');
  });

  it('does flag a veteran who has lost his place', () => {
    const phase = computeCareerPhase(
      inputs({ age: 34, prior: { starts: 6, appearances: 14, team_matches: 38 } }),
    );
    expect(phase).toBe('decline_risk');
  });

  it('calls a young regular starter peak, not emerging', () => {
    // Palmer at 24: 21 starts of 38, a first-choice player who missed time.
    // Requiring an ever-present record here read him as still arriving.
    const phase = computeCareerPhase(
      inputs({ age: 24, prior: { starts: 21, appearances: 34, team_matches: 38 } }),
    );
    expect(phase).toBe('peak');
  });

  it('still calls a young squad player emerging', () => {
    const phase = computeCareerPhase(
      inputs({ age: 23, prior: { starts: 5, appearances: 18, team_matches: 38 } }),
    );
    expect(phase).toBe('emerging');
  });

  it('calls a teenager emerging regardless of minutes', () => {
    expect(computeCareerPhase(inputs({ age: 19 }))).toBe('emerging');
  });

  it('is unknown without an age', () => {
    expect(computeCareerPhase(inputs({ age: null }))).toBe('unknown');
  });
});

describe('set_pieces', () => {
  it('counts only the first-choice penalty taker', () => {
    // Second-choice penalties are taken roughly never.
    expect(computeSetPieces(inputs({ penalties_order: 2 }))).not.toContain('penalties');
    expect(computeSetPieces(inputs({ penalties_order: 1 }))).toContain('penalties');
  });

  it("reads Palmer's real FPL duty", () => {
    // Live bootstrap: penalties 1, direct free kicks 3, no corners.
    const duties = computeSetPieces(
      inputs({ penalties_order: 1, direct_fk_order: 3, corners_order: null }),
    );
    expect(duties).toEqual(['penalties']);
  });

  it('accepts a shared duty inside the order threshold', () => {
    const duties = computeSetPieces(inputs({ direct_fk_order: 2, corners_order: 1 }));
    expect(duties).toEqual(['direct_free_kicks', 'corners_wide']);
    expect(FACET_THRESHOLDS.setPieceOrder).toBe(2);
  });
});

describe('computeFacets', () => {
  it('never returns a value outside its enum', () => {
    const f = computeFacets(
      inputs({
        age: 24,
        xgi_percentile: 0.99,
        penalties_order: 1,
        prior: { starts: 36, appearances: 37, team_matches: 38 },
      }),
    );
    expect(f.minutes_role).toBe('nailed');
    expect(f.attacking_involvement).toBe('primary_outlet');
    expect(f.career_phase).toBe('peak');
    expect(f.dynasty_value).toBe('cornerstone');
    expect(f.set_pieces).toEqual(['penalties']);
    expect(f.risk_flags).toEqual([]);
  });

  it('degrades to valid values on an empty input', () => {
    const f = computeFacets(inputs({ age: null }));
    expect(f).toEqual({
      minutes_role: 'fringe',
      attacking_involvement: 'peripheral',
      career_phase: 'unknown',
      dynasty_value: 'win_now',
      set_pieces: [],
      risk_flags: [],
    });
  });

  it('does not call an entrenched veteran a declining asset', () => {
    // Tarkowski: career_phase already ruled this plateau rather than
    // decline_risk, and dynasty_value must not overrule it on age alone.
    const f = computeFacets(
      inputs({ age: 33, xgi_percentile: 0.6, prior: { starts: 37, appearances: 37, team_matches: 38 } }),
    );
    expect(f.career_phase).toBe('plateau');
    expect(f.dynasty_value).toBe('win_now');
  });

  it('does call a veteran who lost his place a declining asset', () => {
    const f = computeFacets(
      inputs({ age: 34, prior: { starts: 5, appearances: 12, team_matches: 38 } }),
    );
    expect(f.dynasty_value).toBe('declining_asset');
  });

  it('flags a contested starter', () => {
    const f = computeFacets(
      inputs({ age: 27, prior: { starts: 20, appearances: 30, team_matches: 38 } }),
    );
    expect(f.risk_flags).toContain('minutes_competition');
  });
});
