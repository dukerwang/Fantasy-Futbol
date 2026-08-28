import { describe, it, expect } from 'vitest';
import { clubAbbr, clubName } from '../clubRef';
import {
  auctionLostNotice,
  bidPlacedNotice,
  droppedNotice,
  listedNotice,
  outbidNotice,
  timeLeft,
} from '../copy';

const vdp = { team_name: 'Vardy Party', abbreviation: 'VDP' };
const unnamed = { team_name: 'Holloway Utd', abbreviation: null };

describe('clubRef', () => {
  it('uses the abbreviation when the club has one', () => {
    expect(clubAbbr(vdp)).toBe('VDP');
    expect(clubName(vdp)).toBe('Vardy Party');
  });

  it('falls back to the full name when there is no abbreviation', () => {
    expect(clubAbbr(unnamed)).toBe('Holloway Utd');
  });
});

describe('timeLeft', () => {
  const now = Date.parse('2026-08-25T12:00:00.000Z');

  it('returns hours under a day and a half, days after that', () => {
    expect(timeLeft(now + 24 * 3600_000, now)).toBe('24h left');
    expect(timeLeft(now + 4 * 3600_000, now)).toBe('4h left');
    expect(timeLeft(now + 72 * 3600_000, now)).toBe('3d left');
  });

  it('drops to minutes, then closing now', () => {
    expect(timeLeft(now + 47 * 60_000, now)).toBe('47m left');
    expect(timeLeft(now + 30_000, now)).toBe('closing now');
  });

  it('returns null when the clock has already hit zero', () => {
    expect(timeLeft(now - 1000, now)).toBeNull();
    expect(timeLeft(null, now)).toBeNull();
  });
});

describe('bid and market notices', () => {
  const in24h = Date.now() + 24 * 3600_000;
  const in72h = Date.now() + 72 * 3600_000;

  it('names the bidder and that the auction just opened, with time left', () => {
    const n = bidPlacedNotice(vdp, 'Bukayo Saka', 45, in24h);
    expect(n.title).toBe('VDP bid for Bukayo Saka');
    expect(n.pushTitle).toBe('VDP bid for Bukayo Saka');
    expect(n.content).toBe(
      '**Vardy Party** have bid **€45m** for **Bukayo Saka**. Auction open — 24h left.',
    );
    expect(n.pushBody).toBe('€45m · auction open, 24h left');
  });

  it('names who outbid you and how long you have to answer', () => {
    const n = outbidNotice(vdp, 'Bukayo Saka', 50, in24h);
    expect(n.title).toBe('Outbid by VDP');
    expect(n.pushTitle).toBe('Outbid · VDP');
    expect(n.content).toBe(
      '**Vardy Party** have gone to **€50m** for **Bukayo Saka**. 24h left to bid.',
    );
    expect(n.pushBody).toBe('Bukayo Saka now €50m. 24h left to bid.');

    const closingNotice = outbidNotice(vdp, 'Bukayo Saka', 50, Date.now() + 30_000);
    expect(closingNotice.content).toBe(
      '**Vardy Party** have gone to **€50m** for **Bukayo Saka**. Closing now. Bid to take the lead.',
    );
    expect(closingNotice.pushBody).toBe('Bukayo Saka now €50m. Closing now.');
  });

  it('falls back to the full club name in the title when there is no abbr', () => {
    const n = bidPlacedNotice(unnamed, 'Cole Palmer', 30);
    expect(n.title).toBe('Holloway Utd bid for Cole Palmer');
    expect(n.pushTitle).toBe('Holloway Utd bid for Cole Palmer');
    expect(n.content).toContain('Auction now open.');
  });

  it('names the selling club and only starts an auction clock when bidding is open', () => {
    const listed = listedNotice(vdp, 'Erling Haaland', ' (min bid €80m)', {
      auctionOpen: true,
      expiresAt: in72h,
    });
    expect(listed.title).toBe('VDP list Erling Haaland');
    expect(listed.pushTitle).toBe('VDP list Erling Haaland');
    expect(listed.content).toContain('Auction open — 3d left.');
    expect(listed.pushBody).toBe('Erling Haaland listed. 3d left to bid.');

    const askOnly = listedNotice(vdp, 'Erling Haaland', ' (asking €90m)');
    expect(askOnly.content).toBe(
      '**Vardy Party** have listed **Erling Haaland** for sale (asking €90m).',
    );
    expect(askOnly.content).not.toContain('Auction open');
  });

  it('names the club that released a player into auction, with time left', () => {
    const n = droppedNotice(vdp, 'Ollie Watkins', in72h);
    expect(n.title).toBe('VDP release Ollie Watkins');
    expect(n.pushTitle).toBe('VDP release Ollie Watkins');
    expect(n.content).toContain('**Vardy Party** have released **Ollie Watkins**');
    expect(n.content).toContain('Auction open — 3d left.');
    expect(n.content).not.toMatch(/waiver/i);
    expect(n.pushBody).toBe('Ollie Watkins in auction. 3d left to bid.');
  });

  it('tells a losing bidder who signed the player, and at what fee', () => {
    const n = auctionLostNotice(vdp, 'Bukayo Saka', 55, 50);
    expect(n.title).toBe('Lost to VDP');
    expect(n.content).toBe(
      "**Vardy Party** signed **Bukayo Saka** for **€55m**. Your bid of **€50m** wasn't enough.",
    );
    expect(n.pushBody).toBe('Bukayo Saka to VDP for €55m.');
  });
});
