/**
 * Gaffa — role profile titles
 *
 * The titles are the entire visible payoff of the role field, so they are
 * pinned here: a profile card's headline IS `targetRoleTitle`, and a wrong
 * word order ("Left-Back Starting") or a lowercase noun would be the first
 * thing anybody sees on the board.
 */

import { describe, it, expect } from 'vitest';
import { targetRoleTitle, isTargetRole, TARGET_ROLES, TARGET_ROLE_OPTIONS } from '../targetRole';

describe('targetRoleTitle', () => {
    it('prefixes the role for star, starter and bench', () => {
        expect(targetRoleTitle('star', 'LB')).toBe('Star Left-Back');
        expect(targetRoleTitle('starter', 'LB')).toBe('Starting Left-Back');
        expect(targetRoleTitle('bench', 'LB')).toBe('Bench Left-Back');
    });

    it('puts prospect after the position, where English wants it', () => {
        expect(targetRoleTitle('prospect', 'LB')).toBe('Left-Back Prospect');
        expect(targetRoleTitle('prospect', 'ST')).toBe('Striker Prospect');
    });

    it('capitalises both halves of a hyphenated position', () => {
        expect(targetRoleTitle('starter', 'RWB')).toBe('Starting Right Wing-Back');
        expect(targetRoleTitle('star', 'CB')).toBe('Star Centre-Back');
    });

    it('handles the multi-word midfield positions', () => {
        expect(targetRoleTitle('starter', 'AM')).toBe('Starting Attacking Midfielder');
        expect(targetRoleTitle('bench', 'DM')).toBe('Bench Defensive Midfielder');
    });

    it('falls back to the bare position when no role is set', () => {
        expect(targetRoleTitle(null, 'GK')).toBe('Goalkeeper');
    });

    it('never renders an empty title for an unknown position', () => {
        expect(targetRoleTitle('starter', 'XX')).toBe('Starting Player');
    });
});

describe('TARGET_ROLES', () => {
    it('accepts only the four roles', () => {
        expect(TARGET_ROLES).toEqual(['star', 'starter', 'bench', 'prospect']);
        expect(isTargetRole('starter')).toBe(true);
        expect(isTargetRole('superstar')).toBe(false);
        expect(isTargetRole(null)).toBe(false);
    });

    it('offers every role in the editor, each with a distinguishing hint', () => {
        expect(TARGET_ROLE_OPTIONS.map((o) => o.role)).toEqual([...TARGET_ROLES]);
        const hints = TARGET_ROLE_OPTIONS.map((o) => o.hint);
        expect(new Set(hints).size).toBe(hints.length);
    });
});
