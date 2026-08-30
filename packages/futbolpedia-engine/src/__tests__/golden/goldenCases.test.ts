import { describe, expect, it } from 'vitest';
import { validateOutlook } from '../../gates/validateOutlook';
import { GOLDEN_CASES } from './goldenCases';

describe('golden outlook cases', () => {
  it('has at least 30 cases', () => {
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(30);
  });

  for (const c of GOLDEN_CASES) {
    it(`passes gates: ${c.id}`, () => {
      const result = validateOutlook(c.outlook, c.extraction, c.bag);
      expect(result.ok, result.reasons.join('; ')).toBe(true);

      for (const pattern of c.forbiddenPatterns ?? []) {
        expect(c.outlook.outlook).not.toMatch(pattern);
      }
    });
  }
});
