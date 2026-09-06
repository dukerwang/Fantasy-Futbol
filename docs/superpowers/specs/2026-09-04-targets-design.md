# Targets

## Problem

The transfer market only has a supply side. `player_sale_listings` (059, extended by 077 and 114) lets a manager say six different things about a player he owns — auction floor, release clause, offers-only, wants cash, wants bodies, would loan him out — and `listingStance()` turns each into a headline. The Listings board is the trade block, and it works.

Nothing lets a manager say what he is *looking for*. The only way to signal interest is to send a complete offer through `ProposeBuilder`, which is a heavy, committal act: you have to already know who you want, decide what you'd give, and put it in front of a specific counterparty. There is no equivalent of walking into the room and saying "I need a left-back and I have €25m."

The consequence is that demand is invisible. A manager holding a surplus centre-back has no way to learn that two clubs are short at the back, so he never lists. A manager who would sell his second striker for the right price never finds out the right price exists. Deals that both sides would take don't happen, because neither side speaks first.

### The precedent this must not repeat

Migration `029_trade_block.sql` added `roster_entries.on_trade_block`, a boolean toggle on the roster inspector. It was deprecated by 077 and is still sitting in the schema waiting to be dropped, with a comment saying so. `Inspector.tsx:64` records why it failed: it "never touched the real listings system at all." It was a signal shaped like a mechanism — it looked actionable, and nothing honoured it.

A targets board that is only a tag repeats that exactly. The value of this feature is not the tag. It is the **join**: when a targeted player is actually listed, both sides are told, and the listing shows up attached to the target. If the matching isn't built, the tagging isn't worth building either.

## Goal

Give the market a demand side that is symmetric with Listings in how it reads, asymmetric in what it can do, and joined to Listings at every surface where the two meet.

## Naming

The board is **Targets**; one row is **a target**. This is the transfer window's own word — a club identifies a target — and it pairs with Listings in the nav without either needing explaining.

Four nearby words are deliberately not used. **Scouting** is already taken: Gaffa has scouting reports (the Futbolpedia outlooks) and a Scout's rebate, and both are about a player's real-world quality, not about who wants him. **Shortlist** implies a ranked set of candidates competing for one slot, which is not the shape of this. **Wishlist** reads like e-commerce, and **trade block** belongs to the deprecated 029 flag and to Listings, which already is one.

The internal name matches the external one — `player_targets`, `targetStance()`, `TargetCard`. No FAAB-style split between what the database calls it and what the UI says.

## Why this is a separate object from a listing

A listing is **transactable**. It carries a floor, an ask, a release clause and an auction clock; `resolve_single_player_auction_rpc` reads `player_sale_listings` directly, credits the seller, and settles the sale in one transaction. A target is **inert**. There is nothing to bid on and nothing to accept; the only next step is to make an offer or start a conversation.

Putting an inert card in the same grid as one counting down to settlement would teach managers the wrong thing about what is clickable — the 029 failure in a new costume. The filters say the same thing: the Listings facets are `live / trade / cash / loan / clause / affordable / mine`, every one of them a property of supply, while target facets are position, budget, and what you'd give. One board serving both would need a mode toggle to swap filter sets, which is two boards wearing one hat. And the subnav count degrades: "Listings 14" meaning nine for sale and five sought is a worse number than two honest ones.

Two tables, not one with a `side` column: different columns, different lifecycles, different RLS, and the auction machinery is keyed off `player_sale_listings` in ways a target must never accidentally satisfy.

**What does merge is the surfaces.** See "Placement" — the two boards are stitched together everywhere the join is legible, and the transactable object is always the listing.

## Definitions

A **target** is one row in `player_targets` belonging to one club. It comes in two kinds:

- **Named target** — a specific player. "I want Saliba." Matches exactly.
- **Profile** — a tactical position plus optional budget and note. "Need an LB, €25m ready." Matches on position.

Gaffa's 12-position taxonomy is what makes the profile worth having. "I need a left-back" is a precise, actionable statement here in a way it is not on a platform with a single DEF bucket, and it is the form most targets will naturally take. "Profile" is also the right football word — a club describes the profile it is looking for.

Each target has a **visibility**:

- **Public** — appears on the league-wide Targets board, attributed to the club.
- **Private** — visible only to its owner. Never appears on the board, never notifies the owner of the targeted player, and must not leak over Realtime (see RLS below). Its only output is an alert to you when the player becomes gettable.

Each target carries a **stance**: what the targeting club would give. Three booleans mirroring the listing gates, with the words reversed:

