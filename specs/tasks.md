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

- [ ] **Core Features: League & Team Management**
    - [ ] Implement League Creation/Joining flow
    - [ ] **DESIGN**: Define valid formations (4-4-2, 4-3-3, etc.) and validation logic for granular positions.
    - [ ] Implement Team Creation & Roster Management UI
    - [ ] Develop Draft System (Snake draft logic)
    - [ ] Build "My Team" view with detailed player cards

- [ ] **Core Features: Scoring & Gameplay**
    - [ ] Implement Scoring Engine (converting detailed stats to points)
    - [ ] Build Matchup calculation logic
    - [ ] Create League Standings and Fixtures view

- [ ] **Core Features: Transfers & Economy**
    - [ ] Implement Waiver Wire / Free Agency logic
    - [ ] Build Transfer Market UI
    - [ ] Implement "Transfer Out" compensation logic (FAAB reimbursement)

- [ ] **UI Polish & Verification**
    - [ ] Review all pages for responsive design
    - [ ] Conduct end-to-end testing of draft and scoring
    - [ ] Verify scoring accuracy against real match data

- [ ] **Deployment**
    - [ ] Deploy to Vercel
    - [ ] Set up scheduled jobs for data syncing (cron)
