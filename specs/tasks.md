# Fantasy Futbol Project Tasks

- [ ] **Project Initialization & Setup**
    - [ ] Initialize Next.js project with TypeScript
    - [ ] Configure ESLint and Prettier
    - [ ] Set up global CSS variables and basic layout structure
    - [ ] Set up database (PostgreSQL via Supabase)
    - [ ] Configure authentication (Supabase Auth)

- [ ] **Database Schema Design**
    - [ ] Design Users and Leagues tables
    - [ ] Design Players table (with granular positions)
    - [ ] Design Teams and Rosters tables
    - [ ] Design Matchups and Scoring rules tables
    - [ ] Design Transactions table (transfers, waivers)

- [ ] **Data Integration (Backend)**
    - [ ] **RESEARCH**: Verify API-Football Free Tier availability for specific stats (tackles, interceptions).
    - [ ] **RESEARCH**: Investigate `transfermarkt-api` or scraping options for market values.
    - [ ] Create scripts to fetch/sync Premier League teams and players
    - [ ] Implement player position mapping logic (Granular roles: CB, FB, CDM, CM, CAM, Winger, ST)
    - [ ] Implement transfer value fetching/estimation logic (Transfermarkt)

- [x] **Core Features: League & Team Management**
    - [x] Implement League Creation/Joining flow
    - [x] **DESIGN**: Define valid formations (4-4-2, 4-3-3, etc.) and validation logic for granular positions.
    - [x] Implement Team Creation & Roster Management UI
    - [x] Develop Draft System (Snake draft logic)
    - [x] Build "My Team" view with detailed player cards

- [x] **Core Features: Scoring & Gameplay**
    - [x] Implement Scoring Engine (converting detailed stats to points)
    - [x] Build Matchup calculation logic
    - [x] Create League Standings and Fixtures view

- [x] **Core Features: Transfers & Economy**
    - [x] Implement Waiver Wire / Free Agency logic
    - [x] Build Transfer Market UI
    - [x] Implement "Transfer Out" compensation logic (FAAB reimbursement)

- [ ] **UI Polish & Verification**
    - [ ] Review all pages for responsive design
    - [ ] Conduct end-to-end testing of draft and scoring
    - [ ] Verify scoring accuracy against real match data

- [ ] **Deployment**
    - [ ] Deploy to Vercel
    - [ ] Set up scheduled jobs for data syncing (cron)