| Target field | Means | Listing counterpart |
|---|---|---|
| `open_to_sale` | I'll pay cash | seller wants cash |
| `open_to_trade` | I'll give players | seller wants bodies |
| `open_to_loan` | I'd take him on loan | seller would loan him out |

A sibling of `listingStance()` — `targetStance()` in `src/lib/transfers/targetStance.ts` — turns the booleans plus `budget` into a headline. Do **not** reuse `listingStance()`: the field names match but the meanings are mirrored, and sharing the function would print "For sale" on a target.

Headlines, following the same "both or neither collapses" rule as `listingStance`:

- cash only, budget set → `Will pay cash · up to €25m`
- cash only, no budget → `Will pay cash`
- players only → `Offering players`
- loan only → `Would take him on loan`
- any other combination → `Open to approaches`

## How it works, end to end

The mechanism is small; the flows are what make it feel designed. Every one of them ends in machinery that already exists — `ProposeBuilder`, `ListingEditor`, `BidDialog`, or a chat DM. **Nothing here adds a negotiation surface.** A target is an advertisement that pre-fills the existing composer, exactly as a listing already does. A bespoke "respond to a target" channel would put deals in a third place, competing with offers and chat, with none of the three authoritative.

### Posting one

From the player card modal, the player hub, the Free Agents list, or a player row on the Listings board: **Add to targets** opens `TargetEditor`. Pick named or profile, pick visibility, tick what you'd give, optionally set a budget and a 140-character note. Save.

- **Public** → the target appears on the league's Targets board with your club's name on it. If it names a player somebody owns, that owner is notified: "Chelsea want Saliba."
- **Only you** → nothing appears anywhere and nobody is told. Its sole job is to alert you when that player becomes gettable.

Editing a target later — raising a budget, switching to public — never re-notifies. Creation is the only event that pings; otherwise a manager could bump their way into somebody's notifications indefinitely.

### Reading the board

The Targets page lists every **public** target in the league, newest first, one card each, attributed. The `mine` facet holds your own — public and private together, since that is where you manage them. Other clubs' private targets are absent from the board *and* from its Realtime payload; there is nothing to see and nothing to respond to.

A card states who wants what, their stance and budget via `targetStance()`, and their note. That is the whole card until a listing matches it.

### Answering a target

**A profile — "Palace want an LB, €25m ready" — and you own a left-back.** The card's primary action opens `ProposeBuilder` with Palace as the counterparty, the give-side picker filtered to your players at that position, and their cash side seeded to their stated budget. You adjust and send. Secondary action: message them (a chat DM), for the cases where the deal needs a sentence before it needs a structure.

**A named target on your player — "Chelsea want Saliba."** The notification and the card both carry two actions, deliberately:

- **Make Chelsea an offer** — `ProposeBuilder`, counterparty Chelsea, Saliba on your give side, their budget seeded as the cash you're asking.
- **List him** — `ListingEditor` pre-filled with Saliba, which puts him in front of the entire league.

Offering both matters. A stated budget is a floor on what a player might fetch, not a ceiling, and a manager who only ever sees the bilateral action will systematically undersell to whoever asked first.

**A named target on somebody else's player.** No action. It is market intelligence — you now know two clubs are chasing the same centre-back, which is worth knowing when you own one.

**A private target.** Not answerable, because not visible. By design.

### Being answered

**A player you target gets listed, auctioned, or dropped.** You are notified, and the target card on your board renders the live listing inline with the listing's own Bid button. You bid through the normal auction path. The target itself never becomes transactable — the listing is still the only object that settles.

**Both sides have already spoken.** When an active target and an active listing exist for the same player, both managers get the stronger two-sided notice, the target card shows the listing, and the listing card names the interested club rather than counting anonymous demand.

### Closing one out

- **A named target auto-fills** the moment your club acquires that player, by any route — auction, trade, loan, free agency. `status` becomes `filled` and it leaves the board.
- **A profile does not auto-fill.** Signing one left-back does not mean you have stopped looking for a left-back; he might be a squad player, or the wrong one. Profiles end when you withdraw them or when the 28 days run out. This is the one place the two kinds behave differently, and it is deliberate.
- **Withdrawing** sets `withdrawn` rather than deleting, so a target that produced a deal stays legible in the record.
- **A target survives its player being traded on** inside the league; matching re-points at the new owner.

## Schema

New migration (next free number; `ls supabase/migrations | tail` at implementation time).

