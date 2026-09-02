import { describe, expect, it } from 'vitest';
import { buildArrivalNotification } from '../valueTiers';

const BARCOLA = { name: 'Bradley Barcola', value: 90, club: 'Liverpool' };

describe('buildArrivalNotification', () => {
  it('leads with the player in every string, including the push', () => {
    const c = buildArrivalNotification([BARCOLA], '3d left');
    expect(c.title).toBe('Blockbuster Signing: Bradley Barcola');
    expect(c.pushTitle).toBe('Blockbuster: Bradley Barcola');
    expect(c.content).toBe('**Bradley Barcola to Liverpool** — On the market now! 3 days to bid.');
    expect(c.pushBody).toBe('Bradley Barcola to Liverpool. On the market now! 3 days to bid.');
  });

  /** The old copy opened on a count and the push never named anybody. */
  it('never opens on a count', () => {
    for (const label of [c1(), c2(), c3()]) {
      expect(label.title).not.toMatch(/^\d/);
      expect(label.pushTitle).not.toMatch(/^\d/);
    }
  });

  it('keeps the eyebrow in the title, which is what the inbox now styles on', () => {
    expect(buildArrivalNotification([BARCOLA], '3d left').title.toLowerCase())
      .toContain('blockbuster signing');
    expect(buildArrivalNotification([{ name: 'X', value: 120 }], '3d left').title.toLowerCase())
      .toContain('galactico arrival');
    // And the body no longer repeats it.
    expect(buildArrivalNotification([BARCOLA], '3d left').content.toLowerCase())
      .not.toContain('blockbuster signing');
  });

  it('names the biggest arrival and counts the rest', () => {
    const c = buildArrivalNotification(
      [{ name: 'Small', value: 12, club: 'Brentford' }, BARCOLA, { name: 'Mid', value: 30 }],
      '2d left',
    );
    expect(c.title).toBe('Blockbuster Signing: Bradley Barcola');
    expect(c.content).toContain('Plus 2 other arrivals');
  });

  it('names the player at standard tier too', () => {
    const c = buildArrivalNotification([{ name: 'Milos Kerkez', value: 45, club: 'Bournemouth' }], '12h left');
    expect(c.title).toBe('Milos Kerkez is on the market');
    expect(c.pushBody).toBe('Milos Kerkez to Bournemouth. On the market now! 12 hours to bid.');
  });

  it('leads on the biggest of a standard batch', () => {
    const c = buildArrivalNotification(
      [{ name: 'A', value: 10 }, { name: 'B', value: 40, club: 'Leeds' }],
      '1d left',
    );
    expect(c.title).toBe('B and 1 more on the market');
    expect(c.pushBody).toBe('B to Leeds, plus 1 more. On the market now! 1 day to bid.');
  });

  it('handles closing now, a missing clock, and a missing club', () => {
    expect(buildArrivalNotification([BARCOLA], 'closing now').pushBody).toBe('Bradley Barcola to Liverpool. Closing now!');
    expect(buildArrivalNotification([BARCOLA], null).pushBody).toBe('Bradley Barcola to Liverpool. On the market now!');
    expect(buildArrivalNotification([{ name: 'No Club', value: 90 }], '3d left').pushBody).toBe('No Club. On the market now! 3 days to bid.');
  });

  it('spells the window rather than abbreviating it', () => {
    expect(spellsOneDay('1d left')).toBe(true);
  });

  /**
   * The lot is announced when it is created, which for a deferred lot is hours
   * before it can be bid on. Barcola's notice went out at 05:22 saying "3d to
   * bid" for an auction that opened at noon.
   */
  it('announces the opening time rather than a window that is not open', () => {
    const c = buildArrivalNotification([BARCOLA], '3d left', 'Wed, 12:00');
    expect(c.content).toContain('Bidding opens Wed, 12:00.');
    expect(c.content).not.toContain('to bid');
    expect(c.pushBody).toBe('Bradley Barcola to Liverpool. Bidding opens Wed, 12:00.');
  });

  it('quotes the bidding window once the lot is already open', () => {
    const c = buildArrivalNotification([BARCOLA], '3d left', null);
    expect(c.pushBody).toBe('Bradley Barcola to Liverpool. On the market now! 3 days to bid.');
  });

  it('does not throw on an empty batch', () => {
    expect(buildArrivalNotification([], '1d left').title).toBe('New arrivals');
  });
});

const c1 = () => buildArrivalNotification([BARCOLA], '3d left');
const c2 = () => buildArrivalNotification([{ name: 'Solo', value: 20 }], '3d left');
const c3 = () => buildArrivalNotification([{ name: 'A', value: 20 }, { name: 'B', value: 10 }], '3d left');

const spellsOneDay = (label: string) =>
  buildArrivalNotification([{ name: 'P', value: 40 }], label).pushBody.includes('1 day to bid');
