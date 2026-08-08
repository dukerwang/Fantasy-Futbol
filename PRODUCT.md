# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Managers in a single private, invite-only dynasty league — a closed group of friends who
know each other, not a public consumer audience. They are football-literate: they know what
a false nine is, they argue about whether a player is really a DM or a CM, and they treat
the league as an ongoing multi-year rivalry rather than a weekly game.

The core weekly job: check what happened in the last gameweek, set a legal lineup before
kickoff, and work the market (bids, trades, loans). The core seasonal job: manage a squad as
a long-term asset across seasons.

Status as of 2026-08-06: the first-ever multiplayer draft has already happened. The 2026-27
season kicks off at GW1 on 2026-08-21. The app is live at gaffa.live with real managers in it.

## Product Purpose

A dynasty fantasy football app that mirrors real-world tactical roles instead of flattening
them. Players are scored contextually against position-specific statistical baselines rather
than a flat point table, so a defensive midfielder is judged as a defensive midfielder.

Success is that the league feels like running a real club across years: squads have history,
decisions have consequences that outlive a season, and the scoring rewards understanding
football rather than memorizing a points sheet.

## Positioning

Three mechanisms a mainstream fantasy platform could not truthfully claim:

1. **Twelve tactical positions** (GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST) — no
   generic DEF/MID/FWD buckets. Eligibility is exact-position only: a bench CB never covers
   an LB slot. Out-of-position defenders take a 20% penalty.
2. **Contextual sigmoid scoring** — eight rating components normalized against
   position-specific medians and standard deviations, combined via positional weights, then
   mapped to a display rating and a separately-calibrated points scale.
3. **True dynasty** — the draft happens exactly once per league, ever. There is no seasonal
   re-draft. Everything after is auctions, trades, loans, retention, and an offseason reset.
   The league cycles season → offseason → season indefinitely and never reaches a
   "completed" state.

## Operating Context

- **Weekly gameweek rhythm.** Lineups are set before kickoff and resolved when FPL marks the
  gameweek finished; auto-subs and role-aware re-scoring run at resolution.
- **Two independent lockouts.** The formation locks when any squad player's match kicks off;
  an individual player locks only when his own club kicks off. These are not one lock.
- **A live market between matches.** Auctions run a 72h initial window with a decaying
  inactivity timeout and quiet hours. Trades are negotiated manager-to-manager with no
  commissioner sign-off. Loans are capped 1 out / 2 in.
- **Cup competitions alongside the league.** Cup ties never draw; the regular season has a
  10-point draw band.
- Managers use this on desktop and on a phone, often mid-conversation with each other.

## Capabilities and Constraints

- **Stack is fixed:** Next.js 16 App Router, TypeScript, React 19, Supabase, **vanilla CSS
  Modules**, Framer Motion. There is no Tailwind and no utility-CSS framework. Design tokens
  are CSS custom properties in `src/app/globals.css`.
- **Two themes are required**, light and dark, both first-class.
- **The position taxonomy is load-bearing**, not decorative: it drives roster validation,
  lineup eligibility, and scoring weights simultaneously.
- **Ten supported formations** (`Formation` in `src/types/index.ts` is the source of truth;
  the README's "seven" is stale, and the login carousel currently repeats that stale number).
- Points floor at zero and are never negative.
- Data arrives from FPL, SoFIFA, and Transfermarkt; market values and positions can be
  missing or stale for a brand-new arrival, so the UI must tolerate absent values.

## Brand Commitments

- **Name:** Gaffa, live at gaffa.live. ("Gaffer" — the manager. The name is the job.)
- **"Club Balance", never "FAAB".** `faab_budget` is the database column; all user-facing
  copy says Club Balance or budget. It is uncapped and a permanent dynasty asset, and must
  never be rendered as a spent/remaining usage meter.
- **Currency is `€{n}m`.**
- Leagues are dynasty and never "complete".
- Existing assets: club badges at `/team-logos/{slug}.png` keyed by durable club slug (never
  by an FPL team id, which is reassigned every season), and player photography.

## Evidence on Hand

- Real league and player data in Supabase, including a full 2025-26 season of stats.
- A public, frozen 2025-26 stats snapshot at `/share/stats` (647 players) — real names, real
  clubs, real points, real market values. Usable as truthful sample content.
- Real club badges and real player photography already served by the app.
- No testimonials, press, customer logos, pricing, or usage metrics exist. Future work must
  not fabricate any.

## Product Principles

1. **Tactical truth over convenience.** When a simplification would blur a real football
   distinction, keep the distinction. The twelve positions are the product.
2. **Decisions must outlive the week.** This is a dynasty; surfaces should make long-term
   consequence visible, not just this gameweek's score.
3. **The league is a rivalry between named people.** Managers are not anonymous rows; the
   product is social and the other managers are always present.
4. **Tolerate incomplete data without lying.** Missing values are normal; show absence
   honestly rather than inventing a number.
5. **Never render the budget as a depleting resource.** It is an asset, not a fuel gauge.

## Accessibility & Inclusion

WCAG AA is a hard requirement for text and meaningful UI, and the current system does not
meet it: position badges use white text on raw position hues (goalkeeper amber computes to
roughly 2.4:1), and several position hues used as text in dark mode land near 2.3:1. Any
replacement system must clear 4.5:1 for normal text and 3:1 for large text and meaningful
non-text indicators, in **both** themes.

Color must never be the sole carrier of meaning — position, match state, and
positive/negative deltas each need a non-color cue as well.
