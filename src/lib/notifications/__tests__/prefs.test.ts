import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  mergePref,
  resolvePrefs,
  wantsChannel,
} from '../prefs';

describe('resolvePrefs', () => {
  it('returns defaults for null', () => {
    expect(resolvePrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('returns defaults for junk', () => {
    expect(resolvePrefs('nope')).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(resolvePrefs([])).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('fills missing keys from defaults', () => {
    const resolved = resolvePrefs({ auctions: { push: false } });
    expect(resolved.auctions).toEqual({ push: false, email: true });
    expect(resolved.chat).toEqual({ push: true, email: false });
    expect(resolved.deals.push).toBe(true);
  });

  it('ignores unknown kinds', () => {
    const resolved = resolvePrefs({ mystery: { push: false, email: false } });
    expect(resolved).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

describe('wantsChannel', () => {
  it('uses defaults when prefs are null', () => {
    expect(wantsChannel(null, 'auctions', 'push')).toBe(true);
    expect(wantsChannel(null, 'chat', 'email')).toBe(false);
  });

  it('respects a stored off switch', () => {
    expect(wantsChannel({ deals: { push: false, email: true } }, 'deals', 'push')).toBe(false);
    expect(wantsChannel({ deals: { push: false, email: true } }, 'deals', 'email')).toBe(true);
  });

  it('sends on an unknown kind rather than dropping', () => {
    expect(wantsChannel(null, 'not-a-kind', 'push')).toBe(true);
    expect(wantsChannel({ auctions: { push: false } }, 'not-a-kind', 'email')).toBe(true);
  });
});

describe('mergePref', () => {
  it('flips one cell and leaves the rest on defaults', () => {
    const next = mergePref(null, 'matchdays', 'email', false);
    expect(next.matchdays.email).toBe(false);
    expect(next.matchdays.push).toBe(true);
    expect(next.auctions).toEqual(DEFAULT_NOTIFICATION_PREFS.auctions);
  });
});
