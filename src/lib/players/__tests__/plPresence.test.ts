/**
 * Gaffa — PL presence guard
 *
 * `recordDepartures` trusts `players.is_active = false` only after re-checking
 * it against this guard, because the sync's own matching has previously
 * mislabeled still-active players as departed (Murillo, Joelinton, Konaté,
 * Gordon — see plPresence.ts's module doc). These tests pin the two directions
 * that matter for a real departure to register correctly:
 *   1. A player who genuinely left must NOT spuriously match anyone still in
 *      the live FPL squad list (or `recordDepartures` would refuse to open his
 *      decision).
 *   2. A player whose DB row was merely corrupted by a bad sync (right `name`,
 *      wrong `web_name`/element) must still be found "still in PL", exactly
 *      reproducing the fix for the Konaté/Gordon incidents.
 *
 * Rodrigo "Rodri" Hernández Cascante (Man City, DM) is used as the live case
 * this module needs to get right next.
 */

import { describe, it, expect } from 'vitest';
import { looksLikeSamePlayer, findStillInPl, type FplElement } from '../plPresence';

function element(first_name: string, second_name: string, overrides: Partial<FplElement> = {}): FplElement {
    return { id: 1, first_name, second_name, web_name: second_name, team: 1, ...overrides };
}

describe('looksLikeSamePlayer — real departure must not be blocked', () => {
    it('does not match Rodri against an unrelated current PL player', () => {
        const stillPlaying = element('Erling', 'Haaland');
        expect(looksLikeSamePlayer("Rodrigo 'Rodri' Hernandez Cascante", stillPlaying)).toBe(false);
    });

    it('does not match Rodri against a different Rodrigo (Bentancur) still in the PL', () => {
        const otherRodrigo = element('Rodrigo', 'Bentancur');
        expect(looksLikeSamePlayer("Rodrigo 'Rodri' Hernandez Cascante", otherRodrigo)).toBe(false);
    });

    it('matches Rodri against himself when he is still present in the bootstrap', () => {
        const himself = element('Rodrigo', 'Hernandez Cascante', { web_name: 'Rodrigo' });
        expect(looksLikeSamePlayer("Rodrigo 'Rodri' Hernandez Cascante", himself)).toBe(true);
    });
});

describe('looksLikeSamePlayer — corrupted-row self-heal (documented incidents)', () => {
    it('still finds Konaté via first/second name even though the row inherited "Endo" as web_name', () => {
        // Reproduces the exact corruption: the FPL element that actually is
        // Ibrahima Konaté, matched by name even though some other sync path
        // left an unrelated web_name lying around on our stored row.
        const realKonate = element('Ibrahima', 'Konaté', { web_name: 'Endo' });
        expect(looksLikeSamePlayer('Ibrahima Konaté', realKonate)).toBe(true);
    });

    it('still finds Gordon via first/second name despite a corrupted web_name of "Bakwa"', () => {
        const realGordon = element('Anthony', 'Gordon', { web_name: 'Bakwa' });
        expect(looksLikeSamePlayer('Anthony Gordon', realGordon)).toBe(true);
    });

    it('matches a mononym stored name against its full first+second name element', () => {
        const fullName = element('Murillo', 'Costa dos Santos');
        expect(looksLikeSamePlayer('Murillo', fullName)).toBe(true);
    });

    it('treats "Silva" as a non-identifying particle, so two different Silvas do not falsely match', () => {
        const otherSilva = element('Rúben', 'Silva');
        expect(looksLikeSamePlayer('Bernardo Silva', otherSilva)).toBe(false);
    });
});

describe('findStillInPl', () => {
    it('flags only the players whose stored name still resolves to a live element', () => {
        const rodri = { id: 'rodri-id', name: "Rodrigo 'Rodri' Hernandez Cascante" };
        const goneForReal = { id: 'departed-id', name: 'A Departed Player' };
        const elements = [element('Erling', 'Haaland'), element('Rodrigo', 'Hernandez Cascante')];

        const hits = findStillInPl([rodri, goneForReal], elements);

        expect(hits.has('rodri-id')).toBe(true);
        expect(hits.has('departed-id')).toBe(false);
    });

    it('returns an empty map once a player is genuinely gone from the bootstrap', () => {
        const rodri = { id: 'rodri-id', name: "Rodrigo 'Rodri' Hernandez Cascante" };
        const elements = [element('Erling', 'Haaland'), element('Rodrigo', 'Bentancur')];

        const hits = findStillInPl([rodri], elements);

        expect(hits.size).toBe(0);
    });
});
