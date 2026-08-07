# A listing isn't a visible auction until its first bid

## Problem

Every manager listing gets an auction anchor seeded immediately at creation
(`supabase/migrations/080_listing_anchor_seed.sql`), so it shows up on
`/league/[leagueId]/transfers/auctions` reading "no bids yet, opens at €Xm"
the moment it's listed — before anyone has actually engaged with it. A
listing should read as a listing until someone places a real opening bid;
only then should it become a visible auction.

## Non-goals

- No change to the DB anchor-seeding mechanism (migration 080). That
  migration deliberately replaced lazy anchor creation to fix two prior
  bugs — a duplicated-roster bug (pre-076) and orphaned listings with no
  expiry clock — and it retired a stale-listing cron sweep in favor of the
  anchor's own 14-day expiry. Reverting any of that would resurrect both
  problems and require reinstating the retired sweep.
- No change to system-seeded free-agent auctions (a new ≥€50m arrival, a
  player re-auctioned after a drop). Those have no seller "deciding"
  anything — they're genuinely open to bid on the moment they exist — so
  they continue to display immediately regardless of bid count.

## Design

In `src/lib/transfers/buildTransfersModel.ts`, immediately after the
`auctions` array is built (`~line 453-479`), filter it:

```ts
const auctions: TransfersAuction[] = (auctionRows ?? [])
  .map((a) => { /* unchanged */ })
  .filter((a) => a.kind !== 'listing' || a.bid_count > 0);
```

`auction_state.bid_count` (migration 078) already tracks real manager bids
separately from the system anchor, so no new data is needed.

Every downstream consumer of `model.auctions` already handles a listing
having no matching auction entry gracefully — confirmed by reading each
one: `ListingCard.tsx` reads `auction?.highest_bid ?? 0`, `auction?.expires_at
?? listing.auction_expires_at`, etc., and `listing.auction_expires_at` is
itself still `null` pre-bid (it's set by `place_auction_bid_rpc` on the
first real bid, not at listing creation). So a pre-bid listing renders using
only its own `min_bid`/`ask_price`/`buy_now_price` — exactly the right
thing to show for something nobody has bid on. No other file needs to
change:

- `AuctionsClient.tsx`'s `biddableAuctions` filter and every badge/count on
  that page inherit the filtered array automatically.
- `MarketClient.tsx`'s live-auction count and `model.counts.auctions`
  become more accurate for free, since they derive from the same array.
- `ListingsClient.tsx` / `DealsClient.tsx` — no code change; their
  `auctionByListing` lookups already return `undefined` safely today for
  any listing without a matching auction (their `?? null` handling was
  written before this filter existed, but works identically now).

The 14-day auto-expiry-if-never-bid safety net is untouched: the anchor
still gets created and still comes due through the ordinary resolver
regardless of whether it's displayed as an "auction" in the meantime.

## Testing

No new pure logic to unit-test — this is a one-line filter over data
already flowing through the model. Verified by reading the change against
the confirmed-null-safe consumers above, plus the existing test suite and
`npm run build`.
