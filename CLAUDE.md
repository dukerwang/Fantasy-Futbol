# CLAUDE.md — Execution Context

This file provides the necessary commands, patterns, and rules for **Claude Code** to execute tasks within the Fantasy Futbol repository.

## 🛠️ Build & Development Commands
- **Local Dev**: `npm run dev` (Usually port 3000)
- **Production Build**: `npm run build`
- **Linting**: `npm run lint`
- **Database Migrations**: Apply new `.sql` files in `supabase/migrations/` via the Supabase Dashboard or CLI.
- **Edge Functions**: Deploy via `supabase functions deploy [slug]`.

## ⚽ Scoring Engine Logic
- **Primary Source**: `src/lib/scoring/matchRating.ts`.
- **Sync Requirement**: Changes to `matchRating.ts` **MUST** be manually mirrored in `supabase/functions/sync-ratings/index.ts`.
- **Normalization**: Use `sigmoidNormalize(val, median, stddev)`. Always load `ReferenceStats` from the DB using `loadReferenceStats()`.

## 🗄️ Database & RPC Reference
- **Key Tables**: `players`, `player_stats`, `teams`, `leagues`, `roster_entries`, `transactions`, `waiver_claims`, `matchups`, `draft_picks`.
- **Core RPCs**:
    - `resolve_matchup(p_matchup_id, p_score_a, p_score_b, ...)`
    - `increment_team_points(team_id, pts)`
    - `update_player_form_ratings()` (Updates `form_rating` and `ppg` on `players` table)
- **Views**:
    - `league_standings`: Calculated rank based on `league_points` (Draw if `ABS(score_a - score_b) <= 10`).
    - `player_rankings`: Overall and positional ranks.

## 📋 Definition of Done (DoD)
A feature is **NOT** complete until the following are implemented/verified:
- [ ] **Edge Cases**: Handling of `null` stats, missing players, or mid-game transfers.
- [ ] **Error States**: Proper UI feedback for failed API calls or invalid bids.
- [ ] **Empty States**: "No players found" or "No activity yet" placeholders.
- [ ] **Loading States**: Skeletal loaders or spinners during data fetching.
- [ ] **Mobile Responsiveness**: Layout check for player cards and draft room.

## ⚠️ Fragile Areas & Patterns to Avoid
- **Hardcoding Baselines**: Never hardcode medians/stddevs in the engine; always use `DEFAULT_REFERENCE_STATS` as a fallback for the DB-loaded values.
- **Shadowing IDs**: Be careful with `api_football_id` vs `fpl_id` vs `id`. `id` is our internal UUID.
- **Direct DB Mutate**: Prefer RPCs for financial (FAAB) or points-sensitive updates to ensure ACID compliance.
- **Localhost Testing**: **IMPORTANT**: Changes are only live for the user after `git push` to Vercel.

## 🎨 Design System (Vanilla CSS)
- **Variable Usage**: Always use `@/app/globals.css` tokens.
- **Position Colors**: `var(--color-pos-gk)`, `var(--color-pos-st)`, etc.
- **Primary Theme**: `var(--color-bg-primary)` (#0a0c10), `var(--color-text-primary)` (#e8eaf0).
