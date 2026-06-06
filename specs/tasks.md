# Gaffa Project Tasks

- [x] **Project Initialization & Setup**
    - [x] Initialize Next.js project with TypeScript
    - [x] Configure ESLint and Prettier
    - [x] Set up global CSS variables and basic layout structure
    - [x] Set up database (PostgreSQL via Supabase)
    - [x] Configure authentication (Supabase Auth)

- [x] **Database Schema Design**
    - [x] Design Users and Leagues tables
    - [x] Design Players table (with granular positions)
    - [x] Design Teams and Rosters tables
    - [x] Design Matchups and Scoring rules tables
    - [x] Design Transactions table (transfers, waivers, auctions)
    - [x] Implement taxi squad config and state management (`taxi` status)
    - [x] Implement concurrent tournament tables (rounds, matchups, types)

- [x] **Data Integration (Backend)**
    - [x] **RESEARCH**: Verify FPL API and live statistics availability.
    - [x] **RESEARCH**: Verify SoFIFA and Transfermarkt data availability.
    - [x] Create scripts to fetch/sync Premier League teams and players (FPL)
    - [x] Implement player position mapping logic (Granular roles: 12 positions via SoFIFA)
    - [x] Implement transfer value fetching/estimation logic (Transfermarkt sync scraper script)

- [x] **Core Features: League & Team Management**
    - [x] Implement League Creation/Joining flow
    - [x] **DESIGN**: Define valid formations (4-4-2, 4-3-3, etc.) and validation logic for granular positions.
    - [x] Implement Team Creation & Roster Management UI
    - [x] Develop Draft System (Snake draft logic, autopilot, scheduling)
    - [x] Build "My Team" view with detailed player cards

- [x] **Core Features: Scoring & Gameplay**
    - [x] Implement Scoring Engine (converting FPL live stats to match ratings and curved points)
    - [x] Build Matchup calculation logic (role-aware scoring, auto-subs, bench depth bonus)
    - [x] Create League Standings and Fixtures view
    - [x] Implement Concurrent Tournaments (Champions Cup, Consolation Cup, League Cup brackets)

- [x] **Core Features: Transfers & Economy**
    - [x] Implement Waiver Wire / Free Agency logic (FAAB auctions)
    - [x] Build Transfer Market UI
    - [x] Implement "Transfer Out" compensation logic (FAAB reimbursement)

- [x] **UI Polish & Verification**
    - [x] Review all pages for responsive design (using Cream Editorial & Premium Dark CSS modules)
    - [x] Conduct end-to-end testing of draft and scoring
    - [x] Verify scoring accuracy against real match data

- [x] **End-to-End Testing**
    - [x] Create mock accounts in Supabase Auth
    - [x] Set up a dummy league and fill it with bots/test users
    - [x] Test the Draft Room functionality
    - [x] Test the Waiver Wire bidding and 48-hour auction resolution
    - [x] Test taxi squad activation and grandfathering age-out validations

- [x] **Deployment**
    - [x] Deploy to Vercel (https://gaffa.live/)
    - [x] Set up scheduled jobs for data syncing (cron routes for stats, resolving matchups, and auctions)
