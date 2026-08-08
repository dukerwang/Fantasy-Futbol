---
target: League Home prototype (design-2.0)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-08T04-06-12Z
slug: design-2-0-league-home-handoff-md
---
Method: dual-agent (A: design review · B: detector+browser) + a third data-inventory pass.

## Design Health Score — 25/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | "Live" never says when it last updated; "9 of 11" doesn't say which two or when they kick off. |
| 2 | Match System / Real World | 4 | Matchweek / Build-up / Full time / Also this week / EURm — register is exact. |
| 3 | User Control and Freedom | 2 | Nothing dismissible or filterable; the attention strip accrues chores with no way to mark one handled. |
| 4 | Consistency and Standards | 3 | `.app a` (0,1,1) defeats `.attnItem`/`.mwRow` (0,1,0): attention text and club names render accent green; hover darkens. |
| 5 | Error Prevention | 3 | Lineup + IR warnings are good; nothing warns about what actually costs points (uncovered bench slot, OOP, blank fixture). |
| 6 | Recognition Rather Than Recall | 2 | Draw meter is pure recall: no axis, no legend, no visible zero. Form pips are colour-only. |
| 7 | Flexibility and Efficiency | 2 | No affordance for the 6x/day user: no compact mode, no sticky score, no last-updated, no keyboard path. |
| 8 | Aesthetic and Minimalist Design | 3 | Strongest axis; loses a point for ~390-1200px of dead rail with a column rule running into white space. |
| 9 | Error Recovery | 2 | No empty states designed anywhere; `hasAttn` hardcoded true. Bye week, small league, missing market value all undesigned. |
| 10 | Help and Documentation | 1 | Nothing. No tooltip on the draw band; no link to the guide that answers exactly what this page provokes. |
| **Total** | | **25/40** | **Acceptable** |

Cognitive load: 5 of 8 failed (single focus, visual hierarchy, one-thing-at-a-time, working memory, progressive disclosure).

## Design Specificity Verdict

Tastefully dressed generic, and it is provable rather than a matter of taste. Eight of the old page's nine widgets survive into the new one; one is cut (Academy); three are new (attention strip, other fixtures, draw meter). The skeleton -- KPI row, alert bar, hero scorebug, four competition tiles, other fixtures, standings, top-5 performers, activity rail -- is the generic fantasy-league-home skeleton with Gaffa vocabulary applied on top.

PRODUCT.md names three claims a mainstream platform could not make. On this page twelve tactical positions are five 7px squares, contextual sigmoid scoring is the number 18.94, and true dynasty is one figure, EUR218m. The three things the product is built on are the three things the page renders most weakly.

Deterministic scan: 1 finding across 179 classes -- `side-tab` (3px left accent border) at line 109 on `.attn`. Judged justified: it is the deliberate "needs you" flag paired with an amber lead block, not generic card decoration.

## Priority Issues

**[P0] AA contrast fails in both themes, on the most urgent copy.** `--color-text-muted` measures 2.73-2.94:1 on cream and 4.03-4.70:1 on dark; `--color-warning` is never redefined for dark and measures 1.87:1 on cream carrying "NEEDS YOU" and "LINEUP NOT SET". Dark fails on accent links (4.33), live dots (3.30), rank arrows (3.30-3.60), and the primary CTA (3.25). PRODUCT.md makes AA a hard requirement and says the current system already fails it; porting the tokens verbatim ships the failure and marks it done. Fix: a warning-text token distinct from warning-fill, lift muted, make dark accent-hover lighter than accent, add a global :focus-visible.

**[P0] Mobile loses data, not just layout.** At 375px the page forces a 566px content width. Hero team names compute to width 0 and render on top of the scores; all three attention messages compute to width 0 inside overflow:hidden, so the copy is literally gone; the standings grid is 366px inside a 325px card under overflow:hidden, so Pts and Form are clipped with no scroll. The two things you open a phone for are the two most broken elements.

**[P1] The page never answers "what is about to cost me points."** No bench-cover audit, no OOP flag, no blank-fixture flag, no zero-point/auto-sub debrief. These are the four ways a manager loses points to the system rather than to football, and the guide names exact-position eligibility as the most common mistake in the game.

**[P1] The draw meter cannot express a loss.** `pct = 50 - (margin/40)*50` with margin always a positive magnitude means the marker leans left regardless of who leads. No prototype state exercises a defeat, so it was never visible. Combined with an invisible band (bg-elevated on bg-card), a buried zero tick, no axis and no legend, the signature detail is both undecodable and functionally incomplete.

**[P2] The market is absent as a live thing.** A gameweek is ~3 days of football and ~4 days of transfers. Through the longer half the hero is static, "Elsewhere" is four rows of em-dashes, and the market exists only as past-tense prose. `auction_state` is one indexed query, already on the Realtime publication.

**[P2] `.app a` specificity silently defeats two colour decisions.** Verified: `.attnText` and `.mwN` both compute to rgb(20,107,64). The handoff says port the CSS wholesale, so this ships.

## Persona Red Flags

**Power user, 6 checks a day:** no last-updated stamp, no delta since last look, no sticky score, no compact mode. Scrolls past a 46px masthead, a KPI row, a chore bar, four tiles and a ten-row table -- all static since Tuesday -- to reach one number.

**Phone, one-handed:** attention text truncates to nothing; "Set your lineup" is a 29px target; inline links are 13px tall; standings clip silently.

**Screen reader / keyboard:** standings are a div grid with no table semantics; form pips are empty spans carrying W/D/L in background-color alone, which PRODUCT.md forbids by name; zero :focus-visible rules; live scores have no aria-live.

## Widget Audit

KEEP: attention strip (fix empty state, reflow, add exposures), hero live, hero full time (add debrief), close-of-season stage rail, the table (add stakes), the Wire (shorten to 5).
CHANGE: masthead figures (drop Points for), hero build-up (replace form/H2H with squad readiness), On all fronts (fixtures not nouns), the gameweek's best (your week, not the league's).
CUT: desk summary as constituted, "Elsewhere" in build-up, close-of-season final table and season's best (both belong to /history).
REBUILD OR CUT: the draw-band meter.

ADD, ranked by value x cheapness: live market band (auction_state, one query); squad availability strip (fpl_status + pl_fixtures); full-time debrief (auto-subs, zeros, bench bonus); what your position is worth (pure function); next payday (pure function); bench-cover and OOP exposure warnings; the opponent as a person (all-time H2H + DM); a dynasty line (season number, trophies, retained slots).

## Questions to Consider

1. If you deleted the table, the Wire, and the gameweek's best -- the three complete copies of other pages -- what would you have to invent to make Home worth opening?
2. Who is the second-most-important person on this page? Right now, nobody.
3. The page has four states. Does it have four rhythms? Sunday 16:40 and Wednesday 11am are the same layout with different numbers.
4. What does this page look like for the manager sitting 10th in March? The guide says three cups exist precisely so that person still has something.
5. In a dynasty, what on this page will still matter in three seasons?