```sql
create table public.player_targets (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues(id) on delete cascade,
  team_id       uuid not null references public.teams(id) on delete cascade,
  target_kind   text not null check (target_kind in ('player','profile')),
  player_id     uuid references public.players(id) on delete cascade,
  position      text check (position in
                  ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LW','RW','ST')),
  visibility    text not null default 'public' check (visibility in ('public','private')),
  open_to_sale  boolean not null default true,
  open_to_trade boolean not null default false,
  open_to_loan  boolean not null default false,
  budget        integer check (budget is null or budget >= 0),
  note          text check (note is null or char_length(note) <= 140),
  status        text not null default 'active'
                check (status in ('active','filled','withdrawn','expired')),
  expires_at    timestamptz not null default now() + interval '28 days',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint player_targets_kind_shape check (
    (target_kind = 'player'  and player_id is not null and position is null) or
    (target_kind = 'profile' and position  is not null and player_id is null)
  )
);
```

The `position` column duplicates the `GranularPosition` union in `src/types/index.ts`. That union is the source of truth; the CHECK is a guard, and both change together if the taxonomy ever does.

Indexes:

```sql
create index idx_player_targets_league_status
  on public.player_targets (league_id, status, visibility);
create index idx_player_targets_player
  on public.player_targets (player_id, status) where player_id is not null;
create index idx_player_targets_position
  on public.player_targets (league_id, position, status) where position is not null;
create index idx_player_targets_team
  on public.player_targets (team_id, status);

-- One live target per club per player or position.
create unique index idx_player_targets_one_active_player
  on public.player_targets (league_id, team_id, player_id)
  where status = 'active' and player_id is not null;
create unique index idx_player_targets_one_active_profile
  on public.player_targets (league_id, team_id, position)
  where status = 'active' and position is not null;
```

### Expiry, without a cron

`expires_at` defaults to 28 days out and every read filters `status = 'active' and expires_at > now()`. Nothing sweeps the table. This is the roll-off pattern the new-transfers section already uses ("no separate expiry job or dismiss action needed") and it keeps the feature off `vercel.json` entirely. A target can be renewed by editing it, which bumps `expires_at`; the board shows a quiet "expires in n days" on your own rows so a stale target is visibly stale before it vanishes.

28 days rather than the listing window's 72 hours because a target is a standing position, not an offer under a clock.

### Caps

Ten active targets per club, of which at most five public. Enforced in the route, not the schema — the error message needs to say which limit was hit and a CHECK can't count sibling rows. The public cap is what keeps the board readable in a 10–12 club league; without it, one enthusiastic manager becomes the board.

### RLS

Realtime respects RLS, and the Targets board subscribes (see "Data"), so the select policy is the only thing standing between a private target and the rest of the league. Get it right.

```sql
alter table public.player_targets enable row level security;

-- Public targets: any member of that league. Private: the owning user only.
create policy "Targets: read public in league, private if mine"
  on public.player_targets for select using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = player_targets.league_id
        and lm.user_id = (select auth.uid())
    )
    and (
      visibility = 'public'
      or exists (
        select 1 from public.teams t
        where t.id = player_targets.team_id
          and t.user_id = (select auth.uid())
      )
    )
  );
```

`(select auth.uid())` rather than a bare `auth.uid()`, per migration 145 — the bare form re-evaluates per row and trips the `auth_rls_initplan` advisor lint. Writes go through the admin client in the route, as listings do, so no insert/update/delete policies are needed.

Add `player_targets` to the `supabase_realtime` publication. Verify with `select tablename from pg_publication_tables where pubname = 'supabase_realtime'` rather than trusting `list_migrations`.

## Matching

Matching is the feature. It runs at write time on a targeted query — never a scan, never a cron.

### Supply arrives, demand is told

Three events make a player gettable. Each gains one lookup against `player_targets`:

1. **A listing is created** — `POST /api/leagues/[leagueId]/listings/route.ts`, in the same `try` block that already fans out `listedNotice` to the league (route.ts:319–357). The block is already best-effort and already loops every other club; matching adds a query and a second, better-targeted notice.
2. **A system auction opens on a free agent** — `src/lib/auctions/seedHighValueAuctions.ts`, alongside the arrival notices it already sends.
3. **A player is dropped** — `src/lib/roster/executeDrop.ts`, which already seeds an auction on the dropped player.

The lookup, for a player with `primary_position` P and `secondary_positions` S:

```
active, unexpired targets in this league
  where team_id <> the owner/seller's team
    and (player_id = <this player>
         or position in (P, ...S))
    and (budget is null or budget >= <listing floor, when one exists>)
```

