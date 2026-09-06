/**
 * Proposing a loan.
 *
 * The caps are the point: one loan out per club, two in, counted across
 * `active`, `accepted_deferred` and `pending_activation` so a loan that has
 * been agreed but has not started yet still occupies its slot. Both are league
 * settings with those defaults (migration 060).
 *
 * The rest of the gauntlet is timing and eligibility: duration between 4 and
 * 16 gameweeks, nothing starting inside the last eight of the season, academy
 * players loanable but IR and already-loaned players not, and a hard refusal
 * once bidding is live on the player.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, createFakeServerClient, type FakeClient, type Tables } from '@/test/supabaseFake';
import {
  LEAGUE_ID,
  MY_TEAM_ID,
  OTHER_USER_ID,
  RIVAL_TEAM_ID,
  USER_ID,
  leagueFixture,
} from '@/test/leagueFixture';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  admin: null as any,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeServerClient(state.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.admin,
}));
vi.mock('@/lib/notifications/createNotification', () => ({
  createNotification: vi.fn(async () => {}),
}));

import { POST } from '../route';

let admin: FakeClient;

const LOANEE = 'squad-1';

function setup(mutate: (tables: Tables) => void = () => {}) {
  const tables = leagueFixture();
  tables.chat_messages = [];
  mutate(tables);
  admin = createFakeSupabase(tables, {});
  state.admin = admin;
  return tables;
}

/** Terms that clear every gate, so a test can break exactly one. */
function terms(overrides: Record<string, unknown> = {}) {
  return {
    borrowerTeamId: RIVAL_TEAM_ID,
    playerId: LOANEE,
    loanFee: 5,
    startGameweek: 5,
    endGameweek: 13,
    bonusRate: 0,
    hasRecall: true,
    ...overrides,
  };
}

