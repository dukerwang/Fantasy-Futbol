/**
 * Gaffa — listing stance headline
 *
 * Since migration 114 a listing's three PRICE fields (min_bid, buy_now_price,
 * ask_price) determine its mechanism, and that mechanism dominates the
 * headline: a listing with no min_bid has no open auction at all, which is
 * worth saying before whatever the seller's cash/players/loan intent is.
 * These tests pin that priority and the existing intent-chip behaviour that
 * still applies once an auction exists.
 */

import { describe, it, expect } from 'vitest';
import { listingStance } from '../listingStance';

describe('listingStance — no auction (min_bid absent)', () => {
    it('states release-clause-only when a clause is set but no min_bid', () => {
        const stance = listingStance({
            open_to_trade: false,
            open_to_sale: true,
            open_to_loan: false,
            ask_price: null,
            min_bid: null,
            buy_now_price: 80,
        });
        expect(stance.tone).toBe('clause');
        expect(stance.headline).toBe('Release clause only · €80m');
    });

    it('states offers-only with the asking price when neither min_bid nor a clause is set', () => {
        const stance = listingStance({
            open_to_trade: false,
            open_to_sale: true,
            open_to_loan: false,
            ask_price: 60,
            min_bid: null,
            buy_now_price: null,
        });
        expect(stance.tone).toBe('offers');
        expect(stance.headline).toBe('Offers only · asking €60m');
    });

    it('states plain offers-only when no price at all is named', () => {
        const stance = listingStance({
            open_to_trade: false,
            open_to_sale: false,
            open_to_loan: false,
            ask_price: null,
            min_bid: null,
            buy_now_price: null,
        });
        expect(stance.tone).toBe('offers');
        expect(stance.headline).toBe('Offers only');
    });

    it('a clause takes priority over an ask price when both are set but min_bid is absent', () => {
        const stance = listingStance({
            open_to_trade: false,
            open_to_sale: true,
            open_to_loan: false,
            ask_price: 60,
            min_bid: null,
            buy_now_price: 80,
        });
        expect(stance.tone).toBe('clause');
        expect(stance.headline).toBe('Release clause only · €80m');
    });
});

describe('listingStance — open auction (min_bid set)', () => {
    it('falls back to the existing intent-chip headline, unchanged since 088', () => {
        const stance = listingStance({
            open_to_trade: false,
            open_to_sale: true,
            open_to_loan: false,
            ask_price: 95,
            min_bid: 80,
            buy_now_price: null,
        });
        expect(stance.tone).toBe('sale');
        expect(stance.headline).toBe('For sale · €95m');
    });

    it('reads "Open to approaches" when every intent chip is off, same as before 114', () => {
        const stance = listingStance({
            open_to_trade: false,
            open_to_sale: false,
            open_to_loan: false,
            ask_price: null,
            min_bid: 80,
            buy_now_price: null,
        });
        expect(stance.tone).toBe('open');
        expect(stance.headline).toBe('Open to approaches');
    });

    it('reads "Open to approaches" when every intent chip is on, same as ticking none', () => {
        const stance = listingStance({
            open_to_trade: true,
            open_to_sale: true,
            open_to_loan: true,
            ask_price: null,
            min_bid: 80,
            buy_now_price: null,
        });
        expect(stance.tone).toBe('open');
        expect(stance.headline).toBe('Open to approaches');
    });

    it('reads "Wants players" for a single players-only intent', () => {
        const stance = listingStance({
            open_to_trade: true,
            open_to_sale: false,
            open_to_loan: false,
            ask_price: null,
            min_bid: 80,
            buy_now_price: null,
        });
        expect(stance.tone).toBe('players');
        expect(stance.headline).toBe('Wants players');
    });

    it('reads "Would loan him out" for a single loan-only intent', () => {
        const stance = listingStance({
            open_to_trade: false,
            open_to_sale: false,
            open_to_loan: true,
            ask_price: null,
            min_bid: 80,
            buy_now_price: null,
        });
        expect(stance.tone).toBe('loan');
        expect(stance.headline).toBe('Would loan him out');
    });

    it('treats an ask of €0m as unnamed, same as a null ask', () => {
        const stance = listingStance({
            open_to_trade: false,
            open_to_sale: true,
            open_to_loan: false,
            ask_price: 0,
            min_bid: 80,
            buy_now_price: null,
        });
        expect(stance.headline).toBe('For sale');
    });
});
