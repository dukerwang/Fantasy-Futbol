# Fantasy Futbol ⚽

A dynasty-style Fantasy Premier League application with **granular positions** (CB vs FB), **real transfer market values** (Transfermarkt), and a **transparent, value-based scoring model**.

## Tech Stack
- **Next.js 16** (App Router, TypeScript)
- **Supabase** (PostgreSQL + Auth)
- **Vanilla CSS** (CSS Modules, Cream Editorial + Premium Dark themes)
- **API-Football**

---

## Setup

### 1. Prerequisites
- Node.js ≥ 20 (installed via Homebrew: `brew install node`)
- A Supabase project ([supabase.com](https://supabase.com))
- An API-Football free account ([api-football.com](https://www.api-football.com))

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy `.env.local` and fill in your values:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
API_FOOTBALL_KEY=your-api-football-key
CRON_SECRET=your-secret-for-cron-routes
```

### 4. Run Database Migrations
In your Supabase dashboard → SQL Editor, paste and run:
```
supabase/migrations/001_initial_schema.sql
```

### 5. Sync Premier League Players
```bash
curl -X POST http://localhost:3000/api/sync/players \
  -H "x-cron-secret: your-secret"
```

### 6. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

---

## Key Features

### Granular Position System
Instead of the standard DEF/MID/FWD, positions are:

| Code | Position | Description |
|------|----------|-------------|
| GK | GK | Goalkeeper |
| CB | CB | Centre-Back |
| LB/RB | FB | Fullback / Wingback |
| DM | DM | Defensive Midfielder |
| CM/LM/RM | MID | Central / Wide Midfielder |
| AM | AM | Attacking Midfielder |
| LW/RW | W | Winger |
| ST | ST | Striker / Centre-Forward |

### Sigmoid Scoring Engine (`src/lib/scoring/matchRating.ts`)
Points are awarded based on a position-weighted **Match Rating** (1.0–10.0 scale), normalized against 3-season baselines using a sigmoid curve.
- **Attacking**: Highly sensitive to Finishing clinicality (`stddev: 0.15`).
- **Defensive**: Weights defensive actions (Tackles, Interceptions) for DM/CB/GK.
- **Normalization**: Handled by the `loadReferenceStats()` utility for historical consistency.

### Transfer Compensation (`src/lib/transfers/compensation.ts`)
When a player transfers out of the Premier League:
1. Player marked `is_active = false`
2. `Compensation = market_value × 0.8`
3. Team's FAAB budget credited
4. Player dropped from all rosters
5. Transaction recorded

### Data Sources
- **Player Stats**: API-Football free tier (100 req/day — sufficient for 1 GW/week)
- **Market Values**: Transfermarkt via self-hosted `transfermarkt-api` wrapper
- See `specs/research_data_sources.md` for detailed availability notes

---

## Project Structure
```
src/
├── app/
│   ├── (auth)/         # Login, Signup pages
│   ├── (dashboard)/    # Protected pages (Dashboard, My Team, League, Transfers)
│   └── api/            # API routes (sync/players, sync/stats, transfers/compensate)
├── components/
│   ├── auth/           # LoginForm, SignupForm
│   ├── layout/         # Navbar
│   └── players/        # PlayerCard, PositionBadge
├── lib/
│   ├── api-football/   # API-Football client
│   ├── scoring/        # Scoring engine
│   ├── supabase/       # Client + server Supabase clients
│   └── transfers/      # Transfer compensation logic
└── types/              # TypeScript types (Player, League, Team, etc.)

supabase/
└── migrations/         # SQL schema files
```

## Deployment (Vercel)
1. Push to GitHub
2. Import in Vercel, add env vars
3. Set up Vercel Cron Jobs to hit `/api/sync/players` and `/api/sync/stats`
