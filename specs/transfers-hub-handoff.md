# Transfer Market revamp — handoff

State as of 2026-07-25. Written so a fresh session can pick this up without
re-deriving anything. Original plan: `~/.claude/plans/golden-coalescing-bubble.md`
(still accurate for DB/server; its UI section is superseded by the designs below).

---

## 1. What this is

One hub for every permanent player movement: free-agent auctions, player-sale
listings, trades, negotiations, loans, retained rights.

**Two domains, overlapping only at auctions:**

- **Free agency** — hundreds of unowned players (412 in the demo league). A
  browsing problem: search, filter, paginate.
- **Team-to-team** — listings, trades, negotiations, loans.

**A listing is four things at once**: an auction block, a trade block, a sale
listing, and (new) a loan block. It is the most important object in the system.

---

## 2. DONE — database (all applied and verified in production)

| migration | what |
|---|---|
| `076_fix_sale_listing_resolution.sql` | restored the seller logic 062 deleted |
| `077_listing_gates.sql` | `open_to_trade`, `open_to_sale`, `ask_price`, 80% floor trigger, proposal RLS |
| `078_auction_state_projection.sql` | `auction_state` table + statement-level triggers + Realtime publication |
| `079_unified_bid_rpc.sql` | `place_auction_bid_rpc` (8-arg) + `trg_guard_trade_against_listings` |
| `080_listing_anchor_seed.sql` | seeds the auction anchor at listing creation |
| `081_drop_stale_resolver_overload.sql` | dropped an orphaned 2-arg `resolve_single_player_auction_rpc` |

**Verified**: `scratch/verify_076_079.sql`, `scratch/verify_080_081.sql`
(single-query grids — the Supabase editor only renders the last statement).
All PASS. Zero corrupted sales. The 062 regression never damaged live data.

**APPLIED AND VERIFIED 2026-07-26** — `082_backfill_listing_gates.sql` then
`083_listing_loan_gate.sql`, in that order (083 re-adds the constraint 082
creates, so the reverse order fails against un-backfilled rows).

Verified via `scratch/verify_082_083.js` and `scratch/verify_gate_constraint.js`:
- `open_to_loan` column present.
- 0 inert listings; both pre-existing rows backfilled to trade+sale with an
  `ask_price`, matching what a legacy listing actually meant.
- 0 rows opted into `open_to_loan` — correct, since no listing has ever meant
  that and inferring it would invent seller intent.
- `player_sale_listings_gate_not_inert` **is enforcing**: an UPDATE setting all
  three gates false is rejected with `23514`, naming the constraint. (PostgREST
  cannot read `pg_catalog`, so this is checked functionally against the expired
  listing rather than by querying the catalog.)

Note `555a0c9b…` (pending) has `min_bid = 0` and so backfilled to `ask_price =
0`. Harmless as it sits, but 077's 80%-of-market-value floor fires the moment
`min_bid` is rewritten, so that listing cannot be re-saved through `PATCH` or
`ListingEditor` without raising the minimum first. Test-league row; left as is.

**Still needed (not written):**
- `084` — drop `roster_entries.on_trade_block` (deferred; deployed code still
  reads it in `trades/page.tsx`, `TradesClient.tsx`, `team/page.tsx`,
  `team/roster/page.tsx`, `RosterTable.tsx`, `AddToBlockModal.tsx`, and
  `api/teams/[teamId]/trade-block/route.ts`).

---

## 3. DONE — server layer

New:
- `src/lib/transfers/buildTransfersModel.ts` — the whole hub in one read.
  Auctions come from `auction_state`, not from regrouping `waiver_claims`.
- `src/lib/transfers/playerEnrichment.ts` — the canonical rank/archive merge.
  Fixes a live bug: `GET /auctions` omitted it, so polling silently regressed
  `overall_rank` / `ppg` / `form_rating` seconds after page load.
- `src/lib/transfers/effectivePpg.ts` — extracted from `trades/page.tsx`.
- `src/lib/auction/lockedClubs.ts` — shared kickoff-lock lookup.
- `GET /api/leagues/[id]/transfers` — the hub model.
- `GET /api/leagues/[id]/transfers/free-agents` — filtered, sorted, paginated.
  Sorting happens AFTER enrichment deliberately.

