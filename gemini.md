# Antigravity (Gemini) - Project Context

You are the primary AI assistant for **Fantasy Futbol**, a dynasty-style Fantasy Premier League application. This file serves as your persistent memory and baseline instructions for this repository.

## 🛠️ Technology Stack
- **Framework**: Next.js (App Router, TypeScript)
- **Database/Auth**: Supabase (PostgreSQL)
- **Styling**: **Vanilla CSS Modules** (No Tailwind/Bootstrap)
- **Deployment**: Vercel (https://fantasy-futbol-tau.vercel.app)

## ⚽ Scoring Engine (The Core)
The application uses a custom-built, empirical match rating engine (1-10) instead of the standard FPL points system.

### Mechanics
- **Source Data**: 3 seasons of historical FPL data (23/24, 24/25, 25/26) was used to calculate medians and standard deviations for 12 granular positions.
- **Normalization**: Every component (Goal Involvement, Defensive, Threat, etc.) is normalized via a **Sigmoid Function** using the position-specific `median` and `stddev` from the `rating_reference_stats` database table.
- **Weights**: Ratings are weighted composites based on `POSITION_WEIGHTS` in `src/lib/scoring/matchRating.ts`.
- **Attackers**: Strikers and Wingers have been balanced by tightening the "Finishing" standard deviation (0.15), rewarding clinical overperformance against xG.

### Key Logic Files
- `src/lib/scoring/matchRating.ts`: The primary engine logic.
- `supabase/functions/sync-ratings/index.ts`: The edge function that replicates this logic for batch processing. **Keep these two in sync.**

## 📂 Project Structure
- `src/app/api/sync`: Endpoints for syncing FPL live data and calculating ratings.
- `src/components/players`: UI components for the "Granular Position" design (e.g., CB vs LB).
- `specs/`: Contains detailed design and implementation plans.

## ⚠️ Important Rules
1. **Dynamic Baselines**: Always load reference stats from the DB (`rating_reference_stats`) using `loadReferenceStats()` before calculating scores.
2. **Vanilla CSS Only**: All UI must use CSS Modules. Maintain the "Premium Dark" aesthetic.
3. **No Over-normalization**: Do not flatten the 1-10 rating curve. High ratings (9.0+) should be rare and represent elite performance.
4. **Vercel Testing**: Always test against the production Vercel DB/API if possible, as it is the source of truth for gameweek status.
