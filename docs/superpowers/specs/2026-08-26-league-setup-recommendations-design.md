# Configurable league setup with recommendations

## Problem

The create-league form (`src/app/(dashboard)/league/create/CreateLeagueForm.tsx`) has five fields — name, max teams, roster size, Club Balance, draft type, dynasty toggle — with fixed defaults that don't move regardless of league size. `bench_size` is hardcoded to 4 server-side and never shown to the user; `ir_size` isn't sent at all (it silently gets the column default of 2). Draft Type offers an "Auction draft" option that's permanently `disabled` — it was never implemented. No logic anywhere relates team count to roster size, bench, IR, or budget, despite real alpha leagues (Matchday Militia, Dynasty Dragoon) already varying team count (6–10) while keeping every other setting identical.

The join form (`src/app/(dashboard)/league/join/JoinLeagueForm.tsx`) is a single invite-code field. A manager gets no information about the league — size, format, whether it's full — until after they submit and land in team-setup.

## Non-goals

- No new "draft rounds" concept. The draft still runs for exactly `roster_size` rounds; this only affects what `roster_size` gets recommended as.
- No auction draft support. The option is removed from the UI, not implemented.
- No changes to redraft-mode mechanics beyond its recommendation numbers — redraft is acknowledged as not fully fleshed out elsewhere in the app, and that's out of scope here.
- No new DB columns or migrations. `bench_size` and `ir_size` already exist on `leagues`; this only starts setting them from user input instead of a hardcoded value / the column default.
- No change to `scoring_rules` — still always `DEFAULT_SCORING_RULES`, not user-configurable here.
- The recommendation bands below are a first pass, not tuned science. Alpha-league experience already suggests even the current default (20-man roster) runs thin once injuries hit — see the code comment called out in "Recommendation model." Expect these numbers to move.

## Recommendation model

New pure function `computeRecommendedSettings({ maxTeams, profile, isDynasty })` in `src/lib/leagues/recommendedSettings.ts`, returning `{ rosterSize, benchSize, irSize, faabBudget }`. No DB or network access — used directly by the client form.

### Presets

Three profiles: `casual`, `standard`, `deep`. `standard` is anchored to match production leagues exactly (10 teams → 20 roster / 4 bench / 2 IR / 250 budget) so nothing that already exists in the wild looks like a regression.

Roster size is a step function of team count, **not** a formula that shrinks indefinitely as teams grow — the 940-player pool (`select count(*) from players where pl_team is not null`, checked 2026-08-26) gives huge headroom even at 12 teams × 24 roster (288, 31% of pool), so team-count pressure on the pool is not the binding constraint. `standard` is floored at today's shipped default (20) rather than continuing to shrink at higher team counts, per the alpha-league note above. `casual` still recommends leaner than `standard` — that's the point of the preset — but its floor (18, or 16 for redraft) stops well short of the 12 the original clamp math would have allowed.

| Teams | Casual | Standard | Deep |
|---|---|---|---|
| 4–5 | 22 | 24 | 28 |
| 6–7 | 20 | 22 | 26 |
| 8–12 | 18 | 20 | 24 |

```ts
const ROSTER_BANDS: Record<Profile, [number, number, number]> = {
  // [4-5 teams, 6-7 teams, 8-12 teams]
  casual:   [22, 20, 18],
  standard: [24, 22, 20],
  deep:     [28, 26, 24],
};
function bandIndex(teams: number) { return teams <= 5 ? 0 : teams <= 7 ? 1 : 2; }
```

Bench and IR derive from the *resulting* roster size, not team count directly — this is what makes them track "roster size → bench/IR proportions":

```ts
benchSize = round(rosterSize * 0.2);              // roster 20 -> 4, matches production
irSize = rosterSize < 18 ? 1 : rosterSize < 23 ? 2 : 3;  // roster 20 -> 2, matches production
```

Club Balance scales inversely with team count (fewer teams competing for each free agent supports a bigger budget), anchored per profile at 10 teams and rounded to the nearest 50:

```ts
const FAAB_BASE_AT_10: Record<Profile, number> = { casual: 150, standard: 250, deep: 350 };
faabBudget = clamp(round50(FAAB_BASE_AT_10[profile] * 10 / maxTeams), 50, 500);
```

Dynasty vs. redraft: redraft subtracts 2 from the roster size *before* deriving bench/IR (a redraft league has no reason to stash long-term depth), everything else computed identically.

```ts
rosterSize = ROSTER_BANDS[profile][bandIndex(maxTeams)] - (isDynasty ? 0 : 2);
```

Leave an explicit comment above `ROSTER_BANDS` noting these are provisional and expected to move once more alpha-season data on injury-driven roster thinness comes in.

### Selectable ranges

- Max Teams: unchanged, `[4..12]`.
- Roster Size: widened from `[15..25]` to `[16..30]` — covers every value the formula can produce (18–28) plus a little manual headroom in both directions, without reintroducing anything as thin as the old clamp math would have allowed.
- Bench Size: new select, `[2..6]`.
- IR Size: new select, `[1..3]`.
- Club Balance: unchanged, `[50..500]` step 50.

## Create-form UX

### Preset picker

Three `toggleBtn`-style buttons (same pattern as the existing Dynasty/Redraft toggle) above the size fields: **Casual**, **Standard**, **Deep Dynasty**. `standard` is selected by default, matching today's behavior. Clicking a preset recomputes roster size, bench, IR, and Club Balance for the current Max Teams and Dynasty/Redraft value, and overwrites all four fields — including any the user had manually edited. This is the one bulk action that's allowed to clobber manual edits.

### Auto vs. manual per field

