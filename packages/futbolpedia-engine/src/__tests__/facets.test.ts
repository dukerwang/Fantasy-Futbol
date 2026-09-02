import { describe, expect, it } from 'vitest';
import {
  FACET_THRESHOLDS,
  computeCareerPhase,
  computeFallbackFacets,
  computeMinutesRole,
  computeSetPieces,
  resolveRoleShare,
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

  it('reads a first-choice player who missed time as nailed', () => {
    // Palmer 2025-26: 26 appearances, 21 of them starts — 81% when available,
    // but only 12 of the club's 38 matches missed entirely. Dividing by all 38
    // called him a likely starter, which confused fitness with role.
    const role = computeMinutesRole(inputs({ prior: { starts: 21, appearances: 26, team_matches: 38 } }));
    expect(role).toBe('nailed');
  });

  it('will not promote a high start rate off a handful of appearances', () => {
    // Started every one of five appearances, but five of 38 is not a role.
    const role = computeMinutesRole(inputs({ prior: { starts: 5, appearances: 5, team_matches: 38 } }));
    expect(role).toBe('rotation_risk');
  });

  it('treats an absent sample as fringe, not nailed', () => {
    // The optimistic default is the harmful one: an unknown player has not
    // shown he starts.
    expect(computeMinutesRole(inputs())).toBe('fringe');
  });
});

