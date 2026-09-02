# New transfers section

## Problem

New signings under £50m (and any arrival to a non-promoted club) enter the free-agent pool with zero visibility. Only arrivals at or above the £50m auto-auction threshold, or players joining a newly-promoted club, get swept into a system auction and surfaced that way (`src/lib/auctions/seedHighValueAuctions.ts`). Everyone else quietly appears in the free-agent list with no signal that they're new, so managers only find them by scrolling the full pool or already knowing to look.

## Goal

Surface recently-arrived free agents — informational only, no claim/bid action from this view — in the market hub and on the Free Agents tab, without opening an auction on them.

## Definition of "new transfer"

A player is a "new transfer" if:
1. `players.pl_team_changed_at` is within the last 7 days, **and**
2. The player is currently a free agent (unrostered), **and**
3. The player has no live or system auction open against them, **and**
4. The player has no `player_season_clubs` row for the league's previous season.

Condition 3 is what scopes this to the actual gap: a ≥£50m arrival or promoted-club player already has an auction and is already visible via its auction card, so it's excluded here rather than shown twice.

Condition 4 is what keeps this to transfers *into* the Premier League. `pl_team_changed_at` fires for any change to a player's `pl_team` column (`syncPlayers.ts`), including a player moving between two existing PL clubs — e.g. a Crystal Palace player transferring to Nottingham Forest reads as "changed" exactly like a first-time arrival from La Liga does. `player_season_clubs` (not overwritten by the daily sync, unlike `players.pl_team`) is the record of who was already tracked as a PL player last season; no row there means the player wasn't part of last season's PL pool, which is the same definition `loadDraftPool.ts` already uses for `isNewToPrem`. Verified against live data: of 23 players with a `pl_team_changed_at` in the last 7 days, 11 had a previous-season PL club on record (intra-league moves — Muñoz, Martínez, Jackson, Marmoush, González, Delap, Pinnock, Disasi, Diouf, Baleba, Bentley) and were correctly excluded once this condition was added.

The 7-day window rolls off naturally — no separate expiry job or "dismiss" action needed.

## Placement

- **Free Agents tab** (`src/app/(dashboard)/league/[leagueId]/transfers/free-agents/FreeAgentsClient.tsx`): a pinned "New transfers" section at the top of the page, sorted newest-first, each card carrying a small "New" badge. Qualifying players also continue to appear in the main sortable/filterable list below — this section highlights, it doesn't partition. The section renders nothing when there are no qualifying players.
- **Market hub** (`src/app/(dashboard)/league/[leagueId]/transfers/MarketClient.tsx`): a preview tile alongside the existing Auctions/Listings/Deals previews — count plus a couple of names — linking to the Free Agents tab. Exact layout slot to be resolved during planning by reading the current hub composition; not fully specified here.

No new nav tab, no new route.

## Data

- Add `pl_team_changed_at` to the free-agent player query (`FULL_PLAYER_SELECT` or the equivalent select in `GET /api/leagues/[leagueId]/transfers/free-agents`, `src/app/api/leagues/[leagueId]/transfers/free-agents/route.ts`) if not already present, so the pinned section is a client-side filter of data the page already fetches. No new endpoint.
- Add a `newTransfers` count to `TransfersCounts` (`src/lib/transfers/buildTransfersModel.ts`): free agents with `pl_team_changed_at` within 7 days and no matching row in the auctions table. Reused by both the hub tile and the section header badge.

## Components

Reuse the existing free-agent list/card component, `PositionBadge`, and player-hover-card conventions already used in `FreeAgentsClient.tsx`. Add a small "New" pill to the card; no new card component.

## Copy

Section and hub tile both read "New transfers" (not "new arrivals"). No FAAB/auction-mechanics vocabulary in the copy — user-facing text says "Club Balance"/"budget" per existing house style, and this feature doesn't surface FAAB at all since it's non-transactional.

## Out of scope

- Claiming or bidding directly from this view (confirmed: informational only).
- Players who arrive via drop/release rather than an external transfer (confirmed: newly-synced arrivals only, not recently-released free agents).
- ≥£50m or promoted-club arrivals that already have a system auction.
- Any change to the £50m auto-auction threshold or `seedHighValueAuctions.ts` logic.
