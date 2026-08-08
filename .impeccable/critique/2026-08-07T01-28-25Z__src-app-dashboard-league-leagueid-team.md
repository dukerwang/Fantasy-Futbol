---
target: Team / Roster (src/app/(dashboard)/league/[leagueId]/team)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-07T01-28-25Z
slug: src-app-dashboard-league-leagueid-team
---
Method: dual-agent (A: a45e8339acd372717 · B: ab32ac7e5512dfbd5)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | IR/taxi swaps fire silently via `router.refresh()` with no persistent confirmation |
| 2 | Match System / Real World | 4 | Exact-position eligibility, real pitch geometry, dynasty vocabulary throughout |
| 3 | User Control and Freedom | 2 | Drop requires confirmation; IR/taxi swaps fire two sequential mutations with none — inconsistent friction for the stakes |
| 4 | Consistency and Standards | 2 | `/team` and `/team/roster` use two incompatible interaction models for the same task |
| 5 | Error Prevention | 3 | Eligibility gating logic is correct but duplicated across four handlers |
| 6 | Recognition Rather Than Recall | 3 | Selection hint lives only in a hover `title` tooltip — dead on touch |
| 7 | Flexibility and Efficiency | 2 | No bulk actions, no shortcuts, one swap at a time |
| 8 | Aesthetic and Minimalist Design | 3 | Pitch view is restrained; `/roster` masthead stacks 4 stat tiles + toolbar + ToDo + 3 view toggles + 2 seven-option selects |
| 9 | Error Recovery | 3 | Specific inline messages, but ephemeral — no persistence |
| 10 | Help and Documentation | 1 | No in-context explanation of IR-gates-bidding or exact-position rules for a first-timer |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment**: Authored for this product, not category-interchangeable. The pitch view mirrors real tactical shape, formation pills are the 10 supported layouts (not a generic roster grid), and `clubDerive.ts`'s `formationReport()` runs actual bipartite matching against exact-position eligibility — that's not something a generic fantasy-roster template ships with. Domain vocabulary ("Academy," "Retained List," severance math) is load-bearing copy, not reskinned generic labels.

**Deterministic scan**: Clean — 0 antipattern findings across all 10 target files (`page.tsx`, `PitchUI.tsx`, `RosterManager.tsx`, `roster/page.tsx`, `ClubClient.tsx`, `ClubSwitcher.tsx`, `Inspector.tsx`, `Intel.tsx`, `RetainedList.tsx`, `SquadViews.tsx`). Assessment B flagged and worked around a real tooling bug worth fixing separately: `detect.mjs`'s glob resolution treats the literal directory segment `[leagueId]` as a bracket character class and silently matches zero files rather than warning — the tool self-validated as working correctly against a bracket-free copy of the same files (confirmed via a deliberately-injected antipattern that it caught), so the 0-finding result is trustworthy, but the direct invocation against any Next.js dynamic-route path (`[leagueId]`, `[teamId]`, etc.) elsewhere in this app will silently under-report. Worth a note to whoever maintains the detector script.

**Visual overlays**: Not available this run — the user declined to grant browser login for this authenticated route, so no live-render pass or overlay was attempted. Everything below is inferred from source (JSX structure, conditional rendering, CSS), not observed on screen.

## Overall Impression

The domain modeling here is genuinely good — eligibility, formation feasibility, and severance math are handled with real rigor, and the pitch itself is the emotional peak of the surface. But the two pages that make up "manage your squad" disagree with each other about how selection works, and the single most consequential action on a fresh team's primary weekly page — get an injured player off the pitch — has no visible entry point on that page. That's not a polish gap; it's a workflow gap on the P0 tier.

## What's Working

- **`validLineupTargets` guides instead of trial-and-error** (`PitchUI.tsx:352-409`): every legal swap target is precomputed and highlighted before the user commits, turning exact-position eligibility into a guided pick rather than a guessing game.
- **Consequences named before commit**: Inspector shows inline severance/net-value math at the moment of a drop decision (`Inspector.tsx:104-134`, `171-182`) — money named before the action, not after.
- **Depth Chart makes squad adequacy concrete**: the zone view plus a "Fieldable Formations" ✓/✗ checklist (`clubDerive.ts:154-176`) turns an abstract "is my squad balanced" question into a visible answer.

## Priority Issues