describe('early-season blending', () => {
  it('barely moves off the prior season after one match', () => {
    const share = resolveRoleShare(
      inputs({
        current: { starts: 0, appearances: 1, team_matches: 1 },
        prior: { starts: 36, appearances: 37, team_matches: 38 },
      }),
    );
    // One benched appearance must not turn an ever-present into a fringe player.
    expect(share).toBeGreaterThan(0.7);
  });

  it('ignores the prior season once the current one can speak for itself', () => {
    const share = resolveRoleShare(
      inputs({
        current: { starts: 0, appearances: 6, team_matches: 6 },
        prior: { starts: 38, appearances: 38, team_matches: 38 },
      }),
    );
    expect(share).toBe(0);
  });

  it('weights proportionally in between', () => {
    const share = resolveRoleShare(
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
      inputs({ age: 35, prior: { starts: 6, appearances: 14, team_matches: 38 } }),
    );
    expect(phase).toBe('decline_risk');
  });

  it('bands by position — a 25-year-old centre-back is still emerging', () => {
    // Saliba. A CB at 25 has his best years ahead; flat bands called this peak.
    expect(computeCareerPhase(inputs({ age: 25, primary_position: 'CB' }))).toBe('emerging');
    // A winger at 25 is in his peak on the same bands.
    expect(computeCareerPhase(inputs({ age: 25, primary_position: 'RW' }))).toBe('peak');
  });

  it('lets goalkeepers run latest of all', () => {
    expect(computeCareerPhase(inputs({ age: 32, primary_position: 'GK' }))).toBe('peak');
    expect(computeCareerPhase(inputs({ age: 32, primary_position: 'RW' }))).toBe('plateau');
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

describe('computeFallbackFacets', () => {
  it('never returns a value outside its enum', () => {
    const f = computeFallbackFacets(
      inputs({
        age: 24,
        xgi_percentile: 0.99,
        penalties_order: 1,
        prior: { starts: 36, appearances: 37, team_matches: 38 },
      }),
    );
    expect(f.minutes_role).toBe('nailed');
    expect(f.career_phase).toBe('emerging');
    expect(f.dynasty_value).toBe('cornerstone');
    expect(f.set_pieces).toEqual(['penalties']);
    expect(f.risk_flags).toEqual([]);
  });

  it('degrades to valid values on an empty input', () => {
    const f = computeFallbackFacets(inputs({ age: null }));
    expect(f).toEqual({
      minutes_role: 'fringe',
      career_phase: 'unknown',
      dynasty_value: 'win_now',
      set_pieces: [],
      risk_flags: [],
    });
  });

  it('does not call an entrenched veteran a declining asset', () => {
    // Tarkowski: career_phase already ruled this plateau rather than
    // decline_risk, and dynasty_value must not overrule it on age alone.
    const f = computeFallbackFacets(
      inputs({ age: 33, primary_position: 'CB', xgi_percentile: 0.6,
               prior: { starts: 37, appearances: 37, team_matches: 38 } }),
    );
    expect(f.career_phase).toBe('plateau');
    expect(f.dynasty_value).toBe('win_now');
  });

  it('does call a veteran who lost his place a declining asset', () => {
    const f = computeFallbackFacets(
      inputs({ age: 36, prior: { starts: 5, appearances: 12, team_matches: 38 } }),
    );
    expect(f.dynasty_value).toBe('declining_asset');
  });

  it('still calls an ever-present defender a cornerstone', () => {
    // Judged on minutes at this layer — quality is Futbolpedia's call.
    const f = computeFallbackFacets(
      inputs({ age: 25, primary_position: 'CB',
               prior: { starts: 28, appearances: 31, team_matches: 38 } }),
    );
    expect(f.dynasty_value).toBe('cornerstone');
  });

  it('flags a contested starter', () => {
    const f = computeFallbackFacets(
      inputs({ age: 27, prior: { starts: 18, appearances: 30, team_matches: 38 } }),
    );
    expect(f.risk_flags).toContain('minutes_competition');
  });
});

describe('the enum gate', () => {
  it('rejects a sidecar value outside its enum', async () => {
    const { validateOutlook } = await import('../gates/validateOutlook');
    const base = {
      quality: 'elite' as const,
      minutes_role: 'nailed' as const,
      career_phase: 'peak' as const,
      dynasty_value: 'cornerstone' as const,
      pl_mobility: 'stable' as const,
      risk_flags: [],
      style: [],
      set_pieces: [],
      confidence: 'high' as const,
      horizons_touched: ['near', 'long'] as ('near' | 'long')[],
      evidence_gaps: [],
      generated_at: '2026-08-31T00:00:00.000Z',
      model_id: 'gemini-3.7-flash',
      pipeline_version: '0.3.0',
    };
    const extraction = {
      verified_facts: [],
      status_summary: '',
      role_summary: '',
      career_phase: 'peak' as const,
      data_gaps: [],
      conflicting_reports: [],
      current_head_coach: null,
      pl_mobility: 'stable' as const,
      mobility_summary: '',
    };
    const text = 'A '.repeat(60) + 'defender who plays every week and heads corners away.';
    const bag = { player_id: 'x' } as never;

    const ok = validateOutlook({ outlook: text, sidecar: { ...base } }, extraction, bag);
    expect(ok.reasons.filter((r) => r.includes('enum'))).toHaveLength(0);

    // The free-text era would have accepted anything here.
    const bad = validateOutlook(
      { outlook: text, sidecar: { ...base, quality: 'world_class' as never } },
      extraction,
      bag,
    );
    expect(bad.ok).toBe(false);
    expect(bad.reasons.some((r) => r.includes('sidecar.quality'))).toBe(true);
  });
});

describe('style vocabulary by position', () => {
  it('never offers a centre-back archetype to a full-back', async () => {
    const { stylesFor } = await import('../facets/types');
    // Ben White, RB with CM cover, came back tagged ball_playing_cb — a
    // position he does not hold in Gaffa.
    expect(stylesFor('RB', ['CM'])).not.toContain('ball_playing_cb');
    expect(stylesFor('RB', ['CM'])).toContain('overlapping_fullback');
    expect(stylesFor('CB')).toContain('ball_playing_cb');
  });

  it('widens to cover a secondary position', async () => {
    const { stylesFor } = await import('../facets/types');
    const both = stylesFor('CB', ['RB']);
    expect(both).toContain('ball_playing_cb');
    expect(both).toContain('overlapping_fullback');
  });

  it('keeps goalkeeper archetypes to goalkeepers', async () => {
    const { stylesFor } = await import('../facets/types');
    expect(stylesFor('GK')).toEqual(['shot_stopper', 'sweeper_keeper']);
    expect(stylesFor('ST')).not.toContain('sweeper_keeper');
  });

  it('labels every archetype with football capitalisation', async () => {
    const { OUTLOOK_STYLES, STYLE_LABEL } = await import('../facets/types');
    for (const style of OUTLOOK_STYLES) {
      expect(STYLE_LABEL[style], style).toBeTruthy();
      // No raw snake_case leaking to the screen.
      expect(STYLE_LABEL[style]).not.toContain('_');
    }
    expect(STYLE_LABEL.overlapping_fullback).toBe('Overlapping Fullback');
    expect(STYLE_LABEL.ball_playing_cb).toBe('Ball-Playing CB');
  });
});
