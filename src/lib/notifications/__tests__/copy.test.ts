import { describe, it, expect } from 'vitest';
import { clubAbbr, clubName } from '../clubRef';
import {
  auctionLostNotice,
  bidPlacedNotice,
  droppedNotice,
  listedNotice,
  outbidNotice,
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

describe('bid and market notices', () => {
  it('names the bidder in a first-bid alert, abbr on the short lines', () => {
    const n = bidPlacedNotice(vdp, 'Bukayo Saka', 45);
    expect(n.title).toBe('VDP bid for Bukayo Saka');
    expect(n.pushTitle).toBe('VDP €45m');
    expect(n.content).toBe('**Vardy Party** have bid **€45m** for **Bukayo Saka**.');
  });

  it('names who outbid you, not just the new price', () => {
    const n = outbidNotice(vdp, 'Bukayo Saka', 50);
    expect(n.title).toBe('Outbid by VDP');
    expect(n.pushTitle).toBe('Outbid · VDP');
    expect(n.content).toContain('**Vardy Party** have gone to **€50m**');
    expect(n.content).toContain('Bukayo Saka');
  });

  it('falls back to the full club name in the title when there is no abbr', () => {
    const n = bidPlacedNotice(unnamed, 'Cole Palmer', 30);
    expect(n.title).toBe('Holloway Utd bid for Cole Palmer');
    expect(n.pushTitle).toBe('Holloway Utd €30m');
  });

  it('names the selling club on a new listing', () => {
    const n = listedNotice(vdp, 'Erling Haaland', ' (min bid €80m)');
    expect(n.title).toBe('VDP list Erling Haaland');
    expect(n.content).toBe('**Vardy Party** have listed **Erling Haaland** for sale (min bid €80m).');
  });

  it('names the club that released a player into auction', () => {
    const n = droppedNotice(vdp, 'Ollie Watkins');
    expect(n.title).toBe('VDP release Ollie Watkins');
    expect(n.content).toContain('**Vardy Party** have released **Ollie Watkins**');
    expect(n.content).not.toMatch(/waiver/i);
  });

  it('tells a losing bidder who signed the player, and at what fee', () => {
    const n = auctionLostNotice(vdp, 'Bukayo Saka', 55, 50);
    expect(n.title).toBe('Lost to VDP');
    expect(n.content).toBe(
      "**Vardy Party** signed **Bukayo Saka** for **€55m**. Your bid of **€50m** wasn't enough.",
    );
  });
});
