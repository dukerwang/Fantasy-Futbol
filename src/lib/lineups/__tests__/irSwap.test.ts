import { describe, it, expect } from 'vitest';

function isIrEligible(fplStatus: string | null | undefined): boolean {
    return fplStatus === 'i' || fplStatus === 'u' || fplStatus === 'd';
}

interface MockRosterEntry {
    id: string;
    player_id: string;
    status: 'active' | 'bench' | 'ir' | 'taxi' | 'loan_in' | 'loan_out';
    player: {
        id: string;
        name: string;
        fpl_status: string | null;
        date_of_birth?: string | null;
        pl_team_id: number | null;
    };
}

interface ValidateIrSwapParams {
    entries: MockRosterEntry[];
    playerId: string;
    swapWithPlayerId: string;
    lockedTeamIds?: Set<number>;
}

function validateIrSwap({ entries, playerId, swapWithPlayerId, lockedTeamIds }: ValidateIrSwapParams): { valid: boolean; error?: string; incomingId?: string; outgoingId?: string } {
    if (!playerId || !swapWithPlayerId || playerId === swapWithPlayerId) {
        return { valid: false, error: 'Missing or invalid swap player' };
    }

    if (entries.length !== 2) {
        return { valid: false, error: 'Both players must be on your roster' };
    }

    const entry1 = entries.find((e) => e.player_id === playerId);
    const entry2 = entries.find((e) => e.player_id === swapWithPlayerId);
    if (!entry1 || !entry2) {
        return { valid: false, error: 'Both players must be on your roster' };
    }

    let incomingEntry = entry1;
    let outgoingEntry = entry2;
    if (incomingEntry.status === 'ir' && outgoingEntry.status !== 'ir') {
        incomingEntry = entry2;
        outgoingEntry = entry1;
    }

    if (incomingEntry.status === 'ir') {
        return { valid: false, error: 'Both players are already on IR' };
    }
    if (outgoingEntry.status !== 'ir') {
        return { valid: false, error: 'Target player is not currently on IR' };
    }
    if (incomingEntry.status === 'loan_in' || incomingEntry.status === 'loan_out') {
        return { valid: false, error: 'Cannot move loaned players to IR' };
    }

    if (lockedTeamIds) {
        if (incomingEntry.player.pl_team_id && lockedTeamIds.has(incomingEntry.player.pl_team_id)) {
            return { valid: false, error: `Cannot change IR status for ${incomingEntry.player.name} — their match has already kicked off.` };
        }
        if (outgoingEntry.player.pl_team_id && lockedTeamIds.has(outgoingEntry.player.pl_team_id)) {
            return { valid: false, error: `Cannot change IR status for ${outgoingEntry.player.name} — their match has already kicked off.` };
        }
    }

    if (!isIrEligible(incomingEntry.player.fpl_status)) {
        return { valid: false, error: 'Player is not eligible for IR. They must be officially Injured (i) or Unavailable (u).' };
    }

    return { valid: true, incomingId: incomingEntry.id, outgoingId: outgoingEntry.id };
}

describe('isIrEligible', () => {
    it('returns true for injured (i), unavailable (u), doubtful (d)', () => {
        expect(isIrEligible('i')).toBe(true);
        expect(isIrEligible('u')).toBe(true);
        expect(isIrEligible('d')).toBe(true);
    });

    it('returns false for available (a), suspended (s), null, undefined', () => {
        expect(isIrEligible('a')).toBe(false);
        expect(isIrEligible('s')).toBe(false);
        expect(isIrEligible(null)).toBe(false);
        expect(isIrEligible(undefined)).toBe(false);
    });
});

