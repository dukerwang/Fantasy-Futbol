import { describe, expect, it } from 'vitest';
import { resolveSynthesisTemperature } from '../pipeline/synthesisTemperature';
import type { OutlookExtraction } from '../types/outlook';

function extraction(overrides: Partial<OutlookExtraction> = {}): OutlookExtraction {
  return {
    verified_facts: [],
    status_summary: '',
    role_summary: '',
    career_phase: 'unknown',
    data_gaps: [],
    conflicting_reports: [],
    current_head_coach: null,
    pl_mobility: 'unknown',
    mobility_summary: '',
    ...overrides,
  };
}

describe('resolveSynthesisTemperature', () => {
  it('returns lower temp when evidence is thin', () => {
    const thin = resolveSynthesisTemperature(extraction());
    const rich = resolveSynthesisTemperature(
      extraction({
        verified_facts: Array.from({ length: 8 }, (_, i) => `fact ${i}`),
        career_phase: 'peak',
      }),
    );
    expect(thin).toBeLessThan(rich);
    expect(thin).toBeGreaterThanOrEqual(0.5);
    expect(rich).toBeLessThanOrEqual(0.98);
  });

  it('penalizes data gaps and conflicts', () => {
    const base = resolveSynthesisTemperature(
      extraction({ verified_facts: ['a', 'b', 'c', 'd'], career_phase: 'peak' }),
    );
    const gappy = resolveSynthesisTemperature(
      extraction({
        verified_facts: ['a', 'b', 'c', 'd'],
        career_phase: 'peak',
        data_gaps: ['minutes', 'set pieces', 'fitness', 'competition'],
      }),
    );
    const conflicted = resolveSynthesisTemperature(
      extraction({
        verified_facts: ['a', 'b', 'c', 'd'],
        career_phase: 'peak',
        conflicting_reports: ['role unclear'],
      }),
    );
    expect(gappy).toBeLessThan(base);
    expect(conflicted).toBeLessThan(base);
  });

  it('honors fixed override', () => {
    expect(resolveSynthesisTemperature(extraction(), { fixed: 0.92 })).toBe(0.92);
  });

  it('applies reproducible jitter from seed', () => {
    const a = resolveSynthesisTemperature(extraction({ verified_facts: ['x'] }), {
      jitter: 0.05,
      jitterSeed: 'player-abc',
    });
    const b = resolveSynthesisTemperature(extraction({ verified_facts: ['x'] }), {
      jitter: 0.05,
      jitterSeed: 'player-abc',
    });
    const c = resolveSynthesisTemperature(extraction({ verified_facts: ['x'] }), {
      jitter: 0.05,
      jitterSeed: 'player-xyz',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
