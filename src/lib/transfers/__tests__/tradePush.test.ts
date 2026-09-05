import { describe, it, expect } from 'vitest';
import { summarizeTradeForPush } from '../tradePush';

describe('summarizeTradeForPush', () => {
  it('formats a 1-for-1 swap', () => {
    const res = summarizeTradeForPush({
      proposerAbbr: 'YANG',
      offeredPlayerNames: ['Cole Palmer'],
      requestedPlayerNames: ['Bukayo Saka'],
    });
    expect(res).toBe('YANG offered Cole Palmer for Bukayo Saka.');
  });

  it('formats a player + cash part-exchange', () => {
    const res = summarizeTradeForPush({
      proposerAbbr: 'YANG',
      offeredPlayerNames: ['Cole Palmer'],
      offeredFaab: 20,
      requestedPlayerNames: ['Bukayo Saka'],
    });
    expect(res).toBe('YANG offered Cole Palmer and €20m for Bukayo Saka.');
  });

  it('formats a multi-player trade (2-for-2)', () => {
    const res = summarizeTradeForPush({
      proposerAbbr: 'YANG',
      offeredPlayerNames: ['Cole Palmer', 'Declan Rice'],
      requestedPlayerNames: ['Bukayo Saka', 'William Saliba'],
    });
    expect(res).toBe('YANG offered Cole Palmer and Declan Rice for Bukayo Saka and William Saliba.');
  });

  it('summarizes a package with 3+ players cleanly', () => {
    const res = summarizeTradeForPush({
      proposerAbbr: 'YANG',
      offeredPlayerNames: ['Cole Palmer', 'Declan Rice', 'Pedro Neto'],
      offeredFaab: 10,
      requestedPlayerNames: ['Bukayo Saka'],
    });
    expect(res).toBe('YANG offered Cole Palmer + 2 players and €10m for Bukayo Saka.');
  });

  it('formats a cash-only bid', () => {
    const res = summarizeTradeForPush({
      proposerAbbr: 'YANG',
      offeredPlayerNames: [],
      offeredFaab: 45,
      requestedPlayerNames: ['Bukayo Saka'],
    });
    expect(res).toBe('YANG offered €45m for Bukayo Saka.');
  });

  it('formats a counter offer', () => {
    const res = summarizeTradeForPush({
      proposerAbbr: 'YANG',
      offeredPlayerNames: ['Cole Palmer'],
      offeredFaab: 10,
      requestedPlayerNames: ['Bukayo Saka'],
      isCounter: true,
    });
    expect(res).toBe('YANG countered: Cole Palmer and €10m for Bukayo Saka.');
  });

  it('includes retained rights', () => {
    const res = summarizeTradeForPush({
      proposerAbbr: 'YANG',
      offeredPlayerNames: ['Cole Palmer'],
      offeredRightsCount: 1,
      requestedPlayerNames: ['Bukayo Saka'],
    });
    expect(res).toBe('YANG offered Cole Palmer and 1 retained right for Bukayo Saka.');
  });
});
