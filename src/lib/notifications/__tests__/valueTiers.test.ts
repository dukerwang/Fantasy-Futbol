import { describe, expect, it } from 'vitest';
import { buildArrivalNotification } from '../valueTiers';

const BARCOLA = { name: 'Bradley Barcola', value: 90, club: 'Liverpool' };

describe('buildArrivalNotification', () => {
  it('leads with the player in every string, including the push', () => {
    const c = buildArrivalNotification([BARCOLA], '3d');
    expect(c.title).toBe('Blockbuster Signing: Bradley Barcola');
    expect(c.pushTitle).toBe('Blockbuster: Bradley Barcola');
    expect(c.content).toContain('**Bradley Barcola**');
    expect(c.content).toContain('€90m to Liverpool');
    expect(c.pushBody).toBe('€90m to Liverpool. 3d to bid.');
  });

  /** The old copy opened on a count and the push never named anybody. */
  it('never opens on a count', () => {
    for (const label of [c1(), c2(), c3()]) {
      expect(label.title).not.toMatch(/^\d/);
      expect(label.pushTitle).not.toMatch(/^\d/);
    }
  });

  it('keeps the eyebrow the inbox styles on', () => {
    // InboxClient.isHypeAlert lowercases content and looks for this phrase.
    expect(buildArrivalNotification([BARCOLA], '3d').content.toLowerCase())
      .toContain('blockbuster signing');
    expect(buildArrivalNotification([{ name: 'X', value: 120 }], '3d').content.toLowerCase())
      .toContain('galactico arrival');
  });

  it('names the biggest arrival and counts the rest', () => {
    const c = buildArrivalNotification(
      [{ name: 'Small', value: 12, club: 'Brentford' }, BARCOLA, { name: 'Mid', value: 30 }],
      '2d',
    );
    expect(c.title).toBe('Blockbuster Signing: Bradley Barcola');
    expect(c.content).toContain('Plus 2 other arrivals');
  });

  it('names the player at standard tier too', () => {
    const c = buildArrivalNotification([{ name: 'Milos Kerkez', value: 45, club: 'Bournemouth' }], '12h');
    expect(c.title).toBe('Milos Kerkez is on the market');
    expect(c.pushBody).toBe('€45m to Bournemouth. 12h to bid.');
  });

  it('leads on the biggest of a standard batch', () => {
    const c = buildArrivalNotification(
      [{ name: 'A', value: 10 }, { name: 'B', value: 40, club: 'Leeds' }],
      '1d',
    );
    expect(c.title).toBe('B and 1 more on the market');
    expect(c.pushBody).toBe('Led by B, €40m. 1d to bid.');
  });

  it('handles closing now, a missing clock, and a missing club', () => {
    expect(buildArrivalNotification([BARCOLA], 'closing now').pushBody).toBe('€90m to Liverpool. Closing now.');
    expect(buildArrivalNotification([BARCOLA], null).pushBody).toBe('€90m to Liverpool. Open now.');
    expect(buildArrivalNotification([{ name: 'No Club', value: 90 }], '3d').pushBody).toBe('€90m. 3d to bid.');
  });

  it('drops a trailing zero from a fractional fee', () => {
    expect(buildArrivalNotification([{ name: 'P', value: 4.5 }], '1d').pushBody).toContain('€4.5m');
    expect(buildArrivalNotification([{ name: 'P', value: 40 }], '1d').pushBody).toContain('€40m');
  });

  /**
   * The lot is announced when it is created, which for a deferred lot is hours
   * before it can be bid on. Barcola's notice went out at 05:22 saying "3d to
   * bid" for an auction that opened at noon.
   */
  it('announces the opening time rather than a window that is not open', () => {
    const c = buildArrivalNotification([BARCOLA], '3d', 'Wed, 12:00');
    expect(c.content).toContain('Bidding opens Wed, 12:00.');
    expect(c.content).not.toContain('3d to bid');
    expect(c.pushBody).toBe('€90m to Liverpool. Bidding opens Wed, 12:00.');
  });

  it('quotes the bidding window once the lot is already open', () => {
    const c = buildArrivalNotification([BARCOLA], '3d', null);
    expect(c.pushBody).toBe('€90m to Liverpool. 3d to bid.');
  });

  it('does not throw on an empty batch', () => {
    expect(buildArrivalNotification([], '1d').title).toBe('New arrivals');
  });
});

const c1 = () => buildArrivalNotification([BARCOLA], '3d');
const c2 = () => buildArrivalNotification([{ name: 'Solo', value: 20 }], '3d');
const c3 = () => buildArrivalNotification([{ name: 'A', value: 20 }, { name: 'B', value: 10 }], '3d');
