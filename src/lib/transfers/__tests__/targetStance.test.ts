/**
 * Gaffa — target stance headline
 *
 * The demand-side mirror of `listingStance`. These tests exist mainly to pin
 * the inversion: the same three field NAMES mean the opposite thing here, so
 * a regression that quietly routed targets through `listingStance` would
 * print "For sale" on a club that is trying to BUY. Every cash case below
 * asserts the buying wording for that reason.
 */

import { describe, it, expect } from 'vitest';
import { targetStance } from '../targetStance';

describe('targetStance — single stated stance', () => {
    it('states the budget when a club will pay cash and named one', () => {
        const stance = targetStance({
            open_to_sale: true,
            open_to_trade: false,
            open_to_loan: false,
            budget: 25,
        });
        expect(stance.tone).toBe('cash');
        expect(stance.headline).toBe('Will pay cash · up to €25m');
    });

    it('drops the budget clause when a cash buyer named no figure', () => {
        const stance = targetStance({
            open_to_sale: true,
            open_to_trade: false,
            open_to_loan: false,
            budget: null,
        });
        expect(stance.tone).toBe('cash');
        expect(stance.headline).toBe('Will pay cash');
    });

    it('treats a budget of zero as unstated, not as a €0m offer', () => {
        const stance = targetStance({
            open_to_sale: true,
            open_to_trade: false,
            open_to_loan: false,
            budget: 0,
        });
        expect(stance.headline).toBe('Will pay cash');
    });

    it('states players when that is the only stance', () => {
        const stance = targetStance({
            open_to_sale: false,
            open_to_trade: true,
            open_to_loan: false,
        });
        expect(stance.tone).toBe('players');
        expect(stance.headline).toBe('Offering players');
    });

    it('states a loan when that is the only stance', () => {
        const stance = targetStance({
            open_to_sale: false,
            open_to_trade: false,
            open_to_loan: true,
        });
        expect(stance.tone).toBe('loan');
        expect(stance.headline).toBe('Would take him on loan');
    });
});

describe('targetStance — both or neither', () => {
    it('reads as open when every stance is ticked', () => {
        const stance = targetStance({
            open_to_sale: true,
            open_to_trade: true,
            open_to_loan: true,
            budget: 40,
        });
        expect(stance.tone).toBe('open');
        expect(stance.headline).toBe('Open to approaches');
    });

    it('reads as open when none is ticked', () => {
        const stance = targetStance({
            open_to_sale: false,
            open_to_trade: false,
            open_to_loan: false,
        });
        expect(stance.tone).toBe('open');
        expect(stance.headline).toBe('Open to approaches');
    });

    it('reads as open on any pair, since the reader cannot act on the difference', () => {
        const stance = targetStance({
            open_to_sale: true,
            open_to_trade: true,
            open_to_loan: false,
            budget: 30,
        });
        expect(stance.tone).toBe('open');
        expect(stance.headline).toBe('Open to approaches');
    });
});

describe('targetStance — the inversion against listingStance', () => {
    it('never describes the targeted player as being for sale', () => {
        // open_to_sale on a LISTING means "I want cash for him". Here it means
        // "I will pay cash for him". Same field, opposite speaker.
        const stance = targetStance({
            open_to_sale: true,
            open_to_trade: false,
            open_to_loan: false,
            budget: 25,
        });
        expect(stance.headline).not.toContain('For sale');
        expect(stance.headline).toContain('pay');
    });
});
