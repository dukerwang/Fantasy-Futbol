# Proactive academy routing for auction bids

## Problem

Academy (taxi squad) routing only exists today as a fallback computed fresh
at auction *resolution* time: `resolve_single_player_auction_rpc`
(`supabase/migrations/096_reauction_expiry_72h.sql:189-261`) only tries the
academy when the active roster is *already full* and no drop was nominated.
If the roster has room at the moment a specific auction resolves, the winner
always lands on `bench` — even if he's a U21 prospect the manager would
rather stash in the academy.

This produced a real bug: two auctions (Josh, Pascal) resolved seconds
apart. Josh's resolved first while the roster still had one free slot, so he
landed on `bench` (academy routing never considered, since the roster
wasn't full *yet*), consuming the last slot. Pascal's auction resolved
moments later into a now-full roster with no drop nominated, and lost.

Managers have no way to say, at bid time, "if I win this, send him straight
to the academy" independent of whatever the roster happens to look like at
the exact moment resolution runs.

## Non-goals

- No change to the existing full-roster fallback behavior (unchanged).
- No change to how a manager nominates a drop player.
- Not extending this to the startup draft (`make_draft_pick`) — draft picks
  always land on bench today and that is out of scope here.

## Design

### Data model

New column: `waiver_claims.send_to_academy BOOLEAN NOT NULL DEFAULT FALSE`.
Same shape as the existing `drop_player_id` — a per-bid intent that survives
raises and is read fresh at resolution time.

### `place_auction_bid_rpc`

New parameter `p_send_to_academy BOOLEAN DEFAULT FALSE`. Rejects the call if
both `p_drop_player_id IS NOT NULL AND p_send_to_academy` (mutually
exclusive). Stored on both the initial insert and the update-on-raise path.

### `resolve_single_player_auction_rpc`

Selects `wc.send_to_academy` in the winner-selection loop. A bid carrying
`send_to_academy = true` is evaluated on its own terms, not only inside the
"active roster full" branch:

1. Re-check eligibility **fresh at resolution time**: academy has a free
   slot (`v_academy_count < v_academy_size`) AND player is age-eligible
   (`v_age <= v_academy_age_limit`).
2. If still eligible → route to `taxi`, regardless of active roster
   fullness at that instant.
3. If no longer eligible (e.g. another win took the last academy slot
   first) → fall back to ordinary `bench` placement if the active roster
   has room. If the active roster is *also* full, this becomes the same
   "full roster, no drop nominated, not academy-eligible" case that exists
   today — no new failure mode.

This directly closes the Josh/Pascal race: Josh's bid carries
`send_to_academy = true`, so he routes to the academy regardless of roster
state at resolution, never touching the contested bench slot.

### Bid route (`src/app/api/leagues/[leagueId]/auctions/bid/route.ts`)

Accepts a new `sendToAcademy: boolean` field in the POST body.
Server-side validation before calling the RPC (defense in depth, mirroring
the existing full-roster-fallback checks at lines 278–291 today):

- Reject with 400 if both `dropPlayerId` and `sendToAcademy` are set.
- Reject with 400 if `sendToAcademy` is true but the player has no DOB on
  record, or is older than `taxi_age_limit`.
- (Academy-full-at-bid-time is *not* rejected here — capacity is
  re-validated at resolution, per the fallback behavior above. Bid-time
  capacity could be stale by resolution anyway.)

Passes `sendToAcademy` through to `place_auction_bid_rpc`.

### UI (`src/components/transfers/BidDialog.tsx`)

New props from parent clients (`MarketClient.tsx`, `ListingsClient.tsx`,
`AuctionsClient.tsx`, `FreeAgentsClient.tsx` — all four consumers):
`academy: { current: number; max: number; ageLimit: number }`, computed the
same way `TransferMarketClient.tsx`'s legacy modal already does.

Inside `BidDialog.tsx`:

- Compute `playerAge` from `player.date_of_birth`.
- `academyEligible = playerAge != null && playerAge <= academy.ageLimit && academy.current < academy.max`.
- New checkbox, shown whenever `academyEligible` — **not** gated on
  `rosterFull`: *"Send to academy if I win"*, with a hint line: `Academy:
  {current}/{max} slots · U{ageLimit} only`.
- Checking it disables/clears the existing drop-player `<select>` (mutual
  exclusivity). The existing `rosterFull` drop-or-academy requirement is
  unchanged when this new checkbox is left unchecked.
- `submit()` sends `sendToAcademy` in the POST body alongside the existing
  `dropPlayerId`.
- Visual integration must match the existing `styles.field` /
  `styles.hint` / `styles.select` patterns already in the file — verified
  in the browser preview (light + dark theme) before calling this done,
  not just by reading the JSX.

## Edge cases

- **Both flags set**: rejected at the route with 400 (defense in depth;
  unreachable from the UI since they're mutually exclusive there).
- **Academy fills between bid and resolution**: falls back to bench if
  room, else the existing full-roster failure path. Not a new failure mode.
- **Raising an existing bid**: `sendToAcademy` is part of the upsert, same
  as `dropPlayerId` — latest value on a raise wins.
- **Buy Now / release clause**: resolves inline through the same
  `resolve_single_player_auction_rpc`, so no separate code path is needed.

## Testing

- No DB-mocking test infrastructure exists in this codebase (confirmed —
  all existing tests are pure-function). The RPC eligibility logic is
  verified by careful reading, not a vitest test.
- One pure-function vitest test for the client-side `academyEligible`
  computation in `BidDialog.tsx` (age math + capacity check), styled like
  the existing `listingStance.test.ts`.
- Manual verification in the dev browser preview: place a bid with the
  checkbox checked, confirm the request body carries `sendToAcademy: true`,
  confirm the modal renders correctly in both themes.

## Out of scope / noted in passing

`src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx`
and its page are unreachable dead code — nothing in the app links to that
route anymore (superseded by `/transfers/*`, which all use `BidDialog.tsx`).
Not touched by this change; worth a separate cleanup pass.
