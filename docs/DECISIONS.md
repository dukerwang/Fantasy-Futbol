# Decisions

Design and product decisions **Duke actually made**, in his own words, with dates.

## Why this file exists

Gaffa is a solo repo, so every commit is authored by Duke regardless of who wrote
the content. That makes git history useless for telling apart *"Duke decided
this"* from *"an agent wrote this and it stuck."*

That gap caused a real problem. On 2026-08-08 an agent wrote the phrase
`Green = Gaffa and "yours"` into `design-2.0/README.md` as a design law. Nothing
recorded that it was agent-authored. Later sessions read it as settled, cited it
back to Duke as his own rule, spread it to roughly twenty places across the
codebase, and then designed *around* the constraint it imposed — including
proposing workarounds for problems the rule itself had created. Duke found it on
2026-08-22 and said: *"it's probably written by claude, not me and i don't want
polluted context that affects your (and future agent) decisionmaking."*

**The rule for agents:** if it is not in this file and you cannot cite a file or
a user message, it is not a decision. Tag it `[inferred]` in `DESIGN.md` and move
on. Do not name it. Do not promote it. Do not cite it back to Duke as his own.

Add to this file only when Duke states something directly. Quote him. Date it.
Do not paraphrase into something more decisive than what he said.

---

## 2026-08-22 — Design system revision

**"One job per colour" is not binding.**
> "my focus is on making the best ui for gaffa possible, if that can be
> accomplished with more than one green i could not care less."

Supersedes decision 7 in `design-2.0/README.md`, which was agent-authored. Green
may carry chrome, primary action, positive delta, "yours", and success
simultaneously, provided the roles are named and the steps are distinguishable.

**Wingers stay green.**
> "i think we should keep wingers green, and i like the slight tweak you made to
> that color, i didn't like the terracotta color you wanted originally."

Terracotta is rejected. The 178° adjustment is approved — chosen because Duke
likes it, not because any rule requires it.

**Creams get brighter; beige is out.**
> "i think you did good by brightening some of the creams, i think the beigish
> colors we've been using before seem very old and outdated."

Direction of travel on neutrals: brighter, less saturated, less yellow.

**The green topbar stays.**
> "i think i actually ended up liking green topbar"

Reverses his earlier uncertainty about it. It is kept because he likes it.

**No coloured accent bars on container edges.**
> "i also hate colored accented ends by the way, it's by far the most annoying
> generic ai sign to me."

Covers top rules on cards, left-border accent cards, gradient header strips, and
coloured dots before labels.

**No eyebrow labels above page titles.**
> "i don't really love eyebrows as they are a sign of generic ai ui... it felt
> like every page was just an eyebrow header with a white gpanel laid on top of
> a cream background after it."

Also the clearest statement of what was wrong with the 2.0 page architecture:
the eyebrow → title → panel-on-cream pattern, repeated identically on every page.

**Gaffa is not a themed costume.**
> "at the end of the day it's a fantasy football app, made to be accessible for
> everyone... rather than creating a brilliant and sophisticated ui that
> may/may not be inspired by football aesthetics."

Rejects direction proposals framed as football pastiche ("matchday programme",
"the instrument", "the kit"). The target is sophisticated, accessible product UI.

**Prototypes must diverge on the axis that matters.**
> "are these prototypes deliberately devoid of color? aside from spine."

Two of three League Home prototypes were built colour-sparse while "not enough
colour" was the original complaint. Divergence axes must be chosen against the
stated problem.

---

## 2026-08-23 — Squad editor opens next week at this week's last kickoff

Chose league-wide handoff (option A) over per-manager ("your last player has kicked off"):
> "alright yeah just do A."

Earlier: keep the two kickoff locks, but stop gluing the squad page to this week until scores
are final — that window is too small when midweek games roll into a Friday GW.
> "option 1 makes the most sense, i need to think more about choosing A and B."

A is the last Premier League kickoff of the gameweek, same moment for everyone. B would
have flipped each manager when their own last squad player kicked off.

---

## 2026-08-24 — Free-agent auctions settle at the clock

Approved options 1 and 3: free-agent auctions resolve when the bidding clock ends, and the card must not say "ended" until settlement. Kickoff deferral stays for manager listings, trades, loans, drops, and a locked drop-player on a winning bid.
> "ok so you're saying eliminate deferrences altogether. and where are they still - only for trades and stuff like that? i guess that makes sense to me. 1 and 3 is good"

---

## 2026-08-30 — Player hub, and how Futbolpedia data is grounded

**Availability leaves the outlook sidecar; dynasty value is explicit.**
> "availability - agreed" / "dynasty - sure"

**Facets must not be built on Gaffa scoring.** Duke caught `output_profile`
being computed from `fantasy_points`, which breaks the outlook spec's own
firewall.
> "i'm a bit confused, because i really don't know if these should be based on
> gaffa stats... in futbolpedia, wouldn't it be based more off of real life and
> overall rather than last season's gaffa stats?"

This produced the football/league layer split that the hub design is built on.
Note the distinction that survived the exchange is derived-vs-raw, not
Gaffa-vs-real-world: `player_stats` holds real Premier League match data that is
fine to use, plus two Gaffa-derived columns (`fantasy_points`, `match_rating`)
that are not.

**The stats page is a hub rework, not a redesign with an outlook section.**
> "my vision for the new stats page isn't just a simple redesign with an outlook
> section, i'm thinking more of a complete hub rework, like a really indepth
> player page with writing, stats, etc."

**Player-centric, with club and position as filters** rather than their own
sections.
> "i think player centric but it would also be helpful to filter by players from
> a specific club or position, etc."

**Cards are the default index view; the table stays as an alternate.**
> "the default card design looks great"

**The scatter is its own feature, and floor/ceiling is the wrong default.**
> "i also think direction b- landscape is interesting, but i think this is
> honestly a whole other component, definitely not floor/ceiling graph by
> default, maybe like ppg x market value or something. it would be like an
> actual graph stats feature that feels interactive and real data-ey."

Full design: `docs/superpowers/specs/2026-08-30-player-hub-and-index-design.md`.

---

## Earlier — recorded from CLAUDE.md and docs/USER_GUIDE.md

These predate this file and are load-bearing product decisions, kept here as
pointers rather than restated:

- **"Club Balance", never "FAAB"** in user-facing copy; uncapped, never rendered
  as a spent/remaining meter. (`CLAUDE.md`)
- **Twelve tactical positions, exact-position eligibility.** A bench CB never
  covers an LB slot. (`docs/USER_GUIDE.md`)
- **The draft happens once per league, ever.** No seasonal re-draft.
  (`docs/USER_GUIDE.md`)
- **Two themes are both first-class**, and WCAG AA is a hard requirement in both.
  (`PRODUCT.md`)