Modified:
- `POST /auctions/bid` — sole bid path for both auction kinds; listing floor vs
  free-agent 20% floor; `p_expect_sale_listing_id`; **Buy Now resolves inline**
  (pg_cron sweep is only a fallback); promoted-club rule removed.
- `POST /listings` — accepts gates + `askPrice`; 80% pre-check; no manual anchor
  seed (080's trigger owns it).
- `PATCH /listings/[id]` — NEW. Edit while `pending`; returns `outstandingOffers`.
- `POST /listings/[id]/bid` — DEPRECATED, now delegates to the RPC. **080 had
  silently broken it**: it branched on "no anchor exists" to detect a first bid,
  which stopped ever being true.
- `POST /trades` — `saleListingId`, gate enforcement, cash-only floor.
- `POST /trades/[tradeId]` — dropped its listing cleanup (the 079 trigger does it
  in-transaction and also rejects orphan anchors).
- `POST /loans` — added a listing/auction guard (none existed; a listed player
  could be loaned mid-auction), then relaxed it for the loan gate (see below).
- `POST /listings`, `PATCH /listings/[id]` — accept `openToLoan`; the inert check
  now spans all three gates. PATCH additionally returns `outstandingLoans`
  alongside `outstandingOffers` (loans hang off the player, not the listing —
  `player_loans` has no `sale_listing_id`, because any player can be loaned).
- `POST /loans/[loanId]` (accept) — **new guard, load-bearing.** Refuses when the
  player's listing has gone `active` since the loan was proposed. Both cancel
  paths in that handler are scoped `.eq('status','pending')`, so without this an
  auction that went live between proposal and acceptance survives its own player
  being loaned out, and the resolver later hands a player sitting in a third
  club's lineup to the winner. Unreachable before 083 because `POST /loans`
  refused every listed player; relaxing that guard opens it.
- `buildTransfersModel` — `TransfersListing` carries `open_to_loan`.

**Removed rule**: promoted-club exclusivity. It was dead (`players.pl_season`
holds one value, so it flagged nobody), never enforced server-side, and the user
chose to delete rather than fix. `computeEligibility` and its 3 queries are gone.

---

## 4. Known issues to fix during implementation

1. ~~**`POST /loans` guard is now too strict.**~~ **DONE** (2026-07-26, with 083).
   It now refuses only when bidding is live (`status = 'active'`) or the seller's
   loan gate is shut, with a different message for each. Paired with the new
   accept-time guard described in §3.
2. ~~**Orphaned file**: `cancelTradeProposals.ts`~~ **DELETED** (2026-07-26).
3. ~~**Dev-only scaffolding**~~ **DELETED** (2026-07-26): `src/app/dev/` and the
   `/dev/` bypass in `src/proxy.ts` are both gone.
4. **Old routes still live** because the OLD pages still exist — delete with
   them: `GET /auctions`, `GET /listings`, `GET /trades`,
   `POST /listings/[id]/bid`, `POST /teams/[id]/trade-block`. The new hub uses
   none of them. The old pages (`players/`, `trades/`) are still routable and
   still read `on_trade_block`, which is what blocks migration 084.
5. **Separate bug, already spawned as its own task**: the draft assigned the same
   player to two teams in the same league (Gabriel Martinelli, 4 leagues).
   `roster_entries` is unique on `(player_id, team_id)` only — nothing prevents
   league-wide duplication.

---

## 5. DESIGN — approved direction

Claude Design project: **Gaffa — Transfers Hub**
`https://claude.ai/design/p/79d35776-332d-43e0-99a6-a1fce8853179`

Current files (latest first):
- `Listings and Propose.dc.html` — Listings page + propose builder (trade & loan)
- `Transfer Market.dc.html` — front page + Deals page  ← **the approved base**
- earlier iterations kept for reference

### Information architecture

```
/league/[id]/transfers                 Transfer Market   (front page)
/league/[id]/transfers/auctions        The Auction Room  (every live lot)
/league/[id]/transfers/listings        Listings          (supply from clubs)
/league/[id]/transfers/free-agents     Free Agency       (the 369)
/league/[id]/transfers/deals           Deals             (YOUR business only)
```

Sub-nav on every page:
`Market · Auctions n · Listings n · Free Agency n · Deals n`.

**Auctions are a page AND an inline state — both, deliberately.** An earlier
draft of this doc said auctions were "not a page", which read as though the two
kinds had been split across Listings and Free Agency. They had not, and the user
corrected the plan on 2026-07-26: auctions get their own page, and the inline
states stay.

- The **page** is the cross-cutting view: every lot, free agents and listings in
  one list, ordered only by what closes first, with provenance as a tag rather
  than a section. It is also the only place bid history lives.
- The **inline states** are how you find a player you were already looking for —
  a listed player under the hammer is still on the Listings board (amber card,
  offer paths gone); a free agent under the hammer is still in Free Agency
  (lifted into a "Bidding open" strip above the table, because a countdown is
  unreadable in a dense table row).

Neither is the canonical one. Deals contains no listings board; that was the
confusion in an earlier draft.

### Hard design rules (learned the hard way — do not violate)

- **NO accent-colour slivers.** No `border-left: 3px solid <accent>`, no coloured
  top edges. This was rejected emphatically. State = full border + background
  tint. Colour comes from position badges, crest discs, gate pills, and figures.
- **PositionBadge sits LEFT of the player name**, never underneath in small text.
- **Owner's club crest top-right** of every card. Free agents get a dashed `FA`.
- **Player photos on listings** — the current app has them; losing them is a
  regression.
- Real football vocabulary: bid, offer, asking price, **release clause** (not
  "Buy Now"). Money is `€{n}m`. "Club Balance", never "FAAB".
- **Never a surname alone.** Full name where it fits, `F. Lastname` where it
  does not. Go through `playerName()` in `src/lib/players/playerName.ts`, never
  `web_name` directly — 14 `web_name` values are duplicated among the 557 active
  players (three Wilsons, three Phillipses), so a board saying "Wilson" is asking
  the manager to guess who they are bidding €30m on.
- Tokens from the live `src/app/globals.css`. The bound design system's README is
  stale (`£`, pre-rebrand `#3A6B4A`) — **the running app wins**.
- Both themes must work (Cream Editorial / Premium Dark). Dark is unverified on
  these designs.

### The listing card (the centrepiece)

Photo · `[POS] Name` · crest top-right · club · €MV · owner
→ three-price ladder: **Asking / Bid from / Clause** (live auctions swap Asking
for "Standing bid" in amber)
→ gate pills: Trade (blue) · Cash (green) · Loan (teal); dashed grey when closed
→ actions: Offer · Bid · Clause · Loan

Once bidding starts, gates close and the offer paths disappear — the absence is
the explanation, no copy needed.

### Front page composition

Masthead → **Closing now** (4 amber-bordered cards, free agents + listings mixed)
→ **On the listings board** (6-card slice, "All listings →") → two doors (Free
Agency, Deals) → **When everything closes** (7-day dot schedule) → right rail:
**The Wire** (every bid/offer/counter/trade/loan/recall event) + your desk.

### Propose builder

One modal, three modes (Trade / Offer to buy / Loan). Club strip and two-sided
body never change; only the mode row and what sits beneath it. Works on **any**
player — a listing is an advertisement, never the only route in.

Loan mode replaces the right-hand squad picker with terms: start/end GW,
duration, points-bonus %, bonus cap, recall buyback.

---

## 6. BUILT — the UI (2026-07-26)

All four pages exist as real components and build clean. The superseded
`AuctionBoard`/`AuctionCard` pair and the tab-bar `TransfersHub` shell are gone.

```
transfers/page.tsx          → MarketClient      front page
transfers/auctions/         → AuctionsClient    the lot list + bid history
transfers/listings/         → ListingsClient    the board
transfers/free-agents/      → FreeAgentsClient  paginated against the API route
transfers/deals/            → DealsClient       your desk
```

The Auction Room (design: `Auctions.dc.html`, frames 7a/7b) is rows rather than
cards — an auction is a ladder of time and money, and a row lets a dozen be
compared down one column. Expanding a row reveals the bid history and the
floor/standing/your-bid/clause ladder with quick-bid steps. `recentlyResolved`
on the model feeds "Gone this week": `auction_state` keeps settled rows at
`status = 'resolved'` (078 §2), so the price a player actually fetched survives,
and that is the league's only record of what a player is worth *here* rather
than what Transfermarkt says he is worth in the world.

Shared, in `src/components/transfers/`:
- `TransfersSubNav` — the four-page nav. Market matches exactly, not by prefix.
- `ListingCard` — the centrepiece. Photo, PositionBadge left of name, crest
  top-right, three-price ladder, gate pills, actions. Quiet/live/mine as full
  border + tint. Live auctions swap Asking for Standing bid and drop the offer
  paths entirely.
- `Modal` — portalled shell (cards are `overflow: hidden`; a dialog rendered
  inside one would be clipped).
- `BidDialog` — bid AND release clause in one form. They are the same request at
  a different number, and 079 resolves a bid ≥ `buy_now_price` inline.
- `ProposeBuilder` — the three-mode builder. Loan mode posts `requestMode: true`
  to `POST /loans` (you are the borrower asking the owner).
- `ListingEditor` — create/edit/withdraw, with the three gates and the 80% floor
  mirrored client-side so the seller sees a number, not an exception.
- `buildWire.ts` (in `src/lib/transfers/`) — The Wire, derived from the model
  rather than queried. **This is a privacy boundary, not an optimisation**: it
  can only ever show what `buildTransfersModel` already decided the caller may
  see. Do not "improve" it by querying `trade_proposals` directly — 077 §5 made
  other clubs' pending negotiations private, and a public feed would undo that.

Model additions: `TransfersTeam` gained `abbreviation` + `crest_config`;
`TransfersModel` gained `counts` (sub-nav) and `currentGameweek` (loan form).

Nav now points at the four new routes. `isItemActive()` in `TopBar.tsx` handles
the case where one item's href prefixes a sibling's.

### Verified in the browser (2026-07-26, `next start` on 3005)

Ran against the live DB after 082/083. Three bugs found and fixed that the build
could not have caught:

1. **`display: flex` on a `<td>`** in the free-agency table. That overrides
   `display: table-cell` and drops the cell out of the column model, which broke
   the row rule into segments and misaligned every column after it. The flex row
   now lives in a `<span>` inside the cell. Confirmed fixed: all seven cells
   report `table-cell`, one uniform border, header and cell right edges equal to
   the pixel.
2. **Numeric headers were left-aligned over right-aligned figures.**
   `.table thead th` (0,1,2) outranks a bare `.num` (0,1,0), so the header rule
   won. Qualified the selectors, added `table-layout: fixed` with explicit
   widths so the four figures cluster to the right, and `tabular-nums` so digits
   line up down the column.
3. **Free-agency count disagreed with itself** — sub-nav said 357, the page
   header said 369. `counts.freeAgents` subtracted every distinct rostered
   player from a total of `is_active` players, but 12 rostered players in that
   league have `is_active = false` (they left the PL) and were never in the
   total. Now only active rostered players are subtracted. Both read 369.

## 6b. STILL NOT BUILT

- **Realtime** (`useTransfersRealtime`, one channel `transfers:${leagueId}`,
  three `postgres_changes` subs; **never** subscribe to `waiver_claims`).
  Every page currently refreshes via `router.refresh()` after a mutation, which
  is correct but not live — a rival's bid does not appear until you act.
  `useTick.ts` is written and good.
- **Deleting the old pages** (`players/`, `trades/`) and their routes, then
  migration 084. See §4.4.
- **Redirects** in `next.config.ts` from the old URLs, and notification URL
  emitters still pointing at `/league/[id]/trades`.
- **Counter** on the Deals page opens an empty builder rather than pre-filling
  the original proposal's terms.
- Mobile is handled but unverified on a device.

## 7. Verification

No test runner. `npm run build` is the gate.

```
/opt/homebrew/bin/node node_modules/next/dist/bin/next build
/opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit
```

DB checks run read-only via `node --env-file=.env.local scratch/<script>.js`
(service-role key). PostgREST cannot read `pg_catalog` — function/trigger/
constraint checks must go through the Supabase SQL editor.
