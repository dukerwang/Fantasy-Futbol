# Claude - Terminal Context & Data Ops

This file serves as your persistent memory and baseline instructions for the **Fantasy Futbol** dynasty league application. You are primarily responsible for **Data Pipeline Operations** and **Database Integrity** from the terminal.

## ⚽ Scoring System: The "Sigmoid Engine"
The match rating engine is empirical and relies on 3 seasons (2023–2026) of FPL match logs.
- **Reference Table**: `rating_reference_stats`. This table contains `median` and `stddev` for 9 components across 12 positions.
- **Normalisation**: We use a `sigmoidNormalize` function `1 / (1 + exp(-z))` where `z = (raw - median) / stddev`.
- **Edge Function**: [sync-ratings](file:///Users/dukewang/Fantasy%20Futbol/supabase/functions/sync-ratings/index.ts) is the source of truth for batch updates.

## 🛠️ Key CLI Tasks
1. **Backfills**: If you need to recalculate historical ratings, trigger the `api/sync/stats?mode=fpl_live&gw=X` endpoint for each gameweek.
2. **Migrations**: All DB changes must be applied via Supabase migrations. Check [supabase/migrations](file:///Users/dukewang/Fantasy%20Futbol/supabase/migrations) for previous schema additions.
3. **Data Quality**: When scraping (e.g., from SoFIFA), use the position mapping logic that converts FIFA 23/24/25 labels to our 12 Granular Positions (GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST).

## 📂 Architecture Overview
- **Next.js 15+** (App Router, TS).
- **Vanilla CSS Modules** (No Tailwind).
- **Supabase** (Postgres, Edge Functions, Auth).

## ⚠️ Important Rules for Claude
1. **Don't touch Styling**: Antigravity handles the Vanilla CSS Modules. Focus on the data and logic.
2. **Keep Engines in Sync**: Any change to [matchRating.ts](file:///Users/dukewang/Fantasy%20Futbol/src/lib/scoring/matchRating.ts) must be mirrored in the Edge Function code.
3. **Use Admin Privileges**: You often have `SERVICE_ROLE_KEY` access via `.env.local`; use it for full database control.
4. **Fuzzy Matching**: When merging FPL data with external sources, use the fuzzy name-matching scripts like `compute_fpl_reference_stats.js`.
