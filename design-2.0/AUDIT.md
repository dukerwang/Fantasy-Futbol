# Audit: what Gaffa's CSS actually does today

Evidence for the 2.0 redesign. **This is an observation document, not a spec.** It records
what the code does so 2.0's decisions are informed rather than invented. 2.0 is not a port
of any of it.

Method: all 61 `*.module.css` files, split by last-commit date. **Newer cohort** = 29 files
touched on or after 2026-07-28 (the transfers cluster, clubs, standings, matchup detail,
chat). **Older cohort** = the other 32. Counts are normalised per 100 lines where cohort
size would otherwise distort them. Regenerate with the scripts noted at the bottom.

---

## 1. What the newer work genuinely got right

These are real improvements and should carry the most weight.

**Structure is carried by hairlines, not shadows.** Hairline-to-shadow ratio is **5.5:1 in
the newer cohort vs 3.0:1 in the older**. And the *fainter* border is the default:
`--color-border-subtle` is used 161 times against `--color-border`'s 106. This is the single
biggest reason the newer pages read as precise rather than soft — groups are divided by a
ruled line instead of being boxed in a floating card.

**Figures became typographic.** `tabular-nums` per 100 lines: **0.22 new vs 0.07 old** (3.1×).
`--font-mono`: **0.39 vs 0.04** (~10×). Proportional digits in body sans is most of what made
the older screens feel casual; aligned figures in serif or mono is most of what makes the
newer ones feel like a record.

**Colour became token-driven.** Raw hex per 100 lines: **0.50 new vs 1.66 old** — the newer
cohort carries 3.3× less hardcoded colour. Both themes therefore actually work on those pages.

**Faint tinted grounds replaced saturated fills.** `--color-accent-dim` (25 uses) and
`--color-danger-dim` (15) plus `color-mix` at 4–8%. A 5% tint behind a label reads as
stationery; a saturated pill reads as a toy.

**Type got finer and denser**, with small-caps tracked labels (`0.08em`–`0.14em`) doing a lot
of the structural work. This is a genuine part of the "more sophisticated" impression.

---

## 2. What it got wrong, or left unresolved

Do not copy these into 2.0.

**The radius vocabulary fragmented.** I earlier described the newer pages as following a
clean two-tier rule (12px shell, 2–4px inside). That was too generous — it is true of
`club.module.css` specifically (25 of its 35 radii are ≤4px, exactly 2 are 12px) but it is
not true of the cohort. Across the newer files: `--radius-sm` ×66, `--radius-md` ×31,
`--radius-lg` ×19, `--radius-full` ×8, `50%` ×25, plus literals **3px ×26, 2px ×16, 4px ×13,
7px ×13, 5px ×12**. Five undocumented literal radii is not a rule, it is improvisation that
happens to land well on the best page.

**The type scale is being bypassed constantly.** Alongside the tokens, the newer cohort
carries `0.6rem` ×28, `0.72rem` ×26, `0.8125rem` ×20, `0.75rem` ×19, `0.69rem` ×15,
`0.59rem` ×13, `0.5rem` ×12, and bare `11px` ×28, `10px` ×27, `9px` ×20.

**There is 8px text shipping.** `league.module.css:363`, `trades.module.css:830` and `:1204`
at `8px`; `draft.module.css:482`, `deals.module.css:222` and `:373` at `0.5rem`. That is
below any defensible floor.

**Spacing partly escaped its scale too** — `0.55rem 0.75rem` and `0.55rem 0.7rem` sit next to
`var(--space-*)` in the same files.

**The tracked small-caps label is unrationed.** `0.1em` ×27, `0.08em` ×22, `0.14em` ×22,
`0.06em` ×16. It is a good device that has lost force through repetition; when every group is
introduced by one, none of them signals anything.

---

## 3. The root cause worth naming

The escapes are not rebellion, and treating them as sloppiness would draw the wrong lesson.

`globals.css` defines `--text-xs: 0.75rem` (12px) as its smallest step. The newer pages wanted
9–11px for meta rows, column heads, and chips. So the scale's floor was above the density the
design was reaching for, and the only way down was a literal. Same story for radius: the scale
offers 4 / 8 / 12 / 16 / 24, and the pages wanted 2 and 3.

**People escaped the scales because the scales lacked the steps they needed.** The fix is to
extend the scales down so nothing needs to escape them — not to police the escapes.

The same applies to the radius comment in `globals.css:109`, which mandates 12px cards because
4px "read boxy". The best recent page ignores that and is better for it. The written intent is
behind the practice.

---

## 4. What this implies for 2.0

Decisions, not observations. Informed by the above; not bound to it.
**All seven are now resolved and encoded in the prototype's `gaffa.css`; see `README.md`.**

1. **Hairline-first elevation becomes law.** Declare elevation once per element — border *or*
   shadow, never both. Shadow is reserved for things that genuinely float (modals, the player
   card). This formalises the newer cohort's strongest instinct.
2. **Extend the type scale down to 10px** with real steps (10 / 11 / 12 / 13 / 15 / 17 …) and
   set the floor there. 8px is not a step, it is a bug. Nothing then needs a rem literal.
3. **Resolve radius into a stated rule** rather than five literals. The clubs page's instinct
   is the right starting point (a shell radius, a much smaller control radius) but 2.0 should
   state it as a rule with a named token per role, and drop the 3/5/7px improvisations.
4. **Tokenise the tints.** One faint-ground token per semantic colour, replacing ad-hoc
   `color-mix` at 4/5/6/7/8% — those percentage differences are invisible and carry no meaning.
5. **Ration the tracked label.** Keep the device, cut the frequency; it earns its force back
   from scarcity.
6. **Keep tabular/serif figures as law**, extended to every number in the app rather than the
   ~0.22 per 100 lines the newer pages reach.
7. **Carry the palette and contrast work over unchanged** — see `README.md`. That work is a
   bug fix (GK badges at 2.4:1, `#1FA35F` at 4.33:1) and is independent of any of the above.

Open, deliberately not decided here: whether the older surfaces get brought forward, and in
what order. That is scope, not design.

---

## Regenerating

The two throwaway analysis scripts used for this live in the session scratchpad, not the repo.
The durable one is `verify-palette.mjs` in this directory. To redo the cohort comparison,
split `*.module.css` by `git log -1 --format=%ad`, then count per 100 lines: `box-shadow:`,
`border[a-z-]*: 1px solid`, `tabular-nums`, `--font-mono`, `#[0-9a-f]{6}`, and tally
`border-radius:` / `font-size:` / `letter-spacing:` values.
