# 8. The Transfer Market

*Draft specimen — replaces §8 "Free Agency, Waivers & Auctions" of the current guide.*

## What it is

Every player you don't already own — genuine free agents and players listed by
other managers alike — sits on **one board**, behind one bid button. You buy
them the same way: an **open auction** paid from your Club Balance.

Open means open. You can see the current highest bid, which club holds it, and
how many clubs have bid. When someone outbids you, you get told. There is no
sealed envelope and no hidden phase.

Two things put a player on that board:

- **A manager lists one of their own.** They set a minimum bid and, optionally,
  a "buy now" price. The proceeds go to them as Club Balance income — a real
  transfer fee, not a release.
- **The league seeds one automatically at season kickoff**, for any player whose
  market value is **€50m or more**, *or* who plays for a **newly-promoted club**.
  Every manager gets an email. Promoted-club players are seeded regardless of
  value, because at kickoff nobody in the league owns them and a €12m
  newly-promoted starter is exactly the kind of asset a dynasty league should
  have to compete for rather than claim first.

## Why it works this way

**Why an open auction and not sealed bids?** Because a sealed bid is a guessing
game about other managers, and Gaffa is meant to be a judgment game about
footballers. In a blind format the manager who wins is usually the one who
overshot hardest, and the skill being tested is bid psychology. Open bidding
asks a cleaner question: *what is this player actually worth to your squad, given
that someone else has just told you what he's worth to theirs?* You lose a player
because you decided he wasn't worth another €5m, not because you misjudged a
number you couldn't see.

**Why the price floor on listings?** A manager can't list a player for a token
fee. The minimum bid must be at least **80% of his market value**. Without that,
two managers could move a €90m striker for €1m and call it a sale — collusion
dressed as a transfer. The floor makes a listing a real valuation.

**Why the intent labels instead of gates?** When you list a player you can flag
that you're after cash, players, or a loan. These *advertise*, they don't block.
An earlier version used them as gates — refuse any approach the seller hadn't
ticked — and it backfired: listing a player made him *less* reachable than
leaving him alone, since anyone may propose a loan for an unlisted player on any
roster. Listing him, the one act that says "he's available," was removing the
ways to ask. Now nobody is refused for asking the wrong way; the labels just set
the headline other managers read.

## The numbers that matter

| Rule | Value |
|---|---|
| Auction stays open at least | **24 hours** after the first real bid |
| Then closes | **12 hours** after the most recent bid |
| Hard ceiling | **72 hours** — or **96 hours** if market value ≥ €40m |
| System-seeded auction trigger | market value **≥ €50m**, or player from a **newly-promoted club** |
| Listing minimum bid floor | **80%** of market value |
| Severance if you drop to make room | **20%** of the dropped player's market value, minimum **€2m** |
| Rebate if you start an auction and lose | **20%** of the winning bid, capped at **€5m** |
| Bidding on your own listing | not allowed |

**There is no fixed 48-hour window.** The clock is driven by activity, not by a
timer that started when the auction opened.

## Questions you probably have

**How long do I actually have?**

Until 12 hours after the last bid — but never less than 24 hours after the first
one, and never more than 72 (96 for a €40m+ player). So a quiet auction ends 12
hours after it goes quiet, and a contested one keeps going until people stop.

**How do you stop someone sniping it at 4am?**

That's the whole reason the clock works this way. Every bid pushes the close out
12 hours, so there is no last moment to ambush — bid at 3am and the auction
simply can't close before 3pm, giving everyone a waking chance to respond. The
24-hour floor stops a fast-moving auction from resolving overnight, and the hard
ceiling stops a bidding war from running for a week.

**What if two of us bid at the same instant?**

They're processed one at a time, not simultaneously. Every auction has a hidden
anchor row, and placing a bid locks it, so concurrent bids queue up and each one
sees the true current high bid. You can't sneak in beside someone by clicking at
the same moment.

**What if two of us bid the exact same amount?**

*This is currently undefined.* The resolver sorts candidates by bid amount with
no secondary tie-break, so two equal top bids resolve arbitrarily — not by who
bid first. It has been flagged for a ruling. (See `OPEN_RULES_QUESTIONS.md`.)

**Why would I ever bid first and show my hand?**

Because starting an auction is compensated. If you open the bidding on a player
and someone else ultimately wins him, you're refunded **20% of the winning bid,
up to €5m**. You surfaced the player and drove the price; you don't walk away
with nothing.

**What if I win but my roster is full?**

You nominate a player to drop as part of your bid. Dropping costs a **severance
fee of 20% of that player's market value, minimum €2m**, charged *on top of* your
winning bid — so churn isn't free. At resolution the system checks you can afford
bid *plus* severance and that you have room. If you can't, the player passes to
the next-highest bidder who can.

**What if my nominated drop is mid-match when the auction closes?**

The whole auction defers rather than resolving. A player whose club is currently
playing can't be moved, and the system won't half-execute a transfer around him.
It settles once those matches finish.

**Where does the money go when I buy someone else's player?**

To that manager's Club Balance. That's the difference between a listing and a
drop — a listing is a transfer between clubs with a fee attached, so squad
strength and cash move in opposite directions across the league instead of value
evaporating.

---

### Verified against

`src/lib/auction/timer.ts` · `src/lib/offseason/seasonKickoff.ts`
(`AUCTION_THRESHOLD`) · `src/lib/auctions/seedHighValueAuctions.ts` ·
`src/app/api/leagues/[leagueId]/auctions/route.ts` ·
`supabase/migrations/079_unified_bid_rpc.sql` ·
`supabase/migrations/077_listing_gates.sql` ·
`supabase/migrations/088_listing_intent.sql` ·
`supabase/migrations/076_fix_sale_listing_resolution.sql`
