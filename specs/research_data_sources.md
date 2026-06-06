# Data Source Research & Implementation Notes

Gaffa uses a hybrid data ingestion pipeline combining multiple sources to power its granular positions, Sigmoid Engine scoring model, and ACID-compliant virtual economy.

---

## 1. Premier League Live Statistics & Player Registry

### Primary Source: FPL (Fantasy Premier League) API
- **Endpoint**: `https://fantasy.premierleague.com/api/bootstrap-static/` (Player list, teams, status, news, and market value baselines).
- **Gameweek Live Events**: `https://fantasy.premierleague.com/api/event/{gameweek}/live/` (Granular match statistics per player).
- **Rate Limit**: Publicly accessible, no key required, highly resilient.

### Confirmed Available Stats (FPL Live)
The FPL gameweek live stats endpoint provides the complete set of stats required for the V2 Sigmoid Engine scoring model:
- `minutes`: Minutes played.
- `goals_scored`: Attacking goals.
- `assists`: Goal assists.
- `bps`: Bonus Points System score (used for Match Impact).
- `influence`, `creativity`, `threat`: ICT Index components.
- `expected_goals` ($xG$), `expected_assists` ($xA$), `expected_goals_conceded` ($xGC$): Expected stats.
- `saves`, `penalties_saved`: Goalkeeping statistics.
- `clean_sheets`, `goals_conceded`: Defensive outcomes.
- `tackles`, `clearances_blocks_interceptions` ($CBI$), `recoveries`: Defensive activities.
- `defensive_contribution`: Weighted defensive metric.
- `yellow_cards`, `red_cards`, `own_goals`, `penalties_missed`: Discipline/errors.

---

## 2. Granular Position Metadata

### Primary Source: SoFIFA API (EA FC Game Data)
- **Endpoint**: `https://api.sofifa.net/`
- **TOS/Cost**: Free for non-commercial use, no API key required.
- **Usage**: Maps EA FC’s granular positioning coordinates (e.g., LWB, RWB, CDM, CAM) to Gaffa's 12-position taxonomy.
- **Sync Method**: Queried via `/api/sync/sofifa-players` (protected by a `CRON_SECRET` header). Matches players via exact name strings (fuzzy matching is disabled to guarantee 100% precision and zero false positives).

---

## 3. Financial Market Valuations

### Primary Source: Transfermarkt Scraper
- **Scraper**: Python-based `dcaribou/transfermarkt-scraper`.
- **Valuation Sync**: A custom Node script (`scripts/sync_transfermarkt.ts`) fuzzy-matches player names against the Supabase `players` table and bulk-updates the `market_value` column.
- **FAAB Auction Seeding**: High-value new arrivals ($\ge \text{£40m}$) whose market values cross this threshold automatically trigger 48-hour system-generated FAAB auctions and broadcast notification emails via Resend.
- **Fallback**: Default player values are calculated from FPL’s `now_cost / 10` if Transfermarkt data is missing.

---

## 4. Fixtures & Schedules

### Primary Source: API-Football (Free Tier)
- **Endpoint**: `https://v3.football.api-sports.io/`
- **Rate Limit**: 100 requests/day (Free plan).
- **Usage**: Used to fetch the initial season schedule and team mappings. Due to the 100 req/day limit, Gaffa only queries this endpoint for schedule syncing, leaving a wide rate-limit buffer for other services.

---

## Conclusion
- FPL live events cover 100% of the statistical features required for the Sigmoid Engine.
- SoFIFA provides precise, tactical position designations (primary and secondary roles).
- Transfermarkt scraping is processed offline and fuzzy-matched to seed Gaffa’s virtual economy.
- The entire ingestion pipeline is optimized to run serverless-ready and strictly within a $0 budget.