Secondary positions count. A manager targeting an LB should hear about a CB who also plays there — that is what the granular taxonomy is for, and excluding it would make profiles feel broken on exactly the flexible players who matter most.

The budget filter only applies when the supply event carries a floor (`min_bid` or a system auction's opening price). An offers-only listing has no number to compare against, so every matching target is notified.

Each matching target's owner gets one notification. A named target and a profile held by the same club on the same player collapse to one notice via the `tag` folding `createNotification` already does.

### Demand is posted, supply is told

- **A public named target** notifies that player's current owner: "Chelsea want Saliba." This is the demand-side counterpart of `listedNotice`, and it is the message most likely to start a deal.

  This was weighed against the risk of pestering — four clubs targeting the same star means four notices to one owner. It is kept because listings already notify the entire league every time anybody lists a player, so this is the mirror of an existing noise level rather than a new one. In-app and push only, no email, and repeats fold by tag.
- **A private named target** notifies nobody. That is the entire point of private.
- **Editing a target never re-notifies.** Creation is the only event that pings an owner; otherwise a manager could bump a budget repeatedly and walk into somebody's notifications at will.
- **A profile** notifies nobody at post time. Notifying every club that owns a left-back would be spam on a scale nothing else in the app produces. Profiles surface on the board and inside `ListingEditor` instead, which is where they change behaviour.

### Both sides have spoken

When an active target and an active listing exist for the same player, that is a **two-sided match** and deserves more than a badge — both clubs have already said, on the record, that they'd do business.

- Both managers get a distinct, stronger notice.
- The target card on the Targets board renders the live listing inline, with the listing's own real Bid button. The target never grows actions of its own; the listing stays the only transactable object.
- The listing card on the Listings board reads "Chelsea want him" rather than the generic demand line.

### Guards

- A club cannot target a player on its own roster. Checked in the route against `roster_entries`, and re-checked at match time — a target survives you acquiring the player some other way, and must not then notify you about yourself.
- A **named** target auto-transitions to `filled` when the targeting club acquires that player, by any route. Hook the same places that already write `roster_entries` on acquisition.
- A **profile** does not auto-fill on a signing at that position. Signing one left-back does not mean the club has stopped looking for a left-back — he may be a squad player, or the wrong one. Profiles end on withdrawal or expiry only. This is the one behavioural difference between the two kinds, and it is deliberate.
- **A target survives its player changing clubs inside the league.** You targeted the player, not the negotiation; if he is traded on, matching simply re-points at his new owner. A target made pointless by the move is the manager's to withdraw, not the system's to guess at.
- Matching is best-effort and wrapped, following the existing pattern: a notification failure must never fail the listing insert.

## Notifications

Add a seventh kind to `NOTIFICATION_KINDS` in `src/lib/notifications/prefs.ts`:

```ts
targets: { label: 'Transfer targets', hint: 'When a player you want becomes available' }
```

Default `{ push: true, email: false }`. In-app mail always writes regardless; email is off because a target becoming available is time-sensitive but not rare, and the auction it opens sends its own email already.

No data migration is needed — `resolvePrefs()` merges stored JSON over defaults and ignores unknown keys, so existing rows pick the new default up on read. The settings grid renders `KIND_LABELS`, so it gains the row automatically.

Copy lives in `src/lib/notifications/copy.ts` beside `listedNotice`, in the same transfer-news voice, clubs taking a plural verb:

- Supply → demand: **"Saliba is available"** / "Arsenal have listed Saliba, one of your targets. Bidding is open, 3d left."
- Profile match: **"A left-back has hit the market"** / "Arsenal have listed Kerkez. You're looking for an LB."
- Demand → supply: **"Chelsea want Saliba"** / "Chelsea have made Saliba a target. They'll pay cash, up to €40m."
- Two-sided: **"Chelsea want a player you've listed"** / "You've listed Saliba and Chelsea are targeting him. They'll pay cash, up to €40m."

Every notice links to the relevant board and carries a `tag` so repeats fold in place rather than stacking.

## Placement

### A new tab

`Targets` joins `TransfersSubNav` immediately after `Listings`, pairing supply with demand:

```
Market · Auctions n · Listings n · Targets n · Free Agency n · Deals n
```

Route: `/league/[leagueId]/transfers/targets`, `TargetsClient.tsx` + `targets.module.css`, following the Listings page structure exactly.

The count is **public targets in the league**, not mine. It's a board of what other clubs are after; a badge counting my own private notes would be a different number wearing the same label.

Six items is one more than the subnav has carried. Check it at 375px while building — if it doesn't fit, shorten `Free Agency` to `Free Agents` rather than dropping a tab or introducing a scroller.

### Facets and sort

Facets: `all / named / profiles / cash / trade / loan / mine`. Sort: newest, budget, position. The board is small enough to read, so this stays light — the same judgement `ListingsClient` records about its own filters.

`mine` is where you manage your own targets, public and private together, the way the Listings board's `mine` facet works. There is no separate "my list" screen.

### Merged surfaces

The boards stay separate; these five places are where they meet.

1. **Market hub** (`MarketClient.tsx`) — a demand section beside the existing "On the Listings Board" section at line 314, so supply and demand read together on the one page that is reachable from the top bar. This is where "one place to look" gets satisfied.
2. **Listing cards** (`ListingCard.tsx`) — a demand line: "Chelsea want him", or "3 clubs are looking for a CB" when only profiles match. The single most useful thing this feature produces for a seller.
3. **Target cards** — a live listing on a targeted player renders inline, with the listing's Bid button.
4. **`ListingEditor`** — matching targets at the top when you open it: "Palace want an LB, €25m ready." A manager deciding whether to list at all, and at what price, is exactly who this information is for.
5. **Entry points to add a target** — the player card modal (`PlayerDetailsModal`), the player hub (`PlayerHub`), the Free Agents list, and any player row on the Listings board. All places where you meet somebody else's player. Not the roster inspector: that shows players you already own, where the correct action is "List for transfer", which is already there.

## Data

- `TransfersCounts` gains `targets: number` — active, unexpired, public targets in the league.
- `TransfersModel` gains `targets: TransfersTarget[]` (public targets across the league plus my own private ones, joined to player and team) and reuses the existing `myTeam` to split "mine" client-side.
- `buildTransfersModel` fetches targets in the same pass it already makes; player rows come through `FULL_PLAYER_SELECT`, and `primePlayers` seeds the card cache the way `ListingsClient` does.
- `useLiveTransfers` subscribes to `player_targets` alongside `auction_state`, `player_sale_listings`, `trade_proposals` and `player_loans`. Same patch-over-server-model pattern, same `router.refresh()` re-seed. No polling, no new endpoint on a timer.
- New routes: `POST/GET /api/leagues/[leagueId]/targets`, `PATCH/DELETE /api/leagues/[leagueId]/targets/[targetId]`, mirroring the listings route pair.

## Components

- `TargetCard.tsx` — sibling of `ListingCard`, deliberately quieter: no countdown, no bid affordance, one primary action that opens `ProposeBuilder` pre-targeted at the targeting club (or, for a profile, at that club with the player picker open).
- `TargetEditor.tsx` — sibling of `ListingEditor`. Kind toggle (named player / position), visibility toggle, the three stance checkboxes, budget, note.
- `targetStance.ts` — the mirrored stance function described above, with tests beside `listingStance`'s.
- Reuse `PositionBadge`, `CrestBadge`, `PlayerCardProvider` hover behaviour, and `TransfersSubNav` unchanged apart from the new item.

## Copy

The board is **Targets**; a row is **a target**; the two kinds are a **named target** and a **profile**. Never "wishlist", never "trade block", never "scouting" for any of it.

Visibility reads as **"Visible to the league"** / **"Only you"**, not "public/private" — it says what actually happens.

Sentence case throughout. Money as `€{n}m`. Club Balance vocabulary, never FAAB. Clubs take a plural verb ("Chelsea want", not "Chelsea wants"), matching `describeDeal`, `hereWeGo`, and the rest of `copy.ts`.

## Out of scope

- **Auto-generated targets from squad holes.** Reading a roster for missing positions and posting targets unprompted is a separate feature with its own failure modes.
- **Anonymous targets.** Public means attributed. An "N clubs are watching him" mode was considered and set aside; it can be added later as a third visibility without reshaping anything here.
- **Targets on retained rights or academy players.** Rostered and free-agent players only.
- **Any transactable behaviour on a target.** No bidding, no accepting, no auto-generated offers. The listing stays the only object that settles.
- **Any change to listings mechanics** — auction timing, the €50m auto-auction threshold, `seedHighValueAuctions` eligibility, or `resolve_single_player_auction_rpc`. This feature only reads alongside them.
- **Commissioner moderation** of note text. 140 characters in a private league among people who know each other.
