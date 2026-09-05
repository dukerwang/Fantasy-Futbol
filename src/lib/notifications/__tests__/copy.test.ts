import { describe, it, expect } from 'vitest';
import { clubAbbr, clubName } from '../clubRef';
import {
  auctionLostNotice,
  bidPlacedNotice,
  bidRaisedNotice,
  buyNowTriggeredNotice,
  closingInNotice,
  droppedNotice,
  listedNotice,
  listingUnsoldNotice,
  loanFinalWeekNotice,
  outbidNotice,
  timeLeft,
  tradeCancelledByAuctionNotice,
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
    expect(n.pushBody).toBe('VDP bid €45m for Bukayo Saka. Auction open, 24h left.');
  });

  it('names who outbid you and how long you have to answer', () => {
    const n = outbidNotice(vdp, 'Bukayo Saka', 50, in24h);
    expect(n.title).toBe('Outbid by VDP');
    expect(n.pushTitle).toBe('Outbid on Bukayo Saka by VDP');
    expect(n.content).toBe(
      '**Vardy Party** have gone to **€50m** for **Bukayo Saka**. 24h left to bid.',
    );
    expect(n.pushBody).toBe('VDP outbid you on Bukayo Saka at €50m. 24h left to bid.');

    const closingNotice = outbidNotice(vdp, 'Bukayo Saka', 50, Date.now() + 30_000);
    expect(closingNotice.content).toBe(
      '**Vardy Party** have gone to **€50m** for **Bukayo Saka**. Closing now. Bid to take the lead.',
    );
    expect(closingNotice.pushBody).toBe('VDP outbid you on Bukayo Saka at €50m. Closing now. Bid to lead.');
  });

  it('notifies trailing prior bidders that the top price was raised', () => {
    const n = bidRaisedNotice(vdp, 'Ayyoub Bouaddi', 51, 40, in24h);
    expect(n.title).toBe('VDP raise to €51m for Ayyoub Bouaddi');
    expect(n.pushTitle).toBe('VDP raise on Ayyoub Bouaddi');
    expect(n.content).toBe(
      '**Vardy Party** have raised the top bid for **Ayyoub Bouaddi** to **€51m** (your bid: **€40m**). 24h left to bid.',
    );
    expect(n.pushBody).toBe('VDP raised the top bid on Ayyoub Bouaddi to €51m. 24h left to bid.');
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
    expect(listed.pushBody).toBe('Erling Haaland is listed by VDP. 3d left to bid.');

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
    expect(n.pushBody).toBe('VDP released Ollie Watkins. Auction open — 3d left.');
  });

  describe('auctionLostNotice (Romano-style)', () => {
    it('formats standard tier auction lost notice', () => {
      const n = auctionLostNotice(vdp, 'Bukayo Saka', 55, 50);
      expect(n.title).toBe('Lost to VDP');
      expect(n.pushTitle).toBe('Lost to VDP');
      expect(n.content).toBe(
        '**Bukayo Saka** to **Vardy Party** for **€55m**, here we go! Your bid was **€50m**.',
      );
      expect(n.pushBody).toBe('Bukayo Saka to VDP for €55m, here we go!');
    });

    it('formats blockbuster tier auction lost notice', () => {
      const n = auctionLostNotice(vdp, 'Cole Palmer', 85, 75);
      expect(n.title).toBe('Lost to VDP');
      expect(n.pushTitle).toBe('Blockbuster!');
      expect(n.content).toBe(
        '**Cole Palmer** to **Vardy Party** for **€85m**, HERE WE GO! Your bid was **€75m**.',
      );
      expect(n.pushBody).toBe('Cole Palmer to VDP for €85m, HERE WE GO!');
    });

    it('formats galactico tier auction lost notice', () => {
      const n = auctionLostNotice(vdp, 'Bradley Barcola', 135, 120);
      expect(n.title).toBe('Lost to VDP');
      expect(n.pushTitle).toBe('Galactico!');
      expect(n.content).toBe(
        'BREAKING: **Bradley Barcola** to **Vardy Party** for **€135m**... HERE WE GO! Your bid was **€120m**.',
      );
      expect(n.pushBody).toBe('BREAKING: Bradley Barcola to VDP for €135m... HERE WE GO!');
    });
  });

  describe('closingInNotice (Romano-style)', () => {
    const in2h = Date.now() + 2 * 3600_000;

    it('generates galactico alert for 100m+ deals', () => {
      const n = closingInNotice(vdp, 'Kylian Mbappé', 110, 120, in2h);
      expect(n.title).toBe('ADVANCING: VDP closing in on Kylian Mbappé');
      expect(n.pushTitle).toBe('ADVANCING: Kylian Mbappé · VDP');
      expect(n.content).toContain('**BREAKING:** **Vardy Party** are in advanced stages');
      expect(n.content).toContain('(**€110m**)');
      expect(n.pushBody).toBe('ADVANCING: Kylian Mbappé to VDP (€110m). 2h left to bid!');
    });

    it('generates blockbuster alert for 80m+ deals', () => {
      const n = closingInNotice(vdp, 'Cole Palmer', 85, 80, in2h);
      expect(n.title).toBe('Closing in: VDP on verge of Cole Palmer');
      expect(n.pushTitle).toBe('Closing in: Cole Palmer · VDP');
      expect(n.content).toContain('blockbuster agreement');
      expect(n.pushBody).toBe('Closing in: VDP lead for Cole Palmer at €85m. 2h left to bid!');
    });

    it('generates standard countdown for regular deals', () => {
      const n = closingInNotice(vdp, 'Alex Iwobi', 25, 20, in2h);
      expect(n.title).toBe('VDP closing in on Alex Iwobi');
      expect(n.content).toContain('lead the race for **Alex Iwobi** at **€25m**');
      expect(n.pushBody).toBe('Closing in: VDP lead for Alex Iwobi at €25m. 2h left to bid.');
    });
  });

  describe('buyNowTriggeredNotice (Romano-style)', () => {
    it('generates galactico alert for 100m+ release clause triggers', () => {
      const n = buyNowTriggeredNotice(vdp, 'Declan Rice', 105, 110);
      expect(n.title).toBe('Galactico! VDP trigger release clause for Declan Rice');
      expect(n.content).toContain('**BREAKING:** **Vardy Party** have triggered the **€105m** release clause for **Declan Rice**! Direct agreement completed... HERE WE GO!');
      expect(n.pushBody).toBe('BREAKING: Declan Rice to VDP (€105m). Release clause triggered... HERE WE GO!');
    });

    it('generates blockbuster alert for 80m+ release clause triggers', () => {
      const n = buyNowTriggeredNotice(vdp, 'Cole Palmer', 85, 80);
      expect(n.title).toBe('Blockbuster! VDP trigger release clause for Cole Palmer');
      expect(n.content).toContain('**Vardy Party** have triggered the **€85m** release clause for **Cole Palmer**! Agreement sealed, HERE WE GO!');
      expect(n.pushBody).toBe('Blockbuster: Cole Palmer to VDP (€85m). Release clause triggered, HERE WE GO!');
    });

    it('generates standard buyout alert for regular players', () => {
      const n = buyNowTriggeredNotice(vdp, 'Alex Iwobi', 20, 20);
      expect(n.title).toBe('VDP buy out Alex Iwobi');
      expect(n.content).toContain('**Vardy Party** have triggered the **€20m** buyout for **Alex Iwobi**. Agreement completed, here we go!');
      expect(n.pushBody).toBe('Alex Iwobi to VDP for €20m buyout, here we go!');
    });
  });

  describe('gap notices', () => {
    it('generates trade cancelled notice', () => {
      const n = tradeCancelledByAuctionNotice('Bukayo Saka');
      expect(n.title).toBe('Trade for Bukayo Saka called off');
      expect(n.content).toContain('gone into an open auction on the market');
    });

    it('generates listing unsold notice', () => {
      const n = listingUnsoldNotice('Bukayo Saka');
      expect(n.title).toBe('Listing for Bukayo Saka expired');
      expect(n.content).toContain('No one bid on');
    });

    it('generates loan final week notice', () => {
      const n = loanFinalWeekNotice('Sam Rook', vdp, unnamed, 15);
      expect(n.title).toBe("Sam Rook's loan enters its final week");
      expect(n.content).toContain('final matchweek (GW15)');
      expect(n.pushBody).toBe("Sam Rook's loan at Holloway Utd ends after GW15.");
    });
  });
});
