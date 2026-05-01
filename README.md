# ⚽ Fantasy Futbol

> A multi-tenant dynasty sports platform that brings real-world football economics and tactical depth to fantasy sports.

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat&logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?style=flat&logo=supabase)
![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?style=flat&logo=vercel)

Fantasy Futbol is a highly-customized, multi-tenant dynasty fantasy soccer application. Unlike mainstream platforms (like Sleeper or ESPN) that abstract sports into arbitrary point systems, this platform mirrors real-world football mechanics. Players are valued via public auctions (like real transfer windows) and scored contextually based on their real-world performance using a custom mathematical model.

## ✨ Technical Highlights (For Recruiters/Engineers)

- **Algorithmic "Sigmoid Engine"**: A custom TypeScript scoring model that mathematically normalizes raw live statistics against a 3-season baseline to calculate highly-contextual, positionally-weighted match ratings (1-10 scale). A defensive midfielder's actions are weighted entirely differently from a winger's.
- **ACID-Compliant Virtual Economy**: Built entirely on PostgreSQL RPCs to handle asynchronous 48-hour public FAAB (Free Agent Acquisition Budget) auctions, dynamic player market valuations, and multi-team trade propositions without race conditions.
- **Automated Data Pipelines**: Resilient ingestion pipelines powered by Supabase Edge Functions and Vercel Cron. Synchronizes live match events (FPL API), financial market valuations (Transfermarkt), and granular metadata (SoFIFA) while operating strictly within Vercel's serverless Hobby Tier execution limits.
- **Granular Position Enforcement**: 12 distinct positions (GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST) are strictly enforced in roster validation, lineup setting, and scoring weights.
- **Concurrent Tournament Generation**: Supports parallel league formats simultaneously. While the 38-game regular season determines the league winner by total points, a concurrent Champions Cup, Consolation Cup, and League Cup automatically generate and advance brackets based on live head-to-head weekly scores.
- **Premium Custom Design System**: A meticulously built dual-theme UI (Cream Editorial & Premium Dark) utilizing CSS Modules and strict token-based design principles—no utility-class frameworks were used, ensuring highly semantic and maintainable stylesheets.

---

## 🏗 System Architecture

- **Frontend**: Next.js App Router (React Server Components), TypeScript, CSS Modules
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions, RPCs)
- **Hosting**: Vercel (Fluid Compute enabled)
- **External Data Providers**: FPL API (Live match events), Transfermarkt (Financials/Market Value), SoFIFA (Granular positioning)

---

## 🛠 Local Development Setup

### 1. Prerequisites
- Node.js ≥ 20
- A Supabase project ([supabase.com](https://supabase.com))
- An API-Football free account ([api-football.com](https://www.api-football.com))

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy `.env.local` and fill in your values:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
API_FOOTBALL_KEY=your-api-football-key
CRON_SECRET=your-secret-for-cron-routes
```

### 4. Run Database Migrations
In your Supabase dashboard → SQL Editor, run the setup scripts located in:
```
supabase/migrations/
```

### 5. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

---

## 🗄️ Project Structure
```text
src/
├── app/            # Next.js App Router (Dashboard, League, Auth, API Routes)
├── components/     # Reusable React components (Players, Pitch, Trades)
├── context/        # React context providers (Theme)
├── lib/            # Core business logic (Scoring, Transfers, FPL API)
└── types/          # Global TypeScript interfaces
supabase/
└── migrations/     # PostgreSQL schema definitions and RPC functions
```