Roster Size, Bench Size, IR Size, and Club Balance each track an internal "auto" flag, true by default. While a field is in auto mode, changing Max Teams, the preset, or the Dynasty/Redraft toggle recomputes and updates that field. The moment the user changes that field's `<select>` directly, its auto flag flips to false and it stops following further recomputation — but a small hint under the field (`Recommended: 20`) keeps showing the current formula output, so the user can see they've drifted from it without being forced back. Picking a different preset resets every field's auto flag back to true (see above).

Implementation: a `useState<Record<FieldKey, boolean>>` per field, or four separate booleans — small enough not to need a reducer.

### Field layout

Reorganize into three `formSection`s (same `formSection` / `formSectionTitle` / `fieldRow` CSS already in `create.module.css`):

1. **League Details** — League Name (unchanged).
2. **League Size** — preset picker row, then a `fieldRow` with Max Teams, Roster Size, Bench Size, IR Size, Club Balance. Each of the four derived fields gets the `Recommended: N` hint line under it.
3. **Format** — Dynasty/Redraft toggle (unchanged). Draft Type control is removed entirely.

`draftType` state is dropped from the component; the submit payload hardcodes `draftType: 'snake'`.

### Submit payload

Adds `benchSize` and `irSize` to the existing POST body: `{ name, maxTeams, rosterSize, benchSize, irSize, faabBudget, isDynasty, auctionTimezone }`.

## Create API changes (`src/app/api/leagues/create/route.ts`)

- Destructure `benchSize`, `irSize` from the body; drop `draftType` from the destructure (hardcode `'snake'` in the insert — the column and type stay `'snake' | 'auction'` for now, only the UI path to `'auction'` is removed).
- Add range clamps before the insert, since `bench_size`/`ir_size` become client-controlled for the first time and there is currently no server-side validation of any of these numbers (today's client `<select>` is the only guard):
  ```ts
  const clampedMaxTeams = clamp(Math.round(maxTeams ?? 10), 4, 12);
  const clampedRosterSize = clamp(Math.round(rosterSize ?? 20), 16, 30);
  const clampedBenchSize = clamp(Math.round(benchSize ?? 4), 2, 6);
  const clampedIrSize = clamp(Math.round(irSize ?? 2), 1, 3);
  const clampedFaabBudget = clamp(Math.round(faabBudget ?? 250), 50, 500);
  ```
  A small local `clamp(n, min, max)` helper is enough; no need to import one.
- Insert gains `ir_size: clampedIrSize` (currently absent from the insert entirely) and uses `bench_size: clampedBenchSize` in place of the hardcoded `4`.

## Types (`src/types/index.ts`)

Add `ir_size: number;` to the `League` interface, next to `bench_size`.

## Join flow

### New lookup endpoint

`GET /api/leagues/lookup?code=XXXX` (new route file `src/app/api/leagues/lookup/route.ts`). Auth required (same pattern as `join`). Looks up by `invite_code` (lowercased, trimmed) and returns public-safe fields only:

```ts
{ name, maxTeams, currentTeams, rosterSize, faabBudget, isDynasty, status }
```

`currentTeams` is the `league_members` count for that league — the same query `join/route.ts` already does for its capacity check, just returned instead of only checked. 404 with `{ error: 'Invalid invite code' }` if no league matches. No membership row is created by this route — it's read-only.

### Join-form UX

`JoinLeagueForm.tsx` gains:

- Debounced lookup (e.g. 400ms after the code reaches a plausible length, or on blur) that calls the new endpoint and renders a preview card below the input: league name, `{currentTeams}/{maxTeams} teams`, roster size, Dynasty/Redraft, Club Balance.
- A Team Name text input (optional, same placeholder-style fallback as create — `{username}'s Club` if left blank), shown once a valid preview loads.
- Preview-time status messaging: if `currentTeams >= maxTeams`, show "This league is full" and disable the Join button instead of letting the user find out only after submitting. If `status` is `'active'` or `'complete'`, show "This league is no longer accepting new members" and disable Join the same way. (The join API's own checks stay as the authoritative backstop — this is purely earlier, friendlier surfacing of the same two conditions it already enforces.)
- Submit still POSTs to `/api/leagues/join` with `{ inviteCode, teamName }` — that route already accepts `teamName` today (`join/route.ts:10,69`), so no server change needed there beyond what's already shipped.

## Testing

Unit tests for `computeRecommendedSettings` in `src/lib/leagues/__tests__/recommendedSettings.test.ts`: the 3×3 table above as direct cases (all three profiles × the three team-count bands), the redraft −2 adjustment, budget rounding/clamping at the extremes (4 teams and 12 teams for each profile), and the bench/IR breakpoints at their boundary values (17/18 and 22/23 roster size).

No automated coverage for the form wiring or the lookup route — verify those manually in the dev server: create a league at a few different team counts and confirm the preset picker and auto/manual field behavior, then look up a real invite code (e.g. from `Matchday Militia` or `Dynasty Dragoon`) and confirm the preview card and full/inactive states render correctly.

## Approved in conversation (2026-08-26)

- Draft rounds stay tied to roster size (no decoupling); recommendations just explain/tune the existing relationship.
- Recommendation inputs: max teams → roster size, max teams → Club Balance, roster size → bench/IR, dynasty vs. redraft. Auction draft type removed as an option (never implemented).
- UX is a preset picker (Casual/Standard/Deep Dynasty) combined with live auto-recommended fields that track Max Teams/preset/dynasty until manually overridden.
- Join flow gets a league preview card and inline team-name field before submitting, not just visual polish.
- Implement directly against existing design tokens/components — no separate Claude Design prototype pass for this one.
- Roster-size floor corrected upward mid-design after user flagged the original clamp math (`clamp(26 - teams, 12, 21)`) as producing values as low as 12, and noted alpha-league experience suggests even 20 already runs thin — floors are now step-function bands anchored at or above today's shipped default, never below it.