**[P0] No path to place a player on IR or Academy from the primary "My Team" page**
- **Why it matters**: `activateSidebarSelection` only fires from an existing taxi/IR row's "Swap" button (`PitchUI.tsx:1252-1263, 1309-1320`), and the IR card doesn't render at all when `irEntries.length === 0` (line 1283). `RosterManager.tsx` — which contains these actions — is imported nowhere in the app (confirmed by repo-wide grep); it's dead code. A manager whose player just got injured has no visible way, on the page they check weekly, to do the single most time-sensitive squad action. Per the domain rules, IR also gates auction bidding, so this isn't cosmetic — it blocks downstream actions too.
- **Fix**: Either wire `RosterManager.tsx`'s IR/Academy actions back into `/team`, or if `/team/roster` is meant to own this action, add a visible entry point/link from `/team` (not just a swap-from-existing-slot flow) so the action exists before the first IR entry does.
- **Suggested command**: `$impeccable shape` (this is a missing-flow problem, not a visual one — needs a UX pass before implementation)

**[P1] `/team` and `/team/roster` use two incompatible interaction models for the same task**
- **Why it matters**: `/team` is click-source-then-click-target; `/team/roster` is direct action buttons. A manager who learns one model has to relearn the other for what is conceptually the same "move a player" task — pure extraneous cognitive load with no product reason for the divergence.
- **Fix**: Pick one interaction model and use it in both places, or make explicit in the IA that one page is for viewing and the other for acting.
- **Suggested command**: `$impeccable shape`

**[P1] Formation fieldability is computed but not shown where the formation picker lives**
- **Why it matters**: `clubDerive.ts` already computes which formations are fieldable and surfaces it on `/team/roster`, but the formation picker on `/team` (`PitchUI.tsx:939-983`) doesn't use it. Users discover a bad formation choice reactively, via per-slot red outlines after the fact, instead of being told up front which formations their squad can actually field.
- **Fix**: Reuse the existing `formationReport()` output to disable or flag infeasible formation pills directly in the `/team` picker.
- **Suggested command**: `$impeccable clarify`

**[P2] Filter/sort controls are inconsistent with each other and don't persist**
- **Why it matters**: Filter/sort on `/team/roster` are 7-option native `<select>`s next to a 3-button segmented `view` control — different affordances for parallel-weight decisions. `view` persists to `localStorage` but `filter`/`sort` silently reset on return visits, which reads as a bug to a returning user.
- **Fix**: Match the affordance style across the three controls and persist all three consistently.
- **Suggested command**: `$impeccable layout`

**[P3] Leftover debug artifacts**
- **Why it matters**: `pitch.module.css:3` has a stray `"Trigger Deploy: 2"` comment, and `PitchUI.tsx:1223` has `(taxiEntries.length > 0 || true)` — an always-true condition that's almost certainly leftover debug logic silently short-circuiting real taxi-squad-empty logic.
- **Fix**: Remove the comment; audit and fix the `|| true` condition, since it may be masking a real conditional-rendering bug, not just dead code.
- **Suggested command**: `$impeccable polish`

## Persona Red Flags

**Jordan (First-Timer)**: Walks directly into the P0 above — no visible way to handle an injured player. Also likely misreads the muted-gray formation-lock note as the app being broken rather than a deliberate lock, since nothing distinguishes "intentionally locked" from "not loading."

**Sam (Accessibility-Dependent)**: `PitchNode` nests a clickable photo `<div>` inside the outer `<button>` with `stopPropagation` (`PitchUI.tsx:185-190`) — this mouse-only photo/chip duality isn't keyboard-reachable, and no `aria-live` region announces newly-eligible swap targets after a selection, so a screen-reader user gets no equivalent of the sighted highlight-the-valid-targets affordance that's this surface's best feature.

**Riley (Stress Tester)**: `lockedTeamIds` is fetched once server-side with `revalidate: 15`. A swap attempted inside that 15-second staleness window, right after a real kickoff, renders as editable client-side and only fails late, at save — a real edge case given the domain rule that formation locks the instant any squad player's match kicks off.

## Minor Observations

- `--color-pos-lw` and `--color-pos-rw` resolve to the identical hex value — the "distinct color per tactical position" system is missing 2 of 12 as currently defined in `globals.css`.
- The generic "Network error — please try again." string is copy-pasted verbatim across five separate handlers; fine functionally, but a shared helper would prevent the copies from drifting apart later.
- Detector tooling gap (not a UI issue): `detect.mjs` silently matches zero files against any path containing a Next.js dynamic-route segment like `[leagueId]`, because its glob layer treats `[...]` as a bracket character class. Anyone running the detector directly against this app's route tree should flatten bracket segments first, the way Assessment B did, or they'll get a false-clean scan.

## Questions to Consider

- Is `/team/roster` quietly the real "do things to your squad" surface while `/team` is meant to be read-mostly — and if so, should the IA say that explicitly instead of leaving both pages half-capable of the same actions?
- Would drag-and-drop for the pitch (with click-to-select kept as a keyboard/accessibility fallback) serve the power-user and first-timer personas better than the current single click-source-then-target model?
- The formation-feasibility logic already exists in `clubDerive.ts` — why does the page that actually has the formation picker not use it yet?
