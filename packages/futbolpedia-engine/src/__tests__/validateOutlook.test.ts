import { describe, expect, it } from 'vitest';
import { assertValidOutlook, validateOutlook } from '../gates/validateOutlook';
import { buildClubContextQuery, buildOutlookPlayerQueries, buildOutlookSearchQueries } from '../pipeline/queryGen';
import type { OutlookContextBag, OutlookExtraction, PlayerOutlook } from '../types/outlook';

const SAMPLE_BAG: OutlookContextBag = {
  player_id: '11111111-1111-1111-1111-111111111111',
  name: 'James Tarkowski',
  display_name: 'James Tarkowski',
  age: 32,
  nationality: 'England',
  club: 'Everton',
  primary_position: 'CB',
  secondary_positions: [],
  availability: 'available',
  injury_news: null,
  market_value_eur_m: 12,
  is_new_to_prem: false,
  academy_eligible: false,
  simulation_date: '2026-08-26',
  current_season: '2026-27',
  is_dynasty_league: true,
  pl_tenure: 'established',
};

const SAMPLE_EXTRACTION: OutlookExtraction = {
  verified_facts: ['First-choice centre-back at Everton'],
  status_summary: 'Fit and available',
  role_summary: 'Nailed starter at centre-back',
  career_phase: 'plateau',
  data_gaps: [],
  conflicting_reports: [],
  current_head_coach: null,
  pl_mobility: 'stable',
  mobility_summary: 'Established at Everton with no exit links reported',
};

function makeOutlook(text: string, confidence: 'high' | 'medium' | 'low' = 'high'): PlayerOutlook {
  return {
    outlook: text,
    sidecar: {
      quality: 'high',
      minutes_role: 'nailed',
      career_phase: 'peak',
      dynasty_value: 'win_now',
      pl_mobility: 'stable',
      risk_flags: [],
      style: [],
      set_pieces: [],
      confidence,
      horizons_touched: ['near', 'long'],
      evidence_gaps: [],
      generated_at: '2026-08-26T00:00:00.000Z',
      model_id: 'gemini-3.7-flash',
      pipeline_version: '0.3.0',
    },
  };
}

describe('search queries', () => {
  it('issues two player queries, not four', () => {
    // Grounded requests are billed per request and dominate the cost of a run.
    // Availability and transfer news were two queries asking the same corner of
    // the web about the same player; they are one now.
    const queries = buildOutlookPlayerQueries(SAMPLE_BAG);
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.includes('James Tarkowski'))).toBe(true);
    expect(queries.some((q) => q.includes('transfer exit'))).toBe(true);
    expect(queries.some((q) => q.includes('set pieces'))).toBe(true);
  });

  it('keeps the head-coach query club-scoped so a batch can share it', () => {
    // It was identical for every player at a club and ran once per player —
    // roughly 412 redundant grounded requests on a 432-player run.
    const clubQuery = buildClubContextQuery(SAMPLE_BAG);
    expect(clubQuery).toContain('head coach');
    expect(clubQuery).toContain('Everton');
    expect(clubQuery).not.toContain('James Tarkowski');
    expect(buildOutlookPlayerQueries(SAMPLE_BAG).some((q) => q.includes('head coach'))).toBe(false);
  });

  it('still exposes the combined list for outside callers', () => {
    expect(buildOutlookSearchQueries(SAMPLE_BAG)).toHaveLength(3);
  });
});

describe('validateOutlook', () => {
  it('accepts a valid outlook paragraph', () => {
    const outlook = makeOutlook(
      'James Tarkowski is fit and entrenched as Everton\'s first-choice centre-back, logging heavy defensive volume most weeks with limited progressive carrying. At 32 he profiles as a plateau-phase starter whose value is durability and aerial defending rather than upside growth. Expect steady minutes and a reliable floor with occasional set-piece threat, and a longer arc defined by reliability over breakout potential rather than a changing role.',
    );
    const result = validateOutlook(outlook, SAMPLE_EXTRACTION, SAMPLE_BAG);
    expect(result.ok).toBe(true);
  });

  it('rejects trade advice phrasing', () => {
    const outlook = makeOutlook(
      'Tarkowski is a nailed Everton centre-back with steady minutes and defensive volume across the season. At 32 he remains a durable starter rather than an upside play, with aerial defending and clearances defining his weekly output. Managers should buy him before the price moves and hold through the fixture run because his floor is secure. Over the longer arc he profiles as a plateau-phase defender whose value is reliability rather than growth.',
    );
    const result = validateOutlook(outlook, SAMPLE_EXTRACTION, SAMPLE_BAG);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('banned phrase'))).toBe(true);
  });

  it('rejects high confidence with many evidence gaps', () => {
    const outlook = makeOutlook(
      'James Tarkowski is fit and entrenched as Everton\'s first-choice centre-back, logging heavy defensive volume most weeks with limited progressive carrying. At 32 he profiles as a plateau-phase starter whose value is durability and aerial defending rather than upside growth. Expect steady minutes and a reliable floor with occasional set-piece threat, and a longer arc defined by reliability over breakout potential rather than a changing role.',
      'high',
    );
    const extraction: OutlookExtraction = {
      ...SAMPLE_EXTRACTION,
      data_gaps: ['a', 'b', 'c'],
    };
    const outlookWithGaps = {
      ...outlook,
      sidecar: { ...outlook.sidecar, evidence_gaps: ['x', 'y', 'z'] },
    };
    const result = validateOutlook(outlookWithGaps, extraction, SAMPLE_BAG);
    expect(result.ok).toBe(false);
  });

  it('assertValidOutlook throws on failure', () => {
    const outlook = makeOutlook('Too short.');
    expect(() => assertValidOutlook(outlook, SAMPLE_EXTRACTION, SAMPLE_BAG)).toThrow();
  });

  it('rejects stale manager names not verified in extraction', () => {
    const extraction: OutlookExtraction = {
      ...SAMPLE_EXTRACTION,
      current_head_coach: 'Xabi Alonso',
      verified_facts: ['Xabi Alonso is Chelsea head coach as of August 2026'],
    };
    const outlook = makeOutlook(
      'Estêvão is available and integrated into Enzo Maresca\'s attacking rotation at Chelsea, where the teenager profiles as an inverted winger with heavy 1v1 usage when selected. Near term minutes may fluctuate while Chelsea manage his load across competitions, though his direct dribbling offers genuine upside in open games. Longer term he remains a high-ceiling wide forward whose value tracks starting frequency and physical durability more than a reinvented role under a new coach.',
    );
    const result = validateOutlook(outlook, extraction, SAMPLE_BAG);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('unverified manager'))).toBe(true);
  });
});