async function propose(body: Record<string, unknown>) {
  const req = { json: async () => body } as any;
  const res = await POST(req, { params: Promise.resolve({ leagueId: LEAGUE_ID }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.user = { id: USER_ID };
  // The handler fetches the FPL bootstrap to derive the current gameweek, but
  // never reads the result. Stubbed so the suite makes no network calls.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: [] }) })));
  setup();
});

describe('auth and the shape of a proposal', () => {
  it('rejects an unauthenticated caller', async () => {
    state.user = null;
    expect((await propose(terms())).status).toBe(401);
  });

  it('refuses a caller with no club in this league', async () => {
    setup((t) => { t.teams = t.teams.filter((x) => x.user_id !== USER_ID); });
    expect((await propose(terms())).status).toBe(403);
  });

  it('requires the full set of terms', async () => {
    expect((await propose(terms({ borrowerTeamId: undefined }))).status).toBe(400);
    expect((await propose(terms({ playerId: undefined }))).status).toBe(400);
    expect((await propose(terms({ hasRecall: undefined }))).status).toBe(400);
  });

  it('refuses a loan to yourself', async () => {
    const res = await propose(terms({ borrowerTeamId: MY_TEAM_ID }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot loan a player to yourself');
  });

  it('refuses a request for your own player', async () => {
    const res = await propose(terms({ requestMode: true, lenderTeamId: MY_TEAM_ID }));
    expect(res.status).toBe(400);
    // The handler has a friendlier message for this case ("use Propose Loan
    // instead"), but it can never fire: in request mode the caller is always
    // the borrower, so lending to yourself is also borrowing from yourself and
    // the self-loan check above catches it first. Asserted as it behaves.
    expect(res.body.error).toBe('Cannot loan a player to yourself');
  });

  it('refuses a fractional or negative fee', async () => {
    expect((await propose(terms({ loanFee: 2.5 }))).status).toBe(400);
    expect((await propose(terms({ loanFee: -1 }))).status).toBe(400);
  });

  it('refuses a negative bonus rate', async () => {
    expect((await propose(terms({ bonusRate: -0.1 }))).status).toBe(400);
  });

  it('refuses fractional gameweeks', async () => {
    expect((await propose(terms({ startGameweek: 5.5 }))).status).toBe(400);
  });
});

describe('duration and season timing', () => {
  it('refuses a loan that ends before it starts', async () => {
    const res = await propose(terms({ startGameweek: 10, endGameweek: 10 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/greater than startGameweek/);
  });

  it('refuses a loan shorter than four gameweeks', async () => {
    const res = await propose(terms({ startGameweek: 5, endGameweek: 8 }));
    expect(res.body.error).toBe('Loan duration must be between 4 and 16 gameweeks');
  });

  it('refuses a loan longer than sixteen', async () => {
    const res = await propose(terms({ startGameweek: 5, endGameweek: 22 }));
    expect(res.body.error).toBe('Loan duration must be between 4 and 16 gameweeks');
  });

  it('accepts both ends of the allowed range', async () => {
    expect((await propose(terms({ startGameweek: 5, endGameweek: 9 }))).status).toBe(201);
    setup();
    expect((await propose(terms({ startGameweek: 5, endGameweek: 21 }))).status).toBe(201);
  });

  it('refuses a loan starting inside the final eight gameweeks', async () => {
    const res = await propose(terms({ startGameweek: 31, endGameweek: 35 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot start after GW30/);
  });

  it('refuses a loan running past the end of the season', async () => {
    const res = await propose(terms({ startGameweek: 30, endGameweek: 39 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds this season's 38 total GWs/);
  });

  it('refuses every proposal while rosters are locked', async () => {
    setup((t) => { t.leagues[0].roster_locked = true; });
    const res = await propose(terms());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Rosters are locked/);
  });
});

describe('who can be loaned', () => {
  it("refuses a player who is not on the lender's roster", async () => {
    const res = await propose(terms({ playerId: 'not-mine' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Player is not on your roster');
  });

  it('words the same refusal from the borrower side', async () => {
    const res = await propose(
      terms({ requestMode: true, lenderTeamId: RIVAL_TEAM_ID, borrowerTeamId: undefined, playerId: 'not-theirs' }),
    );
    expect(res.body.error).toBe("The requested player is not on that team's roster");
  });

  it('refuses a player on IR or already in a loan', async () => {
    for (const status of ['ir', 'loan_in', 'loan_out']) {
      setup((t) => {
        t.roster_entries.find((e) => e.player_id === LOANEE)!.status = status;
      });
      const res = await propose(terms());
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(`Cannot loan out a player who is currently in status '${status}'`);
    }
  });

  it('allows an academy player to be loaned, and records where he came from', async () => {
    const tables = setup((t) => {
      t.roster_entries.find((e) => e.player_id === LOANEE)!.status = 'taxi';
    });
    expect((await propose(terms())).status).toBe(201);
    expect(tables.player_loans[0].origin_status).toBe('taxi');
  });

  it('refuses a player already in a pending or active loan', async () => {
    for (const status of ['pending', 'active']) {
      setup((t) => {
        t.player_loans.push({ id: `l-${status}`, league_id: LEAGUE_ID, player_id: LOANEE, status });
      });
      const res = await propose(terms());
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already involved in an active or pending loan/);
    }
  });

  it('refuses a player whose auction is already live', async () => {
    setup((t) => {
      t.player_sale_listings.push({ id: 'sl-1', league_id: LEAGUE_ID, player_id: LOANEE, status: 'active' });
    });
    const res = await propose(terms());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Bidding is live/);
  });

  it('allows a loan of a listed player before bidding starts', async () => {
    // Listing a player must not remove a way to reach him. A pending listing
    // advertises intent; accepting the loan cancels it.
    setup((t) => {
      t.player_sale_listings.push({ id: 'sl-1', league_id: LEAGUE_ID, player_id: LOANEE, status: 'pending' });
    });
    expect((await propose(terms())).status).toBe(201);
  });
});

describe('the loan caps', () => {
  const OCCUPYING = ['active', 'accepted_deferred', 'pending_activation'];

  it.each(OCCUPYING)('counts a %s loan against the lender cap of one', async (status) => {
    setup((t) => {
      t.player_loans.push({ id: 'l-1', league_id: LEAGUE_ID, lender_team_id: MY_TEAM_ID, player_id: 'squad-9', status });
    });
    const res = await propose(terms());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The lender has reached the maximum number of active loan-outs (1)');
  });

  it('does not count a rejected or completed loan against the lender', async () => {
    for (const status of ['rejected', 'completed', 'cancelled']) {
      setup((t) => {
        t.player_loans.push({ id: 'l-1', league_id: LEAGUE_ID, lender_team_id: MY_TEAM_ID, player_id: 'squad-9', status });
      });
      expect((await propose(terms())).status).toBe(201);
    }
  });

  it('lets the borrower take a second loan but not a third', async () => {
    setup((t) => {
      t.player_loans.push({
        id: 'l-1', league_id: LEAGUE_ID, lender_team_id: 'team-third', borrower_team_id: RIVAL_TEAM_ID,
        player_id: 'squad-9', status: 'active',
      });
    });
    expect((await propose(terms())).status).toBe(201);

    setup((t) => {
      for (const i of [1, 2]) {
        t.player_loans.push({
          id: `l-${i}`, league_id: LEAGUE_ID, lender_team_id: `team-${i}`, borrower_team_id: RIVAL_TEAM_ID,
          player_id: `squad-${8 + i}`, status: 'active',
        });
      }
    });
    const res = await propose(terms());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The borrower has reached the maximum number of active loan-ins (2)');
  });

  it("honours a league's own caps", async () => {
    setup((t) => {
      t.leagues[0].max_loan_outs = 2;
      t.player_loans.push({ id: 'l-1', league_id: LEAGUE_ID, lender_team_id: MY_TEAM_ID, player_id: 'squad-9', status: 'active' });
    });
    expect((await propose(terms())).status).toBe(201);
  });
});

describe('the performance bonus cap', () => {
  it('refuses a bonus clause on a free loan when no default cap is set', async () => {
    setup((t) => { t.leagues[0].loan_bonus_cap_default = 0; });
    const res = await propose(terms({ loanFee: 0, bonusRate: 0.5 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/3x the loan fee/);
  });

  it('defaults the cap to three times the fee', async () => {
    const tables = setup((t) => { t.leagues[0].loan_bonus_cap_default = 0; });
    expect((await propose(terms({ loanFee: 5, bonusRate: 0.5 }))).status).toBe(201);
    expect(tables.player_loans[0].bonus_cap).toBe(15);
  });

  it("prefers the league's flat default over three times the fee", async () => {
    const tables = setup((t) => { t.leagues[0].loan_bonus_cap_default = 40; });
    await propose(terms({ loanFee: 5, bonusRate: 0.5 }));
    expect(tables.player_loans[0].bonus_cap).toBe(40);
  });

  it("prefers the proposer's own cap over both", async () => {
    const tables = setup((t) => { t.leagues[0].loan_bonus_cap_default = 40; });
    await propose(terms({ loanFee: 5, bonusRate: 0.5, bonusCap: 12 }));
    expect(tables.player_loans[0].bonus_cap).toBe(12);
  });

  it('leaves the cap at zero when there is no bonus clause', async () => {
    const tables = setup();
    await propose(terms({ bonusRate: 0, bonusCap: 99 }));
    expect(tables.player_loans[0].bonus_cap).toBe(0);
  });
});

describe('the counterparty', () => {
  it('refuses a club from another league', async () => {
    setup((t) => { t.teams.find((x) => x.id === RIVAL_TEAM_ID)!.league_id = 'league-other'; });
    const res = await propose(terms());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Target team not found in this league');
  });
});

describe('countering a pending loan', () => {
  function withParent(extra: Record<string, unknown> = {}) {
    return setup((t) => {
      t.player_loans.push({
        id: 'parent-1',
        league_id: LEAGUE_ID,
        lender_team_id: MY_TEAM_ID,
        borrower_team_id: RIVAL_TEAM_ID,
        player_id: LOANEE,
        status: 'pending',
        ...extra,
      });
    });
  }

  it('refuses to counter a loan that no longer exists', async () => {
    setup();
    const res = await propose(terms({ parentLoanId: 'gone' }));
    expect(res.status).toBe(404);
  });

  it('refuses to counter a loan that is no longer pending', async () => {
    // The parent occupies no cap slot as `rejected`, so this reaches the
    // counter check rather than tripping the loan-out limit first.
    withParent({ status: 'rejected', player_id: 'squad-9' });
    const res = await propose(terms({ parentLoanId: 'parent-1' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/is rejected and can no longer be countered/);
  });

  it('refuses a counter from a club that is not party to the loan', async () => {
    setup((t) => {
      t.player_loans.push({
        id: 'parent-1', league_id: LEAGUE_ID, lender_team_id: 'team-third',
        borrower_team_id: 'team-fourth', player_id: 'squad-9', status: 'pending',
      });
    });
    const res = await propose(terms({ parentLoanId: 'parent-1' }));
    expect(res.status).toBe(403);
  });

  it('rejects the parent and chains the counter to it', async () => {
    // A pending parent for a DIFFERENT player, so the new proposal is not
    // refused for the loanee already being in a pending loan.
    const tables = withParent({ player_id: 'squad-9' });
    const res = await propose(terms({ parentLoanId: 'parent-1' }));

    expect(res.status).toBe(201);
    expect(tables.player_loans.find((l) => l.id === 'parent-1')!.status).toBe('rejected');
    expect(tables.player_loans.at(-1)).toMatchObject({ parent_loan_id: 'parent-1', status: 'pending' });
  });
});

describe('a proposal that clears everything', () => {
  it('writes a pending loan with the agreed terms', async () => {
    const tables = setup();
    const res = await propose(terms({ message: 'Interested?' }));

    expect(res.status).toBe(201);
    expect(tables.player_loans).toHaveLength(1);
    expect(tables.player_loans[0]).toMatchObject({
      league_id: LEAGUE_ID,
      lender_team_id: MY_TEAM_ID,
      borrower_team_id: RIVAL_TEAM_ID,
      player_id: LOANEE,
      loan_fee: 5,
      start_gameweek: 5,
      end_gameweek: 13,
      status: 'pending',
      proposed_by: 'lender',
      origin_status: 'active',
      message: 'Interested?',
    });
  });

  it('records the borrower as proposer on a request', async () => {
    const tables = setup((t) => {
      t.roster_entries.push({ id: 'r-x', team_id: RIVAL_TEAM_ID, player_id: 'squad-9', status: 'active' });
    });
    const res = await propose(
      terms({ requestMode: true, lenderTeamId: RIVAL_TEAM_ID, borrowerTeamId: undefined, playerId: 'squad-9' }),
    );

    expect(res.status).toBe(201);
    expect(tables.player_loans[0]).toMatchObject({
      lender_team_id: RIVAL_TEAM_ID,
      borrower_team_id: MY_TEAM_ID,
      proposed_by: 'borrower',
    });
  });

  it('sends the counterparty a direct message carrying the loan id', async () => {
    const tables = setup();
    await propose(terms());
    expect(tables.chat_messages).toHaveLength(1);
    expect(tables.chat_messages[0]).toMatchObject({
      league_id: LEAGUE_ID,
      sender_id: USER_ID,
      recipient_id: OTHER_USER_ID,
      loan_id: tables.player_loans[0].id,
    });
  });
});
