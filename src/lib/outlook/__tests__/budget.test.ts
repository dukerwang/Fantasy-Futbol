import { describe, expect, it } from 'vitest';
import { currentSpendMonth, monthlyCap, DEFAULT_MONTHLY_GROUNDED_CAP } from '@/lib/outlook/budget';

describe('spend month', () => {
  it('keys on the UTC calendar month, zero padded', () => {
    expect(currentSpendMonth(new Date('2026-08-31T23:00:00Z'))).toBe('2026-08');
    expect(currentSpendMonth(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
    // A local-time reading would roll this into September for anyone east of UTC.
    expect(currentSpendMonth(new Date('2026-08-31T23:59:59Z'))).toBe('2026-08');
  });
});

describe('monthly cap', () => {
  it('falls back to the default when unset or nonsense', () => {
    delete process.env.OUTLOOK_MONTHLY_GROUNDED_CAP;
    expect(monthlyCap()).toBe(DEFAULT_MONTHLY_GROUNDED_CAP);
    process.env.OUTLOOK_MONTHLY_GROUNDED_CAP = 'lots';
    expect(monthlyCap()).toBe(DEFAULT_MONTHLY_GROUNDED_CAP);
    delete process.env.OUTLOOK_MONTHLY_GROUNDED_CAP;
  });

  it('honours an explicit cap, including zero', () => {
    process.env.OUTLOOK_MONTHLY_GROUNDED_CAP = '40';
    expect(monthlyCap()).toBe(40);
    // Zero is a legitimate freeze, not "unset".
    process.env.OUTLOOK_MONTHLY_GROUNDED_CAP = '0';
    expect(monthlyCap()).toBe(0);
    delete process.env.OUTLOOK_MONTHLY_GROUNDED_CAP;
  });
});
