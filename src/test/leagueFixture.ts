/**
 * src/test/leagueFixture.ts
 *
 * A minimal league that passes every gate, so a route test only has to state
 * the one thing it is about.
 *
 * The defaults are deliberately boring and legal: one club with room on its
 * roster, an empty academy, a priced 30-year-old free agent, no listings, no
 * IR, no pending claims. A test that wants a refusal breaks exactly one of
 * those and asserts the message.
 *
 * Values match the shipped defaults rather than inventing round numbers, so a
 * test reads against the real economy: roster 22 (migration for the 2026-09-01
 * deadline update), academy 3, free-agent floor 50% (migration 095), IR 2
 * (migration 127).
 */

import type { Tables } from './supabaseFake';

export const USER_ID = 'user-me';
export const OTHER_USER_ID = 'user-rival';
export const LEAGUE_ID = 'league-1';
export const MY_TEAM_ID = 'team-me';
export const RIVAL_TEAM_ID = 'team-rival';
export const PLAYER_ID = 'player-target';

/** Old enough that academy eligibility is never accidentally in play. */
export function dobForAge(age: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate() - 1))
    .toISOString()
    .slice(0, 10);
}

export interface FixtureOptions {
  /** Active (non-IR, non-academy, non-loan-in) players already on my roster. */
  rosterCount?: number;
  faabBudget?: number;
  marketValue?: number | null;
  rosterLocked?: boolean;
}

export function leagueFixture(options: FixtureOptions = {}): Tables {
  const {
    rosterCount = 18,
    faabBudget = 200,
    marketValue = 40,
    rosterLocked = false,
  } = options;

  const rosterEntries = Array.from({ length: rosterCount }, (_, i) => ({
    id: `entry-${i}`,
    team_id: MY_TEAM_ID,
    player_id: `squad-${i}`,
    status: 'active',
  }));

  return {
    leagues: [
      {
        id: LEAGUE_ID,
        name: 'Test League',
        roster_size: 22,
        taxi_size: 3,
        taxi_age_limit: 21,
        ir_size: 2,
        roster_locked: rosterLocked,
        current_season: '2026-27',
        previous_season: '2025-26',
        free_agent_bid_floor: 0.5,
        auction_quiet_start: '01:00:00',
        auction_quiet_end: '08:00:00',
        auction_timezone: 'Europe/London',
      },
    ],
    teams: [
      {
        id: MY_TEAM_ID,
        league_id: LEAGUE_ID,
        user_id: USER_ID,
        team_name: 'My Club',
        abbreviation: 'MYC',
        faab_budget: faabBudget,
      },
      {
        id: RIVAL_TEAM_ID,
        league_id: LEAGUE_ID,
        user_id: OTHER_USER_ID,
        team_name: 'Rival Club',
        abbreviation: 'RIV',
        faab_budget: 200,
      },
    ],
    players: [
      {
        id: PLAYER_ID,
        name: 'Target Player',
        market_value: marketValue,
        date_of_birth: dobForAge(30),
        pl_team: 'Arsenal',
        primary_position: 'CM',
        secondary_positions: [],
        fpl_status: 'a',
        is_active: true,
      },
      // Every squad player the roster entries point at, so embedded selects
      // resolve instead of silently returning null.
      ...Array.from({ length: Math.max(rosterCount, 25) }, (_, i) => ({
        id: `squad-${i}`,
        name: `Squad Player ${i}`,
        market_value: 10,
        date_of_birth: dobForAge(27),
        pl_team: 'Everton',
        primary_position: 'CM',
        secondary_positions: [],
        fpl_status: 'a',
        is_active: true,
      })),
    ],
    roster_entries: rosterEntries,
    player_sale_listings: [],
    waiver_claims: [],
    auction_bid_events: [],
    player_loans: [],
    departure_decisions: [],
    trade_proposals: [],
    matchups: [],
    pending_drops: [],
    notifications: [],
  };
}