describe('validateIrSwap', () => {
    const mockEntries: MockRosterEntry[] = [
        {
            id: 'entry-1',
            player_id: 'p1',
            status: 'bench',
            player: { id: 'p1', name: 'Bukayo Saka', fpl_status: 'i', pl_team_id: 1 },
        },
        {
            id: 'entry-2',
            player_id: 'p2',
            status: 'ir',
            player: { id: 'p2', name: 'Martin Odegaard', fpl_status: 'a', pl_team_id: 1 },
        },
    ];

    it('allows swapping an injured bench player with an active IR player', () => {
        const result = validateIrSwap({
            entries: mockEntries,
            playerId: 'p1',
            swapWithPlayerId: 'p2',
        });
        expect(result.valid).toBe(true);
        expect(result.incomingId).toBe('entry-1');
        expect(result.outgoingId).toBe('entry-2');
    });

    it('handles reversed argument order (IR player first, bench player second)', () => {
        const result = validateIrSwap({
            entries: mockEntries,
            playerId: 'p2',
            swapWithPlayerId: 'p1',
        });
        expect(result.valid).toBe(true);
        expect(result.incomingId).toBe('entry-1');
        expect(result.outgoingId).toBe('entry-2');
    });

    it('rejects if incoming player is not injured', () => {
        const healthyEntries: MockRosterEntry[] = [
            {
                id: 'entry-1',
                player_id: 'p1',
                status: 'bench',
                player: { id: 'p1', name: 'Bukayo Saka', fpl_status: 'a', pl_team_id: 1 },
            },
            {
                id: 'entry-2',
                player_id: 'p2',
                status: 'ir',
                player: { id: 'p2', name: 'Martin Odegaard', fpl_status: 'a', pl_team_id: 1 },
            },
        ];
        const result = validateIrSwap({
            entries: healthyEntries,
            playerId: 'p1',
            swapWithPlayerId: 'p2',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not eligible for IR');
    });

    it('rejects if both players are on IR', () => {
        const doubleIrEntries: MockRosterEntry[] = [
            {
                id: 'entry-1',
                player_id: 'p1',
                status: 'ir',
                player: { id: 'p1', name: 'Bukayo Saka', fpl_status: 'i', pl_team_id: 1 },
            },
            {
                id: 'entry-2',
                player_id: 'p2',
                status: 'ir',
                player: { id: 'p2', name: 'Martin Odegaard', fpl_status: 'i', pl_team_id: 1 },
            },
        ];
        const result = validateIrSwap({
            entries: doubleIrEntries,
            playerId: 'p1',
            swapWithPlayerId: 'p2',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Both players are already on IR');
    });

    it('rejects if neither player is on IR', () => {
        const noIrEntries: MockRosterEntry[] = [
            {
                id: 'entry-1',
                player_id: 'p1',
                status: 'bench',
                player: { id: 'p1', name: 'Bukayo Saka', fpl_status: 'i', pl_team_id: 1 },
            },
            {
                id: 'entry-2',
                player_id: 'p2',
                status: 'bench',
                player: { id: 'p2', name: 'Martin Odegaard', fpl_status: 'a', pl_team_id: 1 },
            },
        ];
        const result = validateIrSwap({
            entries: noIrEntries,
            playerId: 'p1',
            swapWithPlayerId: 'p2',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Target player is not currently on IR');
    });

    it('rejects if incoming player is loaned in', () => {
        const loanedEntries: MockRosterEntry[] = [
            {
                id: 'entry-1',
                player_id: 'p1',
                status: 'loan_in',
                player: { id: 'p1', name: 'Bukayo Saka', fpl_status: 'i', pl_team_id: 1 },
            },
            {
                id: 'entry-2',
                player_id: 'p2',
                status: 'ir',
                player: { id: 'p2', name: 'Martin Odegaard', fpl_status: 'a', pl_team_id: 1 },
            },
        ];
        const result = validateIrSwap({
            entries: loanedEntries,
            playerId: 'p1',
            swapWithPlayerId: 'p2',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Cannot move loaned players to IR');
    });

    it('rejects if a player is kickoff-locked', () => {
        const lockedResult = validateIrSwap({
            entries: mockEntries,
            playerId: 'p1',
            swapWithPlayerId: 'p2',
            lockedTeamIds: new Set([1]),
        });
        expect(lockedResult.valid).toBe(false);
        expect(lockedResult.error).toContain('their match has already kicked off');
    });
});
